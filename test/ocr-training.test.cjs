// เทสต์คลังฝึก OCR — เก็บ/แก้/ข้าม/ลบ และสร้างคู่ตัวอย่าง few-shot
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const os = require('os');
const path = require('path');

const training = require('../src/main/ocr-training.cjs');

function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-training-'));

    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('addLines เก็บบรรทัด ตัดช่องว่าง และข้ามบรรทัดสั้น', function () {
    withTempDir(function (dir) {
        const result = training.addLines(dir, 'invoice.pdf', [
            '  จำนวนเงน 4,000.00 บาท  ',
            'ab',
            '',
            '   ',
            'วันที่ 25/10/2569'
        ]);

        assert.strictEqual(result.added, 2);
        assert.strictEqual(result.skipped, 3);

        const store = training.load(dir);

        assert.strictEqual(store.lines.length, 2);
        assert.strictEqual(store.lines[0].input, 'จำนวนเงน 4,000.00 บาท');
        assert.strictEqual(store.lines[0].source, 'invoice.pdf');
        assert.strictEqual(store.lines[0].status, 'new');
        assert.strictEqual(store.lines[0].output, '');
        assert.ok(store.lines[0].id !== '');
    });
});

test('addLines ข้ามบรรทัดซ้ำ (ไม่สนช่องว่าง/ตัวพิมพ์)', function () {
    withTempDir(function (dir) {
        training.addLines(dir, 'a.pdf', ['เลขที่ 702057001']);

        const result = training.addLines(dir, 'b.pdf', [
            'เลขที่  702057001',
            'เลขที่ 702057001',
            'บรรทัดใหม่'
        ]);

        assert.strictEqual(result.added, 1);
        assert.strictEqual(result.duplicates, 2);
        assert.strictEqual(training.load(dir).lines.length, 2);
    });
});

test('saveCorrection บันทึกคู่ผิด → ถูก และ examples คืนเฉพาะที่ฝึกแล้ว', function () {
    withTempDir(function (dir) {
        training.addLines(dir, 'a.pdf', [
            'จา นวนเงนิ 4,000.00 บาท',
            'บรรทัดที่ยังไม่แก้'
        ]);

        const store = training.load(dir);
        const target = store.lines[0];

        const saved = training.saveCorrection(
            dir,
            target.id,
            'จำนวนเงิน 4,000.00 บาท'
        );

        assert.strictEqual(saved.status, 'trained');
        assert.strictEqual(saved.output, 'จำนวนเงิน 4,000.00 บาท');

        assert.deepStrictEqual(training.examples(dir), [
            {
                input: 'จา นวนเงนิ 4,000.00 บาท',
                output: 'จำนวนเงิน 4,000.00 บาท'
            }
        ]);
    });
});

test('saveCorrection ปฏิเสธข้อความว่างหรือเหมือนต้นฉบับ', function () {
    withTempDir(function (dir) {
        training.addLines(dir, 'a.pdf', ['จา นวนเงนิ']);

        const id = training.load(dir).lines[0].id;

        assert.throws(function () {
            training.saveCorrection(dir, id, '   ');
        }, /พิมพ์ข้อความที่ถูกต้อง/);

        assert.throws(function () {
            training.saveCorrection(dir, id, 'จา นวนเงนิ');
        }, /เหมือนต้นฉบับ/);

        assert.strictEqual(
            training.load(dir).lines[0].status,
            'new'
        );
    });
});

test('skip ล้างคำตอบและตัดออกจาก examples, restore นำกลับมารอตรวจ', function () {
    withTempDir(function (dir) {
        training.addLines(dir, 'a.pdf', ['จา นวนเงนิ']);
        const id = training.load(dir).lines[0].id;

        training.saveCorrection(dir, id, 'จำนวนเงิน');

        training.setStatus(dir, id, 'skipped');
        assert.strictEqual(training.load(dir).lines[0].output, '');
        assert.deepStrictEqual(training.examples(dir), []);

        training.setStatus(dir, id, 'new');
        assert.strictEqual(training.load(dir).lines[0].status, 'new');
        assert.deepStrictEqual(training.examples(dir), []);
    });
});

test('remove ลบบรรทัดออกจากคลัง', function () {
    withTempDir(function (dir) {
        training.addLines(dir, 'a.pdf', ['หนึ่ง', 'สอง']);

        const id = training.load(dir).lines[0].id;
        const result = training.remove(dir, id);

        assert.strictEqual(result.total, 1);
        assert.strictEqual(training.load(dir).lines.length, 1);
    });
});

