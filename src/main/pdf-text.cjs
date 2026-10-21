// อ่านข้อความจากไฟล์ PDF (ฝั่ง main process)
//
// ทำไมอ่านที่ main process:
//   - pdf.js ต้องใช้ worker ซึ่ง Chromium บล็อกเมื่อหน้าแอปเปิดด้วย file:// (ตัว .exe)
//   - ฝั่ง Node เรียก pdf.js ได้ตรง ๆ โดยไม่ต้อง vendor ไฟล์ worker ลง dist
//
// ผลลัพธ์: ข้อความบรรทัดละบรรทัด (ตามตำแหน่ง y ของข้อความในหน้า)
// ใช้ต่อกับ regex ของแต่ละ field ในหน้าตั้งค่าแม่แบบ
//
// หน้าไหนไม่มีชั้นข้อความ (ไฟล์ที่เกิดจากการสแกน) จะเรนเดอร์หน้าเป็นรูป
// แล้ว OCR ด้วย tesseract.js ให้อัตโนมัติ — ดู pdf-ocr.cjs
const path = require("path");

// ต้องมาก่อน pdfjs — pdf-ocr เติม DOMMatrix/Path2D ให้ pdf.js ใช้
const {
    ocrPage,
    createCanvasFactory
} = require("./pdf-ocr.cjs");

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

// จำนวนตัวอักษร (ไม่นับช่องว่าง) ที่ถือว่า "หน้านี้มีข้อความจริง"
// ต่ำกว่านี้ = น่าจะเป็นหน้าสแกน (มีแค่หัวกระดาษ/เลขหน้า หรือไม่มีอะไรเลย)
const MIN_TEXT_CHARS = 20;

// PDF ที่พิมพ์จากโปรแกรมบางตัว (หรือสแกนแล้วฝังชั้นข้อความไว้)
// ข้อความที่ได้จะเป็นรหัส glyph ของฟอนต์ Type3 ไม่ใช่ตัวอักษรจริง
// เช่น "HIJK@+*L,-+4M4NO4P" หรือมีอักขระควบคุมปนมา → ใช้กับ regex ไม่ได้
// เกณฑ์: อักขระเสีย (control / private use) ต้องน้อยกว่านี้
//       และตัวอักษร/ตัวเลขจริงต้องมีอย่างน้อยอัตรานี้
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

// แอปแพ็กเป็น .exe หรือยัง (เรียกจาก Node ตรง ๆ จะไม่มี electron)
function isPackaged() {
    try {
        const { app } = require("electron");

        return Boolean(app && app.isPackaged);
    } catch (error) {
        return false;
    }
}

// โฟลเดอร์ไฟล์ภาษา (tha.traineddata / eng.traineddata) ที่แนบมากับแอป
// ตอนแพ็กเป็น .exe ไฟล์ถูกวางไว้นอก asar (ดู asarUnpack ใน package.json)
function defaultLangPath() {
    if (isPackaged()) {
        return path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "src",
            "main",
            "ocr"
        );
    }

    return path.join(__dirname, "ocr");
}

// ไฟล์ worker ของ tesseract.js อ่านจากใน asar ไม่ได้ (worker_threads)
// จึงอ้างไฟล์ที่ถูกแตกออกมาไว้นอก asar
function defaultWorkerPath() {
    if (isPackaged()) {
        return path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "node_modules",
            "tesseract.js",
            "src",
            "worker-script",
            "node",
            "index.js"
        );
    }

    return require.resolve("tesseract.js/src/worker-script/node/index.js");
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
 * อ่านข้อความทุกหน้าของ PDF (หน้าไหนไม่มีชั้นข้อความจะ OCR ให้)
 *
 * @param {Uint8Array|Buffer} data เนื้อไฟล์ PDF
 * @param {Object} [options]
 *   ocr        = false เพื่อปิดการ OCR (อ่านเฉพาะชั้นข้อความ)
 *   scale      = ความละเอียดที่ใช้ OCR (ตัวคูณจาก 72 DPI, ค่าเริ่มต้น ~200 DPI)
 *   langPath/workerPath = ทับค่าที่ใช้อยู่ (สำหรับทดสอบ)
 *   onProgress = ฟังก์ชันรับความคืบหน้า { page, pageCount, status, progress }
 * @returns {Promise<{text:string, ocrPages:number[], ocrError:string|null, pages:Array}>}
 *   pages = หน้าที่ผ่าน OCR พร้อมภาพตัวอย่างและตำแหน่งคำ (สำหรับตรวจคำบน PDF)
 */
