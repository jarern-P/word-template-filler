// Two-Stage Localized OCR (ทำงานในเครื่องทั้งหมด)
//
// ต่างจาก ocr-paddle.cjs ที่อ่านทั้งหน้าพร้อมกันในครั้งเดียว:
//   ระยะที่ 1 — ตรวจจับตำแหน่งข้อความ (PP-OCRv5 detection) เพื่อ "localize"
//               ว่าบรรทัด/บริเวณข้อความอยู่ตรงไหนของหน้า
//   ระยะที่ 2 — ครอปเฉพาะบริเวณนั้นจากภาพความละเอียดสูง (~300 DPI)
//               แล้วอ่านด้วย PP-OCRv5 recognition ทีละบริเวณ
//
// ทำไมช่วยเรื่องความแม่น:
//   - การอ่านปกติเรนเดอร์หน้า ~200 DPI แล้วไลบรารีลดภาพเหลือ ≤2000 px
//     ก่อนครอปบรรทัด ตัวอักษรไทยตัวเล็กจึงถูกย่อก่อนอ่าน
//   - โหมดนี้ครอปจากภาพ 300 DPI โดยตรง แต่ละครอปมีขนาดเล็กจึงไม่ถูกย่อ
//     (ใช้โมเดลชุดเดียวกับ PaddleOCR ปกติ — ไม่ต้องดาวน์โหลดเพิ่ม)
'use strict';

const {
    renderPageToPng,
    recognizePng,
    detectPng
} = require('./ocr-paddle.cjs');

// ความละเอียดของภาพต้นทางที่ใช้ครอป (~300 DPI)
// สูงกว่าการ OCR ปกติ (~200 DPI) เพื่อให้ระยะที่ 2 ได้ตัวอักษรที่คมขึ้นจริง
const TWO_STAGE_SCALE = 300 / 72;

// ความละเอียดสูงสุดที่ส่งให้ตัวตรวจจับ (detection) ในระยะที่ 1
// ค่าเริ่มต้นของไลบรารี (~1920 px) เล็กเกินไปสำหรับตัวอักษรไทยตัวเล็ก
const DETECT_MAX_SIDE = 2400;

// ขอบที่เว้นเพิ่มรอบกล่องข้อความ — ต้องเผื่อแนวตั้งพอลำหรับวรรณยุกต์/ตัวห้อย
// (detection มักตัดขอบบน-ล่างของกล่องจนชิดตัวอักษรเกินไป)
const CROP_PADDING_X = 8;

// ระยะเว้นขอบแนวตั้งตั้งค่าได้จากหน้า ตั้งค่า OCR → cropPaddingY
// ค่าที่ผู้ใช้ตั้งเป็น "พิกเซลที่ ~200 DPI" แต่ภาพของโหมดนี้ที่ ~300 DPI
// จึงต้องคูณด้วย 300/200 ก่อนใช้ (เผื่อมากเกินไปจะดูดบรรทัดข้างเคียงเข้ามาอ่านซ้ำ)
const BASE_CROP_PADDING_Y = 16;         // ค่าเริ่มต้น (px ที่ ~200 DPI)
const DPI_RATIO = 300 / 200;
const BASE_DETECT_PADDING_Y = 0.45;     // สัดส่วนขอบกล่อง detection ของค่าเริ่มต้น

// แปลงค่าจากหน้าจอเป็นค่าที่ใช้จริงในโหมดนี้
function resolvePaddingY(value) {
    // ไม่ได้ส่งค่ามา (undefined/null/ว่างเปล่า) = ใช้ค่าเริ่มต้น
    const px200 = (value === undefined || value === null || value === '')
        ? BASE_CROP_PADDING_Y
        : clampPaddingY(Number(value));

    return {
        // ขอบครอป = พิกเซลจริงของภาพ ~300 DPI
        cropPx: Math.round(px200 * DPI_RATIO),
        // ขอบกล่อง detection = สัดส่วนของความสูงกล่อง (ขยายทั้งบนและล่าง)
        detectFraction: Math.min(
            1,
            Math.round(
                BASE_DETECT_PADDING_Y * (px200 / BASE_CROP_PADDING_Y) * 1000
            ) / 1000
        )
    };
}

