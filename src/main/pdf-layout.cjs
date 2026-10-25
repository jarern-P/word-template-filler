// วิเคราะห์โครงสร้างเอกสาร (Document Layout Analysis) และลำดับการอ่าน
// สำหรับ PDF ทั้งไฟล์ที่มีชั้นข้อความและไฟล์สแกน
//
// ใช้ PP-DocLayoutV2 (ONNX) ผ่านไลบรารี ppu-doclayout ในการหาบล็อกต่าง ๆ
// (หัวเรื่อง/ย่อหน้า/ตาราง/รูป/หัวกระดาษ/ท้ายกระดาษ ฯลฯ) แล้วจับบรรทัดข้อความ
// ของแต่ละบล็อก:
//   - หน้าที่มีชั้นข้อความ = ใช้พิกัดข้อความจริงในไฟล์ (แม่นยำ)
//   - หน้าที่เป็นรูปสแกน   = OCR ด้วย PP-OCRv5 ในเครื่อง (เร็ว) เพื่อให้ได้พิกัดบรรทัด
//
// โมเดล PP-DocLayoutV2 (~213 MB) ดาวน์โหลดครั้งแรกแล้วเก็บที่ data/layout/
// ไม่มีข้อมูลออกจากเครื่องหลังดาวน์โหลด
'use strict';

const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

// pdf.js polyfill DOMMatrix/Path2D จาก @napi-rs/canvas (เหมือน pdf-text.cjs)
let napiCanvas = null;

try {
    napiCanvas = require('@napi-rs/canvas');

    if (!globalThis.DOMMatrix && napiCanvas.DOMMatrix) {
        globalThis.DOMMatrix = napiCanvas.DOMMatrix;
    }

    if (!globalThis.Path2D && napiCanvas.Path2D) {
        globalThis.Path2D = napiCanvas.Path2D;
    }
} catch (error) {
    napiCanvas = null;
}

const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');

const { renderPageToPng, recognizePng } = require('./ocr-paddle.cjs');

const { joinWrappedLines } = require('./line-join.cjs');

// ความละเอียดที่ใช้เรนเดอร์หน้า (เท่ากับ OCR ปกติ ~200 DPI)
// พิกัดจากโมเดล layout และพิกัดบรรทัดจาก OCR จึงอยู่ในหน่วยพิกเซลเดียวกัน
const PAGE_SCALE = 200 / 72;

// ต้องตรงกับ MAX_PIXEL_SIDE ของ ocr-paddle.cjs (หน้าที่ยาวเกินจะถูกย่อ)
const MAX_PIXEL_SIDE = 4000;

function pageScaleOf(page) {
    const base = page.getViewport({ scale: 1 });
    const longest = Math.max(base.width, base.height);

    if (longest > 0 && longest * PAGE_SCALE > MAX_PIXEL_SIDE) {
        return MAX_PIXEL_SIDE / longest;
    }

    return PAGE_SCALE;
}

// PP-DocLayoutV2 — ไฟล์เดียวจบ (~213 MB)
const MODEL_URL =
    'https://media.githubusercontent.com/media/PT-Perkasa-Pilar-Utama/' +
    'ppu-paddle-ocr-models/main/layout/PP-DocLayoutV2.onnx';

const MODEL_SIZE = 213303073;

const MODEL_FILE = 'PP-DocLayoutV2.onnx';

// ชื่อบล็อกของโมเดล → ชื่อที่แสดงบนหน้าจอ
const LABELS_TH = {
    abstract: 'บทคัดย่อ',
    algorithm: 'อัลกอริทึม',
    aside_text: 'ข้อความข้างเคียง',
    chart: 'แผนภูมิ',
    content: 'เนื้อหา',
    display_formula: 'สูตร',
    doc_title: 'ชื่อเอกสาร',
    figure_title: 'ชื่อรูป',
    footer: 'ท้ายกระดาษ',
    footer_image: 'รูปท้ายกระดาษ',
    footnote: 'เชิงอรรถ',
    formula_number: 'หมายเลขสูตร',
    header: 'หัวกระดาษ',
    header_image: 'รูปหัวกระดาษ',
    image: 'รูปภาพ',
    inline_formula: 'สูตรในบรรทัด',
    number: 'หมายเลขหน้า',
    paragraph_title: 'หัวข้อย่อหน้า',
    reference: 'เอกสารอ้างอิง',
    reference_content: 'เนื้อหาอ้างอิง',
    seal: 'ตราประทับ',
    table: 'ตาราง',
    text: 'ข้อความ',
    vertical_text: 'ข้อความแนวตั้ง',
    vision_footnote: 'เชิงอรรถ (ภาพ)'
};

