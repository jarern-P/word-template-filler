// OCR ด้วย PaddleOCR (ทำงานในเครื่องทั้งหมด)
//
// ใช้ไลบรารี ppu-paddle-ocr รันโมเดล PP-OCRv5 (Thai mobile) ผ่าน ONNX Runtime
// — ไม่ต้องติดตั้ง Python และไม่ต้องใช้อินเทอร์เน็ตหลังโหลดโมเดลครั้งแรกแล้ว
//
// ขั้นตอนต่อหนึ่งหน้า:
//   1. pdf.js วาดหน้าลง canvas (@napi-rs/canvas — N-API จึงใช้ได้ทั้ง Node/Electron)
//   2. ส่งภาพ PNG ให้ ppu-paddle-ocr ตรวจจับบรรทัด + อ่านตัวอักษร
//   3. คืนข้อความพร้อมพิกัดบรรทัด ให้ pdf-text.cjs รวมกับชั้นข้อความของ PDF
//
// โมเดลถูกดาวน์โหลดครั้งแรกที่เรียกใช้ แล้วเก็บไว้ที่ ~/.cache/ppu-paddle-ocr
// (Windows: C:\Users\<ชื่อผู้ใช้>\.cache\ppu-paddle-ocr)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ความละเอียดที่ใช้วาดหน้า (~200 DPI)
// น้อยกว่านี้ตัวอักษรไทยเล็ก ๆ จะอ่านผิดมาก, มากกว่านี้ช้ามากโดยไม่คุ้ม
const OCR_SCALE = 200 / 72;

// กันหน้ากระดาษใหญ่ผิดปกติไม่ให้ใช้หน่วยความจำเกิน
const MAX_PIXEL_SIDE = 4000;

// โฟลเดอร์แคชโมเดลของ ppu-paddle-ocr
const MODEL_CACHE_DIR = path.join(
    os.homedir(),
    '.cache',
    'ppu-paddle-ocr'
);

// ตัวเลือกของโมเดล/เอนจิน
// - canvas-native: ใช้ canvas ของ @napi-rs/canvas (ไม่ต้องโหลด OpenCV.js เพิ่ม)
// - per-line: รวมกล่องที่อยู่บรรทัดเดียวกันแล้วอ่านครั้งเดียว (ค่าเริ่มต้นของไลบรารี)
const SERVICE_OPTIONS = {
    detection: {
        // เผื่อขอบบน/ล่างของกล่องที่โมเดลตรวจจับได้ — ค่าเริ่มต้นของไลบรารี (0.4)
        // บางครั้งชิดเกินไปจนสระบน/วรรณยุกต์และสระล่างถูกตัดตอนครอปไปอ่าน
        // (หน่วย = ของความสูงกล่อง ทั้งด้านบนและด้านล่าง)
        paddingVertical: 0.6
    },
    processing: {
        engine: 'canvas-native'
    },
    recognition: {
        strategy: 'per-line',
        minimumConfidence: 0.5
    },
    debugging: {
        debug: false,
        verbose: false
    }
};

let servicePromise = null;
let serviceModule = null;

// ------------------------------------------------------------------
// ตรวจสอบ/เตรียมความพร้อม
// ------------------------------------------------------------------

function resolveCheck(name) {
    try {
        require.resolve(name);
        return true;
    } catch (error) {
        return false;
    }
}

// ขนาด/จำนวนไฟล์ในแคชโมเดล (ไม่นับไฟล์ที่ดาวน์โหลดค้าง .part)
function modelCacheInfo() {
    const info = {
        path: MODEL_CACHE_DIR,
        exists: fs.existsSync(MODEL_CACHE_DIR),
        files: 0,
        bytes: 0
    };

    try {
        const stack = [MODEL_CACHE_DIR];

        while (stack.length > 0) {
            const dir = stack.pop();
            const entries = fs.readdirSync(dir, { withFileTypes: true });

            entries.forEach(function (entry) {
                const full = path.join(dir, entry.name);

                if (entry.isDirectory()) {
                    stack.push(full);
                    return;
                }

                if (!entry.isFile()) return;
                if (/\.part$/i.test(entry.name)) return;

                info.files += 1;
                info.bytes += fs.statSync(full).size;
            });
        }
    } catch (error) {
        // อ่านแคชไม่ได้ = รายงานเท่าที่รู้ (ไม่ทำให้สถานะทั้งก้อนพัง)
    }

    return info;
}