function clampPaddingY(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return BASE_CROP_PADDING_Y;

    return Math.min(48, Math.max(0, Math.round(number)));
}

const DEFAULT_CROP_PX = Math.round(BASE_CROP_PADDING_Y * DPI_RATIO);

// กล่องที่เล็กกว่านี้ถือเป็นสัญญาณรบกวน (เส้นตาราง จุด ฯลฯ)
const MIN_BOX_SIDE = 6;

// ------------------------------------------------------------------
// ลำดับการอ่าน (รายแถว)
// ------------------------------------------------------------------

// จัดกล่องเป็น "แถว" ตามระดับความสูงของกล่อง แล้วเรียงในแถวซ้าย→ขวา
//
// ทำไมไม่แบ่งคอลัมน์ก่อน:
//   หน้าเอกสารจริง (ใบเบิกเงิน ใบเสร็จ) มักมีตารางที่ช่องต่าง ๆ อยู่ระดับ
//   ความสูงเดียวกัน การแบ่งคอลัมน์ก่อนจะอ่านคอลัมน์ซ้ายจบทั้งหน้าแล้วค่อย
//   ไปคอลัมน์ขวา ทำให้แถวของตารางสลับกัน (หัวตารางไปอยู่หลังเนื้อหา)
//   การรวมเป็นแถวก่อนทำให้ได้ลำดับเหมือนอ่านเอกสารปกติ: ซ้าย→ขวา ทีละแถว
function orderRows(boxes) {
    const sorted = boxes.slice().sort(function (a, b) {
        return (a.top - b.top) || (a.left - b.left);
    });

    // ความสูงบรรทัดปกติ — ใช้กันกล่องที่สูงผิดปกติ (โลโก้/ลายเซ็น/รูป)
    // ดึงแถวข้างเคียงมารวมกันจนลำดับเพี้ยน
    const heights = sorted
        .map(function (box) {
            return box.bottom - box.top;
        })
        .sort(function (a, b) {
            return a - b;
        });

    const medianHeight = heights[Math.floor(heights.length / 2)] || 10;
    const maxRowHeight = medianHeight * 1.5;

    const rows = [];

    sorted.forEach(function (box) {
        const row = rows[rows.length - 1];

        if (row) {
            // อยู่ระดับเดียวกัน = กล่องซ้อนทับกับ "แกน" ของแถวในแนวตั้งพอสมควร
            const overlap =
                Math.min(row.coreBottom, box.bottom) -
                Math.max(row.coreTop, box.top);

            const shortest = Math.min(
                row.coreBottom - row.coreTop,
                box.bottom - box.top
            );

            if (overlap >= Math.max(2, shortest * 0.4)) {
                row.boxes.push(box);

                // ขยายแกนแถวเฉพาะกล่องที่ความสูงปกติ
                if (box.bottom - box.top <= maxRowHeight) {
                    row.coreTop = Math.min(row.coreTop, box.top);
                    row.coreBottom = Math.max(row.coreBottom, box.bottom);
                }

                return;
            }
        }

        rows.push({
            coreTop: box.top,
            // กล่องสูงผิดปกติเป็นจุดเริ่มแถวได้ แต่ไม่ให้กินพื้นที่แนวตั้งเกินจริง
            coreBottom: Math.min(box.bottom, box.top + maxRowHeight),
            boxes: [box]
        });
    });

    const ordered = [];

    rows.forEach(function (row) {
        row.boxes
            .sort(function (a, b) {
                return a.left - b.left;
            })
            .forEach(function (box) {
                ordered.push(box);
            });
    });

    return ordered;
}

function toRegion(box) {
    const left = Number(box && box.x) || 0;
    const top = Number(box && box.y) || 0;
    const width = Number(box && box.width) || 0;
    const height = Number(box && box.height) || 0;

    return {
        left: left,
        top: top,
        right: left + width,
        bottom: top + height
    };
}

// ------------------------------------------------------------------
// ครอปบริเวณข้อความจากภาพหน้า
// ------------------------------------------------------------------

