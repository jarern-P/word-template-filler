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
 * วาดหน้า PDF ลง canvas (ใช้ทั้ง OCR และภาพตัวอย่าง)
 * @param {Object} page หน้าจาก pdf.js
 * @param {number} [scale] ขนาดที่ใช้วาด (ค่าเริ่มต้น ~200 DPI)
 * @returns {Promise<Object>} canvas ของ @napi-rs/canvas
 */
async function renderPageCanvas(page, scale) {
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

    return canvas;
}

/**
 * วาดหน้า PDF ลงภาพ PNG
 * @param {Object} page หน้าจาก pdf.js
 * @param {number} [scale] ขนาดที่ใช้วาด (ค่าเริ่มต้น ~200 DPI)
 * @returns {Promise<Buffer>} เนื้อไฟล์ PNG
 */
async function renderPageToPng(page, scale) {
    const canvas = await renderPageCanvas(page, scale);

    return canvas.toBuffer("image/png");
}

// ------------------------------------------------------------------
// ภาพตัวอย่าง + ตำแหน่งคำ (สำหรับหน้าจอ "ตรวจคำบน PDF")
// ------------------------------------------------------------------

// ความกว้างภาพตัวอย่าง (px)
// ใช้ความละเอียดเต็มของหน้า (~200 DPI ≈ 1650-1800 px กว้าง) ไม่ย่อลงมาเป็น 900
// เพราะภาพจะแตก/มัวจนอ่านตัวอักษรไทยไม่ออกเมื่อแสดงบนจอ
// (หน้าจอขยายได้ถึง 2.2x — ภาพระดับนี้ยังคมพอ และ webp ทำให้ไฟล์ไม่ใหญ่)
const PREVIEW_WIDTH = 1800;

function previewImage(canvas) {
    // ไม่ขยายเกินความละเอียดจริง — ขยายแล้วได้แต่ภาพเบลอ
    const ratio = Math.min(1, PREVIEW_WIDTH / canvas.width);
    const width = Math.max(1, Math.round(canvas.width * ratio));
    const height = Math.max(1, Math.round(canvas.height * ratio));

    const preview = createCanvas(width, height);
    const context = preview.getContext("2d");

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(canvas, 0, 0, width, height);

    // webp คุณภาพสูง: ตัวอักษรคมกว่า JPEG ที่ระดับความละเอียดเท่ากัน
    // และไฟล์เล็กกว่า (เนื้อหาส่วนใหญ่เป็นพื้นขาว)
    // หมายเหตุ: toBuffer ของ @napi-rs/canvas รับคุณภาพเป็น 0-100
    // (ถ้าส่ง 0.9 จะกลายเป็นคุณภาพ ~1% — ภาพแตกเป็นบล็อก)
    return {
        image: "data:image/webp;base64," +
            preview.toBuffer("image/webp", 85).toString("base64"),
        width: width,
        height: height,
        ratio: ratio
    };
}

// อ่าน "คำ" จากผลลัพธ์ TSV ของ tesseract (มีตำแหน่งของทุกชิ้นอักษร)
function parseTsvWords(tsv) {
    const rows = String(tsv || "").split(/\r?\n/);
    const fragments = [];

    // แถวแรกเป็นหัวตาราง
    for (let index = 1; index < rows.length; index++) {
        const cols = rows[index].split("\t");

        // level 5 = word
        if (cols.length < 12 || cols[0] !== "5") continue;

        const text = cols[11];

        if (!text || text.trim() === "") continue;

        fragments.push({
            // block:par:line ของ tesseract — ใช้จัดบรรทัดแทนการเดาจากพิกัด
            // (ภาษาไทยมีสระ/วรรณยุกต์ที่อยู่สูงกว่าตัวอักษร จึงเดาจาก top ไม่แม่น)
            line: cols[2] + ":" + cols[3] + ":" + cols[4],
            left: Number(cols[6]) || 0,
            top: Number(cols[7]) || 0,
            width: Number(cols[8]) || 0,
            height: Number(cols[9]) || 0,
            confidence: Number(cols[10]) || 0,
            text: text
        });
    }

    return fragments;
}

// "ำ" ใน TSV ถูกแยกเป็น ํ (nikhahit) + า เหมือนข้อความดิบ
// cleanOcrText รวมกลับเป็น U+0E33 — ต้องรวมแบบเดียวกันก่อนเทียบตำแหน่ง
function normalizeThaiAm(text) {
    let value = "";
    const start = [];

    for (let index = 0; index < text.length; index++) {
        if (text[index] === "\u0E4D" && text[index + 1] === "\u0E32") {
            value += "\u0E33";
            start.push(index);
            index += 1;
            continue;
        }

        value += text[index];
        start.push(index);
    }

    return { text: value, start: start };
}

function withoutSpaces(text) {
    return String(text || "").replace(/\s+/g, "");
}

