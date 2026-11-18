// เทสต์การจัดข้อความตามพิกัด (src/main/layout-text.cjs)
//   - เติมช่องว่างตามระยะจริงระหว่างชิ้นข้อความ
//   - เยื้องบรรทัดตามตำแหน่ง x
//   - เผื่อระยะคลาดเคลื่อน: บรรทัดที่ y ต่างกันเล็กน้อยยังอยู่แถวเดียวกัน
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const layoutText = require('../src/main/layout-text.cjs');

test('spacesForGap เติมช่องว่างตามจำนวนช่องว่างจริง', function () {
    // ระยะน้อยกว่าคำว่า "ช่องว่างระหว่างคำ" = ตัวอักษรต่อกัน
    assert.equal(layoutText.spacesForGap(1, { cellWidth: 10, wordGap: 2 }), 0);

    // ช่องว่างระหว่างคำ = 1 ช่อง
    assert.equal(layoutText.spacesForGap(4, { cellWidth: 10, wordGap: 2 }), 1);

    // คอลัมน์ห่างกัน 3 ช่อง
    assert.equal(layoutText.spacesForGap(32, { cellWidth: 10, wordGap: 2 }), 3);

    // ระยะผิดปกติถูกจำกัดไม่ให้บรรทัดยืดเกินจริง
    assert.equal(
        layoutText.spacesForGap(500, { cellWidth: 10, wordGap: 2, maxSpaces: 8 }),
        8
    );

    // OCR: แต่ละชิ้นคือคำแยกกัน — แม้กล่องจะซ้อนกันก็ต้องมีช่องว่าง 1 ช่อง
    assert.equal(layoutText.spacesForGap(0, { cellWidth: 10, wordGap: 0 }), 1);
    assert.equal(layoutText.spacesForGap(-3, { cellWidth: 10, wordGap: 0 }), 1);

    // ข้อความใน PDF ที่พิกัดติดลบเล็กน้อย = ยังเป็นคำเดียวกัน
    assert.equal(layoutText.spacesForGap(-3, { cellWidth: 10, wordGap: 2 }), 0);
});

test('joinParts ต่อชิ้นข้อความของบรรทัดเดียวและเติมช่องว่างตามพิกัด', function () {
    const text = layoutText.joinParts(
        [
            { x: 0, width: 30, text: 'เลขที่' },
            { x: 33, width: 20, text: '123' },
            { x: 120, width: 40, text: 'วันที่' }
        ],
        { cellWidth: 10, wordGap: 2 }
    );

    // ระยะ 67 หน่วย ÷ 10 = ประมาณ 7 ช่อง
    assert.equal(text, 'เลขที่ 123       วันที่');
});

test('layoutLines เยื้องบรรทัดตามตำแหน่งและคงลำดับบนลงล่าง', function () {
    const lines = [
        { text: 'หัวข้อ', left: 10, right: 60, top: 10, bottom: 22 },
        { text: 'ชื่อ', left: 10, right: 35, top: 40, bottom: 52 },
        { text: 'สมชาย', left: 70, right: 120, top: 40, bottom: 52 }
    ];

    const output = layoutText.layoutLines(lines);

    // ระยะ 35 หน่วย ÷ 10 = ประมาณ 4 ช่อง
    assert.deepEqual(output, [
        'หัวข้อ',
        'ชื่อ    สมชาย'
    ]);
});

test('layoutLines รวมบรรทัดที่ y คลาดเคลื่อนเล็กน้อยเป็นแถวเดียวกัน', function () {
    // หน้าสแกนเอียงเล็กน้อย: ฝั่งขวาของแถวอ่านได้ y ต่ำกว่า 3 หน่วย
    const lines = [
        { text: 'เลขที่', left: 0, right: 30, top: 10, bottom: 22 },
        { text: '123', left: 100, right: 130, top: 13, bottom: 25 }
    ];

    const grouped = layoutText.layoutLines(lines, { cellWidth: 10 });

    // อยู่บรรทัดเดียวกัน ไม่ถูกแยกเป็นสองบรรทัด
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0], 'เลขที่       123');
});

test('joinedGeometry ใช้พิกัดของทุกบรรทัดในกลุ่มที่ถูกเย็บ', function () {
    const { joinedGeometry } = require('../src/main/pdf-text.cjs');

    const sourceLines = [
        { text: 'เลขที่ 123/', left: 10, right: 90, top: 20, bottom: 32 },
        { text: '2569', left: 10, right: 40, top: 34, bottom: 46 },
        { text: 'วันที่', left: 10, right: 35, top: 60, bottom: 72 }
    ];

    const mapped = joinedGeometry(sourceLines, {
        lines: ['เลขที่ 123/2569', 'วันที่'],
        joined: 1,
        decisions: [{ join: true }, { join: false }]
    });

    assert.equal(mapped.length, 2);
    assert.equal(mapped[0].text, 'เลขที่ 123/2569');
    assert.equal(mapped[0].left, 10);
    assert.equal(mapped[0].right, 90);
    assert.equal(mapped[0].top, 20);
    assert.equal(mapped[0].bottom, 46);

    assert.equal(mapped[1].text, 'วันที่');
    assert.equal(mapped[1].top, 60);
});

test('layoutLines ไม่ยุบช่องว่างคั่นคอลัมน์ภายในบรรทัด', function () {
    const output = layoutText.layoutLines([
        { text: 'เลขที่   123', left: 0, right: 100, top: 10, bottom: 22 },
        { text: 'วันที่   1', left: 0, right: 100, top: 30, bottom: 42 }
    ]);

    assert.deepEqual(output, ['เลขที่   123', 'วันที่   1']);
});

test('layoutLines คืนข้อความเดิมเมื่อพิกัดไม่พอ', function () {
    assert.deepEqual(
        layoutText.layoutLines([{ text: 'ก' }, { text: 'ข' }]),
        ['ก', 'ข']
    );

    assert.deepEqual(layoutText.layoutLines([]), []);
});
