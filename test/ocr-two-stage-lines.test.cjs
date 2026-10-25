// เทสต์ตัวกรองบรรทัดขยะ (isNoiseLine) และการจัดลำดับแถวของตาราง (orderRows)
//
// เคสอ้างอิงจากหน้าเอกสารจริง (ใบเบิกเงินที่สแกน) — เศษจากโลโก้ เส้นตาราง
// และลายเซ็นต้องถูกกรอง แต่ข้อความจริงสั้น ๆ และตัวเลขต้องอยู่ครบ
//
// รันด้วย: npm test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    isNoiseLine,
    orderRows
} = require('../src/main/ocr-two-stage.cjs');

// ความสูงบรรทัดมัธยฐานของหน้าเอกสารจริง (~32 px ที่ 300 DPI)
const MEDIAN = 32;

function line(text, top, bottom, confidence) {
    return {
        text: text,
        left: 100,
        right: 400,
        top: top,
        bottom: bottom,
        confidence: confidence
    };
}

test('กรองบรรทัดขยะจากโลโก้ เส้นตาราง และลายเซ็น', function () {
    const junk = [
        line('บ', 814, 828, 0.98),
        line('e', 261, 275, 0.64),
        line('บ๐', 258, 276, 0.61),
        line('yh as', 1901, 1973, 0.56),
        line('190', 2053, 2061, 0.75),
        line('8 00 น น น น', 2244, 2255, 0.67),
        line('LM 98L', 2255, 2263, 0.58),
        line('PS', 2664, 2673, 0.76),
        line('Pเร', 2585, 2593, 0.64),
        line('cY', 2254, 2263, 0.53),
        line('0', 1834, 1844, 0.80)
    ];

    junk.forEach(function (item) {
        assert.equal(
            isNoiseLine(item, MEDIAN),
            true,
            'ควรถูกกรอง: ' + JSON.stringify(item.text)
        );
    });
});

test('เก็บข้อความจริงสั้น ตัวเลข และรหัสไว้', function () {
    const real = [
        line('เดบิต', 400, 435, 0.99),
        line('เครดิต', 403, 434, 0.99),
        line('0.00', 466, 506, 0.99),
        line('4,000.00', 472, 504, 1.00),
        line('PR108', 3206, 3234, 1.00),
        line('ผู้ตรวจสอบ 1', 2668, 2694, 0.95),
        line('หน้า 1 จาก 1', 3210, 3233, 0.99),
        line('RC05000000270100046', 476, 502, 0.99),
        line('2026.10.21 09:38:27 1CT', 2017, 2040, 0.97),
        line('จำนวน 3 รายการ', 1943, 1978, 0.99)
    ];

    real.forEach(function (item) {
        assert.equal(
            isNoiseLine(item, MEDIAN),
            false,
            'ไม่ควรถูกกรอง: ' + JSON.stringify(item.text)
        );
    });
});

test('ตัวเลขที่ความสูงปกติไม่ถูกกรองแม้ confidence ต่ำ', function () {
    assert.equal(isNoiseLine(line('190', 100, 132, 0.6), MEDIAN), false);
});

test('ข้อความสั้นที่โมเดลมั่นใจสูงยังถูกเก็บไว้', function () {
    assert.equal(isNoiseLine(line('NP', 100, 132, 0.95), MEDIAN), false);
    assert.equal(isNoiseLine(line('NP', 100, 132, 0.6), MEDIAN), true);
});

test('บรรทัดที่ไม่มีพิกัด/confidence ไม่ถูกกรองโดยไม่จำเป็น', function () {
    assert.equal(
        isNoiseLine({ text: 'ทดสอบ' }, MEDIAN),
        false
    );
});

// ------------------------------------------------------------------
// ลำดับแถวของตาราง
// ------------------------------------------------------------------

