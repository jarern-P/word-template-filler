// Suggest Menu - popup เดาคำภาษาไทยขณะพิมพ์ (กด Tab หรือ Enter เพื่อใช้คำที่เลือก)
//
// ทำงานกับช่องกรอกข้อความของหน้ารายงาน ([data-field]), ช่อง input ในตาราง
// ([data-table-input]) และช่อง placeholder ของหน้า Template Configuration
// ([data-placeholder-field])
//
// คีย์บอร์ด
//   Tab          = ใช้คำที่เลือก (ถ้าเปิด popup อยู่) — popup จะกิน Tab ไว้
//   Enter        = ใช้คำที่เลือก (ช่องข้อความ ไม่ใช่ textarea)
//   ↑ / ↓        = เลื่อนรายการที่เลือก
//   Esc          = ปิด popup
//   Shift + Tab  = ไม่ใช้คำ ปล่อยให้ย้ายไปช่องถัดไปตามปกติ
//
// ถ้าไม่มีคำในพจนานุกรมที่ขึ้นต้นด้วยข้อความที่พิมพ์ จะเสนอ "เพิ่มคำนี้"
// เป็นรายการสุดท้าย (ให้ app.js บันทึกคำนั้นถาวร)
(function (scope) {
    'use strict';

    const MIN_WIDTH = 220;      // ความกว้างน้อยสุดของ popup
    const GAP = 6;              // ระยะห่างจากช่องกรอก
    const MARGIN = 12;          // ระยะกันขอบจอ

    let menu = null;            // popup (สร้างครั้งเดียวตอนใช้ครั้งแรก)
    let list = null;
    let activeInput = null;     // ช่องกรอกที่ popup เปิดอยู่
    let items = [];             // รายการที่แสดงอยู่
    let range = null;           // { start, end } ของข้อความที่จะถูกแทนที่
    let highlight = -1;         // รายการที่คีย์บอร์ดชี้อยู่
    let writing = false;        // กำลังเขียนค่าลงช่องอยู่ (กัน listener ของเราเอง)

    // ──────────────────────────────────────────────────────────────
    // ช่องกรอกที่ใช้ได้
    // ──────────────────────────────────────────────────────────────

    function isTextLike(input) {
        if (input.tagName === 'TEXTAREA') return true;
        if (input.tagName !== 'INPUT') return false;

        // ช่องจำนวนเงิน (พิมพ์ได้แต่ตัวเลข) และช่องวันที่มี dropdown ของตัวเอง
        const type = String(input.type || 'text').toLowerCase();

        return type === 'text' || type === 'search';
    }

    function isTarget(input) {
        if (!input || !input.dataset) return false;
        if (input.disabled || input.readOnly) return false;
        if (input.dataset.currencyInput === '1') return false;
        if (input.dataset.dateInput === '1') return false;

        // ช่อง input ในตารางของหน้ารายงานก็แนะนำคำได้เหมือนช่องอื่น
        const isTableCell = input.dataset.tableInput !== undefined;

        if (
            !isTableCell &&
            !input.dataset.field &&
            !input.dataset.placeholderField
        ) {
            return false;
        }

        return isTextLike(input);
    }

    function caretOf(input, value) {
        try {
            const start = input.selectionStart;

            if (typeof start === 'number') return start;
        } catch (error) {
            // บางชนิดของ input ไม่รองรับ selectionStart
        }

        return value.length;
    }

    // ──────────────────────────────────────────────────────────────
    // รายการที่จะแสดง
    // ──────────────────────────────────────────────────────────────

    function build() {
        if (menu) return;

        menu = document.createElement('div');
        menu.className = 'suggest-menu';
        menu.id = 'suggestMenu';
        menu.hidden = true;
        menu.innerHTML = '<ul class="suggest-list" role="listbox"></ul>';

        document.body.appendChild(menu);

        list = menu.querySelector('.suggest-list');

        // mousedown ก่อน click: กันไม่ให้ช่องกรอกที่อยู่ข้างหลังเสีย focus
        list.addEventListener('mousedown', function (event) {
            event.preventDefault();
        });

        list.addEventListener('click', function (event) {
            const button = event.target.closest('.suggest-item');

            if (!button) return;

            accept(Number(button.dataset.index));
        });

        window.addEventListener('resize', function () {
            if (!menu.hidden) position();
        });

        window.addEventListener('scroll', function () {
            // popup เกาะกับตำแหน่งของช่องกรอก ถ้าเลื่อนจอให้ปิดไปเลย
            if (!menu.hidden) close();
        }, true);
    }

    function renderList() {
        list.innerHTML = '';

        // ใช้ textContent เพราะคำมาจากพจนานุกรม/ผู้ใช้ (กัน XSS)
        items.forEach(function (item, index) {
            const row = document.createElement('li');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'suggest-item';
            button.dataset.index = String(index);

            if (index === highlight) {
                button.className += ' selected';
            }

            const word = document.createElement('span');
            word.className = 'suggest-word';
            word.textContent = item.word;

            button.appendChild(word);

            // ป้ายบอกที่มา: คำที่พิมพ์ผิด / คำที่เพิ่มเอง / เพิ่มคำใหม่
            const tag = document.createElement('span');
            tag.className = 'suggest-tag';

            if (item.kind === 'add') {
                tag.textContent = 'เพิ่มคำนี้';
                button.className += ' add';
            } else if (item.kind === 'fix') {
                tag.textContent = 'สะกดไม่ถูก';
            } else if (item.source === 'custom') {
                tag.textContent = 'คำของฉัน';
            }

            if (tag.textContent) {
                button.appendChild(tag);
            }

            row.appendChild(button);
            list.appendChild(row);
        });

        const marked = list.querySelector('.suggest-item.selected');

        if (marked && marked.scrollIntoView) {
            marked.scrollIntoView({ block: 'nearest' });
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ตำแหน่งของ popup (กว้างเท่าช่องกรอก, ล้นขอบล่างก็พลิกขึ้นด้านบน)
    // ──────────────────────────────────────────────────────────────

    function position() {
        if (!menu || !activeInput) return;

        const box = activeInput.getBoundingClientRect();

        menu.style.width = 'auto';
        menu.style.visibility = 'hidden';
        menu.style.top = '0px';
        menu.style.left = '0px';

        const width = Math.min(
            Math.max(box.width, MIN_WIDTH),
            window.innerWidth - MARGIN * 2
        );

        const height = menu.offsetHeight;

        let left = box.left;

        if (left + width > window.innerWidth - MARGIN) {
            left = window.innerWidth - MARGIN - width;
        }

        if (left < MARGIN) left = MARGIN;

        let top = box.bottom + GAP;

        if (top + height > window.innerHeight - MARGIN) {
            top = box.top - height - GAP;
        }

        if (top < MARGIN) top = MARGIN;

        menu.style.width = width + 'px';
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.visibility = 'visible';
    }

    // ──────────────────────────────────────────────────────────────
    // เปิด / ปิด
    // ──────────────────────────────────────────────────────────────

    function close() {
        if (menu) {
            menu.hidden = true;
        }

        activeInput = null;
        items = [];
        range = null;
        highlight = -1;
    }

    // อ่านข้อความล่าสุดของช่องกรอกแล้วสร้างรายการแนะนำใหม่
    function refresh() {
        if (!activeInput || !document.contains(activeInput)) {
            close();
            return;
        }

        if (!scope.WordSuggest || !scope.WordSuggest.isEnabled()) {
            close();
            return;
        }

        const value = String(activeInput.value || '');
        const found = scope.WordSuggest.suggest(value, caretOf(activeInput, value));

        if (!found) {
            close();
            return;
        }

        range = { start: found.start, end: found.end };
        items = found.items.slice();

        // ไม่มีคำในพจนานุกรมที่ขึ้นต้นด้วยข้อความนี้ และยังไม่รู้จักคำนี้
        // = เสนอเพิ่มเข้าคำแนะนำของเรา (ไม่รบกวนตอนที่ยังมีคำให้เลือกอยู่)
        if (items.length === 0 && !scope.WordSuggest.isKnown(found.fragment)) {
            items.push({
                word: found.fragment,
                kind: 'add',
                source: 'custom'
            });
        }

        if (items.length === 0) {
            close();
            return;
        }

        build();

        // ชี้รายการแรกไว้เลย ปุ่ม Tab/Enter จึงใช้คำที่แนะนำได้ทันที
        highlight = 0;

        renderList();

        menu.hidden = false;
        position();
    }

    function openWith(input) {
        activeInput = input;
        refresh();
    }

    // ──────────────────────────────────────────────────────────────
    // เลือกใช้คำ
    // ──────────────────────────────────────────────────────────────

    function stepSelection(step) {
        if (items.length === 0) return;

        let index = highlight + step;

        if (index < 0) index = items.length - 1;
        if (index >= items.length) index = 0;

        highlight = index;
        renderList();
    }

    // เขียนคำที่เลือกทับช่วงข้อความที่กำลังพิมพ์ แล้ววางเคอร์เซอร์ต่อท้ายคำ
    function writeText(word) {
        const input = activeInput;
        const value = String(input.value || '');
        const next =
            value.slice(0, range.start) + word + value.slice(range.end);

        writing = true;

        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        writing = false;

        if (input.setSelectionRange) {
            const caret = range.start + word.length;

            input.setSelectionRange(caret, caret);
        }
    }

    function accept(index) {
        const item = items[index];

        if (!item) return false;

        // "เพิ่มคำนี้" = บันทึกคำเข้าฐานข้อมูล ไม่แก้ข้อความที่พิมพ์
        if (item.kind === 'add') {
            if (scope.App && scope.App.addSuggestWord) {
                scope.App.addSuggestWord(item.word);
            }

            close();
            return true;
        }

        writeText(item.word);
        close();

        return true;
    }

    // ──────────────────────────────────────────────────────────────
    // Events (ผูกที่ document เพราะฟอร์มถูกวาดใหม่ทุกครั้งที่เปลี่ยนหน้า)
    // ──────────────────────────────────────────────────────────────

    function onInput(event) {
        const input = event.target;

        if (writing) return;
        if (!isTarget(input)) return;

        // พิมพ์ต่อ = เลื่อนคำแนะนำตามข้อความล่าสุด
        if (menu && !menu.hidden && input === activeInput) {
            refresh();
            return;
        }

        openWith(input);
    }

    function onKeyDown(event) {
        if (!menu || menu.hidden) return;
        if (event.target !== activeInput) return;

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                stepSelection(1);
                break;

            case 'ArrowUp':
                event.preventDefault();
                stepSelection(-1);
                break;

            case 'Tab':
                // Shift+Tab = ปล่อยให้ย้ายช่องตามปกติ (ทางออกเมื่อไม่ต้องการคำแนะนำ)
                if (event.shiftKey) return;

                event.preventDefault();
                event.stopPropagation();
                accept(highlight);
                break;

            case 'Enter':
                // ใน textarea ต้องกด Enter ขึ้นบรรทัดใหม่ได้ตามปกติ
                if (activeInput.tagName === 'TEXTAREA') return;

                event.preventDefault();
                accept(highlight);
                break;

            case 'Escape':
                event.preventDefault();
                close();
                break;

            default:
                break;
        }
    }

    // ออกจากช่อง = ปิด popup (คลิกรายการถูก preventDefault ไว้ focus จึงไม่หลุด)
    function onFocusOut(event) {
        if (!menu || menu.hidden) return;
        if (event.target !== activeInput) return;

        close();
    }

    function onMouseDown(event) {
        if (menu && !menu.hidden && !menu.contains(event.target)) {
            close();
        }
    }

    // keydown ใช้ capture เพื่อแย่ง Tab ก่อนที่เบราว์เซอร์จะย้าย focus
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('input', onInput);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('mousedown', onMouseDown);

    scope.SuggestMenu = {
        close: close
    };
})(window);
