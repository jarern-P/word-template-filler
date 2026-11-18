// จัดข้อความให้อยู่ตามพิกัด (layout → plain text)
//
// ใช้กับผล OCR / ชั้นข้อความของ PDF ที่มีพิกัดของแต่ละบรรทัด:
//   - เยื้องบรรทัดด้วยช่องว่างตามตำแหน่ง x (เทียบขอบซ้ายของหน้า)
//   - เว้นช่องว่างตามระยะห่างจริงระหว่างคำ/คอลัมน์
//   - รวมบรรทัดที่พิกัดต่างกันเล็กน้อยเป็นแถวเดียวกัน (tolerance)
//
// พิกัดไม่ต้องเป็นหน่วยเดียวกันทั้งไฟล์ (pt / px 200 DPI / px 300 DPI)
// เพราะการคำนวณใช้ระยะสัมพันธ์กับความกว้างตัวอักษรของหน้านั้น ๆ
'use strict';

// ระยะเผื่อความคลาดเคลื่อนเริ่มต้น (สัดส่วนของความสูงบรรทัด)
// พิกัดที่ห่างกันไม่เกินนี้ถือว่าอยู่แถวเดียวกัน — หน้าสแกนที่เอียงเล็กน้อย
// หรือ OCR อ่าน y คลาดไปจะยังถูกวางเป็นบรรทัดเดียวกัน
const DEFAULT_TOLERANCE_RATIO = 0.55;

// จำนวนช่องว่างสูงสุดที่เติมในบรรทัดเดียว (กันพิกัดผิดแล้วบรรทัดยืดเกินจริง)
const MAX_SPACES = 24;

// จำนวนช่องว่างเยื้องสูงสุด
const MAX_INDENT = 80;

function toNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

function median(values) {
    const list = values
        .filter(function (value) {
            return Number.isFinite(value);
        })
        .sort(function (a, b) {
            return a - b;
        });

    if (list.length === 0) return null;

    const middle = Math.floor(list.length / 2);

    return list.length % 2 === 0
        ? (list[middle - 1] + list[middle]) / 2
        : list[middle];
}

function cleanText(value) {
    return String(value == null ? '' : value)
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b\u200e\u200f\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ลบช่องว่างหัว/ท้ายและอักขระที่มองไม่เห็น แต่คงช่องว่างคั่นคอลัมน์ภายในบรรทัด
function cleanLineText(value) {
    return String(value == null ? '' : value)
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b\u200e\u200f\ufeff]/g, '')
        .replace(/\t/g, ' ')
        .trim();
}

// ──────────────────────────────────────────────────────────────
// ระยะห่างระหว่างชิ้นข้อความ → จำนวนช่องว่าง
// ──────────────────────────────────────────────────────────────

// gap      = ระยะห่างจริง (หน่วยเดียวกับ cellWidth)
// cell     = ความกว้างตัวอักษรโดยประมาณ
// wordGap  = ระยะที่ถือว่าเป็นช่องว่างระหว่างคำ (ต่ำกว่านี้ = ตัวอักษรต่อกัน)
function spacesForGap(gap, options) {
    const opts = options || {};
    const distance = Number(gap);
    const cell = Number(opts.cellWidth);
    const wordGap = Number(opts.wordGap);
    const maxSpaces = Number(opts.maxSpaces) > 0
        ? Math.floor(Number(opts.maxSpaces))
        : MAX_SPACES;

    if (!Number.isFinite(distance)) return 0;

    const threshold = Number.isFinite(wordGap)
        ? wordGap
        : (Number.isFinite(cell) && cell > 0 ? cell * 0.35 : 1);

    // กล่องที่ซ้อนกัน (ระยะติดลบ) และไม่มีระยะ "ติดกันภายในคำ"
    // ยังต้องมีช่องว่าง 1 ช่อง ไม่งั้นคำสองคำจะติดกัน
    if (distance <= 0) return threshold === 0 ? 1 : 0;

    if (distance <= threshold) return 0;

    if (!Number.isFinite(cell) || cell <= 0) return 1;

    return Math.max(
        1,
        Math.min(maxSpaces, Math.round(distance / cell))
    );
}

