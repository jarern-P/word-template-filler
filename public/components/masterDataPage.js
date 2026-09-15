// Master Data Page Component - เพิ่ม/แก้ไข/ลบ ข้อมูลพื้นฐาน (code group / name)
//
// หน้านี้ไม่ผูกกับไฟล์ .docx จึงไม่ใช้ฟอร์ม {{field}} ของ FormPage
// และประกาศ standalone = true เพื่อให้ app.js ข้ามขั้นตอนของหน้า template
(function (scope) {
    'use strict';

    const HTML = [
        '<h1>Master Data</h1>',

        '<section class="master-form">',
        '    <h2 id="masterFormTitle">เพิ่มข้อมูล Master</h2>',

        '    <div class="field">',
        '        <label for="masterCodeGroup">Code Group</label>',
        '        <input type="text" id="masterCodeGroup" list="masterGroupOptions"' +
            ' placeholder="เช่น CUSTOMER_TYPE" autocomplete="off">',
        '        <datalist id="masterGroupOptions"></datalist>',
        '    </div>',

        '    <div class="field">',
        '        <label for="masterName">Name</label>',
        '        <input type="text" id="masterName" placeholder="เช่น ลูกค้าทั่วไป" autocomplete="off">',
        '    </div>',

        '    <input type="hidden" id="masterId" value="">',

        '    <div class="form-actions">',
        '        <button id="masterSaveBtn" type="button">เพิ่ม</button>',
        '        <button id="masterCancelBtn" type="button" class="plain"' +
            ' style="display:none">ยกเลิกแก้ไข</button>',
        '    </div>',

        '    <p id="masterFormStatus" class="db-status"></p>',
        '</section>',

        '<section class="saved-templates">',
        '    <h2>รายการ Master Data</h2>',

        '    <div class="master-toolbar">',
        '        <label for="masterSearch">ค้นหา</label>',
        '        <input type="text" id="masterSearch"' +
            ' placeholder="name / code group" autocomplete="off">',
        '    </div>',

        '    <p id="masterDbStatus" class="db-status"></p>',
        '    <ul id="masterList" class="saved-list"></ul>',
        '</section>'
    ].join('\n');

    const GROUP_FALLBACK = '(ไม่ระบุกลุ่ม)';

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

    // สถานะของหน้านี้แยกจาก #dbStatus ของหน้า Template Configuration
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

    function matches(record, keyword) {
        if (!keyword) return true;

        return [
            record.code_group,
            record.name
        ].join(' ').toLowerCase().indexOf(keyword) !== -1;
    }

    // จัดกลุ่มตาม code_group โดยคงลำดับที่เรียงมาจากฐานข้อมูล
    function groupRecords(list) {
        const groups = [];
        const byGroup = {};

        list.forEach(function (record) {
            const group = record.code_group || GROUP_FALLBACK;

            if (!byGroup[group]) {
                byGroup[group] = [];
                groups.push(group);
            }

            byGroup[group].push(record);
        });

        return groups.map(function (group) {
            return {
                name: group,
                records: byGroup[group]
            };
        });
    }

    // ใช้ textContent ทุกจุด เพราะค่ามาจากผู้ใช้ (กัน XSS)
    function createItem(record) {
        const item = document.createElement('li');
        item.className = 'saved-item';

        const info = document.createElement('div');
        info.className = 'info';

        const title = document.createElement('strong');
        title.textContent = record.name;

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = 'อัปเดต ' + formatDate(record.updated_at);

        info.appendChild(title);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'แก้ไข';
        editBtn.dataset.action = 'master-edit';
        editBtn.dataset.id = String(record.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'ลบ';
        deleteBtn.dataset.action = 'master-delete';
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
            const id = el('masterId');
            const codeGroup = el('masterCodeGroup');
            const name = el('masterName');

            return {
                id: (id && id.value) ? Number(id.value) : 0,
                codeGroup: codeGroup ? codeGroup.value.trim() : '',
                name: name ? name.value.trim() : ''
            };
        },

        // สลับโหมดของฟอร์มระหว่าง "เพิ่ม" กับ "แก้ไข"
        setEditing: function (record) {
            const editing = !!record;

            setValue('masterId', editing ? record.id : '');

            const title = el('masterFormTitle');
            if (title) {
                title.textContent = editing
                    ? 'แก้ไขข้อมูล Master'
                    : 'เพิ่มข้อมูล Master';
            }

            const saveBtn = el('masterSaveBtn');
            if (saveBtn) {
                saveBtn.textContent = editing ? 'บันทึกการแก้ไข' : 'เพิ่ม';
            }

            const cancelBtn = el('masterCancelBtn');
            if (cancelBtn) {
                cancelBtn.style.display = editing ? 'inline-block' : 'none';
            }
        },

        loadIntoForm: function (record) {
            if (!record) return;

            setValue('masterCodeGroup', record.code_group);
            setValue('masterName', record.name);

            page.setEditing(record);

            const name = el('masterName');
            if (name && name.focus) {
                name.focus();
            }
        },

        resetForm: function () {
            setValue('masterCodeGroup', '');
            setValue('masterName', '');

            page.setEditing(null);
        },

        setSaveEnabled: function (enabled) {
            const btn = el('masterSaveBtn');
            if (btn) btn.disabled = !enabled;
        },

        setFormStatus: function (text, kind) {
            setStatus('masterFormStatus', text, kind);
        },

        setDbStatus: function (text, kind) {
            setStatus('masterDbStatus', text, kind);
        },

        // ── รายการ master ──

        setSearch: function (text) {
            searchText = String(text || '').trim().toLowerCase();
            page.renderMasterList(records);
        },

        renderMasterList: function (list, errorMessage) {
            const ul = el('masterList');
            if (!ul) return;

            records = Array.isArray(list) ? list : [];

            ul.innerHTML = '';

            renderGroupOptions();

            if (errorMessage) {
                appendEmpty(ul, errorMessage);
                return;
            }

            if (records.length === 0) {
                appendEmpty(ul, 'ยังไม่มีข้อมูล Master — เพิ่มรายการด้านบน');
                return;
            }

            const filtered = records.filter(function (record) {
                return matches(record, searchText);
            });

            if (filtered.length === 0) {
                appendEmpty(ul, 'ไม่พบข้อมูลที่ค้นหา');
                return;
            }

            groupRecords(filtered).forEach(function (group) {
                const head = document.createElement('li');
                head.className = 'master-group';

                const name = document.createElement('strong');
                name.textContent = group.name;

                const count = document.createElement('span');
                count.className = 'meta';
                count.textContent = group.records.length + ' รายการ';

                head.appendChild(name);
                head.appendChild(count);
                ul.appendChild(head);

                group.records.forEach(function (record) {
                    ul.appendChild(createItem(record));
                });
            });
        }
    };

    // เติมชื่อ code group ที่มีอยู่แล้วเป็นตัวเลือกให้ช่อง Code Group
    function renderGroupOptions() {
        const datalist = el('masterGroupOptions');
        if (!datalist) return;

        const groups = [];

        records.forEach(function (record) {
            const group = record.code_group || '';
            if (group && groups.indexOf(group) === -1) {
                groups.push(group);
            }
        });

        datalist.innerHTML = '';

        groups.forEach(function (group) {
            const option = document.createElement('option');
            option.value = group;
            datalist.appendChild(option);
        });
    }

    scope.MasterDataPage = page;
})(window);
