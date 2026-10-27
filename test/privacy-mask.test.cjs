// เทสต์การปกปิดคำเฉพาะก่อนส่ง AI — การแทนตัวแปร การคืนค่า และคำสั่งใน prompt
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const privacy = require('../src/main/privacy-mask.cjs');
const improve = require('../src/main/ocr-improve.cjs');

const MONEY = privacy.DEFAULT_TERMS[0];
const NUMBER = privacy.DEFAULT_TERMS[1];
const NAME = privacy.DEFAULT_TERMS[2];

// เปิดใช้รายการ preset ที่ทดสอบ (ค่าเริ่มต้นในฐานข้อมูลเป็น "ปิด")
function enabled(term, overrides) {
    return Object.assign({}, term, { enabled: 1 }, overrides || {});
}

test('DEFAULT_TERMS มี preset จำนวนเงิน/ตัวเลข/ชื่อ และยังปิดอยู่ทั้งหมด', function () {
    assert.ok(privacy.DEFAULT_TERMS.length >= 4);

    privacy.DEFAULT_TERMS.forEach(function (term) {
        assert.strictEqual(Number(term.enabled), 0);
        assert.ok(term.pattern.trim() !== '');
        assert.ok(['text', 'regex'].indexOf(term.kind) !== -1);

        const compiled = privacy.validatePattern(term.kind, term.pattern);
        assert.ok(compiled.ok, term.name + ': ' + compiled.error);
    });
});

test('mask แทนคำธรรมดาด้วยตัวแปร และ restore คืนค่าเดิม', function () {
    const masker = privacy.createMasker([
        { name: 'COMPANY', kind: 'text', pattern: 'บริษัท ทดสอบ จำกัด', enabled: 1 }
    ]);

    const source = 'คู่สัญญา: บริษัท ทดสอบ จำกัด เลขที่ 12';
    const masked = masker.mask(source);

    assert.strictEqual(masked, 'คู่สัญญา: [[COMPANY_1]] เลขที่ 12');
    assert.strictEqual(masker.count, 1);
    assert.strictEqual(masker.restore(masked), source);
});

test('mask ใช้ตัวแปรเดียวกันกับค่าที่ซ้ำกัน และแยกเลขตามชื่อตัวแปร', function () {
    const masker = privacy.createMasker([
        { name: 'WORD', kind: 'text', pattern: 'ทดสอบ', enabled: 1 },
        { name: 'CODE', kind: 'text', pattern: 'AB-1', enabled: 1 }
    ]);

    const masked = masker.mask('ทดสอบ กับ ทดสอบ และ AB-1 กับ AB-1');

    assert.strictEqual(masked, '[[WORD_1]] กับ [[WORD_1]] และ [[CODE_1]] กับ [[CODE_1]]');
    assert.strictEqual(masker.used, 2);
    assert.strictEqual(masker.count, 4);
});

test('mask ใช้กับทั้งข้อความต้นฉบับและบริบทโดยตัวปกปิดตัวเดียวกัน', function () {
    const masker = privacy.createMasker([
        enabled(MONEY)
    ]);

    const text = masker.mask('จำนวนเงิน 4,000.00 บาท');
    const context = masker.mask('--- อ้างอิง ---\nจำนวนเงิน: 4,000.00 บาท');

    // ค่าเดียวกันได้ placeholder เดียวกันทั้งสองก้อน
    assert.strictEqual(text, 'จำนวนเงิน [[MONEY_1]]');
    assert.ok(context.includes('[[MONEY_1]]'));
    assert.strictEqual(masker.used, 1);

    assert.strictEqual(masker.restore(text), 'จำนวนเงิน 4,000.00 บาท');
    assert.ok(masker.restore(context).includes('4,000.00 บาท'));
});

test('preset จำนวนเงินถูกจับก่อนตัวเลข จึงไม่ทับกัน', function () {
    const masker = privacy.createMasker([
        enabled(MONEY),
        enabled(NUMBER)
    ]);

    const source = 'รวม 4,000.00 บาท และ 1234 บาท';
    const masked = masker.mask(source);

    assert.strictEqual(masked, 'รวม [[MONEY_1]] และ [[MONEY_2]]');

    const other = privacy.createMasker([
        enabled(MONEY),
        enabled(NUMBER)
    ]);

    // เลขที่ไม่มีหน่วยเงิน/ไม่มี comma ก็ถูกจับด้วย preset ตัวเลข
    assert.strictEqual(
        other.mask('เลขที่ 702057001 วันที่ 25/10/2569'),
        'เลขที่ [[NUMBER_1]] วันที่ [[NUMBER_2]]/[[NUMBER_3]]/[[NUMBER_4]]'
    );
});

