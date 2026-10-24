// เย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่ (PDF) กลับเป็นบรรทัดเดียว
//
// ทำไมต้องมี:
//   PDF ตัดบรรทัดตามความกว้างหน้ากระดาษ ค่าของ field จึงขาดเป็นสองบรรทัด
//   เช่น "เลขที่ 123/2569" ขึ้นบรรทัดใหม่ที่ "2569" ทำให้ regex อย่าง
//   ([^\n]+) จับค่าได้ไม่ครบ
//
// เกณฑ์การตัดสิน = คะแนนถ่วงน้ำหนัก (0-1) จากสองกลุ่มหลัก
//   1. เรขาคณิต — ใช้พิกัดของแต่ละบรรทัดที่ดึงมาจาก PDF
//        - บรรทัดก่อนหน้าจบชิดขอบขวา (บรรทัดเต็ม) หรือเกือบเต็ม
//        - บรรทัดถัดไปเริ่มที่ขอบซ้าย (ไม่ย่อหน้า/ไม่ใช่รายการใหม่)
//        - ระยะบรรทัดเท่าระยะปกติ (ไม่ใช่ช่องว่างระหว่างย่อหน้า)
//   2. ไวยากรณ์ไทย — รายการคำปิดหมู่ที่เขียนไว้ด้านล่าง
//        - คำเชื่อม/บุพบท/คำช่วย ที่อยู่ท้ายบรรทัดแล้วประโยคไม่จบ
//        - คำที่ไม่ขึ้นต้นประโยค (คำลงท้าย ฯลฯ)
//
// ทำไมไม่ใช้ N-gram / POS tagger (CRF/HMM):
//   ต้องมีคลังข้อความไทยที่ฝึกไว้และโมเดลติดแท็กคำพูดหลาย MB แนบมากับแอป
//   แต่การตัดสินมีแค่ "เย็บหรือไม่เย็บ" คำปิดหมู่ + พิกัดบรรทัดให้ผลที่อธิบายได้
//   และไม่ต้องพึ่งข้อมูลภายนอก — ถ้าอนาคตมีคลังข้อความ จะเพิ่ม bigram
//   เป็นตัวให้คะแนนส่วน "ไวยากรณ์" แทนรายการคำนี้ได้
//
// Levenshtein ไม่ได้ใช้ตัดสินคะแนน (มันคือระยะแก้ไขระหว่างสตริง ไม่ใช่ความน่าจะเป็น
// ของไวยากรณ์)

'use strict';

// คะแนนขั้นต่ำที่จะเย็บ (ดูน้ำหนักใน scoreJoin)
const DEFAULT_THRESHOLD = 0.58;

// ── คำที่ลงท้ายบรรทัดแล้วประโยคมักไม่จบ ──
// ตรวจแบบ "คำสุดท้ายของบรรทัด" (ตัดด้วย Intl.Segmenter) เพื่อไม่ให้ "หน้าที่"
// ถูกนับว่าเป็นคำว่า "ที่"
const CONTINUE_AFTER = [
    // คำเชื่อม
    'และ', 'หรือ', 'แต่', 'เพราะ', 'เนื่องจาก', 'ดังนั้น', 'จึง', 'เพื่อ',
    'เพื่อให้', 'ส่วน', 'สำหรับ', 'ทั้งนี้', 'อย่างไรก็ตาม', 'รวมถึง',
    'ตลอดจน', 'จน', 'จนถึง', 'ขณะที่', 'เมื่อ', 'ถ้า', 'หาก', 'แม้',
    'แม้ว่า', 'ถึงแม้', 'ถึงแม้ว่า', 'เพราะว่า', 'กล่าวคือ', 'ได้แก่',
    'เช่น', 'อาทิ', 'ไม่ว่า', 'ไม่เพียงแต่', 'ทั้งที่', 'นอกจากนี้',
    'หลังจาก', 'ก่อนที่', 'ระหว่างที่', 'เพราะฉะนั้น', 'ฉะนั้น', 'ทว่า',
    'แต่ว่า', 'หรือไม่ก็', 'ทั้ง', 'ทั้งที่',
    // บุพบท
    'โดย', 'ด้วย', 'จาก', 'ใน', 'ของ', 'กับ', 'แก่', 'แด่', 'ต่อ',
    'ระหว่าง', 'ตาม', 'เกี่ยวกับ', 'ภายใต้', 'โดยที่', 'แห่ง', 'ณ',
    // คำเชื่อมอนุประโยค / คำนำหน้า
    'ซึ่ง', 'ที่', 'อัน', 'ว่า', 'ความว่า', 'ผู้', 'การ', 'ความ',
    // คำช่วย/กริยาที่ต้องมีอะไรต่อ
    'คือ', 'เป็น', 'ไม่', 'มิ', 'จะ', 'ต้อง', 'ควร', 'อาจ', 'น่าจะ',
    'กำลัง', 'เคย', 'เพิ่ง', 'มัก', 'มักจะ', 'ย่อม', 'สามารถ', 'ทำให้',
    'ให้', 'มี', 'ประกอบด้วย', 'เรียก', 'ระบุ', 'ใช้'
];

