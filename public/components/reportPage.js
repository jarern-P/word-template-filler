// Report Page Component - เลือก template ที่บันทึกไว้ แล้วกรอกค่าตาม type
(function (scope) {
    'use strict';

    // เตือนเมื่อล็อกตำแหน่งไม่สมบูรณ์ เช่น ช่องว่างด้านหน้า field ไม่พอให้ลบ
    const FOOTER_HTML =
        '<p id="replaceWarning" class="replace-warning" style="display:none"></p>';

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
        metaHTML: META_HTML,
        footerHTML: FOOTER_HTML,
        emptyMessage: 'ยังไม่มี template — เลือกจาก dropdown ด้านบน หรือไปเลือกไฟล์ที่หน้า Template Configuration ก่อน',

        // ช่องที่เป็น type text จะมีปุ่มแว่นขยายให้เลือกค่าจาก Master Data
        renderControl: function (field) {
            return scope.FieldTypes.createFieldControl(
                getConfiguredTypes()[field],
                field,
                { lookup: true }
            );
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

            // currency มีปุ่ม toggle เป็นของตัวเอง — ค่า canonical อยู่ที่ dataset
            // แล้วแสดงรูปแบบ "อีกโหมด" กำกับใต้ช่องเพื่อเทียบค่าได้
            if (control.dataset.currencyInput === '1') {
                const digits = control.dataset.currencyValue || '';

                preview.textContent = digits === ''
                    ? ''
                    : scope.FieldTypes.currencyPreviewText(
                        digits,
                        scope.FieldTypes.getCurrencyMode(field)
                    );
                return;
            }

            preview.textContent = raw === ''
                ? ''
                : scope.FieldTypes.formatValue(types[field], raw);
        });
    };

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
        page.refreshPreviews();
    };

    scope.ReportPage = page;
})(window);
