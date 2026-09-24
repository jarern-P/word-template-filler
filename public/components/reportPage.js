// Report Page Component - เลือก template ที่บันทึกไว้ แล้วกรอกค่าตาม type
(function (scope) {
    'use strict';

    // เตือนเมื่อล็อกตำแหน่งไม่สมบูรณ์ เช่น ช่องว่างด้านหน้า field ไม่พอให้ลบ
    const FOOTER_HTML =
        '<p id="replaceWarning" class="replace-warning" style="display:none"></p>';

    // ปุ่มดูตัวอย่างก่อนดาวน์โหลด (แสดงเฉพาะเมื่อโหลด template แล้ว — ดู showPreviewButton)
    const ACTIONS_HTML =
        '<button id="previewBtn" type="button" class="plain" style="display:none">' +
        'ดูตัวอย่างก่อนดาวน์โหลด</button>';

    const META_HTML = [
        '<div class="template-meta">',
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
        title: 'Word Template Filler',
        showFileInput: false,
        // รวมปุ่ม ดูตัวอย่าง / Download DOCX / Clear ไว้แถวเดียวกันใต้ฟอร์ม
        actionsRow: true,
        metaHTML: META_HTML,
        actionsHTML: ACTIONS_HTML,
        footerHTML: FOOTER_HTML,
        emptyMessage: 'ยังไม่มี template — เลือกจาก dropdown ด้านบน หรือไปเลือกไฟล์ที่หน้า Template Configuration ก่อน',

        // ช่องที่เป็น type text จะมีปุ่มแว่นขยายให้เลือกค่าจาก Master Data
        renderControl: function (field) {
            // ตาราง: วาดเป็นตารางเพิ่ม/ลบแถวได้ (โครงมาจากหน้า Template Configuration)
            if (getConfiguredTypes()[field] === 'table') {
                return createTable(field);
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
    page.showPreviewButton = function (show) {
        const btn = document.getElementById('previewBtn');
        if (btn) btn.style.display = show ? 'block' : 'none';
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
        baseApplyValues.call(page, values);
        page.syncCurrencyInputs(values);
        page.syncTables(values);
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

    scope.ReportPage = page;
})(window);
