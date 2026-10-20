// Query Page - รัน SQL กับฐานข้อมูล SQLite โดยตรง (CRUD)
// (เมนู ประวัติและการตั้งค่า → Query)
//
//   - กล่องคำสั่ง SQL + ปุ่ม Run (Ctrl+Enter) หรือรันเฉพาะข้อความที่เลือก
//   - แสดงผลเป็นตาราง (คอลัมน์/แถว) หรือจำนวนแถวที่ถูกแก้ไข
//   - แถบซ้าย: ตาราง/วิวในฐานข้อมูล + คอลัมน์ + จำนวนแถว (คลิกเพื่อสร้าง SELECT)
//   - ประวัติคำสั่งล่าสุด (เก็บใน localStorage)
//
// คำสั่งที่แก้ข้อมูลมีผลกับฐานข้อมูลจริงทันที — คำสั่งที่เสี่ยง (DROP/ALTER/
// DELETE/UPDATE/REPLACE) จะถามยืนยันก่อนเสมอ
//
// หน้านี้ไม่ผูกกับไฟล์ .docx — standalone = true
(function (scope) {
    'use strict';

    // เก็บเฉพาะคำสั่งล่าสุด ไม่ให้ localStorage บวม
    const HISTORY_KEY = 'word-template-filler.query-history';
    const HISTORY_LIMIT = 20;

    // วาดตารางสูงสุดกี่แถว — ที่เหลือบอกจำนวนไว้ (ข้อมูลยังอยู่ครบในผลลัพธ์)
    const MAX_RENDER_ROWS = 500;

    const HTML = [
        '<h1>Query</h1>',

        '<div class="query-page" id="queryPage">',

        '    <p class="hint">',
        '        รันคำสั่ง SQL กับฐานข้อมูล SQLite ของแอปได้โดยตรง (SELECT / INSERT / UPDATE / DELETE / CREATE …)',
        '        — คำสั่งที่แก้ข้อมูลมีผลทันทีและย้อนกลับไม่ได้ ควรสำรองฐานข้อมูลก่อน',
        '        (หน้า "ฐานข้อมูล" → ดาวน์โหลดฐานข้อมูล)',
        '    </p>',

        '    <div class="query-layout">',

        // ── แถบซ้าย: โครงสร้างฐานข้อมูล + ประวัติ ──
        '        <aside class="query-schema">',
        '            <div class="query-schema-head">',
        '                <h2>ฐานข้อมูล</h2>',
        '                <button id="queryRefreshSchemaBtn" type="button" class="plain">รีเฟรช</button>',
        '            </div>',

        '            <p id="querySchemaStatus" class="hint"></p>',
        '            <ul id="queryTableList" class="query-tables"></ul>',

        '            <h2 class="query-history-head">ประวัติคำสั่ง</h2>',
        '            <ul id="queryHistoryList" class="query-history"></ul>',

        '            <p class="hint query-schema-hint">',
        '                คลิกชื่อตารางเพื่อเติมคำสั่ง SELECT ให้อัตโนมัติ',
        '            </p>',
        '        </aside>',

        // ── กล่องคำสั่ง + ผลลัพธ์ ──
        '        <section class="query-main">',
        '            <div class="query-editor-head">',
        '                <h2>คำสั่ง SQL</h2>',
        '                <div class="query-editor-actions">',
        '                    <button id="queryClearBtn" type="button" class="plain">ล้าง</button>',
        '                    <button id="queryRunBtn" type="button">Run (Ctrl+Enter)</button>',
        '                </div>',
        '            </div>',

        '            <textarea id="querySql" class="query-sql" rows="10" spellcheck="false"',
        '                      placeholder="SELECT * FROM templates LIMIT 20;&#10;-- เลือกข้อความแล้วกด Run เพื่อรันเฉพาะส่วนที่เลือก"></textarea>',

        '            <p id="queryStatus" class="db-status"></p>',
        '            <div id="queryResult" class="query-result"></div>',
        '        </section>',

        '    </div>',
        '</div>'
    ].join('\n');

    // ค่าที่กรอกไว้ — จำข้ามการเปลี่ยนหน้า
    const state = {
        sql: '',
        history: [],       // คำสั่งล่าสุด (ใหม่ก่อน)
        objects: [],       // โครงสร้างล่าสุดจากฐานข้อมูล
        running: false
    };

    function el(id) {
        return document.getElementById(id);
    }

    function setStatus(node, message, kind) {
        if (!node) return;

        node.textContent = message || '';
        node.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    // ──────────────────────────────────────────────────────────────
    // ประวัติคำสั่ง (localStorage)
    // ──────────────────────────────────────────────────────────────

    function loadHistory() {
        try {
            const raw = window.localStorage.getItem(HISTORY_KEY);
            const list = raw ? JSON.parse(raw) : [];

            state.history = Array.isArray(list)
                ? list.filter(function (item) {
                    return typeof item === 'string' && item.trim() !== '';
                }).slice(0, HISTORY_LIMIT)
                : [];
        } catch (error) {
            state.history = [];
        }
    }

    function saveHistory() {
        try {
            window.localStorage.setItem(
                HISTORY_KEY,
                JSON.stringify(state.history)
            );
        } catch (error) {
            // เก็บไม่ได้ (เช่น พื้นที่เต็ม) = ใช้ได้เฉพาะรอบนี้
        }
    }

    function pushHistory(sql) {
        const value = String(sql || '').trim();

        if (value === '') return;

        state.history = state.history.filter(function (item) {
            return item !== value;
        });

        state.history.unshift(value);
        state.history = state.history.slice(0, HISTORY_LIMIT);

        saveHistory();
        renderHistory();
    }

    function renderHistory() {
        const list = el('queryHistoryList');
        if (!list) return;

        list.innerHTML = '';

        if (state.history.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = 'ยังไม่มีคำสั่งที่รัน';
            list.appendChild(empty);
            return;
        }

        state.history.forEach(function (sql, index) {
            const item = document.createElement('li');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'plain';
            button.dataset.queryHistory = String(index);
            button.title = sql;

            // แสดงบรรทัดแรกให้อ่านง่าย ไม่ให้แถบซ้ายยาวเกิน
            const firstLine = sql.split('\n')[0].trim();

            button.textContent = firstLine.length > 64
                ? firstLine.slice(0, 64) + '…'
                : firstLine;

            item.appendChild(button);
            list.appendChild(item);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // โครงสร้างฐานข้อมูล
    // ──────────────────────────────────────────────────────────────

    function renderSchema() {
        const list = el('queryTableList');
        const status = el('querySchemaStatus');

        if (!list) return;

        list.innerHTML = '';

        if (state.objects.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = 'ไม่พบตารางในฐานข้อมูล';
            list.appendChild(empty);

            setStatus(status, '');
            return;
        }

        state.objects.forEach(function (object) {
            const item = document.createElement('li');
            item.className = 'query-table-item';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'query-table-btn';
            button.dataset.queryTable = object.name;
            button.title = 'เติมคำสั่ง SELECT * FROM ' + object.name;

            const name = document.createElement('strong');
            name.textContent = object.name;

            const meta = document.createElement('span');
            meta.className = 'query-table-meta';
            meta.textContent = (object.type === 'view' ? 'วิว' : 'ตาราง') +
                ' · ' +
                Number(object.rowCount || 0).toLocaleString('th-TH') +
                ' แถว';

            button.appendChild(name);
            button.appendChild(meta);

            const columns = document.createElement('p');
            columns.className = 'query-columns';
            columns.textContent = object.columns.length > 0
                ? object.columns.map(function (column) {
                    return column.name +
                        (column.type ? ' ' + column.type : '') +
                        (column.primaryKey ? ' PK' : '');
                }).join(' · ')
                : 'ไม่มีคอลัมน์';

            item.appendChild(button);
            item.appendChild(columns);
            list.appendChild(item);
        });

        const tables = state.objects.filter(function (object) {
            return object.type === 'table';
        }).length;

        setStatus(
            status,
            'ตาราง ' + tables + ' · วิว ' + (state.objects.length - tables)
        );
    }

    async function loadSchema() {
        const status = el('querySchemaStatus');

        setStatus(status, 'กำลังโหลดโครงสร้าง...');

        try {
            const result = await scope.Db.schema();

            state.objects = (result && result.objects) || [];

            renderSchema();
        } catch (error) {
            state.objects = [];
            renderSchema();
            setStatus(
                status,
                'โหลดโครงสร้างไม่สำเร็จ: ' + (error.message || error),
                'error'
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ผลลัพธ์
    // ──────────────────────────────────────────────────────────────

    // ค่าที่มาจาก SQLite: null / ตัวเลข / ข้อความ / BLOB (Uint8Array)
    function formatCell(value) {
        if (value === null || value === undefined) return 'NULL';

        if (typeof value === 'bigint') return String(value);

        if (value instanceof Uint8Array) {
            return '<BLOB ' + value.byteLength + ' ไบต์>';
        }

        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return String(value);
            }
        }

        return String(value);
    }

    function clearResult() {
        const container = el('queryResult');

        if (container) container.innerHTML = '';
    }

    function renderRows(result) {
        const container = el('queryResult');

        if (!container) return;

        container.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'query-table-wrap';

        const table = document.createElement('table');
        table.className = 'query-grid';

        const head = document.createElement('thead');
        const headRow = document.createElement('tr');

        result.columns.forEach(function (column) {
            const th = document.createElement('th');
            th.textContent = column;
            headRow.appendChild(th);
        });

        head.appendChild(headRow);
        table.appendChild(head);

        const body = document.createElement('tbody');

        const rows = result.rows.slice(0, MAX_RENDER_ROWS);

        if (rows.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');

            cell.colSpan = Math.max(result.columns.length, 1);
            cell.className = 'query-empty';
            cell.textContent = 'คำสั่งนี้ทำงานแล้ว แต่ไม่มีแถวข้อมูล';

            row.appendChild(cell);
            body.appendChild(row);
        }

        rows.forEach(function (values) {
            const row = document.createElement('tr');

            result.columns.forEach(function (unused, index) {
                const cell = document.createElement('td');
                const value = values[index];

                cell.textContent = formatCell(value);

                if (value === null || value === undefined) {
                    cell.classList.add('null');
                }

                row.appendChild(cell);
            });

            body.appendChild(row);
        });

        table.appendChild(body);
        wrap.appendChild(table);
        container.appendChild(wrap);
    }

    function describeResult(result, sql) {
        if (result.kind === 'change') {
            const parts = [
                'สำเร็จ',
                'แก้ไข ' + Number(result.changes || 0).toLocaleString('th-TH') + ' แถว'
            ];

            // lastInsertRowid ของ SQLite ค้างอยู่จาก INSERT ครั้งก่อน — UPDATE/DELETE
            // จึงรายงาน id เดิมได้ (อ่านแล้วเข้าใจผิด) → แสดงเฉพาะคำสั่งที่เพิ่มแถวใหม่
            const keyword = firstKeyword(sql || '');

            if (
                (keyword === 'insert' || keyword === 'replace') &&
                Number(result.lastInsertRowid) > 0
            ) {
                parts.push('id ล่าสุด ' + result.lastInsertRowid);
            }

            parts.push((result.durationMs || 0) + ' ms');

            return parts.join(' · ');
        }

        return [
            'สำเร็จ',
            Number(result.rowCount || 0).toLocaleString('th-TH') + ' แถว',
            (result.durationMs || 0) + ' ms',
            result.rows.length > MAX_RENDER_ROWS
                ? 'แสดง ' + MAX_RENDER_ROWS + ' แถวแรก'
                : ''
        ].filter(Boolean).join(' · ');
    }

    function renderResult(result, sql) {
        const status = el('queryStatus');

        if (result.kind === 'rows') {
            renderRows(result);
            setStatus(status, describeResult(result, sql));
            return;
        }

        clearResult();
        setStatus(status, describeResult(result, sql));
    }

    function renderError(message) {
        const status = el('queryStatus');
        const container = el('queryResult');

        if (container) {
            container.innerHTML = '';

            const box = document.createElement('p');
            box.className = 'query-error';
            box.textContent = String(message || 'คำสั่ง SQL ผิดพลาด');

            container.appendChild(box);
        }

        setStatus(status, 'ผิดพลาด', 'error');
    }

    // ──────────────────────────────────────────────────────────────
    // รันคำสั่ง
    // ──────────────────────────────────────────────────────────────

    function firstKeyword(sql) {
        // ข้ามคอมเมนต์/ช่องว่างหัวคำสั่ง เพื่อดูว่าเป็นคำสั่งอะไร
        const cleaned = String(sql || '')
            .replace(/^\uFEFF/, '')
            .replace(/^(\s|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/)+/, '');

        const match = /^[A-Za-z]+/.exec(cleaned);

        return match ? match[0].toLowerCase() : '';
    }

    function selectedSql() {
        const area = el('querySql');

        if (!area) return '';

        if (area.selectionStart === area.selectionEnd) return '';

        return area.value.slice(area.selectionStart, area.selectionEnd).trim();
    }

    // คำสั่งที่แก้ข้อมูล/harm — ถามก่อนรัน (INSERT/CREATE ไม่ถาม)
    function needsConfirm(sql) {
        const keyword = firstKeyword(sql);

        if (['drop', 'alter', 'truncate', 'delete', 'update', 'replace'].indexOf(keyword) !== -1) {
            return true;
        }

        // WITH ... DELETE / UPDATE = เขียนข้อมูลผ่าน CTE
        if (keyword === 'with') {
            return /\b(delete|update|insert|replace)\b/i.test(sql);
        }

        return /\b(drop|alter|truncate)\b/i.test(sql);
    }

    function confirmMessage(sql) {
        const keyword = firstKeyword(sql);
        const firstLine = sql.split('\n')[0].trim();
        const preview = sql.length > 220 ? sql.slice(0, 220) + ' …' : sql;

        const lines = [
            'จะรันคำสั่งนี้กับฐานข้อมูลจริง:',
            '',
            preview
        ];

        if (
            (keyword === 'delete' || keyword === 'update') &&
            !/\bwhere\b/i.test(sql)
        ) {
            lines.push(
                '',
                keyword === 'delete'
                    ? '⚠ ไม่มี WHERE — จะลบทุกแถวในตาราง'
                    : '⚠ ไม่มี WHERE — จะแก้ทุกแถวในตาราง'
            );
        }

        lines.push('', 'ย้อนกลับไม่ได้ — ดำเนินการต่อหรือไม่?');

        return lines.join('\n');
    }

    function setRunning(running) {
        state.running = running;

        const button = el('queryRunBtn');
        const area = el('querySql');

        if (button) {
            button.disabled = running;
            button.textContent = running ? 'กำลังรัน...' : 'Run (Ctrl+Enter)';
        }

        if (area) area.readOnly = running;
    }

    async function runQuery() {
        if (state.running) return;

        const area = el('querySql');
        const status = el('queryStatus');

        if (!area) return;

        const sql = (selectedSql() || area.value).trim();

        if (sql === '') {
            setStatus(status, 'ยังไม่มีคำสั่ง SQL', 'error');
            return;
        }

        if (needsConfirm(sql)) {
            const ok = await scope.AppDialog.confirm(confirmMessage(sql));

            if (!ok) return;
        }

        setRunning(true);
        setStatus(status, 'กำลังรัน...');

        try {
            const result = await scope.Db.query(sql);

            renderResult(result || { kind: 'change', changes: 0 }, sql);

            pushHistory(sql);

            // คำสั่งที่เปลี่ยนโครงสร้าง/ข้อมูล → จำนวนแถวในแถบซ้ายต้องตรง
            if (!result || result.kind !== 'rows') {
                await loadSchema();
            }

        } catch (error) {
            renderError(error && error.message ? error.message : error);
        } finally {
            setRunning(false);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ผูก event (DOM ถูกสร้างใหม่ทุกครั้งที่เข้าหน้า)
    // ──────────────────────────────────────────────────────────────

    function fillSql(sql) {
        const area = el('querySql');

        if (!area) return;

        area.value = sql;
        state.sql = sql;

        if (area.focus) area.focus();

        // วางเคอร์เซอร์ท้ายคำสั่งเพื่อพิมพ์ต่อได้ทันที
        if (area.setSelectionRange) {
            const end = sql.length;
            area.setSelectionRange(end, end);
        }
    }

    function bind() {
        const runBtn = el('queryRunBtn');
        const clearBtn = el('queryClearBtn');
        const refreshBtn = el('queryRefreshSchemaBtn');
        const area = el('querySql');
        const tableList = el('queryTableList');
        const historyList = el('queryHistoryList');

        if (!area) return;

        area.addEventListener('input', function () {
            state.sql = area.value;
        });

        area.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                runQuery();
            }
        });

        runBtn.addEventListener('click', runQuery);

        clearBtn.addEventListener('click', function () {
            area.value = '';
            state.sql = '';
            clearResult();
            setStatus(el('queryStatus'), '');
            area.focus();
        });

        refreshBtn.addEventListener('click', loadSchema);

        tableList.addEventListener('click', function (event) {
            const button = event.target.closest('[data-query-table]');

            if (!button) return;

            const name = button.dataset.queryTable;

            fillSql('SELECT * FROM "' + name.replace(/"/g, '""') + '" LIMIT 50;');
        });

        historyList.addEventListener('click', function (event) {
            const button = event.target.closest('[data-query-history]');

            if (!button) return;

            const index = Number(button.dataset.queryHistory);
            const sql = state.history[index];

            if (typeof sql === 'string') fillSql(sql);
        });
    }

    const page = {

        // หน้านี้จัดการ UI เอง ไม่ขึ้นกับไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        // เรียกจาก app.js หลังวาดหน้าเสร็จ
        onShow: function () {
            if (state.history.length === 0) loadHistory();

            bind();
            fillSql(state.sql);
            renderHistory();
            renderSchema();
            loadSchema();
        }
    };

    scope.QueryPage = page;
})(window);
