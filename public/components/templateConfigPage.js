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

    const ACTIONS_HTML =
        '<button id="saveBtn" type="button" disabled>Save Template</button>';

    const FOOTER_HTML = [
        '<section class="saved-templates">',
        '    <h2>Template ที่บันทึกไว้</h2>',
        '    <p id="dbStatus" class="db-status"></p>',
        '    <ul id="savedList" class="saved-list"></ul>',
        '</section>'
    ].join('\n');

    function createTypeSelect(field) {
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
        return select;
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
    page.setSaveEnabled = function (enabled) {
        const btn = document.getElementById('saveBtn');
        if (btn) btn.disabled = !enabled;
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
