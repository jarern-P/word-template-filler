// Form Page Factory - สร้างหน้าฟอร์มกรอกค่า {{field}}
// ใช้ร่วมกันทั้งหน้า Report และ Template Configuration เพื่อลดโค้ดซ้ำ
(function (scope) {
    'use strict';

    const FORM_ID = 'form';
    const FIELD_SELECTOR = '[data-field]';

    function getFormElement() {
        return document.getElementById(FORM_ID);
    }

    // ── อ่าน/เขียนค่าของ control (รวม checkbox ที่ใช้ checked ไม่ใช่ value) ──
    function readControlValue(control) {
        if (control.type === 'checkbox') {
            return control.checked ? 'true' : 'false';
        }
        return control.value;
    }

    function writeControlValue(control, value) {
        if (control.type === 'checkbox') {
            control.checked =
                value === true || value === 'true' || value === '1' || value === 'on';
            return;
        }
        control.value = value;
    }

    // ค่าเริ่มต้น: ช่องข้อความธรรมดา
    function createTextField(field) {
        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.field = field;
        input.placeholder = 'กรอก ' + field;
        return input;
    }

    function wrapField(field, control) {
        const wrapper = document.createElement('div');
        wrapper.className = 'field';

        const label = document.createElement('label');
        label.textContent = field;

        wrapper.appendChild(label);
        wrapper.appendChild(control);
        return wrapper;
    }

    // สร้าง component ของหน้า โดยกำหนด title, วิธี render control ของแต่ละ field
    // และ HTML เสริมได้ 3 จุด: metaHTML (ใต้กล่องเลือกไฟล์), actionsHTML (ก่อนปุ่ม), footerHTML (ท้ายหน้า)
    function create(config) {
        const title = config.title;
        const formTitle = config.formTitle || 'กรอกข้อมูล';
        const renderControl = config.renderControl || createTextField;
        const metaHTML = config.metaHTML || '';
        const actionsHTML = config.actionsHTML || '';
        const footerHTML = config.footerHTML || '';
        const emptyMessage = config.emptyMessage || '';
        const showFileInput = config.showFileInput !== false;
        // หน้าที่มีแต่ค่า config (เช่น หน้า Template Configuration) ไม่ควรมีปุ่มดาวน์โหลด
        const showDownload = config.showDownload !== false;

        return {
            title: title,

            // HTML โครงของหน้าทั้งหมด (cache ได้)
            getHTML: function () {
                const parts = ['<h1>' + title + '</h1>'];

                if (showFileInput) {
                    parts.push(
                        '<div class="box">',
                        '    <input type="file" id="fileInput" accept=".docx">',
                        '</div>'
                    );
                }

                parts.push(metaHTML, '<div id="form"></div>', actionsHTML);

                if (showDownload) {
                    parts.push('<button id="downloadBtn" type="button" style="display:none">Download DOCX</button>');
                }

                parts.push(
                    '<button id="clearBtn" type="button" style="display:none">Clear</button>',
                    footerHTML
                );

                return parts.join('\n');
            },

            // วาดฟอร์มจากรายชื่อ field ที่พบใน template
            renderForm: function (fields) {
                const form = getFormElement();
                if (!form) return;

                form.innerHTML = '';

                if (!fields || fields.length === 0) {
                    const message = document.createElement('p');
                    message.textContent = 'ไม่พบ {{field}} ใน Template';
                    form.appendChild(message);
                    return;
                }

                const heading = document.createElement('h2');
                heading.textContent = formTitle;
                form.appendChild(heading);

                for (const field of fields) {
                    form.appendChild(wrapField(field, renderControl(field)));
                }
            },

            // ข้อความตอนยังไม่มี template ให้กรอก
            showEmptyState: function () {
                const form = getFormElement();
                if (!form) return;

                form.innerHTML = '';

                if (!emptyMessage) return;

                const hint = document.createElement('p');
                hint.className = 'hint';
                hint.textContent = emptyMessage;
                form.appendChild(hint);
            },

            // เติมค่าที่เคยกรอกไว้กลับเข้า control (ใช้ตอนสลับหน้า)
            applyValues: function (values) {
                const form = getFormElement();
                if (!form || !values) return;

                form.querySelectorAll(FIELD_SELECTOR).forEach(function (control) {
                    if (Object.prototype.hasOwnProperty.call(values, control.dataset.field)) {
                        writeControlValue(control, values[control.dataset.field]);
                    }
                });
            },

            // รวมค่าจาก control ทั้งหมดในฟอร์ม
            getValues: function () {
                const values = {};
                const form = getFormElement();
                if (!form) return values;

                form.querySelectorAll(FIELD_SELECTOR).forEach(function (control) {
                    values[control.dataset.field] = readControlValue(control);
                });
                return values;
            },

            hideButtons: function () {
                this.showDownloadButton(false);
                this.showClearButton(false);
            },

            showDownloadButton: function (show) {
                const btn = document.getElementById('downloadBtn');
                if (btn) btn.style.display = show ? 'block' : 'none';
            },

            showClearButton: function (show) {
                const btn = document.getElementById('clearBtn');
                if (btn) btn.style.display = show ? 'block' : 'none';
            },

            // ล้างค่าใน input file เพื่อให้เลือกไฟล์เดิมซ้ำได้
            resetFileInput: function () {
                const fileInput = document.getElementById('fileInput');
                if (fileInput) fileInput.value = '';
            }
        };
    }

    scope.FormPage = {
        create: create,
        readControlValue: readControlValue,
        writeControlValue: writeControlValue
    };
})(window);