// สถานะสำหรับหน้า "ตั้งค่า OCR" — ไม่โหลดโมเดล (เร็ว)
function status() {
    const cache = modelCacheInfo();

    const engines = {
        paddle: resolveCheck('ppu-paddle-ocr'),
        onnxruntime: resolveCheck('onnxruntime-node'),
        canvas: resolveCheck('@napi-rs/canvas')
    };

    const ready = Object.keys(engines).every(function (key) {
        return engines[key];
    });

    return {
        ready: ready,
        engines: engines,
        modelPath: cache.path,
        modelFiles: cache.files,
        modelBytes: cache.bytes,
        // มีไฟล์โมเดลอยู่ในแคชแล้วหรือยัง (ไม่มี = ครั้งแรกต้องต่อเน็ต)
        modelsCached: cache.files > 0,
        language: 'ไทย + อังกฤษ (PP-OCRv5 Thai)'
    };
}

// ------------------------------------------------------------------
// โหลดไลบรารี / เริ่ม service (แค่ครั้งเดียวต่อการเปิดแอป)
// ------------------------------------------------------------------

function friendlyError(error) {
    const message = String((error && error.message) || error || '');

    if (/Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(message)) {
        return new Error(
            'ไม่พบไลบรารี PaddleOCR (ppu-paddle-ocr / onnxruntime-node) — ' +
            'กรุณาติดตั้ง dependencies ของแอปใหม่ (npm install)'
        );
    }

    if (/fetch failed|network|ENOTFOUND|ECONN|ETIMEDOUT|socket hang up|download/i.test(message)) {
        return new Error(
            'โหลดโมเดล OCR ไม่สำเร็จ — ครั้งแรกต้องเชื่อมต่ออินเทอร์เน็ต ' +
            'เพื่อดาวน์โหลดโมเดล (ประมาณ 15 MB) แล้วครั้งต่อไปจะใช้จากแคชในเครื่อง'
        );
    }

    return new Error('OCR ไม่สำเร็จ: ' + (message || 'ไม่ทราบสาเหตุ'));
}

async function loadModule() {
    if (serviceModule) return serviceModule;

    try {
        serviceModule = await import('ppu-paddle-ocr');
        return serviceModule;

    } catch (error) {
        const friendly = friendlyError(error);
        friendly.cause = error;
        throw friendly;
    }
}

function getService() {
    if (servicePromise) return servicePromise;

    servicePromise = (async function () {
        const module = await loadModule();

        const service = new module.PaddleOcrService({
            ...SERVICE_OPTIONS,
            model: module.V5_THAI_MOBILE_MODEL
        });

        await service.initialize();

        return service;

    })().catch(function (error) {
        // ล้มเหลว = ลองใหม่ได้ในการอัปโหลดครั้งถัดไป
        servicePromise = null;

        const friendly = error && error.message && !error.cause
            ? friendlyError(error)
            : error;

        friendly.cause = friendly.cause || error;
        throw friendly;
    });

    return servicePromise;
}

// เริ่ม service ล่วงหน้า (ดาวน์โหลดโมเดลถ้ายังไม่มี)
// ใช้กับปุ่ม "เตรียมโมเดล" ในหน้า ตั้งค่า OCR
async function prepare() {
    await getService();

    return status();
}

// ------------------------------------------------------------------
// วาดหน้า PDF -> PNG
// ------------------------------------------------------------------

async function renderPageToPng(page, scale) {
    let canvasModule;

    try {
        canvasModule = require('@napi-rs/canvas');

    } catch (error) {
        throw friendlyError(error);
    }

    const base = page.getViewport({ scale: 1 });

    let usedScale = Number(scale) > 0 ? Number(scale) : OCR_SCALE;

    const longest = Math.max(base.width, base.height);

    if (longest > 0 && longest * usedScale > MAX_PIXEL_SIDE) {
        usedScale = MAX_PIXEL_SIDE / longest;
    }

    const viewport = page.getViewport({ scale: usedScale });

    const width = Math.max(1, Math.floor(viewport.width));
    const height = Math.max(1, Math.floor(viewport.height));

    const canvas = canvasModule.createCanvas(width, height);
    const context = canvas.getContext('2d');

    // พื้นหลังขาว — หน้าสแกนมักมีพื้นที่โปร่งใส ซึ่ง OCR จะมองเป็นสีดำ
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);

    await page.render({
        canvasContext: context,
        viewport: viewport
    }).promise;

    return canvas.toBuffer('image/png');
}

