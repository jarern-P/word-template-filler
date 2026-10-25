// เทสต์ integration: ปรับข้อความหลัง OCR ด้วย Qwen2.5-3B-Instruct ในเครื่อง
//
// ต้องมีโมเดล (~2 GB) ใน data/post-ocr — ถ้ายังไม่มีจะข้ามอัตโนมัติ
// (ดาวน์โหลดได้ที่ ตั้งค่า OCR › หลัง OCR)
//
// รันด้วย: npm run test:integration  (ใช้เวลาราว 15–60 วิ ขึ้นกับ CPU)
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const postOcr = require('../../src/main/post-ocr.cjs');
const local = require('../../src/main/post-ocr-local.cjs');

const DATA_PATH = 'data';

const state = local.status(DATA_PATH);

const SOURCE = [
    'เลขท่ีใบส่งของ 702057001 วนั ที่ 25/10/2569',
    'จา นวนเงนิ 4,000.00 บาทถวน้',
    'ผตู้ รวจสอบ 1 นางภาวนิ ี บุญสนทิ'
].join('\n');

test(
    'Local AI แก้คำผิดและแบ่งประโยคด้วย Qwen2.5-3B ในเครื่อง',
    {
        skip: state.ready
            ? false
            : 'ยังไม่มีโมเดล Qwen2.5-3B ในเครื่อง (data/post-ocr)',
        timeout: 5 * 60 * 1000
    },
    async function () {
        try {
            const result = await postOcr.processText(SOURCE, {
                engine: 'local',
                dataPath: DATA_PATH
            });

            assert.strictEqual(result.engine, 'local');
            assert.deepStrictEqual(result.warnings, []);

            // แก้คำที่ OCR อ่านผิด
            assert.ok(result.text.includes('เลขที่ใบส่งของ 702057001'));
            assert.ok(result.text.includes('จำนวนเงิน 4,000.00 บาทถ้วน'));
            assert.ok(result.text.includes('ผู้ตรวจสอบ 1'));
            assert.ok(result.text.includes('นางภาวินี บุญสนิท'));

            // แบ่งประโยคเป็นบรรทัด (ต้นฉบับมี 3 บรรทัด แต่มี 4 ประโยค)
            assert.ok(
                result.sentences >= 4,
                'ต้องแบ่งประโยคได้อย่างน้อย 4 ประโยค แต่ได้ ' +
                result.sentences
            );

            // ตัวเลขและรหัสต้องอยู่ครบ
            assert.ok(/702057001/.test(result.text));
            assert.ok(/4,000\.00/.test(result.text));
            assert.ok(/25\/10\/2569/.test(result.text));

        } finally {
            local.stop();
        }
    }
);
