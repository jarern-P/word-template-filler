(function (scope) {
    'use strict';

    const HTML = [
        '<section class="page ocr-training-page">',
        '    <div class="box-row">',
        '        <div class="box">',
        '            <div class="box-title">คลังฝึก OCR</div>',
        '            <div class="box-controls">',
        '                <select id="ocrTrainFilter" class="filter">',
        '                    <option value="new">รอตรวจ</option>',
        '                    <option value="trained">ฝึกแล้ว</option>',
        '                    <option value="skipped">ข้าม</option>',
        '                    <option value="all">ทั้งหมด</option>',
        '                </select>',
        '                <input id="ocrTrainSearch" class="search" type="text" placeholder="ค้นหาบรรทัด...">',
        '                <button id="ocrTrainRefresh" type="button" class="plain">รีเฟรช</button>',
        '                <button id="ocrTrainAddManual" type="button" class="plain">เพิ่มเอง</button>',
        '            </div>',
        '            <details class="source-filter" id="ocrTrainSourceFilter">',
        '                <summary>ตัวกรองแหล่งที่มา</summary>',
        '                <div class="source-filter-body" id="ocrTrainSourceFilterBody"></div>',
        '            </details>',
        '        </div>',
        '    </div>',
        '    <div class="box-row">',
        '        <div class="box stats">',
        '            <div id="ocrTrainStats" class="stats-line"></div>',
        '        </div>',
        '    </div>',
        '    <div class="box-row">',
        '        <ul id="ocrTrainList" class="saved-list ocr-training-list"></ul>',
        '    </section>'
    ].join('\n');

    const STATUS_LABELS = {
        new: 'รอตรวจ',
        trained: 'ฝึกแล้ว',
        skipped: 'ข้ามแล้ว'
    };

    let filter = 'new';
    let search = '';
    let busy = false;
    let searchTimer = null;
    let sourceFilter = null;

    let sourceFilterBody = null;
    let addManualBtn = null;

    function el(id) {
        return document.getElementById(id);
    }

    function renderSourceFilter(result) {
        sourceFilterBody = el('ocrTrainSourceFilterBody');

        if (!sourceFilterBody) return;

        const counts = result && result.bySource ? result.bySource : {};
        const entries = Object.keys(counts).sort();

        sourceFilterBody.innerHTML = '';

        const allLabel = document.createElement('label');
        allLabel.className = 'source-filter-radio';
        allLabel.innerHTML = '<input type="radio" name="ocrSourceFilter" value="ทั้งหมด" checked>'
            + '<span>ทั้งหมด</span><span class="source-filter-count">' + (result && result.total ? result.total : 0) + '</span>';
        sourceFilterBody.appendChild(allLabel);

        entries.forEach(function (source) {
            const label = document.createElement('label');
            label.className = 'source-filter-radio';
            label.innerHTML = '<input type="radio" name="ocrSourceFilter" value="' + source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '">'
                + '<span>' + source + '</span><span class="source-filter-count">' + counts[source] + '</span>';
            sourceFilterBody.appendChild(label);
        });

        if (entries.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'hint';
            empty.textContent = 'ยังไม่มีบรรทัดในคลัง';
            sourceFilterBody.appendChild(empty);
        }
    }

    function api() {
        return window.electronAPI || null;
    }

    function setStatus(text, kind) {
        const node = el('ocrTrainStatus');

        if (!node) return;

        node.textContent = text || '';
        node.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    function formatDate(isoText) {
        const date = new Date(isoText);

        if (isNaN(date.getTime())) return isoText || '';

        return date.toLocaleString('th-TH', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function compact(text) {
        return String(text == null ? '' : text).replace(/\s+/g, '');
    }

    // -------------------------------------------------------------------------------------
    // โหลด / แสดงรายการ
    // -------------------------------------------------------------------------------------

    async function loadList() {
        const electron = api();

        if (!electron || !electron.ocrTrainingList) {
            setStatus('เปิดหน้านี้ในแอปเพื่อใช้คลังฝึก OCR', 'error');
            return;
        }

        // โหลดตัวกรองแหล่งที่มาก่อน แล้วค่อยโหลดรายการ (เพื่อแสดงตัวเลือก)
        const filterResult = electron.ocrTrainingFilter
            ? await electron.ocrTrainingFilter({ source: sourceFilter })
            : null;

        if (filterResult && filterResult.ok !== false) {
            renderSourceFilter(filterResult);
        } else {
            el('ocrTrainSourceFilter') && (el('ocrTrainSourceFilter').hidden = true);
        }

        const result = await electron.ocrTrainingList({
            status: filter,
            search: search,
            limit: 200
        });

        if (!result || result.ok === false) {
            setStatus(
                (result && result.error) || 'อ่านรายการฝึก OCR ไม่สำเร็จ',
                'error'
            );
            return;
        }

        // กรองรายการที่แสดงด้วยแหล่งที่มาที่เลือก (ถ้ามี)
        let lines = Array.isArray(result.lines) ? result.lines : [];

        if (sourceFilter && sourceFilter !== 'ทั้งหมด' && sourceFilter !== 'ไม่ทราบไฟล์' && lines.length > 0) {
            lines = lines.filter(function (line) {
                return line.source === sourceFilter;
            });
        }

        renderStats(result.stats);
        renderList({ lines: lines, shown: lines.length, matched: result.matched, stats: result.stats, limit: result.limit });

        if (result.error) setStatus(result.error, 'error');
    }

    function renderStats(stats) {
        const node = el('ocrTrainStats');

        if (!node) return;

        const value = stats || {};

        node.textContent =
            'ทั้งหมด ' + (value.total || 0) + ' บรรทัด' +
            ' · รอตรวจ ' + (value.new || 0) +
            ' · ฝึกแล้ว ' + (value.trained || 0) +
            ' · ข้าม ' + (value.skipped || 0);
    }

    function renderList(result) {
        const list = el('ocrTrainList');
        const count = el('ocrTrainCount');

        list.innerHTML = '';

        const lines = Array.isArray(result.lines) ? result.lines : [];

        if (count) {
            count.textContent = result.matched > result.shown
                ? 'แสดง ' + result.shown + ' จาก ' + result.matched +
                  ' — ใช้ค้นหา/สถานะเพื่อกรอง'
                : result.matched + ' รายการ';
        }

        if (lines.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = filter === 'new' && search === ''
                ? 'ยังไม่มีบรรทัดให้ตรวจ — อัปโหลด PDF หรือ .docx ในหน้าดึงข้อมูลก่อน'
                : 'ไม่พบรายการตามเงื่อนไขที่เลือก';

            list.appendChild(empty);
            return;
        }

        lines.forEach(function (line) {
            list.appendChild(createRow(line));
        });
    }

    function createRow(line) {
        const item = document.createElement('li');
        item.className = 'training-item';
        item.dataset.id = line.id;

        const head = document.createElement('div');
        head.className = 'training-head';

        const source = document.createElement('strong');
        source.textContent = line.source || 'ไม่ทราบไฟล์';

        const statusBadge = document.createElement('span');
        statusBadge.className = 'status-badge' + (line.status ? ' status-' + line.status : '');
        statusBadge.textContent = STATUS_LABELS[line.status] || line.status;

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent =
            ' · ' + formatDate(line.createdAt);

        head.appendChild(source);
        head.appendChild(statusBadge);
        head.appendChild(meta);

        const original = document.createElement('p');
        original.className = 'training-original';
        original.textContent = line.input;

        const input = document.createElement('textarea');
        input.className = 'training-input';
        input.rows = 2;
        input.spellcheck = false;
        input.value = line.output || line.input;
        input.placeholder = 'พิมพ์ข้อความที่ถูกต้องของบรรทัดนี้';
        input.dataset.role = 'training-input';

        const actions = document.createElement('div');
        actions.className = 'training-actions';

        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'บันทึก';
        save.dataset.action = 'save';

        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'plain';
        skip.dataset.action = line.status === 'skipped' ? 'restore' : 'skip';
        skip.textContent = line.status === 'skipped'
            ? 'นำกลับมาตรวจ'
            : 'ข้าม';

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'plain danger';
        remove.dataset.action = 'remove';
        remove.textContent = 'ลบ';

        item.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ',') &&
                document.activeElement === input) {
                e.preventDefault();
                if (!save.disabled) save.click();
            }
        });

        function updateSaveState() {
            save.disabled =
                busy ||
                input.value.trim() === '' ||
                compact(input.value) === compact(line.input);
        }

        input.addEventListener('input', updateSaveState);
        updateSaveState();

        actions.appendChild(save);
        actions.appendChild(skip);
        actions.appendChild(remove);

        item.appendChild(head);
        item.appendChild(original);
        item.appendChild(input);
        item.appendChild(actions);

        return item;
    }

    // ──────────────────────────────────────────────────────────────
    // การกระทำ
    // ──────────────────────────────────────────────────────────────

    async function runAction(row, action) {
        const electron = api();

        if (busy || !row || !electron) return;

        const id = row.dataset.id;
        const input = row.querySelector('[data-role="training-input"]');

        row.classList.add('busy');

        try {
            if (action === 'save') {
                const trimmed = input.value.trim();

                if (trimmed === '') {
                    setStatus('ข้อความที่บันทึกต้องไม่ว่างเปล่า', 'error');
                    return;
                }

                const result = await electron.ocrTrainingSave({
                    id: id,
                    output: trimmed
                });

                if (!result || result.ok === false) {
                    throw new Error(
                        (result && result.error) || 'บันทึกไม่สำเร็จ'
                    );
                }

                message = filter === 'new'
                    ? 'บันทึกตัวอย่างแล้ว — ดูรายการที่ฝึกแล้วได้ที่ตัวกรองสถานะ'
                    : 'บันทึกตัวอย่างแล้ว — AI จะใช้คู่นี้ครั้งต่อไป';

            } else if (action === 'skip' || action === 'restore') {
                const isRestore = action === 'restore';
                const result = isRestore
                    ? await electron.ocrTrainingRestore(id)
                    : await electron.ocrTrainingSkip(id);

                if (!result || result.ok === false) {
                    throw new Error(
                        (result && result.error) || 'เปลี่ยนสถานะไม่สำเร็จ'
                    );
                }

                message = isRestore
                    ? 'นำกลับมาที่รายการรอตรวจแล้ว'
                    : 'ข้ามบรรทัดนี้แล้ว';

            } else if (action === 'remove') {
                if (scope.AppDialog && scope.AppDialog.confirm) {
                    const confirmed = await scope.AppDialog.confirm(
                        'ลบบรรทัดนี้ออกจากคลังฝึก OCR?'
                    );

                    if (!confirmed) {
                        setStatus('ยกเลิกแล้ว', 'info');
                        return;
                    }
                }

                const result = await electron.ocrTrainingRemove(id);

                if (!result || result.ok === false) {
                    throw new Error(
                        (result && result.error) || 'ลบไม่สำเร็จ'
                    );
                }

                message = 'ลบบรรทัดแล้ว';
            }

            await loadList();

            setStatus(message, 'ok');

        } catch (error) {
            setStatus(
                (error && error.message) || 'ทำรายการไม่สำเร็จ',
                'error'
            );

        } finally {
            busy = false;
            row.classList.remove('busy');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Page
    // ──────────────────────────────────────────────────────────────

    const page = {

        // หน้านี้จัดการ UI เอง ไม่ขึ้นกับ state ของไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        onShow: function () {
            const list = el('ocrTrainList');
            const refresh = el('ocrTrainRefresh');
            const filterSelect = el('ocrTrainFilter');
            const searchInput = el('ocrTrainSearch');

            filter = 'new';
            search = '';

            setStatus('');
            if (filterSelect) filterSelect.value = filter;
            if (searchInput) searchInput.value = '';

            if (sourceFilterBody) {
                sourceFilterBody.addEventListener('click', function (event) {
                    const radio = event.target.closest('input[type="radio"]');

                    if (!radio) return;

                    sourceFilter = radio.value;
                    loadList();
                });
            }

            if (refresh) {
                refresh.addEventListener('click', function () {
                    loadList();
                });
            }

            if (addManualBtn) {
                addManualBtn.addEventListener('click', openAddManualDialog);
            }

            if (sourceFilterBody) {
                sourceFilterBody.addEventListener('click', function (event) {
                    const radio = event.target.closest('input[type="radio"]');

                    if (!radio) return;

                    sourceFilter = radio.value;
                    loadList();
                });
            }

            // รีเฟรชเมื่อปิดตัวกรองแหล่งที่มา (กดปุ่ม "ทั้งหมด" ซ้ำ ไม่ต้องโหลดซ้ำ)
            el('ocrTrainSourceFilter') && (el('ocrTrainSourceFilter').addEventListener('toggle', function () {
                if (!el('ocrTrainSourceFilter').open) {
                    sourceFilter = null;
                    loadList();
                }
            }));

            if (searchInput) {
                searchInput.addEventListener('input', function () {
                    window.clearTimeout(searchTimer);

                    searchTimer = window.setTimeout(function () {
                        search = searchInput.value.trim();
                        loadList();
                    }, 250);
                });
            }

            if (list) {
                list.addEventListener('click', function (event) {
                    const button = event.target.closest
                        ? event.target.closest('button[data-action]')
                        : null;

                    if (!button) return;

                    const row = button.closest('.training-item');

                    if (!row) return;

                    runAction(row, button.dataset.action);
                });
            }

            // รีเฟรชเมื่อปิดตัวกรองแหล่งที่มา (กดปุ่ม "ทั้งหมด" ซ้ำ ไม่ต้องโหลดซ้ำ)
            el('ocrTrainSourceFilter') && (el('ocrTrainSourceFilter').addEventListener('toggle', function () {
                if (!el('ocrTrainSourceFilter').open) {
                    sourceFilter = null;
                    loadList();
                }
            }));

            loadList();
        },

        openAddManualDialog: function () {
            if (busy) return;

            if (!scope.AppDialog || !scope.AppDialog.prompt) {
                setStatus('ไม่สามารถเปิดกล่องเพิ่มเองได้ — แอปยังไม่พร้อม', 'error');
                return;
            }

            const electron = api();

            if (!electron || !electron.ocrTrainingAddManual) {
                setStatus('ไม่รองรับการเพิ่มเอง — เปิดหน้านี้ในแอป', 'error');
                return;
            }

            const input = scope.AppDialog.prompt(
                'เพิ่มบรรทัดใหม่ด้วยตนเอง',
                [
                    { label: 'บรรทัดที่อ่านผิด (OCR)', id: 'manualInput', type: 'text', required: true, placeholder: 'เช่น วิทยาลัยทักษิณ' },
                    { label: 'คำอธิบาย (ไม่จำเป็น)', id: 'manualSource', type: 'text', required: false, placeholder: 'เช่น เอกสารระเบียบฯ' }
                ]
            );

            if (!input) return;

            const text = String(input.manualInput || '').trim();
            const source = String(input.manualSource || '').trim();

            if (text.length < 3) {
                setStatus('ข้อความเข้าสั้นเกินไป — ต้องอย่างน้อย 3 ตัวอักษร', 'error');
                return;
            }

            busy = true;
            setStatus('กำลังเพิ่ม...', 'ok');

            electron.ocrTrainingAddManual({ source: source || undefined, input: text })
                .then(function (result) {
                    if (!result || result.ok === false) {
                        throw new Error((result && result.error) || 'เพิ่มไม่สำเร็จ');
                    }

                    setStatus('เพิ่มบรรทัดแล้ว — "' + text + '"', 'ok');
                    return loadList();
                })
                .then(function () {
                    busy = false;
                })
                .catch(function (error) {
                    busy = false;
                    setStatus(
                        (error && error.message) || 'เพิ่มไม่สำเร็จ',
                        'error'
                    );
                });
        }
    };

    scope.OcrTrainingPage = page;
})(window);