function cropRegion(canvasModule, image, region, pageWidth, pageHeight, paddingY) {
    // paddingY = พิกเซลของภาพ ~300 DPI (มาจาก resolvePaddingY)
    const verticalPadding = Number.isFinite(Number(paddingY))
        ? Math.max(0, Math.round(Number(paddingY)))
        : DEFAULT_CROP_PX;

    const left = Math.max(0, Math.floor(region.left - CROP_PADDING_X));
    const top = Math.max(0, Math.floor(region.top - verticalPadding));
    const right = Math.min(pageWidth, Math.ceil(region.right + CROP_PADDING_X));
    const bottom = Math.min(pageHeight, Math.ceil(region.bottom + verticalPadding));

    const width = right - left;
    const height = bottom - top;

    if (width < 8 || height < 8) return null;

    const canvas = canvasModule.createCanvas(width, height);
    const context = canvas.getContext('2d');

    // พื้นหลังขาว — กันพื้นที่โปร่งใสกลายเป็นสีดำ
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, left, top, width, height, 0, 0, width, height);

    return {
        buffer: canvas.toBuffer('image/png'),
        // ใช้แปลงพิกัดบรรทัดที่อ่านได้ (ในภาพครอป) กลับเป็นพิกัดของหน้า
        left: left,
        top: top
    };
}

// ------------------------------------------------------------------
// กรองเศษข้อความรบกวน
// ------------------------------------------------------------------

// อักขระไทยเดี่ยวที่ใช้จริงในข้อความ (กันการลบคำจริง)
const SAFE_SINGLE_THAI = {
    'ณ': true,
    'ก': true,
    'ฯ': true
};

const THAI_ONLY_TOKEN = /^[\u0E00-\u0E7F]+$/;
const THAI_DIGIT = /[๐-๙]/;

// ทำความสะอาดข้อความของบรรทัด
//
// ตัดเศษอักขระเดี่ยวที่ปนมากลางบรรทัดจากโลโก้/เส้นตาราง/ลายเซ็น
//   - ตัวอักษรไทยหรือวรรณยุกต์เดี่ยว ๆ (บ, ผ, ล, ศ, ิ)
//   - ตัวอักษรละตินเดี่ยว (e, D, o, r) ยกเว้นตัวแรกของบรรทัด (กันป้ายข้อ A.)
//   - คู่ "อักษรไทย + เลขไทย" จากโลโก้ (บ๐)
//   - โทเคนสั้นที่ผสมอักษรละตินกับไทย (Pเร)
// ทำเฉพาะบรรทัดที่ภาษาไทยเป็นหลัก — ไม่แตะข้อความอังกฤษล้วน
// และไม่ตัดตัวเลข เพื่อไม่ให้กระทบ "จำนวน 3 รายการ" หรือ "ผู้ตรวจสอบ 1"
function cleanText(value) {
    let text = String(value || '').replace(/\s+/g, ' ').trim();

    if (text === '') return '';

    const thaiCount = (text.match(/[\u0E00-\u0E7F]/g) || []).length;
    const latinCount = (text.match(/[A-Za-z]/g) || []).length;

    if (thaiCount > 0 && thaiCount >= latinCount) {
        text = text
            .split(' ')
            .filter(function (token, index, tokens) {
                if (token === '') return false;

                const chars = Array.from(token);

                // อักษรไทยเดี่ยว (รวมวรรณยุกต์/สระลอย)
                if (chars.length === 1 && THAI_ONLY_TOKEN.test(token)) {
                    if (SAFE_SINGLE_THAI[token] === true) return true;

                    // ข้อ ก / แบบ ข — ป้ายข้อความจริง
                    const prev = tokens[index - 1];

                    return (
                        prev === 'ข้อ' ||
                        prev === 'แบบ' ||
                        prev === 'ประเภท' ||
                        prev === 'ชั้น'
                    );
                }

                // ตัวอักษรละตินเดี่ยว — ตัวแรกของบรรทัดอาจเป็นป้ายข้อ
                if (/^[A-Za-z]$/.test(token)) {
                    return index === 0;
                }

                // อักษรไทย + เลขไทยปนกันในโทเคนเดียว (เช่น บ๐ ที่หลุดมาจากโลโก้)
                // — ไม่แตะเลขไทยล้วน (๑๐) หรือคำไทยปกติ
                const thaiDigits = chars.filter(function (ch) {
                    return THAI_DIGIT.test(ch);
                }).length;

                if (
                    chars.length === 2 &&
                    THAI_ONLY_TOKEN.test(token) &&
                    thaiDigits === 1
                ) {
                    return false;
                }

                // โทเคนสั้นที่ผสมอักษรละตินกับไทย (เช่น Pเร)
                if (
                    chars.length <= 3 &&
                    /[A-Za-z]/.test(token) &&
                    /[\u0E00-\u0E7F]/.test(token)
                ) {
                    return false;
                }

                return true;
            })
            .join(' ');
    }

    text = text.replace(/(?:\s+[a-z])+$/, '');
    text = text.replace(/[\s\-–—:;,./]+$/, '');

    return text.trim();
}

