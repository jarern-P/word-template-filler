// เทสต์ค่าตั้ง "ระยะเว้นขอบบน/ล่าง" (cropPaddingY) ที่ตั้งได้จากหน้า ตั้งค่า OCR
// ครอบคลุมการตรวจค่าใน ocr-config และการแปลงค่าของแต่ละเส้นทาง OCR:
//   - ocr-paddle (โหมดปกติ)       → สัดส่วนขอบกล่อง detection
//   - ocr-two-stage               → ขอบครอป (300 DPI) + สัดส่วนขอบกล่อง
//   - pdf-layout                  → ขอบครอปบล็อก (200 DPI)
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const os = require('os');
const path = require('path');

const ocrConfig = require('../src/main/ocr-config.cjs');
const ocrPaddle = require('../src/main/ocr-paddle.cjs');
const twoStage = require('../src/main/ocr-two-stage.cjs');
const pdfLayout = require('../src/main/pdf-layout.cjs');

function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-padding-'));

    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

// ──────────────────────────────────────────────────────────────
// ocr-config — อ่าน/เขียนค่า
// ──────────────────────────────────────────────────────────────

test('ocr-config คืน cropPaddingY เริ่มต้นเมื่อยังไม่เคยตั้งค่า', function () {
    withTempDir(function (dir) {
        const initial = ocrConfig.read(dir);

        assert.strictEqual(initial.cropPaddingY, ocrConfig.DEFAULT_CROP_PADDING_Y);
        assert.strictEqual(initial.cropPaddingY, 16);
        assert.strictEqual(ocrConfig.readSecrets(dir).cropPaddingY, 16);
    });
});

test('ocr-config บันทึก/อ่าน cropPaddingY ที่ตั้งเองได้', function () {
    withTempDir(function (dir) {
        const saved = ocrConfig.save(dir, { cropPaddingY: 30 });

        assert.strictEqual(saved.cropPaddingY, 30);
        assert.strictEqual(ocrConfig.read(dir).cropPaddingY, 30);
        assert.strictEqual(ocrConfig.readSecrets(dir).cropPaddingY, 30);

        // ไม่ส่งค่ามา = คงค่าเดิมที่เก็บไว้
        const again = ocrConfig.save(dir, { provider: 'paddle' });
        assert.strictEqual(again.cropPaddingY, 30);
    });
});

test('ocr-config จำกัด cropPaddingY ให้อยู่ในช่วง 0-48 และรองรับค่าผิดรูป', function () {
    withTempDir(function (dir) {
        assert.strictEqual(ocrConfig.save(dir, { cropPaddingY: 999 }).cropPaddingY, 48);
        assert.strictEqual(ocrConfig.save(dir, { cropPaddingY: -5 }).cropPaddingY, 0);
        assert.strictEqual(ocrConfig.save(dir, { cropPaddingY: 16.6 }).cropPaddingY, 17);
        assert.strictEqual(ocrConfig.save(dir, { cropPaddingY: 'abc' }).cropPaddingY, 16);
        assert.strictEqual(ocrConfig.save(dir, { cropPaddingY: null }).cropPaddingY, 16);
    });
});

test('ocr-config อ่านค่าในไฟล์เก่าที่ยังไม่มี cropPaddingY เป็นค่าเริ่มต้น', function () {
    withTempDir(function (dir) {
        fs.writeFileSync(
            path.join(dir, ocrConfig.CONFIG_FILE),
            JSON.stringify({ version: 2, provider: 'paddle', twoStage: true }),
            'utf8'
        );

        assert.strictEqual(ocrConfig.read(dir).cropPaddingY, 16);
        assert.strictEqual(ocrConfig.readSecrets(dir).cropPaddingY, 16);
    });
});

// ──────────────────────────────────────────────────────────────
// ocr-paddle — โปกติ: แปลง px → สัดส่วนขอบกล่อง detection
// ──────────────────────────────────────────────────────────────

test('verticalPaddingFor แปลง px เป็นสัดส่วนโดยมีค่าเริ่มต้น 16px = 0.6', function () {
    assert.strictEqual(ocrPaddle.verticalPaddingFor(16), 0.6);
    assert.strictEqual(ocrPaddle.verticalPaddingFor(8), 0.3);
    assert.strictEqual(ocrPaddle.verticalPaddingFor(0), 0);

    // จำกัดเพดาน ไม่ให้กล่องใหญ่เกินไปจนบรรทัดข้างเคียงถูกดูดเข้ามา
    assert.strictEqual(ocrPaddle.verticalPaddingFor(32), 1);

    // ค่าผิดรูป = ค่าเริ่มต้น
    assert.strictEqual(ocrPaddle.verticalPaddingFor('abc'), 0.6);
    assert.strictEqual(ocrPaddle.verticalPaddingFor(undefined), 0.6);
    assert.strictEqual(ocrPaddle.verticalPaddingFor(-10), 0);
});