test('ตารางอ่านทีละแถว ซ้าย→ขวา แล้วลงแถวถัดไป', function () {
    const boxes = [
        { id: 'r1c3', top: 100, bottom: 130, left: 500, right: 560 },
        { id: 'r1c1', top: 100, bottom: 130, left: 100, right: 200 },
        { id: 'r1c2', top: 104, bottom: 134, left: 300, right: 380 },
        { id: 'r2c2', top: 160, bottom: 190, left: 400, right: 500 },
        { id: 'r2c1', top: 160, bottom: 190, left: 100, right: 180 }
    ];

    assert.deepEqual(
        orderRows(boxes).map(function (box) {
            return box.id;
        }),
        ['r1c1', 'r1c2', 'r1c3', 'r2c1', 'r2c2']
    );
});

test('ตารางที่มีเซลล์หลายบรรทัดอ่านทีละบรรทัดของแถว', function () {
    // หัวตาราง 1 บรรทัด + ข้อมูล 2 บรรทัด ทั้งสองคอลัมน์
    const boxes = [
        { id: 'h1', top: 100, bottom: 130, left: 100, right: 300 },
        { id: 'h2', top: 100, bottom: 130, left: 500, right: 700 },
        { id: 'L1', top: 160, bottom: 190, left: 100, right: 300 },
        { id: 'L2', top: 196, bottom: 226, left: 100, right: 300 },
        { id: 'R1', top: 160, bottom: 190, left: 500, right: 700 },
        { id: 'R2', top: 196, bottom: 226, left: 500, right: 700 }
    ];

    assert.deepEqual(
        orderRows(boxes).map(function (box) {
            return box.id;
        }),
        ['h1', 'h2', 'L1', 'R1', 'L2', 'R2']
    );
});

test('เซลล์ซ้ายหลายบรรทัดกับเซลล์ขวาบรรทัดเดียว', function () {
    // เซลล์ขวาสูงกว่าบรรทัดปกติ (2 บรรทัดรวมกัน) ต้องไม่ดูดบรรทัดซ้ายที่เหลือ
    const boxes = [
        { id: 'h1', top: 100, bottom: 130, left: 100, right: 300 },
        { id: 'h2', top: 100, bottom: 130, left: 500, right: 700 },
        { id: 'L1', top: 160, bottom: 190, left: 100, right: 300 },
        { id: 'L2', top: 196, bottom: 226, left: 100, right: 300 },
        { id: 'L3', top: 232, bottom: 262, left: 100, right: 300 },
        { id: 'R1', top: 160, bottom: 220, left: 500, right: 700 },
        { id: 'N1', top: 290, bottom: 320, left: 100, right: 700 }
    ];

    assert.deepEqual(
        orderRows(boxes).map(function (box) {
            return box.id;
        }),
        ['h1', 'h2', 'L1', 'R1', 'L2', 'L3', 'N1']
    );
});

test('กล่องสูงผิดปกติ (โลโก้/ลายเซ็น) ไม่ดึงแถวถัดไปมารวม', function () {
    const boxes = [
        { id: 'logo', top: 100, bottom: 230, left: 10, right: 60 },
        { id: 'date', top: 105, bottom: 140, left: 300, right: 400 },
        { id: 'title', top: 150, bottom: 185, left: 200, right: 500 },
        { id: 'next', top: 195, bottom: 230, left: 100, right: 300 }
    ];

    assert.deepEqual(
        orderRows(boxes).map(function (box) {
            return box.id;
        }),
        ['logo', 'date', 'title', 'next']
    );
});

test('ไม่ทำกล่องหายและรับอินพุตที่ยังไม่เรียงได้', function () {
    const boxes = [
        { id: 'd', top: 300, bottom: 330, left: 100, right: 200 },
        { id: 'b', top: 100, bottom: 130, left: 300, right: 400 },
        { id: 'a', top: 100, bottom: 130, left: 100, right: 200 },
        { id: 'c', top: 200, bottom: 230, left: 100, right: 200 }
    ];

    const ordered = orderRows(boxes);

    assert.deepEqual(
        ordered.map(function (box) {
            return box.id;
        }),
        ['a', 'b', 'c', 'd']
    );

    assert.equal(ordered.length, boxes.length);
});

test('หน้าเปล่า/กล่องเดียว', function () {
    assert.deepEqual(orderRows([]), []);

    const single = { id: 'only', top: 10, bottom: 40, left: 10, right: 90 };

    assert.deepEqual(orderRows([single]), [single]);
});