// ต่อชิ้นข้อความของบรรทัดเดียว (เรียงซ้าย → ขวา) โดยเติมช่องว่างตามระยะจริง
// parts = [{ x, width, text }]
function joinParts(parts, options) {
    const opts = options || {};
    const list = (Array.isArray(parts) ? parts : []).filter(function (part) {
        return part && cleanText(part.text) !== '';
    });

    let text = '';
    let previousEnd = null;

    list.forEach(function (part) {
        const value = String(part.text == null ? '' : part.text);
        const x = toNumber(part.x);
        const width = toNumber(part.width) || 0;

        if (previousEnd !== null) {
            // ไม่มีพิกัด = ไม่รู้ระยะจริง แต่เป็นคนละชิ้นข้อความ จึงคั่นด้วย 1 ช่อง
            const spaces = x === null
                ? 1
                : spacesForGap(x - previousEnd, opts);

            if (
                spaces > 0 &&
                !/\s$/.test(text) &&
                !/^\s/.test(value)
            ) {
                text += ' '.repeat(spaces);
            }
        }

        text += value;

        if (x !== null) previousEnd = x + width;
    });

    return text;
}

// ──────────────────────────────────────────────────────────────
// ความกว้างตัวอักษร / ความสูงบรรทัดของหน้า
// ──────────────────────────────────────────────────────────────

function lineParts(line) {
    if (Array.isArray(line.parts) && line.parts.length > 0) {
        return line.parts;
    }

    const left = toNumber(line.left);
    const right = toNumber(line.right);

    if (left === null || right === null) return [];

    return [{ x: left, width: right - left, text: line.text }];
}

// ค่ากลางของความกว้างต่อตัวอักษร (ไม่นับช่องว่าง)
function estimateCellWidth(lines) {
    const widths = [];

    (Array.isArray(lines) ? lines : []).forEach(function (line) {
        lineParts(line).forEach(function (part) {
            const chars = String(part.text == null ? '' : part.text)
                .replace(/\s/g, '')
                .length;

            const width = toNumber(part.width);

            if (chars > 0 && width !== null && width > 0) {
                widths.push(width / chars);
            }
        });
    });

    return median(widths);
}

function estimateLineHeight(lines) {
    return median(
        (Array.isArray(lines) ? lines : []).map(function (line) {
            const top = toNumber(line.top);
            const bottom = toNumber(line.bottom);

            return top !== null && bottom !== null && bottom > top
                ? bottom - top
                : null;
        })
    );
}

// ──────────────────────────────────────────────────────────────
// จัดบรรทัดเป็นแถว (เผื่อความคลาดเคลื่อน)
// ──────────────────────────────────────────────────────────────

function lineCenter(line, fallbackHeight) {
    const top = toNumber(line.top);
    const bottom = toNumber(line.bottom);

    if (top === null) return null;
    if (bottom !== null && bottom >= top) return (top + bottom) / 2;

    return top + fallbackHeight / 2;
}

// จัดกลุ่มบรรทัดที่มีระดับความสูงใกล้กันเป็นแถวเดียวกัน
// tolerance = ระยะห่างสูงสุดของจุดกลางบรรทัดที่ยังถือว่าแถวเดียวกัน
function groupRows(lines, options) {
    const opts = options || {};
    const fallbackHeight = Number(opts.fallbackHeight) > 0
        ? Number(opts.fallbackHeight)
        : 10;

    const tolerance = Number(opts.tolerance) >= 0
        ? Number(opts.tolerance)
        : fallbackHeight * DEFAULT_TOLERANCE_RATIO;

    const rows = [];

    (Array.isArray(lines) ? lines : []).forEach(function (line) {
        const center = lineCenter(line, fallbackHeight);

        if (center === null) return;

        const row = rows.length > 0 ? rows[rows.length - 1] : null;

        if (row && Math.abs(center - row.center) <= tolerance) {
            row.lines.push(line);

            // ใช้ค่ากลางของแถวเพื่อไม่ให้ความคลาดเคลื่อนสะสมไปทางเดียว
            row.center = median(row.lines.map(function (item) {
                return lineCenter(item, fallbackHeight);
            })) || center;

            return;
        }

        rows.push({ center: center, lines: [line] });
    });

    return rows;
}

