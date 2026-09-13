// Sidebar Component - จัดการเมนู sidebar และการ toggle submenu
(function (scope) {
    'use strict';

    function getSubmenu() {
        return document.getElementById('masterSubmenu');
    }

    function getMasterItem() {
        return document.querySelector('.sidebar .menu-item[data-page="master"]');
    }

    function getMenuItems() {
        return document.querySelectorAll('.sidebar .menu-item');
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
        setActive: function (page) {
            getMenuItems().forEach(function (item) {
                item.classList.toggle('active', item.dataset.page === page);
            });
        },

        toggleMasterSubmenu: function () {
            const submenu = getSubmenu();
            if (!submenu) return;

            submenu.classList.toggle('open');
            const isOpen = submenu.classList.contains('open');

            const masterItem = getMasterItem();
            if (masterItem) {
                masterItem.classList.toggle('active', isOpen);
            }
        },

        closeMasterSubmenu: function () {
            const submenu = getSubmenu();
            if (submenu) {
                submenu.classList.remove('open');
            }

            const masterItem = getMasterItem();
            if (masterItem) {
                masterItem.classList.remove('active');
            }
        }
    };
})(window);
