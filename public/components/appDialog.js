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
        inputEl = el('appDialogInput');
        okBtn = el('appDialogOk');
        cancelBtn = el('appDialogCancel');

        okBtn.addEventListener('click', function () {
            settle(okBtn.dataset.kind === 'prompt' ? inputEl.value : true);
        });

        cancelBtn.addEventListener('click', function () {
            settle(cancelValue());
        });

        root.querySelectorAll('[data-app-dialog-cancel]').forEach(function (node) {
            node.addEventListener('click', function () {
                settle(cancelValue());
            });
        });

        // Enter = ตกลง, Esc = ยกเลิก
        // listener อยู่บนกล่อง (ไม่ใช่ document) จึงหยุดไม่ให้ Esc ไปปิด
        // popup ที่เปิดอยู่ข้างหลัง (หน้าจัดตำแหน่ง / page modal)
        root.addEventListener('keydown', function (event) {
            if (!current) return;

            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                settle(okBtn.dataset.kind === 'prompt' ? inputEl.value : true);
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                settle(cancelValue());
            }
        });
    }

    function cancelValue() {
        return okBtn && okBtn.dataset.kind === 'prompt' ? null : false;
    }

    // ปิดกล่องแล้วตอบคำถามที่ค้างอยู่ พร้อมคืนโฟกัสให้ช่องเดิม
    function settle(value) {
        if (!current) return;

        const done = current.resolve;

        current = null;
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

        // กล่องถัดไปในคิว (ถ้ามี) จะเปิดให้ในเฟรมถัดไป
        window.setTimeout(next, 0);
    }

    function next() {
        const item = queue.shift();

        if (!item) return;

        current = item;
        render(item.options);
    }

    function render(options) {
        const kind = options.kind;
        const danger = options.danger === true;

        lastFocused = document.activeElement;

        titleEl.textContent = options.title || '';

        // ข้อความที่มี \n (หลายย่อหน้า) ต้องขึ้นบรรทัดใหม่ตามที่เขียนไว้
        messageEl.textContent = options.message || '';
        messageEl.classList.toggle('empty', !options.message);

        inputEl.hidden = kind !== 'prompt';
        inputEl.value = kind === 'prompt' ? String(options.value == null ? '' : options.value) : '';

        okBtn.textContent = options.okText || 'ตกลง';
        okBtn.dataset.kind = kind;
        okBtn.className = danger ? 'danger' : '';
        cancelBtn.textContent = options.cancelText || 'ยกเลิก';
        cancelBtn.hidden = kind === 'alert';

        root.classList.add('open');

        // โฟกัสช่องกรอกของ prompt / ปุ่มตกลงของกล่องอื่น แล้วเลือกข้อความเดิมไว้ให้พิมพ์ทับได้เลย
        window.setTimeout(function () {
            if (!current) return;

            if (kind === 'prompt') {
                inputEl.focus();
                inputEl.select();
            } else if (okBtn) {
                okBtn.focus();
            }
        }, 20);
    }

    function show(kind, message, options) {
        const settings = Object.assign({}, options || {}, {
            kind: kind,
            message: message
        });

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
            return show('prompt', message, Object.assign({}, options || {}, { value: value }));
        }
    };
})(window);
