// Report Page Component - เลือก template ที่บันทึกไว้ แล้วกรอกค่าตาม type
(function (scope) {
    'use strict';

    // ไฮไลต์ตัวแปรเป็นสีเหลือง (หน้ารายงาน)
    //
    // ติ๊ก = ตอนกด Download DOCX ข้อความที่ถูกแทนที่ค่าในไฟล์ผลลัพธ์
    //        จะมี w:highlight สีเหลือง (สีพื้นหลังตัวอักษรตามที่ Word อ่าน)
    // ไม่ติ๊ก = ไม่ใส่ highlight เลย
    // ──────────────────────────────────────────────────────────────
    const HIGHLIGHT_TOGGLE_ID = 'highlightFieldToggle';

    const HIGHLIGHT_HTML = '\r\n' + [
        '<section class="master-tools">',
        '    <h2>เครื่องมือ</h2>',
        '<div class="form-actions">',
        '<label class="field-highlight-toggle" for="highlightFieldToggle">',
        '    <input type="checkbox" id="highlightFieldToggle">',
        '    ไฮไลต์ตัวแปรเป็นสีเหลือง',
        '</label>',
        // ตรวจคำไทยที่น่าสงสัยในค่าที่กรอก (พจนานุกรมในเครื่อง)
        '<button id="reportSpellBtn" type="button" class="plain">' +
        'ตรวจคำที่น่าสงสัย</button>' +
        '<button id="reportExportBtn" type="button" class="plain" style="display:none">' +
        'ดาวน์โหลด Excel</button>' +
        '<button id="reportImportBtn" type="button" class="plain" style="display:none">' +
        'อัปโหลด Excel</button>' +
        // วางข้อความ/อัปโหลด .docx/.pdf แล้วจับค่าด้วย regex ของแม่แบบ เติมลงฟอร์มอัตโนมัติ
        '<button id="reportDataSourceBtn" type="button" class="plain" style="display:none">' +
        'แหล่งข้อมูล</button>' +
        '<input type="file" id="reportImportInput" accept=".xlsx" hidden>',
        '</div>',
        '</section>'
    ].join('\r\n');

    // เตือนเมื่อล็อกตำแหน่งไม่สมบูรณ์ เช่น ช่องว่างด้านหน้า field ไม่พอให้ลบ
    // ต่อด้วยบรรทัดผลการบันทึกไฟล์ (ดาวน์โหลดแล้ว: <ชื่อไฟล์>)
    // เพราะการดาวน์โหลดไม่เปิดกล่อง Save อีก จึงต้องบอกชื่อไฟล์ที่ได้จริง
    // (พร้อมเลข (1) ถ้าชื่อซ้ำ) ให้เห็นบนหน้านี้
    // แถบเลื่อนดูชุดข้อมูลที่นำเข้าจาก Excel (แสดงเมื่อมีมากกว่า 1 แถวเท่านั้น)
    // 1 แถว = 1 ชุดค่า = 1 ไฟล์ .docx ตอนกด Download
    const ROWS_HTML = [
        '<div class="report-rows" id="reportRows" style="display:none">',
        '    <button id="reportRowPrevBtn" type="button" class="plain"',
        '            aria-label="แถวก่อนหน้า">← ก่อนหน้า</button>',
        '    <span id="reportRowLabel" class="report-rows-label"></span>',
        '    <button id="reportRowNextBtn" type="button" class="plain"',
        '            aria-label="แถวถัดไป">ถัดไป →</button>',
        '</div>'
    ].join('\n');

    // ผลตรวจคำที่น่าสงสัยของค่าที่กรอกในฟอร์ม (ปุ่ม "ตรวจคำที่น่าสงสัย" บนแถบเครื่องมือ)
    // ใช้สไตล์ร่วมกับแผงตรวจคำผิดของกล่อง "ใส่ข้อมูล" (.data-tool-panel / .data-spell-*)
    const SPELL_HTML = [
        '<div id="reportSpellPanel" class="data-tool-panel" hidden>',
        '    <div class="data-tool-head">',
        '        <strong>คำที่น่าสงสัย</strong>',
        '        <span id="reportSpellMeta" class="hint"></span>',
        '        <div class="data-tool-actions">',
        '            <button id="reportSpellApplyAll" type="button" class="plain">ใช้คำแนะนำทั้งหมด</button>',
        '            <button id="reportSpellClose" type="button" class="plain">ปิด</button>',
        '        </div>',
        '    </div>',
        '    <div id="reportSpellList" class="data-tool-list"></div>',
        '</div>'
    ].join('\n');

    const FOOTER_HTML =
        ROWS_HTML +
        SPELL_HTML +
        '<p id="replaceWarning" class="replace-warning" style="display:none"></p>' +
        '<p id="downloadStatus" class="db-status" style="display:none"></p>';

    // ปุ่มดูตัวอย่างก่อนดาวน์โหลด + นำเข้า/ส่งออก Excel (แสดงเฉพาะเมื่อโหลด template แล้ว
    // — ดู showPreviewButton / showExcelButtons)
    const ACTIONS_HTML =
        '<button id="reportDataBtn" type="button" class="plain" style="display:none">' +
        'ใส่ข้อมูล</button>' +
        '<button id="previewBtn" type="button" class="plain" style="display:none">' +
        'ดูตัวอย่างก่อนดาวน์โหลด</button>';

    const META_HTML = [
        '<div class="template-meta"  style="padding-top:14px">',
        '    <label for="templateSelect">Template ที่จะใช้</label>',
        '    <select id="templateSelect">',
        '        <option value="">กำลังโหลดรายการ template...</option>',
        '    </select>',
        '</div>'
    ].join('\n');

    // type ของแต่ละ field ถูกตั้งค่าไว้ที่หน้า Template Configuration
    function getConfiguredTypes() {
        return (scope.App && scope.App.getFieldTypes) ? scope.App.getFieldTypes() : {};
    }

    // placeholder (ข้อความตัวอย่าง) ของแต่ละ field — ตั้งไว้ที่หน้า Template Configuration
    function getConfiguredPlaceholders() {
        return (scope.App && scope.App.getFieldPlaceholders) ? scope.App.getFieldPlaceholders() : {};
    }

    // ชื่อกลุ่ม (Group) ของ type List — ตั้งไว้ที่หน้า Template Configuration
    // list ที่ใช้ชื่อกลุ่มเดียวกัน = แถวเดียวกัน (คอลัมน์ละ field, แชร์จำนวนแถว)
    function getConfiguredListGroups() {
        return (scope.App && scope.App.getListGroups) ? scope.App.getListGroups() : {};
    }

    // ความยาวสูงสุดต่อบรรทัดของ type List — ตั้งไว้ที่หน้า Template Configuration
    // 0/ไม่มีค่า = ไม่จำกัด
    function getConfiguredListLimits() {
        return (scope.App && scope.App.getListLimits) ? scope.App.getListLimits() : {};
    }

    // โหมด "ตัวเลข/ตัวหนังสือ" ปัจจุบันของช่อง currency ทุกช่อง (เก็บไว้ที่ FieldTypes)
    function getCurrencyModes() {
        const modes = {};
        const form = document.getElementById('form');
        if (!form) return modes;

        form.querySelectorAll('[data-currency-toggle]').forEach(function (button) {
            modes[button.dataset.currencyToggle] = scope.FieldTypes.getCurrencyMode(button.dataset.currencyToggle);
        });
        return modes;
    }

    const page = scope.FormPage.create({
        title: 'รายงาน',
        showFileInput: false,
        // รวมปุ่ม ดูตัวอย่าง / Download DOCX / Clear ไว้แถวเดียวกันใต้ฟอร์ม
        actionsRow: true,
        metaHTML: HIGHLIGHT_HTML + META_HTML,
        // metaHTML: META_HTML + ,
        actionsHTML: ACTIONS_HTML,
        footerHTML: FOOTER_HTML,
        emptyMessage: 'ยังไม่มี template — เลือกจาก dropdown ด้านบน หรือไปสร้างแม่แบบที่หน้า "ตั้งค่าแม่แบบ" ก่อน',

        // ช่องที่เป็น type text จะมีปุ่มแว่นขยายให้เลือกค่าจาก Master Data
        renderControl: function (field) {
            // ตาราง: วาดเป็นตารางเพิ่ม/ลบแถวได้ (โครงมาจากหน้า Template Configuration)
            if (getConfiguredTypes()[field] === 'table') {
                return createTable(field);
            }

            // รายการ: หลายแถว ข้อความเดียวต่อแถว (เพิ่ม/ลบได้)
            if (getConfiguredTypes()[field] === 'list') {
                return createList(field);
            }

            return scope.FieldTypes.createFieldControl(
                getConfiguredTypes()[field],
                field,
                {
                    lookup: true,
                    // ข้อความตัวอย่างที่ตั้งไว้ในหน้า config (ถ้ามี)
                    placeholder: getConfiguredPlaceholders()[field]
                }
            );
        }
    });

    // ปุ่มดูตัวอย่างไม่ใช้กลไกของ FormPage (ที่มีแต่ download/clear)
    // app.js จึงเรียกเฉพาะเมื่อ component มีเมธอดนี้ (ดู fillForm)
    // ──────────────────────────────────────────────────────────────
    // ไฮไลต์ตัวแปรเป็นสีเหลือง — คุมสวิตช์บนหน้ารายงาน
    //
    // หน้าถูกวาดใหม่ทั้งหมดทุกครั้งที่สลับหน้า (mainEl.innerHTML = ...)
    // จึงต้องจำสถานะสวิตช์ไว้ในตัวแปร แล้วคืนกลับทุกครั้งที่วาดฟอร์ม
    // ──────────────────────────────────────────────────────────────
    let highlightOn = false;

    function syncHighlightToggle() {
        const toggle = document.getElementById(HIGHLIGHT_TOGGLE_ID);

        if (toggle) toggle.checked = highlightOn;
    }

    // event ระดับ document — เพราะกล่องสวิตช์ถูกสร้างใหม่ทุกครั้งที่เปิดหน้า
    function onHighlightEvent(event) {
        const target = event.target;

        if (target && target.id === HIGHLIGHT_TOGGLE_ID) {
            highlightOn = !!target.checked;
        }
    }

    document.addEventListener('change', onHighlightEvent);

    // ค่าไว้ให้ app.js ใช้ตอนสร้างไฟล์ .docx (ดู fieldHighlightOn ใน app.js)
    page.getFieldHighlight = function () {
        return highlightOn;
    };

    // ──────────────────────────────────────────────────────────────
    // จัดวาง field ในหน้ารายงาน
    //
    // list ที่ใช้กลุ่มเดียวกัน = อยู่ "แถวเดียวกัน" (คอลัมน์ละ field)
    // จึงรวมสมาชิกเป็นบล็อกเดียว ณ ตำแหน่งแรกที่พบ แล้วข้ามตัวที่เหลือ
    // กลุ่มที่มีสมาชิกตัวเดียว / list ที่ไม่มีกลุ่ม = แถวของตัวเองเหมือนเดิม
    function reportLayout(fields) {
        const types = getConfiguredTypes();
        const groups = getConfiguredListGroups();

        // สมาชิกของแต่ละกลุ่ม เรียงตามลำดับที่พบในเอกสาร
        const members = {};

        fields.forEach(function (field) {
            if (types[field] !== 'list') return;

            const group = groups[field] || '';
            if (!group) return;

            if (!members[group]) members[group] = [];
            members[group].push(field);
        });

        const placed = {};
        const layout = [];

        fields.forEach(function (field) {
            const group = types[field] === 'list'
                ? (groups[field] || '')
                : '';

            const list = group ? members[group] : null;

            if (!list || list.length < 2) {
                layout.push({ field: field });
                return;
            }

            if (placed[group]) return;

            placed[group] = true;
            layout.push({ group: group, members: list });
        });

        return layout;
    }

    // วาดฟอร์มใหม่ = DOM ถูกแทนที่ทั้งหมด → คืนสถานะสวิตช์
    const baseRenderForm = page.renderForm;
    page.renderForm = function (fields) {
        const layout = reportLayout(fields || []);

        // วาดด้วย field ตัวแรกของแต่ละรายการ (กลุ่ม = สมาชิกตัวแรกเป็นตัวแทน)
        baseRenderForm.call(
            page,
            layout.map(function (entry) {
                return entry.group ? entry.members[0] : entry.field;
            })
        );

        // แทน widget ของตัวแทนด้วยบล็อกคอลัมน์ของกลุ่ม
        // พร้อมเปลี่ยนหัวข้อของรายการนั้นเป็นชื่อกลุ่ม
        layout.forEach(function (entry) {
            if (!entry.group) return;

            const single = findSingleListWidget(entry.members[0]);

            if (!single || !single.parentNode) return;

            const wrapper = single.parentNode;
            const label = wrapper.querySelector('label');

            if (label) label.textContent = 'กลุ่ม: ' + entry.group;

            wrapper.replaceChild(
                createListGroupBlock(entry.group),
                single
            );
        });

        syncHighlightToggle();
        syncRowsBar();
        // ฟอร์มถูกวาดใหม่ = ช่องกรอกชุดใหม่ → แถวผลตรวจเดิมใช้ไม่ได้แล้ว
        hideSpellPanel();
    };

    const baseShowEmptyState = page.showEmptyState;
    page.showEmptyState = function () {
        baseShowEmptyState.call(page);
        syncHighlightToggle();
        syncRowsBar();
        hideSpellPanel();
    };

    page.showPreviewButton = function (show) {
        const btn = document.getElementById('previewBtn');
        if (btn) btn.style.display = show ? 'block' : 'none';
    };

    // ปุ่ม "ใส่ข้อมูล" (วางข้อความ/อัปโหลด .docx/.pdf แล้วจับค่าด้วย regex)
    page.showDataButton = function (show) {
        const btn = document.getElementById('reportDataBtn');
        if (btn) btn.style.display = show ? 'block' : 'none';
    };

    page.showExcelButtons = function (show) {
        ['reportExportBtn', 'reportImportBtn', 'reportDataSourceBtn'].forEach(function (id) {
            const btn = document.getElementById(id);
            if (btn) btn.style.display = show ? 'block' : 'none';
        });
    };

    // ──────────────────────────────────────────────────────────────
    // ชุดข้อมูลที่นำเข้าจาก Excel
    //
    // ผู้ใช้อาจกรอกหลายแถวในไฟล์ Excel แล้วอัปโหลดกลับ — แต่ละแถวคือ "หนึ่งชุดค่า"
    // ซึ่งจะกลายเป็นไฟล์ .docx หนึ่งไฟล์ตอนกด Download
    //
    // เก็บเป็นค่าดิบ (แบบเดียวกับประวัติ) จึงเติมกลับเข้าฟอร์มได้เสมอ
    // ค่าที่แก้ในฟอร์มถูกเก็บกลับเข้าแถวเดิมก่อนทุกครั้งที่เปลี่ยนแถว/ดาวน์โหลด
    // ──────────────────────────────────────────────────────────────
    let importedRows = [];
    let importedIndex = 0;

    function syncRowsBar() {
        const bar = document.getElementById('reportRows');
        const label = document.getElementById('reportRowLabel');

        if (!bar) return;

        // แถวเดียว = ไม่ต้องมีแถบเลื่อน (ไม่รบกวนหน้าตาเดิม)
        bar.style.display = importedRows.length > 1 ? '' : 'none';

        if (label) {
            label.textContent =
                'แถวที่ ' + (importedIndex + 1) + ' จาก ' + importedRows.length;
        }
    }

    // แถวที่นำเข้าตอนนี้ (ค่าดิบ) — [] = ยังไม่ได้นำเข้า Excel
    page.getImportedRows = function () {
        return importedRows;
    };

    page.getImportedIndex = function () {
        return importedIndex;
    };

    // รับชุดข้อมูลที่นำเข้าจาก Excel แล้วแสดงแถวแรกในฟอร์มให้ตรวจก่อนดาวน์โหลด
    page.setImportedRows = function (rows) {
        importedRows = (Array.isArray(rows) ? rows : []).map(function (row) {
            return Object.assign({}, row);
        });
        importedIndex = 0;

        if (importedRows.length > 0) {
            page.applyValues(importedRows[0]);
        }

        syncRowsBar();
    };

    // ล้างชุดข้อมูลที่นำเข้า (เปลี่ยน template / ล้างค่า)
    page.clearImportedRows = function () {
        importedRows = [];
        importedIndex = 0;
        syncRowsBar();
    };

    // เก็บค่าที่แก้อยู่ในฟอร์มกลับเข้าแถวปัจจุบัน (เรียกก่อนอ่านค่าออกไปสร้างไฟล์)
    page.syncImportedRow = function () {
        if (importedRows.length === 0) return;

        importedRows[importedIndex] = page.getRawValues();
    };

    // ค่าที่จัดรูปแบบพร้อมเขียนลงเอกสารของแถวที่ index
    // (แถวที่ไม่ได้แสดงในฟอร์มต้องจัดรูปแบบเองจากค่าดิบ)
    page.formatImportedRow = function (index) {
        const raw = importedRows[Number(index)] || {};
        const types = getConfiguredTypes();
        const modes = getCurrencyModes();
        const values = {};

        Object.keys(raw).forEach(function (field) {
            values[field] = scope.FieldTypes.formatValue(
                types[field],
                raw[field],
                modes,
                field
            );
        });

        return values;
    };

    // เลื่อนไปดูแถวอื่นของชุดข้อมูลที่นำเข้า
    page.goToImportedRow = function (index) {
        if (importedRows.length === 0) return false;

        const target = Math.min(
            importedRows.length - 1,
            Math.max(0, Number(index))
        );

        // เก็บค่าที่แก้ในฟอร์มของแถวปัจจุบันกลับก่อน แล้วจึงเติมแถวใหม่
        importedRows[importedIndex] = page.getRawValues();
        importedIndex = target;

        page.applyValues(importedRows[importedIndex]);
        syncRowsBar();

        return true;
    };

    // ──────────────────────────────────────────────────────────────
    // รายการ template ที่บันทึกไว้
    // ──────────────────────────────────────────────────────────────
    page.renderTemplateOptions = function (records, selectedId, message) {
        const select = document.getElementById('templateSelect');
        if (!select) return;

        select.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.textContent = message || '— เลือก template ที่บันทึกไว้ —';
        select.appendChild(placeholder);

        // ใช้ textContent เพราะชื่อ template มาจากผู้ใช้ (กัน XSS)
        for (const record of records) {
            const option = document.createElement('option');
            option.value = String(record.id);
            option.textContent = record.name;
            select.appendChild(option);
        }

        select.value = selectedId ? String(selectedId) : '';
    };

    // ──────────────────────────────────────────────────────────────
    // ตาราง (type = table)
    //
    // แถวที่ผู้ใช้เพิ่ม/ลบ/พิมพ์ เก็บไว้ที่นี่ (ไม่ใช่ pageValues เพราะค่าไม่ใช่ข้อความ)
    // ฟอร์มถูกวาดใหม่ทุกครั้งที่สลับหน้า จึงต้องมีที่เก็บที่อยู่ข้ามการวาดฟอร์ม
    // โครงตาราง (จำนวนคอลัมน์ / ชื่อหัวคอลัมน์) มาจาก FieldTypes
    // ──────────────────────────────────────────────────────────────
    const tableRows = {};          // field -> [ [cell, ...], ... ]
    const tableSpans = {};         // field -> [ [span ของแต่ละกลุ่มช่อง], ... ]
    const tableCellStyles = {};    // field -> [ [ {align, bold, italic}, ... ], ... ]

    function tableSchema(field) {
        return scope.FieldTypes.getTableSchema(field);
    }

    function emptyRow(schema) {
        return schema.columns.map(function () {
            return '';
        });
    }

    // แถวที่เก็บไว้ต้องยาวเท่ากับจำนวนคอลัมน์ปัจจุบันเสมอ (โครงอาจถูกแก้ทีหลัง)
    function normalizeRows(field) {
        const schema = tableSchema(field);
        const stored = tableRows[field];

        const rows = (Array.isArray(stored) ? stored : []).map(function (row) {
            return schema.columns.map(function (_, index) {
                return row && row[index] != null ? String(row[index]) : '';
            });
        });

        if (rows.length === 0) {
            rows.push(emptyRow(schema));
        }

        tableRows[field] = rows;
        normalizeSpans(field, rows);
        normalizeCellStyles(field, rows);

        return rows;
    }

    // รูปแบบของทุกช่อง ต้องยาวเท่าจำนวนคอลัมน์และจำนวนแถวปัจจุบันเสมอ
    // (เพิ่ม/ลดคอลัมน์หรือแถวแล้ว รูปแบบเดิมต้องไม่เพี้ยน)
    function normalizeCellStyles(field, rows) {
        const columns = tableSchema(field).columns.length;
        const stored = Array.isArray(tableCellStyles[field]) ? tableCellStyles[field] : [];

        tableCellStyles[field] = rows.map(function (_, index) {
            return scope.FieldTypes.normalizeCellStyleRow(stored[index], columns);
        });

        return tableCellStyles[field];
    }

    // ขนาดกลุ่มช่องของแต่ละแถว (ผสาน/แยก)
    // แถวที่ยังไม่มีข้อมูล หรือผลรวมไม่เท่ากับจำนวนคอลัมน์ จะกลับไปเป็น "ไม่ผสาน"
    function normalizeSpans(field, rows) {
        const columns = tableSchema(field).columns.length;
        const stored = Array.isArray(tableSpans[field]) ? tableSpans[field] : [];

        tableSpans[field] = rows.map(function (_, index) {
            return scope.FieldTypes.normalizeRowSpans(stored[index], columns);
        });

        return tableSpans[field];
    }

    function createTable(field) {
        const schema = tableSchema(field);

        // normalizeRows จะซิงก์รูปแบบของทุกช่องให้ตรงกับแถว/คอลัมน์ปัจจุบันให้เอง
        return scope.FieldTypes.createTableControl(field, {
            schema: schema,
            rows: normalizeRows(field),
            spans: tableSpans[field],
            styles: tableCellStyles[field]
        });
    }

    function findTableWidget(field) {
        const form = document.getElementById('form');
        if (!form) return null;

        let found = null;

        form.querySelectorAll('[data-table-field]').forEach(function (node) {
            if (node.dataset.tableField === field) found = node;
        });

        return found;
    }

    // วาดตารางของ field นั้นใหม่ (หลังเพิ่ม/ลบแถว)
    function renderTable(field) {
        const current = findTableWidget(field);
        if (!current || !current.parentNode) return;

        current.parentNode.replaceChild(createTable(field), current);

        // แถบจัดรูปแบบถูกสร้างใหม่ (ปุ่ม disabled) — ซิงก์กับช่องที่เลือกอยู่อีกครั้ง
        updateFormatBar(field);
    }

    // ──────────────────────────────────────────────────────────────
    // type list (รายการ)
    //
    // แถวละ 1 ข้อความ (เพิ่ม/ลบได้) — เก็บเป็น array ของ string
    // ตอนสร้างเอกสาร ข้อที่ 1 อยู่ตรงตำแหน่งของ {{field}} และข้อถัดไปขึ้นบรรทัดใหม่
    // เริ่มตรงตำแหน่งเดียวกัน (รายละเอียดอยู่ที่ replace.js)
    // ──────────────────────────────────────────────────────────────
    // แถวของ list แต่ละ field — กลุ่มแชร์แค่ "จำนวนแถว" (ไม่แชร์ค่า)
    const listRows = {};

    function listGroupOf(field) {
        return getConfiguredListGroups()[field] || '';
    }

    // field ทุกตัวที่ใช้กลุ่มเดียวกัน (รวม field เอง)
    function listFieldsInGroup(group) {
        const types = getConfiguredTypes();
        const groups = getConfiguredListGroups();

        return Object.keys(types).filter(function (field) {
            return types[field] === 'list' && (groups[field] || '') === group;
        });
    }

    // จำนวนแถวของกลุ่ม = ของสมาชิกที่ยาวที่สุด (อย่างน้อย 1)
    function groupRowCount(group) {
        let count = 1;

        listFieldsInGroup(group).forEach(function (field) {
            count = Math.max(count, normalizeListItems(field).length);
        });

        return count;
    }

    // ทำให้ทุก field ในกลุ่มมีจำนวนแถวเท่ากัน (เติมช่องว่างท้ายแถว)
    function alignGroupRows(group) {
        const count = groupRowCount(group);

        listFieldsInGroup(group).forEach(function (field) {
            const items = normalizeListItems(field);

            while (items.length < count) items.push('');
        });

        return count;
    }

    // แถวของ list ต้องมีอย่างน้อย 1 แถวเสมอ (ค่าเก็บแยกตาม field)
    function normalizeListItems(field) {
        const stored = listRows[field];

        const items = (Array.isArray(stored) ? stored : []).map(function (value) {
            return String(value == null ? '' : value);
        });

        if (items.length === 0) items.push('');

        listRows[field] = items;
        return items;
    }

    // อ่านค่าที่พิมพ์อยู่ในช่องของ list กลับเข้า state (ก่อนเพิ่ม/ลบ/อ่านค่าออกไป)
    function readListInputs(field) {
        const form = document.getElementById('form');
        if (!form) return;

        const items = normalizeListItems(field);

        form.querySelectorAll('[data-list-input]').forEach(function (input) {
            if (input.dataset.listInput !== field) return;

            const index = Number(input.dataset.listRow);

            if (index >= 0 && index < items.length) {
                items[index] = input.value;
            }
        });
    }

    // widget ของ list — list ที่อยู่กลุ่มเดียวกันใช้บล็อกร่วมกัน (คอลัมน์เดียว)
    function findListWidget(field) {
        const form = document.getElementById('form');
        if (!form) return null;

        const group = listGroupOf(field);
        let found = null;

        if (group) {
            form.querySelectorAll('[data-list-group-field]').forEach(function (node) {
                if (node.dataset.listGroupField === group) found = node;
            });

            return found;
        }

        form.querySelectorAll('[data-list-field]').forEach(function (node) {
            if (node.dataset.listField === field) found = node;
        });

        return found;
    }

    // widget เดี่ยวของ field (ยังไม่ถูกแทนเป็นบล็อกกลุ่ม)
    function findSingleListWidget(field) {
        const form = document.getElementById('form');
        if (!form) return null;

        let found = null;

        form.querySelectorAll('[data-list-field]').forEach(function (node) {
            if (node.dataset.listField === field) found = node;
        });

        return found;
    }

    function createList(field) {
        const items = normalizeListItems(field);
        const placeholder = getConfiguredPlaceholders()[field];

        const group = listGroupOf(field);

        const wrapper = document.createElement('div');
        wrapper.className = 'field-control list-field';
        wrapper.dataset.listField = field;

        // list ที่อยู่กลุ่มเดียวกัน (สมาชิกตัวเดียว) — บอกให้เห็นว่าอยู่กลุ่ม
        if (group && listFieldsInGroup(group).length > 1) {
            const badge = document.createElement('p');
            badge.className = 'hint list-group-badge';
            badge.textContent =
                'กลุ่ม: ' + group + ' — แสดงรวมกับ list อื่นในกลุ่มเป็นแถวเดียวกัน';
            wrapper.appendChild(badge);
        }

        const rows = document.createElement('div');
        rows.className = 'list-rows';

        items.forEach(function (value, index) {
            const row = document.createElement('div');
            row.className = 'list-row';

            const number = document.createElement('span');
            number.className = 'list-index';
            number.textContent = (index + 1) + '.';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'list-input';
            input.dataset.listInput = field;
            input.dataset.listRow = String(index);
            input.autocomplete = 'off';
            input.placeholder = placeholder || ('กรอก ' + field);
            input.value = value;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'list-row-remove';
            remove.dataset.listRemove = field;
            remove.dataset.listRow = String(index);
            remove.textContent = '×';
            remove.title = 'ลบแถวนี้';
            remove.setAttribute('aria-label', 'ลบแถวนี้');

            row.appendChild(number);
            row.appendChild(input);
            row.appendChild(remove);
            rows.appendChild(row);
        });

        const actions = document.createElement('div');
        actions.className = 'list-actions';

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'plain list-add-row';
        add.dataset.listAdd = field;
        add.textContent = '＋ เพิ่มแถว';

        actions.appendChild(add);

        wrapper.appendChild(rows);
        wrapper.appendChild(actions);

        const limit = getConfiguredListLimits()[field] || 0;

        if (limit > 0) {
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent =
                'ตัดบรรทัดทุก ' + limit + ' ตัวอักษร (ขึ้นย่อหน้าใหม่ ¶) — ' +
                'แถวใหม่ก็ขึ้นย่อหน้าใหม่เช่นกัน';
            wrapper.appendChild(hint);
        }

        return wrapper;
    }

    // บล็อกของ list ที่ใช้กลุ่มเดียวกัน — 1 แถว = 1 ชุดข้อมูล
    //
    // ใช้โครงเดียวกับ list ปกติ:
    // .list-row > .list-index + input.list-input (คอลัมน์ละ field) + .list-row-remove
    // ทุกช่องในแถวมีค่าเป็นของตัวเอง — กลุ่มแชร์เฉพาะจำนวนแถว
    function createListGroupBlock(group) {
        const members = listFieldsInGroup(group);
        const count = alignGroupRows(group);
        const placeholders = getConfiguredPlaceholders();

        const wrapper = document.createElement('div');
        wrapper.className = 'field-control list-field list-group-field';
        wrapper.dataset.listGroupField = group;

        const badge = document.createElement('p');
        badge.className = 'hint list-group-badge';
        badge.textContent =
            'กลุ่ม: ' + group + ' — คอลัมน์: ' + members.join(' · ') +
            ' (1 แถวคือ 1 ชุดข้อมูล)';
        wrapper.appendChild(badge);

        const rows = document.createElement('div');
        rows.className = 'list-rows';

        for (let index = 0; index < count; index++) {
            const row = document.createElement('div');
            row.className = 'list-row';

            const number = document.createElement('span');
            number.className = 'list-index';
            number.textContent = (index + 1) + '.';
            row.appendChild(number);

            members.forEach(function (field) {
                const items = normalizeListItems(field);

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'list-input';
                input.dataset.listInput = field;
                input.dataset.listRow = String(index);
                input.autocomplete = 'off';
                input.placeholder = placeholders[field] || ('กรอก ' + field);
                input.value = items[index] || '';
                row.appendChild(input);
            });

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'list-row-remove';
            remove.dataset.listRemove = members[0];
            remove.dataset.listRow = String(index);
            remove.textContent = '×';
            remove.title = 'ลบแถวนี้';
            remove.setAttribute('aria-label', 'ลบแถวนี้');
            row.appendChild(remove);

            rows.appendChild(row);
        }

        const actions = document.createElement('div');
        actions.className = 'list-actions';

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'plain list-add-row';
        add.dataset.listAdd = members[0];
        add.textContent = '＋ เพิ่มแถว';
        add.title = 'เพิ่มแถวให้ทุกช่องในกลุ่ม';
        actions.appendChild(add);

        wrapper.appendChild(rows);
        wrapper.appendChild(actions);

        const limits = getConfiguredListLimits();
        const limited = members.filter(function (field) {
            return (limits[field] || 0) > 0;
        });

        if (limited.length > 0) {
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = limited.map(function (field) {
                return field + ': ' + limits[field] + ' ตัวอักษร';
            }).join(' · ') + ' — เกินแล้วขึ้นย่อหน้าใหม่ (¶)';
            wrapper.appendChild(hint);
        }

        return wrapper;
    }

    // วาด list ของ field นั้นใหม่ (หลังเพิ่ม/ลบแถว)
    function renderList(field) {
        const group = listGroupOf(field);
        const current = findListWidget(field);

        if (!current || !current.parentNode) return;

        current.parentNode.replaceChild(
            group ? createListGroupBlock(group) : createList(field),
            current
        );
    }

    page.addListRow = function (field) {
        const group = listGroupOf(field);
        const targets = group ? listFieldsInGroup(group) : [field];

        targets.forEach(readListInputs);

        if (group && targets.length > 1) {
            alignGroupRows(group);
        }

        targets.forEach(function (target) {
            normalizeListItems(target).push('');
        });

        renderList(field);
    };

    page.removeListRow = function (field, rowIndex) {
        const group = listGroupOf(field);
        const targets = group ? listFieldsInGroup(group) : [field];
        const index = Number(rowIndex);

        targets.forEach(readListInputs);

        if (group && targets.length > 1) {
            alignGroupRows(group);
        }

        const items = normalizeListItems(field);

        if (!(index >= 0 && index < items.length)) return;

        targets.forEach(function (target) {
            const targetItems = normalizeListItems(target);

            if (index < targetItems.length) targetItems.splice(index, 1);

            // เหลืออย่างน้อย 1 แถวเสมอ เพื่อให้พิมพ์ต่อได้ทันที
            if (targetItems.length === 0) targetItems.push('');
        });

        renderList(field);
    };

    // พิมพ์ในช่องไหน = เก็บค่านั้นของ field นั้น
    // (กลุ่มแชร์จำนวนแถว แต่แต่ละคอลัมน์มีค่าเป็นของตัวเอง)
    page.syncListInput = function (field, rowIndex, value) {
        const items = normalizeListItems(field);
        const index = Number(rowIndex);

        if (!(index >= 0 && index < items.length)) return;

        items[index] = String(value == null ? '' : value);
    };

    // ข้อมูลของ list ทั้งหมด (ส่งให้ replace.js ตอนสร้างเอกสาร)
    page.getListValues = function () {
        const types = getConfiguredTypes();
        const groups = getConfiguredListGroups();
        const lists = {};
        const aligned = {};

        // ทุกช่องในกลุ่มต้องมีจำนวนแถวเท่ากันก่อนอ่านค่า
        Object.keys(groups).forEach(function (field) {
            if (types[field] !== 'list') return;

            const group = groups[field] || '';
            if (!group || aligned[group]) return;

            aligned[group] = true;
            alignGroupRows(group);
        });

        const limits = getConfiguredListLimits();

        Object.keys(types).forEach(function (field) {
            if (types[field] !== 'list') return;

            readListInputs(field);
            lists[field] = {
                items: normalizeListItems(field).slice(),
                maxChars: limits[field] || 0
            };
        });

        return lists;
    };

    // เติมแถวของ list กลับเข้าฟอร์ม (ใช้ตอนกดใช้ซ้ำจากประวัติ)
    page.syncLists = function (values) {
        if (!values) return;

        const groupsToRender = {};

        Object.keys(values).forEach(function (field) {
            const spec = values[field];

            if (!spec || typeof spec !== 'object' || !Array.isArray(spec.items)) return;

            const items = spec.items.map(function (value) {
                return String(value == null ? '' : value);
            });

            if (items.length === 0) items.push('');

            listRows[field] = items;

            const group = listGroupOf(field);

            // กลุ่มที่มีสมาชิกหลายตัว = วาดบล็อกร่วมครั้งเดียว (คอลัมน์)
            if (group && listFieldsInGroup(group).length > 1) {
                groupsToRender[group] = true;
                return;
            }

            renderList(field);
        });

        Object.keys(groupsToRender).forEach(function (group) {
            alignGroupRows(group);

            const members = listFieldsInGroup(group);

            if (members.length > 0) renderList(members[0]);
        });
    };

    // ล้างแถวของ list ทั้งหมด (ตอนเปลี่ยน template / ล้างฟอร์ม)
    page.resetLists = function () {
        Object.keys(listRows).forEach(function (field) {
            delete listRows[field];
        });
    };

    // ──────────────────────────────────────────────────────────────
    // จัดรูปแบบช่อง (จัดตำแหน่ง / ตัวหนา / ตัวเอียง)
    //
    // เครื่องมือจัดรูปแบบทำกับ "ช่องที่เลือกอยู่" (ช่องที่เพิ่งโฟกัสล่าสุด)
    // เพราะช่องเป็น input ข้อความ จึงจัดรูปแบบได้ทั้งช่อง (ไม่ใช่บางคำ)
    // ──────────────────────────────────────────────────────────────

    // ช่องที่เลือกอยู่ตอนนี้ ({ field, row, col }) — null = ยังไม่ได้เลือก
    let activeCell = null;

    function getCellStyle(field, row, col) {
        const rows = tableCellStyles[field];
        const styleRow = rows ? rows[Number(row)] : null;

        return scope.FieldTypes.normalizeCellStyle(
            styleRow ? styleRow[Number(col)] : null
        );
    }

    function findTableCellInput(field, row, col) {
        const form = document.getElementById('form');
        if (!form) return null;

        let found = null;

        form.querySelectorAll('[data-table-input]').forEach(function (input) {
            if (
                input.dataset.tableInput === field &&
                Number(input.dataset.tableRow) === Number(row) &&
                Number(input.dataset.tableCol) === Number(col)
            ) {
                found = input;
            }
        });

        return found;
    }

    function findFormatBar(field) {
        const form = document.getElementById('form');
        if (!form) return null;

        let found = null;

        form.querySelectorAll('[data-table-format-bar]').forEach(function (bar) {
            if (bar.dataset.tableFormatBar === field) found = bar;
        });

        return found;
    }

    // ปุ่มของแถบจัดรูปแบบสะท้อนรูปแบบของช่องที่เลือกอยู่
    // (ปุ่ม disabled จนกว่าจะเลือกช่อง เพื่อไม่ให้สับสนว่าจะแก้ช่องไหน)
    function updateFormatBar(field) {
        const bar = findFormatBar(field);
        if (!bar) return;

        const active = !!(activeCell && activeCell.field === field);
        const style = active ? getCellStyle(field, activeCell.row, activeCell.col) : null;

        bar.querySelectorAll('[data-table-format]').forEach(function (button) {
            button.disabled = !active;

            const action = button.dataset.tableFormat;
            const on = active && (
                action === 'bold' ? style.bold :
                action === 'italic' ? style.italic :
                style.align === action
            );

            button.classList.toggle('active', !!on);
            button.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    // เรียกว่าตอนโฟกัสช่องในตาราง (จาก app.js)
    page.setActiveTableCell = function (field, row, col) {
        activeCell = {
            field: field,
            row: Number(row),
            col: Number(col)
        };

        updateFormatBar(field);
    };

    // เรียกว่าตอนกดปุ่มจัดรูปแบบ (จาก app.js) — action = left/center/right/bold/italic
    page.applyTableFormat = function (field, action) {
        if (!activeCell || activeCell.field !== field) return;

        const row = activeCell.row;
        const col = activeCell.col;
        const style = getCellStyle(field, row, col);

        if (action === 'bold') {
            style.bold = !style.bold;
        } else if (action === 'italic') {
            style.italic = !style.italic;
        } else if (action === 'left' || action === 'center' || action === 'right') {
            style.align = action;
        } else {
            return;
        }

        const rows = tableCellStyles[field];

        if (!rows || !rows[row]) return;
        rows[row][col] = style;

        // อัปเดตช่องที่แสดงอยู่ทันที ไม่วาดตารางใหม่ (จะได้ไม่เสียโฟกัสระหว่างพิมพ์)
        scope.FieldTypes.applyCellStyleToInput(
            findTableCellInput(field, row, col),
            style
        );

        updateFormatBar(field);
    };

    page.setTableCell = function (field, rowIndex, colIndex, value) {
        const rows = normalizeRows(field);
        const row = rows[Number(rowIndex)];

        if (!row) return;

        row[Number(colIndex)] = String(value == null ? '' : value);
    };

    page.addTableRow = function (field) {
        const schema = tableSchema(field);
        const rows = normalizeRows(field);

        rows.push(emptyRow(schema));
        normalizeSpans(field, rows);

        // เพิ่มแถวรูปแบบว่าง (ท้ายสุด) ให้ตรงกับแถวข้อมูลใหม่
        if (Array.isArray(tableCellStyles[field])) tableCellStyles[field].push([]);
        normalizeCellStyles(field, rows);

        renderTable(field);
    };

    page.removeTableRow = function (field, rowIndex) {
        const schema = tableSchema(field);
        const rows = normalizeRows(field);
        const index = Number(rowIndex);

        if (!(index >= 0 && index < rows.length)) return;

        rows.splice(index, 1);

        // เหลืออย่างน้อย 1 แถวเสมอ เพื่อให้พิมพ์ต่อได้ทันที
        if (rows.length === 0) {
            rows.push(emptyRow(schema));
        }

        normalizeSpans(field, rows);

        // ย้ายแถวรูปแบบตามแถวข้อมูลที่ถูกลบ
        if (Array.isArray(tableCellStyles[field])) tableCellStyles[field].splice(index, 1);
        normalizeCellStyles(field, rows);

        if (activeCell && activeCell.field === field) activeCell = null;

        renderTable(field);
    };

    // ── ผสาน / แยกช่องของแถวข้อมูล ──

    // ข้อความของสองช่องมารวมกัน (ช่องเปล่าไม่ทำให้เกิดช่องว่างเกิน)
    function joinCellText(left, right) {
        const first = left == null ? '' : String(left);
        const second = right == null ? '' : String(right);

        if (first.trim() === '') return second;
        if (second.trim() === '') return first;

        return first + ' ' + second;
    }

    // ผสานกลุ่มช่องที่ groupIndex เข้ากับกลุ่มถัดไป (ข้อความย้ายมารวมที่กลุ่มแรก)
    page.mergeTableCells = function (field, rowIndex, groupIndex) {
        const rows = normalizeRows(field);
        const spans = tableSpans[field];

        const index = Number(rowIndex);
        const group = Number(groupIndex);
        const row = rows[index];
        const list = spans ? spans[index] : null;

        if (!row || !list) return;
        if (!(group >= 0 && group < list.length - 1)) return;

        const start = scope.FieldTypes.startColumnOf(list, group);
        const nextStart = start + list[group];

        row[start] = joinCellText(row[start], row[nextStart]);
        row[nextStart] = '';

        const merged = list.slice();
        merged[group] = list[group] + list[group + 1];
        merged.splice(group + 1, 1);

        spans[index] = merged;

        // ช่องที่ถูกผสานหายไป — ล้างรูปแบบของช่องนั้น (ใช้รูปแบบของช่องแรกของกลุ่ม)
        const mergeStyles = tableCellStyles[field] && tableCellStyles[field][index];
        if (mergeStyles) mergeStyles[nextStart] = scope.FieldTypes.normalizeCellStyle(null);

        if (activeCell && activeCell.field === field) activeCell = null;

        renderTable(field);
    };

    // แยกกลุ่มที่ผสานอยู่กลับเป็นช่องปกติ (ข้อความอยู่ในช่องแรกของกลุ่ม)
    page.unmergeTableCells = function (field, rowIndex, groupIndex) {
        const rows = normalizeRows(field);
        const spans = tableSpans[field];

        const index = Number(rowIndex);
        const group = Number(groupIndex);
        const row = rows[index];
        const list = spans ? spans[index] : null;

        if (!row || !list) return;
        if (!(group >= 0 && group < list.length)) return;

        const count = list[group];
        if (count <= 1) return;

        const start = scope.FieldTypes.startColumnOf(list, group);
        const separated = [];

        for (let i = 0; i < count; i++) {
            separated.push(1);

            if (i > 0) row[start + i] = '';
        }

        spans[index] = list
            .slice(0, group)
            .concat(separated, list.slice(group + 1));

        // ช่องที่เพิ่งแยกออกกลับไปเป็นรูปแบบตั้งต้น (ช่องแรกคงรูปแบบเดิมไว้)
        const unmergeStyles = tableCellStyles[field] && tableCellStyles[field][index];
        if (unmergeStyles) {
            for (let i = 1; i < count; i++) {
                unmergeStyles[start + i] = scope.FieldTypes.normalizeCellStyle(null);
            }
        }

        if (activeCell && activeCell.field === field) activeCell = null;

        renderTable(field);
    };

    // ตารางทั้งหมดที่พร้อมเขียนลงเอกสาร (ส่งให้ replace.js คนละทางกับ values)
    page.getTableValues = function () {
        const types = getConfiguredTypes();
        const tables = {};

        Object.keys(types).forEach(function (field) {
            if (types[field] !== 'table') return;

            const schema = tableSchema(field);

            tables[field] = {
                columns: schema.columns.slice(),
                // สัดส่วนความกว้างของแต่ละคอลัมน์ (ตั้งไว้ที่หน้า Template Configuration)
                widths: scope.FieldTypes.getColumnWidths(schema),
                // รูปแบบหัวคอลัมน์ (จัดตำแหน่ง / ตัวหนา) ของแต่ละคอลัมน์
                headerStyles: scope.FieldTypes.normalizeHeaderStyleRow(
                    schema.headerStyles,
                    schema.columns.length
                ),
                rows: normalizeRows(field),
                // ขนาดกลุ่มช่องของแต่ละแถว (1 = ไม่ผสาน)
                rowSpans: (tableSpans[field] || []).map(function (list) {
                    return list.slice();
                }),
                // รูปแบบของแต่ละช่อง (จัดตำแหน่ง / ตัวหนา / ตัวเอียง)
                cellStyles: (tableCellStyles[field] || []).map(function (styleRow) {
                    return styleRow.map(function (style) {
                        return scope.FieldTypes.normalizeCellStyle(style);
                    });
                })
            };
        });

        return tables;
    };

    // ล้างแถวทั้งหมด (ตอนเปลี่ยน template หรือล้างฟอร์ม)
    page.resetTables = function () {
        Object.keys(tableRows).forEach(function (field) {
            delete tableRows[field];
        });

        Object.keys(tableSpans).forEach(function (field) {
            delete tableSpans[field];
        });

        Object.keys(tableCellStyles).forEach(function (field) {
            delete tableCellStyles[field];
        });

        activeCell = null;
    };

    // ──────────────────────────────────────────────────────────────
    // ค่าที่จะเขียนลงเอกสาร
    // - วันที่: ช่องเป็นข้อความที่จัดรูปแบบไว้แล้ว (เลือกจาก dropdown ข้างช่อง)
    //   จึงใช้ค่าที่อ่านจากช่องตรง ๆ
    // - currency: ค่า canonical (ตัวเลขล้วน) อยู่ที่ dataset ของช่อง
    // ──────────────────────────────────────────────────────────────
    const baseGetValues = page.getValues;
    const baseApplyValues = page.applyValues;

    page.getValues = function () {
        const values = baseGetValues.call(page);
        const types = getConfiguredTypes();
        const modes = getCurrencyModes();

        // ช่อง currency แสดงรูปแบบตามโหมด (comma / ตัวหนังสือ)
        // ค่าที่ใช้แปลงต้องเป็นตัวเลขล้วน จึงอ่านจาก dataset ของช่อง
        const form = document.getElementById('form');

        if (form) {
            form.querySelectorAll('[data-currency-input]').forEach(function (input) {
                values[input.dataset.field] = input.dataset.currencyValue || '';
            });
        }

        Object.keys(values).forEach(function (field) {
            values[field] = scope.FieldTypes.formatValue(types[field], values[field], modes, field);
        });
        return values;
    };

    // ค่าดิบของฟอร์ม ใช้บันทึกเป็นประวัติ (หน้าประวัติการกรอก)
    // ต่างจาก getValues ตรงที่ currency เก็บ "ตัวเลขล้วน" จาก dataset ไม่จัดรูปแบบ
    // เพราะค่าที่จัดรูปแบบแล้ว (1,000 หรือ หนึ่งพันบาทถ้วน) เอากลับมาเติมในช่องไม่ได้
    page.getRawValues = function () {
        const values = baseGetValues.call(page);
        const form = document.getElementById('form');

        if (form) {
            form.querySelectorAll('[data-currency-input]').forEach(function (input) {
                values[input.dataset.field] = input.dataset.currencyValue || '';
            });
        }

        return values;
    };

    // โหมด "ตัวเลข/ตัวหนังสือ" ของช่อง currency ที่แสดงอยู่ตอนนี้
    // เก็บไปกับประวัติด้วย เพื่อให้กดใช้ซ้ำแล้วได้รูปแบบเดิม
    page.getCurrencyModes = getCurrencyModes;

    // ซิงก์ช่อง currency ให้แสดงรูปแบบตามโหมดปัจจุบัน (ใช้หลังเติมค่ากลับเข้าฟอร์ม)
    // ค่า canonical (ตัวเลขล้วน) เขียนลง dataset ก่อนแล้วช่องค่อยแสดงรูปแบบของโหมด
    page.syncCurrencyInputs = function (values) {
        const form = document.getElementById('form');
        if (!form) return;

        form.querySelectorAll('[data-currency-input]').forEach(function (input) {
            const field = input.dataset.field;

            if (values && Object.prototype.hasOwnProperty.call(values, field)) {
                input.dataset.currencyValue = values[field] == null ? '' : String(values[field]);
            }

            scope.FieldTypes.refreshCurrencyInputDisplay(input);
        });
    };

    page.applyValues = function (values) {
        // มีชุดข้อมูลที่นำเข้าอยู่ = แถวที่กำลังดูเป็นแหล่งค่าหลัก
        // (สลับหน้าไปกลับแล้วยังได้แถวเดิม ไม่หลุดไปเป็นค่าที่ค้างของหน้า)
        const source =
            importedRows.length > 0
                ? importedRows[importedIndex]
                : values;

        baseApplyValues.call(page, source);
        page.syncCurrencyInputs(source);
        page.syncTables(values);
        page.syncLists(values);
        syncRowsBar();
    };

    // เติมค่าที่จับได้จากปุ่ม "ใส่ข้อมูล" (regex) ลงฟอร์ม
    // - ค่าธรรมดา: เขียนลงช่อง [data-field]
    // - type list: values[field] = { items: [...] } → วาดแถวใหม่
    // - ถ้ามีชุดข้อมูลจาก Excel อยู่: รวมค่าลง "แถวที่กำลังดู" ไม่ทิ้งแถวอื่น
    page.applyExtractedValues = function (values) {
        if (!values) return;

        if (importedRows.length > 0) {
            importedRows[importedIndex] = Object.assign(
                {},
                importedRows[importedIndex],
                values
            );

            page.applyValues(importedRows[importedIndex]);
            syncRowsBar();
            return;
        }

        page.applyValues(values);
    };

    // เติมแถวของตารางกลับเข้าฟอร์ม (ใช้ตอนกดใช้ซ้ำจากประวัติ)
    page.syncTables = function (values) {
        if (!values) return;

        Object.keys(values).forEach(function (field) {
            const spec = values[field];

            if (!spec || typeof spec !== 'object' || !Array.isArray(spec.rows)) return;

            const schema = tableSchema(field);

            const rows = spec.rows.map(function (row) {
                return schema.columns.map(function (_, index) {
                    return row && row[index] != null ? String(row[index]) : '';
                });
            });

            if (rows.length === 0) {
                rows.push(emptyRow(schema));
            }

            tableRows[field] = rows;

            const storedSpans = Array.isArray(spec.rowSpans) ? spec.rowSpans : [];

            tableSpans[field] = rows.map(function (_, index) {
                return scope.FieldTypes.normalizeRowSpans(storedSpans[index], schema.columns.length);
            });

            const storedStyles = Array.isArray(spec.cellStyles) ? spec.cellStyles : [];

            tableCellStyles[field] = rows.map(function (_, index) {
                return scope.FieldTypes.normalizeCellStyleRow(storedStyles[index], schema.columns.length);
            });

            renderTable(field);
        });
    };

    // ──────────────────────────────────────────────────────────────
    // ตรวจคำที่น่าสงสัยในค่าที่กรอก (ปุ่ม "ตรวจคำที่น่าสงสัย")
    //
    // ใช้ตัวตรวจเดียวกับกล่อง "ใส่ข้อมูล" (OcrTextTools — พจนานุกรมในเครื่อง
    // + คำที่ผู้ใช้เพิ่มเองที่หน้า "คำแนะนำ") ไม่มีข้อความออกนอกเครื่อง
    //
    // ตรวจช่องข้อความทุกชนิด: [data-field], ช่อง list และช่องตาราง
    // ไม่ตรวจ checkbox (ค่าเป็น true/false) และ currency (ค่า canon เป็นตัวเลข)
    //
    // แต่ละแถวเก็บ "ที่อยู่ช่อง" (ref) ไม่ใช่ element — เพราะฟอร์มถูกวาดใหม่
    // ได้ทุกเมื่อ (เปลี่ยนแม่แบบ / สลับหน้า) จึงค่อยหาช่องตอนกดใช้
    // ──────────────────────────────────────────────────────────────
    const SPELL_MAX_ROWS = 100;

    let spellQueue = [];     // แถวที่มีคำแนะนำ — ใช้กับ "ใช้คำแนะนำทั้งหมด"
    let spellChecked = 0;    // จำนวนคำที่ตรวจในรอบล่าสุด

    function spellEl(id) {
        return document.getElementById(id);
    }

    function hideSpellPanel() {
        const panel = spellEl('reportSpellPanel');
        if (panel) panel.hidden = true;

        const list = spellEl('reportSpellList');
        if (list) list.innerHTML = '';

        spellQueue = [];
        spellChecked = 0;
    }

    function updateSpellMeta(note) {
        const meta = spellEl('reportSpellMeta');
        if (!meta) return;

        if (note) {
            meta.textContent = note;
            return;
        }

        const list = spellEl('reportSpellList');
        const remaining = list
            ? list.querySelectorAll('.data-spell-row').length
            : 0;

        meta.textContent = 'ตรวจ ' + spellChecked + ' คำ' + (remaining > 0
            ? ' — เหลือ ' + remaining + ' คำ คลิกคำแนะนำเพื่อแทนที่ในช่องนั้น'
            : ' — ไม่มีคำค้างให้แก้');
    }

    // ช่องกรอกที่ต้องตรวจ — คืน [{ ref, control, label }]
    function spellTargets() {
        const form = document.getElementById('form');
        const targets = [];

        if (!form) return targets;

        form.querySelectorAll('[data-field]').forEach(function (control) {
            if (control.type === 'checkbox') return;
            if (control.dataset.currencyInput === '1') return;
            if (!String(control.value || '').trim()) return;

            targets.push({
                ref: { kind: 'field', field: control.dataset.field },
                control: control,
                label: control.dataset.field
            });
        });

        form.querySelectorAll('[data-list-input]').forEach(function (control) {
            if (!String(control.value || '').trim()) return;

            const row = Number(control.dataset.listRow);

            targets.push({
                ref: { kind: 'list', field: control.dataset.listInput, row: row },
                control: control,
                label: control.dataset.listInput + ' · แถว ' + (row + 1)
            });
        });

        form.querySelectorAll('[data-table-input]').forEach(function (control) {
            if (!String(control.value || '').trim()) return;

            const field = control.dataset.tableInput;
            const row = Number(control.dataset.tableRow);
            const col = Number(control.dataset.tableCol);
            const column = tableSchema(field).columns[col];

            targets.push({
                ref: { kind: 'table', field: field, row: row, col: col },
                control: control,
                label: field + ' · ' +
                    (column == null ? 'คอลัมน์ ' + (col + 1) : String(column)) +
                    ' · แถว ' + (row + 1)
            });
        });

        return targets;
    }

    // หาช่องจาก ref ณ ตอนกดใช้ (ฟอร์มอาจถูกวาดใหม่ไปแล้ว)
    function findSpellControl(ref) {
        const form = document.getElementById('form');
        if (!form || !ref) return null;

        let found = null;

        if (ref.kind === 'list') {
            form.querySelectorAll('[data-list-input]').forEach(function (control) {
                if (
                    control.dataset.listInput === ref.field &&
                    Number(control.dataset.listRow) === Number(ref.row)
                ) {
                    found = control;
                }
            });

            return found;
        }

        if (ref.kind === 'table') {
            form.querySelectorAll('[data-table-input]').forEach(function (control) {
                if (
                    control.dataset.tableInput === ref.field &&
                    Number(control.dataset.tableRow) === Number(ref.row) &&
                    Number(control.dataset.tableCol) === Number(ref.col)
                ) {
                    found = control;
                }
            });

            return found;
        }

        form.querySelectorAll('[data-field]').forEach(function (control) {
            if (control.dataset.field === ref.field) found = control;
        });

        return found;
    }

    function applySpellCorrection(ref, word, replacement, row) {
        const control = findSpellControl(ref);

        if (control && scope.OcrTextTools) {
            control.value = scope.OcrTextTools.replaceWord(
                control.value,
                word,
                replacement
            );

            // ยิง event input เหมือนตอนพิมพ์ เพื่อให้ app.js เก็บค่าของช่องนั้น
            // (รวมค่าของตาราง/list ที่เก็บแยกไว้ใน component)
            control.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (row) row.remove();

        updateSpellMeta(
            control
                ? null
                : 'ไม่พบช่องนี้ในฟอร์มแล้ว (เปลี่ยนแม่แบบหรือล้างค่าไปแล้ว)'
        );
    }

    function addSpellRow(target, issue) {
        const row = document.createElement('div');
        row.className = 'data-spell-row';

        const head = document.createElement('div');
        head.className = 'data-spell-head';

        const word = document.createElement('code');
        word.className = 'data-spell-word';
        word.textContent = issue.word;

        // บอกด้วยว่าคำนี้อยู่ช่องไหนของฟอร์ม
        const where = document.createElement('span');
        where.className = 'report-spell-field';
        where.textContent = target.label;
        where.title = target.label;

        const count = document.createElement('span');
        count.className = 'hint';
        count.textContent = issue.count > 1 ? 'พบ ' + issue.count + ' ครั้ง' : '';

        const context = document.createElement('span');
        context.className = 'data-spell-context';
        context.textContent = issue.context;
        context.title = issue.context;

        head.appendChild(word);
        head.appendChild(where);
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
                applySpellCorrection(target.ref, issue.word, suggestion, row);
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

            applySpellCorrection(target.ref, issue.word, replacement, row);
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

        spellEl('reportSpellList').appendChild(row);

        if (issue.suggestions.length > 0) {
            spellQueue.push({
                ref: target.ref,
                word: issue.word,
                replacement: issue.suggestions[0],
                row: row
            });
        }
    }

    function runSpellCheck() {
        const panel = spellEl('reportSpellPanel');
        const list = spellEl('reportSpellList');

        if (!panel || !list) return;

        list.innerHTML = '';
        spellQueue = [];
        spellChecked = 0;

        if (!scope.OcrTextTools) {
            panel.hidden = false;
            updateSpellMeta('ไม่พบตัวตรวจคำ — โหลดหน้าใหม่แล้วลองอีกครั้ง');
            return;
        }

        const targets = spellTargets();
        let rows = 0;
        let truncated = false;
        let unavailable = false;

        targets.forEach(function (target) {
            const result = scope.OcrTextTools.check(target.control.value);

            if (result.unavailable) {
                unavailable = true;
                return;
            }

            spellChecked += result.checked;

            result.issues.forEach(function (issue) {
                if (rows >= SPELL_MAX_ROWS) {
                    truncated = true;
                    return;
                }

                addSpellRow(target, issue);
                rows += 1;
            });
        });

        panel.hidden = false;

        if (unavailable) {
            updateSpellMeta('พจนานุกรมยังโหลดไม่เสร็จ — รอสักครู่แล้วลองอีกครั้ง');
            return;
        }

        if (rows === 0) {
            updateSpellMeta(targets.length === 0
                ? 'ยังไม่มีข้อความในฟอร์มให้ตรวจ'
                : 'ตรวจ ' + spellChecked + ' คำ — ไม่พบคำที่น่าสงสัย');

            if (targets.length > 0) {
                const empty = document.createElement('p');
                empty.className = 'hint';
                empty.textContent = 'ทุกคำที่ตรวจพบอยู่ในพจนานุกรมหรือคำที่เพิ่มเอง';
                list.appendChild(empty);
            }

            return;
        }

        updateSpellMeta(
            'ตรวจ ' + spellChecked + ' คำ — พบ ' + rows + ' คำที่น่าสงสัย' +
            (truncated ? ' (แสดง ' + SPELL_MAX_ROWS + ' คำแรก)' : '')
        );
    }

    function applyAllSpellSuggestions() {
        let applied = 0;

        spellQueue.forEach(function (item) {
            if (!item.row.isConnected) return;

            applySpellCorrection(item.ref, item.word, item.replacement, item.row);
            applied += 1;
        });

        spellQueue = [];

        updateSpellMeta(applied > 0
            ? 'ใช้คำแนะนำ ' + applied + ' คำแล้ว'
            : 'ไม่มีคำแนะนำให้ใช้ — เลือกคำเองหรือข้าม');
    }

    // event ระดับ document — ปุ่ม/แผงถูกสร้างใหม่ทุกครั้งที่เปิดหน้า เหมือนสวิตช์ไฮไลต์
    function onSpellClick(event) {
        const target = event.target;

        if (!target || !target.id) return;

        if (target.id === 'reportSpellBtn') {
            runSpellCheck();
            return;
        }

        if (target.id === 'reportSpellClose') {
            hideSpellPanel();
            return;
        }

        if (target.id === 'reportSpellApplyAll') {
            applyAllSpellSuggestions();
        }
    }

    document.addEventListener('click', onSpellClick);

    scope.ReportPage = page;
})(window);