// ── คำที่ห้ามขึ้นต้นบรรทัด (ถ้าขึ้นต้น แปลว่าบรรทัดก่อนหน้าถูกตัดกลางประโยค) ──
const NON_STARTERS = [
    'ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้ะ', 'จ๊ะ', 'สิ', 'เถอะ', 'เถิด',
    'เอง', 'เท่านั้น', 'เช่นกัน', 'เหมือนกัน', 'ด้วย', 'ต่าง', 'ๆ',
    'และ', 'หรือ', 'แต่', 'เพราะ', 'โดย', 'ซึ่ง', 'ว่า', 'คือ', 'เป็น',
    'จะ', 'ไม่', 'ก็', 'ต้อง', 'ควร', 'มี', 'อยู่', 'แล้ว', 'ทั้ง',
    'แต่ละ', 'ทุก', 'บาง', 'ของ', 'ใน', 'ที่', 'จาก', 'กับ', 'ต่อ',
    'ให้', 'อัน', 'ผู้', 'นั้น', 'นี้'
];

// ── คำ/เครื่องหมายที่บอกว่าประโยคจบแล้ว ──
const SENTENCE_END_WORDS = [
    'ครับ', 'ค่ะ', 'คะ', 'นะ', 'จ้ะ', 'จ๊ะ', 'สิ', 'เถอะ', 'เถิด'
];

// ขึ้นต้นบรรทัดแบบรายการใหม่/หัวข้อใหม่ — ไม่ควรเย็บกับบรรทัดก่อนหน้า
const ITEM_START = new RegExp(
    '^(?:' +
    '[-–—•·*▪◦]' +
    '|\\(?(?:\\d{1,3}|[๐-๙]{1,3})[.)]' +
    '|[ก-ฮ][.)]\\s' +
    '|ข้อ\\s*(?:\\d|[๐-๙])' +
    '|มาตรา\\s*(?:\\d|[๐-๙])' +
    '|บทที่' +
    '|ภาคผนวก' +
    '|ส่วนที่\\s*(?:\\d|[๐-๙])' +
    ')'
);

// ── ตัวตัดคำไทย ──
// ใช้ Intl.Segmenter (มีใน Node/Electron) เพื่อดูคำสุดท้าย/คำแรกจริง
// ถ้าเครื่องไหนไม่มี (ควรมีทุกตัว) ถอยไปใช้การแบ่งด้วยช่องว่าง
let wordSegmenter = null;

try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        wordSegmenter = new Intl.Segmenter('th', { granularity: 'word' });
    }
} catch (error) {
    wordSegmenter = null;
}

function segmentWords(text) {
    const source = String(text == null ? '' : text);

    if (wordSegmenter) {
        const words = [];

        for (const part of wordSegmenter.segment(source)) {
            if (part.isWordLike) words.push(part.segment);
        }

        return words;
    }

    return source.split(/\s+/).filter(Boolean);
}

function firstWord(text) {
    const words = segmentWords(text);

    return words.length > 0 ? words[0] : '';
}

function lastWord(text) {
    const words = segmentWords(text);

    return words.length > 0 ? words[words.length - 1] : '';
}

