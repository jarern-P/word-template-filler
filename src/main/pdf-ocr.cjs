// OCR สำหรับ PDF ที่เกิดจากการสแกน (หน้าเป็นรูป ไม่มีชั้นข้อความให้ดึง)
//
// ทำงานฝั่ง main process ทั้งหมด:
//   1. pdf.js เรนเดอร์หน้าลง canvas (@napi-rs/canvas — ใช้ N-API จึงโหลดได้ทั้ง Node และ Electron)
//   2. ส่งรูป PNG ให้ tesseract.js อ่านเป็นข้อความ (WASM ไม่ต้องติดตั้งโปรแกรมเพิ่ม)
//
// ข้อมูลภาษา (traineddata) เก็บไว้ในโฟลเดอร์ ocr ข้างไฟล์นี้
// จึง OCR ได้แม้เครื่องไม่มีอินเทอร์เน็ต
const path = require("path");
const napiCanvas = require("@napi-rs/canvas");
const { createCanvas } = napiCanvas;

// pdf.js จะ polyfill DOMMatrix/Path2D จากโมดูล `canvas` (node-canvas)
// ซึ่งคอมไพล์ตาม ABI ของ Node ธรรมดา — ใช้ใน Electron ไม่ได้
// เติมให้ก่อน pdf.js โหลด (ต้อง require ไฟล์นี้ก่อน pdfjs ใน pdf-text.cjs)
// เพื่อให้ pdf.js เห็นว่ามีอยู่แล้วและไม่ไปเรียก `canvas`
if (!globalThis.DOMMatrix && napiCanvas.DOMMatrix) {
    globalThis.DOMMatrix = napiCanvas.DOMMatrix;
}

if (!globalThis.Path2D && napiCanvas.Path2D) {
    globalThis.Path2D = napiCanvas.Path2D;
}

// ความละเอียดที่ใช้ OCR (~200 DPI)
// น้อยกว่านี้ตัวอักษรไทยเล็ก ๆ จะอ่านผิดมาก, มากกว่านี้จะช้ามากโดยไม่คุ้ม
const OCR_SCALE = 200 / 72;

// กันหน้าที่มีขนาดกระดาษใหญ่ผิดปกติไม่ให้ใช้หน่วยความจำเกิน
const MAX_PIXEL_SIDE = 4000;

// ภาษาที่ใช้ OCR — ไทย + อังกฤษ (เอกสารไทยมีทั้งเลขวันที่และคำอังกฤษปน)
const OCR_LANGS = "tha+eng";

// ------------------------------------------------------------------
// เรนเดอร์หน้า PDF เป็น PNG
// ------------------------------------------------------------------

// pdf.js เรียกใช้ canvas factory ตอนวาด pattern/annotation
// ใน Node ไม่มี document.createElement("canvas") จึงต้องส่งของเราเอง
class NodeCanvasFactory {
    create(width, height) {
        const canvas = createCanvas(width, height);

        return {
            canvas: canvas,
            context: canvas.getContext("2d")
        };
    }

    reset(canvasAndContext, width, height) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }

    destroy(canvasAndContext) {
        // ไม่ต้องสั่ง width/height = 0 เหมือนฝั่ง browser
        // (@napi-rs/canvas เป็น native object — ตั้งค่าแล้วจะ error ตอน pdf.js เก็บกวาด)
        // แค่ปล่อย reference ให้ GC เก็บก็พอ
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}

/**
 * วาดหน้า PDF ลงภาพ PNG
 * @param {Object} page หน้าจาก pdf.js
 * @param {number} [scale] ขนาดที่ใช้วาด (ค่าเริ่มต้น ~200 DPI)
 * @returns {Promise<Buffer>} เนื้อไฟล์ PNG
 */
async function renderPageToPng(page, scale) {
    const base = page.getViewport({ scale: 1 });

    let usedScale = Number(scale) > 0 ? Number(scale) : OCR_SCALE;

    const longest = Math.max(base.width, base.height);

    if (longest * usedScale > MAX_PIXEL_SIDE) {
        usedScale = MAX_PIXEL_SIDE / longest;
    }

    const viewport = page.getViewport({ scale: usedScale });

    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");

    // พื้นหลังขาว — หน้าสแกนมักมีพื้นที่โปร่งใส ซึ่ง OCR จะมองเป็นสีดำ
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    return canvas.toBuffer("image/png");
}

// ------------------------------------------------------------------
// Tesseract worker
// ------------------------------------------------------------------

// worker ถูกสร้างครั้งเดียวแล้วใช้ซ้ำทุกหน้า/ทุกไฟล์
// (สร้างใหม่ทุกครั้งจะเสียเวลาโหลดภาษา ~2-4 วินาที)
let worker = null;
let workerKey = "";