// ตัวอักษร/ตัวเลขจริง (ไม่นับช่องว่าง เครื่องหมาย วรรณยุกต์ลอย)
function countAlnum(text) {
    const matches = String(text || '').match(/[\p{L}\p{N}]/gu);

    return matches ? matches.length : 0;
}

function isNumericText(text) {
    return /^[0-9\s.,:/()\-]+$/.test(String(text || ''));
}

// เศษจากโลโก้ เส้นตาราง ลายเซ็น และตราประทับ:
//   - แถบเส้นตาราง/ขอบภาพ = กล่องเตี้ยกว่าบรรทัดปกติมาก และข้อความสั้น
//   - ตัวอักษร 1-2 ตัวที่หลุดมาจากขอบภาพ
//   - ข้อความสั้นมากที่โมเดลเองก็ไม่มั่นใจ (เศษเส้น/รอยหมึก)
// ข้อความจริงสั้น ๆ (เดบิต, 0.00, PR108) มีความสูงและความมั่นใจปกติ จึงไม่ถูกตัด
function isNoiseLine(line, medianHeight) {
    const alnum = countAlnum(line.text);

    if (alnum <= 1) return true;

    const height = Math.max(0, Number(line.bottom) - Number(line.top));

    if (
        Number.isFinite(height) &&
        height > 0 &&
        medianHeight > 0 &&
        height < medianHeight * 0.55 &&
        alnum < 8
    ) {
        return true;
    }

    const confidence = Number(line.confidence);

    if (!Number.isFinite(confidence) || isNumericText(line.text)) {
        return false;
    }

    if (alnum <= 4 && confidence < 0.85) return true;
    if (alnum <= 6 && confidence < 0.7) return true;

    return false;
}

function median(values) {
    const list = values
        .filter(function (value) {
            return Number.isFinite(value) && value > 0;
        })
        .sort(function (a, b) {
            return a - b;
        });

    if (list.length === 0) return 0;

    return list[Math.floor(list.length / 2)];
}

// ------------------------------------------------------------------
// OCR หนึ่งหน้า
// ------------------------------------------------------------------

