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

        '<section class="master-form">',
        '    <h2 id="masterFormTitle">เพิ่มข้อมูลหลัก</h2>',

        '    <div class="field">',
        '        <label for="masterCodeGroup">กลุ่ม (Code Group)</label>',
        '        <select id="masterCodeGroup"></select>',
        '    </div>',

        '    <div class="field">',
        '        <label for="masterSubGroup">กลุ่มย่อย (Sub Group)</label>',
        '        <select id="masterSubGroup"></select>',
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

        // กำหนดกลุ่ม/กลุ่มย่อยล่วงหน้า — รายการ master เลือกจากที่นี่เท่านั้น
        '<section class="master-groups">',
        '    <h2>กลุ่มและกลุ่มย่อย</h2>',
        '    <p class="hint">กำหนดกลุ่ม/กลุ่มย่อยล่วงหน้า แล้วเลือกใช้ตอนเพิ่มข้อมูลหลัก ' +
            '(รายการที่นำเข้าจาก Excel จะเพิ่มกลุ่มที่ยังไม่มีให้เอง)</p>',

        '    <div class="master-toolbar">',
        '        <label for="masterNewGroup">เพิ่มกลุ่ม</label>',
        '        <input type="text" id="masterNewGroup"' +
            ' placeholder="เช่น CUSTOMER_TYPE" autocomplete="off">',
        '        <button id="masterGroupAddBtn" type="button" class="plain">เพิ่มกลุ่ม</button>',
        '    </div>',

        '    <p id="masterGroupStatus" class="db-status"></p>',
        '    <ul id="masterGroupList" class="group-list"></ul>',
        '</section>',

        // นำเข้า/ส่งออก Excel: ทำชุดข้อมูลทีเดียวแล้วอัปโหลดครั้งเดียว
        '<section class="master-excel">',
        '    <h2>นำเข้า / ส่งออก Excel</h2>',
        '    <p class="hint">ไฟล์ .xlsx ใช้ 3 คอลัมน์: Code Group, Sub Group และ Name ' +
            '(แถวแรกเป็นหัวตารางได้ — เว้น Sub Group ว่างได้)</p>',
        '    <p class="hint">ตอนนำเข้า: รายการเดิม (Code Group + Name ตรงกัน) ' +
            'จะถูก <strong>อัปเดตกลุ่มย่อย</strong>ตามไฟล์ — รายการใหม่จะถูกเพิ่ม ' +
            'ส่วนรายการที่ซ้ำกันในไฟล์จะถูกข้าม</p>',

        '    <div class="form-actions">',
        '        <button id="masterExportBtn" type="button" class="plain">' +
            'ดาวน์โหลด Excel</button>',
        '        <button id="masterImportBtn" type="button" class="plain">' +
            'อัปโหลด Excel</button>',
        '    </div>',

        // input ถูกซ่อน เพราะเปิดผ่านปุ่มเพื่อให้เข้าชุดกับปุ่มอื่น
        '    <input type="file" id="masterImportInput" accept=".xlsx" hidden>',

        '    <p id="masterExcelStatus" class="db-status"></p>',
        '</section>',

        '<section class="saved-templates">',
        '    <h2>รายการข้อมูลหลัก</h2>',

        '    <div class="master-toolbar">',
        '        <label for="masterSearch">ค้นหา</label>',
        '        <input type="text" id="masterSearch"' +
            ' placeholder="name / code group / sub group" autocomplete="off">',
        '    </div>',

        '    <p id="masterDbStatus" class="db-status"></p>',
        '    <ul id="masterList" class="saved-list"></ul>',
        '</section>'
    ].join('\n');

    const GROUP_FALLBACK = '(ไม่ระบุกลุ่ม)';
    const SUBGROUP_FALLBACK = '(ไม่ระบุกลุ่มย่อย)';

    let records = [];      // รายการ master ล่าสุดที่โหลดมาจากฐานข้อมูล
    let groups = [];       // กลุ่ม/กลุ่มย่อยที่กำหนดไว้ล่วงหน้า
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
            : '(ยังไม่มีกลุ่ม — เพิ่มที่ส่วน "กลุ่มและกลุ่มย่อย")';
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