// รวมชิ้นอักษร (TSV) เป็น "คำ" ที่ตรงกับข้อความที่ผู้ใช้เห็นในช่องข้อความ
//
// ทำไมไม่รวมชิ้นที่ติดกันเอง: tesseract แยกภาษาไทยเป็นชิ้นย่อยไม่เท่ากัน
//   (บางทีก็ "เลขที" ทั้งคำ, บางทีเป็น "เล" + "ขที", บางทีก็แยกกลางคำ)
//   ถ้าคีย์ที่แก้เป็นแค่ชิ้นย่อย การแทนทั้งข้อความอาจไปโดนคำอื่นที่บังเอิญมีชิ้นนั้น
//   จึงยึด token จากข้อความ (คั่นด้วยช่องว่าง) แล้วหากล่องของทุกชิ้นที่ประกอบเป็น token นั้น
//   → คำที่คลิกได้ตรงกับคำที่เห็นในช่องข้อความเป๊ะ ๆ
//
// จับคู่บรรทัด: tesseract ให้ text กับ TSV ตามลำดับบรรทัดเดียวกัน
//   เทียบเฉพาะอักขระที่ไม่ใช่ช่องว่าง (ช่องว่างของสองฝั่งไม่ตรงกันได้)
//   บรรทัดที่จับคู่ไม่ได้ = ไม่มีกล่องให้คลิก (ข้าม ไม่เดา)
function groupWords(text, fragments) {
    const groups = [];
    const byLine = {};

    fragments.forEach(function (fragment) {
        const key = fragment.line;

        if (!byLine[key]) {
            byLine[key] = [];
            groups.push(byLine[key]);
        }

        byLine[key].push(fragment);
    });

    const textLines = String(text || "").split("\n");
    const words = [];

    // กล่องของแต่ละบรรทัด (คนละชุดกับ words) — ใช้เย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่
    const lineBoxes = [];

    // ตำแหน่งในข้อความของบรรทัดล่าสุดที่จับคู่ได้ — กันจับบรรทัดซ้ำเมื่อมีข้อความซ้ำกัน
    let lineCursor = 0;
    let searchFrom = 0;

    groups.forEach(function (parts) {
        parts.sort(function (a, b) {
            return a.left - b.left;
        });

        const rawLine = parts.map(function (part) {
            return part.text;
        }).join("");

        const normalized = normalizeThaiAm(rawLine);

        // อักขระที่ไม่ใช่ช่องว่างในบรรทัดนี้ + ตำแหน่งของแต่ละตัวใน normalized
        const plainChars = [];
        const normalizedToPlain = [];

        for (let index = 0; index < normalized.text.length; index++) {
            normalizedToPlain.push(plainChars.length);

            if (!/\s/.test(normalized.text[index])) {
                plainChars.push(normalized.text[index]);
            }
        }

        normalizedToPlain.push(plainChars.length);

        const plain = plainChars.join("");

        if (plain === "") return;

        // หาบรรทัดข้อความที่ตรงกับบรรทัดนี้
        let matched = -1;
        let matchedAt = -1;

        for (let index = lineCursor; index < textLines.length; index++) {
            const plainLine = withoutSpaces(textLines[index]);
            const from = index === lineCursor ? searchFrom : 0;
            const at = plainLine.indexOf(plain, from);

            if (at !== -1) {
                matched = index;
                matchedAt = at;
                break;
            }
        }

        if (matched === -1) return;

        lineCursor = matched;
        searchFrom = matchedAt + plain.length;

        // กล่องครอบของบรรทัดนี้ — ถ้า tesseract แยกเป็นหลายกลุ่มที่ลงเอยบรรทัด
        // เดียวกัน ให้ขยายกล่องเดิมแทนการเพิ่มซ้ำ
        let lineBox = null;

        for (let boxIndex = 0; boxIndex < lineBoxes.length; boxIndex++) {
            if (lineBoxes[boxIndex].index === matched) {
                lineBox = lineBoxes[boxIndex];
                break;
            }
        }

        if (!lineBox) {
            lineBox = {
                index: matched,
                left: Infinity,
                right: -Infinity,
                top: Infinity,
                bottom: -Infinity
            };
            lineBoxes.push(lineBox);
        }

        parts.forEach(function (part) {
            lineBox.left = Math.min(lineBox.left, part.left);
            lineBox.right = Math.max(lineBox.right, part.left + part.width);
            lineBox.top = Math.min(lineBox.top, part.top);
            lineBox.bottom = Math.max(lineBox.bottom, part.top + part.height);
        });

        // token ในข้อความ (คั่นด้วยช่องว่าง) + ช่วงตำแหน่งแบบไม่นับช่องว่าง
        const tokens = [];
        const tokenPattern = /\S+/g;

        let match;
        let plainIndex = 0;

        while ((match = tokenPattern.exec(textLines[matched])) !== null) {
            const length = withoutSpaces(match[0]).length;

            tokens.push({
                text: match[0],
                plainStart: plainIndex,
                plainEnd: plainIndex + length
            });

            plainIndex += length;
        }

        // raw index -> index ใน normalized ("ำ" 2 ตัว -> 1 ตัว)
        const rawToNormalized = [];

        for (let index = 0; index < normalized.text.length; index++) {
            const start = normalized.start[index];
            const length = rawLine[start] === "\u0E4D" &&
                normalized.text[index] === "\u0E33" ? 2 : 1;

            for (let offset = 0; offset < length; offset++) {
                rawToNormalized[start + offset] = index;
            }
        }

        rawToNormalized[rawLine.length] = normalized.text.length;

        const boxes = {};
        let cursor = 0;

        parts.forEach(function (part) {
            const start = rawToNormalized[cursor];
            const end = rawToNormalized[cursor + part.text.length];

            cursor += part.text.length;

            if (start == null || end == null) return;

            const plainStart = matchedAt + normalizedToPlain[start];
            const plainEnd = matchedAt + normalizedToPlain[end];

            // token ที่ทับช่วงของชิ้นนี้
            let index = -1;

            for (let i = 0; i < tokens.length; i++) {
                if (plainStart < tokens[i].plainEnd && plainEnd > tokens[i].plainStart) {
                    index = i;
                    break;
                }
            }

            if (index === -1) return;

            const right = part.left + part.width;
            const bottom = part.top + part.height;
            const box = boxes[index];

            if (!box) {
                boxes[index] = {
                    text: tokens[index].text,
                    left: part.left,
                    top: part.top,
                    right: right,
                    bottom: bottom,
                    confidence: part.confidence,
                    count: 1
                };
                return;
            }

            box.text = tokens[index].text;
            box.left = Math.min(box.left, part.left);
            box.top = Math.min(box.top, part.top);
            box.right = Math.max(box.right, right);
            box.bottom = Math.max(box.bottom, bottom);
            box.confidence += part.confidence;
            box.count += 1;
        });

        Object.keys(boxes).forEach(function (key) {
            const box = boxes[key];

            box.confidence = box.confidence / box.count;
            words.push(box);
        });
    });

    return {
        words: words,
        lines: lineBoxes
    };
}

