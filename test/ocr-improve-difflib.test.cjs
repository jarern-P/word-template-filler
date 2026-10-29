// เทสต์การปรับปรุงข้อความด้วย difflib.js — ลำดับความสำคัญของแหล่งคำ
// การแทนคำที่ OCR อ่านผิด และค่าตั้งว่าจะใช้ AI หรือ difflib
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const os = require('os');
const path = require('path');

const difflibImprove = require('../src/main/ocr-improve-difflib.cjs');
const ocrConfig = require('../src/main/ocr-config.cjs');

function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-difflib-'));

    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('difflib ใช้คำจากข้อมูลหลักก่อน แม้คลังคำจะมีคำที่ใกล้กว่า', function () {
    const result = difflibImprove.improveText('ทดสอป', {
        master: ['ทดสอบ'],
        words: ['ทดสอง'],
        dictionary: ['ทดสอง', 'ทดสอบ'],
        cutoff: 0.6
    });

    assert.strictEqual(result.text, 'ทดสอบ');
    assert.strictEqual(result.changed, 1);
    assert.deepStrictEqual(result.replacements, [
        { from: 'ทดสอป', to: 'ทดสอบ', source: 'master' }
    ]);
});

test('difflib ใช้คลังคำศัพท์ก่อนพจนานุกรม', function () {
    const result = difflibImprove.improveText('ทดสอป', {
        master: [],
        words: ['ทดสอง'],
        dictionary: ['ทดสอบ'],
        cutoff: 0.6
    });

    assert.strictEqual(result.text, 'ทดสอง');
    assert.strictEqual(result.replacements[0].source, 'wordbank');
});

test('difflib ใช้พจนานุกรมเมื่อไม่มีคำในข้อมูลหลัก/คลังคำ', function () {
    const result = difflibImprove.improveText('ทดสอป', {
        master: ['อื่น'],
        words: ['อื่น'],
        dictionary: ['ทดสอบ'],
        cutoff: 0.6
    });

    assert.strictEqual(result.text, 'ทดสอบ');
    assert.strictEqual(result.replacements[0].source, 'dictionary');
});

test('difflib แยกชื่อในข้อมูลหลักที่มีหลายคำและแก้เฉพาะคำที่ผิด', function () {
    const result = difflibImprove.improveText('บริษัท ทดสอป จำกัด', {
        master: ['บริษัท ทดสอบ จำกัด'],
        words: [],
        dictionary: [],
        cutoff: 0.6
    });

    assert.strictEqual(result.text, 'บริษัท ทดสอบ จำกัด');
    assert.strictEqual(result.changed, 1);
});

test('difflib แก้ชื่อเฉพาะในข้อมูลหลักที่ OCR อ่านผิดหลายตัว', function () {
    const result = difflibImprove.improveText('นายเชาวรัตน์ สตยานริกษ', {
        master: ['นายเชาวรัตน์ สัตยานุรักษ์'],
        words: [],
        dictionary: []
    });

    assert.strictEqual(result.text, 'นายเชาวรัตน์ สัตยานุรักษ์');
    assert.deepStrictEqual(result.replacements, [
        { from: 'สตยานริกษ', to: 'สัตยานุรักษ์', source: 'master' }
    ]);
});

test('difflib ใช้คลังคำศัพท์แก้ชื่อสถานที่ที่ OCR อ่านผิดทั้งวลี', function () {
    const result = difflibImprove.improveText('เสาธตมหาวทยาลัยทักษณ ฝายมัธยม', {
        master: [],
        words: ['สาธิตมหาวิทยาลัยทักษิณ ฝ่ายมัธยม'],
        // "ฝายมัธยม" ตัดเป็นคำในพจนานุกรมได้ แต่คลังคำต้องมาก่อน
        dictionary: ['ฝาย', 'มัธยม']
    });

    assert.strictEqual(
        result.text,
        'สาธิตมหาวิทยาลัยทักษิณ ฝ่ายมัธยม'
    );
    assert.deepStrictEqual(result.replacements, [
        {
            from: 'เสาธตมหาวทยาลัยทักษณ',
            to: 'สาธิตมหาวิทยาลัยทักษิณ',
            source: 'wordbank'
        },
        {
            from: 'ฝายมัธยม',
            to: 'ฝ่ายมัธยม',
            source: 'wordbank'
        }
    ]);
});

