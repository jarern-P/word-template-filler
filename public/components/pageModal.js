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

    // ──────────────────────────────────────────────────────────────
    // ย้ายโมดัลของหน้าไปเกาะ <body>
    // ──────────────────────────────────────────────────────────────
    //
    // โมดัลของแต่ละหน้าถูกเขียนไว้ใน HTML ของหน้านั้น (อยู่ใน .main) แต่ .main
    // มี backdrop-filter ซึ่งทำให้ position: fixed ของลูกไปยึดกับกล่องของ .main
    // แทนหน้าจอ — โมดัลจึงไปอยู่กลาง "ความสูงของเนื้อหาทั้งหน้า"
    // (หน้าข้อมูลหลักยาวหลายพันพิกเซล โมดัลจะไปโผล่ต่ำกว่าจอมาก) และ backdrop
    // ก็คลุมไม่ถึง sidebar ด้วย
    //
    // ย้ายมาเกาะ <body> แล้ว inset: 0 จึงหมายถึงหน้าจอจริงตามที่ตั้งใจ
    // (แนวเดียวกับ popup ตัวอื่นที่สร้างเองแล้ว appendChild ใส่ body)
    //
    // ตัวที่ย้ายมาแล้วต้องลบตอนวาดหน้าใหม่ ไม่งั้น id ของโมดัลจะซ้ำกับหน้าใหม่
    let mounted = [];

    function mount(container) {
        if (!container) return;

        container.querySelectorAll('.page-modal').forEach(function (modal) {
            document.body.appendChild(modal);
            mounted.push(modal);
        });
    }

    function unmount() {
        mounted.forEach(function (modal) {
            modal.remove();
        });

        mounted = [];
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
        closeAll: closeAll,
        mount: mount,
        unmount: unmount
    };
})(window);
