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
        '            <p id="dataSourceStatus" class="hint data-source-status"></p>',
        '            <textarea id="dataSourceText" class="data-source-text" rows="8"',
        '                      placeholder="วางข้อความที่มีข้อมูลอยู่ที่นี่ หรือกดอัปโหลดไฟล์ .docx / .pdf"></textarea>',
        '            <div class="data-tools">',
        '                <button id="dataPrivacyCheckBtn" type="button" class="plain" title="ตรวจว่าคำ/ตัวเลขส่วนไหนจะถูกแทนด้วยตัวแปรก่อนส่งให้ AI — ใช้รายการจากหน้า คำเฉพาะ และไม่ส่งข้อมูลออกไป">ตรวจคำเฉพาะ</button>',
        '                <button id="dataImproveBtn" type="button" title="ตรวจคำผิดและจัดข้อความเป็น “ชื่อฟิลด์: ค่า” ทีละบรรทัด — เลือกใช้ AI หรือ difflib.js ได้ที่หน้า ตั้งค่า OCR">ปรับปรุง</button>',
        '                <button id="dataImproveUndoBtn" type="button" class="plain" hidden>ย้อนกลับ</button>',
        '            </div>',
        '            <p class="hint data-tools-hint">',
        '                ตรวจคำผิดและจัดข้อความใหม่เป็น “ชื่อฟิลด์: ค่า” ทีละบรรทัด ',
        '                — เลือกได้ในหน้า ตั้งค่า OCR ว่าจะใช้ AI (Gemini) หรือ difflib.js (ในเครื่อง)',
        '            </p>',

        // ── ผลการตรวจคำเฉพาะ (ยังไม่ส่งให้ AI) ──
        '            <div id="dataPrivacyResult" class="data-privacy" hidden>',
        '                <div class="data-privacy-head">',
        '                    <strong id="dataPrivacyTitle">คำเฉพาะที่จะถูกปกปิด</strong>',
        '                    <button id="dataPrivacyHideBtn" type="button" class="plain">ซ่อน</button>',
        '                </div>',

        '                <p id="dataPrivacySummary" class="hint"></p>',
        '                <ul id="dataPrivacyList" class="data-privacy-list"></ul>',

        '                <p class="hint data-privacy-label">ข้อความที่ AI จะเห็น (ค่าจริงถูกแทนด้วยตัวแปร)</p>',
        '                <pre id="dataPrivacyMasked" class="data-privacy-masked"></pre>',

        '                <p id="dataPrivacyNote" class="hint data-privacy-note"></p>',
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

    // รวมบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่เมื่ออ่าน PDF — ทำทุกครั้ง
    // (เดิมมีสวิตช์ให้เลือกในกล่องนี้)
    const JOIN_LINES = true;

    let overlay = null;
    let settings = null;   // ค่าที่ส่งมาตอน open
    let mode = 'report';

    // กำลังอ่านไฟล์อยู่หรือไม่ — ใช้ตัดสินว่าจะแสดงความคืบหน้าหรือไม่
    let readingFile = false;

    // ตัวจับเวลาเก็บข้อความที่วาง/พิมพ์เอง (กันเก็บทุกครั้งที่มีการพิมพ์)
    let pasteCaptureTimer = null;

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

        // ── ปรับปรุงข้อความด้วย AI (Gemini) ──
        el('dataImproveBtn').addEventListener('click', runImprove);
        el('dataImproveUndoBtn').addEventListener('click', undoImprove);

        // ── ตรวจคำเฉพาะก่อนส่ง (ไม่เรียก AI) ──
        el('dataPrivacyCheckBtn').addEventListener('click', runPrivacyCheck);
        el('dataPrivacyHideBtn').addEventListener('click', hidePrivacyResult);

        el('dataSourceText').addEventListener('input', updateImproveState);

        // ความคืบหน้าเมื่อข้อความยาวและถูกแบ่งเป็นก้อน
        if (window.electronAPI && window.electronAPI.onImproveProgress) {
            window.electronAPI.onImproveProgress(function (progress) {
                if (!improveBusy || !progress) return;

                setSourceStatus(
                    'กำลังปรับปรุงข้อความด้วย AI ก้อนที่ ' +
                    progress.index + '/' + progress.total + '...'
                );
            });
        }

        // ข้อความที่วาง/พิมพ์เอง (ไม่ใช่ไฟล์) เก็บลงคลังฝึก OCR ด้วย — ดู capturePastedLines
        el('dataSourceText').addEventListener('input', schedulePasteCapture);

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

        el('dataImproveUndoBtn').hidden = true;
        improveUndo = null;

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

    // ฟิลด์ที่ส่งไปให้ AI ใช้เป็น key — แนบชนิดและข้อความตัวอย่างไปด้วย
    // (AI จะได้รู้ว่าแต่ละฟิลด์เป็นข้อมูลแบบไหน และตัวอย่างหน้าตาอย่างไร)
    function improveFields() {
        const types = settings.types || {};
        const placeholders = settings.placeholders || {};

        return (settings.fields || []).map(function (field) {
            return {
                name: field,
                type: types[field] || '',
                placeholder: placeholders[field] || ''
            };
        });
    }

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
                joinLines: JOIN_LINES
            });

            // extractFile คืน { text, joined }
            const text = String(
                result && typeof result === 'object'
                    ? result.text || ''
                    : result || ''
            );

            const textarea = el('dataSourceText');

            textarea.value = text;

            // ข้อความชุดใหม่ — ย้อนกลับไปชุดก่อนหน้าไม่ได้แล้ว
            improveUndo = null;
            el('dataImproveUndoBtn').hidden = true;

            updateImproveState();

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
    // ปรับปรุงข้อความด้วย AI: ตรวจคำผิด + จัดเป็น Key-Value
    // ──────────────────────────────────────────────────────────────

    let improveBusy = false;
    let improveUndo = null;

    // กำลังตรวจคำเฉพาะอยู่หรือไม่ (ปุ่มตรวจแยกจากปุ่มปรับปรุง)
    let privacyBusy = false;

    // เปิด/ปิดปุ่มตามข้อมูลที่มีอยู่ — และปิดระหว่างทำงาน
    function updateImproveState() {
        const textarea = el('dataSourceText');
        const hasText = Boolean(textarea && textarea.value.trim() !== '');

        el('dataImproveBtn').disabled = !hasText || improveBusy;

        updatePrivacyState();

        // ข้อความเปลี่ยน = ผลตรวจคำเฉพาะเดิมไม่จริงแล้ว
        hidePrivacyResult();
    }

    // เปิด/ปิดปุ่ม "ตรวจคำเฉพาะ" ตามข้อความที่มีอยู่
    function updatePrivacyState() {
        const textarea = el('dataSourceText');
        const hasText = Boolean(textarea && textarea.value.trim() !== '');
        const button = el('dataPrivacyCheckBtn');

        if (button) {
            button.disabled = !hasText || privacyBusy || improveBusy;
        }
    }

    function undoImprove() {
        if (improveUndo === null) return;

        el('dataSourceText').value = improveUndo;
        improveUndo = null;

        el('dataImproveUndoBtn').hidden = true;

        hideResults();
        updateImproveState();

        setSourceStatus('ย้อนกลับข้อความก่อนปรับปรุงแล้ว');
    }

    // วิธีปรับปรุงที่เลือกไว้ในหน้า ตั้งค่า OCR + ว่ามี key ของ Gemini แล้วหรือยัง
    // (key จริงอยู่ใน main process)
    async function improveConfig() {
        try {
            const response =
                window.electronAPI && window.electronAPI.ocrGetConfig
                    ? await window.electronAPI.ocrGetConfig()
                    : null;

            const config = response && response.config
                ? response.config
                : response;

            return {
                engine: config && config.improve && config.improve.engine === 'difflib'
                    ? 'difflib'
                    : 'ai',
                hasKey: Boolean(config && config.gemini && config.gemini.hasKey)
            };

        } catch (error) {
            // ตรวจไม่ได้ = ปล่อยให้ main process เป็นผู้แจ้ง error
            return { engine: 'ai', hasKey: true };
        }
    }

    // ส่งข้อความให้ Gemini ตรวจคำผิดและจัดเป็น "ชื่อฟิลด์: ค่า" ทีละบรรทัด
    async function runImprove() {
        if (improveBusy) return;

        const textarea = el('dataSourceText');
        const original = textarea.value;

        if (original.trim() === '') {
            await scope.AppDialog.alert(
                'วางข้อความหรืออัปโหลดไฟล์ .pdf / .docx ก่อนใช้ปุ่มนี้'
            );
            return;
        }

        if (!window.electronAPI || !window.electronAPI.ocrImproveText) {
            await scope.AppDialog.alert(
                'เปิดหน้านี้ในแอป (Electron) เพื่อใช้ปรับปรุงข้อความ'
            );
            return;
        }

        // ล็อกปุ่มทันที — การตรวจ API key เป็น async ผู้ใช้จึงกดซ้ำระหว่างรอไม่ได้
        improveBusy = true;
        updateImproveState();
        hideResults();

        try {
            const improve = await improveConfig();

            if (improve.engine === 'ai' && !improve.hasKey) {
                await scope.AppDialog.alert(
                    'ยังไม่ได้ใส่ API key ของ Gemini\n\n' +
                    'ไปที่ ตั้งค่า OCR › Gemini API แล้วบันทึก key ก่อน ' +
                    'หรือเลือกวิธีปรับปรุงเป็น difflib.js (ในเครื่อง)'
                );
                return;
            }

            setSourceStatus(
                improve.engine === 'difflib'
                    ? 'กำลังปรับปรุงข้อความด้วย difflib.js...'
                    : 'กำลังให้ AI ตรวจคำผิดและจัดเป็น key-value...'
            );

            const response = await window.electronAPI.ocrImproveText({
                text: original,
                // ฟิลด์ของแม่แบบ (ชื่อ + ชนิด + ตัวอย่าง) — main process แนบไปใน prompt
                // ตามสวิตช์ "ส่งชื่อฟิลด์ไปใน prompt" ในหน้า ตั้งค่าแม่แบบ
                fields: improveFields()
            });

            if (!response || response.ok === false) {
                throw new Error(
                    (response && response.error) || 'ปรับปรุงข้อความไม่สำเร็จ'
                );
            }

            const improved = String(response.text || '');

            if (improved.trim() === '') {
                throw new Error(
                    improve.engine === 'difflib'
                        ? 'difflib.js ไม่ได้ส่งข้อความกลับมา'
                        : 'AI ไม่ได้ส่งข้อความกลับมา'
                );
            }

            improveUndo = original;
            el('dataImproveUndoBtn').hidden = false;

            textarea.value = improved;
            updateImproveState();

            hideResults();

            if (improve.engine === 'difflib') {
                // ไม่มีข้อมูลออกนอกเครื่อง จึงไม่มีคำเฉพาะที่ถูกปกปิด
                hidePrivacyResult();

                setSourceStatus(
                    'ปรับปรุงด้วย difflib.js แล้ว · ' +
                    improved.split('\n').length + ' บรรทัด' +
                    (Number(response.changed) > 0
                        ? ' · แก้คำ ' + response.changed + ' คำ'
                        : ' · ไม่พบคำที่ต้องแก้')
                );

                return;
            }

            // แสดงว่าข้อมูลชุดนี้ถูกปกปิดอะไรก่อนส่งจริง (ตรวจจนจบขั้นตอน)
            renderPrivacyResult({
                text: response.textMasked,
                count: response.textCount,
                contextCount: response.contextCount,
                items: response.items,
                unmatched: response.unmatched,
                leftover: response.leftover,
                errors: [],
                enabled: response.enabled,
                total: response.total
            }, 'sent');

            setSourceStatus(
                'ปรับปรุงแล้ว · ' + improved.split('\n').length + ' บรรทัด' +
                ' · ' + (response.model || 'Gemini') +
                (Number(response.chunks) > 1
                    ? ' · ' + response.chunks + ' ก้อน'
                    : '') +
                // token ที่ใช้ในรอบนี้ (สะสมแยกตาม key อยู่ที่หน้า ตั้งค่า OCR)
                (response.usage &&
                    (Number(response.usage.input) > 0 || Number(response.usage.output) > 0)
                    ? ' · token เข้า ' +
                        Number(response.usage.input || 0).toLocaleString('th-TH') +
                        ' / ออก ' +
                        Number(response.usage.output || 0).toLocaleString('th-TH')
                    : '') +
                // คำเฉพาะที่ถูกแทนด้วยตัวแปรก่อนส่ง (ดูหน้า "คำเฉพาะ")
                (Number(response.masked) > 0
                    ? ' · ปกปิดคำเฉพาะ ' + response.masked + ' จุด'
                    : '') +
                // ตัวแปรที่ AI ไม่ได้คัดลอกกลับมา = ค่านั้นกู้คืนไม่ได้ ต้องเตือน
                (Array.isArray(response.leftover) && response.leftover.length > 0
                    ? ' · แทนค่าคืนไม่ได้ ' + response.leftover.length +
                        ' ตัวแปร: ' + response.leftover.join(' ')
                    : ''),
                Array.isArray(response.leftover) && response.leftover.length > 0
                    ? 'error'
                    : ''
            );

        } catch (error) {
            setSourceStatus(
                (error && error.message) || 'ปรับปรุงข้อความไม่สำเร็จ',
                'error'
            );

        } finally {
            improveBusy = false;
            updateImproveState();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ตรวจคำเฉพาะ (ก่อนกดปรับปรุง)
    //
    // ใช้รายการจากหน้า "คำเฉพาะ" สแกนข้อความในช่อง + ข้อมูลอ้างอิงจาก
    // ฐานข้อมูล แล้วแสดงว่าอะไรจะถูกแทนด้วยตัวแปร — ไม่เรียก AI
    // (ตัวเลข/คำที่ควรถูกปกปิดแต่ไม่ขึ้นในรายการ = pattern ยังไม่ครอบคลุม)
    // ──────────────────────────────────────────────────────────────

    function hidePrivacyResult() {
        const panel = el('dataPrivacyResult');

        if (panel) {
            panel.hidden = true;
        }
    }

    // mode = 'check' (ตรวจก่อนส่ง) หรือ 'sent' (สรุปของรอบที่ส่งไปแล้ว)
    function renderPrivacyResult(result, mode) {
        const panel = el('dataPrivacyResult');
        const title = el('dataPrivacyTitle');
        const summary = el('dataPrivacySummary');
        const list = el('dataPrivacyList');
        const masked = el('dataPrivacyMasked');
        const note = el('dataPrivacyNote');

        if (!panel) return;

        const items = Array.isArray(result.items) ? result.items : [];
        const unmatched = Array.isArray(result.unmatched) ? result.unmatched : [];
        const errors = Array.isArray(result.errors) ? result.errors : [];
        const count = Number(result.count) || 0;
        const contextCount = Number(result.contextCount) || 0;
        const enabled = Number(result.enabled) || 0;
        const total = Number(result.total) || 0;
        const leftover = Array.isArray(result.leftover) ? result.leftover : [];
        const sent = mode === 'sent';

        panel.hidden = false;

        if (title) {
            title.textContent = sent
                ? 'คำเฉพาะที่ถูกปกปิด (รอบที่ส่งล่าสุด)'
                : 'คำเฉพาะที่จะถูกปกปิด';
        }

        // 0 รายการที่เปิดใช้ = ส่งออกทั้งดุ้น — อธิบายให้ชัด จะได้ไม่คิดว่าปุ่มเสีย
        if (enabled === 0) {
            summary.textContent =
                'ยังไม่มีรายการที่เปิดใช้ในหน้า "คำเฉพาะ" — ' +
                'ข้อความนี้ไม่ได้ถูกปกปิด';

        } else if (count === 0) {
            summary.textContent =
                'ไม่พบค่าที่ตรงกับรายการที่เปิดใช้ (' + enabled + '/' + total +
                ' รายการ) ในข้อความนี้';

        } else {
            summary.textContent =
                (sent ? 'ปกปิดไป ' : 'จะปกปิด ') + count + ' จุด (' + items.length +
                ' ตัวแปร)' +
                (contextCount > 0
                    ? ' · ในข้อมูลอ้างอิงอีก ' + contextCount + ' จุด'
                    : '');
        }

        list.innerHTML = '';

        items.forEach(function (item) {
            const row = document.createElement('li');

            const variable = document.createElement('code');
            variable.textContent = String(item.placeholder || '');

            const value = document.createElement('span');
            value.textContent = String(item.value == null ? '' : item.value);

            row.appendChild(variable);
            row.appendChild(value);
            list.appendChild(row);
        });

        if (masked) {
            masked.textContent = String(result.text || '');
        }

        note.textContent = [
            enabled === 0
                ? 'เปิดสวิตช์รายการที่ต้องการที่หน้า "คำเฉพาะ" ก่อน แล้วตรวจซ้ำ'
                : '',
            enabled > 0 && count === 0
                ? 'ถ้าคิดว่ามีคำที่ควรถูกปกปิดแต่ไม่ขึ้นที่นี่ ให้เพิ่ม/แก้ pattern ' +
                    'ในหน้า "คำเฉพาะ" (และเปิดสวิตช์รายการนั้นด้วย) แล้วตรวจซ้ำ'
                : '',
            unmatched.length > 0
                ? 'เปิดใช้แต่ไม่พบในข้อความนี้: ' + unmatched.join(', ')
                : '',
            leftover.length > 0
                ? 'AI ไม่ได้คืนค่ามา (แทนคืนไม่ได้): ' + leftover.join(' ')
                : '',
            errors.length > 0
                ? 'pattern ที่ใช้ไม่ได้: ' + errors.map(function (item) {
                    return item.name + ' (' + item.error + ')';
                }).join(', ')
                : ''
        ].filter(Boolean).join(' · ');

        note.className =
            'hint data-privacy-note' +
            (errors.length > 0 || leftover.length > 0 ? ' error' : '');
    }

    async function runPrivacyCheck() {
        if (privacyBusy) return;

        const textarea = el('dataSourceText');
        const text = textarea ? textarea.value : '';

        if (text.trim() === '') {
            await scope.AppDialog.alert(
                'วางข้อความหรืออัปโหลดไฟล์ .pdf / .docx ก่อนตรวจคำเฉพาะ'
            );
            return;
        }

        if (!window.electronAPI || !window.electronAPI.privacyInspect) {
            await scope.AppDialog.alert(
                'เปิดหน้านี้ในแอป (Electron) เพื่อตรวจคำเฉพาะ'
            );
            return;
        }

        privacyBusy = true;
        updatePrivacyState();

        setSourceStatus('กำลังตรวจคำเฉพาะ...');

        try {
            const response = await window.electronAPI.privacyInspect({
                text: text
            });

            if (!response || response.ok === false) {
                throw new Error(
                    (response && response.error) || 'ตรวจคำเฉพาะไม่สำเร็จ'
                );
            }

            renderPrivacyResult(response.result || {});

            setSourceStatus(
                'ตรวจคำเฉพาะแล้ว — ยังไม่ส่งข้อมูลออกไป (กด "ปรับปรุง" เมื่อพร้อม)'
            );

        } catch (error) {
            hidePrivacyResult();

            setSourceStatus(
                (error && error.message) || 'ตรวจคำเฉพาะไม่สำเร็จ',
                'error'
            );

        } finally {
            privacyBusy = false;
            updatePrivacyState();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ทดสอบ / แสดงผล
    // ──────────────────────────────────────────────────────────────

    function hideResults() {
        // ผลตรวจคำเฉพาะเป็นของข้อความชุดเดิม — ล้างพร้อมผลจับข้อมูล
        hidePrivacyResult();

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
     *   placeholders: { field: ข้อความตัวอย่าง },
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

        improveUndo = null;
        el('dataImproveUndoBtn').hidden = true;

        updateImproveState();
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