// บล็อกที่ไม่ควรมีข้อความ (หรือมีแต่ไม่ใช่เนื้อหา)
const SKIP_TEXT_LABELS = {
    image: true,
    header_image: true,
    footer_image: true,
    seal: true,
    chart: true
};

let servicePromise = null;
let service = null;

function layoutDir(dataPath) {
    return path.join(path.resolve(dataPath), 'layout');
}

function modelPath(dataPath) {
    return path.join(layoutDir(dataPath), MODEL_FILE);
}

function modelState(dataPath) {
    try {
        const stat = fs.statSync(modelPath(dataPath));

        return {
            exists: stat.isFile(),
            bytes: stat.size,
            complete: stat.size === MODEL_SIZE
        };

    } catch (error) {
        return {
            exists: false,
            bytes: 0,
            complete: false
        };
    }
}

function status(dataPath) {
    const state = modelState(dataPath);

    return {
        ready: state.complete,
        modelBytes: state.bytes,
        expectedBytes: MODEL_SIZE,
        modelPath: modelPath(dataPath),
        loading: Boolean(servicePromise) || Boolean(service),
        language: 'ไทย + อังกฤษ (PP-DocLayoutV2)'
    };
}

// ------------------------------------------------------------------
// ดาวน์โหลดโมเดล (ต่อจากไฟล์ .part เดิมได้)
// ------------------------------------------------------------------

async function downloadModel(dataPath, emit) {
    const destination = modelPath(dataPath);
    const temp = destination + '.part';

    const state = modelState(dataPath);

    if (state.complete) return;

    fs.mkdirSync(layoutDir(dataPath), { recursive: true });

    // ไฟล์เดิมมีขนาดเกิน/เท่าแต่ไม่ครบ = เริ่มใหม่
    let start = 0;

    try {
        start = fs.statSync(temp).size;
    } catch (error) {
        start = 0;
    }

    if (start > MODEL_SIZE) {
        fs.rmSync(temp, { force: true });
        start = 0;
    }

    const total = MODEL_SIZE;

    emit({
        stage: 'download',
        label: 'กำลังดาวน์โหลดโมเดลวิเคราะห์ Layout',
        received: start,
        total: total,
        percent: Math.floor((start / total) * 100)
    });

    const response = await fetch(MODEL_URL, {
        headers: start > 0 ? { Range: 'bytes=' + start + '-' } : {}
    });

    if (!response.ok && response.status !== 206) {
        throw new Error(
            'ดาวน์โหลดโมเดลวิเคราะห์ Layout ไม่สำเร็จ (HTTP ' +
            response.status + ')'
        );
    }

    if (!response.body) {
        throw new Error('ดาวน์โหลดโมเดลวิเคราะห์ Layout ไม่สำเร็จ (ไม่ได้รับข้อมูล)');
    }

    let received = start;
    let lastEmit = 0;

    const progress = new Transform({
        transform(chunk, encoding, callback) {
            received += chunk.length;

            const now = Date.now();

            // แจ้งหน้าจอเป็นระยะ ไม่ให้ถี่เกินไป
            if (now - lastEmit >= 400) {
                lastEmit = now;

                emit({
                    stage: 'download',
                    label: 'กำลังดาวน์โหลดโมเดลวิเคราะห์ Layout',
                    received: received,
                    total: total,
                    percent: Math.min(100, Math.floor((received / total) * 100))
                });
            }

            callback(null, chunk);
        }
    });

    await pipeline(
        Readable.fromWeb(response.body),
        progress,
        fs.createWriteStream(temp, { flags: start > 0 ? 'a' : 'w' })
    );

    const finalState = (function () {
        try {
            return fs.statSync(temp).size;
        } catch (error) {
            return 0;
        }
    })();

    if (finalState !== MODEL_SIZE) {
        throw new Error(
            'ไฟล์โมเดลวิเคราะห์ Layout ไม่ครบ (' +
            finalState + '/' + MODEL_SIZE + ' ไบต์) — ลองอีกครั้ง'
        );
    }

    fs.renameSync(temp, destination);
}