// ปล่อย worker คืนหลังไม่ได้ใช้งานนาน (กินหน่วยความจำหลายสิบ MB)
// ไฟล์ถัดไปจะสร้างใหม่เอง (~0.5 วินาที)
const IDLE_TERMINATE_MS = 90 * 1000;
let idleTimer = null;

function scheduleIdleTerminate() {
    if (idleTimer) clearTimeout(idleTimer);

    idleTimer = setTimeout(function () {
        idleTimer = null;
        disposeOcr();
    }, IDLE_TERMINATE_MS);

    // ไม่ให้ timer ทำให้โปรเซสค้างตอนปิดแอป
    if (idleTimer && typeof idleTimer.unref === "function") {
        idleTimer.unref();
    }
}

function workerCacheKey(langPath, workerPath) {
    return langPath + "|" + (workerPath || "") + "|" + OCR_LANGS;
}

async function getWorker(options) {
    const langPath = options.langPath;
    const key = workerCacheKey(langPath, options.workerPath);

    if (worker && workerKey === key) {
        return worker;
    }

    if (worker) {
        try {
            await worker.terminate();
        } catch (error) {
            // ปิดตัวเก่าไม่ได้ก็ปล่อยไป สร้างตัวใหม่แทน
        }

        worker = null;
        workerKey = "";
    }

    const { createWorker, OEM } = require("tesseract.js");

    const workerOptions = {
        langPath: langPath,
        // ไฟล์ภาษาเป็น .traineddata ธรรมดา (ไม่บีบอัด) ที่แนบมากับแอป
        gzip: false,
        // ไม่ต้องคัดลอกไฟล์ภาษาไปแคชที่อื่น — อ่านจาก langPath ตรง ๆ
        cacheMethod: "none",
        cachePath: langPath,
        logger: options.logger
    };

    // ไฟล์ worker ต้องชี้ไปที่โฟลเดอร์จริง (ตอนแพ็กเป็น .exe อยู่ที่ app.asar.unpacked)
    if (options.workerPath) {
        workerOptions.workerPath = options.workerPath;
    }

    worker = await createWorker(
        OCR_LANGS,
        OEM.LSTM_ONLY,
        workerOptions
    );

    workerKey = key;

    return worker;
}

// tesseract อ่านสระ "ำ" ออกมาเป็น ํ (nikhahit) + า (sara aa) เสมอ
// ซึ่งไม่ใช่ตัวอักษรเดียวกับที่พิมพ์จริง (U+0E33) → regex ที่มีคำเช่น "ทำงาน" จะจับไม่ได้
// รวมกลับเป็น "ำ" ให้ข้อความที่ได้เหมือนข้อความในเอกสาร
function cleanOcrText(text) {
    return String(text || "")
        .replace(/\r\n?/g, "\n")
        .replace(/\u0E4D\u0E32/g, "\u0E33")
        .replace(/\f/g, "")
        .split("\n")
        .map(function (line) {
            return line.replace(/[ \t]+/g, " ").trim();
        })
        .filter(function (line) {
            return line !== "";
        })
        .join("\n");
}

/**
 * OCR หนึ่งหน้าให้เป็นข้อความ (บรรทัดละบรรทัด)
 * @param {Object} page หน้าจาก pdf.js
 * @param {Object} options { langPath, workerPath, logger }
 * @returns {Promise<string>}
 */
async function ocrPage(page, options) {
    const png = await renderPageToPng(page, options && options.scale);
    const engine = await getWorker(options || {});

    let result;

    try {
        result = await engine.recognize(png, {}, { text: true });
    } finally {
        // นับเวลาว่างหลังอ่านหน้านี้เสร็จ (ไม่ตัด worker กลางชุดหลายหน้า)
        scheduleIdleTerminate();
    }

    return cleanOcrText(result && result.data && result.data.text);
}

/**
 * ปิด worker (เรียกตอนปิดแอป ไม่ให้ thread ค้าง)
 */
async function disposeOcr() {
    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }

    if (!worker) return;

    const current = worker;

    worker = null;
    workerKey = "";

    try {
        await current.terminate();
    } catch (error) {
        // ไม่เป็นไร ปิดแอปหรือปล่อย worker อยู่แล้ว
    }
}

// pdf.js เลือก canvas factory ตอน getDocument (ไม่ใช่ตอน render)
// จึงต้องส่งตัวนี้เข้าไปแทน NodeCanvasFactory เดิมที่พึ่งโมดูล `canvas`
// (node-canvas ต้องคอมไพล์ตาม ABI ของ Electron — ใช้ @napi-rs/canvas แทนได้เลย)
function createCanvasFactory() {
    return new NodeCanvasFactory();
}

module.exports = {
    createCanvasFactory: createCanvasFactory,
    cleanOcrText: cleanOcrText,
    ocrPage: ocrPage,
    renderPageToPng: renderPageToPng,
    disposeOcr: disposeOcr,
    OCR_LANGS: OCR_LANGS
};