test('difflib แก้ประโยคยาวในคลังคำที่ OCR อ่านผิดหลายคำ', function () {
    const correct = 'เห็นควรอนุมัติให้เบิกจ่ายได้ตามจำนวนเงินข้างต้น';

    const result = difflibImprove.improveText(
        'เหนควรอนมตไหเบกจายไดตามจานวนเงนขางตน',
        {
            master: [],
            words: [correct],
            dictionary: []
        }
    );

    assert.strictEqual(result.text, correct);
    assert.deepStrictEqual(result.replacements, [
        {
            from: 'เหนควรอนมตไหเบกจายไดตามจานวนเงนขางตน',
            to: correct,
            source: 'wordbank'
        }
    ]);

    // ประโยคที่ถูกอยู่แล้วต้องไม่ถูกแก้
    assert.strictEqual(
        difflibImprove.improveText(correct, {
            master: [],
            words: [correct],
            dictionary: []
        }).changed,
        0
    );
});

test('difflib ต่อวลีในคลังคำที่ OCR ตัดข้ามบรรทัด และย้ายข้อความคั่นไปหลังวลี', function () {
    const result = difflibImprove.improveText(
        '(โครงการสนับสนุนการพัฒนาทักษะทางวิทยาศาสตร์\n' +
        'นางสาวปวีณ์ทิตตา อินราช\n' +
        'นวัตกรรมและเทคโนโลยี ประจำปีการศึกษา 2/2569)',
        {
            master: [],
            words: [
                'โครงการสนับสนุนการพัฒนาทักษะทางวิทยาศาสตร์ นวัตกรรมและเทคโนโลยี'
            ],
            dictionary: []
        }
    );

    assert.strictEqual(
        result.text,
        '(โครงการสนับสนุนการพัฒนาทักษะทางวิทยาศาสตร์ นวัตกรรมและเทคโนโลยี ' +
        'นางสาวปวีณ์ทิตตา อินราช ประจำปีการศึกษา 2/2569)'
    );
    assert.strictEqual(result.phrases, 1);
    assert.strictEqual(result.changed, 0);
});

test('difflib ต่อวลี 3 ส่วนโดยไม่ซ้ำส่วนกลาง', function () {
    const result = difflibImprove.improveText(
        '(โครงการสนับสนุนการพัฒนาทักษะทางวิทยาศาสตร์\n' +
        'นางสาวปวีณ์ทิตตา อินราช\n' +
        'นวัตกรรมและเทคโนโลยี ประจำปีการศึกษา 2/2569)',
        {
            master: [],
            words: [
                'โครงการสนับสนุนการพัฒนาทักษะทางวิทยาศาสตร์ ' +
                'นวัตกรรมและเทคโนโลยี ประจำปีการศึกษา 2/2569'
            ],
            dictionary: []
        }
    );

    assert.strictEqual(
        result.text,
        '(โครงการสนับสนุนการพัฒนาทักษะทางวิทยาศาสตร์ นวัตกรรมและเทคโนโลยี ' +
        'ประจำปีการศึกษา 2/2569 นางสาวปวีณ์ทิตตา อินราช)'
    );
    assert.strictEqual(result.phrases, 1);
    assert.strictEqual(result.changed, 0);
});

test('difflib ไม่แตะวลีที่อยู่บรรทัดเดียวกันแล้ว', function () {
    const input =
        'โครงการสนับสนุนการพัฒนาทักษะทางวิทยาศาสตร์ นวัตกรรมและเทคโนโลยี';

    const result = difflibImprove.improveText(input, {
        master: [],
        words: [input],
        dictionary: []
    });

    assert.strictEqual(result.text, input);
    assert.strictEqual(result.phrases, 0);
});

test('difflib ไม่แตะวลีในคลังคำศัพท์ที่ถูกอยู่แล้ว', function () {
    const input = 'สาธิตมหาวิทยาลัยทักษิณ ฝ่ายมัธยม';

    const result = difflibImprove.improveText(input, {
        master: [],
        words: [input],
        dictionary: ['ฝาย', 'มัธยม']
    });

    assert.strictEqual(result.text, input);
    assert.strictEqual(result.changed, 0);
});

test('difflib ไม่แตะชื่อในข้อมูลหลักที่มีวงเล็บหรือจุด', function () {
    const names = [
        'นักวิชาการ (ที่ปรึกษาหอพักหญิง)',
        'ผศ.สุนิสา คงประสิทธิ์'
    ];

    names.forEach(function (name) {
        const result = difflibImprove.improveText(name, {
            master: names,
            words: [],
            dictionary: ['ผศ.']
        });

        assert.strictEqual(result.text, name);
        assert.strictEqual(result.changed, 0);
    });
});