test('preset ชื่อ-นามสกุลจับชื่อที่มีคำนำหน้า', function () {
    const masker = privacy.createMasker([
        enabled(NAME)
    ]);

    const masked = masker.mask('ผู้ยื่น นางสาวทดสอบ ระบบ ลงวันที่ 25/10/2569');

    // คำนำหน้า + ชื่อ + นามสกุล (ไม่กินคำถัดไป เช่น "ลงวันที่")

    assert.strictEqual(masked, 'ผู้ยื่น [[NAME_1]] ลงวันที่ 25/10/2569');
    assert.strictEqual(
        masker.restore(masked),
        'ผู้ยื่น นางสาวทดสอบ ระบบ ลงวันที่ 25/10/2569'
    );
});

test('รายการที่ยังไม่เปิดใช้ไม่ถูกนำมาแทนค่า', function () {
    const masker = privacy.createMasker([
        { name: 'A', kind: 'text', pattern: 'ทดสอบ', enabled: 0 },
        { name: 'B', kind: 'text', pattern: 'ระบบ', enabled: false }
    ]);

    const source = 'ทดสอบ ระบบ';

    assert.strictEqual(masker.mask(source), source);
    assert.strictEqual(masker.count, 0);
});

test('regex ที่เขียนผิดถูกข้ามโดยไม่ทำให้รายการอื่นเสีย', function () {
    const masker = privacy.createMasker([
        { name: 'BAD', kind: 'regex', pattern: '(', enabled: 1 },
        { name: 'GOOD', kind: 'text', pattern: 'ทดสอบ', enabled: 1 }
    ]);

    assert.strictEqual(masker.errors.length, 1);
    assert.match(masker.errors[0].error, /regex ไม่ถูกต้อง/);
    assert.strictEqual(masker.mask('ทดสอบ'), '[[GOOD_1]]');
});

test('regex รองรับรูปแบบ /pattern/flags และ pattern ธรรมดา', function () {
    const masker = privacy.createMasker([
        { name: 'CODE', kind: 'regex', pattern: '/ab-\\d+/i', enabled: 1 }
    ]);

    const masked = masker.mask('AB-12 และ ab-12');

    assert.strictEqual(masked, '[[CODE_1]] และ [[CODE_2]]');
    assert.strictEqual(masker.restore(masked), 'AB-12 และ ab-12');
});

test('regex ใช้กับทุกจุดที่พบในบรรทัดเดียว และข้ามค่าที่จับค่าว่าง', function () {
    const masker = privacy.createMasker([
        { name: 'DIGIT', kind: 'regex', pattern: '\\d+', enabled: 1 },
        { name: 'EMPTY', kind: 'regex', pattern: 'x*', enabled: 1 }
    ]);

    assert.strictEqual(masker.mask('12 และ 34'), '[[DIGIT_1]] และ [[DIGIT_2]]');
});

test('restore ทนช่องว่างที่ AI อาจแทรกในวงเล็บ', function () {
    const masker = privacy.createMasker([
        enabled(MONEY)
    ]);

    const masked = masker.mask('จำนวนเงิน 4,000.00 บาท');

    assert.strictEqual(
        masker.restore(masked.replace('[[MONEY_1]]', '[[ MONEY_1 ]]')),
        'จำนวนเงิน 4,000.00 บาท'
    );

    // ตัวแปรที่ไม่รู้จัก (AI ประดิษฐ์ขึ้น) ต้องคงไว้ตามเดิม ไม่ทำให้ผลลัพธ์พัง
    assert.strictEqual(
        masker.restore('[[UNKNOWN_9]]'),
        '[[UNKNOWN_9]]'
    );
});