test('addManual บันทึกทั้ง target และคำที่ต้องการเป็นคู่ฝึกทันที', function () {
    withTempDir(function (dir) {
        const result = training.addManual(
            dir,
            'เอกสารระเบียบฯ',
            ' จา นวนเงนิ  4,000.00 บาท ',
            'จำนวนเงิน 4,000.00 บาท'
        );

        assert.strictEqual(result.added, 1);
        assert.strictEqual(result.updated, 0);

        const line = training.load(dir).lines[0];

        assert.strictEqual(line.input, 'จา นวนเงนิ 4,000.00 บาท');
        assert.strictEqual(line.output, 'จำนวนเงิน 4,000.00 บาท');
        assert.strictEqual(line.status, 'trained');
        assert.strictEqual(line.source, 'เอกสารระเบียบฯ');

        assert.deepStrictEqual(training.examples(dir), [
            {
                input: 'จา นวนเงนิ 4,000.00 บาท',
                output: 'จำนวนเงิน 4,000.00 บาท'
            }
        ]);
    });
});

test('addManual ไม่ใส่คำที่ต้องการ = เข้าคิวรอตรวจ, และเติมทีหลังได้', function () {
    withTempDir(function (dir) {
        training.addManual(dir, '', 'ผตู้ รวจสอบ');

        const pending = training.load(dir).lines[0];

        assert.strictEqual(pending.status, 'new');
        assert.strictEqual(pending.output, '');
        assert.strictEqual(pending.source, 'เพิ่มเอง');
        assert.deepStrictEqual(training.examples(dir), []);

        // ใส่ target เดิมพร้อมคำที่ต้องการ = อัปเดตคู่นั้น ไม่เพิ่มซ้ำ
        const result = training.addManual(
            dir,
            '',
            'ผตู้ รวจสอบ',
            'ผู้ตรวจสอบ'
        );

        assert.strictEqual(result.added, 0);
        assert.strictEqual(result.updated, 1);
        assert.strictEqual(training.load(dir).lines.length, 1);
        assert.strictEqual(
            training.list(dir, { status: 'trained' }).lines[0].output,
            'ผู้ตรวจสอบ'
        );
    });
});

test('addManual ปฏิเสธข้อความสั้นและคำที่ต้องการที่เหมือนต้นฉบับ', function () {
    withTempDir(function (dir) {
        assert.throws(function () {
            training.addManual(dir, '', 'ab', 'เอบี');
        }, /สั้นเกินไป/);

        assert.throws(function () {
            training.addManual(dir, '', 'จา นวนเงนิ', 'จา นวนเงนิ');
        }, /เหมือนต้นฉบับ/);

        assert.strictEqual(training.load(dir).lines.length, 0);
    });
});

test('list กรองตามสถานะ ค้นหา และจำกัดจำนวน', function () {
    withTempDir(function (dir) {
        training.addLines(dir, 'invoice.pdf', ['จา นวนเงนิ', 'วันที่']);
        training.addLines(dir, 'letter.pdf', ['ผตู้ รวจสอบ']);

        const store = training.load(dir);
        const first = store.lines.find(function (line) {
            return line.input === 'จา นวนเงนิ';
        });

        training.saveCorrection(dir, first.id, 'จำนวนเงิน');

        const trained = training.list(dir, { status: 'trained' });
        assert.strictEqual(trained.matched, 1);
        assert.strictEqual(trained.lines[0].output, 'จำนวนเงิน');
        assert.strictEqual(trained.stats.total, 3);
        assert.strictEqual(trained.stats.trained, 1);
        assert.strictEqual(trained.stats.new, 2);

        const searched = training.list(dir, { status: 'all', search: 'letter' });
        assert.strictEqual(searched.matched, 1);
        assert.strictEqual(searched.lines[0].input, 'ผตู้ รวจสอบ');

        const limited = training.list(dir, { status: 'all', limit: 1 });
        assert.strictEqual(limited.shown, 1);
        assert.strictEqual(limited.matched, 3);
    });
});

test('load ไฟล์เสียหรือผิดรูปแบบคืนคลังว่าง', function () {
    withTempDir(function (dir) {
        fs.writeFileSync(path.join(dir, 'ocr-training.json'), '{ ไม่ใช่ json');

        assert.deepStrictEqual(training.load(dir).lines, []);

        fs.writeFileSync(
            path.join(dir, 'ocr-training.json'),
            JSON.stringify({ lines: 'ผิด' })
        );

        assert.deepStrictEqual(training.load(dir).lines, []);
    });
});
