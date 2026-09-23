// Template Config Page Component - ตั้งค่า type ของแต่ละ {{field}} และบันทึกเป็น template
(function (scope) {
    'use strict';

    const META_HTML = [
        '<div class="template-meta">',
        '    <label for="templateName">ชื่อ Template</label>',
        '    <input type="text" id="templateName" data-persist="templateName"' +
            ' placeholder="เว้นว่าง = ใช้ชื่อไฟล์ .docx">',
        '</div>'
    ].join('\n');

    // ปุ่มจัดการไฟล์ .docx ของ template
    // - ดาวน์โหลด: ได้ไฟล์ต้นฉบับที่เก็บไว้ (ยังไม่ถูกแทนค่า)
    // - อัปโหลดทับ: เอาไฟล์ที่แก้ไขนอกแอปมาทับไฟล์เดิม (มี confirm ก่อนทับใน app.js)
    // - input file ถูกซ่อน เพราะเปิดผ่านปุ่มเพื่อให้เข้าชุดกับปุ่มอื่น
    const ACTIONS_HTML = [
        '<div class="form-actions">',
        '    <button id="downloadTemplateBtn" type="button" class="plain" disabled>' +
            'ดาวน์โหลด Template ต้นฉบับ</button>',
        '    <button id="replaceTemplateBtn" type="button" class="danger" disabled>' +
            'อัปโหลดไฟล์ใหม่ทับไฟล์เดิม</button>',
        '</div>',
        '<input type="file" id="replaceFileInput" accept=".docx" hidden>',
        '<button id="saveBtn" type="button" disabled>Save Template</button>'
    ].join('\n');

    const FOOTER_HTML = [
        '<section class="saved-templates">',
        '    <h2>Template ที่บันทึกไว้</h2>',
        '    <p id="dbStatus" class="db-status"></p>',
        '    <ul id="savedList" class="saved-list"></ul>',
        '</section>'
    ].join('\n');

    // ช่องใส่ placeholder (ข้อความตัวอย่าง) ของ field นั้น
    // ข้อความนี้ถูกนำไปแสดงในช่องกรอกของหน้ารายงานเป็น "กรอก <field> เช่น <placeholder>"
    function createPlaceholderInput(field) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'field-placeholder';
        // ใช้ data-placeholder-field (ไม่ใช่ data-field) เพื่อไม่ให้ปนกับค่าของ type
        input.dataset.placeholderField = field;
        input.autocomplete = 'off';
        input.placeholder =
            'Placeholder เช่น หนึ่งร้อยบาทถ้วน — เว้นว่าง = ใช้ค่าเริ่มต้น';
        input.title =
            'ข้อความตัวอย่างของช่องนี้ในหน้ารายงาน ' +
            '(แสดงเป็น "กรอก ' + field + ' เช่น …")';
        return input;
    }

    // ──────────────────────────────────────────────────────────────
    // ช่องตั้งค่าตาราง (แสดงเมื่อเลือก type = Table)
    //
    // - จำนวนคอลัมน์
    // - ชื่อหัวคอลัมน์ (1 ช่องต่อ 1 คอลัมน์)
    // (แถวรวมยอดให้ผสานช่องในหน้ารายงานแทน — เขียนเป็น w:gridSpan ในเอกสาร)
    //
    // โครงตารางเก็บไว้ที่ FieldTypes เพราะหน้ารายงานและตอนสร้างเอกสารใช้ด้วย
    // ──────────────────────────────────────────────────────────────
    function createTableConfig(field) {
        const box = document.createElement('div');
        box.className = 'table-config';
        box.dataset.tableConfig = field;
        box.hidden = true;

        const countRow = document.createElement('div');
        countRow.className = 'table-config-row';

        const countLabel = document.createElement('label');
        countLabel.textContent = 'จำนวนคอลัมน์';

        const countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.min = '1';
        countInput.max = String(scope.FieldTypes.tableMaxColumns);
        countInput.step = '1';
        countInput.className = 'table-count';
        countInput.dataset.tableCount = field;

        countRow.appendChild(countLabel);
        countRow.appendChild(countInput);

        const colsLabel = document.createElement('span');
        colsLabel.className = 'table-config-label';
        colsLabel.textContent = 'ชื่อหัวคอลัมน์ (เว้นว่าง = ใช้ชื่อเริ่มต้น)';

        const cols = document.createElement('div');
        cols.className = 'table-cols';
        cols.dataset.tableCols = field;

        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent =
            'วาง {{' + field + '}} ไว้บรรทัดเดียวของมันเอง — ' +
            'ตอนสร้างเอกสารจะแทนที่ทั้งย่อหน้านั้นด้วยตาราง ' +
            '(เพิ่ม/ลบแถว และผสานช่องเพื่อทำแถวรวมยอด ได้ที่หน้ารายงาน)';

        // เตือนเมื่อ {{field}} ถูกวางไว้หลายที่ในเอกสาร
        // (ตารางจะถูกใส่ในเอกสารเท่าจำนวนที่วางไว้ — มักไม่ใช่สิ่งที่ผู้ใช้ต้องการ)
        const usage = document.createElement('p');
        usage.className = 'hint table-usage';
        usage.dataset.tableUsage = field;
        usage.hidden = true;

        box.appendChild(countRow);
        box.appendChild(colsLabel);
        box.appendChild(cols);
        box.appendChild(hint);
        box.appendChild(usage);

        return box;
    }

    // select เลือก type + ช่อง placeholder + checkbox "ล็อกตำแหน่ง" ของ field นั้น
    function createTypeSelect(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'field-config';

        const row = document.createElement('div');
        row.className = 'field-type-row';

        const select = document.createElement('select');
        select.dataset.field = field;
        select.className = 'field-type';

        for (const type of scope.FieldTypes.options) {
            const option = document.createElement('option');
            option.value = type.value;
            option.textContent = type.label;
            select.appendChild(option);
        }

        select.value = scope.FieldTypes.defaultValue;

        const lockBox = document.createElement('input');
        lockBox.type = 'checkbox';
        // ใช้ data-lock-field (ไม่ใช่ data-field) เพื่อไม่ให้ปนกับค่าของ type
        lockBox.dataset.lockField = field;
        lockBox.className = 'lock-box';

        const lockLabel = document.createElement('label');
        lockLabel.className = 'lock-toggle';
        // ล็อก = ตำแหน่งเริ่มต้นของข้อความนี้ต้องตรงกับ template ตามไม้บรรทัด
        // ระบบชดเชยด้วยการเพิ่ม/ลบช่องว่างทั้งด้านหน้าและด้านหลัง ตามความกว้างจริง
        lockLabel.title =
            'ล็อกตำแหน่งเริ่มต้นของข้อความนี้ให้ตรงกับที่อยู่ใน template (แนวไม้บรรทัด) ' +
            'ถ้าค่าของ field ด้านหน้ายาวกว่าเดิม ระบบจะลบช่องว่างด้านหน้าให้ ' +
            'ถ้าสั้นกว่าเดิมจะเติมช่องว่างให้ และช่องของ field นี้ (กว้างเท่า ' +
            '{{field}} เดิม รวมปีกกา) ถูกรักษาไว้ให้ข้อความด้านหลังอยู่ที่เดิม ' +
            'ระบบไม่ตัดข้อความที่กรอก ถ้าช่องว่างไม่พอก็จะเตือนตอนสร้างเอกสาร';

        const lockText = document.createElement('span');
        lockText.textContent = 'ล็อกตำแหน่ง';

        lockLabel.appendChild(lockBox);
        lockLabel.appendChild(lockText);

        row.appendChild(select);
        row.appendChild(lockLabel);

        wrapper.appendChild(row);
        wrapper.appendChild(createPlaceholderInput(field));
        wrapper.appendChild(createTableConfig(field));
        return wrapper;
    }

    function parseJson(text, fallback) {
        try {
            const parsed = JSON.parse(text);
            return (parsed === null || parsed === undefined) ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    }

    function formatDate(isoText) {
        const date = new Date(isoText);
        if (isNaN(date.getTime())) return isoText || '';
        return date.toLocaleString('th-TH');
    }

    function createSavedItem(record) {
        const item = document.createElement('li');
        item.className = 'saved-item';

        const info = document.createElement('div');
        info.className = 'info';

        const name = document.createElement('strong');
        name.textContent = record.name;

        const fields = parseJson(record.fields, []);
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = [
            record.file_name || '(ไม่มีชื่อไฟล์)',
            fields.length + ' fields',
            'อัปเดต ' + formatDate(record.updated_at)
        ].join(' · ');

        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'actions';

        // ใช้ textContent ทุกจุด เพราะชื่อ template มาจากผู้ใช้ (กัน XSS)
        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.textContent = 'โหลด';
        loadBtn.dataset.action = 'load';
        loadBtn.dataset.id = String(record.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'ลบ';
        deleteBtn.dataset.action = 'delete';
        deleteBtn.dataset.id = String(record.id);

        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);
        return item;
    }

    const page = scope.FormPage.create({
        title: 'Template Configuration',
        formTitle: 'ตั้งค่า Type ของแต่ละ Field',
        showDownload: false,   // หน้านี้มีแต่ค่า type ไม่ใช่ค่าที่จะใส่เอกสาร
        renderControl: createTypeSelect,
        metaHTML: META_HTML,
        actionsHTML: ACTIONS_HTML,
        footerHTML: FOOTER_HTML,
        emptyMessage: 'เลือกไฟล์ .docx ด้านบน หรือกด "โหลด" จากรายการด้านล่างเพื่อเริ่มตั้งค่า'
    });

    // ── ส่วนที่ใช้เฉพาะหน้านี้ ──

    // ── โครงตาราง (type = table) ──

    // หา node ของช่องตั้งค่าตารางของ field หนึ่ง (หาไม่ได้ = ฟอร์มถูกล้างไปแล้ว)
    function tableNodes(field) {
        const form = document.getElementById('form');
        const found = {};

        if (!form) return found;

        form.querySelectorAll(
            '[data-table-config], [data-table-count], [data-table-cols]'
        ).forEach(function (node) {
            const data = node.dataset;

            if (data.tableConfig === field) found.box = node;
            else if (data.tableCount === field) found.count = node;
            else if (data.tableCols === field) found.cols = node;
        });

        return found;
    }

    // สร้างช่องชื่อหัวคอลัมน์ใหม่ทั้งชุด (เรียกเมื่อจำนวนคอลัมน์เปลี่ยน)
    function renderColumnInputs(field, columns) {
        const nodes = tableNodes(field);
        if (!nodes.cols) return;

        nodes.cols.innerHTML = '';

        columns.forEach(function (name, index) {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'table-col-name';
            // ใช้ data-table-column (ไม่ใช่ data-field) เพื่อไม่ให้ปนกับค่าของ type
            input.dataset.tableColumn = field;
            input.dataset.tableColumnIndex = String(index);
            input.autocomplete = 'off';
            input.value = name || '';
            input.placeholder = 'ชื่อคอลัมน์ ' + (index + 1);
            input.setAttribute('aria-label', 'ชื่อคอลัมน์ ' + (index + 1) + ' ของ ' + field);
            nodes.cols.appendChild(input);
        });
    }

    // จำนวนที่ {{field}} ถูกวางไว้ในเอกสาร (นับเป็นย่อหน้า)
    // ว่างไว้ถ้านับไม่ได้ (ยังไม่โหลดไฟล์) หรือวางไว้ที่เดียว
    function renderTableUsage(field) {
        const form = document.getElementById('form');
        if (!form) return;

        let note = null;

        form.querySelectorAll('[data-table-usage]').forEach(function (node) {
            if (node.dataset.tableUsage === field) note = node;
        });

        if (!note) return;

        const usage =
            scope.App &&
            scope.App.getFieldUsage
                ? scope.App.getFieldUsage()
                : {};

        const copies = usage[field] || 0;

        note.hidden = copies <= 1;
        note.textContent = copies > 1
            ? '⚠ วาง {{' + field + '}} ไว้ ' + copies + ' ที่ในเอกสาร ' +
                '→ ตอนสร้างเอกสารจะได้ตาราง ' + copies + ' อัน ' +
                'ถ้าต้องการที่เดียว ให้เหลือไว้ที่เดียวใน template แล้ววางไฟล์ใหม่'
            : '';
    }

    // ซิงก์ช่องตั้งค่าตารางของ field ให้ตรงกับ type ที่เลือกและโครงที่เก็บไว้
    function renderTableConfig(field) {
        const nodes = tableNodes(field);
        if (!nodes.box) return;

        const control = scope.FormPage.findControl(field);
        const isTable = !!control && control.value === 'table';

        nodes.box.hidden = !isTable;

        // ช่อง placeholder ไม่ใช้กับตาราง (ชื่อคอลัมน์บอกความหมายอยู่แล้ว)
        const form = document.getElementById('form');

        if (form) {
            form.querySelectorAll('[data-placeholder-field]').forEach(function (input) {
                if (input.dataset.placeholderField === field) {
                    input.hidden = isTable;
                }
            });
        }

        if (!isTable) return;

        const schema = scope.FieldTypes.getTableSchema(field);

        if (nodes.count) nodes.count.value = String(schema.columns.length);

        renderColumnInputs(field, schema.columns);
        renderTableUsage(field);
    }

    function renderAllTableConfigs() {
        const form = document.getElementById('form');
        if (!form) return;

        form.querySelectorAll('[data-table-config]').forEach(function (node) {
            renderTableConfig(node.dataset.tableConfig);
        });
    }

    // field ที่ถูกล็อกตำแหน่ง (เก็บแยกจากค่าของ type)
    let lockState = {};

    // placeholder (ข้อความตัวอย่าง) ของแต่ละ field (เก็บแยกจากค่าของ type)
    let placeholderState = {};

    // เติมสถานะติ๊กกลับเข้า checkbox หลังฟอร์มถูกวาดใหม่
    function renderLockState() {
        const form = document.getElementById('form');
        if (!form) return;

        form.querySelectorAll('[data-lock-field]').forEach(function (box) {
            box.checked = lockState[box.dataset.lockField] === true;
        });
    }

    // เติม placeholder ที่ตั้งไว้กลับเข้าช่อง หลังฟอร์มถูกวาดใหม่
    function renderPlaceholderState() {
        const form = document.getElementById('form');
        if (!form) return;

        form.querySelectorAll('[data-placeholder-field]').forEach(function (input) {
            const field = input.dataset.placeholderField;

            input.value =
                Object.prototype.hasOwnProperty.call(placeholderState, field)
                    ? placeholderState[field]
                    : '';
        });
    }

    const baseRenderForm = page.renderForm;

    page.renderForm = function (fields) {
        baseRenderForm.call(page, fields);
        renderLockState();
        renderPlaceholderState();
        renderAllTableConfigs();
    };

    const baseApplyValues = page.applyValues;

    // ค่า type ถูกเติมกลับหลังฟอร์มถูกวาด จึงต้องอัปเดตช่องตั้งค่าตารางอีกครั้ง
    // ไม่งั้น field ที่บันทึกไว้ว่าเป็น Table จะยังซ่อนช่องตั้งค่าอยู่
    page.applyValues = function (values) {
        baseApplyValues.call(page, values);
        renderAllTableConfigs();
    };

    // ── โครงตาราง: ให้ app.js เรียกเมื่อผู้ใช้แก้ค่าที่หน้า Template Configuration ──

    // อัปเดตช่องตั้งค่าตารางของ field นี้ (เรียกเมื่อเปลี่ยน type)
    page.refreshTableConfig = renderTableConfig;

    // จำนวนคอลัมน์: ตัด/ต่อชื่อหัวคอลัมน์ให้ครบตามจำนวนใหม่
    page.setTableCount = function (field, value) {
        const raw = String(value == null ? '' : value).trim();

        // ระหว่างพิมพ์ (ลบเลขจนว่าง) ยังไม่ต้องแก้อะไร
        if (raw === '') return;

        const count = Math.min(
            Math.max(Math.round(Number(raw)) || 1, 1),
            scope.FieldTypes.tableMaxColumns
        );

        const columns = scope.FieldTypes.getTableSchema(field).columns.slice(0, count);

        while (columns.length < count) {
            columns.push('คอลัมน์ ' + (columns.length + 1));
        }

        scope.FieldTypes.setTableSchema(field, { columns: columns });

        renderTableConfig(field);
    };

    page.setTableColumn = function (field, index, value) {
        const schema = scope.FieldTypes.getTableSchema(field);

        if (!(index >= 0 && index < schema.columns.length)) return;

        schema.columns[index] = String(value == null ? '' : value);
        scope.FieldTypes.setTableSchema(field, schema);
    };

    // โครงตารางของทุก field ที่เป็น type table (บันทึกพร้อม template)
    page.getTableSchemas = function (types) {
        const byType = types || page.getValues();
        const schemas = {};

        Object.keys(byType).forEach(function (field) {
            if (byType[field] === 'table') {
                schemas[field] = scope.FieldTypes.getTableSchema(field);
            }
        });

        return schemas;
    };

    // คืนโครงตารางที่บันทึกไว้กลับมา (ตอนโหลด template) — null/{} = ไม่มีตาราง
    page.setTableSchemas = function (schemas) {
        scope.FieldTypes.setTableSchemas(schemas);
        renderAllTableConfigs();
    };

    page.setLock = function (field, locked) {
        if (locked) {
            lockState[field] = true;
        } else {
            delete lockState[field];
        }
    };

    page.getLocks = function () {
        return Object.assign({}, lockState);
    };

    // คืนค่าที่บันทึกไว้กลับมา (ตอนโหลด template) — null/{} = ไม่มี field ที่ล็อก
    page.setLocks = function (locks) {
        lockState = {};

        if (locks && typeof locks === 'object') {
            Object.keys(locks).forEach(function (field) {
                if (locks[field]) lockState[field] = true;
            });
        }

        renderLockState();
    };

    // เก็บ placeholder ของ field — ว่าง = ลบออก (กลับไปใช้ค่าเริ่มต้นในหน้ารายงาน)
    page.setPlaceholder = function (field, value) {
        const text = String(value == null ? '' : value);

        if (text.trim() === '') {
            delete placeholderState[field];
        } else {
            placeholderState[field] = text;
        }
    };

    page.getPlaceholders = function () {
        return Object.assign({}, placeholderState);
    };

    // คืนค่าที่บันทึกไว้กลับมา (ตอนโหลด template) — null/{} = ไม่มี placeholder
    page.setPlaceholders = function (placeholders) {
        placeholderState = {};

        if (placeholders && typeof placeholders === 'object') {
            Object.keys(placeholders).forEach(function (field) {
                const value = String(placeholders[field] == null ? '' : placeholders[field]);

                if (value.trim() !== '') placeholderState[field] = value;
            });
        }

        renderPlaceholderState();
    };

    page.setSaveEnabled = function (enabled) {
        const btn = document.getElementById('saveBtn');
        if (btn) btn.disabled = !enabled;

        // ปุ่มที่ต้องมีไฟล์ template อยู่ในมือก่อน (ดาวน์โหลดต้นฉบับ / อัปโหลดทับ)
        ['downloadTemplateBtn', 'replaceTemplateBtn'].forEach(function (id) {
            const actionBtn = document.getElementById(id);
            if (actionBtn) actionBtn.disabled = !enabled;
        });
    };

    page.setDbStatus = function (text, kind) {
        const el = document.getElementById('dbStatus');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'db-status' + (kind ? ' ' + kind : '');
    };

    page.renderTemplateList = function (records, errorMessage) {
        const list = document.getElementById('savedList');
        if (!list) return;

        list.innerHTML = '';

        const message = errorMessage
            ? errorMessage
            : (records && records.length === 0 ? 'ยังไม่มี template ที่บันทึกไว้' : '');

        if (message) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = message;
            list.appendChild(empty);
            return;
        }

        for (const record of records) {
            list.appendChild(createSavedItem(record));
        }
    };

    scope.TemplateConfigPage = page;
})(window);
