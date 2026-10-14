// Master Data Page Component - เพิ่ม/แก้ไข/ลบ ข้อมูลพื้นฐาน (กลุ่ม / กลุ่มย่อย / name)
//
// หน้านี้ไม่ผูกกับไฟล์ .docx จึงไม่ใช้ฟอร์ม {{field}} ของ FormPage
// และประกาศ standalone = true เพื่อให้ app.js ข้ามขั้นตอนของหน้า template
//
// โครงสร้างข้อมูล:
//   - กลุ่ม (Code Group) และกลุ่มย่อย (Sub Group) กำหนดไว้ล่วงหน้าได้ที่ส่วน "กลุ่มและกลุ่มย่อย"
//   - รายการ master เลือกกลุ่ม/กลุ่มย่อยจากรายการที่กำหนดไว้ (ไม่ต้องพิมพ์เอง)
(function (scope) {
    'use strict';

    const HTML = [
        '<h1>ข้อมูลหลัก</h1>',

        // ── รายการเป็นหลัก (list-first) ──
        '<section class="saved-templates">',
        '    <div class="list-head">',
        '        <h2>รายการข้อมูลหลัก</h2>',
        '        <button id="masterNewBtn" type="button" class="plain"' +
            ' data-modal-open="masterModal">+ เพิ่มข้อมูลหลัก</button>',
        '    </div>',

        '    <div class="master-toolbar">',
        '        <label for="masterSearch">ค้นหา</label>',
        '        <input type="text" id="masterSearch"' +
            ' placeholder="name / code group / sub group" autocomplete="off">',
        '    </div>',

        '    <p id="masterDbStatus" class="db-status"></p>',
        '    <ul id="masterList" class="saved-list"></ul>',
        '</section>',

        // ── เครื่องมือ (Excel + กลุ่ม + ตารางแก้ไข) ──
        '<section class="master-tools">',
        '    <h2>เครื่องมือ</h2>',

        '    <div class="form-actions">',
        '        <button id="masterGroupsBtn" type="button" class="plain"' +
            ' data-modal-open="masterGroupModal">จัดการกลุ่ม/กลุ่มย่อย</button>',
        '        <button id="masterExportBtn" type="button" class="plain">' +
            'ดาวน์โหลด Excel</button>',
        '        <button id="masterImportBtn" type="button" class="plain">' +
            'อัปโหลด Excel</button>',
        '        <button id="masterTableViewBtn" type="button" class="plain">' +
            'ดูแบบตาราง</button>',
        '    </div>',

        '    <input type="file" id="masterImportInput" accept=".xlsx" hidden>',

        '    <p id="masterExcelStatus" class="db-status"></p>',
        '    <p class="hint">ไฟล์ Excel ใช้ 3 คอลัมน์: Code Group, Sub Group และ Name' +
            ' — รายการเดิม (Code Group + Name ตรงกัน) จะถูกอัปเดตกลุ่มย่อย' +
            ' ส่วนรายการใหม่จะถูกเพิ่ม</p>',
        '</section>',

        // ── ตารางแก้ไขแบบ Inline (ซ่อนไว้ตอนเริ่ม) ──
        '<section class="master-table-section" style="display:none">',
        '    <h2>แก้ไขแบบตาราง</h2>',
        '    <div class="master-table-toolbar">',
        '        <button id="masterAddRowBtn" type="button" class="plain">+ เพิ่มแถว</button>',
        '        <button id="masterTableSaveBtn" type="button" class="plain">บันทึก</button>',
        '        <button id="masterListViewBtn" type="button" class="plain">กลับดูรายการ</button>',
        '        <span id="masterTableStatus" class="db-status"></span>',
        '    </div>',
        '    <div class="master-table-wrap">',
        '        <table id="masterTable" class="master-table">',
        '            <thead>',
        '                <tr>',
        '                    <th class="col-check"><input type="checkbox" id="masterTableSelectAll"></th>',
        '                    <th class="col-id">#</th>',
        '                    <th class="col-code-group">Code Group</th>',
        '                    <th class="col-sub-group">Sub Group</th>',
        '                    <th class="col-name">Name</th>',
        '                    <th class="col-actions">การดำเนินการ</th>',
        '                </tr>',
        '            </thead>',
        '            <tbody id="masterTableBody"></tbody>',
        '        </table>',
        '    </div>',
        '    <p class="hint">แก้ไขตรงในตารางได้ — กดบันทึกเพื่อฝากการเปลี่ยนแปลง' +
            ' (เพิ่มแถวใหม่ให้ใส่ Code Group และ Name ให้ครบ)</p>',
        '</section>',

        // ── ฟอร์มเพิ่ม/แก้ไขข้อมูลหลัก (อยู่ในโมดัล) ──
        '<div class="page-modal" id="masterModal">',
        '    <div class="page-modal-backdrop" data-modal-close="masterModal"></div>',
        '    <div class="page-modal-dialog">',
        '        <div class="page-modal-head">',
        '            <h2 id="masterFormTitle">เพิ่มข้อมูลหลัก</h2>',
        '            <button type="button" class="page-modal-close"' +
            ' data-modal-close="masterModal" aria-label="ปิด">&times;</button>',
        '        </div>',
        '        <div class="page-modal-body">',
        '            <div class="field">',
        '                <label for="masterCodeGroup">กลุ่ม (Code Group)</label>',
        '                <select id="masterCodeGroup"></select>',
        '            </div>',

        '            <div class="field">',
        '                <label for="masterSubGroup">กลุ่มย่อย (Sub Group)</label>',
        '                <select id="masterSubGroup"></select>',
        '            </div>',

        '            <div class="field">',
        '                <label for="masterName">Name</label>',
        '                <input type="text" id="masterName" placeholder="เช่น ลูกค้าทั่วไป" autocomplete="off">',
        '            </div>',

        '            <input type="hidden" id="masterId" value="">',

        '            <div class="form-actions">',
        '                <button id="masterSaveBtn" type="button">เพิ่ม</button>',
        '                <button id="masterCancelBtn" type="button" class="plain"' +
            ' style="display:none">ยกเลิกแก้ไข</button>',
        '            </div>',

        '            <p id="masterFormStatus" class="db-status"></p>',
        '        </div>',
        '    </div>',
        '</div>',

        // ── จัดการกลุ่ม/กลุ่มย่อย (อยู่ในโมดัล) ──
        '<div class="page-modal" id="masterGroupModal">',
        '    <div class="page-modal-backdrop" data-modal-close="masterGroupModal"></div>',
        '    <div class="page-modal-dialog">',
        '        <div class="page-modal-head">',
        '            <h2>กลุ่มและกลุ่มย่อย</h2>',
        '            <button type="button" class="page-modal-close"' +
            ' data-modal-close="masterGroupModal" aria-label="ปิด">&times;</button>',
        '        </div>',
        '        <div class="page-modal-body">',
        '            <p class="hint">กำหนดกลุ่ม/กลุ่มย่อยล่วงหน้า แล้วเลือกใช้ตอนเพิ่มข้อมูลหลัก' +
            ' (รายการที่นำเข้าจาก Excel จะเพิ่มกลุ่มที่ยังไม่มีให้เอง)</p>',

        '            <div class="master-toolbar">',
        '                <label for="masterNewGroup">เพิ่มกลุ่ม</label>',
        '                <input type="text" id="masterNewGroup"' +
            ' placeholder="เช่น CUSTOMER_TYPE" autocomplete="off">',
        '                <button id="masterGroupAddBtn" type="button" class="plain">เพิ่มกลุ่ม</button>',
        '            </div>',

        '            <p id="masterGroupStatus" class="db-status"></p>',
        '            <ul id="masterGroupList" class="group-list"></ul>',
        '        </div>',
        '    </div>',
        '</div>'
    ].join('\n');

    const GROUP_FALLBACK = '(ไม่ระบุกลุ่ม)';
    const SUBGROUP_FALLBACK = '(ไม่ระบุกลุ่มย่อย)';

    let records = [];      // รายการ master ล่าสุดที่โหลดมาจากฐานข้อมูล
    let groups = [];       // กลุ่ม/กลุ่มย่อยที่กำหนดไว้ล่วงหน้า
    let searchText = '';   // คำค้นปัจจุบัน (ตัวพิมพ์เล็กแล้ว)

    // โหมดแสดงผล: 'list' (รายการ) หรือ 'table' (ตารางแก้ไข)
    let viewMode = 'list';

    // แถวที่เพิ่มใหม่ (ยังไม่บันทึก) ในโหมดตาราง — เก็บชั่วคราว
    let pendingRows = [];  // array ของ { codeGroup, subGroup, name }

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
            record.sub_group,
            record.name
        ].join(' ').toLowerCase().indexOf(keyword) !== -1;
    }

    function findGroup(name) {
        for (const group of groups) {
            if (group.name === name) return group;
        }

        return null;
    }

    // เพิ่ม option ถ้ายังไม่มี แล้วคืน option นั้น (ใช้ตอนโหลดค่าที่ไม่มีในรายการ)
    function ensureOption(select, value, label) {
        if (!select || !value) return null;

        for (const option of select.options) {
            if (option.value === value) return option;
        }

        const option = document.createElement('option');
        option.value = value;
        option.textContent = label == null ? value : label;
        select.appendChild(option);
        return option;
    }

    // ──────────────────────────────────────────────────────────────
    // ตัวเลือกกลุ่ม / กลุ่มย่อย ของฟอร์ม
    // ──────────────────────────────────────────────────────────────

    // เติมกลุ่มทั้งหมดลง select ของฟอร์ม (คงค่าที่เลือกอยู่)
    function renderGroupOptions() {
        const select = el('masterCodeGroup');
        if (!select) return;

        const current = select.value;

        select.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = groups.length
            ? '— เลือกกลุ่ม —'
            : '(ยังไม่มีกลุ่ม — กดปุ่ม "จัดการกลุ่ม/กลุ่มย่อย")';
        select.appendChild(placeholder);

        groups.forEach(function (group) {
            const option = document.createElement('option');
            option.value = group.name;
            option.textContent = group.name;
            select.appendChild(option);
        });

        if (current) ensureOption(select, current, current);
        select.value = current || '';
    }

    // เติมกลุ่มย่อยของกลุ่มที่เลือกอยู่ (คงค่าที่เลือกอยู่ถ้ายังมี)
    function renderSubgroupOptions() {
        const groupSelect = el('masterCodeGroup');
        const select = el('masterSubGroup');
        if (!select) return;

        const current = select.value;
        const group = groupSelect ? findGroup(groupSelect.value) : null;
        const list = group ? group.subgroups : [];

        select.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— ไม่ระบุกลุ่มย่อย —';
        select.appendChild(placeholder);

        list.forEach(function (subgroup) {
            const option = document.createElement('option');
            option.value = subgroup.name;
            option.textContent = subgroup.name;
            select.appendChild(option);
        });

        if (current) ensureOption(select, current, current);
        select.value = current || '';

        // ไม่มีกลุ่มที่เลือก = เลือกกลุ่มย่อยไม่ได้
        select.disabled = !groupSelect || !groupSelect.value;

        // จำว่า "ปิดเพราะตั้งใจ" เพื่อให้ clearDisabledFields ของ app.js
        // ไม่ปลด disabled ทิ้งหลังทำงานกับฐานข้อมูล
        if (select.disabled) {
            select.dataset.keepDisabled = '1';
        } else {
            delete select.dataset.keepDisabled;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // รายการกลุ่ม/กลุ่มย่อย (ส่วนจัดการ)
    // ──────────────────────────────────────────────────────────────

    function createGroupItem(group) {
        const item = document.createElement('li');
        item.className = 'group-item';

        const head = document.createElement('div');
        head.className = 'group-head';

        const name = document.createElement('strong');
        name.textContent = group.name;

        const actions = document.createElement('div');
        actions.className = 'group-actions';

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'plain';
        renameBtn.textContent = 'เปลี่ยนชื่อ';
        renameBtn.dataset.action = 'group-rename';
        renameBtn.dataset.id = String(group.id);
        renameBtn.dataset.name = group.name;

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'ลบกลุ่ม';
        deleteBtn.dataset.action = 'group-delete';
        deleteBtn.dataset.id = String(group.id);

        actions.appendChild(renameBtn);
        actions.appendChild(deleteBtn);

        head.appendChild(name);
        head.appendChild(actions);

        const subList = document.createElement('ul');
        subList.className = 'subgroup-list';

        if (group.subgroups.length === 0) {
            appendEmpty(subList, 'ยังไม่มีกลุ่มย่อย');
        } else {
            group.subgroups.forEach(function (subgroup) {
                const row = document.createElement('li');

                const text = document.createElement('span');
                text.textContent = subgroup.name;

                const rowActions = document.createElement('div');
                rowActions.className = 'group-actions';

                const subRename = document.createElement('button');
                subRename.type = 'button';
                subRename.className = 'plain';
                subRename.textContent = 'เปลี่ยนชื่อ';
                subRename.dataset.action = 'subgroup-rename';
                subRename.dataset.id = String(subgroup.id);
                subRename.dataset.groupId = String(group.id);
                subRename.dataset.name = subgroup.name;

                const subDelete = document.createElement('button');
                subDelete.type = 'button';
                subDelete.className = 'danger';
                subDelete.textContent = 'ลบ';
                subDelete.dataset.action = 'subgroup-delete';
                subDelete.dataset.id = String(subgroup.id);

                rowActions.appendChild(subRename);
                rowActions.appendChild(subDelete);

                row.appendChild(text);
                row.appendChild(rowActions);
                subList.appendChild(row);
            });
        }

        const addRow = document.createElement('div');
        addRow.className = 'subgroup-add';

        const input = document.createElement('input');
        input.type = 'text';
        input.dataset.subgroupInput = String(group.id);
        input.placeholder = 'เพิ่มกลุ่มย่อย';
        input.autocomplete = 'off';

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'plain';
        addBtn.textContent = 'เพิ่มกลุ่มย่อย';
        addBtn.dataset.action = 'subgroup-add';
        addBtn.dataset.id = String(group.id);

        addRow.appendChild(input);
        addRow.appendChild(addBtn);

        item.appendChild(head);
        item.appendChild(subList);
        item.appendChild(addRow);
        return item;
    }

    // ──────────────────────────────────────────────────────────────
    // รายการข้อมูลหลัก
    // ──────────────────────────────────────────────────────────────

    // จัดกลุ่มตาม code_group แล้วซ้อนกลุ่มย่อย
    function groupRecords(list) {
        const order = [];
        const byGroup = {};

        list.forEach(function (record) {
            const groupName = record.code_group || GROUP_FALLBACK;

            if (!byGroup[groupName]) {
                byGroup[groupName] = {
                    name: groupName,
                    count: 0,
                    subgroups: []
                };
                order.push(groupName);
            }

            const group = byGroup[groupName];
            group.count++;

            const subName = record.sub_group || SUBGROUP_FALLBACK;
            let sub = null;

            for (const entry of group.subgroups) {
                if (entry.name === subName) {
                    sub = entry;
                    break;
                }
            }

            if (!sub) {
                sub = { name: subName, records: [] };
                group.subgroups.push(sub);
            }

            sub.records.push(record);
        });

        return order.map(function (name) {
            return byGroup[name];
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

        // เรียกจาก app.js ตอนกดปุ่ม "+ เพิ่มข้อมูลหลัก" (เตรียมฟอร์มก่อนเปิดโมดัล)
        onModalOpen: function (modalId) {
            if (modalId !== 'masterModal') return;

            page.resetForm();
            page.setFormStatus('');
        },

        // ── ฟอร์มเพิ่ม / แก้ไข ──

        // id = 0 หมายถึงเพิ่มใหม่, id > 0 หมายถึงแก้ไข
        readForm: function () {
            const id = el('masterId');
            const codeGroup = el('masterCodeGroup');
            const subGroup = el('masterSubGroup');
            const name = el('masterName');

            return {
                id: (id && id.value) ? Number(id.value) : 0,
                codeGroup: codeGroup ? codeGroup.value.trim() : '',
                subGroup: subGroup ? subGroup.value.trim() : '',
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

            const groupSelect = el('masterCodeGroup');

            // รายการที่โหลดอาจอ้างกลุ่มที่ถูกลบไปแล้ว — เติมให้เลือกได้ชั่วคราว
            if (groupSelect) {
                ensureOption(groupSelect, record.code_group || '', record.code_group || '');
                groupSelect.value = record.code_group || '';
            }

            renderSubgroupOptions();

            const subSelect = el('masterSubGroup');

            if (subSelect) {
                ensureOption(subSelect, record.sub_group || '', record.sub_group || '');
                subSelect.value = record.sub_group || '';
            }

            setValue('masterName', record.name);

            page.setEditing(record);

            const name = el('masterName');
            if (name && name.focus) {
                name.focus();
            }
        },

        resetForm: function () {
            setValue('masterName', '');
            setValue('masterCodeGroup', '');
            renderGroupOptions();
            renderSubgroupOptions();

            page.setEditing(null);

            // ล้าง pending rows (แถวใหม่ที่ยังไม่บันทึก) เมื่อล้างฟอร์ม
            pendingRows = [];
            if (viewMode === 'table') {
                page.renderTableRows(records);
            }
        },

        // เปลี่ยนกลุ่มในฟอร์ม → เติมกลุ่มย่อยของกลุ่มใหม่
        setFormCodeGroup: function (value) {
            const select = el('masterCodeGroup');
            if (select) select.value = value || '';

            renderSubgroupOptions();
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

        setGroupStatus: function (text, kind) {
            setStatus('masterGroupStatus', text, kind);
        },

        // ── นำเข้า / ส่งออก Excel ──

        setExcelStatus: function (text, kind) {
            setStatus('masterExcelStatus', text, kind);
        },

        // ปิดปุ่มระหว่างอ่าน/เขียนไฟล์ กันกดซ้ำระหว่างกำลังทำงาน
        setExcelBusy: function (busy) {
            ['masterExportBtn', 'masterImportBtn'].forEach(function (id) {
                const btn = el(id);
                if (btn) btn.disabled = !!busy;
            });
        },

        // ── กลุ่ม / กลุ่มย่อย ──

        // อัปเดตรายการกลุ่มที่กำหนดไว้ (เรียกจาก app.js หลังโหลด/แก้ไข)
        setGroups: function (list) {
            groups = Array.isArray(list) ? list : [];

            renderGroupList();
            renderGroupOptions();
            renderSubgroupOptions();
        },

        // อ่านชื่อกลุ่มใหม่ที่พิมพ์ในช่อง "เพิ่มกลุ่ม"
        readNewGroupName: function () {
            const input = el('masterNewGroup');
            return input ? input.value.trim() : '';
        },

        clearNewGroupInput: function () {
            setValue('masterNewGroup', '');
        },

        readNewSubgroupName: function (groupId) {
            let value = '';

            document
                .querySelectorAll('[data-subgroup-input]')
                .forEach(function (input) {
                    if (Number(input.dataset.subgroupInput) === Number(groupId)) {
                        value = input.value.trim();
                    }
                });

            return value;
        },

        clearNewSubgroupInput: function (groupId) {
            document
                .querySelectorAll('[data-subgroup-input]')
                .forEach(function (input) {
                    if (Number(input.dataset.subgroupInput) === Number(groupId)) {
                        input.value = '';
                    }
                });
        },

        // ── โหมดดูรายการ / ตาราง ──

        isTableMode: function () {
            return viewMode === 'table';
        },

        setViewMode: function (mode) {
            viewMode = mode || 'list';

            const listSection = document.querySelector('.saved-templates');
            const tableSection = document.querySelector('.master-table-section');
            const tableViewBtn = el('masterTableViewBtn');
            const listViewBtn = el('masterListViewBtn');

            if (listSection) {
                listSection.style.display = viewMode === 'list' ? '' : 'none';
            }
            if (tableSection) {
                tableSection.style.display = viewMode === 'table' ? '' : 'none';
            }
            if (tableViewBtn) {
                tableViewBtn.style.display = viewMode === 'list' ? 'inline-block' : 'none';
            }
            if (listViewBtn) {
                listViewBtn.style.display = viewMode === 'table' ? 'inline-block' : 'none';
            }

            // เมื่อสลับไปตาราง ให้ render แถวจาก records ปัจจุบัน
            if (viewMode === 'table') {
                page.renderTableRows(records);
            }
        },

        // ── ตารางแก้ไขแบบ Inline ──

        // เรียกเมื่อเปิดหน้าหนึ่ง ๆ (จาก app.js)
        // ถ้า records ยังไม่ได้โหลด ให้รอ render แถวตอนโหลดเสร็จแทน
        readyTable: function () {
            if (viewMode === 'table' && records.length > 0) {
                page.renderTableRows(records);
            }
        },

        // ล้าง pending rows (ใช้หลังบันทึกสำเร็จ)
        setPendingRows: function (list) {
            pendingRows = Array.isArray(list) ? list : [];
            if (viewMode === 'table') {
                page.renderTableRows(records);
            }
        },

        // เตรียมแถวสำหรับตาราง: ผสม records จริง + pending rows (แถวใหม่)
        tableData: function () {
            // ใช้ filtered records ตาม searchText ปัจจุบัน
            const filtered = records.filter(function (record) {
                return matches(record, searchText);
            });

            // แปลงเป็น array ของ objects ที่ใช้แสดงในตาราง
            // แต่ละแถวมี id (0 = แถวใหม่), codeGroup, subGroup, name, updated_at
            return filtered.map(function (record) {
                return {
                    id: record.id || 0,
                    codeGroup: record.code_group || '',
                    subGroup: record.sub_group || '',
                    name: record.name || '',
                    updated_at: record.updated_at || ''
                };
            }).concat(
                pendingRows.map(function (row, index) {
                    return {
                        id: 0,
                        codeGroup: row.codeGroup || '',
                        subGroup: row.subGroup || '',
                        name: row.name || '',
                        updated_at: '',
                        _pendingIndex: index
                    };
                })
            );
        },

        renderTableRows: function (list) {
            const tbody = el('masterTableBody');
            if (!tbody) return;

            const data = list ? page.tableData.call({ records: list, matches: matches, searchText: searchText }) : page.tableData();

            tbody.innerHTML = '';

            if (data.length === 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = '<td colspan="6" class="empty-row">ยังไม่มีข้อมูล — กด "+ เพิ่มแถว" เพื่อเพิ่ม หรือกลับไปดูรายการ</td>';
                tbody.appendChild(tr);
                return;
            }

            data.forEach(function (row, index) {
                const tr = document.createElement('tr');
                tr.dataset.rowId = row.id || ('pending-' + (row._pendingIndex !== undefined ? row._pendingIndex : index));

                // ช่อง check เลือกทั้งแถว (สำหรับลบ)
                const tdCheck = document.createElement('td');
                tdCheck.className = 'col-check';
                const check = document.createElement('input');
                check.type = 'checkbox';
                check.className = 'row-check';
                check.dataset.rowId = row.id || ('pending-' + (row._pendingIndex !== undefined ? row._pendingIndex : index));
                tdCheck.appendChild(check);
                tr.appendChild(tdCheck);

                // คอลัมน์ ID (hidden ถ้าเป็นแถวใหม่)
                const tdId = document.createElement('td');
                tdId.className = 'col-id';
                tdId.textContent = row.id || 'ใหม่';
                tr.appendChild(tdId);

                // Code Group — input select
                const tdGroup = document.createElement('td');
                tdGroup.className = 'col-code-group';
                const groupSelect = document.createElement('select');
                groupSelect.dataset.field = 'codeGroup';
                groupSelect.dataset.rowId = row.id || ('pending-' + (row._pendingIndex !== undefined ? row._pendingIndex : index));

                // เพิ่ม option ว่าง
                const groupPlaceholder = document.createElement('option');
                groupPlaceholder.value = '';
                groupPlaceholder.textContent = '— เลือกกลุ่ม —';
                groupSelect.appendChild(groupPlaceholder);

                // เติมกลุ่มจาก groups ปัจจุบัน
                groups.forEach(function (g) {
                    const opt = document.createElement('option');
                    opt.value = g.name;
                    opt.textContent = g.name;
                    groupSelect.appendChild(opt);
                });

                // เติม option สำหรับกลุ่มที่ใช้อยู่แต่ยังไม่มีใน groups (เช่นจาก import)
                if (row.codeGroup && !groups.some(function (g) { return g.name === row.codeGroup; })) {
                    const opt = document.createElement('option');
                    opt.value = row.codeGroup;
                    opt.textContent = row.codeGroup;
                    groupSelect.appendChild(opt);
                }

                groupSelect.value = row.codeGroup || '';
                groupSelect.addEventListener('change', function () {
                    page.onTableCellChange(row.id || ('pending-' + (row._pendingIndex !== undefined ? row._pendingIndex : index)), 'codeGroup', groupSelect.value);
                });
                tdGroup.appendChild(groupSelect);
                tr.appendChild(tdGroup);

                // Sub Group — input select (เติมจากกลุ่มที่เลือก)
                const tdSub = document.createElement('td');
                tdSub.className = 'col-sub-group';
                const subSelect = document.createElement('select');
                subSelect.dataset.field = 'subGroup';
                subSelect.dataset.rowId = row.id || ('pending-' + (row._pendingIndex !== undefined ? row._pendingIndex : index));

                const subPlaceholder = document.createElement('option');
                subPlaceholder.value = '';
                subPlaceholder.textContent = '— ไม่ระบุกลุ่มย่อย —';
                subSelect.appendChild(subPlaceholder);

                // เติมกลุ่มย่อยของกลุ่มที่เลือกอยู่
                const currentGroup = groups.find(function (g) { return g.name === groupSelect.value; });
                if (currentGroup) {
                    currentGroup.subgroups.forEach(function (sg) {
                        const opt = document.createElement('option');
                        opt.value = sg.name;
                        opt.textContent = sg.name;
                        subSelect.appendChild(opt);
                    });
                }

                // ถ้ามี subGroup ที่ไม่อยู่ในกลุ่มที่เลือก ให้เติม option ไว้ (เช่นกรณี imported)
                if (row.subGroup && (!currentGroup || !currentGroup.subgroups.some(function (sg) { return sg.name === row.subGroup; }))) {
                    const opt = document.createElement('option');
                    opt.value = row.subGroup;
                    opt.textContent = row.subGroup;
                    subSelect.appendChild(opt);
                }

                subSelect.value = row.subGroup || '';
                subSelect.addEventListener('change', function () {
                    page.onTableCellChange(row.id || ('pending-' + (row._pendingIndex !== undefined ? row._pendingIndex : index)), 'subGroup', subSelect.value);
                });

                // เมื่อเลือกกลุ่มเปลี่ยน ให้เปลี่ยนกลุ่มย่อยที่ใช้ได้
                groupSelect.addEventListener('change', function () {
                    // อัปเดตตัวเลือกกลุ่มย่อยตามกลุ่มใหม่
                    const newGroup = groups.find(function (g) { return g.name === groupSelect.value; });
                    subSelect.innerHTML = '';
                    const ph = document.createElement('option');
                    ph.value = '';
                    ph.textContent = '— ไม่ระบุกลุ่มย่อย —';
                    subSelect.appendChild(ph);
                    if (newGroup) {
                        newGroup.subgroups.forEach(function (sg) {
                            const opt = document.createElement('option');
                            opt.value = sg.name;
                            opt.textContent = sg.name;
                            subSelect.appendChild(opt);
                        });
                    }
                    subSelect.value = row.subGroup || '';
                });
                tdSub.appendChild(subSelect);
                tr.appendChild(tdSub);

                // Name — input text (แก้ไข inline)
                const tdName = document.createElement('td');
                tdName.className = 'col-name';
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.dataset.field = 'name';
                nameInput.dataset.rowId = row.id || ('pending-' + (row._pendingIndex !== undefined ? row._pendingIndex : index));
                nameInput.value = row.name || '';
                nameInput.className = 'table-cell-input';
                nameInput.addEventListener('change', function () {
                    page.onTableCellChange(row.id || ('pending-' + (row._pendingIndex !== undefined ? row._pendingIndex : index)), 'name', nameInput.value);
                });
                tdName.appendChild(nameInput);
                tr.appendChild(tdName);

                // คอลัมน์การดำเนินการ: ปุ่มลบ (เฉพาะแถวจริง), แถวใหม่ใช้ปุ่มลบแค่ลบออกจาก pending
                const tdActions = document.createElement('td');
                tdActions.className = 'col-actions';
                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'row-actions';

                if (row.id) {
                    // แถวจริง — ปุ่มลบ
                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'danger';
                    delBtn.textContent = 'ลบ';
                    delBtn.dataset.action = 'table-delete';
                    delBtn.dataset.rowId = String(row.id);
                    actionsDiv.appendChild(delBtn);
                } else {
                    // แถวใหม่ (pending) — ปุ่มลบออกจากตาราง
                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'danger';
                    delBtn.textContent = 'ลบ';
                    delBtn.dataset.action = 'table-delete-pending';
                    delBtn.dataset.rowId = String(row._pendingIndex);
                    actionsDiv.appendChild(delBtn);
                }

                tdActions.appendChild(actionsDiv);
                tr.appendChild(tdActions);

                tbody.appendChild(tr);
            });

            // อัปเดตปุ่ม "เลือกทั้งหมด"
            page.updateSelectAllCheckbox();
        },

        // เรียกเมื่อมีการแก้ไขในช่องของตาราง (จัดเก็บการเปลี่ยนแปลงชั่วคราว)
        onTableCellChange: function (rowId, field, value) {
            // อัปเดตใน records (ถ้าเป็นแถวจริง) หรือใน pendingRows (ถ้าเป็นแถวใหม่)
            const parsedId = String(rowId);
            const isPending = parsedId.startsWith('pending-');
            const realId = isPending ? null : Number(parsedId);
            const pendingIndex = isPending ? Number(parsedId.replace('pending-', '')) : null;

            if (!isPending) {
                // แถวจริง — อัปเดตใน records
                const record = records.find(function (r) { return r.id === realId; });
                if (record) {
                    if (field === 'codeGroup') {
                        record.code_group = value || '';
                    } else if (field === 'subGroup') {
                        record.sub_group = value || '';
                    } else if (field === 'name') {
                        record.name = value || '';
                    }
                }
            } else if (pendingIndex !== null) {
                // แถวใหม่ — อัปเดตใน pendingRows
                const pendingRow = pendingRows[pendingIndex];
                if (pendingRow) {
                    if (field === 'codeGroup') {
                        pendingRow.codeGroup = value || '';
                    } else if (field === 'subGroup') {
                        pendingRow.subGroup = value || '';
                    } else if (field === 'name') {
                        pendingRow.name = value || '';
                    }
                }
            }
        },

        // เพิ่มแถวใหม่ (pending) ลงในตาราง
        addPendingRow: function () {
            pendingRows.push({ codeGroup: '', subGroup: '', name: '' });
            page.renderTableRows(records);
            page.setTableStatus('เพิ่มแถวใหม่แล้ว — กรอกข้อมูลให้ครบก่อนบันทึก', '');
        },

        // ลบแถว pending ออก
        deletePendingRow: function (index) {
            pendingRows.splice(Number(index), 1);
            page.renderTableRows(records);
        },

        // ลบแถวจริง (แสดงในตาราง)
        deleteTableRow: function (rowId) {
            const id = Number(rowId);
            const index = records.findIndex(function (r) { return r.id === id; });
            if (index >= 0) {
                records.splice(index, 1);
                page.renderTableRows(records);
            }
        },

        // อ่านแถวทั้งหมดในตาราง (รวม pending) เพื่อส่งให้บันทึก
        readTableRows: function () {
            const data = page.tableData();
            return data.map(function (row) {
                return {
                    id: row.id || 0,  // 0 = แถวใหม่
                    codeGroup: row.codeGroup || '',
                    subGroup: row.subGroup || '',
                    name: row.name || ''
                };
            });
        },

        // อัปเดตสถานะในตาราง (เช่น บันทึกสำเร็จ/ล้มเหลว)
        setTableStatus: function (text, kind) {
            setStatus('masterTableStatus', text, kind);
        },

        // อัปเดต checkbox "เลือกทั้งหมด" เมื่อมีแถวใหม่/ลบ
        updateSelectAllCheckbox: function () {
            const selectAll = el('masterTableSelectAll');
            if (!selectAll) return;

            const rows = document.querySelectorAll('.row-check');
            const checkedCount = document.querySelectorAll('.row-check:checked').length;
            selectAll.checked = rows.length > 0 && checkedCount === rows.length;
            selectAll.indeterminate = checkedCount > 0 && checkedCount < rows.length;
        },

        // ── รายการ master ──

        setSearch: function (text) {
            searchText = String(text || '').trim().toLowerCase();
            page.renderMasterList(records);
            // ถ้ากำลังอยู่ในโหมดตาราง ให้อัปเดตแถวด้วย
            if (viewMode === 'table') {
                page.renderTableRows(records);
            }
        },

        renderMasterList: function (list, errorMessage) {
            const ul = el('masterList');
            if (!ul) return;

            records = Array.isArray(list) ? list : [];

            ul.innerHTML = '';

            if (errorMessage) {
                appendEmpty(ul, errorMessage);
                return;
            }

            if (records.length === 0) {
                appendEmpty(ul, 'ยังไม่มีข้อมูลหลัก — กด "+ เพิ่มข้อมูลหลัก" ด้านบน');
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
                count.textContent = group.count + ' รายการ';

                head.appendChild(name);
                head.appendChild(count);
                ul.appendChild(head);

                group.subgroups.forEach(function (subgroup) {
                    // ซ่อนหัวกลุ่มย่อยเมื่อทุกอย่างอยู่ในกลุ่มเดียวและไม่มีกลุ่มย่อย
                    if (!(group.subgroups.length === 1 && subgroup.name === SUBGROUP_FALLBACK)) {
                        const subHead = document.createElement('li');
                        subHead.className = 'master-subgroup';

                        const subName = document.createElement('span');
                        subName.textContent = subgroup.name;

                        const subCount = document.createElement('span');
                        subCount.className = 'meta';
                        subCount.textContent = subgroup.records.length + ' รายการ';

                        subHead.appendChild(subName);
                        subHead.appendChild(subCount);
                        ul.appendChild(subHead);
                    }

                    subgroup.records.forEach(function (record) {
                        ul.appendChild(createItem(record));
                    });
                });
            });

            // ถ้ากำลังอยู่ในโหมดตาราง ให้อัปเดตแถวด้วย
            if (viewMode === 'table') {
                page.renderTableRows(records);
            }
        }
    };

    function renderGroupList() {
        const ul = el('masterGroupList');
        if (!ul) return;

        ul.innerHTML = '';

        if (groups.length === 0) {
            appendEmpty(ul, 'ยังไม่มีกลุ่ม — เพิ่มกลุ่มด้านบน');
            return;
        }

        groups.forEach(function (group) {
            ul.appendChild(createGroupItem(group));
        });
    }

    scope.MasterDataPage = page;
})(window);
