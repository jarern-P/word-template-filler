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
        metaHTML: META_HTML,
        actionsHTML: ACTIONS_HTML,
        footerHTML: FOOTER_HTML,
        emptyMessage: 'ยังไม่มี template — เลือกจาก dropdown ด้านบน หรือไปเลือกไฟล์ที่หน้า Template Configuration ก่อน',

        // ช่องที่เป็น type text จะมีปุ่มแว่นขยายให้เลือกค่าจาก Master Data
        renderControl: function (field) {
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
    };

    scope.ReportPage = page;
})(window);