// ตัดเครื่องหมายคำพูด/วงเล็บปิดท้ายออกก่อนตรวจคำสุดท้าย
function stripTrailingMarks(text) {
    return String(text == null ? '' : text)
        .replace(/[\s"'”’»\])}]+$/g, '');
}

const CONTINUE_AFTER_SET = new Set(
    CONTINUE_AFTER.filter(function (cue) {
        return cue.length <= 3;
    })
);

const CONTINUE_AFTER_PHRASES = CONTINUE_AFTER.filter(function (cue) {
    return cue.length >= 4;
});

const NON_STARTER_SET = new Set(
    NON_STARTERS.filter(function (cue) {
        return cue.length <= 3;
    })
);

const NON_STARTER_PHRASES = NON_STARTERS.filter(function (cue) {
    return cue.length >= 4;
});

function matchCue(text, set, phrases, mode) {
    const clean = stripTrailingMarks(text);

    if (clean === '') return null;

    for (let index = 0; index < phrases.length; index++) {
        const cue = phrases[index];

        if (mode === 'end' ? clean.endsWith(cue) : clean.startsWith(cue)) {
            return cue;
        }
    }

    const word = mode === 'end' ? lastWord(clean) : firstWord(clean);

    return set.has(word) ? word : null;
}

function endsWithContinuation(text) {
    return matchCue(text, CONTINUE_AFTER_SET, CONTINUE_AFTER_PHRASES, 'end');
}

function startsWithNonStarter(text) {
    return matchCue(text, NON_STARTER_SET, NON_STARTER_PHRASES, 'start');
}

function endsSentence(text) {
    const clean = stripTrailingMarks(text);

    if (clean === '') return false;

    if (/[!?…]$/.test(clean)) return true;
    if (/ฯ$/.test(clean)) return true;
    if (/เป็นต้น$/.test(clean)) return true;

    return SENTENCE_END_WORDS.indexOf(lastWord(clean)) !== -1;
}

// ── เรขาคณิต ──

function toNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

// แปลงบรรทัดให้มีพิกัดมาตรฐาน
//   top/bottom เพิ่มลง (ใช้ top ของ PDF y ที่กลับทิศแล้ว)
//   bottom = -y + height
function normalizeLine(line, index) {
    if (typeof line === 'string') {
        return {
            index: index,
            text: line.trim(),
            left: null,
            right: null,
            top: null,
            bottom: null,
            hadSpaceAfter: false
        };
    }

    const source = line || {};
    const left = toNumber(source.left);
    const right = toNumber(source.right);
    let top = toNumber(source.top);
    let bottom = toNumber(source.bottom);

    if (top === null && Number.isFinite(Number(source.y))) {
        top = -Number(source.y);
    }

    if (bottom === null && top !== null) {
        bottom = top + (toNumber(source.height) || 0);
    }

    return {
        index: index,
        text: String(source.text == null ? '' : source.text).trim(),
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        hadSpaceAfter: Boolean(source.hadSpaceAfter)
    };
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

function quantile(values, q) {
    const list = values
        .filter(function (value) {
            return Number.isFinite(value);
        })
        .sort(function (a, b) {
            return a - b;
        });

    if (list.length === 0) return null;
    if (list.length === 1) return list[0];

    const position = (list.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);

    if (lower === upper) return list[lower];

    return list[lower] +
        (list[upper] - list[lower]) * (position - lower);
}

// ค่าที่ใช้เทียบทั้งหน้า: ขอบซ้าย, ขอบขวา, ความสูงบรรทัด, ระยะบรรทัดปกติ
function pageStats(lines) {
    const positioned = lines.filter(function (line) {
        return (
            Number.isFinite(line.left) &&
            Number.isFinite(line.right) &&
            Number.isFinite(line.top) &&
            Number.isFinite(line.bottom)
        );
    });

    if (positioned.length < 2) {
        return { hasGeometry: false };
    }

    const heights = positioned.map(function (line) {
        return line.bottom - line.top;
    });

    const gaps = [];

    for (let index = 1; index < positioned.length; index++) {
        gaps.push(positioned[index].top - positioned[index - 1].bottom);
    }

    return {
        hasGeometry: true,
        leftMargin: quantile(positioned.map(function (line) {
            return line.left;
        }), 0.1),
        // เปอร์เซ็นไทล์ 90 กันบรรทัดหัวกระดาษ/ตารางที่ยื่นเกินขอบ
        rightEdge: quantile(positioned.map(function (line) {
            return line.right;
        }), 0.9),
        height: median(heights) || 10,
        gapMedian: median(gaps) || 0,
        gapCount: gaps.length
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// ให้คะแนนคู่บรรทัด (ก่อนหน้า → ถัดไป)
// คืน { join, score, reasons }
function scoreJoin(prev, next, stats, threshold) {
    if (!stats.hasGeometry) {
        return { join: false, score: 0, reasons: ['ไม่มีพิกัดบรรทัด'] };
    }

    if (
        !Number.isFinite(prev.left) || !Number.isFinite(prev.right) ||
        !Number.isFinite(next.left) || !Number.isFinite(next.top)
    ) {
        return { join: false, score: 0, reasons: ['บรรทัดนี้ไม่มีพิกัด'] };
    }

    // ข้อความใน PDF ไม่ได้เรียงบนลงล่างเสมอ — ถ้าบรรทัดถัดไปไม่ได้อยู่ต่ำกว่า
    // อย่าเย็บ (ไม่งั้นประโยคจะสลับลำดับ)
    if (Number.isFinite(prev.top) && next.top <= prev.top) {
        return {
            join: false,
            score: 0,
            reasons: ['ลำดับบรรทัดไม่เรียงบนลงล่าง']
        };
    }

    const height = stats.height;
    const tightTolerance = Math.max(1.5, height * 0.6);
    const looseTolerance = Math.max(4, height * 1.8);

    let score = 0;
    const reasons = [];

    // 1) บรรทัดก่อนหน้าจบชิดขอบขวาแค่ไหน
    const rightGap = stats.rightEdge - prev.right;

    if (rightGap <= tightTolerance) {
        score += 0.42;
        reasons.push('บรรทัดก่อนจบชิดขอบขวา');
    } else if (rightGap <= looseTolerance) {
        score += 0.30;
        reasons.push('บรรทัดก่อนเกือบเต็ม');
    }

    // 2) บรรทัดถัดไปเริ่มที่ขอบซ้าย (ไม่ใช่ย่อหน้า/รายการใหม่)
    const indent = next.left - stats.leftMargin;

    if (indent <= Math.max(2, height * 0.5)) {
        score += 0.14;
        reasons.push('บรรทัดถัดไปเริ่มที่ขอบซ้าย');
    }

    // 3) ระยะบรรทัดปกติ (ไม่ใช่ช่องว่างระหว่างย่อหน้า)
    //
    // หน้าที่ยาวพอมีระยะบรรทัดปกติให้เทียบ — ใช้ค่ากลางของหน้า
    // หน้าที่มีบรรทัดน้อย (มีคู่ให้เทียบไม่ถึง 3 คู่) ค่ากลางคือคู่นั้นเอง
    // จึงต้องเทียบกับความสูงบรรทัดแทน ไม่งั้นช่องว่างย่อหน้าจะถูกมองว่าปกติ
    const gap = next.top - prev.bottom;
    const gapTolerance = Math.max(2, height * 0.7);
    const enoughGaps = stats.gapCount >= 3;

    const largeGap = enoughGaps
        ? gap > stats.gapMedian + Math.max(4, height * 0.9)
        : gap > height * 1.05;

    const normalGap = enoughGaps
        ? Math.abs(gap - stats.gapMedian) <= gapTolerance
        : gap <= height * 0.6;

    if (!largeGap && normalGap) {
        score += 0.14;
        reasons.push('ระยะบรรทัดปกติ');
    }

    // 4) ไวยากรณ์: คำท้ายบรรทัดที่ประโยคยังไม่จบ
    const continuation = endsWithContinuation(prev.text);

    if (continuation) {
        score += 0.30;
        reasons.push('ท้ายบรรทัดคือ "' + continuation + '"');
    }

    // 5) ไวยากรณ์: คำที่ไม่ขึ้นต้นบรรทัด
    const nonStarter = startsWithNonStarter(next.text);

    if (nonStarter) {
        score += 0.08;
        reasons.push('ขึ้นต้นด้วย "' + nonStarter + '"');
    }

    // ── ตัวหักคะแนน ──
    if (endsSentence(prev.text)) {
        score -= 0.35;
        reasons.push('ท้ายบรรทัดเป็นคำลงท้าย/เครื่องหมายจบประโยค');
    }

    if (ITEM_START.test(next.text)) {
        score -= 0.45;
        reasons.push('บรรทัดถัดไปขึ้นต้นแบบรายการ/หัวข้อใหม่');
    }

    if (indent > Math.max(6, height * 1.2)) {
        score -= 0.25;
        reasons.push('บรรทัดถัดไปย่อหน้า');
    }

    if (largeGap) {
        score -= 0.35;
        reasons.push('ระยะบรรทัดกว้างกว่าปกติ');
    }

    score = clamp(score, 0, 1);

    return {
        join: score + 1e-9 >= threshold,
        score: score,
        reasons: reasons
    };
}

// รวมข้อความสองบรรทัด
// ภาษาไทยไม่เว้นช่องว่างระหว่างคำ จึงต่อติดกันเป็นค่าเริ่มต้น
// เว้นช่องว่างเฉพาะเมื่อต้นฉบับมีช่องว่างท้ายบรรทัด หรือเป็นการต่อคำอังกฤษ/ตัวเลข
function mergeText(left, right, hadSpaceAfter) {
    const first = String(left == null ? '' : left).replace(/[ \t]+$/, '');
    const second = String(right == null ? '' : right).replace(/^[ \t]+/, '');

    if (first === '') return second;
    if (second === '') return first;

    if (hadSpaceAfter) return first + ' ' + second;

    // ยัติภังค์ตัดคำอังกฤษ: "insur-" + "ance" → "insurance"
    if (/[-–—]$/.test(first) && /^[a-z]/.test(second)) {
        return first.replace(/[-–—]$/, '') + second;
    }

    // คำอังกฤษ/ตัวเลขติดกันต้องมีช่องว่าง ไม่งั้นกลายเป็นคำเดียว
    if (/[A-Za-z0-9]$/.test(first) && /^[A-Za-z0-9]/.test(second)) {
        return first + ' ' + second;
    }

    // ไทยกับอังกฤษ/ตัวเลขปนกัน: ภาษาไทยเว้นวรรคเมื่อสลับภาษา
    // เช่น "100" + "บาท" → "100 บาท", "วันที่" + "1 ตุลาคม" → "วันที่ 1 ตุลาคม"
    // (ไทยต่อไทยไม่เว้นวรรค เพราะการขึ้นบรรทัดใหม่ตัดกลางวลีได้)
    const thai = /[\u0E00-\u0E7F]/;
    const latinOrDigit = /[A-Za-z0-9]/;
    const lastChar = first.charAt(first.length - 1);
    const firstChar = second.charAt(0);

    if (
        (latinOrDigit.test(lastChar) && thai.test(firstChar)) ||
        (thai.test(lastChar) && latinOrDigit.test(firstChar))
    ) {
        return first + ' ' + second;
    }

    return first + second;
}

/**
 * เย็บบรรทัดที่เป็นประโยคเดียวกัน
 *
 * @param {Array<string|Object>} inputLines
 *   string = บรรทัดไม่มีพิกัด (จะไม่ถูกเย็บ)
 *   object = { text, left, right, top, bottom } หรือ { text, y, height }
 * @param {Object} [options]
 *   threshold = คะแนนขั้นต่ำ (0-1), ค่าเริ่มต้น 0.58
 * @returns {{ lines: string[], joined: number, decisions: Array }}
 *   lines     = ข้อความหลังเย็บ
 *   joined    = จำนวนจุดที่เย็บ
 *   decisions = เหตุผลของทุกจุด (ใช้ตรวจสอบ/ทดสอบ)
 */
function joinWrappedLines(inputLines, options) {
    const opts = options || {};
    const threshold = Number.isFinite(Number(opts.threshold))
        ? Number(opts.threshold)
        : DEFAULT_THRESHOLD;

    const lines = (Array.isArray(inputLines) ? inputLines : [])
        .map(normalizeLine)
        .filter(function (line) {
            return line.text !== '';
        });

    if (lines.length < 2) {
        return {
            lines: lines.map(function (line) {
                return line.text;
            }),
            joined: 0,
            decisions: []
        };
    }

    const stats = pageStats(lines);
    const output = [lines[0].text];
    const decisions = [];
    let joined = 0;

    for (let index = 1; index < lines.length; index++) {
        const prev = lines[index - 1];
        const next = lines[index];
        const result = scoreJoin(prev, next, stats, threshold);

        decisions.push({
            index: index,
            score: result.score,
            join: result.join,
            reasons: result.reasons
        });

        if (result.join) {
            output[output.length - 1] = mergeText(
                output[output.length - 1],
                next.text,
                prev.hadSpaceAfter
            );
            joined += 1;
        } else {
            output.push(next.text);
        }
    }

    return {
        lines: output,
        joined: joined,
        decisions: decisions
    };
}

module.exports = {
    joinWrappedLines: joinWrappedLines,
    DEFAULT_THRESHOLD: DEFAULT_THRESHOLD
};
