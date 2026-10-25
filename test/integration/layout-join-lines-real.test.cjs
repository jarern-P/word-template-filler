// เทสต์ integration: ตัวเลือก joinLines ของ pdf:layout
//
// สร้าง PDF เล็ก ๆ ที่มีประโยคถูกตัดขึ้นบรรทัดใหม่ แล้วตรวจว่า
//   joinLines = true  -> ข้อความในบล็อกถูกเย็บเป็นบรรทัดเดียว
//   joinLines = false -> ยังแยกสองบรรทัดตามต้นฉบับ
//
// ต้องมีโมเดล PP-DocLayoutV2 (~213 MB) — ถ้ายังไม่มีจะข้ามอัตโนมัติ
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const pdfLayout = require('../../src/main/pdf-layout.cjs');

const DATA_PATH = 'data';

const state = pdfLayout.status(DATA_PATH);

// PDF น้อยที่สุด: หนึ่งหน้า ข้อความ Helvetica สองบรรทัดที่ต่อกันเป็นประโยคเดียว
function buildPdf() {
    const content = [
        'BT',
        '/F1 12 Tf',
        '72 700 Td',
        '(This is a long sentence that was wrapped) Tj',
        '0 -16 Td',
        '(across two lines in the PDF.) Tj',
        'ET'
    ].join('\n');

    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
            '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
        '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' +
            content + '\nendstream',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [];

    objects.forEach(function (body, index) {
        offsets.push(Buffer.byteLength(pdf));
        pdf += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
    });

    const xrefOffset = Buffer.byteLength(pdf);

    pdf += 'xref\n0 ' + (objects.length + 1) + '\n';
    pdf += '0000000000 65535 f \n';

    offsets.forEach(function (offset) {
        pdf += String(offset).padStart(10, '0') + ' 00000 n \n';
    });

    pdf += 'trailer\n<< /Size ' + (objects.length + 1) +
        ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';

    return Buffer.from(pdf, 'binary');
}

test(
    'pdf:layout รวมบรรทัดที่ถูกตัดเมื่อ joinLines = true',
    {
        skip: state.ready ? false : 'ยังไม่มีโมเดล PP-DocLayoutV2 ในเครื่อง',
        timeout: 5 * 60 * 1000
    },
    async function () {
        try {
            const data = buildPdf();

            const plain = await pdfLayout.analyzePdf(data, {
                dataPath: DATA_PATH,
                joinLines: false
            });

            const joined = await pdfLayout.analyzePdf(data, {
                dataPath: DATA_PATH,
                joinLines: true
            });

            assert.strictEqual(plain.pageCount, 1);
            assert.strictEqual(joined.pageCount, 1);

            assert.ok(
                plain.text.includes('\n'),
                'แบบไม่เย็บต้องยังมีบรรทัดใหม่: ' + JSON.stringify(plain.text)
            );

            assert.strictEqual(
                joined.text,
                'This is a long sentence that was wrapped ' +
                'across two lines in the PDF.'
            );

        } finally {
            pdfLayout.stop();
        }
    }
);