// ------------------------------------------------------------------
// OCR
// ------------------------------------------------------------------

// แปลงผลลัพธ์ของไลบรารีเป็นบรรทัดที่มีพิกัด
// (pdf-text.cjs ใช้พิกัดเหล่านี้เย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่)
function toPositionedLines(result) {
    const groups = Array.isArray(result && result.lines)
        ? result.lines
        : [];

    const lines = [];

    groups.forEach(function (items) {
        const parts = (Array.isArray(items) ? items : []).filter(function (item) {
            return item && String(item.text || '').trim() !== '';
        });

        if (parts.length === 0) return;

        const boxes = parts
            .map(function (item) {
                return item.box || {};
            })
            .filter(function (box) {
                return Number.isFinite(Number(box.x)) && Number.isFinite(Number(box.y));
            });

        const text = parts
            .map(function (item) {
                return String(item.text || '').trim();
            })
            .filter(Boolean)
            .join(' ');

        if (text === '') return;

        // ค่าเฉลี่ยความมั่นใจของคำในบรรทัด (ใช้กรองเศษข้อความรบกวนได้)
        const scores = parts
            .map(function (item) {
                return Number(item.confidence);
            })
            .filter(function (value) {
                return Number.isFinite(value);
            });

        const confidence = scores.length > 0
            ? scores.reduce(function (sum, value) {
                return sum + value;
            }, 0) / scores.length
            : undefined;

        if (boxes.length === 0) {
            lines.push({ text: text, confidence: confidence });
            return;
        }

        const left = Math.min.apply(null, boxes.map(function (box) {
            return Number(box.x) || 0;
        }));

        const top = Math.min.apply(null, boxes.map(function (box) {
            return Number(box.y) || 0;
        }));

        const right = Math.max.apply(null, boxes.map(function (box) {
            return (Number(box.x) || 0) + (Number(box.width) || 0);
        }));

        const bottom = Math.max.apply(null, boxes.map(function (box) {
            return (Number(box.y) || 0) + (Number(box.height) || 0);
        }));

        lines.push({
            text: text,
            left: left,
            right: right,
            top: top,
            bottom: bottom,
            confidence: confidence,
            hadSpaceAfter: / $/.test(text)
        });
    });

    // ไลบรารีอาจคืน text ได้แต่ lines ว่าง — ยังใช้ข้อความนั้นได้
    if (lines.length === 0 && result && String(result.text || '').trim() !== '') {
        String(result.text)
            .split(/\r?\n/)
            .map(function (line) {
                return line.trim();
            })
            .filter(Boolean)
            .forEach(function (line) {
                lines.push({ text: line });
            });
    }

    return lines;
}

async function recognizePng(png) {
    const service = await getService();

    const buffer = png.buffer.slice(
        png.byteOffset,
        png.byteOffset + png.byteLength
    );

    let result;

    try {
        result = await service.recognize(buffer);

    } catch (error) {
        const friendly = friendlyError(error);
        friendly.cause = error;
        throw friendly;
    }

    const lines = toPositionedLines(result);

    return {
        text: lines.map(function (line) {
            return line.text;
        }).join('\n'),
        lines: lines,
        confidence: Number(result && result.confidence) || 0
    };
}

// ตรวจจับตำแหน่งข้อความเท่านั้น (ไม่อ่านตัวอักษร → ไม่เปลืองแรงอ่าน)
// ใช้โดยโหมด Two-Stage Localized OCR ในระยะที่ 1
async function detectPng(png, options) {
    const service = await getService();

    const buffer = png.buffer.slice(
        png.byteOffset,
        png.byteOffset + png.byteLength
    );

    let result;

    try {
        result = await service.detect(buffer, options || {});

    } catch (error) {
        const friendly = friendlyError(error);
        friendly.cause = error;
        throw friendly;
    }

    return Array.isArray(result && result.boxes) ? result.boxes : [];
}

// OCR หนึ่งหน้าของ PDF
async function ocrPage(page, options) {
    const opts = options || {};
    const png = await renderPageToPng(page, opts.scale);

    return recognizePng(png);
}

module.exports = {
    OCR_SCALE,
    MODEL_CACHE_DIR,
    status,
    prepare,
    ocrPage,
    recognizePng,
    detectPng,
    renderPageToPng
};
