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
const crypto = require("crypto");

// ต้องมาก่อน pdfjs — pdf-ocr เติม DOMMatrix/Path2D ให้ pdf.js ใช้
const {
    ocrPage,
    createCanvasFactory
} = require("./pdf-ocr.cjs");

// AI ช่วยแก้ข้อความที่ tesseract อ่านผิด (ปิดได้จากหน้า "ตั้งค่า AI (OCR)")
// ถ้า AI ปิด/ไม่มี key/เรียกไม่สำเร็จ ข้อความจาก tesseract ยังใช้ได้ตามเดิม
const {
    correctLines: correctOcrLines,
    buildLearnedFixes
} = require("./ocr-ai.cjs");

// ใช้ผังหน้าที่เคยอ่านไว้ (จับคู่หน้าใกล้เคียง + เรียงลำดับบรรทัด/คอลัมน์ให้)
const {
    findBlueprint,
    orderLinesByBlueprint,
    MIN_LINES: MIN_BLUEPRINT_LINES
} = require("./ocr-blueprint.cjs");

const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

const { joinWrappedLines } = require("./line-join.cjs");

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

// ------------------------------------------------------------------
// AI ช่วยแก้คำ + blueprint ของหน้า (ข้อมูลสำหรับฝึกให้ทำงานได้เองโดยไม่ใช้ AI)
// ------------------------------------------------------------------

// ข้อความที่เทียบกันได้ (ตัดช่องว่าง/วรรคตอนออก) — ใช้ดูว่าบรรทัดนั้น
// ถูก AI นำไปใส่ในก้อน "หัวข้อ: ค่า" แล้วหรือยัง
function comparableText(text) {
    return String(text == null ? "" : text)
        .replace(/[\s:：;•·,]+/g, "")
        .toLowerCase();
}

// confidence ต่ำสุดของคำในบรรทัดนั้น (null = ไม่มีคำให้วัด)
// ใช้ตัดสินว่าคู่คำที่ AI แก้ควรถูกจำไว้ใช้ตอน AI ปิดหรือไม่
function lineConfidence(line, words) {
    if (!line || !Array.isArray(words) || words.length === 0) return null;

    const top = Number(line.top);
    const bottom = Number(line.bottom);

    if (!isFinite(top) || !isFinite(bottom)) return null;

    let lowest = null;

    words.forEach(function (word) {
        const center =
            (Number(word.y) || 0) + (Number(word.height) || 0) / 2;

        if (center < top - 2 || center > bottom + 2) return;

        const confidence = Number(word.confidence);

        if (!isFinite(confidence)) return;

        if (lowest === null || confidence < lowest) {
            lowest = confidence;
        }
    });

    return lowest;
}

function round4(value) {
    return Math.round(Number(value) * 10000) / 10000;
}

