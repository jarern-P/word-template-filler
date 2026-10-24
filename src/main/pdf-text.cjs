// อ่านข้อความจากไฟล์ PDF (ฝั่ง main process)
//
// ทำไมอ่านที่ main process:
//   - pdf.js ต้องใช้ worker ซึ่ง Chromium บล็อกเมื่อหน้าแอปเปิดด้วย file:// (ตัว .exe)
//   - ฝั่ง Node เรียก pdf.js ได้ตรง ๆ โดยไม่ต้อง vendor ไฟล์ worker ลง dist
//
// ผลลัพธ์: ข้อความบรรทัดละบรรทัด (ตามตำแหน่ง y ของข้อความในหน้า)
// ใช้ต่อกับ regex ของแต่ละ field ในหน้าตั้งค่าแม่แบบ
//
// อ่านเฉพาะ "ชั้นข้อความ" ที่ฝังอยู่ในไฟล์เท่านั้น
// หน้าที่เป็นรูป (ไฟล์สแกน) ไม่มีข้อความให้ดึง หน้านั้นจึงได้ข้อความว่าง
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

const { joinWrappedLines } = require("./line-join.cjs");

// PDF ที่พิมพ์จากโปรแกรมบางตัว (หรือสแกนแล้วฝังชั้นข้อความไว้)
// ข้อความที่ได้จะเป็นรหัส glyph ของฟอนต์ Type3 ไม่ใช่ตัวอักษรจริง
// เช่น "HIJK@+*L,-+4M4NO4P" หรือมีอักขระควบคุมปนมา → ใช้กับ regex ไม่ได้
// หน้าที่ข้อความเป็นขยะแบบนี้จะถูกตัดทิ้ง (ไม่ส่งต่อให้ regex จับมั่ว)
const MAX_BAD_CHAR_RATIO = 0.02;
const MIN_LETTER_RATIO = 0.4;
const BAD_CHARS = /[\u0000-\u001f\u007f-\u009f\ue000-\uf8ff\ufffd]/g;
const LETTER_CHARS = /[0-9A-Za-z\u0E00-\u0E7F]/g;

// ข้อความที่ดึงจากชั้นข้อความของหน้านี้ใช้ได้จริงหรือไม่
function textUsability(text) {
    const chars = String(text || "").replace(/\s/g, "");

    if (chars.length === 0) {
        return {
            length: 0,
            usable: false
        };
    }

    const bad = (chars.match(BAD_CHARS) || []).length;
    const letters = (chars.match(LETTER_CHARS) || []).length;

    return {
        length: chars.length,
        usable:
            bad / chars.length <= MAX_BAD_CHAR_RATIO &&
            letters / chars.length >= MIN_LETTER_RATIO
    };
}

// ระยะห่างแนวนอน (หน่วย pt) ที่ถือว่าเป็น "ช่องว่างระหว่างคำ"
// น้อยกว่านี้ = ตัวอักษรต่อกัน (PDF ไทยมักแยกข้อความเป็นชิ้นเล็ก ๆ)
const WORD_GAP = 1.2;

// ระยะห่างแนวตั้งที่ถือว่าเป็นคนละบรรทัด
function lineTolerance(item) {
    const height = Number(item.height);

    return Math.max(2, (isFinite(height) && height > 0 ? height : 10) * 0.4);
}

