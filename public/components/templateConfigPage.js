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

    // select เลือก type + checkbox "ล็อกตำแหน่ง" ของ field นั้น
    function createTypeSelect(field) {
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
        return row;
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

    // field ที่ถูกล็อกตำแหน่ง (เก็บแยกจากค่าของ type)
    let lockState = {};

    // เติมสถานะติ๊กกลับเข้า checkbox หลังฟอร์มถูกวาดใหม่
    function renderLockState() {
        const form = document.getElementById('form');
        if (!form) return;

        form.querySelectorAll('[data-lock-field]').forEach(function (box) {
            box.checked = lockState[box.dataset.lockField] === true;
        });
    }

    const baseRenderForm = page.renderForm;

    page.renderForm = function (fields) {
        baseRenderForm.call(page, fields);
        renderLockState();
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