// อ่านภาพหน้า (PNG) ด้วยวิธีสองระยะ — แยกออกมาเพื่อทดสอบได้โดยไม่ต้องมี PDF
async function ocrPng(png, options) {
    const padding = resolvePaddingY((options || {}).paddingY);
    const canvasModule = require('@napi-rs/canvas');

    let image;

    try {
        image = await canvasModule.loadImage(png);

    } catch (error) {
        throw new Error(
            'เตรียมภาพของหน้า PDF ไม่สำเร็จ: ' +
            ((error && error.message) || 'ไม่ทราบสาเหตุ')
        );
    }

    const pageWidth = image.width;
    const pageHeight = image.height;

    const boxes = await detectPng(png, {
        maxSideLength: DETECT_MAX_SIDE,
        // เผื่อขอบบน/ล่างของกล่อง — ค่าเริ่มต้นของที่นี่เคยต่ำกว่าค่าเริ่มต้น
        // ของไลบรารี (0.25 < 0.4) ทำให้สระลอย/วรรณยุกต์ถูกตัด
        paddingVertical: padding.detectFraction,
        // เผื่อขอบข้างมากพอ — detection มักตัดขอบตัวอักษรหัวบรรทัดจนหาย
        paddingHorizontal: 0.12
    });

    const regions = orderRows(
        boxes
            .map(toRegion)
            .filter(function (region) {
                return (
                    region.right - region.left >= MIN_BOX_SIDE &&
                    region.bottom - region.top >= MIN_BOX_SIDE
                );
            })
    );

    // ตรวจไม่พบตำแหน่งเลย = อ่านทั้งหน้าเหมือน OCR ปกติ
    if (regions.length === 0) {
        return recognizePng(png);
    }

    const lines = [];
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (let index = 0; index < regions.length; index++) {
        const region = regions[index];
        const crop = cropRegion(
            canvasModule,
            image,
            region,
            pageWidth,
            pageHeight,
            padding.cropPx
        );

        if (!crop) continue;

        let ocr;

        try {
            ocr = await recognizePng(crop.buffer);

        } catch (error) {
            // บริเวณเดียวอ่านไม่ได้ = ข้ามไป ไม่ทำให้ทั้งหน้าล้มเหลว
            continue;
        }

        const recognized = (ocr.lines || [])
            .map(function (line) {
                return {
                    text: cleanText(line.text),
                    left: Number(line.left),
                    right: Number(line.right),
                    top: Number(line.top),
                    bottom: Number(line.bottom),
                    confidence: Number.isFinite(Number(line.confidence))
                        ? Number(line.confidence)
                        : undefined
                };
            })
            .filter(function (line) {
                return line.text !== '';
            });

        if (recognized.length === 0) continue;

        recognized.forEach(function (line) {
            // ใช้พิกัดจริงของบรรทัดในภาพครอป (แม่นกว่ากล่องที่ detection ให้มา)
            // เพื่อให้การเย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่ตัดสินใจได้ถูก
            const hasBox = [
                line.left,
                line.right,
                line.top,
                line.bottom
            ].every(Number.isFinite);

            lines.push({
                text: line.text,
                left: hasBox ? crop.left + line.left : region.left,
                right: hasBox ? crop.left + line.right : region.right,
                top: hasBox ? crop.top + line.top : region.top,
                bottom: hasBox ? crop.top + line.bottom : region.bottom,
                confidence: line.confidence,
                hadSpaceAfter: false
            });
        });

        const confidence = Number(ocr.confidence) || 0;

        if (confidence > 0) {
            confidenceSum += confidence;
            confidenceCount += 1;
        }
    }

    // อ่านบริเวณที่ตรวจพบไม่ได้เลย = ถอยไปอ่านทั้งหน้า
    if (lines.length === 0) {
        return recognizePng(png);
    }

    // กรองเศษจากโลโก้/เส้นตาราง/ลายเซ็น — ถ้ากรองจนไม่เหลืออะไร
    // (เช่น หน้าโลโก้ล้วน) เก็บผลเดิมไว้ ไม่ให้หน้าเงียบหายไป
    const medianHeight = median(
        lines.map(function (line) {
            return Number(line.bottom) - Number(line.top);
        })
    );

    const kept = lines.filter(function (line) {
        return !isNoiseLine(line, medianHeight);
    });

    const output = kept.length > 0 ? kept : lines;

    return {
        text: output
            .map(function (line) {
                return line.text;
            })
            .join('\n'),
        lines: output,
        confidence: confidenceCount > 0
            ? confidenceSum / confidenceCount
            : 0
    };
}

async function ocrPage(page, options) {
    const opts = options || {};
    const png = await renderPageToPng(
        page,
        opts.scale || TWO_STAGE_SCALE
    );

    return ocrPng(png, opts);
}

module.exports = {
    TWO_STAGE_SCALE,
    // ใช้ทดสอบการแปลงค่าจากหน้า ตั้งค่า OCR
    resolvePaddingY,
    // ใช้ทดสอบโดยไม่ต้องโหลดโมเดล OCR
    cleanText,
    isNoiseLine,
    orderRows,
    ocrPage,
    ocrPng
};
