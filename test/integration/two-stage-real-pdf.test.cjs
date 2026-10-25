// Integration test: Two-Stage Localized OCR กับไฟล์ PDF สแกนจริงในโปรเจกต์
//
// ไฟล์ตัวอย่าง: docs/layout-preview/1360137-101406-21-10-2026t11_44_38.pdf
// (ใบเบิกเงิน 1 หน้า ไม่มีชั้นข้อความ มีตาราง 2 ตารางและลายเซ็น)
//
// ต้องมีโมเดล PP-OCRv5 ในเครื่อง (หน้า ตั้งค่า OCR → เตรียมโมเดล OCR)
// ถ้าไม่มีโมเดลหรือไฟล์ตัวอย่าง เทสต์จะถูกข้ามโดยไม่ทำให้ชุดทดสอบล้มเหลว
//
// รันด้วย: npm run test:integration (ใช้เวลา ~15 วินาที)
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { extractPdfText } = require('../../src/main/pdf-text.cjs');
const ocrPaddle = require('../../src/main/ocr-paddle.cjs');
const twoStage = require('../../src/main/ocr-two-stage.cjs');

const PDF_PATH = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'layout-preview',
    '1360137-101406-21-10-2026t11_44_38.pdf'
);

function skipReason() {
    if (!fs.existsSync(PDF_PATH)) {
        return 'ไม่พบไฟล์ PDF ตัวอย่าง: ' + PDF_PATH;
    }

    const status = ocrPaddle.status();

    if (!status.ready) {
        return 'ยังใช้ OCR ในเครื่องไม่ได้ (ขาดไลบรารี)';
    }

    if (!status.modelsCached) {
        return 'ยังไม่มีโมเดล OCR ในเครื่อง — กด "เตรียมโมเดล OCR" ที่หน้าตั้งค่า OCR ก่อน';
    }

    return false;
}

test(
    'อ่านใบเบิกเงินที่สแกนได้ครบทั้งหัวเรื่องและตาราง',
    // OCR บน CPU ใช้เวลาหลายวินาที — เผื่อ timeout มากกว่าปกติ
    { skip: skipReason(), timeout: 5 * 60 * 1000 },
    async function () {
        const result = await extractPdfText(
            fs.readFileSync(PDF_PATH),
            {
                ocr: true,
                ocrPage: function (page) {
                    return twoStage.ocrPage(page);
                }
            }
        );

        assert.equal(result.pageCount, 1);
        assert.deepEqual(result.ocrPages, [1]);
        assert.equal(result.ocrError, null);

        const text = result.text;

        // ── หัวเอกสาร ──
        assert.match(text, /มหาวิทยาลัยทักษิณ/);
        assert.match(text, /AP05000000270100045/);
        assert.match(text, /แบบขออนมัติเบิกเงิน/);

        // ── ตารางที่ 1: หัวตารางและข้อมูลแถวแรก ──
        assert.match(text, /เลขที?เอกสาร/);
        assert.match(text, /ค่าธรรมเนียม/);
        assert.match(text, /RC05000000270100046/);
        assert.match(text, /4,000\.00/);

        // ── ตารางที่ 2: รายละเอียดค่าใช้จ่าย ──
        assert.match(text, /คำอธิบายรายการ/);
        assert.match(text, /702057001/);

        // ── ลายเซ็น/ผู้ตรวจสอบ ──
        assert.match(text, /ผู้ตรวจสอบ\s*1/);
        assert.match(text, /ผู้ตรวจสอบ\s*2/);
        assert.match(text, /หน้า 1 จาก 1/);

        // ── ลำดับแถวของตาราง: หัวตารางต้องมาก่อนข้อมูล ──
        // (OCR อาจอ่าน "เลขที่" เป็น "เลขที" — ค้นด้วย regex เพื่อไม่ให้เปราะ)
        const tableHeaderIndex = text.search(/เลขที?เอกสาร/);
        const firstRowIndex = text.indexOf('RC05000000270100046');

        assert.ok(tableHeaderIndex >= 0);
        assert.ok(
            tableHeaderIndex < firstRowIndex,
            'หัวตารางต้องอยู่ก่อนข้อมูลแถวแรก'
        );

        assert.ok(
            text.indexOf('คำอธิบายรายการ') < text.indexOf('702057001'),
            'หัวตารางที่ 2 ต้องอยู่ก่อนเลขที่ใบส่งของ'
        );

        // ── ตัวกรองเศษขยะ: ข้อความจากโลโก้/ลายเซ็น/เส้นตารางต้องไม่หลุดมา ──
        [
            'yh as',
            'LM 98L',
            '8 00 น น น น'
        ].forEach(function (junk) {
            assert.equal(
                text.includes(junk),
                false,
                'ไม่ควรมีเศษขยะ: ' + junk
            );
        });
    }
);
