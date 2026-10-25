// Data Extract Dialog - ใส่ข้อมูลจากข้อความ/ไฟล์ แล้วจับค่าด้วย regex ของแต่ละ field
//
// เปิดได้ 2 โหมด:
//   mode = 'config'  (หน้าตั้งค่าแม่แบบ → ปุ่ม "ข้อมูล" ของรายการแม่แบบ)
//       - แก้ regex ของแต่ละ field
//       - อัปโหลด/วางข้อความเพื่อ "ทดสอบ" เท่านั้น (ไม่บันทึกค่าที่ทดสอบ)
//       - ปุ่ม "บันทึก regex" เขียนกลับลงแม่แบบ
//   mode = 'report'  (หน้ารายงาน → ปุ่ม "ใส่ข้อมูล")
//       - ใช้ regex ที่บันทึกไว้กับแม่แบบ
//       - ปุ่ม "เติมข้อมูลลงฟอร์ม" เอาค่าที่จับได้ไปใส่ช่องกรอกของหน้ารายงาน
//
// โครง overlay ใช้คลาสเดียวกับ PreviewDialog จึงได้สไตล์/การล็อก scroll ไปด้วย
(function (scope) {
    'use strict';

    const HTML = [
        '<div class="preview-backdrop" data-data-close></div>',
        '<div class="preview-dialog data-dialog" role="dialog" aria-modal="true" aria-labelledby="dataDialogTitle">',
        '    <div class="preview-head">',
        '        <h2 id="dataDialogTitle">ใส่ข้อมูล</h2>',
        '        <div class="dialog-head-tools">',
        '            <button type="button" class="dialog-icon-btn" id="dataSettingsExportBtn"' +
            ' title="ส่งออก regex ของแม่แบบนี้เป็นไฟล์ JSON"' +
            ' aria-label="ส่งออก regex เป็นไฟล์ JSON">' +
            scope.TemplateSettings.ICONS.export +
            '</button>',
        '            <button type="button" class="dialog-icon-btn" id="dataSettingsImportBtn"' +
            ' title="นำเข้า regex จากไฟล์ JSON — ใช้เฉพาะ field ที่ชื่อตรงกัน"' +
            ' aria-label="นำเข้า regex จากไฟล์ JSON">' +
            scope.TemplateSettings.ICONS.import +
            '</button>',
        '            <input type="file" id="dataSettingsImportInput"' +
            ' accept=".json,application/json" hidden>',
        '            <button type="button" class="preview-close" data-data-close aria-label="ปิด">&times;</button>',
        '        </div>',
        '    </div>',
        '    <p id="dataDialogMeta" class="preview-meta"></p>',
        '    <div class="data-body">',
        '        <section id="dataPatternSection" class="data-patterns">',
        '            <h3>Regex ของแต่ละ field</h3>',            '            <p class="hint">พิมพ์ regex ที่ใช้ดึงค่าของช่องนั้นจากข้อความ ' +
            'เช่น <code>เลขที่\\s*([^\\n]+)</code> — ถ้ามีวงเล็บจะใช้กลุ่มแรก ' +
            'ถ้าไม่มีจะใช้ข้อความที่ตรงทั้งก้อน (พิมพ์แบบ <code>/.../i</code> เพื่อใส่ flag ได้)' +
            '<br>ช่องที่เป็น "รายการ" ใช้ regex ของ <b>1 แถว</b> และเก็บทุก match เป็นแถว ' +
            '(เช่น <code>^-\\s*(.+)$</code> — ไม่ต้องใส่ flag g/m เอง) ' +
            'ถ้าอยู่กลุ่มเดียวกัน วงเล็บที่ 2, 3, ... คือคอลัมน์ที่ 2, 3, ... ของกลุ่ม</p>',
        '            <div id="dataPatternList" class="data-pattern-list"></div>',
        '        </section>',
        '        <section class="data-source">',
        '            <div class="data-section-head">',
        '                <h3>ข้อความหรือไฟล์ต้นทาง</h3>',
        '                <div class="data-source-actions">',
        '                    <button id="dataUploadDocxBtn" type="button" class="plain">อัปโหลด .docx</button>',
        '                    <button id="dataUploadPdfBtn" type="button" class="plain">อัปโหลด .pdf</button>',
        '                </div>',
        '            </div>',
        '            <input type="file" id="dataDocxInput" accept=".docx" hidden>',
        '            <input type="file" id="dataPdfInput" accept=".pdf" hidden>',
        '            <div class="data-source-options">',
        '                <label class="data-join-toggle" title="ใช้เมื่ออ่านไฟล์ PDF — ' +
            'ระบบจะเย็บบรรทัดที่ถูกตัดกลางประโยคกลับเป็นบรรทัดเดียว ' +
            'โดยดูจากตำแหน่งบรรทัดและคำเชื่อม/คำลงท้ายไทย">',
        '                    <input type="checkbox" id="dataJoinLines">',
        '                    <span>รวมบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่</span>',
        '                </label>',
        '            </div>',
        '            <p id="dataSourceStatus" class="hint data-source-status"></p>',
        '            <textarea id="dataSourceText" class="data-source-text" rows="8"',
        '                      placeholder="วางข้อความที่มีข้อมูลอยู่ที่นี่ หรือกดอัปโหลดไฟล์ .docx / .pdf"></textarea>',
        '            <div class="data-tools">',
        '                <button id="dataPostOcrBtn" type="button" title="รวมบรรทัดที่ถูกตัด → วิเคราะห์ Layout → จัดลำดับการอ่าน → ตรวจแก้คำผิด → แบ่งประโยค">ปรับข้อความหลัง OCR</button>',
        '                <button id="dataPostOcrUndoBtn" type="button" class="plain" hidden>ย้อนกลับ</button>',
        '            </div>',
        '            <p class="hint data-tools-hint">',
        '                ปุ่มเดียวรวมทุกขั้น: รวมบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่ → วิเคราะห์ Layout → ',
        '                จัดลำดับการอ่าน → ตรวจแก้คำผิด → แบ่งประโยค',
        '                <br>วิธีประมวลผลเลือกได้ที่ ตั้งค่า OCR › หลัง OCR: ',
        '                <span id="dataPostOcrEngine" class="data-engine-badge">ไลบรารีในเครื่อง</span>',
        '            </p>',
        '            <div id="dataSpellPanel" class="data-tool-panel" hidden>',
        '                <div class="data-tool-head">',
        '                    <strong>คำที่น่าสงสัย</strong>',
        '                    <span id="dataSpellMeta" class="hint"></span>',
        '                    <div class="data-tool-actions">',
        '                        <button id="dataSpellApplyAll" type="button" class="plain">ใช้คำแนะนำทั้งหมด</button>',
        '                        <button id="dataSpellClose" type="button" class="plain">ปิด</button>',
        '                    </div>',
        '                </div>',
        '                <div id="dataSpellList" class="data-tool-list"></div>',
        '            </div>',
        '        </section>',
        '        <section class="data-results">',
        '            <h3>ผลการจับข้อมูล</h3>',
        '            <div id="dataResultBody" class="data-result-body"></div>',
        '        </section>',
        '    </div>',
        '    <div class="data-actions">',
        '        <button id="dataCloseBtn" type="button" class="plain">ปิด</button>',
        '        <button id="dataTestBtn" type="button" class="plain">ทดสอบ</button>',
        '        <button id="dataSavePatternsBtn" type="button" class="plain">บันทึก regex</button>',
        '        <button id="dataFillBtn" type="button">เติมข้อมูลลงฟอร์ม</button>',
        '    </div>',
        '</div>'
    ].join('\n');

    // สวิตช์ "รวมบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่" — ค่าติดตั้งของเครื่องนี้
    const JOIN_LINES_KEY = 'wordTemplateFiller:joinLines';

    function loadJoinLinesSetting() {
        try {
            const raw = window.localStorage.getItem(JOIN_LINES_KEY);

            return raw === null ? true : raw !== '0';
        } catch (error) {
            return true;
        }
    }

    function saveJoinLinesSetting(enabled) {
        try {
            window.localStorage.setItem(JOIN_LINES_KEY, enabled ? '1' : '0');
        } catch (error) {
            // เก็บไม่ได้ก็ยังใช้ค่าที่เลือกกับไฟล์รอบนี้ได้
        }
    }

    let joinLinesEnabled = loadJoinLinesSetting();

    let overlay = null;
    let settings = null;   // ค่าที่ส่งมาตอน open
    let mode = 'report';

    // กำลังอ่านไฟล์อยู่หรือไม่ — ใช้ตัดสินว่าจะแสดงความคืบหน้าหรือไม่
    let readingFile = false;

    // ตัวจับเวลาเก็บข้อความที่วาง/พิมพ์เอง (กันเก็บทุกครั้งที่มีการพิมพ์)
    let pasteCaptureTimer = null;

    // ไฟล์ PDF ล่าสุด (ใช้กับ Layout / Reading Order)
    let lastPdfFile = null;

    // ผลวิเคราะห์ layout ที่แคชไว้ — ใช้ซ้ำเมื่อไฟล์เดิมและไม่ต้องรันโมเดลซ้ำ
    let layoutCache = null;

    let layoutBusy = false;

    // รายการคำที่รอแก้ (ใช้กับ "ใช้คำแนะนำทั้งหมด")
    let spellQueue = [];

    function el(id) {
        return document.getElementById(id);
    }

    function typeLabel(type) {
        if (scope.FieldTypes && scope.FieldTypes.get) {
            return scope.FieldTypes.get(type).label;
        }

        return type || 'ข้อความ';
    }

    // ──────────────────────────────────────────────────────────────
    // สร้าง / เปิด / ปิด
    // ──────────────────────────────────────────────────────────────

    function build() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'preview-overlay data-overlay';
        overlay.id = 'dataExtractDialog';
        overlay.innerHTML = HTML;

        document.body.appendChild(overlay);

        overlay.querySelectorAll('[data-data-close]').forEach(function (node) {
            node.addEventListener('click', close);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;

            close();
        });

        el('dataCloseBtn').addEventListener('click', close);
        el('dataTestBtn').addEventListener('click', runTest);
        el('dataFillBtn').addEventListener('click', runFill);
        el('dataSavePatternsBtn').addEventListener('click', savePatterns);

        el('dataSettingsExportBtn').addEventListener('click', exportPatterns);

        el('dataSettingsImportBtn').addEventListener('click', function () {
            el('dataSettingsImportInput').click();
        });

        el('dataSettingsImportInput').addEventListener('change', importPatternsFromFile);

        el('dataUploadDocxBtn').addEventListener('click', function () {
            el('dataDocxInput').click();
        });

        el('dataUploadPdfBtn').addEventListener('click', function () {
            el('dataPdfInput').click();
        });

        // ── ปุ่มเดียว: ปรับข้อความหลัง OCR ──
        el('dataPostOcrBtn').addEventListener('click', function () {
            runPostOcr();
        });

        el('dataPostOcrUndoBtn').addEventListener('click', undoPostOcr);

        refreshPostOcrEngine();

        el('dataSpellApplyAll').addEventListener('click', applyAllSpellSuggestions);

        el('dataSpellClose').addEventListener('click', function () {
            el('dataSpellPanel').hidden = true;
            el('dataSpellList').innerHTML = '';
            spellQueue = [];
        });

        el('dataSourceText').addEventListener('input', updateToolsState);

        // ข้อความที่วาง/พิมพ์เอง (ไม่ใช่ไฟล์) เก็บลงคลังฝึก OCR ด้วย — ดู capturePastedLines
        el('dataSourceText').addEventListener('input', schedulePasteCapture);

        // ความคืบหน้าระหว่างวิเคราะห์ Layout / ดาวน์โหลดโมเดล
        if (window.electronAPI && window.electronAPI.onPdfLayoutProgress) {
            window.electronAPI.onPdfLayoutProgress(function (progress) {
                if (!layoutBusy || !progress) return;

                let text = progress.label || 'กำลังวิเคราะห์โครงสร้างเอกสาร...';

                if (
                    progress.stage === 'download' &&
                    Number(progress.total) > 0
                ) {
                    text += ' ' + progress.percent + '%';
                }

                setSourceStatus(text);
            });
        }

        // ความคืบหน้าระหว่างปรับข้อความหลัง OCR (Local AI / AI API)
        if (window.electronAPI && window.electronAPI.onPostOcrProgress) {
            window.electronAPI.onPostOcrProgress(function (progress) {
                if (!postOcrBusy || !progress) return;

                if (progress.stage === 'download') {
                    setSourceStatus(
                        'กำลังดาวน์โหลดโมเดล Qwen2.5-3B... ' +
                        (Number(progress.percent) || 0) + '%'
                    );
                    return;
                }

                if (progress.stage === 'chunk') {
                    setSourceStatus(
                        'กำลังปรับข้อความด้วย AI ก้อนที่ ' +
                        progress.index + '/' + progress.total + '...'
                    );
                }
            });
        }

        // ความคืบหน้าจาก main process ระหว่างอ่าน PDF
        if (window.electronAPI && window.electronAPI.onPdfExtractProgress) {
            window.electronAPI.onPdfExtractProgress(function (progress) {
                if (!readingFile || !progress) return;

                if (progress.status === 'reading') {
                    setSourceStatus(
                        'กำลังอ่านหน้า ' +
                        progress.page + '/' + progress.pageCount +
                        '...'
                    );
                    return;
                }

                if (progress.status === 'ocr-prepare') {
                    setSourceStatus(
                        'กำลังเตรียม OCR (ครั้งแรกอาจใช้เวลาดาวน์โหลดโมเดล)...'
                    );
                    return;
                }

                if (progress.status === 'ocr-api') {
                    setSourceStatus(
                        'กำลัง OCR ด้วย i love api... (อาจใช้เวลาหลายสิบวินาที)'
                    );
                    return;
                }

                if (progress.status === 'ocr') {
                    setSourceStatus(
                        'กำลัง OCR หน้า ' +
                        progress.page + '/' + progress.pageCount +
                        (progress.progress >= 1 ? ' — เสร็จแล้ว' : '...')
                    );
                }
            });
        }

        el('dataDocxInput').addEventListener('change', function (event) {
            readFile(event.target);
        });

        el('dataPdfInput').addEventListener('change', function (event) {
            readFile(event.target);
        });

        // สวิตช์เย็บบรรทัดที่ถูกตัด (ใช้กับ PDF ที่จะอ่านครั้งถัดไป)
        const joinToggle = el('dataJoinLines');

        joinToggle.checked = joinLinesEnabled;
        joinToggle.addEventListener('change', function () {
            joinLinesEnabled = joinToggle.checked;
            saveJoinLinesSetting(joinLinesEnabled);
        });

    }

    function close() {
        // เรียกได้ก่อน build (เช่นตอนเปลี่ยนหน้า) — ยังไม่มี DOM ให้แตะ
        if (!overlay) return;

        // ข้อความที่วาง/พิมพ์ค้างอยู่ — เก็บลงคลังฝึกก่อนปิด (ไม่รอจังหวะพิมพ์หยุด)
        if (pasteCaptureTimer !== null) {
            window.clearTimeout(pasteCaptureTimer);
            pasteCaptureTimer = null;
            capturePastedLines();
        }

        overlay.classList.remove('open');

        el('dataPostOcrUndoBtn').hidden = true;
        postOcrUndo = null;
    }

    // จำนวน field ที่มี regex (ไม่นับ field ที่เป็นตาราง)
    function patternCountOf(patterns) {
        return Object.keys(patterns || {}).filter(function (field) {
            return settings.types && settings.types[field] === 'table'
                ? false
                : String(patterns[field] || '').trim() !== '';
        }).length;
    }

    // บรรทัดสรุปใต้หัวกล่อง — อัปเดตเมื่อ regex เปลี่ยน (เช่น หลังนำเข้า)
    function updateMeta(patterns) {
        el('dataDialogMeta').textContent = [
            settings.templateName ? 'แม่แบบ: ' + settings.templateName : '',
            (settings.fields || []).length + ' field',
            patternCountOf(patterns) + ' field มี regex'
        ].filter(Boolean).join(' · ');
    }

    // ──────────────────────────────────────────────────────────────
    // รายการ regex ของแต่ละ field (โหมด config)
    // ──────────────────────────────────────────────────────────────

    // field ทุกตัวที่ใช้กลุ่ม (Group) เดียวกัน — เรียงตามลำดับในแม่แบบ
    function fieldsInListGroup(group, fields, types) {
        const groups = settings.listGroups || {};

        return (fields || []).filter(function (field) {
            return (
                types[field] === 'list' &&
                String(groups[field] || '') === group
            );
        });
    }

    function renderPatternList() {
        const list = el('dataPatternList');
        const patterns = settings.patterns || {};
        const fields = settings.fields || [];
        const types = settings.types || {};
        const groups = settings.listGroups || {};
        const columns = scope.DataExtract.listColumns(fields, types, groups);

        list.innerHTML = '';

        if (fields.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'hint';
            empty.textContent = 'ไม่พบ field ในแม่แบบนี้';
            list.appendChild(empty);
            return;
        }

        fields.forEach(function (field) {
            const row = document.createElement('div');
            row.className = 'data-pattern-row';

            const name = document.createElement('span');
            name.className = 'data-pattern-name';
            name.textContent = field;
            name.title = field + ' — ' + typeLabel(types[field]);

            const type = document.createElement('span');
            type.className = 'data-pattern-type';

            if (types[field] === 'list') {
                // list ที่อยู่กลุ่มเดียวกับ field อื่น = แถวเดียวหลายคอลัมน์
                const group = String(groups[field] || '');
                const members = group === ''
                    ? []
                    : fieldsInListGroup(group, fields, types);

                type.textContent = columns[field]
                    ? 'รายการ · คอลัมน์ ' + columns[field] + '/' + members.length
                    : 'รายการ · หลายแถว';
            } else {
                type.textContent = typeLabel(types[field]);
            }

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'data-pattern-input';
            input.dataset.patternField = field;
            input.autocomplete = 'off';
            input.spellcheck = false;
            input.value = patterns[field] || '';

            if (types[field] === 'table') {
                input.placeholder = 'ตารางใช้ regex ไม่ได้';
            } else if (types[field] === 'list') {
                input.placeholder = columns[field]
                    ? 'regex ของ 1 แถว — วงเล็บที่ ' + columns[field] +
                        ' ของ regex = คอลัมน์นี้'
                    : 'regex ของ 1 แถว เช่น ^\\d+\\.\\s*(.+)$';
            } else {
                input.placeholder = 'regex เช่น ' + field + '\\s*[:：]?\\s*([^\\n]+)';
            }

            input.disabled = types[field] === 'table';

            row.appendChild(name);
            row.appendChild(type);
            row.appendChild(input);
            list.appendChild(row);
        });
    }

    function collectPatterns() {
        const patterns = {};
        const list = el('dataPatternList');

        if (!list) return patterns;

        list.querySelectorAll('[data-pattern-field]').forEach(function (input) {
            const field = input.dataset.patternField;
            const value = String(input.value || '').trim();

            if (value !== '' && input.disabled !== true) {
                patterns[field] = value;
            }
        });

        return patterns;
    }

    // ──────────────────────────────────────────────────────────────
    // ข้อความต้นทาง
    // ──────────────────────────────────────────────────────────────

    function sourceText() {
        const textarea = el('dataSourceText');
        return scope.DataExtract.normalizeText(textarea ? textarea.value : '');
    }

    function setSourceStatus(text, kind) {
        const status = el('dataSourceStatus');

        if (!status) return;

        status.textContent = text || '';
        status.className =
            'hint data-source-status' + (kind ? ' ' + kind : '');
    }

    async function readFile(input) {
        const file = input.files && input.files[0];

        // ล้างค่า input เพื่อให้เลือกไฟล์เดิมซ้ำได้
        input.value = '';

        if (!file) return;

        readingFile = true;
        setSourceStatus('กำลังอ่านไฟล์ ' + file.name + '...');

        try {
            const result = await scope.DataExtract.extractFile(file, {
                joinLines: joinLinesEnabled
            });

            // extractFile คืน { text, joined }
            const text = String(
                result && typeof result === 'object'
                    ? result.text || ''
                    : result || ''
            );

            const textarea = el('dataSourceText');

            textarea.value = text;

            // เก็บไฟล์ PDF ไว้ให้ปุ่ม Layout / Reading Order ใช้ต่อ
            lastPdfFile = /\.pdf$/i.test(file.name) ? file : null;
            layoutCache = null;

            hideToolPanels();
            updateToolsState();

            const ocrPages =
                result && Array.isArray(result.ocrPages)
                    ? result.ocrPages
                    : [];

            setSourceStatus(
                'อ่านแล้ว: ' + file.name +
                ' — ' + text.length + ' ตัวอักษร' +
                (result && result.joined
                    ? ' · รวม ' + result.joined + ' บรรทัดที่ถูกตัด'
                    : '') +
                (ocrPages.length > 0
                    ? ' · OCR ' + ocrPages.length + ' หน้า'
                    : '') +
                (result && result.ocrError && text !== ''
                    ? ' · OCR บางหน้าไม่สำเร็จ'
                    : ''),
                result && result.ocrError
                    ? (text === '' ? 'error' : 'warn')
                    : ''
            );

            hideResults();

            // เก็บบรรทัดไว้ให้ผู้ใช้ตรวจ/แก้ในหน้า ฝึก OCR (ใช้เป็น few-shot)
            saveTrainingLines(file.name, text);

            // OCR อ่านไม่ได้และไม่มีข้อความจากชั้นข้อความ = บอกสาเหตุให้ผู้ใช้รู้
            // (ไฟล์ที่มีชั้นข้อความยังใช้ต่อได้ จึงไม่ต้องรบกวนด้วยกล่องข้อความ)
            if (result && result.ocrError && text === '') {
                await scope.AppDialog.alert(
                    'อ่านข้อความจาก PDF ไม่ได้\n\n' +
                    result.ocrError
                );
            }

        } catch (error) {
            console.error(error);

            lastPdfFile = null;
            layoutCache = null;

            hideToolPanels();
            updateToolsState();

            setSourceStatus(
                error && error.expected ? error.message : 'อ่านไฟล์ไม่สำเร็จ',
                'error'
            );

            if (scope.AppDialog) {
                await scope.AppDialog.alert(
                    (error && error.message) || 'อ่านไฟล์ไม่สำเร็จ'
                );
            }

        } finally {
            readingFile = false;
        }
    }

    // ── เก็บข้อความจากช่องวางข้อความ ลงคลังฝึก OCR ──
    //
    // ไฟล์ .pdf/.docx ถูกเก็บตอนอ่านไฟล์แล้ว (ดู readFile) ส่วนข้อความที่ผู้ใช้
    // วาง/พิมพ์เองถูกเก็บที่นี่ — รอให้พิมพ์หยุดสักครู่ หรือตอนปิดกล่อง
    // คู่ "ผิด → ถูก" นี้จะถูกใช้เป็นตัวอย่าง (Vector Few-Shot) ให้ AI ปรับข้อความ
    //
    // ข้อความซ้ำถูกข้ามที่ main process เอง (เทียบไม่สนช่องว่าง/ตัวพิมพ์)
    const PASTE_CAPTURE_DELAY_MS = 1500;

    function schedulePasteCapture() {
        if (pasteCaptureTimer !== null) {
            window.clearTimeout(pasteCaptureTimer);
        }

        pasteCaptureTimer = window.setTimeout(function () {
            pasteCaptureTimer = null;
            capturePastedLines();
        }, PASTE_CAPTURE_DELAY_MS);
    }

    function capturePastedLines() {
        saveTrainingLines('วางข้อความ', sourceText());
    }

    // เก็บบรรทัดลงคลังฝึก OCR (ทำเงียบ ๆ — ไม่ขัดการทำงานหลัก)
    function saveTrainingLines(source, text) {
        if (!window.electronAPI || !window.electronAPI.ocrTrainingAdd) {
            return;
        }

        const lines = String(text == null ? '' : text)
            .split('\n')
            .filter(function (line) {
                return line.trim() !== '';
            });

        if (lines.length === 0) return;

        window.electronAPI.ocrTrainingAdd({
            source: source,
            lines: lines
        }).catch(function () {
            // เก็บไม่ได้ก็ไม่เป็นไร — การอ่านไฟล์ต้องทำงานต่อได้
        });
    }

    // ──────────────────────────────────────────────────────────────
    // เครื่องมือหลัง OCR: ตรวจคำผิด / วิเคราะห์ Layout / จัดลำดับการอ่าน
    // ──────────────────────────────────────────────────────────────

    function hideToolPanels() {
        el('dataSpellPanel').hidden = true;
        el('dataSpellList').innerHTML = '';

        spellQueue = [];
    }

    // เปิด/ปิดปุ่มตามข้อมูลที่มีอยู่ — และปิดระหว่างทำงาน
    function updateToolsState() {
        const textarea = el('dataSourceText');
        const hasText = Boolean(textarea && textarea.value.trim() !== '');

        el('dataPostOcrBtn').disabled = (!hasText && !lastPdfFile) || layoutBusy;
    }

    // ── ตรวจคำผิด (พจนานุกรมในเครื่อง + คำที่เพิ่มเอง) ──

    function updateSpellMeta() {
        const remaining = el('dataSpellList')
            .querySelectorAll('.data-spell-row').length;

        el('dataSpellMeta').textContent = remaining === 0
            ? 'ไม่มีคำค้างให้แก้'
            : 'เหลือ ' + remaining + ' คำ — คลิกคำแนะนำเพื่อแทนที่ทั้งข้อความ';
    }

    function applySpellCorrection(word, replacement, row) {
        const textarea = el('dataSourceText');

        textarea.value = scope.OcrTextTools.replaceWord(
            textarea.value,
            word,
            replacement
        );

        if (row) row.remove();

        hideResults();
        updateSpellMeta();
        updateToolsState();

        setSourceStatus('แก้คำแล้ว: ' + word + ' → ' + replacement);
    }

    function addSpellRow(issue) {
        const row = document.createElement('div');
        row.className = 'data-spell-row';

        const head = document.createElement('div');
        head.className = 'data-spell-head';

        const word = document.createElement('code');
        word.className = 'data-spell-word';
        word.textContent = issue.word;

        const count = document.createElement('span');
        count.className = 'hint';
        count.textContent = issue.count > 1 ? 'พบ ' + issue.count + ' ครั้ง' : '';

        const context = document.createElement('span');
        context.className = 'data-spell-context';
        context.textContent = issue.context;
        context.title = issue.context;

        head.appendChild(word);
        head.appendChild(count);
        head.appendChild(context);

        const actions = document.createElement('div');
        actions.className = 'data-spell-actions';

        if (issue.suggestions.length === 0) {
            const none = document.createElement('span');
            none.className = 'hint';
            none.textContent = 'ไม่พบคำแนะนำ — ';
            actions.appendChild(none);
        }

        issue.suggestions.forEach(function (suggestion) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'plain data-spell-suggest';
            button.textContent = suggestion;
            button.title = 'แทนที่ "' + issue.word + '" ด้วย "' + suggestion + '"';
            button.addEventListener('click', function () {
                applySpellCorrection(issue.word, suggestion, row);
            });

            actions.appendChild(button);
        });

        const manual = document.createElement('button');
        manual.type = 'button';
        manual.className = 'plain';
        manual.textContent = 'แก้เอง';
        manual.addEventListener('click', async function () {
            const value = await scope.AppDialog.prompt(
                'แก้คำ "' + issue.word + '" เป็น:',
                issue.word
            );

            if (value === null) return;

            const replacement = String(value).trim();

            if (replacement === '' || replacement === issue.word) return;

            applySpellCorrection(issue.word, replacement, row);
        });

        const skip = document.createElement('button');
        skip.type = 'button';
        skip.className = 'plain';
        skip.textContent = 'ข้าม';
        skip.addEventListener('click', function () {
            row.remove();
            updateSpellMeta();
        });

        actions.appendChild(manual);
        actions.appendChild(skip);

        row.appendChild(head);
        row.appendChild(actions);

        el('dataSpellList').appendChild(row);

        if (issue.suggestions.length > 0) {
            spellQueue.push({
                word: issue.word,
                replacement: issue.suggestions[0],
                row: row
            });
        }
    }

    function runSpellCheck() {
        const textarea = el('dataSourceText');
        const text = textarea.value;

        el('dataSpellList').innerHTML = '';
        spellQueue = [];

        if (!scope.OcrTextTools) {
            setSourceStatus('ไม่พบตัวตรวจคำ — โหลดหน้าใหม่แล้วลองอีกครั้ง', 'error');
            return;
        }

        const result = scope.OcrTextTools.check(text);

        if (result.unavailable) {
            setSourceStatus(
                'พจนานุกรมยังโหลดไม่เสร็จ — รอสักครู่แล้วลองอีกครั้ง',
                'error'
            );
            return;
        }

        el('dataSpellPanel').hidden = false;

        if (result.issues.length === 0) {
            el('dataSpellMeta').textContent =
                'ตรวจ ' + result.checked + ' คำ — ไม่พบคำที่น่าสงสัย';

            const empty = document.createElement('p');
            empty.className = 'hint';
            empty.textContent = 'ทุกคำที่ตรวจพบอยู่ในพจนานุกรมหรือคำที่เพิ่มเอง';
            el('dataSpellList').appendChild(empty);

            setSourceStatus('ตรวจคำผิดแล้ว — ไม่พบคำที่น่าสงสัย');
            return;
        }

        result.issues.forEach(addSpellRow);

        updateSpellMeta();

        setSourceStatus(
            'ตรวจ ' + result.checked + ' คำ — พบ ' +
            result.issues.length + ' คำที่น่าสงสัย'
        );
    }

    function applyAllSpellSuggestions() {
        const textarea = el('dataSourceText');
        let applied = 0;

        spellQueue.forEach(function (item) {
            if (!item.row.isConnected) return;

            textarea.value = scope.OcrTextTools.replaceWord(
                textarea.value,
                item.word,
                item.replacement
            );

            item.row.remove();
            applied += 1;
        });

        spellQueue = [];

        hideResults();
        updateSpellMeta();
        updateToolsState();

        setSourceStatus(
            applied > 0
                ? 'ใช้คำแนะนำ ' + applied + ' คำแล้ว'
                : 'ไม่มีคำแนะนำให้ใช้ — เลือกคำเองหรือข้าม'
        );
    }

    // ── Layout / Reading order ──

    async function ensureLayoutResult(joinLines) {
        const join = joinLines === true;

        if (
            layoutCache &&
            layoutCache.file === lastPdfFile &&
            layoutCache.joinLines === join
        ) {
            return layoutCache.result;
        }

        const buffer = await lastPdfFile.arrayBuffer();

        const result = await window.electronAPI.analyzePdfLayout({
            data: new Uint8Array(buffer),
            joinLines: join
        });

        if (!result || result.ok === false) {
            throw new Error(
                (result && result.error) || 'วิเคราะห์โครงสร้างเอกสารไม่สำเร็จ'
            );
        }

        layoutCache = {
            file: lastPdfFile,
            joinLines: join,
            result: result
        };

        return result;
    }

    // ── ปุ่มเดียว: ปรับข้อความหลัง OCR ──

    const POST_OCR_ENGINE_LABELS = {
        library: 'ไลบรารีในเครื่อง',
        local: 'Local AI (Qwen2.5-3B)',
        api: 'AI API (Gemini)'
    };

    let postOcrBusy = false;
    let postOcrUndo = null;

    function engineLabel(engine) {
        return POST_OCR_ENGINE_LABELS[engine] || POST_OCR_ENGINE_LABELS.library;
    }

    // อ่าน engine ที่เลือกไว้ในหน้า ตั้งค่า OCR มาแสดงบนปุ่ม
    async function refreshPostOcrEngine() {
        let engine = 'library';

        try {
            const response =
                window.electronAPI && window.electronAPI.ocrGetConfig
                    ? await window.electronAPI.ocrGetConfig()
                    : null;

            const config = response && response.config
                ? response.config
                : response;

            engine = (config && config.postOcr && config.postOcr.engine) || 'library';

        } catch (error) {
            engine = 'library';
        }

        const badge = el('dataPostOcrEngine');

        if (badge) {
            badge.textContent = engineLabel(engine) + ' › ตั้งค่า OCR';
            badge.title = 'เลือกวิธีประมวลผลได้ที่หน้า ตั้งค่า OCR';
        }

        return engine;
    }

    function undoPostOcr() {
        if (postOcrUndo === null) return;

        el('dataSourceText').value = postOcrUndo;
        postOcrUndo = null;

        el('dataPostOcrUndoBtn').hidden = true;

        hideToolPanels();
        hideResults();
        updateToolsState();

        setSourceStatus('ย้อนกลับข้อความก่อนปรับแล้ว');
    }

    async function runPostOcr() {
        if (postOcrBusy) return;

        const textarea = el('dataSourceText');
        const original = textarea.value;
        const hasPdf = Boolean(lastPdfFile);

        if (!hasPdf && original.trim() === '') {
            await scope.AppDialog.alert(
                'วางข้อความหรืออัปโหลดไฟล์ PDF ก่อนใช้ปุ่มนี้'
            );
            return;
        }

        if (hasPdf && (!window.electronAPI || !window.electronAPI.analyzePdfLayout)) {
            await scope.AppDialog.alert(
                'เปิดหน้านี้ในแอป (Electron) เพื่อวิเคราะห์ Layout และจัดลำดับการอ่าน'
            );
            return;
        }

        const engine = await refreshPostOcrEngine();
        const isAi = engine === 'local' || engine === 'api';

        if (isAi && (!window.electronAPI || !window.electronAPI.postOcrProcess)) {
            await scope.AppDialog.alert(
                'เปิดหน้านี้ในแอป (Electron) เพื่อใช้ AI ปรับข้อความ'
            );
            return;
        }

        postOcrBusy = true;
        layoutBusy = true;
        updateToolsState();

        hideToolPanels();
        hideResults();

        if (original.trim() !== '') {
            postOcrUndo = original;
            el('dataPostOcrUndoBtn').hidden = false;
        }

        try {
            let text = original;
            let pageNote = '';

            // 1) วิเคราะห์ Layout + จัดลำดับการอ่าน + รวมบรรทัดที่ถูกตัด
            if (hasPdf) {
                setSourceStatus('กำลังวิเคราะห์ Layout และจัดลำดับการอ่าน...');

                const result = await ensureLayoutResult(joinLinesEnabled);
                const layoutText = String(result.text || '');

                if (layoutText.trim() !== '') {
                    text = layoutText;
                    pageNote = ' · ' + result.pageCount + ' หน้า';
                } else if (text.trim() === '') {
                    throw new Error(
                        'ไม่พบข้อความในเอกสาร — ลอง OCR หรืออัปโหลดไฟล์อื่น'
                    );
                }

                textarea.value = text;
                updateToolsState();
            }

            // 2) ตรวจแก้คำ + แบ่งประโยค
            let stepNote = '';
            let warnings = [];

            if (isAi) {
                setSourceStatus(
                    'กำลังปรับข้อความด้วย ' + engineLabel(engine) + '...'
                );

                const response = await window.electronAPI.postOcrProcess({
                    text: text,
                    engine: engine
                });

                if (!response || response.ok === false) {
                    throw new Error(
                        (response && response.error) ||
                        'ปรับข้อความหลัง OCR ไม่สำเร็จ'
                    );
                }

                text = String(response.text || text);
                warnings = Array.isArray(response.warnings)
                    ? response.warnings
                    : [];

                stepNote = ' · ' + response.chunks + ' ก้อน · ' +
                    response.sentences + ' ประโยค';

            } else {
                // ไลบรารีในเครื่อง: พจนานุกรมบอกได้แค่ว่า "น่าสงสัย" —
                // ให้ผู้ใช้เลือกคำแนะนำเองด้านล่าง (ไม่แก้ให้อัตโนมัติ)
                stepNote = ' · ตรวจคำด้วยพจนานุกรม';
            }

            textarea.value = text;
            updateToolsState();

            // 3) คำที่ยังน่าสงสัย — ให้ผู้ใช้ตรวจเอง (ไม่แก้ให้อัตโนมัติ)
            if (scope.OcrTextTools) {
                const check = scope.OcrTextTools.check(text);

                if (!check.unavailable && check.issues.length > 0) {
                    el('dataSpellPanel').hidden = false;
                    el('dataSpellList').innerHTML = '';
                    spellQueue = [];

                    check.issues.forEach(addSpellRow);
                    updateSpellMeta();
                }
            }

            hideResults();

            setSourceStatus(
                'ปรับข้อความแล้ว (' + engineLabel(engine) + ')' +
                pageNote + stepNote +
                (warnings.length > 0
                    ? ' — ' + warnings.length + ' ก้อนใช้ข้อความเดิม'
                    : '') +
                ' · ' + text.length + ' ตัวอักษร'
            );

        } catch (error) {
            setSourceStatus(
                (error && error.message) || 'ปรับข้อความหลัง OCR ไม่สำเร็จ',
                'error'
            );

        } finally {
            postOcrBusy = false;
            layoutBusy = false;
            updateToolsState();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ทดสอบ / แสดงผล
    // ──────────────────────────────────────────────────────────────

    function hideResults() {
        const body = el('dataResultBody');

        if (body) {
            body.innerHTML = '';

            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = 'กด "ทดสอบ" เพื่อดูว่าแต่ละ field จับค่าอะไรได้';
            body.appendChild(hint);
        }
    }

    function displayValue(value) {
        if (value && typeof value === 'object' && Array.isArray(value.items)) {
            return value.items.length + ' รายการ: ' + value.items.join(' · ');
        }

        return String(value == null ? '' : value);
    }

    function addResultRow(body, field, text, kind) {
        const row = document.createElement('div');
        row.className = 'data-result-row' + (kind ? ' ' + kind : '');

        const name = document.createElement('code');
        name.className = 'data-result-field';
        name.textContent = field;

        const value = document.createElement('span');
        value.className = 'data-result-value';
        value.textContent = text;

        row.appendChild(name);
        row.appendChild(value);
        body.appendChild(row);
    }

    function renderResult(result) {
        const body = el('dataResultBody');

        body.innerHTML = '';

        const summary = document.createElement('p');
        summary.className = 'hint' + (result.errors.length > 0 ? ' error' : '');
        summary.textContent = [
            'จับได้ ' + result.matched.length + ' field',
            'ไม่พบข้อมูล ' + result.unmatched.length + ' field',
            'ยังไม่ได้ตั้ง regex ' + result.missingPattern.length + ' field',
            result.errors.length > 0
                ? 'regex ไม่ถูกต้อง ' + result.errors.length + ' field'
                : ''
        ].filter(Boolean).join(' · ');

        body.appendChild(summary);

        result.matched.forEach(function (item) {
            addResultRow(body, item.field, displayValue(item.value), 'matched');
        });

        result.unmatched.forEach(function (field) {
            addResultRow(body, field, 'ไม่พบข้อมูลที่ตรงกับ regex', 'unmatched');
        });

        result.missingPattern.forEach(function (field) {
            addResultRow(body, field, 'ยังไม่ได้ตั้ง regex', 'missing');
        });

        result.errors.forEach(function (item) {
            addResultRow(
                body,
                item.field,
                'regex ไม่ถูกต้อง: ' + item.message,
                'error'
            );
        });

        result.skipped.forEach(function (item) {
            addResultRow(body, item.field, item.reason, 'skipped');
        });

        return result;
    }

    function currentPatterns() {
        return mode === 'config'
            ? collectPatterns()
            : (settings.patterns || {});
    }

    function runExtraction() {
        const text = sourceText();

        if (text === '') {
            return { empty: true };
        }

        return renderResult(
            scope.DataExtract.apply(
                text,
                settings.fields || [],
                settings.types || {},
                currentPatterns(),
                { listGroups: settings.listGroups || {} }
            )
        );
    }

    async function runTest() {
        if (el('dataSourceText').value.trim() === '') {
            await scope.AppDialog.alert(
                'ยังไม่มีข้อความให้ทดสอบ — วางข้อความ หรืออัปโหลดไฟล์ .docx / .pdf ก่อน'
            );
            return;
        }

        runExtraction();
    }

    async function runFill() {
        if (el('dataSourceText').value.trim() === '') {
            await scope.AppDialog.alert(
                'ยังไม่มีข้อความต้นทาง — วางข้อความ หรืออัปโหลดไฟล์ .docx / .pdf ก่อน'
            );
            return;
        }

        const patterns = currentPatterns();
        const hasPattern = Object.keys(patterns).length > 0;

        if (!hasPattern) {
            await scope.AppDialog.alert(
                'แม่แบบนี้ยังไม่ได้ตั้ง regex ของ field ใดเลย\n' +
                'ไปที่หน้า "ตั้งค่าแม่แบบ" → ปุ่ม "ข้อมูล" ของแม่แบบ แล้วใส่ regex ก่อน'
            );
            return;
        }

        const result = renderResult(
            scope.DataExtract.apply(
                sourceText(),
                settings.fields || [],
                settings.types || {},
                patterns,
                { listGroups: settings.listGroups || {} }
            )
        );

        if (result.matched.length === 0) {
            const reasons = [];

            if (result.unmatched.length > 0) {
                reasons.push(
                    'ข้อความไม่ตรงกับ regex ของ: ' + result.unmatched.join(', ')
                );
            }

            if (result.errors.length > 0) {
                reasons.push(
                    'regex ไม่ถูกต้อง: ' + result.errors.map(function (item) {
                        return item.field;
                    }).join(', ')
                );
            }

            await scope.AppDialog.alert(
                'ไม่พบข้อมูลที่จะเติมลงฟอร์ม\n\n' + reasons.join('\n')
            );
            return;
        }

        if (settings.onFill) {
            settings.onFill(result.values, result);
        }

        close();
    }

    // ──────────────────────────────────────────────────────────────
    // ส่งออก / นำเข้า regex (JSON)
    //
    // ไฟล์ที่ส่งออก = เฉพาะ regex ของแม่แบบนี้ (kind = template-patterns)
    // ตอนนำเข้ารับได้ทั้งไฟล์ regex-only และไฟล์ค่าตั้งทั้งชุด (kind = template-settings)
    // — ใช้เฉพาะชื่อ field ที่แม่แบบนี้มี และข้าม field ที่เป็นตาราง
    // ──────────────────────────────────────────────────────────────

    async function exportPatterns() {
        const button = el('dataSettingsExportBtn');
        const payload = scope.TemplateSettings.buildPatternExport({
            templateName: settings.templateName || '',
            fields: settings.fields || [],
            patterns: collectPatterns()
        });

        const fileName = scope.TemplateSettings.fileNameFor(
            settings.templateName || '',
            '-regex'
        );

        button.disabled = true;

        try {
            const result = await scope.TemplateSettings.save(
                JSON.stringify(payload, null, 2),
                fileName
            );

            if (result && result.ok === false) {
                throw new Error(result.error || 'บันทึกไฟล์ไม่สำเร็จ');
            }

            setSourceStatus(
                'ส่งออก regex แล้ว: ' +
                ((result && result.fileName) || fileName) +
                ' (โฟลเดอร์ Downloads)'
            );

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'ส่งออก regex ไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ')
            );

        } finally {

            button.disabled = false;
        }
    }

    async function importPatternsFromFile(event) {
        const input = event && event.target;
        const file = input && input.files && input.files[0];

        // ล้างค่า input เพื่อให้เลือกไฟล์เดิมซ้ำได้
        if (input) input.value = '';

        if (!file) return;

        try {
            const parsed = scope.TemplateSettings.parse(
                await scope.TemplateSettings.readFile(file)
            );

            if (!parsed.ok) {
                await scope.AppDialog.alert(parsed.error);
                return;
            }

            // ไฟล์ค่าตั้งทั้งชุด (จากหน้าแก้ไข) ก็นำเข้าได้ — เอาเฉพาะ regex
            const source = parsed.settings.patterns || {};
            const fields = settings.fields || [];

            const matched = scope.TemplateSettings.matchFields(
                { patterns: source },
                fields
            );

            if (matched.matched.length === 0) {
                await scope.AppDialog.alert(
                    'ไม่มีชื่อ field ที่ตรงกันเลย\n' +
                    'ไฟล์นี้มี field: ' +
                    (scope.TemplateSettings.fieldNamesIn(parsed.settings)
                        .slice(0, 8)
                        .join(', ') || '-') +
                    (scope.TemplateSettings.fieldNamesIn(parsed.settings).length > 8
                        ? ' …'
                        : '')
                );

                return;
            }

            // ช่องของ field ที่เป็นตารางถูกปิดไว้ (regex ใช้กับตารางไม่ได้)
            const list = el('dataPatternList');
            let applied = 0;

            list.querySelectorAll('[data-pattern-field]').forEach(function (node) {
                const field = node.dataset.patternField;

                if (
                    node.disabled !== true &&
                    Object.prototype.hasOwnProperty.call(source, field)
                ) {
                    node.value = source[field];
                    applied += 1;
                }
            });

            updateMeta(collectPatterns());

            setSourceStatus(
                'นำเข้า regex แล้ว ' + applied + ' field' +
                (matched.skipped.length > 0
                    ? ' · ข้าม ' + matched.skipped.length +
                        ' field ที่ไม่มีในแม่แบบนี้'
                    : '') +
                ' — กด "บันทึก regex" เพื่อเก็บลงแม่แบบ'
            );

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'นำเข้า regex ไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ')
            );
        }
    }

    async function savePatterns() {
        if (!settings.onSavePatterns) {
            return;
        }

        const button = el('dataSavePatternsBtn');

        button.disabled = true;

        try {
            await settings.onSavePatterns(collectPatterns());
            setSourceStatus('บันทึก regex ลงแม่แบบแล้ว');
        } catch (error) {
            console.error(error);

            await scope.AppDialog.alert(
                'บันทึก regex ไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ')
            );
        } finally {
            button.disabled = false;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Open
    // ──────────────────────────────────────────────────────────────

    /**
     * options = {
     *   mode: 'config' | 'report',
     *   title, templateName,
     *   fields: string[],
     *   types: { field: type },
     *   patterns: { field: regex },
     *   onSavePatterns: async (patterns) => {},
     *   onFill: (values, result) => {}
     * }
     */
    function open(options) {
        build();

        settings = options || {};
        mode = settings.mode === 'config'
            ? 'config'
            : (settings.mode === 'source' ? 'source' : 'report');

        const isConfig = mode === 'config';
        const isSource = mode === 'source';

        el('dataDialogTitle').textContent = settings.title || 'ใส่ข้อมูล';

        updateMeta(settings.patterns || {});

        el('dataPatternSection').hidden = !isConfig;
        el('dataTestBtn').hidden = !isConfig;
        el('dataSavePatternsBtn').hidden = !isConfig;
        el('dataFillBtn').hidden = isConfig;

        // ส่งออก/นำเข้า regex มีเฉพาะโหมดแก้ค่าของแม่แบบ (หน้าข้อมูล)
        el('dataSettingsExportBtn').hidden = !isConfig;
        el('dataSettingsImportBtn').hidden = !isConfig;

        // โหมด "แหล่งข้อมูล" = เหลือแค่ช่องวางข้อความ/อัปโหลดไฟล์ + ปุ่มตกลง
        const results = overlay.querySelector('.data-results');
        if (results) results.hidden = isSource;

        el('dataFillBtn').textContent = isSource
            ? 'ตกลง'
            : 'เติมข้อมูลลงฟอร์ม';

        renderPatternList();

        el('dataSourceText').value = '';
        setSourceStatus('');
        hideResults();

        // เริ่มกล่องใหม่ — ต้องอัปโหลด PDF ใหม่ก่อนใช้ Layout
        lastPdfFile = null;
        layoutCache = null;
        layoutBusy = false;
        postOcrUndo = null;

        el('dataPostOcrUndoBtn').hidden = true;

        hideToolPanels();
        updateToolsState();
        refreshPostOcrEngine();

        overlay.classList.add('open');

        const focusTarget = isConfig
            ? overlay.querySelector('[data-pattern-field]')
            : el('dataSourceText');

        if (focusTarget && focusTarget.focus) {
            window.setTimeout(function () {
                focusTarget.focus();
            }, 20);
        }
    }

    scope.DataExtractDialog = {
        open: open,
        close: close
    };
})(window);
