// เทสต์การจับคู่ คีย์ → ค่า (Key-Value Pair Extraction)
//   public/dataExtract.js — keyValuePairs() / keyValueText()
//   ใช้ตอนกด "ปรับปรุง" ในกล่องข้อมูล (เขียนข้อความใหม่เป็น "field: ค่า")
'use strict';

const test = require('node:test');
const assert = require('node:assert');

global.window = {};
require('../public/dataExtract.js');

const DataExtract = global.window.DataExtract;

test('keyValuePairs จับค่าตาม regex ของแต่ละคีย์', function () {
    const pairs = DataExtract.keyValuePairs(
        'เลขที่ 123/2569\nวันที่ 1 ตุลาคม 2569\nผู้รับ ฝ่ายการเงิน',
        {
            'เลขที่': 'เลขที่\\s*([^\\n]+)',
            'วันที่': 'วันที่\\s*([^\\n]+)',
            'ผู้รับ': 'ผู้รับ\\s*([^\\n]+)'
        }
    );

    assert.deepEqual(pairs, [
        { key: 'เลขที่', value: '123/2569', error: null },
        { key: 'วันที่', value: '1 ตุลาคม 2569', error: null },
        { key: 'ผู้รับ', value: 'ฝ่ายการเงิน', error: null }
    ]);
});

test('keyValuePairs คืนค่าเดียวว่างเมื่อไม่พบ และไม่สน regex ที่ว่าง', function () {
    const pairs = DataExtract.keyValuePairs('วันที่ 1 ต.ค. 2569', {
        'วันที่': 'วันที่\\s*([^\\n]+)',
        'เลขที่': 'เลขที่\\s*([^\\n]+)',
        'ว่าง': '   '
    });

    assert.deepEqual(pairs, [
        { key: 'วันที่', value: '1 ต.ค. 2569', error: null },
        { key: 'เลขที่', value: '', error: null }
    ]);
});

test('keyValuePairs รายงาน regex ที่ไม่ถูกต้องโดยไม่ทำให้คู่อื่นพัง', function () {
    const pairs = DataExtract.keyValuePairs('เลขที่ 123', {
        'เลขที่': 'เลขที่\\s*([^\\n]+)',
        'เสีย': '(('
    });

    assert.equal(pairs[0].value, '123');
    assert.equal(pairs[1].key, 'เสีย');
    assert.equal(pairs[1].value, '');
    assert.ok(pairs[1].error);
});

test('keyValueText เขียนเฉพาะคู่ที่จับได้เป็น "field: ค่า" ทีละบรรทัด', function () {
    const result = DataExtract.keyValueText(
        'เลขที่ 123/2569\nวันที่ 1 ตุลาคม 2569\nผู้รับ ฝ่ายการเงิน',
        {
            'เลขที่': 'เลขที่\\s*([^\\n]+)',
            'วันที่': 'วันที่\\s*([^\\n]+)',
            'ผู้รับ': 'ไม่พบ\\s*([^\\n]+)'
        }
    );

    assert.equal(result.found, 2);
    assert.equal(result.total, 3);
    assert.equal(
        result.text,
        'เลขที่: 123/2569\nวันที่: 1 ตุลาคม 2569'
    );
    assert.deepEqual(result.errors, []);
});

test('keyValueText รวมค่าที่มีขึ้นบรรทัดใหม่ให้อยู่บรรทัดเดียว', function () {
    const result = DataExtract.keyValueText('ที่อยู่ 99/1\nถนนทดสอบ', {
        'ที่อยู่': 'ที่อยู่\\s*([\\s\\S]+)'
    });

    assert.equal(result.text, 'ที่อยู่: 99/1 ถนนทดสอบ');
});

test('keyValueText คืนข้อความว่างเมื่อไม่พบค่าเลย', function () {
    const result = DataExtract.keyValueText('ข้อความอื่น', {
        'เลขที่': 'เลขที่\\s*([^\\n]+)'
    });

    assert.equal(result.found, 0);
    assert.equal(result.text, '');
});
