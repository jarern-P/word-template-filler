// Report Page Component - เลือก template ที่บันทึกไว้ แล้วกรอกค่าตาม type
(function (scope) {
    'use strict';

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

    const page = scope.FormPage.create({
        title: 'Word Template Filler',
        showFileInput: false,
        metaHTML: META_HTML,
        emptyMessage: 'ยังไม่มี template — เลือกจาก dropdown ด้านบน หรือไปเลือกไฟล์ที่หน้า Template Configuration ก่อน',

        renderControl: function (field) {
            return scope.FieldTypes.createFieldControl(getConfiguredTypes()[field], field);
        }
    });

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
    // ค่าที่จะเขียนลงเอกสาร (วันที่ถูกแปลงเป็นรูปแบบไทย)
    // เก็บค่าในฟอร์มเป็น ISO ไว้ก่อน เพื่อให้ <input type="date"> ยังใช้ได้
    // ──────────────────────────────────────────────────────────────
    const baseGetValues = page.getValues;
    const baseApplyValues = page.applyValues;

    page.getValues = function () {
        const values = baseGetValues.call(page);
        const types = getConfiguredTypes();

        Object.keys(values).forEach(function (field) {
            values[field] = scope.FieldTypes.formatValue(types[field], values[field]);
        });
        return values;
    };

    // แสดงวันที่แบบไทยกำกับใต้ช่องวันที่
    page.refreshPreviews = function () {
        const form = document.getElementById('form');
        if (!form) return;

        const types = getConfiguredTypes();
        const previews = {};
        const controls = {};

        form.querySelectorAll('[data-preview-for]').forEach(function (preview) {
            previews[preview.dataset.previewFor] = preview;
        });

        form.querySelectorAll('[data-field]').forEach(function (control) {
            controls[control.dataset.field] = control;
        });

        Object.keys(previews).forEach(function (field) {
            const control = controls[field];
            const preview = previews[field];
            if (!control) return;

            const raw = scope.FormPage.readControlValue(control);
            preview.textContent = raw === ''
                ? ''
                : scope.FieldTypes.formatValue(types[field], raw);
        });
    };

    page.applyValues = function (values) {
        baseApplyValues.call(page, values);
        page.refreshPreviews();
    };

    scope.ReportPage = page;
})(window);
