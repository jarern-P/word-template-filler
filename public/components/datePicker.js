// Date Picker - dropdown เลือกวันที่ + รูปแบบการเขียน (ไทย / สากล) ของช่อง type date
//
// โครงเดียวกับ components/masterLookup.js: สร้าง overlay ครั้งเดียวแล้วใช้ซ้ำ
// ปุ่มที่เปิดคือปุ่มปฏิทินที่ FieldTypes สร้างให้ (data-date-format-for="<ชื่อ field>")
// เลือกวัน/เดือน/ปี + รูปแบบ แล้วกด "ตกลง" → เขียนข้อความที่จัดรูปแบบแล้วลงช่อง
// [data-field] ของหน้ารายงาน และยิง event input/change ให้ app.js เก็บค่าเหมือนพิมพ์เอง
(function (scope) {
    'use strict';

    const HTML = [
        '<div class="date-picker-backdrop"></div>',
        '<div class="date-picker-panel" id="datePickerPanel" role="dialog" aria-labelledby="datePickerTitle">',
        '    <div class="date-picker-head">',
        '        <h2 id="datePickerTitle">วันที่และรูปแบบ</h2>',
        '        <button type="button" class="date-picker-close" aria-label="ปิด">&times;</button>',
        '    </div>',
        '    <label class="date-picker-field" for="datePickerValue">',
        '        <span>วันที่</span>',
        '        <input type="date" id="datePickerValue">',
        '    </label>',
        '    <ul class="date-format-list" id="datePickerList"></ul>',
        '    <div class="date-picker-actions">',
        '        <button type="button" class="date-picker-cancel">ยกเลิก</button>',
        '        <button type="button" class="date-picker-ok">ตกลง</button>',
        '    </div>',
        '</div>'
    ].join('\n');

    let overlay = null;       // dropdown (สร้างครั้งเดียวตอนเปิดครั้งแรก)
    let panel = null;
    let activeField = '';     // ชื่อ field ที่กำลังเลือกวันที่ให้
    let activeButton = null;  // ปุ่มที่เปิด dropdown (ใช้หาตำแหน่ง)
    let selectedFormat = '';  // รูปแบบที่เลือกไว้ใน dropdown รอบนี้

    function el(id) {
        return document.getElementById(id);
    }

    function pickedParts() {
        const input = el('datePickerValue');
        return input ? scope.FieldTypes.parseIsoDate(input.value) : null;
    }

    // ──────────────────────────────────────────────────────────────
    // วาดรายการรูปแบบ
    // ──────────────────────────────────────────────────────────────

    // ตัวอย่างของแต่ละรูปแบบคิดจากวันที่ที่เลือกอยู่ใน dropdown
    // จึงเห็นทันทีว่าเลือกวันนี้แล้วข้อความที่จะลงช่องหน้าตาเป็นอย่างไร
    function renderFormatList() {
        const list = el('datePickerList');
        if (!list) return;

        const parts = pickedParts();
        list.innerHTML = '';

        scope.FieldTypes.dateFormatOptions().forEach(function (option) {
            const item = document.createElement('li');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'date-format-item' +
                (option.value === selectedFormat ? ' selected' : '');
            button.dataset.dateFormat = option.value;

            const example = document.createElement('span');
            example.className = 'date-format-example';
            example.textContent = parts
                ? scope.FieldTypes.formatDate(option.value, parts)
                : option.example;

            const label = document.createElement('span');
            label.className = 'date-format-label';
            label.textContent = option.label;

            button.appendChild(example);
            button.appendChild(label);
            item.appendChild(button);
            list.appendChild(item);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // เขียนค่ากลับเข้าฟอร์ม
    // ──────────────────────────────────────────────────────────────

    function apply() {
        const control = scope.FormPage.findControl(activeField);
        const parts = pickedParts();

        if (!control || !parts) {
            close();
            return;
        }

        scope.FieldTypes.setDateFormat(activeField, selectedFormat);

        scope.FormPage.writeControlValue(
            control,
            scope.FieldTypes.formatDate(selectedFormat, parts)
        );

        // ให้ app.js เก็บค่าและล้างคำเตือนล็อกตำแหน่งเหมือนผู้ใช้พิมพ์เอง
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));

        close();
    }

    // ──────────────────────────────────────────────────────────────
    // ตำแหน่งของ dropdown (วางใต้ปุ่ม ถ้าล้นขอบล่างก็พลิกไปด้านบน)
    // ──────────────────────────────────────────────────────────────

    function positionPanel() {
        if (!panel || !activeButton) return;

        panel.style.visibility = 'hidden';

        const button = activeButton.getBoundingClientRect();
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const gap = 6;
        const margin = 12;

        // ชิดขวากับปุ่ม แต่ต้องไม่ล้นกรอบจอ
        let left = Math.min(button.right - width, window.innerWidth - width - margin);
        if (left < margin) left = margin;

        let top = button.bottom + gap;

        if (top + height > window.innerHeight - margin) {
            top = button.top - height - gap;   // ด้านล่างไม่พอ -> วางด้านบนปุ่ม
        }

        if (top < margin) top = margin;

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.visibility = 'visible';
    }

    // ──────────────────────────────────────────────────────────────
    // เปิด / ปิด dropdown
    // ──────────────────────────────────────────────────────────────

    function close() {
        if (overlay) {
            overlay.classList.remove('open');
        }

        activeField = '';
        activeButton = null;
    }

    function fillPicker(field) {
        const control = scope.FormPage.findControl(field);
        const parts = control
            ? scope.FieldTypes.parseDateInput(control.value)
            : null;

        // ค่าที่กรอกไว้ใช้ไม่ได้ -> เริ่มที่วันนี้ (กดตกลงแล้วได้ค่าลงช่องทันที)
        const input = el('datePickerValue');
        if (input) {
            input.value = scope.FieldTypes.partsToIso(
                parts || scope.FieldTypes.todayParts()
            );
        }
    }

    function open(field, button) {
        buildOverlay();

        activeField = field;
        activeButton = button;
        selectedFormat = scope.FieldTypes.getDateFormat(field);

        const title = el('datePickerTitle');
        if (title) {
            title.textContent = 'วันที่ — ' + field;
        }

        fillPicker(field);
        renderFormatList();

        overlay.classList.add('open');
        positionPanel();

        const input = el('datePickerValue');
        if (input && input.focus) {
            input.focus();
        }
    }

    function buildOverlay() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'date-picker-overlay';
        overlay.id = 'datePicker';
        overlay.innerHTML = HTML;

        document.body.appendChild(overlay);

        panel = el('datePickerPanel');

        overlay.querySelector('.date-picker-backdrop').addEventListener('click', close);
        overlay.querySelector('.date-picker-close').addEventListener('click', close);
        overlay.querySelector('.date-picker-cancel').addEventListener('click', close);
        overlay.querySelector('.date-picker-ok').addEventListener('click', apply);

        // เลือกวันแล้วตัวอย่างของทุกรูปแบบอัปเดตตาม
        el('datePickerValue').addEventListener('change', renderFormatList);
        el('datePickerValue').addEventListener('input', renderFormatList);

        el('datePickerList').addEventListener('click', function (event) {
            const button = event.target.closest
                ? event.target.closest('.date-format-item')
                : null;

            if (!button) return;

            selectedFormat = button.dataset.dateFormat;
            renderFormatList();
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                close();
            }
        });

        // dropdown วางด้วย position: fixed จึงต้องขยับตามเมื่อเลื่อนหน้า/ย่อขยายหน้าต่าง
        window.addEventListener('resize', function () {
            if (overlay.classList.contains('open')) positionPanel();
        });

        window.addEventListener('scroll', function () {
            if (overlay.classList.contains('open')) positionPanel();
        }, true);
    }

    // ปุ่มปฏิทินถูกสร้างใหม่ทุกครั้งที่ render ฟอร์ม จึงใช้ event delegation
    document.addEventListener('click', function (event) {
        const button = event.target.closest
            ? event.target.closest('[data-date-format-for]')
            : null;

        if (!button) return;

        event.preventDefault();
        open(button.dataset.dateFormatFor, button);
    });

    scope.DatePicker = {
        open: open,
        close: close
    };
})(window);
