// History Page - ประวัติการกรอก (อยู่ในหมวด Master)
//
// ทุกครั้งที่กด Download ในหน้ารายงาน ระบบเก็บชุดค่าที่กรอกไว้ที่นี่
// เพื่อให้กด "ใช้ซ้ำ" แล้วกลับมาเติมทั้งฟอร์มได้เลย (แก้เฉพาะช่องที่เปลี่ยน)
//
//   - ค่าชุดเดิม (template + ค่า + โหมด) ไม่ถูกเก็บซ้ำ แต่นับเป็นจำนวนครั้งที่ใช้
//   - เก็บไว้นานเท่าไรตั้งได้ (ค่าเริ่มต้น 15 วัน) รายการที่เก่ากว่าจะถูกลบอัตโนมัติ
//
// หน้านี้ไม่ผูกกับไฟล์ .docx จึงประกาศ standalone = true
// ให้ app.js ข้ามขั้นตอนของหน้า template (เหมือนหน้า Master Data)
(function (scope) {
    'use strict';

    // อายุการเก็บประวัติที่เลือกได้ (0 = ไม่จำกัดอายุ)
    const RETENTION_OPTIONS = [7, 15, 30, 60, 90, 0];

    const MAX_PREVIEW_ITEMS = 3;
    const PREVIEW_LENGTH = 28;

    const HTML = [
        '<h1>ประวัติการกรอก</h1>',

        '<section class="suggest-settings">',
        '    <h2>การเก็บประวัติ</h2>',

        '    <div class="field">',
        '        <label for="historyRetention">เก็บบันทึกไว้นาน</label>',
        '        <select id="historyRetention">',
        '            <option value="7">7 วัน</option>',
        '            <option value="15">15 วัน</option>',
        '            <option value="30">30 วัน</option>',
        '            <option value="60">60 วัน</option>',
        '            <option value="90">90 วัน</option>',
        '            <option value="0">ไม่จำกัดอายุ</option>',
        '        </select>',
        '    </div>',

        '    <p class="hint" id="historyStats"></p>',

        '    <div class="form-actions">',
        '        <button id="historyPruneBtn" type="button" class="plain">',
        '            ลบรายการที่เก่ากว่า</button>',
        '        <button id="historyClearBtn" type="button" class="danger">',
        '            ล้างประวัติทั้งหมด</button>',
        '    </div>',

        '    <p id="historyStatus" class="db-status"></p>',
        '</section>',

        '<section class="saved-templates">',
        '    <h2>รายการที่กรอกไว้</h2>',

        '    <div class="master-toolbar">',
        '        <label for="historySearch">ค้นหา</label>',
        '        <input type="text" id="historySearch"' +
            ' placeholder="ชื่อ template หรือค่าที่กรอก" autocomplete="off">',
        '    </div>',

        '    <p id="historyDbStatus" class="db-status"></p>',
        '    <ul id="historyList" class="saved-list"></ul>',
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

    function truncate(text, max) {
        const value = String(text === null || text === undefined ? '' : text);
        return value.length > max ? value.slice(0, max) + '…' : value;
    }

    function appendEmpty(list, message) {
        const item = document.createElement('li');
        item.className = 'empty';
        item.textContent = message;
        list.appendChild(item);
    }

    // ค่าของ field ที่เป็น type Table เก็บเป็น object { columns, rows, rowSpans }
    // ไม่ใช่ข้อความ จึงต้องแยกอ่านจากค่าปกติ
    function isTableValue(value) {
        return !!value && typeof value === 'object' && Array.isArray(value.rows);
    }

    // เฉพาะช่องที่กรอกค่าจริง (ช่องว่างไม่ได้ถูกเก็บอยู่แล้ว แต่กันไว้ให้ทน)
    function filledEntries(record) {
        const values = (record && record.values) || {};

        return Object.keys(values).filter(function (field) {
            const value = values[field];

            if (value === null || value === undefined) return false;
            if (isTableValue(value)) return value.rows.length > 0;

            return String(value).trim() !== '';
        });
    }

    // ข้อความย่อของค่าหนึ่งช่อง (ตารางอ่านเป็น "ตาราง N แถว")
    function describeValue(value) {
        if (isTableValue(value)) {
            return 'ตาราง ' + value.rows.length + ' แถว';
        }

        return truncate(value, PREVIEW_LENGTH);
    }

    // ข้อความย่อของค่าที่กรอก เช่น "ชื่อ: สมชาย · จำนวนเงิน: 1,000"
    function describeValues(record) {
        const fields = filledEntries(record);
        const shown = fields.slice(0, MAX_PREVIEW_ITEMS);

        const parts = shown.map(function (field) {
            return field + ': ' + describeValue(record.values[field]);
        });

        if (fields.length > shown.length) {
            parts.push('และอีก ' + (fields.length - shown.length) + ' ช่อง');
        }

        return parts.join(' · ');
    }

    // ใช้ textContent ทุกจุด เพราะค่าและชื่อ template มาจากผู้ใช้ (กัน XSS)
    function createItem(record) {
        const item = document.createElement('li');
        item.className = 'saved-item';

        const info = document.createElement('div');
        info.className = 'info';

        const name = document.createElement('strong');
        name.textContent = record.template_name || 'ไม่ทราบชื่อ template';

        const count = filledEntries(record).length;

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = [
            'กรอก ' + count + ' ช่อง',
            'ใช้ล่าสุด ' + formatDate(record.updated_at),
            record.hits > 1 ? 'ใช้ชุดค่านี้ ' + record.hits + ' ครั้ง' : ''
        ].filter(Boolean).join(' · ');

        const preview = document.createElement('span');
        preview.className = 'history-values';
        preview.textContent = describeValues(record);

        info.appendChild(name);
        info.appendChild(meta);
        info.appendChild(preview);

        const actions = document.createElement('div');
        actions.className = 'actions';

        const reuseBtn = document.createElement('button');
        reuseBtn.type = 'button';
        reuseBtn.textContent = 'ใช้ซ้ำ';
        reuseBtn.dataset.action = 'history-reuse';
        reuseBtn.dataset.id = String(record.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'ลบ';
        deleteBtn.dataset.action = 'history-delete';
        deleteBtn.dataset.id = String(record.id);

        actions.appendChild(reuseBtn);
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

        // อายุการเก็บที่เลือกได้ (ใช้สร้างข้อความอธิบายในหน้า)
        retentionOptions: RETENTION_OPTIONS,

        getHTML: function () {
            return HTML;
        },

        // ── อายุการเก็บประวัติ ──

        // ค่าที่เลือกอยู่ตอนนี้ (0 = ไม่จำกัดอายุ)
        getRetention: function () {
            const select = el('historyRetention');
            if (!select) return 0;

            const days = Number(select.value);
            return Number.isFinite(days) && days > 0 ? days : 0;
        },

        setRetention: function (days) {
            const select = el('historyRetention');
            if (!select) return;

            const wanted = String(Number(days) || 0);

            // ค่าที่ไม่ตรงกับตัวเลือกไหน (เช่น ตั้งไว้ก่อนหน้าแล้วแก้รายการ) ให้เลือกใกล้สุด
            const hasOption = Array.prototype.some.call(
                select.options,
                function (option) { return option.value === wanted; }
            );

            select.value = hasOption ? wanted : '15';
        },

        setStats: function (text) {
            const node = el('historyStats');
            if (node) node.textContent = text || '';
        },

        setStatus: function (text, kind) {
            setStatus('historyStatus', text, kind);
        },

        setDbStatus: function (text, kind) {
            setStatus('historyDbStatus', text, kind);
        },

        setBusy: function (busy) {
            ['historyPruneBtn', 'historyClearBtn'].forEach(function (id) {
                const button = el(id);
                if (button) button.disabled = !!busy;
            });
        },

        // ── รายการประวัติ ──

        setSearch: function (text) {
            searchText = String(text || '').trim().toLowerCase();
            page.renderList(records);
        },

        renderList: function (listRecords, errorMessage) {
            const ul = el('historyList');
            if (!ul) return;

            records = Array.isArray(listRecords) ? listRecords : [];

            ul.innerHTML = '';

            if (errorMessage) {
                appendEmpty(ul, errorMessage);
                return;
            }

            if (records.length === 0) {
                appendEmpty(
                    ul,
                    'ยังไม่มีประวัติ — กรอกค่าในหน้ารายงานแล้วกด Download ' +
                    'ระบบจะเก็บชุดค่าไว้ให้กดใช้ซ้ำที่นี่'
                );
                return;
            }

            const filtered = records.filter(function (record) {
                if (!searchText) return true;

                const haystack = [
                    record.template_name || '',
                    describeValues(record)
                ].join(' ').toLowerCase();

                return haystack.indexOf(searchText) !== -1;
            });

            if (filtered.length === 0) {
                appendEmpty(ul, 'ไม่พบประวัติที่ค้นหา');
                return;
            }

            filtered.forEach(function (record) {
                ul.appendChild(createItem(record));
            });
        }
    };

    scope.HistoryPage = page;
})(window);
