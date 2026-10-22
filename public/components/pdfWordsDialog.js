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
        '        <button id="wordsGroupModeBtn" type="button" class="plain"',
        '                title="เลือกหลายคำเพื่อรวมเป็นคำเดียว (เช่น คำที่ถูกตัดข้ามบรรทัด)">จัดกลุ่มคำ</button>',
        '        <button id="wordsDropModeBtn" type="button" class="plain"',
        '                title="คำที่ OCR เก็บเกิน (เช่น สระ/วรรณยุกต์หลงมา) — คลิกเพื่อตัดคำนั้นออกจากข้อความ">ลบคำ</button>',
        '        <button id="wordsOrderModeBtn" type="button" class="plain"',
        '                title="ฝึกตาราง/หลายคอลัมน์ที่อ่านคำปนกัน — คลิกคำตามลำดับการอ่านที่ถูกต้อง">ลำดับการอ่าน</button>',
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
        '    <form id="wordsGroupEditor" class="words-editor words-group-editor" hidden>',
        '        <div class="words-editor-row">',
        '            <span class="words-editor-label">กลุ่มคำที่เลือก</span>',
        '            <div id="wordsGroupChips" class="words-group-chips"></div>',
        '        </div>',
        '        <div class="words-editor-row">',
        '            <span class="words-editor-label">รวมเป็น</span>',
        '            <input id="wordsGroupMerged" type="text" maxlength="120" autocomplete="off"',
        '                   placeholder="คำที่รวมแล้ว เช่น เลขที่">',
        '            <button id="wordsGroupSaveBtn" type="submit">บันทึกกลุ่มคำ</button>',
        '            <button id="wordsGroupClearBtn" type="button" class="plain">ล้างที่เลือก</button>',
        '            <button id="wordsGroupRemoveBtn" type="button" class="plain" hidden>ลบกลุ่มนี้</button>',
        '        </div>',
        '        <p id="wordsGroupHint" class="hint words-editor-hint"></p>',
        '    </form>',
        '    <form id="wordsOrderEditor" class="words-editor words-order-editor" hidden>',
        '        <div class="words-editor-row">',
        '            <span class="words-editor-label">ลำดับที่คลิก</span>',
        '            <div id="wordsOrderChips" class="words-group-chips"></div>',
        '        </div>',
        '        <div class="words-editor-row">',
        '            <button id="wordsOrderSaveBtn" type="submit">บันทึกลำดับการอ่าน</button>',
        '            <button id="wordsOrderClearBtn" type="button" class="plain">ล้างที่เลือก</button>',
        '        </div>',
        '        <p id="wordsOrderHint" class="hint words-editor-hint"></p>',
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
        focus: null,      // คำที่ต้องไฮไลต์เมื่อเปิด (จากหน้าฝึก OCR)
        onChange: null,
        mode: 'fix',      // 'fix' | 'group' | 'drop' | 'order'
        picks: [],        // คำที่เลือกในโหมดจัดกลุ่ม (ดัชนีใน page.words)
        order: []         // คำที่คลิกตามลำดับการอ่าน (ดัชนีใน page.words)
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

        el('wordsGroupModeBtn').addEventListener('click', function () {
            setMode(state.mode === 'group' ? 'fix' : 'group');
        });

        el('wordsDropModeBtn').addEventListener('click', function () {
            setMode(state.mode === 'drop' ? 'fix' : 'drop');
        });

        el('wordsOrderModeBtn').addEventListener('click', function () {
            setMode(state.mode === 'order' ? 'fix' : 'order');
        });

        el('wordsOrderEditor').addEventListener('submit', function (event) {
            event.preventDefault();
            saveOrder();
        });

        el('wordsOrderClearBtn').addEventListener('click', clearOrder);

        el('wordsGroupEditor').addEventListener('submit', function (event) {
            event.preventDefault();
            saveGroup();
        });

        el('wordsGroupClearBtn').addEventListener('click', clearPicks);
        el('wordsGroupRemoveBtn').addEventListener('click', removeGroup);

        // คลิกที่กล่องคำ (สร้างทีละคำบนหน้า — ใช้ event delegation)
        el('wordsLayer').addEventListener('click', function (event) {
            const box = event.target.closest('[data-word-index]');

            if (!box) return;

            const index = Number(box.dataset.wordIndex);

            if (state.mode === 'group') {
                togglePick(index);
                return;
            }

            if (state.mode === 'drop') {
                toggleDrop(index);
                return;
            }

            if (state.mode === 'order') {
                toggleOrder(index);
                return;
            }

            selectWord(index);
        });
    }

    function close() {
        if (overlay) overlay.classList.remove('open');
    }

    // payload = { pages, title, onChange, pageIndex, focusWord, mode }
    //   pageIndex = หน้าที่ต้องการเปิดก่อน (ใช้จากหน้าฝึก OCR ที่เลือกหน้าจากคิว)
    //   focusWord = { text, x, y } คำที่ต้องไฮไลต์/เลื่อนไปหาเมื่อเปิด
    //   mode = 'group' เปิดในโหมดเลือกหลายคำ (คำใน focusWord ถูกเลือกไว้ก่อน)
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
        state.focus =
            data.focusWord && typeof data.focusWord === 'object'
                ? data.focusWord
                : null;
        state.onChange = typeof data.onChange === 'function' ? data.onChange : null;
        state.zoom = 0;

        // เปิดใหม่ทุกครั้งให้เริ่มที่โหมดที่ขอ (ค่าเริ่มต้น = โหมดแก้คำ)
        state.mode = ['group', 'drop', 'order'].indexOf(data.mode) !== -1
            ? data.mode
            : 'fix';
        state.picks = [];
        state.order = [];

        // เปิดครั้งใหม่ให้กลับไปขนาดพอดีหน้าต่าง (ไม่ค้างซูมจากครั้งก่อน)
        setZoom(0, true);

        el('wordsTitle').textContent = data.title
            ? 'ตรวจคำบน PDF — ' + data.title
            : 'ตรวจคำบน PDF';

        syncModeButton();
        hideGroupEditor();
        hideOrderEditor();

        overlay.classList.add('open');
        showPage(startIndex);
        focusInitialWord();

        // รายการคำที่ไม่ใช้อาจยังไม่ได้โหลด (เปิดจากหน้าอื่น) — โหลดแล้วมาร์กใหม่
        Promise.resolve()
            .then(function () {
                return scope.DataExtract.refreshDropWords();
            })
            .then(markFixes)
            .catch(function (error) {
                console.error(error);
            });
    }

    // ──────────────────────────────────────────────────────────────
    // แสดงหน้า + คำ
    // ──────────────────────────────────────────────────────────────

    function showPage(index) {
        if (index < 0 || index >= state.pages.length) return;

        state.index = index;
        state.selected = null;
        state.picks = [];
        state.order = [];

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
        hideGroupEditor();
        hideOrderEditor();
        updateMeta();
    }

    // หาคำที่หน้าฝึก OCR ส่งมา แล้วเลือก + เลื่อนไปหา + กะพริบให้เห็นตำแหน่ง
    function focusInitialWord() {
        const index = findInitialWordIndex();

        if (index === -1) return;

        // โหมดจัดกลุ่ม: คำที่ส่งมาเป็นคำแรกของกลุ่ม (ยังไม่เปิดแผงคำ)
        if (state.mode === 'group') {
            state.picks = [index];
            markPicks();
            renderGroupEditor();
            scrollToWord(index);
            flashWord(index);
            return;
        }

        // โหมดอื่น (ลบคำ/ลำดับการอ่าน) แค่เลื่อนไปหา โดยไม่เปิดแผงแก้คำ
        if (state.mode !== 'fix') {
            scrollToWord(index);
            flashWord(index);
            return;
        }

        selectWord(index);
        scrollToWord(index);
        flashWord(index);
    }

    // หาดัปนีของคำที่ต้องโฟกัส (-1 = ไม่พบ)
    function findInitialWordIndex() {
        const page = state.pages[state.index];
        const focus = state.focus;

        if (!page || !focus) return -1;

        const words = Array.isArray(page.words) ? page.words : [];
        const x = Number(focus.x);
        const y = Number(focus.y);

        let index = -1;

        // ใช้พิกัดก่อน (แม่นกว่าเมื่อคำเดียวกันปรากฏหลายที่)
        if (Number.isFinite(x) && Number.isFinite(y)) {
            let bestDistance = Infinity;

            words.forEach(function (word, wordIndex) {
                const distance =
                    Math.abs((Number(word.x) || 0) - x) +
                    Math.abs((Number(word.y) || 0) - y);

                if (distance < bestDistance) {
                    bestDistance = distance;
                    index = wordIndex;
                }
            });

            // พิกัดคลาดเคลื่อนเกินไป = ไม่ใช่คำเดียวกัน
            if (bestDistance > 12) index = -1;
        }

        // ไม่มีพิกัด/หาพิกัดไม่เจอ = ใช้ข้อความ
        if (index === -1 && focus.text) {
            index = words.findIndex(function (word) {
                return String((word && word.text) || '').trim() ===
                    String(focus.text).trim();
            });
        }

        return index;
    }

    // เลื่อนกล่องเลื่อนของหน้าให้คำอยู่กลางจอ
    function scrollToWord(index) {
        const layer = el('wordsLayer');
        const wrap = el('wordsStageWrap');

        if (!layer || !wrap) return;

        const box = layer.querySelector('[data-word-index="' + index + '"]');

        if (!box) return;

        const wrapRect = wrap.getBoundingClientRect();
        const boxRect = box.getBoundingClientRect();

        const left = wrap.scrollLeft +
            (boxRect.left - wrapRect.left) -
            (wrap.clientWidth - boxRect.width) / 2;

        const top = wrap.scrollTop +
            (boxRect.top - wrapRect.top) -
            (wrap.clientHeight - boxRect.height) / 2;

        if (typeof wrap.scrollTo === 'function') {
            wrap.scrollTo({
                left: Math.max(0, left),
                top: Math.max(0, top),
                behavior: 'smooth'
            });
            return;
        }

        wrap.scrollLeft = Math.max(0, left);
        wrap.scrollTop = Math.max(0, top);
    }

    // กะพริบกรอบคำสองครั้งแล้วเอาคลาสออก
    function flashWord(index) {
        const layer = el('wordsLayer');

        if (!layer) return;

        const box = layer.querySelector('[data-word-index="' + index + '"]');

        if (!box) return;

        box.classList.remove('focus-flash');

        // บังคับให้เบราว์เซอร์คำนวณใหม่ เพื่อให้ animation เล่นซ้ำได้
        box.getBoundingClientRect();
        box.classList.add('focus-flash');

        window.setTimeout(function () {
            box.classList.remove('focus-flash');
        }, 2200);
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

        const drops = {};

        scope.DataExtract.loadDropWords().forEach(function (entry) {
            drops[entry.word] = true;
        });

        layer.querySelectorAll('[data-word-index]').forEach(function (box) {
            const word = page.words[Number(box.dataset.wordIndex)];

            if (!word) return;

            const fixed = map[word.text];
            const dropped = drops[word.text];

            box.classList.toggle('fixed', Boolean(fixed));
            box.classList.toggle('dropped', Boolean(dropped));

            if (dropped) {
                box.title = word.text + ' — ไม่ใช้คำนี้ (คลิกเพื่อใช้กลับ)';
            } else if (fixed) {
                box.title = word.text + ' → ' + fixed;
            } else {
                box.title = word.text + ' — คลิกเพื่อแก้';
            }

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
    // โหมดจัดกลุ่มคำ
    // ──────────────────────────────────────────────────────────────

    function setMode(mode) {
        state.mode = ['group', 'drop', 'order'].indexOf(mode) !== -1
            ? mode
            : 'fix';

        syncModeButton();
        clearPicks();
        clearOrder();

        if (state.mode === 'order') renderOrderEditor();
    }

    function syncModeButton() {
        const buttons = [
            { node: el('wordsGroupModeBtn'), mode: 'group', label: 'จัดกลุ่มคำ' },
            { node: el('wordsDropModeBtn'), mode: 'drop', label: 'ลบคำ' },
            { node: el('wordsOrderModeBtn'), mode: 'order', label: 'ลำดับการอ่าน' }
        ];

        buttons.forEach(function (item) {
            const active = state.mode === item.mode;

            item.node.classList.toggle('active', active);
            item.node.textContent = active ? 'เสร็จสิ้น' : item.label;
        });

        if (state.mode !== 'fix') hideEditor();
    }

    // ──────────────────────────────────────────────
    // โหมดลำดับการอ่าน (ฝึกคอลัมน์/ตารางที่อ่านคำปนกัน)
    // ──────────────────────────────────────────────

    function toggleOrder(index) {
        const page = state.pages[state.index];
        const word = page && page.words[index];

        if (!word) return;

        const at = state.order.indexOf(index);

        if (at === -1) {
            state.order.push(index);
        } else {
            state.order.splice(at, 1);
        }

        markOrder();
        renderOrderEditor();
    }

    function markOrder() {
        const layer = el('wordsLayer');
        const page = state.pages[state.index];

        if (!layer) return;

        layer.querySelectorAll('[data-word-index]').forEach(function (box) {
            const index = Number(box.dataset.wordIndex);
            const at = state.order.indexOf(index);
            const word = page && page.words[index];

            box.classList.toggle('ordered', at !== -1);

            if (at !== -1) {
                box.dataset.order = String(at + 1);
                box.title = (at + 1) + '. ' +
                    String((word && word.text) || '').trim();
            } else {
                delete box.dataset.order;

                if (word) box.title = String(word.text) + ' — คลิกเพื่อแก้';
            }
        });
    }

    function orderedWords() {
        const page = state.pages[state.index];
        const words = page && Array.isArray(page.words) ? page.words : [];

        return state.order
            .map(function (index, position) {
                return {
                    word: words[index],
                    position: position
                };
            })
            .filter(function (entry) {
                return Boolean(entry.word);
            });
    }

    // แปลงคำที่คลิกตามลำดับ เป็น "ช่วงคอลัมน์" ตามแนว x
    //   - คำที่อยู่ชิดกันในแนว x = คอลัมน์เดียวกัน
    //   - ลำดับคอลัมน์ = ลำดับที่ผู้ใช้คลิกคำแรกของคอลัมน์นั้น
    function bandsFromOrder(entries, pageWidth) {
        if (entries.length < 2 || !(pageWidth > 0)) return [];

        const gapLimit = Math.max(8, pageWidth * 0.02);
        const sorted = entries.slice().sort(function (a, b) {
            return (Number(a.word.x) || 0) - (Number(b.word.x) || 0);
        });

        const clusters = [];

        sorted.forEach(function (entry) {
            const left = Number(entry.word.x) || 0;
            const right = left + (Number(entry.word.width) || 0);
            const last = clusters[clusters.length - 1];

            if (last && left - last.right <= gapLimit) {
                last.right = Math.max(last.right, right);
                last.first = Math.min(last.first, entry.position);
                return;
            }

            clusters.push({
                left: left,
                right: right,
                first: entry.position
            });
        });

        if (clusters.length < 2) return [];

        // ขอบเขตคอลัมน์ = กึ่งกลางช่องว่างระหว่างคอลัมน์ที่อยู่ติดกัน
        const byX = clusters.map(function (cluster, index) {
            const previous = clusters[index - 1];
            const next = clusters[index + 1];

            return {
                from: previous ? (previous.right + cluster.left) / 2 : 0,
                to: next ? (cluster.right + next.left) / 2 : pageWidth,
                first: cluster.first
            };
        });

        return byX
            .sort(function (a, b) {
                return a.first - b.first;
            })
            .map(function (band) {
                return {
                    from: Math.max(0, Math.min(1, band.from / pageWidth)),
                    to: Math.max(0, Math.min(1, band.to / pageWidth))
                };
            })
            .filter(function (band) {
                return band.to > band.from;
            });
    }

    function renderOrderEditor() {
        const editor = el('wordsOrderEditor');

        if (!editor) return;

        if (state.mode !== 'order' || state.order.length === 0) {
            hideOrderEditor();

            // ยังไม่คลิกคำ = แสดงคำแนะนำไว้ในแถบเครื่องมือ
            if (state.mode === 'order') {
                el('wordsMeta').textContent =
                    'โหมดลำดับการอ่าน: คลิกคำบนหน้ากระดาษตามลำดับที่ควรอ่าน ' +
                    '(บนลงล่าง ทีละคอลัมน์) — คอลัมน์จะถูกเรียนรู้จากตำแหน่งที่คลิก';
            }

            return;
        }

        editor.hidden = false;

        const chips = el('wordsOrderChips');
        chips.textContent = '';

        orderedWords().forEach(function (entry) {
            const chip = document.createElement('span');
            chip.className = 'words-group-chip';
            chip.textContent = (entry.position + 1) + '. ' +
                String((entry.word && entry.word.text) || '').trim();

            chips.appendChild(chip);
        });

        const page = state.pages[state.index];
        const bands = bandsFromOrder(
            orderedWords(),
            Number(page && page.width) || 0
        );

        setOrderHint(
            bands.length >= 2
                ? 'จะบันทึกเป็น ' + bands.length + ' คอลัมน์ — ใช้กับไฟล์ที่มีหน้าสัดส่วนใกล้เคียงกัน'
                : 'คลิกคำจากอย่างน้อย 2 คอลัมน์ (เช่น ทีละคอลัมน์จากซ้ายไปขวา)'
        );

        el('wordsOrderSaveBtn').disabled = bands.length < 2;
    }

    function setOrderHint(text) {
        const hint = el('wordsOrderHint');

        if (!hint) return;

        hint.textContent = text || '';
        hint.classList.remove('error', 'ok');
    }

    function hideOrderEditor() {
        const editor = el('wordsOrderEditor');

        if (!editor) return;

        editor.hidden = true;
        setOrderHint('');
    }

    function clearOrder() {
        state.order = [];
        markOrder();
        hideOrderEditor();
    }

    async function saveOrder() {
        const page = state.pages[state.index];
        const width = Number(page && page.width) || 0;
        const height = Number(page && page.height) || 0;
        const bands = bandsFromOrder(orderedWords(), width);

        if (bands.length < 2) {
            setOrderHint('คลิกคำจากอย่างน้อย 2 คอลัมน์ก่อนบันทึก');
            return;
        }

        try {
            const saved = await scope.DataExtract.savePageLayoutAsync(
                bands,
                width > 0 ? height / width : 0
            );

            if (!saved) {
                setOrderHint('บันทึกลำดับการอ่านไม่สำเร็จ');
                return;
            }

        } catch (error) {
            setOrderHint(
                (error && error.message) || 'บันทึกลำดับการอ่านไม่สำเร็จ'
            );
            return;
        }

        el('wordsOrderHint').textContent =
            'บันทึกแล้ว: ' + bands.length + ' คอลัมน์ — ' +
            'ใช้เมื่ออ่านไฟล์ครั้งถัดไป (หน้าแนวเดียวกันสัดส่วนใกล้กัน)';
        el('wordsOrderHint').classList.add('ok');

        notifyChange();
    }

    // ตัด/คืนคำที่ OCR เก็บเกิน (เช่น สระหลงมาหรือวรรณยุกต์แยกเป็นคำ)
    async function toggleDrop(index) {
        const page = state.pages[state.index];
        const word = page && page.words[index];
        const text = String((word && word.text) || '').trim();

        if (text === '') return;

        try {
            if (scope.DataExtract.findDropWord(text)) {
                await scope.DataExtract.deleteDropWordAsync(text);
            } else {
                await scope.DataExtract.saveDropWordAsync(text);
            }
        } catch (error) {
            console.error('บันทึกคำที่ไม่ใช้ไม่สำเร็จ:', error);
            return;
        }

        markFixes();
        notifyChange();
    }

    // เลือก/ยกเลิกคำในโหมดจัดกลุ่ม (เลือกข้ามบรรทัดได้)
    function togglePick(index) {
        const page = state.pages[state.index];
        const word = page && page.words[index];

        if (!word) return;

        const at = state.picks.indexOf(index);

        if (at === -1) {
            state.picks.push(index);
            sortPicks();
        } else {
            state.picks.splice(at, 1);
        }

        markPicks();
        renderGroupEditor();
    }

    // เรียงตามลำดับการอ่านบนกระดาษ (บน → ล่าง, ซ้าย → ขวา)
    // สำคัญ: กลุ่มที่บันทึกต้องเรียงคำเหมือนในข้อความจริง ไม่อย่างนั้นจะไม่ถูกนำไปใช้
    function sortPicks() {
        const page = state.pages[state.index];
        const words = page && Array.isArray(page.words) ? page.words : [];

        state.picks.sort(function (a, b) {
            const first = words[a];
            const second = words[b];

            if (!first || !second) return a - b;

            const tolerance = Math.max(
                2,
                Math.min(
                    Number(first.height) || 12,
                    Number(second.height) || 12
                ) / 2
            );

            const dy =
                (Number(first.y) || 0) - (Number(second.y) || 0);

            if (Math.abs(dy) > tolerance) return dy;

            return (Number(first.x) || 0) - (Number(second.x) || 0);
        });
    }

    function markPicks() {
        const layer = el('wordsLayer');

        if (!layer) return;

        layer.querySelectorAll('[data-word-index]').forEach(function (box) {
            box.classList.toggle(
                'picked',
                state.picks.indexOf(Number(box.dataset.wordIndex)) !== -1
            );
        });
    }

    function pickedWords() {
        const page = state.pages[state.index];
        const words = page && Array.isArray(page.words) ? page.words : [];

        return state.picks
            .map(function (index) {
                return words[index];
            })
            .filter(Boolean);
    }

    function pickedTokens() {
        return pickedWords()
            .map(function (word) {
                return String((word && word.text) || '').trim();
            })
            .filter(Boolean);
    }

    // คำที่เลือกอยู่บรรทัดเดียวกันหมดไหม (เตือน เพราะระบบรวมเฉพาะคำข้ามบรรทัด)
    function picksOnSameLine() {
        const words = pickedWords();

        if (words.length < 2) return false;

        const base = Number(words[0].y) || 0;
        const tolerance = Math.max(2, (Number(words[0].height) || 12) / 2);

        return words.every(function (word) {
            return Math.abs((Number(word.y) || 0) - base) <= tolerance;
        });
    }

    function findGroupByTokens(tokens) {
        const key = tokens.join('\u001f');

        return scope.DataExtract.loadWordGroups().find(function (group) {
            return group.tokens.join('\u001f') === key;
        }) || null;
    }

    function renderGroupEditor() {
        const editor = el('wordsGroupEditor');
        const tokens = pickedTokens();

        if (state.mode !== 'group' || tokens.length === 0) {
            hideGroupEditor();
            return;
        }

        editor.hidden = false;

        const chips = el('wordsGroupChips');
        chips.textContent = '';

        tokens.forEach(function (token, index) {
            const chip = document.createElement('span');
            chip.className = 'words-group-chip';
            chip.textContent = (index + 1) + '. ' + token;
            chips.appendChild(chip);
        });

        const saved = tokens.length >= 2 ? findGroupByTokens(tokens) : null;
        const mergedInput = el('wordsGroupMerged');

        mergedInput.value = saved ? saved.merged : tokens.join('');
        el('wordsGroupRemoveBtn').hidden = !saved;
        el('wordsGroupSaveBtn').disabled = tokens.length < 2;

        setGroupHint(groupHint(tokens, saved));
    }

    function groupHint(tokens, saved) {
        if (tokens.length < 2) {
            return 'เลือกอย่างน้อย 2 คำ — คลิกคำบนหน้ากระดาษเพื่อเพิ่ม/เอาออก';
        }

        if (picksOnSameLine()) {
            return 'คำที่เลือกอยู่บรรทัดเดียวกัน — ระบบจะรวมเฉพาะคำที่ถูกตัดข้ามบรรทัด';
        }

        if (saved) {
            return 'กลุ่มนี้บันทึกไว้แล้ว: ' + saved.merged +
                ' (แก้ข้อความหรือกด "ลบกลุ่มนี้" ได้)';
        }

        return 'ครั้งถัดไปที่อ่านไฟล์ ระบบจะรวมคำเหล่านี้อัตโนมัติเมื่อขึ้นบรรทัดใหม่';
    }

    function setGroupHint(text) {
        const hint = el('wordsGroupHint');

        hint.textContent = text || '';
        hint.classList.remove('error', 'ok');
    }

    function hideGroupEditor() {
        const editor = el('wordsGroupEditor');

        if (!editor) return;

        editor.hidden = true;

        const mergedInput = el('wordsGroupMerged');

        if (mergedInput) mergedInput.value = '';

        setGroupHint('');
    }

    function clearPicks() {
        state.picks = [];
        markPicks();
        hideGroupEditor();
    }

    async function saveGroup() {
        const tokens = pickedTokens();

        if (tokens.length < 2) {
            setGroupHint('เลือกอย่างน้อย 2 คำก่อนบันทึก');
            return;
        }

        const merged = String(el('wordsGroupMerged').value || '').trim();

        if (merged === '') {
            setGroupHint('พิมพ์คำที่รวมแล้วก่อนบันทึก');
            el('wordsGroupMerged').focus();
            return;
        }

        try {
            const saved = await scope.DataExtract.saveWordGroupAsync(
                tokens,
                merged
            );

            if (!saved) {
                setGroupHint('บันทึกกลุ่มคำไม่สำเร็จ ลองใหม่อีกครั้ง');
                return;
            }

        } catch (error) {
            setGroupHint(
                (error && error.message) || 'บันทึกกลุ่มคำไม่สำเร็จ'
            );
            return;
        }

        el('wordsGroupRemoveBtn').hidden = false;
        el('wordsGroupHint').textContent = 'บันทึกแล้ว: ' + tokens.join(' + ') +
            ' → ' + merged;
        el('wordsGroupHint').classList.add('ok');

        notifyChange();
    }

    async function removeGroup() {
        const tokens = pickedTokens();

        if (tokens.length < 2) return;

        try {
            await scope.DataExtract.deleteWordGroupAsync(tokens);
        } catch (error) {
            setGroupHint(
                (error && error.message) || 'ลบกลุ่มคำไม่สำเร็จ'
            );
            return;
        }

        el('wordsGroupRemoveBtn').hidden = true;
        setGroupHint('ลบกลุ่มนี้แล้ว — จะไม่รวมคำเหล่านี้อีก');

        notifyChange();
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

        // โหมดแก้คำเปิดพร้อมกันได้ทีละอย่าง — ปิดแผงจัดกลุ่มไว้
        state.picks = [];
        markPicks();
        hideGroupEditor();

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
