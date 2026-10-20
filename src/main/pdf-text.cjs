// อ่านข้อความจากไฟล์ PDF (ฝั่ง main process)
//
// ทำไมอ่านที่ main process:
//   - pdf.js ต้องใช้ worker ซึ่ง Chromium บล็อกเมื่อหน้าแอปเปิดด้วย file:// (ตัว .exe)
//   - ฝั่ง Node ไม่ต้องใช้ worker/ไฟล์เสริม จึงไม่ต้อง vendor ไฟล์เพิ่มใน dist
//
// ผลลัพธ์: ข้อความบรรทัดละบรรทัด (ตามตำแหน่ง y ของข้อความในหน้า)
// ใช้ต่อกับ regex ของแต่ละ field ในหน้าตั้งค่าแม่แบบ
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

// ระยะห่างแนวนอน (หน่วย pt) ที่ถือว่าเป็น "ช่องว่างระหว่างคำ"
// น้อยกว่านี้ = ตัวอักษรต่อกัน (PDF ไทยมักแยกข้อความเป็นชิ้นเล็ก ๆ)
const WORD_GAP = 1.2;

// ระยะห่างแนวตั้งที่ถือว่าเป็นคนละบรรทัด
function lineTolerance(item) {
    const height = Number(item.height);

    return Math.max(2, (isFinite(height) && height > 0 ? height : 10) * 0.4);
}

// รวมชิ้นข้อความของหน้าเป็นบรรทัด (เรียงซ้าย → ขวา)
function pageLines(items) {
    const lines = [];

    items.forEach(function (item) {
        const text = item && typeof item.str === "string" ? item.str : "";

        if (text === "") return;

        const transform = item.transform || [];
        const x = Number(transform[4]) || 0;
        const y = Number(transform[5]) || 0;

        let line = lines.length > 0 ? lines[lines.length - 1] : null;
        const tolerance = lineTolerance(item);

        if (!line || Math.abs(line.y - y) > tolerance) {
            line = { y: y, parts: [] };
            lines.push(line);
        }

        line.parts.push({
            x: x,
            width: Number(item.width) || 0,
            text: text
        });
    });

    return lines
        .map(function (line) {
            line.parts.sort(function (a, b) {
                return a.x - b.x;
            });

            let text = "";
            let previousEnd = null;

            line.parts.forEach(function (part) {
                if (previousEnd !== null) {
                    const gap = part.x - previousEnd;

                    // เติมช่องว่างเฉพาะเมื่อมีช่องว่างจริงในเอกสาร
                    if (
                        gap > WORD_GAP &&
                        !/\s$/.test(text) &&
                        !/^\s/.test(part.text)
                    ) {
                        text += " ";
                    }
                }

                text += part.text;
                previousEnd = part.x + part.width;
            });

            return text
                .replace(/\u00a0/g, " ")
                .replace(/[ \t]+/g, " ")
                .replace(/[\u200b\u200e\u200f\ufeff]/g, "")
                .trim();
        })
        .filter(function (text) {
            return text !== "";
        });
}

/**
 * อ่านข้อความทุกหน้าของ PDF
 * @param {Uint8Array|Buffer} data เนื้อไฟล์ PDF
 * @returns {Promise<string>} ข้อความ (บรรทัดละบรรทัด)
 */
async function extractPdfText(data) {
    const task = pdfjs.getDocument({
        data: new Uint8Array(data),
        // ไม่ต้องเรนเดอร์/โหลดฟอนต์ — ต้องการแค่ข้อความ
        disableFontFace: true,
        isEvalSupported: false,
        useSystemFonts: true
    });

    const document = await task.promise;
    const lines = [];

    try {
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
            const page = await document.getPage(pageNumber);

            try {
                const content = await page.getTextContent();

                pageLines(content.items || []).forEach(function (text) {
                    lines.push(text);
                });
            } finally {
                page.cleanup();
            }
        }
    } finally {
        await document.destroy();
    }

    return lines.join("\n");
}

module.exports = {
    extractPdfText: extractPdfText
};