// เก็บผังหน้าเป็นพิกัดสัดส่วน (0-1) เพื่อจับคู่หน้าที่หน้าตาใกล้กันได้
// ไม่ขึ้นกับความละเอียดที่ใช้ OCR และไม่ขึ้นกับว่าผู้ใช้สแกนมาที่กี่ DPI
//
// pageKey มาจากผัง (ตำแหน่งกล่อง) ไม่ใช่ข้อความ — หน้าเดิมที่อ่านซ้ำ
// จะอัปเดตแถวเดิมแทนการสร้างแถวใหม่ ข้อความที่ได้จึงถูกเก็บเพิ่มเรื่อย ๆ
function buildPageBlueprint(page, width, height, lines, source, fixedCount) {
    if (!(width > 0) || !(height > 0)) return null;

    const boxes = [];

    (lines || []).forEach(function (line) {
        const text = String((line && line.text) || "").trim();

        if (text === "") return;

        const left = Number(line.left);
        const right = Number(line.right);
        const top = Number(line.top);
        const bottom = Number(line.bottom);

        if (![left, right, top, bottom].every(isFinite)) return;

        boxes.push({
            t: text,
            x: round4(left / width),
            y: round4(top / height),
            w: round4((right - left) / width),
            h: round4((bottom - top) / height)
        });
    });

    if (boxes.length === 0) return null;

    const aspect = round4(height / width);

    const fingerprint = aspect.toFixed(3) + "|" + boxes
        .map(function (box) {
            return [box.x, box.y, box.w, box.h].join(",");
        })
        .join(";");

    return {
        page: page,
        pageKey: crypto
            .createHash("sha1")
            .update(fingerprint)
            .digest("hex"),
        aspect: aspect,
        width: Math.round(width),
        height: Math.round(height),
        source: source || "local",
        fixedCount: Number(fixedCount) || 0,
        lines: boxes
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

// ──────────────────────────────────────────────────────────────
// ลำดับการอ่านตามคอลัมน์ที่ฝึกไว้
// ──────────────────────────────────────────────────────────────

// สัดส่วนหน้า (สูง/กว้าง) ต่างกันได้ไม่เกินนี้ = ถือว่าเป็นรูปแบบเดียวกัน
const MAX_LAYOUT_ASPECT_DIFF = 0.06;

// หารูปแบบที่ใกล้ที่สุด (ต้องเป็นแนวเดียวกันด้วย — แนวนอน/แนวตั้ง)
function findPageLayout(layouts, width, height) {
    if (!Array.isArray(layouts) || layouts.length === 0) return null;
    if (!(width > 0) || !(height > 0)) return null;

    const aspect = height / width;

    let best = null;
    let bestDiff = Infinity;

    layouts.forEach(function (layout) {
        const bands = Array.isArray(layout && layout.bands) ? layout.bands : [];
        const stored = Number(layout && layout.aspect);

        if (bands.length < 2) return;
        if (!isFinite(stored) || stored <= 0) return;
        if ((stored > 1) !== (aspect > 1)) return;

        const diff = Math.abs(stored - aspect) / stored;

        if (diff > MAX_LAYOUT_ASPECT_DIFF) return;
        if (diff >= bestDiff) return;

        best = { bands: bands, aspect: stored };
        bestDiff = diff;
    });

    return best;
}

// เรียงคำของหน้า OCR เข้าคอลัมน์ตามช่วง x ที่ฝึกไว้ แล้วอ่านทีละคอลัมน์
// (คำตอบแทนการอ่านทีละบรรทัดที่คำของหลายคอลัมน์ปนกัน — เช่นตาราง)
function linesFromLayout(words, width, height, bands) {
    const columns = bands.map(function () {
        return [];
    });

    (words || []).forEach(function (word) {
        const text = word && typeof word.text === "string"
            ? word.text.trim()
            : "";

        if (text === "") return;

        const center =
            ((Number(word.x) || 0) + (Number(word.width) || 0) / 2) / width;

        let index = -1;

        for (let i = 0; i < bands.length; i++) {
            if (center >= bands[i].from && center < bands[i].to) {
                index = i;
                break;
            }
        }

        // เลยนอกช่วง (ขอบกระดาษ) = ใช้คอลัมน์ที่ใกล้ที่สุด
        if (index === -1) {
            let bestDistance = Infinity;

            bands.forEach(function (band, bandIndex) {
                const distance = center < band.from
                    ? band.from - center
                    : center - band.to;

                if (distance < bestDistance) {
                    bestDistance = distance;
                    index = bandIndex;
                }
            });
        }

        if (index >= 0) columns[index].push(word);
    });

    const lines = [];

    columns.forEach(function (list) {
        if (list.length === 0) return;

        list.sort(function (a, b) {
            return (Number(a.y) || 0) - (Number(b.y) || 0) ||
                (Number(a.x) || 0) - (Number(b.x) || 0);
        });

        const heights = list
            .map(function (word) {
                return Number(word.height) || 0;
            })
            .filter(function (value) {
                return value > 0;
            })
            .sort(function (a, b) {
                return a - b;
            });

        const medianHeight = heights.length > 0
            ? heights[Math.floor(heights.length / 2)]
            : 10;

        // ความสูงของคำในบรรทัดเดียวกันอาจต่างกัน (สระบน/วรรณยุกต์)
        const tolerance = Math.max(2, medianHeight * 0.5);

        let current = null;

        list.forEach(function (word) {
            const y = Number(word.y) || 0;
            const x = Number(word.x) || 0;
            const wordWidth = Number(word.width) || 0;
            const wordHeight = Number(word.height) || 0;

            if (!current || Math.abs(y - current.y) > tolerance) {
                current = {
                    y: y,
                    words: [],
                    left: x,
                    right: x + wordWidth,
                    top: y,
                    bottom: y + wordHeight
                };
                lines.push(current);
            }

            current.words.push(word);
            current.left = Math.min(current.left, x);
            current.right = Math.max(current.right, x + wordWidth);
            current.top = Math.min(current.top, y);
            current.bottom = Math.max(current.bottom, y + wordHeight);
        });
    });

    return lines
        .map(function (line) {
            return {
                text: line.words
                    .map(function (word) {
                        return String(word.text).trim();
                    })
                    .join(" "),
                left: line.left,
                right: line.right,
                top: line.top,
                bottom: line.bottom,
                hadSpaceAfter: false
            };
        })
        .filter(function (line) {
            return line.text.trim() !== "";
        });
}

/**
 * อ่านข้อความทุกหน้าของ PDF (หน้าไหนไม่มีชั้นข้อความจะ OCR ให้)
 *
 * @param {Uint8Array|Buffer} data เนื้อไฟล์ PDF
 * @param {Object} [options]
 *   ocr        = false เพื่อปิดการ OCR (อ่านเฉพาะชั้นข้อความ)
 *   joinLines  = false เพื่อไม่เย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่ (ค่าเริ่มต้น = เย็บ)
 *   layouts    = ลำดับการอ่าน/คอลัมน์ที่ฝึกไว้ [{ bands: [{from,to}], aspect }]
 *                — หน้าทีมีสัดส่วนใกล้เคียงจะถูกอ่านทีละคอลัมน์ตามที่ฝึก
 *   scale      = ความละเอียดที่ใช้ OCR (ตัวคูณจาก 72 DPI, ค่าเริ่มต้น ~200 DPI)
 *   ai         = { enabled, apiKeys: [{id, value}], model, prompt, structure }
 *                ให้ AI ช่วยแก้คำหลัง tesseract (สลับ key เองเมื่อโควตาหมด)
 *                (ไม่ส่ง/ปิด = ใช้ข้อความ tesseract อย่างเดียว)
 *   blueprints = ผังหน้าที่เคยอ่านไว้ [{ aspect, lines }] — ใช้จับคู่หน้า
 *                และเรียงลำดับบรรทัด/คอลัมน์เองโดยไม่ต้องใช้ AI
 *   langPath/workerPath = ทับค่าที่ใช้อยู่ (สำหรับทดสอบ)
 *   onProgress = ฟังก์ชันรับความคืบหน้า { page, pageCount, status, progress }
 *                status = reading | ocr | ai
 * @returns {Promise<{text:string, ocrPages:number[], ocrError:string|null,
 *                    pages:Array, joined:number, aiPages:number[], aiError:string|null,
 *                    aiCorrections:Array, aiUsage:Object|null, blueprints:Array,
 *                    blueprintPages:number[]}>}
 *   pages = หน้าที่ผ่าน OCR พร้อมภาพตัวอย่างและตำแหน่งคำ (สำหรับตรวจคำบน PDF)
 *   joined = จำนวนจุดที่เย็บบรรทัดเข้าด้วยกัน
 *   aiCorrections = คู่คำที่ AI แก้ — เก็บลงคลังคำเพื่อใช้ตอน AI ปิด
 *   blueprints = ผังหน้า (พิกัดสัดส่วน) + ข้อความหลังแก้
 *   blueprintPages = หน้าที่ใช้ผังเดิมจัดลำดับบรรทัด
 */
async function extractPdfText(data, options) {
    const opts = options || {};
    const useOcr = opts.ocr !== false;
    const joinLines = opts.joinLines !== false;

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
    const blueprints = [];
    const blueprintPages = [];
    const aiPages = [];
    // หน้าที่ AI จัดเป็นบรรทัด "หัวข้อ: ค่า" แล้ว
    const structuredPages = [];
    const aiCorrections = [];
    let aiUsage = null;
    let aiError = null;
    let ocrError = null;

    // AI จะทำงานเฉพาะเมื่อเปิดไว้และมี key — ไม่งั้นทุกอย่างเหมือนเดิมทุกประการ
    const aiConfig =
        opts.ai &&
        opts.ai.enabled &&
        Array.isArray(opts.ai.apiKeys) &&
        opts.ai.apiKeys.length > 0
            ? opts.ai
            : null;

    // จำนวนจุดที่เย็บบรรทัด (รายงานให้หน้าจอรู้ว่าทำอะไรไปบ้าง)
    let joinedCount = 0;

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

                // บรรทัดจากชั้นข้อความ พร้อมพิกัด (ใช้เย็บบรรทัดที่ถูกตัด)
                let textLayerLines = [];
                let pageText = "";

                try {
                    const content = await page.getTextContent();

                    textLayerLines = pageLines(content.items || []);
                    pageText = textLayerLines
                        .map(function (line) {
                            return line.text;
                        })
                        .join("\n");
                } catch (error) {
                    // อ่านชั้นข้อความไม่ได้ = ยังเหลือทาง OCR
                    textLayerLines = [];
                    pageText = "";
                }

                const quality = textUsability(pageText);

                // หน้าเปล่า/มีข้อความน้อย หรือข้อความที่ได้เป็นขยะ → OCR
                const needsOcr =
                    quality.length < MIN_TEXT_CHARS ||
                    !quality.usable;

                // บรรทัดจาก OCR (มีพิกัดเป็นหน่วย pixel ของภาพตัวอย่าง)
                let ocrLines = [];
                // หน้านี้ถูกจัดลำดับใหม่ตามคอลัมน์ที่ฝึกไว้หรือไม่
                let layoutApplied = false;
                // ข้อความ "หัวข้อ: ค่า" ที่ AI จัดให้ของหน้านี้ (null = ใช้บรรทัดปกติ)
                let structuredText = null;

                if (useOcr && needsOcr) {
                    try {
                        const ocr = await ocrPage(page, ocrOptions);

                        if (ocr.text !== "") {
                            ocrPages.push(pageNumber);

                            ocrLines = Array.isArray(ocr.lines) && ocr.lines.length > 0
                                ? ocr.lines
                                : String(ocr.text).split("\n").map(function (text) {
                                    return { text: text };
                                });

                            // มีรูปแบบที่ฝึกไว้และหน้าใกล้เคียง = อ่านทีละคอลัมน์
                            const layout = findPageLayout(
                                opts.layouts,
                                ocr.width,
                                ocr.height
                            );

                            if (layout && Array.isArray(ocr.words) && ocr.words.length > 0) {
                                const rebuilt = linesFromLayout(
                                    ocr.words,
                                    ocr.width,
                                    ocr.height,
                                    layout.bands
                                );

                                if (rebuilt.length > 0) {
                                    // บรรทัดที่จับกล่องไม่ได้ (ไม่มีคำ) ต่อท้ายไว้ ไม่ให้ข้อความหาย
                                    const orphans = ocrLines
                                        .filter(function (line) {
                                            return !isFinite(Number(line.left));
                                        })
                                        .map(function (line) {
                                            return { text: line.text };
                                        });

                                    ocrLines = rebuilt.concat(orphans);
                                    layoutApplied = true;
                                }
                            }

                            // ── ใช้ผังหน้าที่เคยอ่านไว้ (โดยไม่ต้องใช้ AI) ──
                            // หน้าแบบเดิม (ฟอร์ม/ตารางหลายคอลัมน์) ถูกอ่านซ้ำทุกวัน
                            // ถ้าผังเดิมบอกลำดับบรรทัดที่ถูกต้องแล้ว ก็ใช้ลำดับนั้นเลย
                            // (ถ้ามีผู้ฝึกลำดับคอลัมน์ไว้แล้ว ให้การฝึกของคนมาก่อน)
                            if (!layoutApplied) {
                                const blueprintMatch = findBlueprint(
                                    opts.blueprints,
                                    ocr.width,
                                    ocr.height,
                                    ocrLines
                                );

                                if (blueprintMatch) {
                                    const ordered = orderLinesByBlueprint(
                                        blueprintMatch,
                                        ocrLines,
                                        ocr.width,
                                        ocr.height
                                    );

                                    // ตรงกันมากพอแล้ว = ใช้ลำดับจากผัง (ถึงแม้ลำดับ
                                    // บังเอิญเหมือนเดิม ก็นับว่าใช้ผังนี้)
                                    if (ordered.matched >= MIN_BLUEPRINT_LINES) {
                                        ocrLines = ordered.lines;
                                        blueprintPages.push(pageNumber);
                                    }
                                }
                            }

                            // ── AI ช่วยแก้คำที่ tesseract อ่านผิด ──
                            // ส่งเฉพาะ "ข้อความ" กับภาพ — tesseract ยังเป็นคนหา
                            // ตำแหน่งคำ/กล่อง จึงตรวจคำบนภาพได้เหมือนเดิม
                            let aiUsed = false;
                            let fixedCount = 0;

                            if (aiConfig) {
                                if (typeof opts.onProgress === "function") {
                                    opts.onProgress({
                                        page: pageNumber,
                                        pageCount: document.numPages,
                                        status: "ai"
                                    });
                                }

                                const ai = await correctOcrLines(aiConfig, {
                                    image: ocr.image,
                                    lines: ocrLines.map(function (line, index) {
                                        return {
                                            id: index + 1,
                                            text: String(line.text || "")
                                        };
                                    })
                                });

                                if (ai.ok && Array.isArray(ai.lines)) {
                                    aiUsed = true;

                                    if (ai.usage) {
                                        aiUsage = aiUsage || {
                                            promptTokenCount: 0,
                                            candidatesTokenCount: 0,
                                            totalTokenCount: 0
                                        };

                                        aiUsage.promptTokenCount +=
                                            Number(ai.usage.promptTokenCount) || 0;
                                        aiUsage.candidatesTokenCount +=
                                            Number(ai.usage.candidatesTokenCount) || 0;
                                        aiUsage.totalTokenCount +=
                                            Number(ai.usage.totalTokenCount) || 0;
                                    }

                                    const pairs = [];

                                    ai.lines.forEach(function (corrected) {
                                        const index =
                                            Math.floor(Number(corrected.id)) - 1;
                                        const line = ocrLines[index];

                                        if (!line) return;

                                        const before =
                                            String(line.text || "").trim();
                                        const after =
                                            String(corrected.text || "").trim();

                                        if (after === "" || after === before) {
                                            return;
                                        }

                                        pairs.push({
                                            before: before,
                                            after: after,
                                            confidence: lineConfidence(
                                                line,
                                                ocr.words
                                            )
                                        });

                                        line.text = after;
                                        fixedCount += 1;
                                    });

                                    // เก็บคู่คำที่แก้ไว้ใช้แทนอัตโนมัติเมื่อ AI ปิด
                                    buildLearnedFixes(pairs).forEach(function (fix) {
                                        aiCorrections.push(fix);
                                    });

                                    // AI จัด "หัวข้อ: ค่า" มาให้ = ใช้เป็นข้อความของหน้า
                                    // (ผังหน้ายังสร้างจากบรรทัดจริงของ tesseract ด้านล่าง)
                                    if (
                                        Array.isArray(ai.structured) &&
                                        ai.structured.length > 0
                                    ) {
                                        const rows = [];

                                        ai.structured.forEach(function (item) {
                                            const title = String(
                                                (item && item.title) || ""
                                            ).trim();
                                            const value = String(
                                                (item && item.value) || ""
                                            ).trim();

                                            if (title === "" || value === "") return;

                                            rows.push(title + ": " + value);
                                        });

                                        if (rows.length > 0) {
                                            structuredText = rows.join("\n");
                                            structuredPages.push(pageNumber);
                                        }
                                    }

                                    aiPages.push(pageNumber);
                                } else {
                                    // AI ใช้ไม่ได้ = ใช้ข้อความ tesseract ต่อ
                                    // (ไม่ทำให้ทั้งไฟล์อ่านไม่ได้)
                                    aiError = ai.error ||
                                        ("AI อ่านหน้า " + pageNumber + " ไม่สำเร็จ");
                                }
                            }

                            // ผังหน้า + ข้อความหลังแก้ — เก็บไว้จับคู่หน้าที่ใกล้กัน
                            // ตอน AI ปิด (และเป็นสถิติว่าอ่านหน้าแบบไหนไปบ้าง)
                            const blueprint = buildPageBlueprint(
                                pageNumber,
                                ocr.width,
                                ocr.height,
                                ocrLines,
                                aiUsed ? "ai" : "local",
                                fixedCount
                            );

                            if (blueprint) blueprints.push(blueprint);
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
                            textLayerLines = [];
                        }
                    }
                }

                // ข้อความที่ใช้จริงของหน้านี้ — แยกกลุ่มตามแหล่ง เพราะพิกัดของ
                // ชั้นข้อความ (pt) กับ OCR (px) คนละหน่วย จึงเย็บข้ามกลุ่มไม่ได้
                const sources = [];

                if (quality.usable && textLayerLines.length > 0) {
                    sources.push({ lines: textLayerLines, join: joinLines });
                }

                if (structuredText !== null) {
                    // ใช้ข้อความที่ AI จัดหัวข้อแล้วก่อน (regex "หัวข้อ: ค่า" จับง่าย)
                    sources.push({
                        lines: structuredText.split("\n").map(function (line) {
                            return { text: line };
                        }),
                        join: false
                    });

                    // AI มักจัดมาไม่ครบทุกช่อง — บรรทัดที่ยังไม่ถูกนำไปใส่
                    // ต้องไม่หายไปจากข้อความของหน้า
                    const covered = comparableText(structuredText);

                    const leftovers = ocrLines.filter(function (line) {
                        const text = String((line && line.text) || "").trim();

                        if (text === "") return false;

                        return covered.indexOf(comparableText(text)) === -1;
                    });

                    if (leftovers.length > 0) {
                        // ไม่เย็บบรรทัดตรงนี้ — กันช่องข้อมูลที่อยู่คนละบรรทัดถูกเชื่อมติดกัน
                        // จน regex แยกค่าไม่ได้
                        sources.push({
                            lines: leftovers,
                            join: false
                        });
                    }
                } else if (ocrLines.length > 0) {
                    // หน้านี้จัดลำดับตามคอลัมน์แล้ว = ไม่ต้องเย็บบรรทัด (คนละคอลัมน์)
                    sources.push({
                        lines: ocrLines,
                        join: joinLines && !layoutApplied
                    });
                }

                const pageParts = [];

                sources.forEach(function (source) {
                    const result = source.join
                        ? joinWrappedLines(source.lines)
                        : {
                            lines: source.lines.map(function (line) {
                                return line.text;
                            }),
                            joined: 0
                        };

                    joinedCount += result.joined;

                    const text = result.lines.join("\n");

                    if (text !== "") pageParts.push(text);
                });

                pageText = pageParts.join("\n");

                if (pageText !== "") lines.push(pageText);

            } finally {
                page.cleanup();
            }
        }
    } finally {
        await document.destroy();
    }

    // คำเดิมที่ถูกแก้เหมือนกันหลายหน้า/หลายครั้ง — เก็บครั้งเดียว
    const correctionsByWord = {};

    aiCorrections.forEach(function (fix) {
        if (!fix || !fix.wrong) return;

        if (!correctionsByWord[fix.wrong]) {
            correctionsByWord[fix.wrong] = fix;
        }
    });

    return {
        text: lines.join("\n"),
        ocrPages: ocrPages,
        ocrError: ocrError,
        pages: pages,
        joined: joinedCount,
        // หน้าที่ใช้ผังที่จำไว้จัดลำดับบรรทัด/คอลัมน์ (ไม่ใช้ AI)
        blueprintPages: blueprintPages,
        aiPages: aiPages,
        structuredPages: structuredPages,
        aiError: aiError,
        aiCorrections: Object.keys(correctionsByWord).map(function (key) {
            return correctionsByWord[key];
        }),
        aiUsage: aiUsage,
        blueprints: blueprints
    };
}

module.exports = {
    extractPdfText: extractPdfText,
    MIN_TEXT_CHARS: MIN_TEXT_CHARS
};
