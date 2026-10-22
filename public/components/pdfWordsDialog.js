// PDF Words Dialog - ตรวจคำที่ OCR อ่านผิดจาก "ตำแหน่งจริง" บนหน้าเอกสาร
//
// ทำไมต้องมี:
//   ข้อความที่อ่านได้อยู่ในช่อง textarea ทำให้ไม่รู้ว่าคำที่เห็นตรงกับคำไหนบนกระดาษ
//   (เอกสารจริงมีหลายที่ที่หน้าตาคำคล้ายกัน) หน้าจอนี้จึงแสดงภาพหน้า PDF
//   แล้ววางกล่องโปร่งใสทับ "ทุกคำ" ตามพิกัดที่ tesseract บอกไว้
//   คลิกคำไหน = บอกได้ทันทีว่าคำนั้นอยู่ตรงไหน และแก้ได้ตรงนั้นเลย
//
// ข้อมูลที่ใช้:
//   pages = [{ page, image, width, height, words: [{ text, x, y, width, height }] }]
//   มาจาก pdf-text.cjs (พิกัดเป็น px บนภาพตัวอย่าง ไม่ใช่พิกัด PDF)
//
// การแก้คำ:
//   - บันทึกเป็นรายการ "อ่านผิด -> ถูกต้อง" ผ่าน DataExtract.saveTextFixAsync
//     (เก็บในตาราง ocr_fixes ของฐานข้อมูล — รายการเดียวกันกับที่ใช้แทนคำ
//      ตอนอ่านไฟล์ครั้งถัดไป และที่เห็นในหน้า "ฝึก OCR")
//   - คำที่แก้แล้วขึ้นสีเขียวทุกที่ที่ปรากฏบนหน้า (เพราะแทนทั้งข้อความ)
//   - onChange ถูกเรียกหลังบันทึก/ลบ เพื่อให้กล่อง "ข้อมูล" แทนคำในข้อความทันที
//
// ตั้งใจไม่แสดงรายการคำที่แก้ทั้งหมดในหน้านี้ (คำเยอะจนบังหน้า)
//   ดู/ลบทีละคำได้จากคำที่ไฮไลต์บนหน้า — คลิกคำนั้นแล้วกด "ลบคำที่แก้นี้"
(function (scope) {
    'use strict';

    const HTML = [
        '<div class="preview-backdrop" data-words-close></div>',
        '<div class="preview-dialog words-dialog" role="dialog" aria-modal="true" aria-labelledby="wordsTitle">',
        '    <div class="preview-head">',
        '        <h2 id="wordsTitle">ตรวจคำบน PDF</h2>',
        '        <div class="dialog-head-tools">',
        '            <button type="button" class="preview-close" data-words-close aria-label="ปิด">&times;</button>',
        '        </div>',
        '    </div>',
        '    <p id="wordsMeta" class="preview-meta"></p>',
        '    <div class="words-toolbar">',
        '        <button id="wordsPrevBtn" type="button" class="plain" title="หน้าก่อน">‹ ก่อนหน้า</button>',
        '        <span id="wordsPageLabel" class="words-page-label"></span>',
        '        <button id="wordsNextBtn" type="button" class="plain" title="หน้าถัดไป">ถัดไป ›</button>',
        '        <span class="words-toolbar-gap"></span>',
        '        <button id="wordsZoomOutBtn" type="button" class="plain" title="ย่อ" aria-label="ย่อ">&minus;</button>',
        '        <button id="wordsZoomInBtn" type="button" class="plain" title="ขยาย" aria-label="ขยาย">+</button>',
        '    </div>',
        '    <div id="wordsStageWrap" class="words-stage-wrap">',
        '        <div id="wordsStage" class="words-stage">',
        '            <img id="wordsImage" class="words-image" alt="หน้าจาก PDF">',
        '            <div id="wordsLayer" class="words-layer"></div>',
        '        </div>',
        '    </div>',
        '    <form id="wordsEditor" class="words-editor" hidden>',
        '        <div class="words-editor-row">',
        '            <span class="words-editor-label">อ่านได้</span>',
        '            <code id="wordsFrom" class="words-from"></code>',
        '            <span class="words-editor-arrow" aria-hidden="true">&rarr;</span>',
        '            <input id="wordsTo" type="text" maxlength="120" autocomplete="off"',
        '                   placeholder="พิมพ์คำที่ถูกต้อง">',
        '            <button id="wordsSaveBtn" type="submit">บันทึกคำที่แก้</button>',
        '            <button id="wordsRemoveBtn" type="button" class="plain" hidden>ลบคำที่แก้นี้</button>',
        '        </div>',
        '        <p id="wordsEditorHint" class="hint words-editor-hint"></p>',
        '    </form>',
        '    <p class="preview-foot">คลิกคำบนหน้ากระดาษเพื่อแก้ — คำที่แก้แล้วจะขึ้นสีเขียว ' +
            'และถูกแทนให้อัตโนมัติเมื่ออ่านไฟล์ครั้งถัดไป (เก็บไว้ในเครื่องนี้)</p>',
        '</div>'
    ].join('\n');

    const ZOOMS = [1, 1.5, 2.2];

    let overlay = null;

    const state = {
        pages: [],
        index: 0,
        zoom: 0,          // ดัชนีใน ZOOMS
        selected: null,   // คำที่กำลังแก้
        onChange: null
    };

    function el(id) {
        return document.getElementById(id);
    }

    // ──────────────────────────────────────────────────────────────
    // สร้าง / เปิด / ปิด
    // ──────────────────────────────────────────────────────────────

    function build() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'preview-overlay words-overlay';
        overlay.id = 'pdfWordsDialog';
        overlay.innerHTML = HTML;

        document.body.appendChild(overlay);

        overlay.querySelectorAll('[data-words-close]').forEach(function (node) {
            node.addEventListener('click', close);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            if (!overlay || !overlay.classList.contains('open')) return;

            close();
        });

        el('wordsPrevBtn').addEventListener('click', function () {
            showPage(state.index - 1);
        });

        el('wordsNextBtn').addEventListener('click', function () {
            showPage(state.index + 1);
        });

        el('wordsZoomInBtn').addEventListener('click', function () {
            setZoom(state.zoom + 1);
        });

        el('wordsZoomOutBtn').addEventListener('click', function () {
            setZoom(state.zoom - 1);
        });

        el('wordsEditor').addEventListener('submit', function (event) {
            event.preventDefault();
            saveSelected();
        });

        el('wordsRemoveBtn').addEventListener('click', removeSelected);

        // คลิกที่กล่องคำ (สร้างทีละคำบนหน้า — ใช้ event delegation)
        el('wordsLayer').addEventListener('click', function (event) {
            const box = event.target.closest('[data-word-index]');

            if (!box) return;

            selectWord(Number(box.dataset.wordIndex));
        });
    }

    function close() {
        if (overlay) overlay.classList.remove('open');
    }

    // payload = { pages, title, onChange, pageIndex }
    //   pageIndex = หน้าที่ต้องการเปิดก่อน (ใช้จากหน้าฝึก OCR ที่เลือกหน้าจากคิว)
    function open(payload) {
        const data = payload || {};
        const pages = Array.isArray(data.pages) ? data.pages : [];

        if (pages.length === 0) return;

        build();

        const requested = Math.floor(Number(data.pageIndex));
        const startIndex =
            requested >= 0 && requested < pages.length ? requested : 0;

        state.pages = pages;
        state.index = startIndex;
        state.selected = null;
        state.onChange = typeof data.onChange === 'function' ? data.onChange : null;
        state.zoom = 0;

        // เปิดครั้งใหม่ให้กลับไปขนาดพอดีหน้าต่าง (ไม่ค้างซูมจากครั้งก่อน)
        setZoom(0, true);

        el('wordsTitle').textContent = data.title
            ? 'ตรวจคำบน PDF — ' + data.title
            : 'ตรวจคำบน PDF';

        overlay.classList.add('open');
        showPage(startIndex);
    }

    // ──────────────────────────────────────────────────────────────
    // แสดงหน้า + คำ
    // ──────────────────────────────────────────────────────────────

    function showPage(index) {
        if (index < 0 || index >= state.pages.length) return;

        state.index = index;
        state.selected = null;

        const page = state.pages[index];
        const width = Number(page.width) || 1;
        const height = Number(page.height) || 1;

        const image = el('wordsImage');
        image.src = page.image || '';
        image.alt = 'หน้า ' + (page.page || index + 1);

        const stage = el('wordsStage');
        stage.style.aspectRatio = width + ' / ' + height;

        renderWords(page, width, height);

        el('wordsPageLabel').textContent =
            'หน้า ' + (page.page || index + 1) + ' / ' +
            (state.pages[state.pages.length - 1].page || state.pages.length);

        el('wordsPrevBtn').disabled = index === 0;
        el('wordsNextBtn').disabled = index === state.pages.length - 1;

        el('wordsStageWrap').scrollTop = 0;
        el('wordsStageWrap').scrollLeft = 0;

        hideEditor();
        updateMeta();
    }

    function renderWords(page, width, height) {
        const layer = el('wordsLayer');
        const fragment = document.createDocumentFragment();

        layer.innerHTML = '';

        (page.words || []).forEach(function (word, index) {
            if (!word || !String(word.text || '').trim()) return;

            const box = document.createElement('button');

            box.type = 'button';
            box.className = 'words-word';
            box.dataset.wordIndex = String(index);
            box.title = word.text;

            box.style.left = (word.x / width * 100) + '%';
            box.style.top = (word.y / height * 100) + '%';
            box.style.width = (word.width / width * 100) + '%';
            box.style.height = (word.height / height * 100) + '%';

            fragment.appendChild(box);
        });

        layer.appendChild(fragment);
        markFixes();
    }

    // ใส่สถานะ "แก้แล้ว" ให้ทุกคำที่ตรงกับรายการ (แทนทั้งข้อความ ไม่ใช่เฉพาะคำที่คลิก)
    function markFixes() {
        const layer = el('wordsLayer');
        const page = state.pages[state.index];

        if (!layer || !page) return;

        const fixes = scope.DataExtract.loadTextFixes();
        const map = {};

        fixes.forEach(function (fix) {
            map[fix.from] = fix.to;
        });

        layer.querySelectorAll('[data-word-index]').forEach(function (box) {
            const word = page.words[Number(box.dataset.wordIndex)];

            if (!word) return;

            const fixed = map[word.text];

            box.classList.toggle('fixed', Boolean(fixed));
            box.title = fixed
                ? word.text + ' → ' + fixed
                : (word.text + ' — คลิกเพื่อแก้');

            if (fixed) {
                box.dataset.fixedTo = fixed;
            } else {
                delete box.dataset.fixedTo;
            }
        });

        updateMeta();
    }

    function updateMeta() {
        const page = state.pages[state.index];

        if (!page) return;

        el('wordsMeta').textContent = [
            'หน้า ' + (page.page || state.index + 1) + ' มี ' +
                (page.words || []).length + ' คำ',
            'คำที่แก้แล้วขึ้นสีเขียว'
        ].join(' · ');
    }

    function setZoom(next, force) {
        const clamped = Math.max(0, Math.min(ZOOMS.length - 1, next));

        if (clamped === state.zoom && !force) return;

        state.zoom = clamped;

        const stage = el('wordsStage');

        stage.style.width = Math.round(ZOOMS[clamped] * 100) + '%';

        el('wordsZoomInBtn').disabled = clamped === ZOOMS.length - 1;
        el('wordsZoomOutBtn').disabled = clamped === 0;
    }

    // ──────────────────────────────────────────────────────────────
    // แก้คำที่เลือก
    // ──────────────────────────────────────────────────────────────

    function selectWord(index) {
        const page = state.pages[state.index];
        const word = page && page.words[index];

        if (!word) return;

        state.selected = word;

        const layer = el('wordsLayer');

        layer.querySelectorAll('[data-word-index]').forEach(function (box) {
            box.classList.toggle(
                'selected',
                Number(box.dataset.wordIndex) === index
            );
        });

        const fix = scope.DataExtract.findTextFix(word.text);

        el('wordsEditor').hidden = false;
        el('wordsFrom').textContent = word.text;
        el('wordsTo').value = fix ? fix.to : '';
        el('wordsRemoveBtn').hidden = !fix;

        setEditorHint(
            fix
                ? 'คำนี้ถูกแก้ไว้แล้ว — แก้ข้อความหรือกด "ลบคำที่แก้นี้" เพื่อยกเลิก'
                : 'พิมพ์คำที่ถูกต้อง แล้วกดบันทึก (ใช้กับคำนี้ทุกที่ในไฟล์)'
        );

        el('wordsTo').focus();
        el('wordsTo').select();
    }

    function hideEditor() {
        const editor = el('wordsEditor');

        if (!editor) return;

        editor.hidden = true;
        el('wordsTo').value = '';
        setEditorHint('');
    }

    function setEditorHint(text) {
        const hint = el('wordsEditorHint');

        hint.textContent = text || '';
        hint.classList.remove('error', 'ok');
    }

    // รอบันทึกก่อนแจ้ง onChange — หน้า "ฝึก OCR" จะได้อ่านรายการล่าสุดจากฐานข้อมูล
    async function saveSelected() {
        const word = state.selected;

        if (!word) return;

        const to = String(el('wordsTo').value || '').trim();

        if (to === '') {
            setEditorHint('พิมพ์คำที่ถูกต้องก่อนบันทึก');
            el('wordsTo').focus();
            return;
        }

        if (to === word.text) {
            setEditorHint('คำที่ถูกต้องต้องต่างจากคำที่อ่านได้');
            el('wordsTo').focus();
            return;
        }

        try {
            const saved = await scope.DataExtract.saveTextFixAsync(
                word.text,
                to
            );

            if (!saved) {
                setEditorHint('คำนี้ถูกแก้เป็น "' + to + '" อยู่แล้ว');
                return;
            }

        } catch (error) {
            setEditorHint(
                (error && error.message) ||
                'บันทึกไม่สำเร็จ'
            );
            return;
        }

        el('wordsRemoveBtn').hidden = false;
        setEditorHint('บันทึกแล้ว: ' + word.text + ' → ' + to);
        el('wordsEditorHint').classList.add('ok');

        markFixes();
        notifyChange();
    }

    async function removeSelected() {
        const word = state.selected;

        if (!word) return;

        try {
            const removed = await scope.DataExtract.deleteTextFixAsync(
                word.text
            );

            if (!removed) return;

        } catch (error) {
            setEditorHint(
                (error && error.message) ||
                'ลบไม่สำเร็จ'
            );
            return;
        }

        el('wordsTo').value = '';
        el('wordsRemoveBtn').hidden = true;
        setEditorHint(
            'ลบคำที่แก้นี้แล้ว — ข้อความที่อ่านไว้ยังเป็นคำที่แก้ ' +
            '(การลบมีผลกับการอ่านไฟล์ครั้งถัดไป)'
        );

        markFixes();
        notifyChange();
    }

    // ให้กล่อง "ข้อมูล" แทนคำในข้อความทันที (ไม่ต้องอ่านไฟล์ใหม่)
    function notifyChange() {
        if (typeof state.onChange === 'function') {
            state.onChange();
        }
    }

    scope.PdfWordsDialog = {
        open: open,
        close: close
    };
})(window);
