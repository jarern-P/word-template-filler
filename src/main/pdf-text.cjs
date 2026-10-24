// อ่านข้อความจากไฟล์ PDF (ฝั่ง main process)
//
// ทำไมอ่านที่ main process:
//   - pdf.js ต้องใช้ worker ซึ่ง Chromium บล็อกเมื่อหน้าแอปเปิดด้วย file:// (ตัว .exe)
//   - ฝั่ง Node เรียก pdf.js ได้ตรง ๆ โดยไม่ต้อง vendor ไฟล์ worker ลง dist
//
// ผลลัพธ์: ข้อความบรรทัดละบรรทัด (ตามตำแหน่ง y ของข้อความในหน้า)
// ใช้ต่อกับ regex ของแต่ละ field ในหน้าตั้งค่าแม่แบบ
//
// อ่าน "ชั้นข้อความ" ที่ฝังอยู่ในไฟล์เป็นหลัก
// หน้าที่เป็นรูป (ไฟล์สแกน) ไม่มีข้อความให้ดึง → ใช้ OCR ในเครื่องอ่านให้
// (เปิด/ปิดได้จากหน้า "ประวัติและการตั้งค่า" → "ตั้งค่า OCR")

// pdf.js จะ polyfill DOMMatrix/Path2D จากโมดูล `canvas` (node-canvas) ซึ่งคอมไพล์
// ตาม ABI ของ Node ธรรมดา — ใช้ใน Electron ไม่ได้
// เติมจาก @napi-rs/canvas ให้ก่อน pdf.js โหลด เพื่อไม่ให้ pdf.js ไปเรียก `canvas`
let napiCanvas = null;

try {
    napiCanvas = require("@napi-rs/canvas");

    if (!globalThis.DOMMatrix && napiCanvas.DOMMatrix) {
        globalThis.DOMMatrix = napiCanvas.DOMMatrix;
    }

    if (!globalThis.Path2D && napiCanvas.Path2D) {
        globalThis.Path2D = napiCanvas.Path2D;
    }
} catch (error) {
    // ไม่มี canvas = ยังอ่านชั้นข้อความได้ แต่ OCR จะใช้ไม่ได้
    napiCanvas = null;
}

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

const { joinWrappedLines } = require("./line-join.cjs");

let ocrPaddle = null;

function getOcrPaddle() {
    if (!ocrPaddle) {
        ocrPaddle = require("./ocr-paddle.cjs");
    }

    return ocrPaddle;
}

// pdf.js ใช้ canvasFactory เมื่อต้องวาดภาพ/ลายน้ำระหว่างเรนเดอร์หน้า
function createCanvasFactory() {
    if (!napiCanvas) return undefined;

    return {
        create: function (width, height) {
            const canvas = napiCanvas.createCanvas(width, height);

            return {
                canvas: canvas,
                context: canvas.getContext("2d")
            };
        },
        reset: function (canvasAndContext, width, height) {
            canvasAndContext.canvas.width = width;
            canvasAndContext.canvas.height = height;
        },
        destroy: function (canvasAndContext) {
            canvasAndContext.canvas = null;
            canvasAndContext.context = null;
        }
    };
}

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
 *   ocr        = true เพื่อ OCR หน้าที่ไม่มีชั้นข้อความ (ค่าเริ่มต้น = ปิด)
 *   ocrAll     = true เพื่อ OCR ทุกหน้า แม้มีชั้นข้อความอยู่แล้ว
 *   ocrPage    = ฟังก์ชัน OCR หนึ่งหน้า (ไม่ส่ง = ใช้ PaddleOCR ในเครื่อง)
 *                รับ page ของ pdf.js คืน { text, lines }
 *   onProgress = ฟังก์ชันรับความคืบหน้า
 *                { page, pageCount, status: 'reading' | 'ocr' | 'ocr-prepare' }
 * @returns {Promise<{text:string, joined:number, pageCount:number,
 *                    emptyPages:number[], ocrPages:number[], ocrError:string|null}>}
 *   joined     = จำนวนจุดที่เย็บบรรทัดเข้าด้วยกัน
 *   emptyPages = หน้าที่อ่านไม่ได้ทั้งชั้นข้อความและ OCR (ไม่มีข้อความ)
 *   ocrPages   = เลขหน้าที่ใช้ข้อความจาก OCR
 *   ocrError   = ข้อความแจ้งเมื่อ OCR ล้มเหลว (ไม่ทำให้การอ่าน PDF ทั้งไฟล์ล้มเหลว)
 */