// รวมชิ้นข้อความของหน้าเป็นบรรทัด (เรียงซ้าย → ขวา)
//
// คืนพิกัดของแต่ละบรรทัดด้วย (left/right/top/bottom) — line-join.cjs ใช้ตัดสินว่า
// บรรทัดนี้ถูกตัดขึ้นบรรทัดใหม่เพราะหมดความกว้าง หรือเป็นย่อหน้าใหม่จริง
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
            height: Number(item.height) || 0,
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

            const raw = text
                .replace(/\u00a0/g, " ")
                .replace(/[ \t]+/g, " ")
                .replace(/[\u200b\u200e\u200f\ufeff]/g, "");

            const left = Math.min.apply(null, line.parts.map(function (part) {
                return part.x;
            }));

            const right = Math.max.apply(null, line.parts.map(function (part) {
                return part.x + part.width;
            }));

            // ความสูงของบรรทัด = ตัวอักษรที่สูงที่สุด (สระบน/วรรณยุกต์)
            const height = Math.max.apply(null, line.parts.map(function (part) {
                return part.height;
            }));

            return {
                text: raw.trim(),
                left: left,
                right: right,
                // กลับทิศ y ของ PDF (เพิ่มขึ้น = ลงล่าง) ให้เทียบระยะบรรทัดง่าย
                top: -line.y,
                bottom: -line.y + (height || 0),
                // ต้นฉบับมีช่องว่างท้ายบรรทัดหรือไม่ — ใช้ตอนต่อข้อความ
                hadSpaceAfter: /\s$/.test(raw)
            };
        })
        .filter(function (line) {
            return line.text !== "";
        });
}

/**
 * อ่านข้อความทุกหน้าของ PDF (เฉพาะชั้นข้อความในไฟล์)
 *
 * หน้าที่ไม่มีชั้นข้อความ (ไฟล์สแกน) หรือข้อความที่ได้เป็นขยะ
 * จะถูกข้ามไป (ไม่มีข้อความของหน้านั้นในผลลัพธ์)
 *
 * @param {Uint8Array|Buffer} data เนื้อไฟล์ PDF
 * @param {Object} [options]
 *   joinLines  = false เพื่อไม่เย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่ (ค่าเริ่มต้น = เย็บ)
 *   onProgress = ฟังก์ชันรับความคืบหน้า { page, pageCount, status: 'reading' }
 * @returns {Promise<{text:string, joined:number}>}
 *   joined = จำนวนจุดที่เย็บบรรทัดเข้าด้วยกัน
 */
async function extractPdfText(data, options) {
    const opts = options || {};
    const joinLines = opts.joinLines !== false;

    const task = pdfjs.getDocument({
        data: new Uint8Array(data),
        // ไม่ต้องเรนเดอร์/โหลดฟอนต์ — ต้องการแค่ข้อความ
        disableFontFace: true,
        isEvalSupported: false,
        useSystemFonts: true
    });

    const document = await task.promise;
    const lines = [];

    // จำนวนจุดที่เย็บบรรทัด (รายงานให้หน้าจอรู้ว่าทำอะไรไปบ้าง)
    let joinedCount = 0;

    try {
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
            const page = await document.getPage(pageNumber);

            try {
                if (typeof opts.onProgress === "function") {
                    opts.onProgress({
                        page: pageNumber,
                        pageCount: document.numPages,
                        status: "reading"
                    });
                }

                // บรรทัดจากชั้นข้อความ พร้อมพิกัด (ใช้เย็บบรรทัดที่ถูกตัด)
                let textLayerLines = [];

                try {
                    const content = await page.getTextContent();

                    textLayerLines = pageLines(content.items || []);
                } catch (error) {
                    // อ่านชั้นข้อความไม่ได้ของหน้านี้ = ข้ามหน้านี้ไป
                    textLayerLines = [];
                }

                const pageText = textLayerLines
                    .map(function (line) {
                        return line.text;
                    })
                    .join("\n");

                const quality = textUsability(pageText);

                // หน้าเปล่า (ไม่มีชั้นข้อความ) หรือข้อความเป็นขยะ = ไม่นำไปใช้
                if (!quality.usable || textLayerLines.length === 0) {
                    continue;
                }

                const result = joinLines
                    ? joinWrappedLines(textLayerLines)
                    : {
                        lines: textLayerLines.map(function (line) {
                            return line.text;
                        }),
                        joined: 0
                    };

                joinedCount += result.joined;

                const text = result.lines.join("\n");

                if (text !== "") lines.push(text);

            } finally {
                page.cleanup();
            }
        }
    } finally {
        await document.destroy();
    }

    return {
        text: lines.join("\n"),
        joined: joinedCount
    };
}

module.exports = {
    extractPdfText: extractPdfText
};