// ──────────────────────────────────────────────────────────────
// จัดข้อความทั้งหน้า
// ──────────────────────────────────────────────────────────────

// lines = [{ text, left, right, top, bottom, parts? }] เรียงตามลำดับการอ่าน
// options.tolerance = ระยะเผื่อความคลาดเคลื่อน (หน่วยเดียวกับพิกัด)
// options.cellWidth = ความกว้างตัวอักษร (ไม่ส่ง = ประมาณจากพิกัด)
// คืน array ของข้อความบรรทัดละหน้า (มีช่องว่างนำหน้า/คั่นตามพิกัด)
function layoutLines(lines, options) {
    const opts = options || {};
    const list = (Array.isArray(lines) ? lines : [])
        .map(function (line) {
            return {
                text: cleanLineText(line && line.text),
                left: toNumber(line && line.left),
                right: toNumber(line && line.right),
                top: toNumber(line && line.top),
                bottom: toNumber(line && line.bottom),
                parts: line && line.parts
            };
        })
        .filter(function (line) {
            return line.text !== '';
        });

    const positioned = list.filter(function (line) {
        return line.left !== null && line.top !== null;
    });

    const plain = list.filter(function (line) {
        return line.left === null || line.top === null;
    });

    // พิกัดไม่พอจะจัดเลย์เอาต์ = คืนข้อความตามลำดับเดิม
    if (positioned.length < 2) {
        return list.map(function (line) {
            return line.text;
        });
    }

    const height = estimateLineHeight(positioned);
    const cell = Number(opts.cellWidth) > 0
        ? Number(opts.cellWidth)
        : (estimateCellWidth(positioned) || (height || 10) * 0.55);

    const maxSpaces = Number(opts.maxSpaces) > 0
        ? Math.floor(Number(opts.maxSpaces))
        : MAX_SPACES;

    const maxIndent = Number(opts.maxIndent) > 0
        ? Math.floor(Number(opts.maxIndent))
        : MAX_INDENT;

    const ordered = positioned.slice().sort(function (a, b) {
        return (a.top - b.top) || (a.left - b.left);
    });

    const rows = groupRows(ordered, {
        tolerance: opts.tolerance,
        fallbackHeight: height || cell * 1.6
    });

    const leftMargin = Math.min.apply(null, ordered.map(function (line) {
        return line.left;
    }));

    const output = rows.map(function (row) {
        const items = row.lines.slice().sort(function (a, b) {
            return a.left - b.left;
        });

        let text = '';
        let previousEnd = null;

        items.forEach(function (line, index) {
            if (index === 0) {
                const indent = Math.max(
                    0,
                    Math.min(maxIndent, Math.round((line.left - leftMargin) / cell))
                );

                text += ' '.repeat(indent);
                text += line.text;
                previousEnd = line.right !== null
                    ? line.right
                    : line.left + line.text.length * cell;

                return;
            }

            const gap = previousEnd === null ? null : line.left - previousEnd;

            // อย่างน้อย 1 ช่อง (เป็นคนละชิ้นข้อความ) และไม่เกินเพดาน
            const spaces = Math.min(
                maxSpaces,
                Math.max(1, gap === null ? 1 : cellsBetween(gap, cell))
            );

            text += ' '.repeat(spaces) + line.text;

            previousEnd = line.right !== null
                ? line.right
                : line.left + line.text.length * cell;
        });

        return text.replace(/[ \t]+$/, '');
    });

    return output.concat(plain.map(function (line) {
        return line.text;
    }));
}

// จำนวน \"ช่องตัวอักษร\" ตามระยะห่างจริง (ขั้นต่ำ 1 เมื่อเกินครึ่งช่อง)
function cellsBetween(gap, cell) {
    if (!Number.isFinite(gap) || gap <= 0) return 0;
    if (!Number.isFinite(cell) || cell <= 0) return 1;

    return Math.max(0, Math.round(gap / cell));
}

module.exports = {
    DEFAULT_TOLERANCE_RATIO,
    MAX_SPACES,
    MAX_INDENT,
    joinParts,
    spacesForGap,
    estimateCellWidth,
    estimateLineHeight,
    groupRows,
    layoutLines
};