// ------------------------------------------------------------------
// โหลดโมเดลเข้า ONNX Runtime
// ------------------------------------------------------------------

async function getService(dataPath, emit) {
    if (service) return service;

    if (servicePromise) return servicePromise;

    servicePromise = (async function () {
        await downloadModel(dataPath, emit);

        emit({
            stage: 'init',
            label: 'กำลังโหลดโมเดลวิเคราะห์ Layout',
            received: 0,
            total: 0,
            percent: 0
        });

        const module = await import('ppu-doclayout');

        const instance = new module.DocLayoutService({
            model: { model: modelPath(dataPath) },
            detection: {
                threshold: 0.5
            },
            session: {
                executionProviders: ['cpu'],
                graphOptimizationLevel: 'all',
                enableCpuMemArena: true,
                enableMemPattern: true,
                executionMode: 'sequential'
            }
        });

        await instance.initialize();

        service = instance;

        return instance;

    })().catch(function (error) {
        servicePromise = null;

        throw new Error(
            'เตรียมโมเดลวิเคราะห์ Layout ไม่สำเร็จ: ' +
            ((error && error.message) || 'ไม่ทราบสาเหตุ')
        );
    });

    return servicePromise;
}

function stop() {
    if (!service) return;

    try {
        service.destroy();
    } catch (error) {
        // โมเดลอาจถูกปล่อยไปแล้ว
    }

    service = null;
    servicePromise = null;
}

// ------------------------------------------------------------------
// ข้อความจากชั้นข้อความของหน้า (พิกัดพิกเซลของภาพที่เรนเดอร์)
// ------------------------------------------------------------------

