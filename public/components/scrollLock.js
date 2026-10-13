// Page Scroll Lock - ล็อกการ scroll ของ "หน้าจอด้านหลัง" ขณะมี popup เปิดอยู่
//
// ปัญหา: overlay ของแอปเป็น position: fixed ทับเต็มจอ แต่หน้าแอปที่อยู่ด้านหลัง
// ยังเลื่อนได้ (ล้อเมาส์ / ปุ่มลูกศร / space / PageDown) จึงเห็นเนื้อหาด้านหลัง
// เลื่อนอยู่ทั้งที่ popup บังอยู่
//
// วิธีทำ: เฝ้าดู DOM ด้วย MutationObserver แล้ว "คำนวณใหม่จากสภาพจริง" ว่าตอนนี้มี
// overlay เปิดอยู่ไหม (ไม่นับจำนวน open/close) — overlay ที่ถูกถอดออกจาก DOM
// โดยไม่เรียก close (เช่น เปลี่ยนหน้าแล้วฟอร์มถูกวาดใหม่) จึงไม่ทำให้ล็อกค้าง
//
// คลาสที่ใส่ตอนล็อกอยู่ที่ <html> (ไม่ใช่ <body>) เพื่อให้ viewport เท่านั้นที่หยุด
// ส่วน scroll ของ sidebar และของใน popup (หน้าจัดตำแหน่ง / ตัวอย่างเอกสาร)
// ยังทำงานปกติ — ดู .page-scroll-locked ใน src/renderer/style.css
//
// ทำไมไม่รวม SelectMenu / SuggestMenu (ลิสต์ที่เกาะกับช่องกรอก):
// สองตัวนั้นไม่บังหน้าจอ และออกแบบให้ "ปิด/เลื่อนตาม" เมื่อผู้ใช้เลื่อนจออยู่แล้ว
// (scroll listener ใน selectMenu / suggestMenu) — suggestMenu เปิดทุกครั้งที่พิมพ์
// ถ้าล็อกจอด้วย ผู้ใช้จะเลื่อนฟอร์มขณะ popup แนะนำคำเปิดอยู่ไม่ได้เลย
(function (scope) {
    'use strict';

    // overlay ที่ทับทั้งจอและมี backdrop
    const OVERLAY_SELECTOR = [
        '.page-modal.open',           // ฟอร์มสร้าง/แก้ไขแม่แบบ
        '.app-dialog.open',           // กล่องแจ้งเตือน / ยืนยัน / กรอกค่า
        '.layout-overlay.open',       // หน้าจัดตำแหน่งเอกสาร
        '.preview-overlay.open',      // ตัวอย่างเอกสารก่อนดาวน์โหลด
        '.lookup-overlay.open',       // เลือกข้อมูลจาก Master Data
        '.date-picker-overlay.open'   // เลือกรูปแบบวันที่
    ].join(', ');

    const LOCK_CLASS = 'page-scroll-locked';

    let locked = false;
    let basePaddingRight = '';   // padding ขวาเดิมของ body (inline) ก่อนล็อก
    let syncing = false;

    function overlayOpen() {
        return document.querySelector(OVERLAY_SELECTOR) !== null;
    }

    function lock() {
        const root = document.documentElement;
        const body = document.body;

        if (!body) return;

        // วัดความกว้างสกอลบาร์ "ก่อน" ซ่อน — ล็อกแล้วสกอลบาร์หายไป
        // ถ้าไม่ชดเชยด้วย padding ขวาเท่ากัน เนื้อหาทั้งหน้า (sidebar + ฟอร์ม)
        // จะกว้างขึ้นแล้วกระตุกตอนเปิด/ปิด popup
        const gutter = window.innerWidth - root.clientWidth;
        const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;

        basePaddingRight = body.style.paddingRight || '';

        if (gutter > 0) {
            body.style.paddingRight = (current + gutter) + 'px';
        }

        root.classList.add(LOCK_CLASS);
    }

    function unlock() {
        document.documentElement.classList.remove(LOCK_CLASS);

        const body = document.body;

        if (body) {
            body.style.paddingRight = basePaddingRight;
        }

        basePaddingRight = '';
    }

    // เทียบสภาพจริงกับสถานะที่ล็อกอยู่ — เรียกซ้ำได้ ไม่ทำอะไรถ้าไม่มีอะไรเปลี่ยน
    function sync() {
        const should = overlayOpen();

        if (should === locked) return;

        locked = should;

        if (should) lock();
        else unlock();
    }

    // MutationObserver เรียกครั้งเดียวต่อการเปลี่ยนแปลงหนึ่งชุดอยู่แล้ว (เช่น
    // ตอนพิมพ์ในหน้าจัดตำแหน่งที่แก้ class ทีละหลาย node) จึงตรวจในคอลแบ็กได้เลย
    // เร็วกว่าการรอ requestAnimationFrame ซึ่ง Chromium หยุดเรียกเมื่อหน้าต่าง
    // ถูกบัง/ย่อ — คลาสจะถูกใส่/ถอดก่อนวาดเฟรมถัดไปเสมอ ไม่มีจังหวะที่เลื่อนได้
    // ตัวกันเรียกซ้ำมีไว้เพราะ sync() เองก็แก้ DOM (ใส่คลาส/ชดเชย padding)
    function onMutations() {
        if (syncing) return;

        syncing = true;

        try {
            sync();
        } finally {
            syncing = false;
        }
    }

    function start() {
        if (!document.body) return;

        new MutationObserver(onMutations).observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class']
        });

        sync();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    scope.ScrollLock = {
        // ปกติ MutationObserver เรียกให้เอง — เปิดให้เรียกเองได้หลังแก้ DOM
        // นอกเหนือที่ observer เห็น
        sync: sync,

        isLocked: function () {
            return locked;
        },

        selector: OVERLAY_SELECTOR
    };
})(window);