test('mask ไม่แก้ค่าข้อความที่รับเข้ามา (คืนสตริงใหม่)', function () {
    const masker = privacy.createMasker([
        enabled(MONEY)
    ]);

    const source = 'จำนวนเงิน 4,000.00 บาท';

    masker.mask(source);

    assert.strictEqual(source, 'จำนวนเงิน 4,000.00 บาท');
});

test('sanitizeName เก็บเฉพาะ A-Z 0-9 _ และมีค่าสำรอง', function () {
    assert.strictEqual(privacy.sanitizeName('money key'), 'MONEY_KEY');
    assert.strictEqual(privacy.sanitizeName('  ชื่อ-นามสกุล  '), 'TERM');
    assert.strictEqual(privacy.sanitizeName(''), 'TERM');
    assert.strictEqual(privacy.sanitizeName(null), 'TERM');
    assert.strictEqual(
        privacy.sanitizeName('a'.repeat(50)).length,
        privacy.MAX_NAME_LENGTH
    );
});

test('validatePattern ตรวจ regex และคำธรรมดา', function () {
    assert.strictEqual(privacy.validatePattern('regex', '/ทดสอบ/i').ok, true);
    assert.strictEqual(privacy.validatePattern('regex', '(').ok, false);
    assert.strictEqual(privacy.validatePattern('text', '(').ok, true);
    assert.strictEqual(privacy.validatePattern('text', '   ').ok, false);
    assert.strictEqual(
        privacy.validatePattern('text', 'ก'.repeat(privacy.MAX_PATTERN_LENGTH + 1)).ok,
        false
    );
});

test('MASK_INSTRUCTION สั่งให้ AI คัดลอกตัวแปรกลับมาให้ครบ', function () {
    assert.ok(privacy.MASK_INSTRUCTION.includes('[['));
    assert.ok(privacy.MASK_INSTRUCTION.includes('ห้ามแก้'));
});

test('buildPrompt แนบคำสั่งเรื่องตัวแปรต่อจากคำสั่งหลัก', function () {
    const prompt = improve.buildPrompt(
        'จำนวนเงิน [[MONEY_1]]',
        '',
        '',
        privacy.MASK_INSTRUCTION
    );

    const instructionAt = prompt.indexOf('คุณเป็นบรรณาธิการข้อความภาษาไทย');
    const maskAt = prompt.indexOf('หมายเหตุสำคัญ — มีการปกปิดข้อมูลอ่อนไหวไว้');
    const sourceAt = prompt.indexOf('ข้อความต้นฉบับ:');

    assert.ok(instructionAt !== -1 && maskAt !== -1 && sourceAt !== -1);
    assert.ok(instructionAt < maskAt && maskAt < sourceAt);

    // ไม่ส่งคำสั่งมา = prompt เหมือนเดิม (ไม่มีการปกปิด)
    assert.ok(
        !improve.buildPrompt('ข้อความ').includes('หมายเหตุสำคัญ')
    );
});

test('improveText ส่งข้อความที่ปกปิดแล้วพร้อมคำสั่ง และคืนค่าที่ main ต้องแทนคืน', async function () {
    const originalFetch = global.fetch;
    let body = null;

    global.fetch = async function (url, init) {
        body = JSON.parse(init.body);

        return {
            ok: true,
            status: 200,
            json: async function () {
                return {
                    candidates: [
                        {
                            content: {
                                parts: [{ text: 'จำนวนเงิน: [[MONEY_1]]' }]
                            }
                        }
                    ]
                };
            }
        };
    };

    try {
        const masker = privacy.createMasker([enabled(MONEY)]);

        const result = await improve.improveText(
            masker.mask('จานวนเงิน 4,000.00 บาท'),
            {
                apiKey: 'test-key',
                contextRawText: masker.mask('ลูกค้า: 4,000.00 บาท'),
                maskInstruction: masker.count > 0 ? privacy.MASK_INSTRUCTION : ''
            }
        );

        const sent = body.contents[0].parts[0].text;

        assert.ok(sent.includes('[[MONEY_1]]'));
        assert.ok(!sent.includes('4,000.00'));
        assert.ok(sent.includes('ห้ามแก้'));

        assert.strictEqual(result.text, 'จำนวนเงิน: [[MONEY_1]]');
        assert.strictEqual(masker.restore(result.text), 'จำนวนเงิน: 4,000.00 บาท');

    } finally {
        global.fetch = originalFetch;
    }
});
