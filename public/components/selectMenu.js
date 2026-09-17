// Select Menu - แทน popup ของ <select> เนทีฟ (ที่สั่งความมน/เงาไม่ได้ เพราะ OS วาดเอง)
// ด้วยลิสต์ของเราเองที่เข้าธีม (มุมมน พื้นชมพูจาง ๆ ฟุ้ง ๆ)
//
// หลักการ: ตัว <select> ยังอยู่ครบและยังเป็นเจ้าของค่า/event ทั้งหมด
// เราแค่กัน popup ของ OS ด้วย preventDefault ตอน mousedown (และคีย์ที่เปิดลิสต์)
// แล้วเขียนค่ากลับผ่าน select.value + ยิง event input/change เหมือนผู้ใช้เลือกเอง
//
// ใช้กับ <select> ทุกตัวด้วย event delegation เพราะฟอร์มถูกวาดใหม่บ่อย
(function (scope) {
    'use strict';

    const MIN_WIDTH = 180;      // ความกว้างน้อยสุดของลิสต์
    const GAP = 6;              // ระยะห่างจากตัว select
    const MARGIN = 12;          // ระยะกันขอบจอ

    let menu = null;            // ลิสต์ (สร้างครั้งเดียวตอนเปิดครั้งแรก)
    let list = null;
    let activeSelect = null;    // select ที่กำลังเปิดลิสต์อยู่

    function isUsable(select) {
        if (!select || select.disabled || select.options.length === 0) return false;

        // ข้าม select ที่ถูกซ่อนอยู่ (เช่นอยู่ในหน้าที่ไม่ได้แสดง)
        return select.offsetWidth > 0 || select.offsetHeight > 0;
    }

    // ──────────────────────────────────────────────────────────────
    // วาดรายการ
    // ──────────────────────────────────────────────────────────────

    function renderList() {
        if (!activeSelect || !document.contains(activeSelect)) {
            close();
            return;
        }

        list.innerHTML = '';

        // ใช้ textContent เพราะข้อความ option มาจากข้อมูลผู้ใช้ (กัน XSS)
        for (const option of activeSelect.options) {
            const item = document.createElement('li');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'select-item';

            // ตัวเลือกที่ disable (เช่น placeholder) ไม่ต้องขึ้นว่า "เลือกอยู่"
            if (option.disabled) {
                button.className += ' disabled';
            } else if (option.value === activeSelect.value) {
                button.className += ' selected';
            }

            button.dataset.value = option.value;
            button.textContent = option.textContent;

            item.appendChild(button);
            list.appendChild(item);
        }

        const selected = list.querySelector('.select-item.selected');

        if (selected && selected.scrollIntoView) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ตำแหน่งของลิสต์ (กว้างเท่าตัว select, ล้นขอบล่างก็พลิกขึ้นด้านบน)
    // ──────────────────────────────────────────────────────────────

    function position() {
        if (!menu || !activeSelect) return;

        const box = activeSelect.getBoundingClientRect();

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

        activeSelect = null;
    }

    function commit(value) {
        if (!activeSelect || !document.contains(activeSelect)) {
            close();
            return;
        }

        if (activeSelect.value === value) return;

        activeSelect.value = value;

        // ยิง event เหมือนผู้ใช้เลือกเอง (ทั้ง input และ change เหมือน select เนทีฟ)
        activeSelect.dispatchEvent(new Event('input', { bubbles: true }));
        activeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function open(select) {
        build();

        activeSelect = select;
        renderList();

        if (!activeSelect) return;

        // ลิสต์ต้องเห็นได้ก่อนอ่าน offsetHeight เพื่อคำนวณตำแหน่ง
        menu.hidden = false;
        position();

        if (select.focus) {
            select.focus();
        }
    }

    function move(step) {
        if (!activeSelect) return;

        const options = activeSelect.options;
        let index = activeSelect.selectedIndex;

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

    function edge(last) {
        if (!activeSelect) return;

        const options = activeSelect.options;
        const indexes = [];

        for (let i = 0; i < options.length; i++) {
            if (!options[i].disabled) indexes.push(i);
        }

        if (indexes.length === 0) return;

        const index = last ? indexes[indexes.length - 1] : indexes[0];

        commit(options[index].value);
        renderList();
        position();
    }

    // ──────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────

    function onMouseDown(event) {
        const select = event.target.closest
            ? event.target.closest('select')
            : null;

        // คลิกตัว <select> = เปิดลิสต์ของเราแทน popup ของ OS
        if (isUsable(select)) {
            event.preventDefault();
            open(select);
            return;
        }

        if (menu && !menu.hidden && !menu.contains(event.target)) {
            close();
        }
    }

    function onKeyDown(event) {
        const select = event.target && event.target.tagName === 'SELECT'
            ? event.target
            : null;

        if (!select) return;

        const opened = menu && !menu.hidden && select === activeSelect;

        if (!opened) {
            // ปุ่มที่ปกติเปิดลิสต์ของ select เนทีฟ -> เปิดลิสต์ของเราแทน
            if (
                isUsable(select) &&
                (event.key === 'Enter' || event.key === ' ' ||
                    event.key === 'ArrowDown' || event.key === 'ArrowUp')
            ) {
                event.preventDefault();
                open(select);
            }

            return;
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                move(1);
                break;

            case 'ArrowUp':
                event.preventDefault();
                move(-1);
                break;

            case 'Home':
                event.preventDefault();
                edge(false);
                break;

            case 'End':
                event.preventDefault();
                edge(true);
                break;

            case 'Enter':
            case ' ':
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

        // mousedown ก่อน click: กันไม่ให้ select ที่อยู่ข้างหลังแย่ง focus
        list.addEventListener('mousedown', function (event) {
            event.preventDefault();
        });

        list.addEventListener('click', function (event) {
            const item = event.target.closest('.select-item');

            if (!item || item.classList.contains('disabled')) return;

            commit(item.dataset.value);
            close();
        });

        // ค่าเปลี่ยนจากทางอื่น (เช่นคีย์พิมพ์ตัวอักษร) -> ลิสต์ต้องตามให้ทัน
        document.addEventListener('input', function (event) {
            if (menu.hidden || event.target !== activeSelect) return;

            renderList();
        });

        window.addEventListener('resize', function () {
            if (!menu.hidden) position();
        });

        window.addEventListener('scroll', function () {
            if (!menu.hidden) position();
        }, true);
    }

    // ผูกที่ document ตั้งแต่โหลด (ลิสต์จะถูกสร้างตอนเปิดครั้งแรก)
    // เพราะ <select> ถูกวาดใหม่ทุกครั้งที่เปลี่ยนหน้า/โหลด template
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);

    scope.SelectMenu = {
        open: open,
        close: close
    };
})(window);
