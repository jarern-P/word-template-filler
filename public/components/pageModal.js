// Page Modal - โมดัลฟอร์มสร้าง/แก้ไขของหน้าแบบ list-first
//
// โครง .page-modal ถูกฝังอยู่ใน HTML ของแต่ละหน้า (getHTML) จึงถูกล้างไป
// พร้อมการเปลี่ยนหน้าโดยอัตโนมัติ — ไฟล์นี้แค่เปิด/ปิดและจัดการคีย์บอร์ด
(function (scope) {
    'use strict';

    function find(id) {
        return id ? document.getElementById(id) : null;
    }

    // ปิดโมดัลที่เปิดอยู่ทั้งหมด (เปิดได้ทีละอัน)
    function closeAll() {
        document.querySelectorAll('.page-modal.open').forEach(function (modal) {
            modal.classList.remove('open');
        });
    }

    function open(id) {
        const modal = find(id);
        if (!modal) return;

        closeAll();

        modal.classList.add('open');

        // โฟกัสช่องแรกให้พิมพ์ต่อได้ทันที (ยกเว้นช่อง hidden)
        const first = modal.querySelector(
            '.page-modal-body input:not([type="hidden"]):not([type="file"]), ' +
            '.page-modal-body select, ' +
            '.page-modal-body textarea'
        );

        if (first && first.focus) {
            // รอให้โมดัลแสดงก่อน แล้วค่อยโฟกัส/เลือกข้อความเดิม
            window.setTimeout(function () {
                if (!modal.classList.contains('open') || !first.focus) return;

                first.focus();

                if (first.select) {
                    try {
                        first.select();
                    } catch (error) {
                        // บางชนิดของ input ไม่รองรับ select
                    }
                }
            }, 30);
        }
    }

    function close(id) {
        const modal = find(id);
        if (modal) modal.classList.remove('open');
    }

    // ปิดเมื่อกด Esc
    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            closeAll();
        }
    });

    scope.PageModal = {
        open: open,
        close: close,
        closeAll: closeAll
    };
})(window);