test('setCropPaddingY เปลี่ยนค่าที่ service ใช้จริง และคืนค่าเดิมเมื่อตั้ง 16', function () {
    const before = ocrPaddle.currentVerticalPadding();

    ocrPaddle.setCropPaddingY(24);
    assert.strictEqual(ocrPaddle.currentVerticalPadding(), 0.9);

    ocrPaddle.setCropPaddingY(0);
    assert.strictEqual(ocrPaddle.currentVerticalPadding(), 0);

    // ค่าผิดรูป = กลับเป็นค่าเริ่มต้น
    ocrPaddle.setCropPaddingY('x');
    assert.strictEqual(ocrPaddle.currentVerticalPadding(), 0.6);

    // คืนค่าเดิมก่อนจบเทสต์ (กันค้างไว้ถ้าเพิ่มเทสต์ใหม่ทีหลัง)
    ocrPaddle.setCropPaddingY(before === 0.6 ? 16 : before);
    assert.strictEqual(ocrPaddle.currentVerticalPadding(), before);
});

// ──────────────────────────────────────────────────────────────
// ocr-two-stage — px ที่ ~200 DPI → พิกเซลภาพ ~300 DPI + สัดส่วน detection
// ──────────────────────────────────────────────────────────────

test('resolvePaddingY แปลงเป็นหน่วยของภาพ 300 DPI โดยค่าเริ่มต้นคงพฤติกรรมเดิม', function () {
    const base = twoStage.resolvePaddingY(16);

    assert.strictEqual(base.cropPx, 24);        // 16px × 300/200
    assert.strictEqual(base.detectFraction, 0.45);

    const none = twoStage.resolvePaddingY(undefined);
    assert.deepStrictEqual(none, base);
    assert.deepStrictEqual(twoStage.resolvePaddingY('abc'), base);

    const zero = twoStage.resolvePaddingY(0);
    assert.strictEqual(zero.cropPx, 0);
    assert.strictEqual(zero.detectFraction, 0);

    const max = twoStage.resolvePaddingY(48);
    assert.strictEqual(max.cropPx, 72);
    assert.strictEqual(max.detectFraction, 1);
});

test('resolvePaddingY ขยายตามสัดส่วนเมื่อค่าเพิ่มขึ้น', function () {
    const small = twoStage.resolvePaddingY(8);
    const large = twoStage.resolvePaddingY(32);

    assert.strictEqual(small.cropPx, 12);
    assert.strictEqual(small.detectFraction, 0.225);
    assert.ok(large.cropPx > small.cropPx);
    assert.ok(large.detectFraction > small.detectFraction);
});

// ──────────────────────────────────────────────────────────────
// pdf-layout — หน่วยพิกเซล ~200 DPI (เท่ากับที่ตั้งไว้ในหน้าจอ)
// ──────────────────────────────────────────────────────────────

test('verticalPaddingY ของ pdf-layout คงค่าที่ตั้งและจำกัดช่วง', function () {
    assert.strictEqual(pdfLayout.verticalPaddingY(16), 16);
    assert.strictEqual(pdfLayout.DEFAULT_PADDING_Y, 16);
    assert.strictEqual(pdfLayout.verticalPaddingY(0), 0);
    assert.strictEqual(pdfLayout.verticalPaddingY(48), 48);
    assert.strictEqual(pdfLayout.verticalPaddingY(999), 48);
    assert.strictEqual(pdfLayout.verticalPaddingY(-3), 0);
    assert.strictEqual(pdfLayout.verticalPaddingY(16.4), 16);

    // ค่าที่ไม่ใช่ตัวเลข (ไม่ได้ส่งมา/พิมพ์ผิด) = ค่าเริ่มต้น
    assert.strictEqual(pdfLayout.verticalPaddingY(undefined), 16);
    assert.strictEqual(pdfLayout.verticalPaddingY('abc'), 16);
    assert.strictEqual(pdfLayout.verticalPaddingY(null), 16);
});