test('difflib ไม่เติมจุดจากคำในพจนานุกรมเข้าท้ายคำไทย', function () {
    const result = difflibImprove.improveText('ผศ.สุนิสา', {
        master: [],
        words: [],
        dictionary: ['ผศ.']
    });

    assert.strictEqual(result.text, 'ผศ.สุนิสา');
    assert.strictEqual(result.changed, 0);
});

test('difflib ไม่ตัดท้ายคำย่อที่ขึ้นต้นด้วยคำรู้จัก', function () {
    const input = 'ว่าที่ร.ต.หญิงพิชามญชุ์ ส่งนาวา';

    const result = difflibImprove.improveText(input, {
        master: [input],
        words: [],
        dictionary: ['ว่าที่']
    });

    assert.strictEqual(result.text, input);
    assert.strictEqual(result.changed, 0);
});

test('difflib แทนจุดที่ OCR ใส่คั่นกลางคำด้วยช่องว่างก่อนเทียบ', function () {
    const result = difflibImprove.improveText('เห.นควรอนุมัติ', {
        master: [],
        words: ['เห็นควรอนุมัติ'],
        dictionary: []
    });

    assert.strictEqual(result.text, 'เห็นควรอนุมัติ');
    assert.strictEqual(result.dots, 1);
    // แทนจุดด้วยช่องว่างแล้ว difflib ยังรวมช่วงที่คั่นด้วยช่องว่างเดียว
    // แล้วแก้เป็นคำเต็มได้
    assert.deepStrictEqual(result.replacements, [
        {
            from: 'เหนควรอนุมัติ',
            to: 'เห็นควรอนุมัติ',
            source: 'wordbank'
        }
    ]);
});

test('difflib คงจุดในตัวเลขและคำย่อที่มีในระบบ', function () {
    const input = 'ผศ.สุนิสา รับเงิน 4,000.00 บาท';

    const result = difflibImprove.improveText(input, {
        master: ['ผศ.สุนิสา'],
        words: [],
        dictionary: []
    });

    assert.strictEqual(result.text, input);
    assert.strictEqual(result.dots, 0);
});

test('difflib ไม่รักษาจุดที่ไปจับคำย่อข้ามคำ', function () {
    const result = difflibImprove.improveText('สาธิตม.หาวิทยาลัย', {
        master: [],
        words: [],
        dictionary: ['ตม.']
    });

    // จุดถูกแทนด้วยช่องว่าง (difflib ไม่มีคำเต็มให้แทนที่ในเคสนี้)
    assert.strictEqual(result.text, 'สาธิตม หาวิทยาลัย');
    assert.strictEqual(result.dots, 1);
});

test('difflib แทนจุดติดกันหลายตัวด้วยช่องว่างเดียว', function () {
    const result = difflibImprove.improveText('ทดสอบ...ผ่าน..แล้ว', {
        master: [],
        words: [],
        dictionary: []
    });

    assert.strictEqual(result.text, 'ทดสอบ ผ่าน แล้ว');
    assert.strictEqual(result.dots, 5);
});

test('difflib รวมจุดซ้ำที่ OCR ใส่ซ้อนกัน', function () {
    const result = difflibImprove.improveText('ม..ทักษิณ', {
        master: [],
        words: ['ม.ทักษิณ'],
        dictionary: []
    });

    assert.strictEqual(result.text, 'ม.ทักษิณ');
    assert.strictEqual(result.dots, 1);
});

test('difflib คงจุดในคำย่อมาตรฐานที่ไม่มีในพจนานุกรม', function () {
    const input = 'วันที่ 1 ม.ค. 2569 และ พ.ศ. 2569';

    const result = difflibImprove.improveText(input, {
        master: [],
        words: [],
        dictionary: []
    });

    assert.strictEqual(result.text, input);
    assert.strictEqual(result.dots, 0);
});

test('difflib คงจุดในคำย่ออักษรเดียวเมื่ออยู่ต้นคำ', function () {
    const input = 'ม.ทักษิณ';

    const result = difflibImprove.improveText(input, {
        master: [],
        words: [input],
        dictionary: []
    });

    assert.strictEqual(result.text, input);
    assert.strictEqual(result.dots, 0);
});

test('difflib ยุบช่องว่างจากจุดเมื่อรวมแล้วเป็นคำที่รู้จัก', function () {
    const result = difflibImprove.improveText('สาธิ.ตมหาวิทยาลัย', {
        master: [],
        words: ['สาธิตมหาวิทยาลัย'],
        dictionary: []
    });

    assert.strictEqual(result.text, 'สาธิตมหาวิทยาลัย');
    assert.strictEqual(result.dots, 1);
});

