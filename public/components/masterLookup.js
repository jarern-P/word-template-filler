// Master Lookup - popup เลือกข้อมูลจาก Master Data มาใส่ช่องข้อความในหน้ารายงาน
//
// เรียกใช้: scope.MasterLookup.open(field)
// ปุ่มที่เปิด popup คือปุ่มแว่นขยายที่ FieldTypes สร้างให้ (data-lookup-for="<ชื่อ field>")
// เมื่อเลือกแล้วจะเขียนค่าลงช่อง [data-field] ของหน้ารายงานและยิง event
// input/change ให้ app.js เก็บค่าเหมือนผู้ใช้พิมพ์เอง
(function (scope) {
    'use strict';

    const ALL_GROUPS = '';             // value ของตัวเลือก "ทุกกลุ่ม"
    const ALL_SUBGROUPS = '';          // value ของตัวเลือก "ทุกกลุ่มย่อย"
    const GROUP_FALLBACK = '(ไม่ระบุกลุ่ม)';
    const SUBGROUP_FALLBACK = '(ไม่ระบุกลุ่มย่อย)';

    const HTML = [
        '<div class="lookup-backdrop"></div>',
        '<div class="lookup-dialog" role="dialog" aria-modal="true" aria-labelledby="lookupTitle">',
        '    <div class="lookup-head">',
        '        <h2 id="lookupTitle">เลือกข้อมูลหลัก</h2>',
        '        <button type="button" class="lookup-close" aria-label="ปิด">&times;</button>',
        '    </div>',
        '    <div class="lookup-toolbar">',
        '        <select id="lookupGroup" aria-label="กรองตาม Code Group"></select>',
        '        <select id="lookupSubgroup" aria-label="กรองตาม Sub Group"></select>',
        '        <input type="text" id="lookupSearch" placeholder="ค้นหา name" autocomplete="off">',
        '    </div>',
        '    <p id="lookupStatus" class="db-status"></p>',
        '    <ul id="lookupList" class="lookup-list"></ul>',
        '</div>'
    ].join('\n');

    let overlay = null;      // popup (สร้างครั้งเดียวตอนเปิดครั้งแรก)
    let records = [];        // master data ที่โหลดมาใช้ในรอบนี้
    let activeField = '';    // ชื่อ field ที่กำลังเลือกค่าให้
    let groupFilter = ALL_GROUPS;
    let subgroupFilter = ALL_SUBGROUPS;
    let keyword = '';

    function el(id) {
        return document.getElementById(id);
    }

    function setStatus(text, kind) {
        const node = el('lookupStatus');
        if (!node) return;

        node.textContent = text || '';
        node.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    function appendEmpty(list, message) {
        const item = document.createElement('li');
        item.className = 'empty';
        item.textContent = message;
        list.appendChild(item);
    }

    function groupOf(record) {
        return record.code_group || '';
    }

    function subgroupOf(record) {
        return record.sub_group || '';
    }

    // ──────────────────────────────────────────────────────────────
    // วาด popup
    // ──────────────────────────────────────────────────────────────

    function renderGroupOptions() {
        const select = el('lookupGroup');
        if (!select) return;

        const groups = [];

        records.forEach(function (record) {
            const group = groupOf(record);
            if (groups.indexOf(group) === -1) {
                groups.push(group);
            }
        });

        select.innerHTML = '';

        const all = document.createElement('option');
        all.value = ALL_GROUPS;
        all.textContent = 'ทุกกลุ่ม';
        select.appendChild(all);

        groups.forEach(function (group) {
            const option = document.createElement('option');
            option.value = group;
            option.textContent = group || GROUP_FALLBACK;
            select.appendChild(option);
        });

        // กลุ่มที่เคยเลือกอาจไม่มีอยู่ในข้อมูลแล้ว
        if (groupFilter && groups.indexOf(groupFilter) === -1) {
            groupFilter = ALL_GROUPS;
        }

        select.value = groupFilter;
    }

    // เติมกลุ่มย่อยให้เลือกตามกลุ่มที่กรองอยู่
    function renderSubgroupOptions() {
        const select = el('lookupSubgroup');
        if (!select) return;

        const subgroups = [];

        records.forEach(function (record) {
            if (groupFilter && groupOf(record) !== groupFilter) return;

            const subgroup = subgroupOf(record);
            if (subgroup && subgroups.indexOf(subgroup) === -1) {
                subgroups.push(subgroup);
            }
        });

        select.innerHTML = '';

        const all = document.createElement('option');
        all.value = ALL_SUBGROUPS;
        all.textContent = 'ทุกกลุ่มย่อย';
        select.appendChild(all);

        subgroups.forEach(function (subgroup) {
            const option = document.createElement('option');
            option.value = subgroup;
            option.textContent = subgroup;
            select.appendChild(option);
        });

        // กลุ่มย่อยที่เคยเลือกอาจไม่มีในข้อมูลแล้ว
        if (subgroupFilter && subgroups.indexOf(subgroupFilter) === -1) {
            subgroupFilter = ALL_SUBGROUPS;
        }

        select.value = subgroupFilter;
        select.disabled = subgroups.length === 0;
    }

    function matches(record) {
        if (groupFilter && groupOf(record) !== groupFilter) {
            return false;
        }

        if (subgroupFilter && subgroupOf(record) !== subgroupFilter) {
            return false;
        }

        if (!keyword) return true;

        return [
            record.name,
            record.sub_group
        ].join(' ')
            .toLowerCase()
            .indexOf(keyword) !== -1;
    }

    function renderList() {
        const list = el('lookupList');
        if (!list) return;

        list.innerHTML = '';

        if (records.length === 0) {
            appendEmpty(list, 'ยังไม่มีข้อมูล Master Data');
            return;
        }

        const filtered = records.filter(matches);

        if (filtered.length === 0) {
            appendEmpty(list, 'ไม่พบข้อมูลที่ค้นหา');
            return;
        }

        // ใช้ textContent ทุกจุด เพราะค่ามาจากผู้ใช้ (กัน XSS)
        filtered.forEach(function (record) {
            const item = document.createElement('li');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'lookup-item';
            button.dataset.id = String(record.id);

            const name = document.createElement('span');
            name.className = 'lookup-name';
            name.textContent = record.name;

            const group = document.createElement('span');
            group.className = 'lookup-group';
            group.textContent = record.sub_group
                ? (record.code_group || GROUP_FALLBACK) + ' / ' + record.sub_group
                : (record.code_group || GROUP_FALLBACK);

            button.appendChild(name);
            button.appendChild(group);
            item.appendChild(button);
            list.appendChild(item);
        });
    }

    function loadRecords() {
        setStatus('กำลังโหลด...');

        scope.Db.masterList()
            .then(function (list) {
                records = Array.isArray(list) ? list : [];
                setStatus('');
                renderGroupOptions();
                renderSubgroupOptions();
                renderList();
            })
            .catch(function (error) {
                console.error(error);

                records = [];
                setStatus('โหลดข้อมูลไม่สำเร็จ: ' + error.message, 'error');
                renderGroupOptions();
                renderSubgroupOptions();
                renderList();
            });
    }

    // ──────────────────────────────────────────────────────────────
    // เขียนค่ากลับเข้าฟอร์ม
    // ──────────────────────────────────────────────────────────────

    function findControl(field) {
        const form = document.getElementById('form');
        if (!form) return null;

        let found = null;

        form.querySelectorAll('[data-field]').forEach(function (control) {
            if (control.dataset.field === field) {
                found = control;
            }
        });

        return found;
    }

    function fillControl(value) {
        const control = findControl(activeField);
        if (!control) return;

        scope.FormPage.writeControlValue(control, value);

        // ให้ app.js เก็บค่าและอัปเดตข้อความ preview เหมือนผู้ใช้พิมพ์เอง
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ──────────────────────────────────────────────────────────────
    // เปิด / ปิด popup
    // ──────────────────────────────────────────────────────────────

    function close() {
        if (overlay) {
            overlay.classList.remove('open');
        }

        activeField = '';
    }

    function open(field) {
        buildOverlay();

        activeField = field;
        keyword = '';

        const title = el('lookupTitle');
        if (title) {
            title.textContent = 'เลือกข้อมูล Master Data — ' + field;
        }

        const search = el('lookupSearch');
        if (search) {
            search.value = '';
        }

        overlay.classList.add('open');

        renderGroupOptions();
        renderSubgroupOptions();
        renderList();
        loadRecords();

        if (search && search.focus) {
            search.focus();
        }
    }

    function buildOverlay() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'lookup-overlay';
        overlay.id = 'masterLookup';
        overlay.innerHTML = HTML;

        document.body.appendChild(overlay);

        overlay.querySelector('.lookup-backdrop')
            .addEventListener('click', close);

        overlay.querySelector('.lookup-close')
            .addEventListener('click', close);

        el('lookupGroup').addEventListener('change', function (event) {
            groupFilter = event.target.value;
            subgroupFilter = ALL_SUBGROUPS;
            renderSubgroupOptions();
            renderList();
        });

        el('lookupSubgroup').addEventListener('change', function (event) {
            subgroupFilter = event.target.value;
            renderList();
        });

        el('lookupSearch').addEventListener('input', function (event) {
            keyword = event.target.value.trim().toLowerCase();
            renderList();
        });

        el('lookupList').addEventListener('click', function (event) {
            const button = event.target.closest('.lookup-item');
            if (!button) return;

            const record = records.find(function (item) {
                return Number(item.id) === Number(button.dataset.id);
            });

            if (!record) return;

            fillControl(record.name);
            close();
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                close();
            }
        });
    }

    // ปุ่มแว่นขยายถูกสร้างใหม่ทุกครั้งที่ render ฟอร์ม จึงใช้ event delegation
    document.addEventListener('click', function (event) {
        const button = event.target.closest
            ? event.target.closest('[data-lookup-for]')
            : null;

        if (!button) return;

        event.preventDefault();
        open(button.dataset.lookupFor);
    });

    scope.MasterLookup = {
        open: open,
        close: close
    };
})(window);
