// App Dialog - กล่อง แจ้งเตือน / ยืนยัน / กรอกข้อความ ของแอปเอง
//
// ทำไมไม่ใช้ window.alert / window.confirm / window.prompt
// ---------------------------------------------------------
// ใน Electron กล่องทั้งสามเป็นหน้าต่างของ Chromium ที่ดึงโฟกัสในระดับระบบปฏิบัติการ
// พอปิดแล้วหน้าต่างหลักบางครั้ง "ไม่ได้รับโฟกัสคืน" คีย์บอร์ดจึงไม่เข้าช่องพิมพ์
// ต้องสลับไปหน้าต่างโปรแกรมอื่นแล้วกลับมา (หรือคลิกที่หน้าต่าง) จึงพิมพ์ต่อได้
// อาการนี้เกิดกับทุกหน้าที่เรียกกล่องเหล่านี้ — ไม่ใช่แค่หน้าจัดตำแหน่ง
//
// ไฟล์นี้ทำกล่องเองเป็น DOM ในหน้าต่างเดิม จึงไม่มีการยึดโฟกัสระดับ OS
// และตอนปิดจะคืนโฟกัสให้ช่องที่โฟกัสอยู่ก่อนเปิด (ช่องพิมพ์/ย่อหน้าที่กำลังแก้)
// ผู้ใช้จึงพิมพ์ต่อได้ทันที
//
// ใช้แบบ Promise (await):
//   await AppDialog.alert('ข้อความ')
//   if (!(await AppDialog.confirm('ยืนยัน?'))) return;
//   const name = await AppDialog.prompt('ชื่อใหม่', ชื่อเดิม)
//
// ทุกฟังก์ชันเปิดได้ทีละกล่อง — ถ้าเรียกซ้อนจะเข้าคิวแล้วเปิดต่อให้เอง
(function (scope) {
    'use strict';

    const Z_INDEX = 200;   // สูงกว่า popup หน้าจัดตำแหน่ง (130) และ page modal

    let root = null;
    let titleEl = null;
    let messageEl = null;
    let fieldsHost = null;
    let inputEl = null;
    let okBtn = null;
    let cancelBtn = null;

    let current = null;      // กล่องที่เปิดอยู่ { options, resolve }
    let lastFocused = null;  // element ที่โฟกัสอยู่ก่อนเปิดกล่อง
    const queue = [];        // กล่องที่รอคิว

    const HTML = [
        '<div class="app-dialog-backdrop" data-app-dialog-cancel></div>',
        '<div class="app-dialog-box" role="alertdialog" aria-modal="true">',
        '    <h3 class="app-dialog-title" id="appDialogTitle"></h3>',
        '    <p class="app-dialog-message" id="appDialogMessage"></p>',
        '    <div class="app-dialog-fields" id="appDialogFields"></div>',
        '    <input type="text" class="app-dialog-input" id="appDialogInput" autocomplete="off">',
        '    <div class="app-dialog-buttons">',
        '        <button type="button" class="plain" id="appDialogCancel">ยกเลิก</button>',
        '        <button type="button" id="appDialogOk">ตกลง</button>',
        '    </div>',
        '</div>'
    ].join('\n');

    function el(id) {
        return document.getElementById(id);
    }

    function build() {
        if (root) return;

        root = document.createElement('div');
        root.className = 'app-dialog';
        root.id = 'appDialog';
        root.style.zIndex = String(Z_INDEX);
        root.innerHTML = HTML;

        document.body.appendChild(root);

        titleEl = el('appDialogTitle');
        messageEl = el('appDialogMessage');
        fieldsHost = el('appDialogFields');
        inputEl = el('appDialogInput');
        okBtn = el('appDialogOk');
        cancelBtn = el('appDialogCancel');

        okBtn.addEventListener('click', onOkClick);
        cancelBtn.addEventListener('click', onCancelClick);

        root.querySelectorAll('[data-app-dialog-cancel]').forEach(function (node) {
            node.addEventListener('click', onCancelClick);
        });

        root.addEventListener('keydown', onRootKeydown);
    }

    function onOkClick() {
        settle(okBtn.dataset.kind === 'prompt-multi' ? gatherValues() : (okBtn.dataset.kind === 'prompt' ? inputEl.value : true));
    }

    function onCancelClick() {
        settle(cancelValue());
    }

    function onRootKeydown(event) {
        if (!current) return;

        if (event.key === 'Enter') {
            // ในช่องหลายบรรทัด Enter = ขึ้นบรรทัดใหม่ (Ctrl/Cmd + Enter = ตกลง)
            if (
                event.target &&
                event.target.tagName === 'TEXTAREA' &&
                !event.ctrlKey &&
                !event.metaKey
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            settle(okBtn.dataset.kind === 'prompt-multi' ? gatherValues() : (okBtn.dataset.kind === 'prompt' ? inputEl.value : true));
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            settle(cancelValue());
        }
    }

    // ปิดกล่องแล้วตอบคำถามที่ค้างอยู่ พร้อมคืนโฟกัสให้ช่องเดิม
    function cancelValue() {
        return okBtn && okBtn.dataset.kind === 'prompt' ? null : false;
    }

    function gatherValues() {
        if (!current) return null;

        if (current.fields) {
            const result = {};

            current.fields.forEach(function (field, index) {
                const input = current.inputs && current.inputs[index];
                result[field && field.id] = input ? input.value : '';
            });

            return result;
        }

        return inputEl && inputEl.value != null ? inputEl.value : '';
    }

    function settle(value) {
        if (!current) return;

        const done = current.resolve;

        root.classList.remove('open');

        // คืนโฟกัส = พิมพ์ต่อได้ทันทีโดยไม่ต้องคลิกกลับเข้าช่อง
        if (lastFocused && document.contains(lastFocused) && lastFocused.focus) {
            try {
                lastFocused.focus();
            } catch (error) {
                // element บางชนิดโฟกัสไม่ได้ — ไม่เป็นไร
            }
        }

        lastFocused = null;

        done(value);

        current = null;

        // กล่องถัดไปในคิว (ถ้ามี) จะเปิดให้ในเฟรมถัดไป
        window.setTimeout(next, 0);
    }

    function next() {
        const item = queue.shift();

        if (!item) return;

        current = item;
        render(item.options);
    }

    function renderField(field, record) {
        const wrap = document.createElement('div');
        wrap.className = 'app-dialog-field';

        const label = document.createElement('label');
        label.textContent = field.label || '';
        if (field.required) {
            const star = document.createElement('span');
            star.className = 'app-dialog-required';
            star.textContent = ' *';
            label.appendChild(star);
        }

        // type 'textarea' = ช่องหลายบรรทัด (เช่น คู่ข้อความฝึก OCR)
        const input = field.type === 'textarea'
            ? document.createElement('textarea')
            : document.createElement('input');

        if (field.type !== 'textarea') input.type = field.type || 'text';
        if (field.type === 'textarea') input.rows = 2;

        input.value = record ? String(record[field.id] || '') : '';
        if (field.placeholder) input.placeholder = field.placeholder;
        input.spellcheck = false;
        input.autocomplete = 'off';

        wrap.appendChild(label);
        wrap.appendChild(input);

        return { wrap: wrap, input: input, field: field };
    }

    function renderFields(fields, existing) {
        const host = document.createElement('div');
        host.className = 'app-dialog-fields';

        fields.forEach(function (field, index) {
            const record = (existing && existing[index]) || {};
            const { wrap, input } = renderField(field, record);
            host.appendChild(wrap);
        });

        return {
            host: host,
            inputs: host.querySelectorAll('input, textarea')
        };
    }

    function swapFields(newHost) {
        if (!fieldsHost) return;

        const old = fieldsHost.firstElementChild;
        if (old) {
            fieldsHost.replaceChild(newHost, old);
        } else {
            fieldsHost.appendChild(newHost);
        }
    }

    function render(options) {
        const kind = options.kind;
        const danger = options.danger === true;

        lastFocused = document.activeElement;

        titleEl.textContent = options.title || '';

        // ข้อความที่มี \n (หลายย่อหน้า) ต้องขึ้นบรรทัดใหม่ตามที่เขียนไว้
        messageEl.textContent = options.message || '';
        messageEl.classList.toggle('empty', !options.message);

        // รองรับกล่องกรอกหลายช่อง (prompt-multi)
        if (kind === 'prompt-multi' && options.fields) {
            inputEl.hidden = true;

            const existingFields = Array.isArray(options.value)
                ? options.value
                : [];

            const { host, inputs } = renderFields(options.fields, existingFields);            swapFields(host);

            // เก็บ resolve ของกล่องเดิมไว้ด้วย (Object.assign) —
            // ถ้าเขียนทับทั้งก้อนคำสัญญาจะไม่มีวันจบ
            current = Object.assign(current || {}, {
                inputs: inputs,
                fields: options.fields,
                singleInput: false
            });

            okBtn.dataset.kind = 'prompt-multi';
        } else {
            // กล่องช่องเดียวเหมือนเดิม
            if (!inputEl.parentNode) {
                root.appendChild(inputEl);
            }

            if (fieldsHost) {
                if (!fieldsHost.contains(inputEl)) {
                    fieldsHost.appendChild(inputEl);
                }
            }

            inputEl.hidden = kind !== 'prompt';
            inputEl.value = kind === 'prompt' ? String(options.value == null ? '' : options.value) : '';

            current = Object.assign(current || {}, {
                inputs: [inputEl],
                fields: null,
                singleInput: kind === 'prompt'
            });

            okBtn.dataset.kind = kind === 'prompt' ? 'prompt' : '';
        }

        okBtn.textContent = options.okText || 'ตกลง';
        okBtn.className = danger ? 'danger' : '';
        cancelBtn.textContent = options.cancelText || 'ยกเลิก';
        cancelBtn.hidden = kind === 'alert';

        root.classList.add('open');

        // โฟกัสช่องกรอกตัวแรก / ปุ่มตกลงของกล่องอื่น
        window.setTimeout(function () {
            if (!current) return;

            if (current.singleInput) {
                inputEl.focus();
                inputEl.select();
            } else if (current.inputs && current.inputs[0]) {
                current.inputs[0].focus();
                if (current.fields && current.fields[0] && current.fields[0].type !== 'textarea') {
                    try { current.inputs[0].select(); } catch (e) {}
                }
            } else if (okBtn) {
                okBtn.focus();
            }
        }, 20);
    }

    function unmount() {
        if (!root) return;

        root.classList.remove('open');

        const newCurrent = current;
        current = null;

        // คืนช่องกรอกเดี่ยวกลับเข้าตำแหน่งเดิม ถ้ายังอยู่ใน DOM
        if (inputEl.parentNode && newCurrent && newCurrent.singleInput) {
            const buttons = root.querySelector('.app-dialog-buttons');
            if (buttons) {
                const fieldsHost = root.querySelector('.app-dialog-fields');
                if (fieldsHost) {
                    root.removeChild(fieldsHost);
                }
            }
        }

        if (root.parentNode) {
            root.parentNode.removeChild(root);
        }

        root = null;
        titleEl = null;
        messageEl = null;
        fieldsHost = null;
        okBtn = null;
        cancelBtn = null;

        // inputEl เดี่ยวยังอยู่ใน DOM ในหน้าต่างอื่น ๆ ดังนั้นไม่ลบออกตรงนี้
        inputEl = null;
    }

    function show(kind, message, options) {
        // ค่าเริ่มต้นมาก่อน options — กล่องหลายช่องส่ง kind = 'prompt-multi'
        // มาพร้อม fields จึงต้องไม่ถูกทับด้วย kind = 'prompt'
        const settings = Object.assign(
            { kind: kind },
            options || {},
            { message: message }
        );

        build();

        return new Promise(function (resolve) {
            queue.push({ options: settings, resolve: resolve });

            if (!current) next();
        });
    }

    scope.AppDialog = {
        alert: function (message, options) {
            return show('alert', message, options);
        },

        confirm: function (message, options) {
            return show('confirm', message, options);
        },

        prompt: function (message, value, options) {
            // value สามารถเป็น string (ช่องเดียว) หรือ array ของ field descriptors (หลายช่อง)
            const normalized =
                Array.isArray(value)
                    ? { fields: value, kind: 'prompt-multi' }
                    : { value: value };

            return show('prompt', message, Object.assign({}, options || {}, normalized));
        }
    };
})(window);