test('difflib แก้คำที่ OCR อ่านขาดท้ายคำได้ แม้ความคล้ายต่ำกว่า 0.75', function () {
    const result = difflibImprove.improveText('เรียน ผู้อานวยก: โรงเรียน', {
        master: [],
        words: ['ผู้อำนวยการ'],
        dictionary: []
    });

    assert.strictEqual(result.text, 'เรียน ผู้อำนวยการ: โรงเรียน');
    assert.strictEqual(result.changed, 1);
});

test('difflib แก้คำที่ถูกจุดคั่นระหว่างคำโดยไม่ทำคำข้างเคียงเพี้ยน', function () {
    const result = difflibImprove.improveText('เรียน.ผูอานวยก: โรงเรียน', {
        master: [],
        words: ['ผู้อำนวยการ'],
        // "เรียน" ใกล้ "เกรียน" แต่ต้องไม่ถูกแก้ เพราะไม่ใช่การเติมท้ายคำ
        dictionary: ['เกรียน']
    });

    assert.strictEqual(result.text, 'เรียน ผู้อำนวยการ: โรงเรียน');
    assert.strictEqual(result.dots, 1);
});

test('difflib แทนจุดที่มีช่องว่างรอบข้างด้วยช่องว่างเดียว', function () {
    const result = difflibImprove.improveText('จำนวน . เงิน', {
        master: [],
        words: [],
        dictionary: []
    });

    assert.strictEqual(result.text, 'จำนวน เงิน');
    assert.strictEqual(result.dots, 1);
});

test('difflib ไม่แตะจุดในข้อความภาษาอังกฤษ', function () {
    const input = 'Mr. Abel Arama Hitler';

    const result = difflibImprove.improveText(input, {
        master: [input],
        words: [],
        dictionary: []
    });

    assert.strictEqual(result.text, input);
    assert.strictEqual(result.dots, 0);
});

test('difflib รวมคำที่ OCR เว้นวรรคผิดแล้วแทนทั้งช่วง', function () {
    const result = difflibImprove.improveText('จา นวนเงนิ 4,000.00 บาท', {
        master: [],
        words: ['จำนวนเงิน'],
        dictionary: [],
        cutoff: 0.6
    });

    assert.strictEqual(result.text, 'จำนวนเงิน 4,000.00 บาท');
    assert.deepStrictEqual(result.replacements, [
        { from: 'จานวนเงนิ', to: 'จำนวนเงิน', source: 'wordbank' }
    ]);
});

test('difflib ไม่แตะคำที่ถูกอยู่แล้ว ตัวเลข และคำที่ไม่ใกล้คำใดเลย', function () {
    const input = 'จำนวนเงิน 4,000.00 บาท\nกขคง';

    const result = difflibImprove.improveText(input, {
        master: [],
        words: [],
        dictionary: ['จำนวนเงิน', 'บาท']
    });

    assert.strictEqual(result.text, input);
    assert.strictEqual(result.changed, 0);
    assert.deepStrictEqual(result.replacements, []);
});

test('difflib อ่านพจนานุกรมกลางจาก dictionary/th_TH.dic', function () {
    assert.ok(
        fs.existsSync(difflibImprove.dictionaryPath()),
        'ต้องมีไฟล์ dictionary/th_TH.dic'
    );

    assert.ok(difflibImprove.loadDictionary().length > 1000);

    const result = difflibImprove.improveText('เงนิ', {
        master: [],
        words: []
    });

    assert.strictEqual(result.text, 'เงิน');
});

test('ocr-config ค่าเริ่มต้นใช้ AI และบันทึก/คืนค่า difflib ได้', function () {
    withTempDir(function (dir) {
        const initial = ocrConfig.read(dir);

        assert.strictEqual(initial.improve.engine, 'ai');

        const saved = ocrConfig.save(dir, {
            improve: { engine: 'difflib' }
        });

        assert.strictEqual(saved.improve.engine, 'difflib');
        assert.strictEqual(
            ocrConfig.readSecrets(dir).improve.engine,
            'difflib'
        );

        // ไม่ส่ง engine มา = ใช้ค่าเดิม
        const again = ocrConfig.save(dir, { provider: 'gemini' });
        assert.strictEqual(again.improve.engine, 'difflib');

        // ค่าที่ไม่รู้จัก = คงค่าเดิมไว้
        const invalid = ocrConfig.save(dir, {
            improve: { engine: 'unknown' }
        });

        assert.strictEqual(invalid.improve.engine, 'difflib');
    });
});