async function extractPdfText(data, options) {
    const opts = options || {};
    const useOcr = opts.ocr !== false;

    const task = pdfjs.getDocument({
        data: new Uint8Array(data),
        // ไม่ต้องเรนเดอร์/โหลดฟอนต์ — ต้องการแค่ข้อความ
        disableFontFace: true,
        isEvalSupported: false,
        useSystemFonts: true,
        // ใช้ canvas ของ @napi-rs/canvas (โหลดได้ทั้ง Node และ Electron)
        canvasFactory: createCanvasFactory()
    });

    const document = await task.promise;
    const lines = [];
    const ocrPages = [];
    const pages = [];
    let ocrError = null;

    // หน้าปัจจุบัน — ใช้เติมเลขหน้าในรายงานความคืบหน้าตอน OCR
    let currentPage = 0;

    const ocrOptions = {
        // ความละเอียดที่ใช้เรนเดอร์หน้า (ตัวคูณจาก 72 DPI) — ค่าเริ่มต้นคือ ~200 DPI
        scale: opts.scale,
        langPath: opts.langPath || defaultLangPath(),
        workerPath: opts.workerPath || defaultWorkerPath(),
        logger: function (message) {
            if (typeof opts.onProgress !== "function") return;

            // ส่งเฉพาะสถานะที่ผู้ใช้เห็นแล้วรู้เรื่อง (ข้ามขั้นตอนภายในของ tesseract)
            if (message.status === "recognizing text") {
                opts.onProgress({
                    page: currentPage,
                    pageCount: document.numPages,
                    status: "ocr",
                    progress: message.progress
                });
            }
        }
    };

    try {
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
            const page = await document.getPage(pageNumber);

            currentPage = pageNumber;

            try {
                if (typeof opts.onProgress === "function") {
                    opts.onProgress({
                        page: pageNumber,
                        pageCount: document.numPages,
                        status: "reading"
                    });
                }

                let pageText = "";

                try {
                    const content = await page.getTextContent();

                    pageText = pageLines(content.items || []).join("\n");
                } catch (error) {
                    // อ่านชั้นข้อความไม่ได้ = ยังเหลือทาง OCR
                    pageText = "";
                }

                const quality = textUsability(pageText);

                // หน้าเปล่า/มีข้อความน้อย หรือข้อความที่ได้เป็นขยะ → OCR
                const needsOcr =
                    quality.length < MIN_TEXT_CHARS ||
                    !quality.usable;

                if (useOcr && needsOcr) {
                    try {
                        const ocr = await ocrPage(page, ocrOptions);

                        if (ocr.text !== "") {
                            ocrPages.push(pageNumber);

                            // ข้อความเดิมที่เสีย (รหัส glyph) ไม่มีประโยชน์กับ regex
                            // ใช้ข้อความจาก OCR แทน — ถ้าข้อความเดิมใช้ได้ ให้เก็บต่อท้าย
                            pageText = quality.usable
                                ? [pageText, ocr.text].filter(Boolean).join("\n")
                                : ocr.text;
                        }

                        // เก็บภาพ+ตำแหน่งคำไว้ให้หน้าจอตรวจคำ (เฉพาะเมื่อมีคำให้ตรวจ)
                        if (ocr.words.length > 0) {
                            pages.push({
                                page: pageNumber,
                                image: ocr.image,
                                width: ocr.width,
                                height: ocr.height,
                                words: ocr.words
                            });
                        }
                    } catch (error) {
                        // OCR หน้าเดียวพังไม่ควรทำให้ทั้งไฟล์อ่านไม่ได้
                        console.error(
                            "OCR page " + pageNumber + " failed:",
                            error
                        );

                        ocrError =
                            (error && error.message) ||
                            String(error);

                        // ข้อความเดิมเป็นขยะอยู่แล้ว — อย่าส่งต่อให้ regex ไปจับ
                        if (!quality.usable) {
                            pageText = "";
                        }
                    }
                }

                if (pageText !== "") lines.push(pageText);

            } finally {
                page.cleanup();
            }
        }
    } finally {
        await document.destroy();
    }

    return {
        text: lines.join("\n"),
        ocrPages: ocrPages,
        ocrError: ocrError,
        pages: pages
    };
}

module.exports = {
    extractPdfText: extractPdfText,
    MIN_TEXT_CHARS: MIN_TEXT_CHARS
};