function createCanvasFactory() {
    if (!napiCanvas) return undefined;

    return {
        create: function (width, height) {
            const canvas = napiCanvas.createCanvas(width, height);

            return {
                canvas: canvas,
                context: canvas.getContext('2d')
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

async function textLayerLines(page, scale) {
    const viewport = page.getViewport({ scale: scale });
    const content = await page.getTextContent();
    const items = [];

    (content.items || []).forEach(function (item) {
        const text = item && typeof item.str === 'string' ? item.str : '';

        if (text === '') return;

        const transform = item.transform || [];
        const matrix = pdfjs.Util.transform(viewport.transform, transform);

        const x = Number(matrix[4]) || 0;
        const baseline = Number(matrix[5]) || 0;
        const fontHeight =
            (Number(item.height) || Math.hypot(matrix[2], matrix[3]) || 10) *
            (Number(scale) || 1);

        items.push({
            text: text,
            x: x,
            baseline: baseline,
            width: (Number(item.width) || 0) * (Number(scale) || 1),
            height: fontHeight || 10
        });
    });

    items.sort(function (a, b) {
        return (a.baseline - b.baseline) || (a.x - b.x);
    });

    const lines = [];

    items.forEach(function (item) {
        const tolerance = Math.max(2, item.height * 0.4);
        let line = lines.length > 0 ? lines[lines.length - 1] : null;

        if (!line || Math.abs(line.baseline - item.baseline) > tolerance) {
            line = {
                baseline: item.baseline,
                parts: [],
                height: item.height
            };

            lines.push(line);
        }

        line.height = Math.max(line.height, item.height);
        line.parts.push(item);
    });

    const output = [];

    lines.forEach(function (line) {
        line.parts.sort(function (a, b) {
            return a.x - b.x;
        });

        // แยกส่วนที่อยู่คนละคอลัมน์ (ช่องว่างแนวนอนใหญ่ผิดปกติ) ออกจากบรรทัดเดียวกัน
        // เอกสาร 2 คอลัมน์มีข้อความระดับ y เดียวกัน — ไม่ควรถูกรวมเป็นบรรทัดเดียว
        const columns = [];
        let run = [];
        let previousEnd = null;
        const splitGap = Math.max(20, line.height * 2.5);

        line.parts.forEach(function (part) {
            if (previousEnd !== null && part.x - previousEnd > splitGap) {
                columns.push(run);
                run = [];
            }

            run.push(part);
            previousEnd = part.x + part.width;
        });

        columns.push(run);

        columns.forEach(function (parts) {
            let text = '';
            let end = null;

            parts.forEach(function (part) {
                if (end !== null) {
                    const gap = part.x - end;

                    if (
                        gap > 1.2 * (Number(scale) || 1) &&
                        !/\s$/.test(text) &&
                        !/^\s/.test(part.text)
                    ) {
                        text += ' ';
                    }
                }

                text += part.text;
                end = part.x + part.width;
            });

            const cleaned = text.replace(/\s+/g, ' ').trim();

            if (cleaned === '') return;

            output.push({
                text: cleaned,
                left: Math.min.apply(null, parts.map(function (part) {
                    return part.x;
                })),
                right: Math.max.apply(null, parts.map(function (part) {
                    return part.x + part.width;
                })),
                top: line.baseline - line.height,
                bottom: line.baseline + line.height * 0.25
            });
        });
    });

    return output;
}

// ข้อความในชั้นข้อความใช้ได้จริงหรือไม่ (กันฟอนต์ Type3 ที่ได้รหัส glyph)
function usableText(text) {
    const chars = String(text || '').replace(/\s/g, '');

    if (chars.length < 20) return false;

    const bad = (chars.match(/[\u0000-\u001f\u007f-\u009f\ue000-\uf8ff\ufffd]/g) || []).length;
    const letters = (chars.match(/[0-9A-Za-z\u0E00-\u0E7F]/g) || []).length;

    return bad / chars.length <= 0.02 && letters / chars.length >= 0.4;
}

// ------------------------------------------------------------------
// ลำดับการอ่าน
// ------------------------------------------------------------------

function centerX(region) {
    return region.x + region.width / 2;
}

function centerY(region) {
    return region.y + region.height / 2;
}

// ช่องว่างที่กว้างที่สุดระหว่างบล็อก (ใช้ตัดหน้าเป็นแถบ/คอลัมน์)
function largestGap(regions, axis) {
    const intervals = regions
        .map(function (region) {
            return axis === 'y'
                ? [region.y, region.y + region.height]
                : [region.x, region.x + region.width];
        })
        .sort(function (a, b) {
            return a[0] - b[0];
        });

    let end = intervals[0][1];
    let best = null;

    for (let index = 1; index < intervals.length; index++) {
        const start = intervals[index][0];

        if (start > end) {
            const size = start - end;

            if (!best || size > best.size) {
                best = {
                    size: size,
                    at: end + size / 2
                };
            }
        }

        end = Math.max(end, intervals[index][1]);
    }

    return best;
}

// XY-cut: ตัดด้วยช่องว่างแนวนอน (แถบ) ก่อน แล้วจึงตัดด้วยช่องว่างแนวตั้ง
// (คอลัมน์) — ทำให้เอกสาร 2 คอลัมน์อ่านคอลัมน์ซ้ายจบก่อนแล้วจึงไปขวา
function xyOrder(regions, pageWidth, pageHeight) {
    if (regions.length <= 1) return regions.slice();

    const sorted = regions.slice().sort(function (a, b) {
        return (a.y - b.y) || (a.x - b.x);
    });

    const horizontal = largestGap(regions, 'y');

    if (horizontal && horizontal.size >= Math.max(12, pageHeight * 0.008)) {
        const top = regions.filter(function (region) {
            return centerY(region) < horizontal.at;
        });

        const bottom = regions.filter(function (region) {
            return centerY(region) >= horizontal.at;
        });

        if (top.length > 0 && bottom.length > 0) {
            return xyOrder(top, pageWidth, pageHeight)
                .concat(xyOrder(bottom, pageWidth, pageHeight));
        }
    }

    const vertical = largestGap(regions, 'x');

    if (vertical && vertical.size >= Math.max(20, pageWidth * 0.02)) {
        const left = regions.filter(function (region) {
            return centerX(region) < vertical.at;
        });

        const right = regions.filter(function (region) {
            return centerX(region) >= vertical.at;
        });

        if (left.length > 0 && right.length > 0) {
            return xyOrder(left, pageWidth, pageHeight)
                .concat(xyOrder(right, pageWidth, pageHeight));
        }
    }

    return sorted;
}

// เรียงบล็อกตามลำดับการอ่าน (แทนที่ลำดับที่โมเดลคืนมา
// ซึ่งเป็นแบบอ่านทีละบรรทัดและสลับคอลัมน์ในเอกสารหลายคอลัมน์)
function orderRegions(regions, pageWidth, pageHeight) {
    return xyOrder(regions, pageWidth, pageHeight);
}

// ------------------------------------------------------------------
// จับบรรทัดข้อความเข้ากับบล็อก layout
// ------------------------------------------------------------------

function lineBox(line) {
    return [line.left, line.top, line.right, line.bottom];
}

function overlapArea(a, b) {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);

    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function assignLines(regions, lines) {
    const buckets = regions.map(function () {
        return [];
    });

    const unmatched = [];

    lines.forEach(function (line) {
        const box = lineBox(line);
        const x = (box[0] + box[2]) / 2;
        const y = (box[1] + box[3]) / 2;

        let best = -1;
        let bestScore = 0;

        regions.forEach(function (region, index) {
            const regionBox = [
                region.x,
                region.y,
                region.x + region.width,
                region.y + region.height
            ];

            // อยู่ในบล็อก = ดีที่สุด (เลือกบล็อกที่เล็กที่สุดเมื่อซ้อนกัน)
            const inside =
                x >= regionBox[0] &&
                x <= regionBox[2] &&
                y >= regionBox[1] &&
                y <= regionBox[3];

            if (inside) {
                const area =
                    (regionBox[2] - regionBox[0]) *
                    (regionBox[3] - regionBox[1]);

                const score = 1e12 - area;

                if (score > bestScore) {
                    best = index;
                    bestScore = score;
                }

                return;
            }

            // ไม่ได้อยู่ตรงกลาง — ใช้พื้นที่ทับซ้อนมากที่สุด
            const score = overlapArea(box, regionBox);

            if (score > bestScore) {
                best = index;
                bestScore = score;
            }
        });

        // ยอมรับเฉพาะเมื่อทับซ้อนกันจริง (กันบรรทัดที่อยู่ห่างออกไป)
        if (best >= 0 && bestScore > 0) {
            buckets[best].push(line);
        } else {
            unmatched.push(line);
        }
    });

    // บรรทัดที่จับคู่ไม่ได้ = บล็อก "ข้อความ" ต่อท้ายหน้า
    if (unmatched.length > 0) {
        regions.push({
            label: 'text',
            score: 0,
            x: Math.min.apply(null, unmatched.map(function (line) {
                return line.left;
            })),
            y: Math.min.apply(null, unmatched.map(function (line) {
                return line.top;
            })),
            width: Math.max.apply(null, unmatched.map(function (line) {
                return line.right;
            })) - Math.min.apply(null, unmatched.map(function (line) {
                return line.left;
            })),
            height: Math.max.apply(null, unmatched.map(function (line) {
                return line.bottom;
            })) - Math.min.apply(null, unmatched.map(function (line) {
                return line.top;
            }))
        });

        buckets.push(unmatched);
    }

    return regions.map(function (region, index) {
        return {
            region: region,
            lines: (buckets[index] || []).slice().sort(function (a, b) {
                return (a.top - b.top) || (a.left - b.left);
            })
        };
    });
}

// ตัดภาพเฉพาะบล็อกออกมาให้ OCR (เว้นขอบเล็กน้อยกันตัวอักษรถูกตัด)
function cropRegion(canvasModule, image, region, pageWidth, pageHeight) {
    // เว้นขอบแนวนอนกันตัวอักษรหัว/ท้ายบรรทัดถูกตัด
    // แต่ไม่เว้นแนวตั้ง — ไม่เช่นนั้นวรรณยุกต์ของบรรทัดข้างเคียงจะติดเข้ามา
    const paddingX = 8;
    const paddingY = 1;

    const left = Math.max(0, Math.floor(region.x - paddingX));
    const top = Math.max(0, Math.floor(region.y - paddingY));
    const right = Math.min(pageWidth, Math.ceil(region.x + region.width + paddingX));
    const bottom = Math.min(pageHeight, Math.ceil(region.y + region.height + paddingY));

    const width = right - left;
    const height = bottom - top;

    if (width < 8 || height < 8) return null;

    const canvas = canvasModule.createCanvas(width, height);
    const context = canvas.getContext('2d');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, left, top, width, height, 0, 0, width, height);

    return canvas.toBuffer('image/png');
}

// ------------------------------------------------------------------
// วิเคราะห์ PDF ทั้งไฟล์
// ------------------------------------------------------------------

/**
 * @param {Uint8Array|Buffer} data เนื้อไฟล์ PDF
 * @param {Object} options
 *   dataPath  = โฟลเดอร์ data ของแอป (เก็บโมเดล)
 *   onProgress = รับ { stage, page, pageCount, ... }
 * @returns {Promise<{pageCount:number, pages:Array, text:string}>}
 */
async function analyzePdf(data, options) {
    const opts = options || {};
    const dataPath = opts.dataPath;

    // รวมบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่ภายในแต่ละบล็อก (ใช้กับปุ่มปรับข้อความหลัง OCR)
    const joinLines = opts.joinLines === true;

    if (!dataPath) {
        throw new Error('ไม่ได้ระบุตำแหน่งข้อมูลสำหรับวิเคราะห์ Layout');
    }

    const emit = typeof opts.onProgress === 'function'
        ? opts.onProgress
        : function () {};

    try {
        const layout = await getService(dataPath, emit);

        const task = pdfjs.getDocument({
            data: new Uint8Array(data),
            disableFontFace: true,
            isEvalSupported: false,
            useSystemFonts: true,
            canvasFactory: createCanvasFactory()
        });

        const document = await task.promise;
        const pages = [];

        try {
            for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
                const page = await document.getPage(pageNumber);

                emit({
                    stage: 'layout',
                    page: pageNumber,
                    pageCount: document.numPages,
                    label: 'กำลังวิเคราะห์โครงสร้างหน้า ' +
                        pageNumber + '/' + document.numPages
                });

                try {
                    const scale = pageScaleOf(page);
                    const png = await renderPageToPng(page, scale);

                    const viewport = page.getViewport({ scale: scale });
                    const pageWidth = Math.max(1, Math.floor(viewport.width));
                    const pageHeight = Math.max(1, Math.floor(viewport.height));

                    const result = await layout.analyze(png);

                    const boxes = (result && Array.isArray(result.boxes))
                        ? result.boxes
                        : [];

                    let source = 'text';
                    let lines = [];
                    let ocrError = null;

                    // 1) ลองใช้ชั้นข้อความก่อน
                    try {
                        lines = await textLayerLines(page, scale);
                    } catch (error) {
                        lines = [];
                    }

                    const layerText = lines.map(function (line) {
                        return line.text;
                    }).join('\n');

                    const regions = boxes.map(function (item) {
                        const box = item.box || [0, 0, 0, 0];

                        return {
                            label: item.label || 'text',
                            score: Number(item.score) || 0,
                            x: Number(box[0]) || 0,
                            y: Number(box[1]) || 0,
                            width: Math.max(0, (Number(box[2]) || 0) - (Number(box[0]) || 0)),
                            height: Math.max(0, (Number(box[3]) || 0) - (Number(box[1]) || 0))
                        };
                    });

                    let ordered = orderRegions(regions, pageWidth, pageHeight);
                    let pageRegions = [];

                    if (usableText(layerText)) {
                        const assigned = assignLines(ordered, lines);

                        ordered = assigned.map(function (entry) {
                            return entry.region;
                        });

                        const byRegion = new Map();

                        assigned.forEach(function (entry) {
                            byRegion.set(entry.region, entry.lines);
                        });

                        pageRegions = ordered.map(function (region, index) {
                            const regionLines = byRegion.get(region) || [];

                            const regionText = joinLines
                                ? joinWrappedLines(regionLines)
                                : null;

                            return {
                                index: index + 1,
                                label: region.label,
                                labelTh: LABELS_TH[region.label] || region.label,
                                score: region.score,
                                x: Math.round(region.x * 10) / 10,
                                y: Math.round(region.y * 10) / 10,
                                width: Math.round(region.width * 10) / 10,
                                height: Math.round(region.height * 10) / 10,
                                lineCount: regionLines.length,
                                text: regionText
                                    ? regionText.lines.join('\n')
                                    : regionLines.map(function (line) {
                                        return line.text;
                                    }).join('\n')
                            };
                        });

                    } else {
                        // 2) หน้าเป็นรูปสแกน — OCR ทีละบล็อกของ layout
                        // (ตัดภาพเฉพาะบล็อก เพื่อไม่ให้ OCR รวมข้อความสองคอลัมน์เป็นบรรทัดเดียว)
                        source = 'ocr';

                        emit({
                            stage: 'ocr',
                            page: pageNumber,
                            pageCount: document.numPages,
                            label: 'กำลัง OCR หน้า ' +
                                pageNumber + '/' + document.numPages
                        });

                        const canvasModule = require('@napi-rs/canvas');
                        const image = await canvasModule.loadImage(png);
                        const pageOcr = [];

                        for (let index = 0; index < ordered.length; index++) {
                            const region = ordered[index];

                            if (SKIP_TEXT_LABELS[region.label]) {
                                pageOcr.push({ text: '', lineCount: 0 });
                                continue;
                            }

                            try {
                                const crop = cropRegion(
                                    canvasModule,
                                    image,
                                    region,
                                    pageWidth,
                                    pageHeight
                                );

                                if (!crop) {
                                    pageOcr.push({ text: '', lineCount: 0 });
                                    continue;
                                }

                                const ocr = await recognizePng(crop);

                                pageOcr.push({
                                    text: String(ocr.text || '').trim(),
                                    lineCount: (ocr.lines || []).length
                                });

                            } catch (error) {
                                ocrError = ocrError ||
                                    ((error && error.message) ||
                                        'OCR หน้านี้ไม่สำเร็จ');

                                pageOcr.push({ text: '', lineCount: 0 });
                            }
                        }

                        // ไม่พบบล็อกเลย = OCR ทั้งหน้า
                        if (ordered.length === 0) {
                            try {
                                const ocr = await recognizePng(png);

                                const text = String(ocr.text || '').trim();

                                if (text !== '') {
                                    ordered = [{
                                        label: 'text',
                                        score: 0,
                                        x: 0,
                                        y: 0,
                                        width: pageWidth,
                                        height: pageHeight
                                    }];

                                    pageOcr.push({
                                        text: text,
                                        lineCount: (ocr.lines || []).length
                                    });
                                }

                            } catch (error) {
                                ocrError = ocrError ||
                                    ((error && error.message) ||
                                        'OCR หน้านี้ไม่สำเร็จ');
                            }
                        }

                        pageRegions = ordered.map(function (region, index) {
                            const ocr = pageOcr[index] || { text: '', lineCount: 0 };

                            return {
                                index: index + 1,
                                label: region.label,
                                labelTh: LABELS_TH[region.label] || region.label,
                                score: region.score,
                                x: Math.round(region.x * 10) / 10,
                                y: Math.round(region.y * 10) / 10,
                                width: Math.round(region.width * 10) / 10,
                                height: Math.round(region.height * 10) / 10,
                                lineCount: ocr.lineCount,
                                text: joinLines
                                    ? joinWrappedLines(
                                        String(ocr.text || '')
                                            .split('\n')
                                            .map(function (line) {
                                                return { text: line };
                                            })
                                    ).lines.join('\n')
                                    : ocr.text
                            };
                        });
                    }

                    const pageText = pageRegions
                        .filter(function (region) {
                            return !SKIP_TEXT_LABELS[region.label] &&
                                region.text.trim() !== '';
                        })
                        .map(function (region) {
                            return region.text;
                        })
                        .join('\n');

                    pages.push({
                        page: pageNumber,
                        width: pageWidth,
                        height: pageHeight,
                        source: source,
                        ocrError: ocrError,
                        regions: pageRegions,
                        text: pageText
                    });

                } catch (error) {
                    pages.push({
                        page: pageNumber,
                        error:
                            (error && error.message) ||
                            'วิเคราะห์หน้านี้ไม่สำเร็จ',
                        regions: [],
                        text: ''
                    });
                }
            }

        } finally {
            try {
                await document.destroy();
            } catch (error) {
                // ไม่สำคัญ
            }
        }

        return {
            pageCount: pages.length,
            pages: pages,
            text: pages
                .map(function (page) {
                    return page.text || '';
                })
                .filter(function (text) {
                    return text.trim() !== '';
                })
                .join('\n\n')
        };

    } catch (error) {
        throw new Error(
            'วิเคราะห์โครงสร้างเอกสารไม่สำเร็จ: ' +
            ((error && error.message) || 'ไม่ทราบสาเหตุ')
        );
    }
}

module.exports = {
    PAGE_SCALE,
    MODEL_SIZE,
    status,
    analyzePdf,
    stop
};
