// Select Menu - ลิสต์ dropdown ของแอป (มุมมน พื้นชมพูจาง ๆ ฟุ้ง ๆ) ใช้กับ 2 อย่าง
//
//   1. <select> ทุกตัว        — แทน popup ของ OS ที่สั่งความมน/เงาไม่ได้
//   2. <input data-suggest="<id ของ datalist>"> — combobox ที่ดึงรายการจาก <datalist>
//      (ไม่ใช้ attribute list เพราะ Chromium จะเปิดลิสต์ของตัวเองซ้อนขึ้นมาด้วย)
//
// หลักการ: control ตัวจริงยังอยู่ครบและยังเป็นเจ้าของค่า/event ทั้งหมด
// เราแค่กัน popup ของ OS แล้วเขียนค่ากลับผ่าน value + ยิง event input/change
// เหมือนผู้ใช้เลือกเอง — หน้า/โมดูลอื่นจึงไม่ต้องแก้อะไร
//
// ใช้ event delegation เพราะฟอร์มถูกวาดใหม่ทุกครั้งที่เปลี่ยนหน้า/โหลด template
(function (scope) {
    'use strict';

    const MODE_SELECT = 'select';
    const MODE_SUGGEST = 'suggest';

    const MIN_WIDTH = 180;      // ความกว้างน้อยสุดของลิสต์
    const GAP = 6;              // ระยะห่างจากตัว control
    const MARGIN = 12;          // ระยะกันขอบจอ

    let menu = null;            // ลิสต์ (สร้างครั้งเดียวตอนเปิดครั้งแรก)
    let list = null;
    let mode = '';
    let activeControl = null;   // select หรือ input ที่กำลังเปิดลิสต์อยู่
    let activeDatalist = null;  // แหล่งรายการของโหมด suggest
    let items = [];             // รายการที่แสดงอยู่ (โหมด suggest ถูกกรองแล้ว)
    let highlight = -1;         // รายการที่คีย์บอร์ดชี้อยู่ (-1 = ยังไม่ชี้)
    let committing = false;     // กำลังเขียนค่าลง control อยู่ (กัน listener ของเราเอง)

    // ──────────────────────────────────────────────────────────────
    // ชนิดของ control
    // ──────────────────────────────────────────────────────────────

    function isSelect(control) {
        return !!control && control.tagName === 'SELECT';
    }

    function isSuggestInput(control) {
        return !!control && control.tagName === 'INPUT' && !!control.dataset.suggest;
    }

    // select ที่ใช้งานได้ (ไม่ถูก disable และไม่ได้ซ่อนอยู่)
    function isUsable(control) {
        if (!control || control.disabled) return false;

        return control.offsetWidth > 0 || control.offsetHeight > 0;
    }

    function datalistFor(input) {
        const id = input.dataset.suggest;

        return id ? document.getElementById(id) : null;
    }

    // ──────────────────────────────────────────────────────────────
    // รายการที่จะแสดง
    // ──────────────────────────────────────────────────────────────

    function buildItems() {
        const found = [];

        if (mode === MODE_SELECT) {
            for (const option of activeControl.options) {
                found.push({
                    value: option.value,
                    label: option.textContent,
                    disabled: option.disabled
                });
            }

            return found;
        }

        if (!activeDatalist) return found;

        const keyword = String(activeControl.value || '').trim().toLowerCase();

        for (const option of activeDatalist.options) {
            const label = option.label || option.value;
            const value = String(option.value);

            // พิมพ์อะไรก็กรองจากคำนั้น (ไม่สนตัวพิมพ์, ตรงกลางคำก็เจอ)
            if (
                keyword &&
                value.toLowerCase().indexOf(keyword) === -1 &&
                String(label).toLowerCase().indexOf(keyword) === -1
            ) {
                continue;
            }

            found.push({ value: value, label: label, disabled: false });
        }

        return found;
    }

    // "เลือกอยู่" ของ select ดูจากค่าปัจจุบัน / ของ suggest ดูจากคีย์บอร์ดที่เลื่อนไว้
    function isMarked(index) {
        if (items[index].disabled) return false;

        if (mode === MODE_SELECT) {
            return items[index].value === activeControl.value;
        }

        return index === highlight;
    }

    function renderList() {
        if (!activeControl || !document.contains(activeControl)) {
            close();
            return;
        }

        items = buildItems();
        list.innerHTML = '';

        if (items.length === 0) {
            const empty = document.createElement('li');
            empty.className = 'select-empty';
            empty.textContent = 'ไม่พบรายการที่ตรงกัน';
            list.appendChild(empty);
            return;
        }

        // ใช้ textContent เพราะข้อความมาจากข้อมูลผู้ใช้ (กัน XSS)
        items.forEach(function (item, index) {
            const row = document.createElement('li');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'select-item';
            button.dataset.index = String(index);
            button.textContent = item.label;

            if (isMarked(index)) {
                button.className += ' selected';
            }

            if (item.disabled) {
                button.className += ' disabled';
            }

            row.appendChild(button);
            list.appendChild(row);
        });

        const marked = list.querySelector('.select-item.selected');

        if (marked && marked.scrollIntoView) {
            marked.scrollIntoView({ block: 'nearest' });
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ตำแหน่งของลิสต์ (กว้างเท่าตัว control, ล้นขอบล่างก็พลิกขึ้นด้านบน)
    // ──────────────────────────────────────────────────────────────

    function position() {
        if (!menu || !activeControl) return;

        const box = activeControl.getBoundingClientRect();

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
            top = box.top - height - GAP;      // ด้านล่างไม่พอ -> วางด้านบน
        }

        if (top < MARGIN) top = MARGIN;

        menu.style.width = width + 'px';
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.visibility = 'visible';
    }

    // ──────────────────────────────────────────────────────────────
    // เปิด / ปิด / เขียนค่ากลับ
    // ──────────────────────────────────────────────────────────────

    function close() {
        if (menu) {
            menu.hidden = true;
        }

        mode = '';
        activeControl = null;
        activeDatalist = null;
        items = [];
        highlight = -1;
    }

    function commit(value) {
        if (!activeControl || !document.contains(activeControl)) {
            close();
            return;
        }

        if (activeControl.value === value) return;

        activeControl.value = value;

        // ค่าที่เราเขียนเองไม่ต้องเปิดลิสต์ซ้ำ (listener โหมด suggest ใช้ธงนี้)
        committing = true;

        // ยิง event เหมือนผู้ใช้เลือกเอง (input + change เหมือน select/datalist เนทีฟ)
        activeControl.dispatchEvent(new Event('input', { bubbles: true }));
        activeControl.dispatchEvent(new Event('change', { bubbles: true }));

        committing = false;
    }

    function openSelect(select) {
        openWith(select, MODE_SELECT, null);
    }

    function openSuggest(input) {
        const datalist = datalistFor(input);

        // ไม่มีแหล่งรายการ = ไม่ต้องเปิดลิสต์
        if (!datalist) return;

        openWith(input, MODE_SUGGEST, datalist);
    }

    function openWith(control, nextMode, datalist) {
        build();

        mode = nextMode;
        activeControl = control;
        activeDatalist = datalist;
        highlight = -1;

        renderList();

        if (!activeControl) return;

        // ลิสต์ต้องมองเห็นได้ก่อนอ่าน offsetHeight เพื่อคำนวณตำแหน่ง
        menu.hidden = false;
        position();

        if (control.focus) {
            control.focus();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // เลื่อนรายการ (select = เปลี่ยนค่าเลย, suggest = แค่เลื่อนที่ชี้)
    // ──────────────────────────────────────────────────────────────

    function stepSelection(step) {
        if (!activeControl) return;

        if (mode === MODE_SUGGEST) {
            if (items.length === 0) return;

            let index = highlight;

            for (let i = 0; i < items.length; i++) {
                index += step;

                if (index < 0) index = items.length - 1;
                if (index >= items.length) index = 0;

                if (!items[index].disabled) {
                    highlight = index;
                    renderList();
                    position();
                    return;
                }
            }

            return;
        }

        const options = activeControl.options;
        let index = activeControl.selectedIndex;

        for (let i = 0; i < options.length; i++) {
            index += step;

            if (index < 0) index = options.length - 1;
            if (index >= options.length) index = 0;

            if (!options[index].disabled) {
                commit(options[index].value);
                renderList();
                position();
                return;
            }
        }
    }

    function jumpSelection(last) {
        if (!activeControl) return;

        const indexes = [];

        if (mode === MODE_SUGGEST) {
            items.forEach(function (item, index) {
                if (!item.disabled) indexes.push(index);
            });
        } else {
            for (let i = 0; i < activeControl.options.length; i++) {
                if (!activeControl.options[i].disabled) indexes.push(i);
            }
        }

        if (indexes.length === 0) return;

        const index = last ? indexes[indexes.length - 1] : indexes[0];

        if (mode === MODE_SUGGEST) {
            highlight = index;
        } else {
            commit(activeControl.options[index].value);
        }

        renderList();
        position();
    }

    // Enter = เอาค่าที่คีย์บอร์ดชี้อยู่ (โหมด suggest จะยังไม่เขียนค่าจนกว่าจะกด Enter)
    function pickHighlighted() {
        if (highlight < 0 || !items[highlight] || items[highlight].disabled) return false;

        commit(items[highlight].value);
        return true;
    }

    // ──────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────

    function onMouseDown(event) {
        const target = event.target;

        const select = target.closest ? target.closest('select') : null;

        // คลิกตัว <select> = เปิดลิสต์ของเราแทน popup ของ OS
        if (select && isUsable(select)) {
            event.preventDefault();
            openSelect(select);
            return;
        }

        const suggest = target.closest ? target.closest('input[data-suggest]') : null;

        if (suggest) {
            // คลิกในช่อง = เปิดลิสต์ (คลิกซ้ำที่เดิม = ปิด)
            if (menu && !menu.hidden && suggest === activeControl) {
                close();
            } else {
                openSuggest(suggest);
            }

            return;
        }

        if (menu && !menu.hidden && !menu.contains(target)) {
            close();
        }
    }

    function onKeyDown(event) {
        const control = event.target;

        if (!isSelect(control) && !isSuggestInput(control)) return;

        const opened = menu && !menu.hidden && control === activeControl;
        const suggestMode = mode === MODE_SUGGEST;

        if (!opened) {
            // ปุ่มที่ปกติเปิดลิสต์ของ control เนทีฟ -> เปิดลิสต์ของเราแทน
            if (
                isSelect(control) &&
                isUsable(control) &&
                (event.key === 'Enter' || event.key === ' ' ||
                    event.key === 'ArrowDown' || event.key === 'ArrowUp')
            ) {
                event.preventDefault();
                openSelect(control);
                return;
            }

            if (isSuggestInput(control) && event.key === 'ArrowDown') {
                event.preventDefault();
                openSuggest(control);
            }

            return;
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                stepSelection(1);
                break;

            case 'ArrowUp':
                event.preventDefault();
                stepSelection(-1);
                break;

            case 'Home':
                event.preventDefault();
                jumpSelection(false);
                break;

            case 'End':
                event.preventDefault();
                jumpSelection(true);
                break;

            case 'Enter':
                if (suggestMode) {
                    if (highlight < 0) return;      // ไม่มีอะไรให้เลือก ปล่อย Enter ตามปกติ
                    event.preventDefault();
                    pickHighlighted();
                    close();
                    break;
                }

                event.preventDefault();
                close();
                break;

            case ' ':
                // โหมด suggest ต้องพิมพ์เว้นวรรคได้ตามปกติ
                if (suggestMode) return;

                event.preventDefault();
                close();
                break;

            case 'Escape':
                event.preventDefault();
                close();
                break;

            case 'Tab':
                close();
                break;

            default:
                break;
        }
    }

    // พิมพ์ในช่อง suggest = กรองรายการใหม่แล้วเปิดลิสต์ค้างไว้
    function onInput(event) {
        const control = event.target;

        if (!isSuggestInput(control) || committing) return;

        if (!menu || menu.hidden || control !== activeControl) {
            openSuggest(control);
            return;
        }

        highlight = -1;
        renderList();
        position();
    }

    // ออกจากช่อง (เช่นกด Tab) = ปิดลิสต์
    // คลิกรายการในลิสต์ถูก preventDefault ไว้ focus จึงไม่หลุด
    function onFocusOut(event) {
        if (!menu || menu.hidden) return;
        if (event.target !== activeControl) return;

        close();
    }

    // ──────────────────────────────────────────────────────────────
    // สร้างลิสต์ครั้งเดียวแล้วใช้ซ้ำ
    // ──────────────────────────────────────────────────────────────

    function build() {
        if (menu) return;

        menu = document.createElement('div');
        menu.className = 'select-menu';
        menu.id = 'selectMenu';
        menu.hidden = true;
        menu.innerHTML = '<ul class="select-menu-list" role="listbox"></ul>';

        document.body.appendChild(menu);

        list = menu.querySelector('.select-menu-list');

        // mousedown ก่อน click: กันไม่ให้ control ที่อยู่ข้างหลังแย่ง focus
        list.addEventListener('mousedown', function (event) {
            event.preventDefault();
        });

        list.addEventListener('click', function (event) {
            const button = event.target.closest('.select-item');

            if (!button) return;

            const item = items[Number(button.dataset.index)];

            if (!item || item.disabled) return;

            commit(item.value);
            close();
        });

        window.addEventListener('resize', function () {
            if (!menu.hidden) position();
        });

        window.addEventListener('scroll', function () {
            if (!menu.hidden) position();
        }, true);
    }

    // ผูกที่ document ตั้งแต่โหลด (ลิสต์สร้างตอนเปิดครั้งแรก)
    // เพราะ control ถูกวาดใหม่ทุกครั้งที่เปลี่ยนหน้า/โหลด template
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('input', onInput);
    document.addEventListener('focusout', onFocusOut);

    scope.SelectMenu = {
        open: function (control) {
            if (isSelect(control)) return openSelect(control);
            if (isSuggestInput(control)) return openSuggest(control);
        },
        close: close
    };
})(window);
