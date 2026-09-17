// Sidebar Component - จัดการเมนู sidebar และการกาง/หุบ submenu
(function (scope) {
    'use strict';

    function getSubmenu() {
        return document.getElementById('masterSubmenu');
    }

    function getMenuItems() {
        return document.querySelectorAll('.sidebar .menu-item');
    }

    // เมนูแม่ของ submenu — ผูกกันด้วย aria-controls จึงไม่ต้อง hard-code ชื่อเมนู
    function getSubmenuParent(submenu) {
        if (!submenu || !submenu.id) return null;

        return document.querySelector(
            '.sidebar .menu-item[aria-controls="' + submenu.id + '"]'
        );
    }

    // กาง/หุบ submenu พร้อมอัปเดตเมนูแม่ (ไฮไลต์ + หมุนลูกศร + aria-expanded)
    function setSubmenuOpen(submenu, open) {
        if (!submenu) return;

        submenu.classList.toggle('open', open);

        const parent = getSubmenuParent(submenu);
        if (!parent) return;

        parent.classList.toggle('open', open);
        parent.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    scope.Sidebar = {
        init: function () {
            const sidebar = document.querySelector('.sidebar');
            if (!sidebar) return;

            // ใช้ event delegation: ผูกครั้งเดียว ใช้ได้กับเมนูที่ render ทีหลัง
            sidebar.addEventListener('click', function (event) {
                const item = event.target.closest('.menu-item');
                if (!item || !sidebar.contains(item)) return;

                const page = item.dataset.page;
                if (page) {
                    scope.App.showPage(page);
                }
            });
        },

        // กำหนดเมนูที่ active ตามชื่อหน้า
        // ถ้าหน้านั้นอยู่ใน submenu ให้กาง submenu ค้างไว้ (ไม่หุบเมื่อเปลี่ยนหน้า)
        setActive: function (page) {
            let parentSubmenu = null;

            getMenuItems().forEach(function (item) {
                const active = item.dataset.page === page;
                item.classList.toggle('active', active);

                if (active) {
                    parentSubmenu = item.closest('.submenu') || null;
                }
            });

            if (parentSubmenu) {
                setSubmenuOpen(parentSubmenu, true);
            }
        },

        // คลิกเมนูแม่ = สลับกาง/หุบ (กางค้างไว้จนกว่าจะคลิกปิดเอง)
        toggleMasterSubmenu: function () {
            const submenu = getSubmenu();
            if (!submenu) return;

            setSubmenuOpen(submenu, !submenu.classList.contains('open'));
        }
    };
})(window);