async function extractPdfText(data, options) {
    const opts = options || {};
    const joinLines = opts.joinLines !== false;
    const useOcr = opts.ocr === true;
    const ocrAll = opts.ocrAll === true;

    // ผู้ให้บริการ OCR ถูกเลือกที่ main.cjs (PaddleOCR / Gemini / i love api)
    // — ไม่ส่งมา = ใช้ PaddleOCR ในเครื่อง
    const ocrPageFn = typeof opts.ocrPage === "function"
        ? opts.ocrPage
        : function (page) {
            return getOcrPaddle().ocrPage(page);
        };

    const task = pdfjs.getDocument({
        data: new Uint8Array(data),
        // ไม่ต้องเรนเดอร์/โหลดฟอนต์ — ต้องการแค่ข้อความ
        disableFontFace: true,
        isEvalSupported: false,
        useSystemFonts: true,
        canvasFactory: createCanvasFactory()
    });

    const document = await task.promise;
    const pageCount = document.numPages;
    const lines = [];
    const emptyPages = [];
    const ocrPages = [];
    let ocrError = null;

    // เริ่ม OCR ครั้งแรก = อาจต้องโหลดโมเดล (แจ้งหน้าจอให้รอ)
    let ocrPrepared = false;

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

                // หน้าเปล่า (ไม่มีชั้นข้อความ) หรือข้อความเป็นขยะ = ต้องใช้ OCR
                const hasTextLayer =
                    quality.usable &&
                    textLayerLines.length > 0;

                let sourceLines = hasTextLayer ? textLayerLines : [];

                if (useOcr && (ocrAll || !hasTextLayer)) {

                    try {
                        if (!ocrPrepared && typeof opts.onProgress === "function") {
                            opts.onProgress({
                                page: pageNumber,
                                pageCount: document.numPages,
                                status: "ocr-prepare"
                            });
                        }

                        if (typeof opts.onProgress === "function") {
                            opts.onProgress({
                                page: pageNumber,
                                pageCount: document.numPages,
                                status: "ocr",
                                progress: 0
                            });
                        }

                        const ocrResult =
                            await ocrPageFn(page);

                        ocrPrepared = true;

                        if (ocrResult.lines.length > 0) {
                            // OCR อ่านได้ = ใช้ข้อความนี้ (โหมด always = แทนชั้นข้อความเดิม)
                            sourceLines = ocrResult.lines;
                            ocrPages.push(pageNumber);
                        } else if (!hasTextLayer) {
                            ocrError =
                                ocrError ||
                                "OCR อ่านไม่พบข้อความในหน้า " + pageNumber;
                        }

                    } catch (error) {

                        // OCR หน้าเดียวล้มเหลว ไม่ควรทำให้การอ่าน PDF ทั้งไฟล์ล้มเหลว
                        // (หน้าที่มีชั้นข้อความยังใช้ข้อความเดิมได้)
                        ocrError =
                            ocrError ||
                            ((error && error.message) ||
                                "OCR หน้า " + pageNumber + " ไม่สำเร็จ");

                        console.error(
                            "OCR page " + pageNumber + " error:",
                            error
                        );
                    }

                    if (typeof opts.onProgress === "function") {
                        opts.onProgress({
                            page: pageNumber,
                            pageCount: document.numPages,
                            status: "ocr",
                            progress: 1
                        });
                    }
                }

                if (sourceLines.length === 0) {
                    emptyPages.push(pageNumber);
                    continue;
                }

                const result = joinLines
                    ? joinWrappedLines(sourceLines)
                    : {
                        lines: sourceLines.map(function (line) {
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
        joined: joinedCount,
        pageCount: pageCount,
        emptyPages: emptyPages,
        ocrPages: ocrPages,
        ocrError: ocrError
    };
}

module.exports = {
    extractPdfText: extractPdfText
};
