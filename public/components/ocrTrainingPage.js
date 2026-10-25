// ฝึก OCR — เก็บบรรทัดจากไฟล์ที่เคยอัปโหลด ให้ผู้ใช้แก้เป็นข้อความที่ถูกต้อง
// แล้วใช้คู่ "ผิด → ถูก" เป็นตัวอย่าง few-shot ให้ post-OCR
//
// ข้อมูลเก็บใน data/ocr-training.json ฝั่ง main process (ในเครื่องเท่านั้น)
// หน้านี้ไม่ผูกกับไฟล์ .docx จึงประกาศ standalone = true
(function (scope) {
    'use strict';

    const HTML = [
        '<h1>ฝึก OCR</h1>',

        '<section class="suggest-settings">',
        '    <h2>คลังข้อความสำหรับฝึก</h2>',

        '    <p class="hint">',
        '        ทุกครั้งที่อัปโหลด .pdf / .docx หรือวางข้อความในหน้าดึงข้อมูล ',
        '        ระบบจะเก็บบรรทัดที่อ่านได้ไว้ที่นี่ — ',
        '        พิมพ์ข้อความที่ถูกต้องของแต่ละบรรทัดแล้วกด “บันทึก” ',
        '        คู่นั้นจะถูกใช้เป็นตัวอย่าง (Vector Few-Shot) ให้ AI ปรับข้อความครั้งต่อไป ',
        '        โดยเลือกคู่ที่ใกล้ที่สุด 3 คู่ต่อครั้ง',
        '    </p>',

        '    <p class="hint">',
        '        ถ้าเลือก AI API (Gemini) ตัวอย่างที่ฝึกไว้จะถูกส่งไปพร้อมคำขอด้วย — ',
        '        ถ้าเลือก Local AI ทุกอย่างอยู่ในเครื่อง',
        '    </p>',

        '    <p class="hint" id="ocrTrainStats"></p>',

        '    <div class="master-toolbar">',
        '        <label for="ocrTrainSearch">ค้นหา</label>',
        '        <input type="text" id="ocrTrainSearch" placeholder="ข้อความ หรือชื่อไฟล์" autocomplete="off">',
        '        <label for="ocrTrainFilter">สถานะ</label>',
        '        <select id="ocrTrainFilter">',
        '            <option value="new">รอตรวจ</option>',
        '            <option value="trained">ฝึกแล้ว</option>',
        '            <option value="skipped">ข้ามแล้ว</option>',
        '            <option value="all">ทั้งหมด</option>',
        '        </select>',
        '        <button id="ocrTrainRefresh" type="button" class="plain">รีเฟรช</button>',
        '    </div>',

        '    <p id="ocrTrainStatus" class="db-status"></p>',
        '</section>',

        '<section class="saved-templates">',
        '    <div class="list-head">',
        '        <h2>บรรทัดที่เก็บไว้</h2>',
        '        <span class="hint" id="ocrTrainCount"></span>',
        '    </div>',
        '    <ul id="ocrTrainList" class="saved-list ocr-training-list"></ul>',
        '</section>'
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

    function el(id) {
        return document.getElementById(id);
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

    // ──────────────────────────────────────────────────────────────
    // โหลด / แสดงรายการ
    // ──────────────────────────────────────────────────────────────

    async function loadList() {
        const electron = api();

        if (!electron || !electron.ocrTrainingList) {
            setStatus('เปิดหน้านี้ในแอปเพื่อใช้คลังฝึก OCR', 'error');
            return;
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

        renderStats(result.stats);
        renderList(result);

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

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent =
            (STATUS_LABELS[line.status] || line.status) +
            ' · ' + formatDate(line.createdAt);

        head.appendChild(source);
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

        busy = true;
        row.classList.add('busy');

        let message = '';

        try {
            if (action === 'save') {
                const result = await electron.ocrTrainingSave({
                    id: id,
                    output: input ? input.value : ''
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

                    if (!confirmed) return;
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

            if (filterSelect) {
                filterSelect.addEventListener('change', function () {
                    filter = filterSelect.value;
                    loadList();
                });
            }

            if (refresh) {
                refresh.addEventListener('click', function () {
                    loadList();
                });
            }

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

            loadList();
        }
    };

    scope.OcrTrainingPage = page;
})(window);
