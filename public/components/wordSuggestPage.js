// Word Suggest Page - จัดการคำที่ใช้แนะนำตอนพิมพ์ (อยู่ในหมวด Master)
//
// เก็บ 2 อย่าง
//   - คำที่เพิ่มเอง (ฐานข้อมูล SQLite) — ใช้รวมกับพจนานุกรมกลางตอนแนะนำคำ
//   - สวิตช์เปิด/ปิดการแนะนำคำ
//
// หน้านี้ไม่ผูกกับไฟล์ .docx จึงประกาศ standalone = true
// ให้ app.js ข้ามขั้นตอนของหน้า template (เหมือนหน้า Master Data)
(function (scope) {
    'use strict';

    const HTML = [
        '<h1>คำแนะนำ</h1>',

        '<section class="suggest-settings">',
        '    <h2>การแนะนำคำ</h2>',

        '    <label class="switch-toggle" for="wordSuggestToggle">',
        '        <input type="checkbox" id="wordSuggestToggle" checked>',
        '        <span class="switch-box" aria-hidden="true"></span>',
        '        <span class="switch-text">แนะนำคำขณะพิมพ์ (กด Tab เพื่อใช้คำที่เลือก)</span>',
        '    </label>',

        '    <p class="hint" id="wordStats"></p>',

        '    <ul class="suggest-keys">',
        '        <li><kbd>Tab</kbd> ใช้คำที่เลือก</li>',
        '        <li><kbd>Enter</kbd> ใช้คำที่เลือก (ช่องข้อความ)</li>',
        '        <li><kbd>&uarr;</kbd> <kbd>&darr;</kbd> เลื่อนรายการ</li>',
        '        <li><kbd>Esc</kbd> ปิดรายการ</li>',
        '        <li><kbd>Shift</kbd> + <kbd>Tab</kbd> ข้ามไปช่องถัดไป</li>',
        '    </ul>',
        '</section>',

        '<section class="master-form">',
        '    <h2 id="wordFormTitle">เพิ่มคำที่แนะนำ</h2>',

        '    <div class="field">',
        '        <label for="wordInput">คำ</label>',
        '        <input type="text" id="wordInput" placeholder="เช่น จำนวนเงิน"' +
            ' autocomplete="off">',
        '    </div>',

        '    <input type="hidden" id="wordId" value="">',

        '    <p class="hint">คำที่เพิ่มเองจะถูกแนะนำก่อนคำในพจนานุกรมกลาง ' +
            'และตอนพิมพ์คำที่ยังไม่มีในพจนานุกรม จะมีรายการ "เพิ่มคำนี้" ให้กด Tab ด้วย</p>',

        '    <div class="form-actions">',
        '        <button id="wordAddBtn" type="button">เพิ่ม</button>',
        '        <button id="wordCancelBtn" type="button" class="plain"' +
            ' style="display:none">ยกเลิกแก้ไข</button>',
        '    </div>',

        '    <p id="wordFormStatus" class="db-status"></p>',
        '</section>',

        '<section class="saved-templates">',
        '    <h2>คำที่เพิ่มเอง</h2>',

        '    <div class="master-toolbar">',
        '        <label for="wordSearch">ค้นหา</label>',
        '        <input type="text" id="wordSearch" placeholder="คำ" autocomplete="off">',
        '    </div>',

        '    <p id="wordDbStatus" class="db-status"></p>',
        '    <ul id="wordList" class="saved-list"></ul>',
        '</section>'
    ].join('\n');

    let records = [];      // รายการล่าสุดที่โหลดมาจากฐานข้อมูล
    let searchText = '';   // คำค้นปัจจุบัน (ตัวพิมพ์เล็กแล้ว)

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────

    function el(id) {
        return document.getElementById(id);
    }

    function setValue(id, value) {
        const input = el(id);
        if (!input) return;
        input.value = (value === null || value === undefined) ? '' : String(value);
    }

    function setStatus(targetId, text, kind) {
        const node = el(targetId);
        if (!node) return;

        node.textContent = text || '';
        node.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    function formatDate(isoText) {
        const date = new Date(isoText);
        if (isNaN(date.getTime())) return isoText || '';
        return date.toLocaleString('th-TH');
    }

    function appendEmpty(list, message) {
        const item = document.createElement('li');
        item.className = 'empty';
        item.textContent = message;
        list.appendChild(item);
    }

    // ใช้ textContent ทุกจุด เพราะคำมาจากผู้ใช้ (กัน XSS)
    function createItem(record) {
        const item = document.createElement('li');
        item.className = 'saved-item';

        const info = document.createElement('div');
        info.className = 'info';

        const word = document.createElement('strong');
        word.textContent = record.word;

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = 'อัปเดต ' + formatDate(record.updated_at);

        info.appendChild(word);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'แก้ไข';
        editBtn.dataset.action = 'word-edit';
        editBtn.dataset.id = String(record.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'ลบ';
        deleteBtn.dataset.action = 'word-delete';
        deleteBtn.dataset.id = String(record.id);

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);
        return item;
    }

    // ──────────────────────────────────────────────────────────────
    // Page
    // ──────────────────────────────────────────────────────────────

    const page = {

        // หน้านี้จัดการ UI เอง ไม่ขึ้นกับ state ของไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        // ── ฟอร์มเพิ่ม / แก้ไข ──

        // id = 0 หมายถึงเพิ่มใหม่, id > 0 หมายถึงแก้ไข
        readForm: function () {
            const id = el('wordId');
            const word = el('wordInput');

            return {
                id: (id && id.value) ? Number(id.value) : 0,
                word: word ? word.value.trim() : ''
            };
        },

        setEditing: function (record) {
            const editing = !!record;

            setValue('wordId', editing ? record.id : '');

            const title = el('wordFormTitle');
            if (title) {
                title.textContent = editing
                    ? 'แก้ไขคำที่แนะนำ'
                    : 'เพิ่มคำที่แนะนำ';
            }

            const saveBtn = el('wordAddBtn');
            if (saveBtn) {
                saveBtn.textContent = editing ? 'บันทึกการแก้ไข' : 'เพิ่ม';
            }

            const cancelBtn = el('wordCancelBtn');
            if (cancelBtn) {
                cancelBtn.style.display = editing ? 'inline-block' : 'none';
            }
        },

        loadIntoForm: function (record) {
            if (!record) return;

            setValue('wordInput', record.word);

            page.setEditing(record);

            const input = el('wordInput');
            if (input && input.focus) input.focus();
        },

        resetForm: function () {
            setValue('wordInput', '');
            page.setEditing(null);
        },

        setSaveEnabled: function (enabled) {
            const btn = el('wordAddBtn');
            if (btn) btn.disabled = !enabled;
        },

        setFormStatus: function (text, kind) {
            setStatus('wordFormStatus', text, kind);
        },

        setDbStatus: function (text, kind) {
            setStatus('wordDbStatus', text, kind);
        },

        // ── สวิตช์เปิด/ปิด + สถิติ ──

        setSuggestEnabled: function (enabled) {
            const box = el('wordSuggestToggle');
            if (box) box.checked = enabled !== false;
        },

        setStats: function (info) {
            const node = el('wordStats');
            if (!node) return;

            const dictionary = info && info.dictionary ? info.dictionary : 0;
            const custom = info && info.custom ? info.custom : 0;

            node.textContent = [
                'พจนานุกรมกลาง ' + dictionary.toLocaleString('th-TH') + ' คำ',
                'คำที่เพิ่มเอง ' + custom.toLocaleString('th-TH') + ' คำ'
            ].join(' · ');
        },

        // ── รายการคำ ──

        setSearch: function (text) {
            searchText = String(text || '').trim().toLowerCase();
            page.renderWordList(records);
        },

        renderWordList: function (listRecords, errorMessage) {
            const ul = el('wordList');
            if (!ul) return;

            records = Array.isArray(listRecords) ? listRecords : [];

            ul.innerHTML = '';

            if (errorMessage) {
                appendEmpty(ul, errorMessage);
                return;
            }

            if (records.length === 0) {
                appendEmpty(ul, 'ยังไม่มีคำที่เพิ่มเอง — เพิ่มคำด้านบน');
                return;
            }

            const filtered = records.filter(function (record) {
                if (!searchText) return true;

                return String(record.word || '')
                    .toLowerCase()
                    .indexOf(searchText) !== -1;
            });

            if (filtered.length === 0) {
                appendEmpty(ul, 'ไม่พบคำที่ค้นหา');
                return;
            }

            filtered.forEach(function (record) {
                ul.appendChild(createItem(record));
            });
        }
    };

    scope.WordSuggestPage = page;
})(window);