// แปลงพิกัดจากภาพเต็มเป็นพิกัดบนภาพตัวอย่าง
function scaleWords(words, ratio) {
    return words
        .map(function (word) {
            return {
                text: word.text,
                x: Math.round(word.left * ratio),
                y: Math.round(word.top * ratio),
                width: Math.max(1, Math.round((word.right - word.left) * ratio)),
                height: Math.max(1, Math.round((word.bottom - word.top) * ratio)),
                confidence: Math.round(word.confidence)
            };
        })
        .filter(function (word) {
            return word.width > 1 && word.height > 1;
        });
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
 * OCR หนึ่งหน้า: ข้อความ + ภาพตัวอย่าง + ตำแหน่งของแต่ละคำ
 * @param {Object} page หน้าจาก pdf.js
 * @param {Object} options { langPath, workerPath, logger, scale }
 * @returns {Promise<{text:string, image:string, width:number, height:number, words:Array, lines:Array}>}
 *   lines = บรรทัดข้อความพร้อมพิกัด (left/right/top/bottom) สำหรับเย็บประโยคที่ถูกตัด
 */
async function ocrPage(page, options) {
    const canvas = await renderPageCanvas(page, options && options.scale);
    const png = canvas.toBuffer("image/png");
    const engine = await getWorker(options || {});

    let result;

    try {
        // TSV ใช้แยกตำแหน่งคำ (ข้อความยังมาจาก text เหมือนเดิม)
        result = await engine.recognize(png, {}, { text: true, tsv: true });
    } finally {
        // นับเวลาว่างหลังอ่านหน้านี้เสร็จ (ไม่ตัด worker กลางชุดหลายหน้า)
        scheduleIdleTerminate();
    }

    const preview = previewImage(canvas);
    const data = (result && result.data) || {};
    const text = cleanOcrText(data.text);
    const grouped = groupWords(text, parseTsvWords(data.tsv));

    // กล่องบรรทัดเรียงตาม index ของข้อความ — บรรทัดที่จับคู่กล่องไม่ได้
    // ยังคงอยู่ในผลลัพธ์ (แค่ไม่มีพิกัด จึงไม่ถูกเย็บ)
    const boxes = {};

    grouped.lines.forEach(function (lineBox) {
        boxes[lineBox.index] = lineBox;
    });

    const lines = text === ""
        ? []
        : text.split("\n").map(function (lineText, index) {
            const lineBox = boxes[index];

            if (!lineBox) return { text: lineText };

            return {
                text: lineText,
                left: lineBox.left * preview.ratio,
                right: lineBox.right * preview.ratio,
                top: lineBox.top * preview.ratio,
                bottom: lineBox.bottom * preview.ratio
            };
        });

    return {
        text: text,
        image: preview.image,
        width: preview.width,
        height: preview.height,
        words: scaleWords(grouped.words, preview.ratio),
        lines: lines
    };
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
    renderPageCanvas: renderPageCanvas,
    renderPageToPng: renderPageToPng,
    disposeOcr: disposeOcr,
    OCR_LANGS: OCR_LANGS
};
