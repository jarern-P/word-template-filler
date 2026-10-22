// OCR Training Page - ฝึก OCR จากคำที่อ่านผิด + คลังคำที่แก้
// (เมนู ประวัติและการตั้งค่า → ฝึก OCR)
//
// หน้านี้ไม่ผูกกับไฟล์ .docx และไม่ต้องมีแม่แบบ — standalone = true
//
// วงจรการฝึก:
//   1. อัปโหลด PDF ที่เป็นเอกสารสแกน → ระบบ OCR แล้วยกคำที่ confidence ต่ำมาเป็นคิว
//   2. ผู้ใช้แก้คำ → เก็บลงตาราง ocr_fixes (ฐานข้อมูล) และใช้แทนอัตโนมัติเมื่ออ่านไฟล์ครั้งถัดไป
//   3. คำที่เคยแก้ไว้ใกล้กับคำในคิวจะถูกแนะนำ (Levenshtein)
//      — กดใช้ = นับ accepted, กดไม่ใช้ = นับ rejected เพื่อจัดอันดับครั้งถัดไป
//
// หมายเหตุ: ชั้นนี้ไม่ได้เทรนโมเดล tesseract (ต้องใช้ tesstrain นอกแอป)
// แต่ทำให้คำที่เจอบ่อย/ใกล้เคียงถูกแก้ให้อัตโนมัติ และเรียนรู้จากผู้ใช้ไปเรื่อย ๆ
(function (scope) {
    'use strict';

    // ต่ำกว่านี้ = ควรให้คนตรวจ (tesseract ให้ค่า 0-100)
    const LOW_CONFIDENCE = 70;

    // จำนวนคำในคิวสูงสุด (กันหน้าเว็บหนักถ้าไฟล์มีคำเยอะ)
    const MAX_QUEUE = 60;

    // จำนวนรายการในคลังที่แสดงพร้อมกัน
    const MAX_LIBRARY = 300;

    const HTML = [
        '<div id="ocrTrainRoot" class="ocr-training">',

        '    <h1>ฝึก OCR</h1>',

        '    <p class="hint ocr-intro">',
        '        แก้คำที่ OCR อ่านผิดจากไฟล์ PDF — ระบบเก็บเป็นคลังคำและแทนให้อัตโนมัติ',
        '        เมื่ออ่านไฟล์ครั้งถัดไป คำที่เคยแก้ไว้ใกล้เคียงจะถูกแนะนำ',
        '        และระบบจำว่าคำแนะนำไหนถูกใช้/ไม่ใช้',
        '    </p>',

        '    <section class="ocr-stats" id="ocrStats"></section>',

        '    <section class="suggest-settings">',
        '        <h2>ฝึกจากไฟล์ PDF</h2>',

        '        <p class="hint">',
        '            อัปโหลด PDF ที่เป็นเอกสารสแกน — ระบบจะ OCR แล้วยกเฉพาะคำที่มั่นใจต่ำมาให้ตรวจ',
        '            (ไฟล์ที่มีชั้นข้อความอยู่แล้วไม่ต้องฝึก เพราะไม่ได้ใช้ OCR)',
        '        </p>',

        '        <div class="form-actions">',
        '            <button id="ocrTrainUploadBtn" type="button">อัปโหลด PDF เพื่อฝึก</button>',
        '            <span id="ocrTrainFile" class="hint"></span>',
        '        </div>',

        '        <input type="file" id="ocrTrainInput" accept=".pdf" hidden>',
        '        <p id="ocrTrainStatus" class="db-status"></p>',

        '        <div id="ocrQueueWrap" hidden>',
        '            <div class="ocr-queue-head">',
        '                <h3>คำที่ควรตรวจ</h3>',
        '                <span id="ocrQueueCount" class="ocr-count"></span>',
        '            </div>',
        '            <ul id="ocrQueue" class="ocr-queue"></ul>',
        '        </div>',
        '    </section>',

        '    <section class="saved-templates">',
        '        <h2>คลังคำที่แก้</h2>',

        '        <div class="master-toolbar ocr-toolbar">',
        '            <label for="ocrFixSearch">ค้นหา</label>',
        '            <input type="text" id="ocrFixSearch" autocomplete="off"',
        '                   placeholder="คำที่อ่านผิดหรือคำที่ถูกต้อง">',
        '            <button id="ocrFixAddBtn" type="button" class="plain">เพิ่มคำ</button>',
        '            <button id="ocrFixExportBtn" type="button" class="plain">ส่งออก JSON</button>',
        '            <button id="ocrFixImportBtn" type="button" class="plain">นำเข้า JSON</button>',
        '        </div>',

        '        <input type="file" id="ocrFixImportInput" accept=".json,application/json" hidden>',
        '        <p id="ocrFixStatus" class="db-status"></p>',
        '        <ul id="ocrFixList" class="saved-list"></ul>',
        '    </section>',

        '    <section class="saved-templates">',
        '        <h2>กลุ่มคำที่ถูกตัดข้ามบรรทัด</h2>',

        '        <p class="hint">',
        '            คำเดียวที่ OCR ตัดเป็นสองบรรทัด (เช่น "เลข" อยู่บรรทัดบน "ที่" อยู่บรรทัดล่าง)',
        '            — คลิกเลือกคำบนภาพ PDF เพื่อสร้างกลุ่ม แล้วระบบจะรวมให้อัตโนมัติเมื่ออ่านไฟล์ครั้งถัดไป',
        '        </p>',

        '        <div class="form-actions">',
        '            <button id="ocrGroupAddBtn" type="button">สร้างกลุ่มจาก PDF</button>',
        '            <span id="ocrGroupHint" class="hint"></span>',
        '        </div>',

        '        <p id="ocrGroupStatus" class="db-status"></p>',
        '        <ul id="ocrGroupList" class="saved-list"></ul>',
        '    </section>',

        '    <section class="saved-templates">',
        '        <h2>คำที่ OCR เก็บเกิน</h2>',

        '        <p class="hint">',
        '            สระ/วรรณยุกต์ที่ OCR แยกออกมาเป็นคำต่างหาก หรือคำที่ไม่ต้องใช้ —',
        '            คำในรายการนี้จะถูกตัดออกจากข้อความก่อนจับ regex',
        '        </p>',

        '        <p class="hint">',
        '            เพิ่มได้จากภาพ PDF: เปิดหน้าตรวจคำ แล้วกดปุ่ม "ลบคำ" ที่คำนั้น',
        '        </p>',

        '        <p id="ocrDropStatus" class="db-status"></p>',
        '        <ul id="ocrDropList" class="saved-list"></ul>',
        '    </section>',
        '</div>'
    ].join('\n');

    const state = {
        fixes: [],
        groups: [],      // กลุ่มคำที่ถูกตัดข้ามบรรทัด (จากตาราง ocr_word_groups)
        drops: [],       // คำที่ OCR เก็บเกิน — ตัดออกตอนอ่านไฟล์ (ocr_drop_words)
        pages: [],       // หน้า OCR ล่าสุด (อยู่ในหน่วยความจำจนปิดแอป)
        fileName: '',
        queue: [],
        search: '',
        rejected: {},    // คำแนะนำที่ผู้ใช้กด "ไม่ใช่" แล้ว (ซ่อนเฉพาะรอบนี้)
        ignored: {}      // คำที่ผู้ใช้ยืนยันว่าอ่านถูกแล้ว (ซ่อนเฉพาะรอบนี้)
    };

    function el(id) {
        return document.getElementById(id);
    }

    function setStatus(targetId, text, kind) {
        const node = el(targetId);

        if (!node) return;

        node.textContent = text || '';
        node.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    function setBusy(busy) {
        const button = el('ocrTrainUploadBtn');

        if (button) button.disabled = !!busy;
    }

    // ──────────────────────────────────────────────────────────────
    // สถิติ + คลังคำ
    // ──────────────────────────────────────────────────────────────

    async function reloadFixes() {
        try {
            await scope.DataExtract.refreshTextFixes();
        } catch (error) {
            console.error(error);
        }

        try {
            await scope.DataExtract.refreshWordGroups();
            await scope.DataExtract.refreshDropWords();
        } catch (error) {
            console.error(error);
        }

        state.fixes = scope.DataExtract.loadTextFixes();
        state.groups = scope.DataExtract.loadWordGroups();
        state.drops = scope.DataExtract.loadDropWords();

        renderStats();
        renderFixes();
        renderGroups();
        renderDrops();
    }

    function renderStats() {
        const host = el('ocrStats');

        if (!host) return;

        const hits = state.fixes.reduce(function (sum, fix) {
            return sum + fix.hits;
        }, 0);

        const accepted = state.fixes.reduce(function (sum, fix) {
            return sum + fix.accepted;
        }, 0);

        const rejected = state.fixes.reduce(function (sum, fix) {
            return sum + fix.rejected;
        }, 0);

        const items = [
            [state.fixes.length, 'คำในคลัง'],
            [hits, 'ครั้งที่แทนให้'],
            [accepted, 'คำแนะนำที่ใช้'],
            [rejected, 'คำแนะนำที่ไม่ใช้']
        ];

        host.innerHTML = '';

        items.forEach(function (item) {
            const card = document.createElement('div');
            card.className = 'ocr-stat';

            const value = document.createElement('strong');
            value.textContent = String(item[0]);

            const label = document.createElement('span');
            label.textContent = item[1];

            card.appendChild(value);
            card.appendChild(label);
            host.appendChild(card);
        });
    }

    function renderFixes() {
        const list = el('ocrFixList');

        if (!list) return;

        state.fixes = scope.DataExtract.loadTextFixes();

        const query = state.search.trim().toLowerCase();

        const filtered = state.fixes.filter(function (fix) {
            if (query === '') return true;

            return (
                fix.from.toLowerCase().indexOf(query) !== -1 ||
                fix.to.toLowerCase().indexOf(query) !== -1
            );
        });

        list.innerHTML = '';

        if (filtered.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = state.fixes.length === 0
                ? 'ยังไม่มีคำที่แก้ — อัปโหลด PDF ด้านบน หรือกด "เพิ่มคำ"'
                : 'ไม่พบรายการที่ค้นหา';

            list.appendChild(empty);
            return;
        }

        filtered.slice(0, MAX_LIBRARY).forEach(function (fix) {
            const item = document.createElement('li');
            item.className = 'saved-item';

            const info = document.createElement('div');
            info.className = 'info';

            const pair = document.createElement('strong');
            pair.className = 'ocr-fix-pair';
            pair.textContent = fix.from + ' → ' + fix.to;

            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = [
                'แทนอัตโนมัติ ' + fix.hits + ' ครั้ง',
                fix.accepted > 0 ? 'ใช้คำแนะนำ ' + fix.accepted : '',
                fix.rejected > 0 ? 'ไม่ใช้ ' + fix.rejected : '',
                fix.lastConfidence == null
                    ? ''
                    : 'confidence ' + Math.round(fix.lastConfidence) + '%'
            ].filter(Boolean).join(' · ');

            info.appendChild(pair);
            info.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'actions';

            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'plain';
            edit.textContent = 'แก้';
            edit.dataset.ocrFixEdit = fix.from;

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'danger';
            remove.textContent = 'ลบ';
            remove.dataset.ocrFixDelete = fix.from;

            actions.appendChild(edit);
            actions.appendChild(remove);

            item.appendChild(info);
            item.appendChild(actions);
            list.appendChild(item);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // กลุ่มคำที่ถูกตัดข้ามบรรทัด
    // ──────────────────────────────────────────────────────────────

    function renderGroups() {
        const list = el('ocrGroupList');

        if (!list) return;

        list.innerHTML = '';

        if (state.groups.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent =
                'ยังไม่มีกลุ่มคำ — อัปโหลด PDF แล้วกด "สร้างกลุ่มจาก PDF" เพื่อเลือกคำที่ถูกตัดข้ามบรรทัด';

            list.appendChild(empty);
            return;
        }

        state.groups.slice(0, MAX_LIBRARY).forEach(function (group) {
            const item = document.createElement('li');
            item.className = 'saved-item';

            const info = document.createElement('div');
            info.className = 'info';

            const pair = document.createElement('strong');
            pair.className = 'ocr-fix-pair';
            pair.textContent = group.tokens.join(' + ') + ' → ' + group.merged;

            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = 'รวมให้ ' + group.hits + ' ครั้ง';

            info.appendChild(pair);
            info.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'actions';

            const edit = document.createElement('button');
            edit.type = 'button';
            edit.className = 'plain';
            edit.textContent = 'แก้';
            edit.dataset.ocrGroupEdit = JSON.stringify(group.tokens);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'danger';
            remove.textContent = 'ลบ';
            remove.dataset.ocrGroupDelete = JSON.stringify(group.tokens);

            actions.appendChild(edit);
            actions.appendChild(remove);

            item.appendChild(info);
            item.appendChild(actions);
            list.appendChild(item);
        });
    }

    function tokensFromDataset(value) {
        try {
            const parsed = JSON.parse(value);

            return Array.isArray(parsed)
                ? parsed.map(function (token) {
                    return String(token);
                })
                : [];
        } catch (error) {
            return [];
        }
    }

    async function editGroup(tokens, merged) {
        const value = await scope.AppDialog.prompt(
            'คำที่รวมแล้วของ "' + tokens.join(' + ') + '"',
            merged
        );

        if (value == null) return;

        const target = String(value).trim();

        if (target === '') {
            setStatus('ocrGroupStatus', 'คำที่รวมแล้วต้องไม่ว่าง', 'warn');
            return;
        }

        try {
            await scope.DataExtract.saveWordGroupAsync(tokens, target);
            await reloadFixes();
            setStatus(
                'ocrGroupStatus',
                'บันทึกแล้ว: ' + tokens.join(' + ') + ' → ' + target,
                'ok'
            );
        } catch (error) {
            setStatus(
                'ocrGroupStatus',
                (error && error.message) || 'บันทึกไม่สำเร็จ',
                'error'
            );
        }
    }

    async function removeGroup(tokens) {
        const confirmed = await scope.AppDialog.confirm(
            'ลบกลุ่ม "' + tokens.join(' + ') + '" ออกจากคลัง?\n' +
            'การอ่านไฟล์ครั้งถัดไปจะไม่รวมคำนี้อีก',
            { danger: true }
        );

        if (!confirmed) return;

        try {
            await scope.DataExtract.deleteWordGroupAsync(tokens);
            await reloadFixes();
            setStatus(
                'ocrGroupStatus',
                'ลบแล้ว: ' + tokens.join(' + '),
                'ok'
            );
        } catch (error) {
            setStatus(
                'ocrGroupStatus',
                (error && error.message) || 'ลบไม่สำเร็จ',
                'error'
            );
        }
    }

    // เปิดภาพ PDF ในโหมดเลือกหลายคำ (เริ่มจากคำในคิว ถ้ามี)
    function openGroupOnPdf(item) {
        if (!scope.PdfWordsDialog) return;

        if (state.pages.length === 0) {
            setStatus(
                'ocrGroupStatus',
                'อัปโหลด PDF ด้านบนก่อน แล้วจึงสร้างกลุ่มจากภาพได้',
                'warn'
            );
            return;
        }

        scope.PdfWordsDialog.open({
            pages: state.pages,
            title: state.fileName,
            pageIndex: item ? item.pageIndex : 0,
            mode: 'group',
            focusWord: item
                ? { text: item.text, x: item.x, y: item.y }
                : null,
            onChange: function () {
                reloadFixes().then(function () {
                    rebuildQueue();
                });
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // คำที่ OCR เก็บเกิน
    // ──────────────────────────────────────────────────────────────

    function renderDrops() {
        const list = el('ocrDropList');

        if (!list) return;

        list.innerHTML = '';

        if (state.drops.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent =
                'ยังไม่มีคำที่ไม่ใช้ — เปิดภาพ PDF แล้วกดปุ่ม "ลบคำ" ที่สระ/ตัวอักษรที่ OCR เก็บเกิน';

            list.appendChild(empty);
            return;
        }

        state.drops.slice(0, MAX_LIBRARY).forEach(function (entry) {
            const item = document.createElement('li');
            item.className = 'saved-item';

            const info = document.createElement('div');
            info.className = 'info';

            const word = document.createElement('strong');
            word.className = 'ocr-fix-pair';
            word.textContent = entry.word;

            const meta = document.createElement('span');
            meta.className = 'meta';
            meta.textContent = 'ตัดออกจากข้อความเมื่ออ่านไฟล์';

            info.appendChild(word);
            info.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'actions';

            const restore = document.createElement('button');
            restore.type = 'button';
            restore.className = 'plain';
            restore.textContent = 'ใช้คำนี้';
            restore.title = 'เลิกตัดคำนี้ออกจากข้อความ';
            restore.dataset.ocrDropDelete = entry.word;

            actions.appendChild(restore);

            item.appendChild(info);
            item.appendChild(actions);
            list.appendChild(item);
        });
    }

    async function restoreDropWord(word) {
        try {
            await scope.DataExtract.deleteDropWordAsync(word);
            await reloadFixes();
            rebuildQueue();
            setStatus('ocrDropStatus', 'ใช้คำนี้อีกครั้ง: ' + word, 'ok');
        } catch (error) {
            setStatus(
                'ocrDropStatus',
                (error && error.message) || 'บันทึกไม่สำเร็จ',
                'error'
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // คิวคำที่ confidence ต่ำ
    // ──────────────────────────────────────────────────────────────

    function rebuildQueue() {
        const fixed = new Set(state.fixes.map(function (fix) {
            return fix.from;
        }));

        // คำที่ผู้ใช้บอกว่าไม่ใช้แล้ว — ไม่ต้องถามซ้ำในคิว
        const dropped = new Set(state.drops.map(function (entry) {
            return entry.word;
        }));

        const found = {};

        state.pages.forEach(function (page, pageIndex) {
            (page.words || []).forEach(function (word) {
                const text = String((word && word.text) || '').trim();

                if (text === '' || fixed.has(text) || dropped.has(text) ||
                    state.ignored[text]) return;

                const confidence = Number(word.confidence);
                const value = Number.isFinite(confidence) ? confidence : 0;

                if (value >= LOW_CONFIDENCE) return;

                const existing = found[text];

                if (existing) {
                    existing.occurrences += 1;

                    // เก็บตำแหน่งที่มั่นใจต่ำที่สุดไว้ — กด "ดูบนหน้า"
                    // จะได้ไปตรงจุดที่ควรตรวจก่อน
                    if (value < existing.confidence) {
                        existing.confidence = value;
                        existing.pageIndex = pageIndex;
                        existing.page = page.page || pageIndex + 1;
                        existing.x = Number(word.x) || 0;
                        existing.y = Number(word.y) || 0;
                    }

                    return;
                }

                found[text] = {
                    text: text,
                    confidence: value,
                    pageIndex: pageIndex,
                    page: page.page || pageIndex + 1,
                    occurrences: 1,
                    // พิกัดบนภาพตัวอย่าง — ใช้ไฮไลต์คำในหน้าตรวจคำ
                    x: Number(word.x) || 0,
                    y: Number(word.y) || 0
                };
            });
        });

        state.queue = Object.keys(found)
            .map(function (key) {
                return found[key];
            })
            .sort(function (a, b) {
                return a.confidence - b.confidence ||
                    b.occurrences - a.occurrences;
            })
            .slice(0, MAX_QUEUE);

        renderQueue();
    }

    function createQueueItem(item) {
        const row = document.createElement('li');
        row.className = 'ocr-queue-item';
        row.dataset.ocrWord = item.text;

        const line = document.createElement('div');
        line.className = 'ocr-queue-row';

        const info = document.createElement('div');
        info.className = 'ocr-queue-info';

        const word = document.createElement('code');
        word.className = 'ocr-queue-word';
        word.textContent = item.text;

        const confidence = document.createElement('span');
        confidence.className =
            'ocr-confidence ' + (item.confidence < 40 ? 'low' : 'mid');
        confidence.textContent = Math.round(item.confidence) + '%';

        const meta = document.createElement('span');
        meta.className = 'ocr-queue-meta';
        meta.textContent =
            'หน้า ' + item.page + ' · พบ ' + item.occurrences + ' ครั้ง';

        info.appendChild(word);
        info.appendChild(confidence);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'ocr-queue-actions';

        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = 'แก้คำนี้';
        edit.dataset.ocrEdit = '1';

        const ignore = document.createElement('button');
        ignore.type = 'button';
        ignore.className = 'plain';
        ignore.textContent = 'ถูกแล้ว';
        ignore.title = 'คำนี้อ่านถูกแล้ว — ซ่อนจากคิวรอบนี้';
        ignore.dataset.ocrIgnore = '1';

        const locate = document.createElement('button');
        locate.type = 'button';
        locate.className = 'plain';
        locate.textContent = 'ดูบนหน้า';
        locate.dataset.ocrLocate = '1';

        const group = document.createElement('button');
        group.type = 'button';
        group.className = 'plain';
        group.textContent = 'รวมกลุ่ม';
        group.title = 'คำนี้อาจถูกตัดข้ามบรรทัด — เลือกคำที่เหลือบนภาพเพื่อรวมเป็นคำเดียว';
        group.dataset.ocrGroup = '1';

        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'plain';
        drop.textContent = 'ลบคำ';
        drop.title = 'คำนี้ OCR เก็บเกิน (เช่น สระ/วรรณยุกต์หลงมา) — ตัดออกจากข้อความเมื่ออ่านไฟล์';
        drop.dataset.ocrDrop = '1';

        actions.appendChild(edit);
        actions.appendChild(ignore);
        actions.appendChild(locate);
        actions.appendChild(group);
        actions.appendChild(drop);

        line.appendChild(info);
        line.appendChild(actions);

        const form = document.createElement('form');
        form.className = 'ocr-edit-row';
        form.hidden = true;

        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 120;
        input.autocomplete = 'off';
        input.placeholder = 'พิมพ์คำที่ถูกต้องสำหรับ "' + item.text + '"';

        const save = document.createElement('button');
        save.type = 'submit';
        save.textContent = 'บันทึก';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'plain';
        cancel.textContent = 'ยกเลิก';
        cancel.dataset.ocrCancel = '1';

        const suggestions = document.createElement('div');
        suggestions.className = 'ocr-suggestions';
        suggestions.dataset.ocrSuggestions = '1';

        form.appendChild(input);
        form.appendChild(save);
        form.appendChild(cancel);
        form.appendChild(suggestions);

        row.appendChild(line);
        row.appendChild(form);

        return row;
    }

    function renderQueue() {
        const wrap = el('ocrQueueWrap');
        const list = el('ocrQueue');
        const count = el('ocrQueueCount');

        if (!wrap || !list) return;

        wrap.hidden = state.pages.length === 0;
        list.innerHTML = '';

        if (count) {
            count.textContent = state.queue.length > 0
                ? state.queue.length + ' คำ'
                : '';
        }

        if (state.pages.length === 0) return;

        if (state.queue.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = 'ไม่พบคำที่มั่นใจต่ำ — คลังคำนี้ครอบคลุมคำในไฟล์นี้แล้ว';
            list.appendChild(empty);
            return;
        }

        state.queue.forEach(function (item) {
            list.appendChild(createQueueItem(item));
        });
    }

    function findQueueItem(word) {
        return state.queue.find(function (item) {
            return item.text === word;
        }) || null;
    }

    function openEditor(row, item) {
        const form = row.querySelector('form');

        if (!form) return;

        form.hidden = false;

        const input = form.querySelector('input');

        input.value = '';
        input.focus();

        renderSuggestions(form, item);
    }

    function renderSuggestions(form, item) {
        const host = form.querySelector('[data-ocr-suggestions]');

        if (!host) return;

        host.innerHTML = '';

        const rejected = state.rejected[item.text] || {};

        const suggestions = scope.DataExtract.findFuzzyFixes(item.text)
            .filter(function (suggestion) {
                return !rejected[suggestion.from];
            });

        if (suggestions.length === 0) {
            const hint = document.createElement('span');
            hint.className = 'hint';
            hint.textContent =
                'ยังไม่มีคำใกล้เคียงในคลัง — พิมพ์คำที่ถูกต้องแล้วบันทึกเพื่อสร้างรายการใหม่';

            host.appendChild(hint);
            return;
        }

        const label = document.createElement('span');
        label.className = 'ocr-suggestions-label';
        label.textContent = 'คำใกล้เคียง:';

        host.appendChild(label);

        suggestions.forEach(function (suggestion) {
            const group = document.createElement('span');
            group.className = 'ocr-suggestion';

            const use = document.createElement('button');
            use.type = 'button';
            use.textContent = suggestion.to;
            use.title =
                'ใช้คำนี้ (ใกล้กับ "' + suggestion.from + '" ' +
                suggestion.distance + ' ตัวอักษร)';
            use.dataset.ocrApply = '1';
            use.dataset.ocrSource = suggestion.from;
            use.dataset.ocrRight = suggestion.to;

            const reject = document.createElement('button');
            reject.type = 'button';
            reject.className = 'plain ocr-reject';
            reject.textContent = '×';
            reject.title = 'ไม่ใช่คำนี้';
            reject.dataset.ocrReject = '1';
            reject.dataset.ocrSource = suggestion.from;

            group.appendChild(use);
            group.appendChild(reject);
            host.appendChild(group);
        });
    }

    async function saveQueueWord(item, right, options) {
        const value = String(right == null ? '' : right).trim();

        if (value === '') {
            setStatus('ocrTrainStatus', 'พิมพ์คำที่ถูกต้องก่อนบันทึก', 'warn');
            return;
        }

        if (value === item.text) {
            setStatus('ocrTrainStatus', 'คำที่ถูกต้องต้องต่างจากคำที่อ่านได้', 'warn');
            return;
        }

        try {
            const saved = await scope.DataExtract.saveTextFixAsync(
                item.text,
                value,
                { confidence: item.confidence }
            );

            if (!saved) {
                setStatus(
                    'ocrTrainStatus',
                    'คำนี้ถูกแก้เป็น "' + value + '" อยู่แล้ว',
                    'warn'
                );
                return;
            }

            if (options && options.source) {
                scope.DataExtract.trackTextFixFeedback(options.source, true);
            }

            await reloadFixes();
            rebuildQueue();

            setStatus(
                'ocrTrainStatus',
                'บันทึกแล้ว: ' + item.text + ' → ' + value,
                'ok'
            );

        } catch (error) {
            setStatus(
                'ocrTrainStatus',
                (error && error.message) || 'บันทึกไม่สำเร็จ',
                'error'
            );
        }
    }

    // ตัดคำที่ OCR เก็บเกินออกจากข้อความ (เช่น สระหลงมา) — คืนคำได้จากรายการด้านล่าง
    async function dropQueueWord(item) {
        try {
            await scope.DataExtract.saveDropWordAsync(item.text);
            await reloadFixes();
            rebuildQueue();
            setStatus(
                'ocrTrainStatus',
                'ตัดคำนี้แล้ว: ' + item.text +
                    ' (จะไม่ถูกใช้เมื่ออ่านไฟล์ครั้งถัดไป — คืนได้ที่ "คำที่ OCR เก็บเกิน")',
                'ok'
            );
        } catch (error) {
            setStatus(
                'ocrTrainStatus',
                (error && error.message) || 'บันทึกไม่สำเร็จ',
                'error'
            );
        }
    }

    function openOnPdf(item) {
        if (!scope.PdfWordsDialog) return;

        scope.PdfWordsDialog.open({
            pages: state.pages,
            title: state.fileName,
            pageIndex: item.pageIndex,
            focusWord: {
                text: item.text,
                x: item.x,
                y: item.y
            },
            onChange: function () {
                reloadFixes().then(function () {
                    rebuildQueue();
                });
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // อ่านไฟล์เพื่อฝึก
    // ──────────────────────────────────────────────────────────────

    async function handleFile(file) {
        if (!file) return;

        if (!/\.pdf$/i.test(file.name)) {
            setStatus('ocrTrainStatus', 'รองรับเฉพาะไฟล์ .pdf', 'error');
            return;
        }

        setBusy(true);
        setStatus(
            'ocrTrainStatus',
            'กำลัง OCR ไฟล์ ' + file.name + '...'
        );

        try {
            const result = await scope.DataExtract.extractFile(file, {
                joinLines: true,
                // อ่านเพื่อฝึก ไม่ต้องนับว่าคำที่แก้ถูกแทนไปแล้วกี่ครั้ง
                trackFixes: false
            });

            const pages = Array.isArray(result.pages) ? result.pages : [];

            state.fileName = file.name;

            const fileLabel = el('ocrTrainFile');
            if (fileLabel) fileLabel.textContent = 'ไฟล์: ' + file.name;

            const groupHint = el('ocrGroupHint');
            if (groupHint) groupHint.textContent = 'ใช้ภาพจาก ' + file.name;

            if (pages.length === 0) {
                state.pages = [];
                state.queue = [];
                renderQueue();
                setStatus(
                    'ocrTrainStatus',
                    'ไฟล์นี้มีชั้นข้อความอยู่แล้ว (ไม่ได้ใช้ OCR) — ไม่มีคำให้ฝึก',
                    'warn'
                );
                return;
            }

            state.pages = pages;
            state.rejected = {};
            state.ignored = {};

            await reloadFixes();
            rebuildQueue();

            setStatus(
                'ocrTrainStatus',
                'อ่านแล้ว ' + pages.length + ' หน้า — พบคำที่มั่นใจต่ำ ' +
                    state.queue.length + ' คำ',
                'ok'
            );

        } catch (error) {
            setStatus(
                'ocrTrainStatus',
                (error && error.message) || 'อ่านไฟล์ไม่สำเร็จ',
                'error'
            );
        } finally {
            setBusy(false);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // คลังคำ — เพิ่ม/แก้/ลบ/นำเข้า/ส่งออก
    // ──────────────────────────────────────────────────────────────

    async function editFix(from) {
        const fix = scope.DataExtract.findTextFix(from);

        if (!fix) return;

        const value = await scope.AppDialog.prompt(
            'คำที่ถูกต้องสำหรับ "' + from + '"',
            fix.to
        );

        if (value == null) return;

        const target = String(value).trim();

        if (target === '') {
            setStatus('ocrFixStatus', 'คำที่ถูกต้องต้องไม่ว่าง', 'warn');
            return;
        }

        try {
            const saved = await scope.DataExtract.saveTextFixAsync(
                from,
                target
            );

            await reloadFixes();
            rebuildQueue();

            setStatus(
                'ocrFixStatus',
                saved
                    ? 'บันทึกแล้ว: ' + from + ' → ' + target
                    : 'คำนี้ถูกแก้เป็น "' + target + '" อยู่แล้ว',
                saved ? 'ok' : 'warn'
            );

        } catch (error) {
            setStatus(
                'ocrFixStatus',
                (error && error.message) || 'บันทึกไม่สำเร็จ',
                'error'
            );
        }
    }

    async function removeFix(from) {
        const fix = scope.DataExtract.findTextFix(from);

        if (!fix) return;

        const confirmed = await scope.AppDialog.confirm(
            'ลบ "' + fix.from + ' → ' + fix.to + '" ออกจากคลัง?\n' +
            'การอ่านไฟล์ครั้งถัดไปจะไม่แทนคำนี้อีก',
            { danger: true }
        );

        if (!confirmed) return;

        try {
            await scope.DataExtract.deleteTextFixAsync(from);
            await reloadFixes();
            rebuildQueue();
            setStatus('ocrFixStatus', 'ลบแล้ว: ' + from, 'ok');
        } catch (error) {
            setStatus(
                'ocrFixStatus',
                (error && error.message) || 'ลบไม่สำเร็จ',
                'error'
            );
        }
    }

    async function addFix() {
        const wrong = await scope.AppDialog.prompt(
            'คำที่ OCR อ่านผิด',
            ''
        );

        if (wrong == null) return;

        const source = String(wrong).trim();

        if (source === '') {
            setStatus('ocrFixStatus', 'กรุณาระบุคำที่อ่านผิด', 'warn');
            return;
        }

        const right = await scope.AppDialog.prompt(
            'คำที่ถูกต้องสำหรับ "' + source + '"',
            ''
        );

        if (right == null) return;

        const target = String(right).trim();

        if (target === '' || target === source) {
            setStatus(
                'ocrFixStatus',
                'คำที่ถูกต้องต้องไม่ว่างและต่างจากคำที่อ่านผิด',
                'warn'
            );
            return;
        }

        try {
            await scope.DataExtract.saveTextFixAsync(source, target);
            await reloadFixes();
            rebuildQueue();
            setStatus('ocrFixStatus', 'เพิ่มแล้ว: ' + source + ' → ' + target, 'ok');
        } catch (error) {
            setStatus(
                'ocrFixStatus',
                (error && error.message) || 'บันทึกไม่สำเร็จ',
                'error'
            );
        }
    }

    function exportFixes() {
        const data = {
            version: 1,
            exportedAt: new Date().toISOString(),
            fixes: state.fixes.map(function (fix) {
                return {
                    wrong: fix.from,
                    right: fix.to,
                    hits: fix.hits,
                    accepted: fix.accepted,
                    rejected: fix.rejected
                };
            })
        };

        const blob = new Blob(
            [JSON.stringify(data, null, 2)],
            { type: 'application/json' }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = 'ocr-fixes.json';

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);

        setStatus(
            'ocrFixStatus',
            'ส่งออก ' + state.fixes.length + ' คำแล้ว',
            'ok'
        );
    }

    async function importFixes(file) {
        if (!file) return;

        try {
            const parsed = JSON.parse(await file.text());
            const list = Array.isArray(parsed)
                ? parsed
                : (parsed && Array.isArray(parsed.fixes) ? parsed.fixes : []);

            let imported = 0;

            for (let index = 0; index < list.length; index++) {
                const entry = list[index] || {};
                const wrong = String(entry.wrong || entry.from || '').trim();
                const right = String(entry.right || entry.to || '').trim();

                if (wrong === '' || right === '' || wrong === right) continue;

                try {
                    const saved = await scope.DataExtract.saveTextFixAsync(
                        wrong,
                        right
                    );

                    if (saved) imported += 1;
                } catch (error) {
                    console.error('นำเข้าคำที่แก้ไม่สำเร็จ:', error);
                }
            }

            await reloadFixes();
            rebuildQueue();

            setStatus(
                'ocrFixStatus',
                'นำเข้า ' + imported + ' คำ (ข้ามรายการที่ไม่ถูกต้อง)',
                imported > 0 ? 'ok' : 'warn'
            );

        } catch (error) {
            setStatus(
                'ocrFixStatus',
                'ไฟล์ JSON ไม่ถูกต้อง',
                'error'
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ผูก event
    // ──────────────────────────────────────────────────────────────

    function bind() {
        const root = el('ocrTrainRoot');

        if (!root || root.dataset.bound === '1') return;

        root.dataset.bound = '1';

        const uploadButton = el('ocrTrainUploadBtn');
        const uploadInput = el('ocrTrainInput');

        uploadButton.addEventListener('click', function () {
            uploadInput.click();
        });

        uploadInput.addEventListener('change', function () {
            const file = uploadInput.files && uploadInput.files[0];

            uploadInput.value = '';

            handleFile(file);
        });

        el('ocrFixSearch').addEventListener('input', function (event) {
            state.search = String(event.target.value || '');
            renderFixes();
        });

        el('ocrFixAddBtn').addEventListener('click', addFix);
        el('ocrFixExportBtn').addEventListener('click', exportFixes);

        el('ocrFixImportBtn').addEventListener('click', function () {
            el('ocrFixImportInput').click();
        });

        el('ocrFixImportInput').addEventListener('change', function (event) {
            const file = event.target.files && event.target.files[0];

            event.target.value = '';

            importFixes(file);
        });

        // ── คิว ──

        const queue = el('ocrQueue');

        queue.addEventListener('click', function (event) {
            const row = event.target.closest('.ocr-queue-item');

            if (!row) return;

            const item = findQueueItem(row.dataset.ocrWord);

            if (!item) return;

            if (event.target.closest('[data-ocr-edit]')) {
                openEditor(row, item);
                return;
            }

            if (event.target.closest('[data-ocr-ignore]')) {
                state.ignored[item.text] = true;
                rebuildQueue();
                return;
            }

            if (event.target.closest('[data-ocr-locate]')) {
                openOnPdf(item);
                return;
            }

            if (event.target.closest('[data-ocr-group]')) {
                openGroupOnPdf(item);
                return;
            }

            if (event.target.closest('[data-ocr-drop]')) {
                dropQueueWord(item);
                return;
            }

            if (event.target.closest('[data-ocr-cancel]')) {
                const form = row.querySelector('form');

                if (form) form.hidden = true;

                return;
            }

            const apply = event.target.closest('[data-ocr-apply]');

            if (apply) {
                saveQueueWord(item, apply.dataset.ocrRight, {
                    source: apply.dataset.ocrSource
                });
                return;
            }

            const reject = event.target.closest('[data-ocr-reject]');

            if (reject) {
                const source = reject.dataset.ocrSource;

                scope.DataExtract.trackTextFixFeedback(source, false);

                if (!state.rejected[item.text]) state.rejected[item.text] = {};
                state.rejected[item.text][source] = true;

                renderStats();
                renderSuggestions(row.querySelector('form'), item);
            }
        });

        queue.addEventListener('submit', function (event) {
            event.preventDefault();

            const row = event.target.closest('.ocr-queue-item');

            if (!row) return;

            const item = findQueueItem(row.dataset.ocrWord);
            const input = row.querySelector('input');

            if (!item || !input) return;

            saveQueueWord(item, input.value);
        });

        // ── กลุ่มคำ ──

        el('ocrGroupAddBtn').addEventListener('click', function () {
            openGroupOnPdf(null);
        });

        el('ocrGroupList').addEventListener('click', function (event) {
            const edit = event.target.closest('[data-ocr-group-edit]');

            if (edit) {
                const tokens = tokensFromDataset(edit.dataset.ocrGroupEdit);
                const group = state.groups.find(function (item) {
                    return item.tokens.join('\u001f') === tokens.join('\u001f');
                });

                if (group) editGroup(tokens, group.merged);
                return;
            }

            const remove = event.target.closest('[data-ocr-group-delete]');

            if (remove) {
                removeGroup(tokensFromDataset(remove.dataset.ocrGroupDelete));
            }
        });

        // ── คำที่ OCR เก็บเกิน ──

        el('ocrDropList').addEventListener('click', function (event) {
            const restore = event.target.closest('[data-ocr-drop-delete]');

            if (restore) restoreDropWord(restore.dataset.ocrDropDelete);
        });

        // ── คลังคำ ──

        const list = el('ocrFixList');

        list.addEventListener('click', function (event) {
            const edit = event.target.closest('[data-ocr-fix-edit]');

            if (edit) {
                editFix(edit.dataset.ocrFixEdit);
                return;
            }

            const remove = event.target.closest('[data-ocr-fix-delete]');

            if (remove) {
                removeFix(remove.dataset.ocrFixDelete);
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Page
    // ──────────────────────────────────────────────────────────────

    const page = {

        // หน้านี้จัดการ UI เอง ไม่ขึ้นกับไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        // เรียกจาก app.js หลังวาดหน้าเสร็จ
        onShow: function () {
            bind();

            const search = el('ocrFixSearch');
            if (search) search.value = state.search;

            const fileLabel = el('ocrTrainFile');
            if (fileLabel) {
                fileLabel.textContent = state.fileName
                    ? 'ไฟล์: ' + state.fileName
                    : '';
            }

            const groupHint = el('ocrGroupHint');
            if (groupHint) {
                groupHint.textContent = state.fileName
                    ? 'ใช้ภาพจาก ' + state.fileName
                    : '';
            }

            reloadFixes().then(function () {
                rebuildQueue();
            });
        }
    };

    scope.OcrTrainingPage = page;
})(window);
