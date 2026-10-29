// ปรับปรุงข้อความด้วย difflib.js — แก้คำที่ OCR อ่านผิดโดยไม่ใช้ AI
//
// หลักการ: ตัดช่วงอักษรไทยในข้อความออกมาเป็นคำ แล้วเทียบกับรายการคำ
// ตามลำดับความสำคัญ
//   1) ข้อมูลหลัก (master)
//   2) คลังคำศัพท์ (words)
//   3) พจนานุกรมกลาง (dictionary/th_TH.dic)
//
// ถ้ากลุ่มที่มีลำดับสูงกว่ามีคำที่ใกล้พอ จะใช้คำจากกลุ่มนั้นก่อน
// ไม่ข้ามไปใช้คำจากกลุ่มที่ต่ำกว่า แม้คำในกลุ่มล่างจะใกล้กว่าก็ตาม
//
// เกณฑ์ความใกล้ = ระยะแก้ไข (Levenshtein) ที่ยอมรับได้ตามความยาวคำ
// ผสมกับ cutoff ของ difflib.getCloseMatches — คำที่รู้จักอยู่แล้ว
// หรือตัดเป็นคำในพจนานุกรมได้ทั้งหมดจะไม่ถูกแก้
//
// ข้อจำกัด: ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงใช้วิธีตัดคำด้วยคำที่ยาวที่สุด
// (longest match) จากรายการคำที่โหลดมา — คำวิสามัญ/ชื่อเฉพาะที่ไม่มีใน
// รายการอาจถูกมองว่าเป็นคำผิดได้ เกณฑ์ระยะแก้ไขจึงคุมให้แก้เฉพาะคำที่ใกล้มาก
'use strict';

const fs = require('fs');
const path = require('path');
const difflib = require('difflib');
const levenshtein = require('js-levenshtein');

const THAI_RUN = /[\u0E00-\u0E7F]+/g;
const THAI_ONLY = /^[\u0E00-\u0E7F]+$/;

// ตัวคั่นชั่วคราวสำหรับจุดที่ถูกแทนด้วยช่องว่าง — ทำให้ difflib รู้ว่า
// ช่องว่างนี้มาจากจุด ไม่ใช่ช่องว่างเดิม และค่อยแปลงเป็น ' ' ตอนจบ
const NOISE_GAP = '\u0001';

const MIN_WORD_LENGTH = 2;
// รองรับวลี/ประโยคยาวที่ผู้ใช้เก็บในคลังคำ (เดิม 40 ตัวทำให้ประโยคยาว
// ถูกตัดทิ้งก่อนนำมาเทียบ)
const MAX_WORD_LENGTH = 120;

// คำย่อมาตรฐานที่ใช้บ่อยแต่ไม่มีในพจนานุกรมกลาง — คงจุดไว้
// (เพิ่มไว้เป็นค่าเริ่มต้นของระบบ ไม่ต้องให้ผู้ใช้เพิ่มในคลังคำเอง)
const STANDARD_ABBREVIATIONS = [
    'พ.ศ.', 'ร.ศ.', 'ค.ศ.',
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.',
    'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
    'ร.ต.อ.', 'ร.ต.ท.', 'ร.ต.ต.',
    'พล.ต.', 'พล.ท.', 'พล.อ.', 'พล.ต.อ.', 'พล.ต.ท.', 'พล.ต.ต.',
    'มม.', 'ตร.ม.', 'ตร.กม.', 'ลบ.ม.', 'รศ.'
];

// ระยะห่างสูงสุดระหว่างส่วนของวลีที่จะถือว่าเป็นวลีเดียวกัน
// (OCR อาจแยกวลีข้ามบรรทัดโดยมีข้อความอื่นคั่น)
const MAX_PHRASE_GAP = 200;
const MAX_PHRASE_LINES = 3;

// ค่าความคล้ายขั้นต่ำของ difflib (0–1) — สูงเกินไปจะไม่แก้อะไร
// ต่ำเกินไปจะแทนคำที่ไม่เกี่ยวข้อง
//
// ความใกล้ถูกกรองด้วยระยะแก้ไข (allowedDistance) อีกชั้นหนึ่ง
// คำที่ถูกอยู่แล้วแต่ไม่มีในพจนานุกรมจะไม่ถูกแก้ เพราะระยะห่างเกินกำหนด
const GROUP_CUTOFFS = {
    // ข้อมูลที่ผู้ใช้ตั้งไว้ผ่อนกว่าเล็กน้อย — OCR อาจตัดท้ายคำหาย
    // เช่น "ผูอานวยก" กับ "ผู้อำนวยการ" (ความคล้าย ~0.73)
    master: 0.7,
    wordbank: 0.7,
    dictionary: 0.75
};

const DEFAULT_CUTOFF = GROUP_CUTOFFS.dictionary;

// จำนวนผลลัพธ์ที่ขอจาก difflib ก่อนเลือกตัวแรก
const MATCH_LIMIT = 3;

let dictionaryCache = null;

function dictionaryPath() {
    return path.join(__dirname, '..', '..', 'dictionary', 'th_TH.dic');
}

// .dic = คำ (อาจมี /flags ต่อท้าย) — ข้ามบรรทัดจำนวน/คอมเมนต์
function parseWords(text) {
    return String(text == null ? '' : text)
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)
        .map(function (line) {
            const trimmed = line.trim();
            const slash = trimmed.indexOf('/');

            return (slash === -1 ? trimmed : trimmed.slice(0, slash)).trim();
        })
        .filter(function (word) {
            return word !== '' &&
                !word.startsWith('#') &&
                !/^\d+$/.test(word);
        });
}

// โหลดพจนานุกรมกลางครั้งเดียวต่อโปรเซส
// (ไฟล์ถูกบรรจุใน asar ด้วย build.files ของ package.json)
function loadDictionary() {
    if (dictionaryCache) return dictionaryCache;

    try {
        dictionaryCache = parseWords(
            fs.readFileSync(dictionaryPath(), 'utf8')
        );

    } catch (error) {
        console.warn(
            '[difflib] อ่านพจนานุกรมกลางไม่สำเร็จ: ' +
            ((error && error.message) || String(error))
        );

        dictionaryCache = [];
    }

    return dictionaryCache;
}

// ── แทนจุดรบกวนที่ OCR ใส่ในคำไทยด้วยช่องว่าง ──
//
// OCR มักใส่จุดคั่นกลางคำ (เช่น "เห.นควรอนุมัติ") ทำให้คำไทยถูกแยกเป็น
// หลายช่วงและ difflib เทียบข้ามจุดไม่ได้ จึงแทนจุดเหล่านั้นด้วยช่องว่าง
// หนึ่งช่องก่อนเทียบ (จุดติดกันกี่ตัวก็เหลือช่องว่างเดียว)
// โดยคงจุดที่จำเป็นไว้ 2 กรณี
//   1) จุดที่เกี่ยวกับตัวเลข (4,000.00 / 2.5)
//   2) จุดในคำย่อที่มีอยู่ในระบบ (ข้อมูลหลัก/คลังคำ/พจนานุกรม
//      และคำย่อมาตรฐาน เช่น พ.ศ. / ม.ค. / ร.ต.อ.)
// จุดซ้ำที่ OCR ใส่ซ้อนกัน (.. / . .) เหลือจุดเดียว
// จุดในข้อความภาษาอังกฤษ (Mr. / example.com) ไม่ถูกแตะ เพราะไม่มี
// ตัวอักษรไทยอยู่ข้างเคียง

function abbreviationLetters(value) {
    const text = String(value == null ? '' : value);

    return (text.match(/[\u0E00-\u0E7F]/g) || []).length +
        (text.match(/[A-Za-z]/g) || []).length;
}

// คำย่อที่ติดอยู่ในชื่อ เช่น "ผศ.สุนิสา" / "ว่าที่ร.ต.หญิง" / "ม.ทักษิณ"
// จับกลุ่มอักษรไทยสั้น ๆ ที่คั่นด้วยจุด
function abbreviationsFromItems(items) {
    const found = new Set();

    (Array.isArray(items) ? items : []).forEach(function (item) {
        const text = String(item == null ? '' : item).trim();

        if (!text.includes('.')) return;

        // "Mr." ที่แยกเป็นคำเดี่ยว
        text.split(/\s+/).forEach(function (part) {
            if (/^[A-Za-z]{1,5}\.$/.test(part)) {
                found.add(part);
            }
        });

        const pattern = new RegExp(
            '[\\u0E00-\\u0E7F]{1,4}(?:\\.[\\u0E00-\\u0E7F]{1,4})*\\.',
            'g'
        );
        let match;

        while ((match = pattern.exec(text)) !== null) {
            found.add(match[0]);

            // เพิ่มส่วนท้าย เช่น "ที่ร.ต." → "ร.ต." เพราะคำย่อจริง
            // อาจอยู่ติดกับคำนำหน้าโดยไม่มีเครื่องหมายคั่น
            for (let offset = 1; offset < match[0].length; offset++) {
                const suffix = match[0].slice(offset);

                if (
                    /^[\u0E00-\u0E7F]{1,4}(?:\.[\u0E00-\u0E7F]{1,4})*\.$/
                        .test(suffix)
                ) {
                    found.add(suffix);
                }
            }
        }
    });

    return found;
}

// รวมคำย่อจากทุกกลุ่มที่ระบบใช้เทียบคำ
function buildAbbreviations(master, words, dictionary) {
    const found = new Set();

    abbreviationsFromItems(master).forEach(function (value) {
        found.add(value);
    });

    abbreviationsFromItems(words).forEach(function (value) {
        found.add(value);
    });

    // คำในพจนานุกรมที่มีจุดคือคำย่ออยู่แล้ว (ผศ. / น.ส. / ดร.)
    (Array.isArray(dictionary) ? dictionary : []).forEach(function (item) {
        const text = String(item == null ? '' : item).trim();

        if (text.includes('.')) {
            found.add(text);
        }
    });

    STANDARD_ABBREVIATIONS.forEach(function (value) {
        found.add(value);
    });

    return found;
}

// คำย่อจากพจนานุกรมที่ไม่มีในข้อมูลหลัก/คลังคำ — ต้องอยู่ต้นคำเท่านั้น
// (กันคำย่อสั้น ๆ ไปจับข้ามคำ เช่น "สาธิตม." → "ตม.")
function buildBoundaryRequired(master, words, dictionary) {
    const userWords = new Set();

    abbreviationsFromItems(master).forEach(function (value) {
        userWords.add(value);
    });

    abbreviationsFromItems(words).forEach(function (value) {
        userWords.add(value);
    });

    const strict = new Set();

    (Array.isArray(dictionary) ? dictionary : []).forEach(function (item) {
        const text = String(item == null ? '' : item).trim();

        if (text.includes('.') && !userWords.has(text)) {
            strict.add(text);
        }
    });

    return strict;
}

// ตัวอักษรที่ขึ้นต้นคำใหม่ได้ — ใช้ตัดสินว่าจุดเป็นจุดท้ายคำย่อ
// หรือเป็นจุดที่ OCR ใส่กลางคำ (ถ้าตามด้วยสระ/วรรณยุกต์ = อยู่กลางคำ)
function startsNewToken(char) {
    if (!char) return true;
    if (!/[\u0E00-\u0E7F]/.test(char)) return true;

    return /[\u0E01-\u0E2E\u0E40-\u0E44]/.test(char);
}

/**
 * แทนจุดที่ OCR ใส่เกินในข้อความไทยด้วยช่องว่างเดียว
 * โดยคงจุดของตัวเลขและคำย่อในระบบ
 *
 * @param {string} text
 * @param {Iterable<string>} abbreviations คำย่อที่ต้องคงจุดไว้
 * @param {Iterable<string>} [boundaryRequired] คำย่อที่ต้องอยู่ต้นคำ
 * @returns {{text: string, removed: number}} text ใช้ NOISE_GAP แทนช่องว่าง
 *   ที่มาจากจุด (improveText แปลงเป็น ' ' ตอนจบ)
 */
function replaceNoisePeriods(text, abbreviations, boundaryRequired) {
    const original = String(text == null ? '' : text);
    const known = abbreviations instanceof Set
        ? abbreviations
        : new Set(Array.isArray(abbreviations) ? abbreviations : []);
    const needsBoundary = boundaryRequired instanceof Set
        ? boundaryRequired
        : new Set(
            Array.isArray(boundaryRequired) ? boundaryRequired : []
        );

    if (!original.includes('.')) {
        return { text: original, removed: 0 };
    }

    // จุดซ้ำจาก OCR (".." หรือ ". .") เหลือจุดเดียว
    const source = original.replace(
        /[ \t]*\.[ \t]*(?:\.[ \t]*)+/g,
        '.'
    );

    // จำนวนจุดที่ถูกแทน (นับจุดซ้ำที่ยุบไปด้วย)
    const collapsedDots =
        (original.match(/\./g) || []).length -
        (source.match(/\./g) || []).length;

    // คำย่อที่ลงท้ายด้วยจุดนี้ (เช่น ผศ. / น.ส. / ร.ต. / Mr.)
    function abbreviationEndingAt(index) {
        // หลังจุดต้องเป็นต้นคำใหม่ — ถ้าเป็นสระ/วรรณยุกต์ แปลว่าจุดอยู่กลางคำ
        if (!startsNewToken(sameLineNeighbour(index, 1))) {
            return null;
        }

        const back = [];
        let at = index - 1;

        while (at >= 0 && back.length < 3) {
            // ข้ามจุดซ้ำที่ OCR ใส่มาซ้อนกัน
            while (at >= 0 && source[at] === '.') at -= 1;

            // คำย่อไทยมีแต่พยัญชนะ/สระนำ — หยุดที่วรรณยุกต์/สระตาม
            // เพื่อไม่ให้ลากคำนำหน้ามารวม เช่น "ที่ร.ต." → "ร.ต."
            if (!/[\u0E01-\u0E2E\u0E40-\u0E44]/.test(source[at] || '')) {
                break;
            }

            let start = at;

            while (
                start >= 0 &&
                /[\u0E01-\u0E2E\u0E40-\u0E44]/.test(source[start])
            ) {
                start -= 1;
            }

            const segment = source.slice(start + 1, at + 1);

            if (segment.length < 1 || segment.length > 4) break;

            back.unshift(segment);
            at = start;

            if (at < 0 || source[at] !== '.') break;

            at -= 1;
        }

        // คำย่อภาษาอังกฤษ เช่น Mr.
        if (back.length === 0) {
            let start = index - 1;

            if (!/[A-Za-z]/.test(source[start] || '')) return null;

            while (start >= 0 && /[A-Za-z]/.test(source[start])) {
                start -= 1;
            }

            const word = source.slice(start + 1, index);

            return word.length <= 5 && known.has(word + '.')
                ? word + '.'
                : null;
        }

        // ส่วนหลังจุด — ใช้กับจุดแรกของคำย่อหลายช่วง เช่น ร.ต.
        const forward = [];
        let position = index + 1;

        while (position < source.length && forward.length < 2) {
            let end = position;

            while (
                end < source.length &&
                /[\u0E01-\u0E2E\u0E40-\u0E44]/.test(source[end])
            ) {
                end += 1;
            }

            const segment = source.slice(position, end);

            if (
                segment.length < 1 ||
                segment.length > 4 ||
                source[end] !== '.'
            ) {
                break;
            }

            forward.push(segment);
            position = end + 1;
        }

        const backText = back.join('.') + '.';

        for (let count = forward.length; count >= 0; count--) {
            const candidate = backText +
                (count > 0
                    ? forward.slice(0, count).join('.') + '.'
                    : '');            if (!known.has(candidate)) continue;

            const before = source[index - backText.length];
            const insideWord =
                before && /[\u0E00-\u0E7F]/.test(before);

            // คำย่ออักษรเดี่ยว (ม. / ก.) และคำย่อจากพจนานุกรม
            // ต้องอยู่ต้นคำเท่านั้น กันการจับข้ามคำ
            if (
                insideWord &&
                (abbreviationLetters(candidate) < 2 ||
                    needsBoundary.has(candidate))
            ) {
                continue;
            }

            return candidate;
        }

        return null;
    }

    // ตัวอักษรข้างเคียงในบรรทัดเดียวกัน (ข้ามช่องว่าง)
    function sameLineNeighbour(index, step) {
        let at = index + step;

        while (at >= 0 && at < source.length) {
            const char = source[at];

            if (char === '\n' || char === '\r') return '';
            if (char !== ' ' && char !== '\t') return char;

            at += step;
        }

        return '';
    }

    function isNumericDot(index) {
        return (
            /[0-9\u0E50-\u0E59]/.test(sameLineNeighbour(index, -1)) ||
            /[0-9\u0E50-\u0E59]/.test(sameLineNeighbour(index, 1))
        );
    }

    function hasThaiNeighbour(index) {
        return (
            /[\u0E00-\u0E7F]/.test(sameLineNeighbour(index, -1)) ||
            /[\u0E00-\u0E7F]/.test(sameLineNeighbour(index, 1))
        );
    }

    let result = '';
    let removed = 0;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];

        if (
            char !== '.' ||
            !hasThaiNeighbour(index) ||
            isNumericDot(index) ||
            abbreviationEndingAt(index)
        ) {
            result += char;
            continue;
        }

        removed += 1;

        // กลืนช่องว่างที่ติดกับจุด เพื่อไม่ให้เหลือช่องว่างซ้ำ
        while (
            source[index + 1] === ' ' ||
            source[index + 1] === '\t'
        ) {
            index += 1;
        }

        const lineStart =
            result === '' ||
            result.endsWith('\n') ||
            result.endsWith('\r');
        const lineEnd =
            index + 1 >= source.length ||
            source[index + 1] === '\n' ||
            source[index + 1] === '\r';

        if (!lineStart) {
            result = result.replace(/[ \t]+$/, '');
        }

        // แทนด้วยช่องว่างเดียว — ไม่เพิ่มช่องว่างซ้ำ/ท้ายบรรทัด/ต้นบรรทัด
        if (!lineStart && !lineEnd) {
            result += NOISE_GAP;
        }
    }

    return { text: result, removed: removed + collapsedDots };
}

// ระยะแก้ไขที่ยอมรับได้ — คำสั้นต้องใกล้มาก คำยาวผ่อนได้เล็กน้อย
//
// ข้อมูลหลักและคลังคำเป็นรายการที่ผู้ใช้ตั้งใจเพิ่ม (ชื่อคน/หน่วยงาน/สถานที่/
// ประโยคที่ใช้บ่อย) และ OCR มักอ่านผิดหลายตัวพร้อมกัน เช่น "สตยานริกษ" กับ
// "สัตยานุรักษ์" (ห่าง 4) หรือประโยคยาวที่อ่านตกหล่นหลายคำ
//
// จึงผ่อนระยะตามความยาว: วลียิ่งยาวยิ่งมีตัวอักษรให้ OCR อ่านผิดได้มาก
// (แต่ยังต้องผ่าน cutoff ของ difflib และตัวอักษรร่วมขั้นต่ำอีกชั้น)
function allowedDistance(length, source) {
    if (length <= 3) return 1;
    if (length <= 6) return 2;

    if (source === 'master' || source === 'wordbank') {
        if (length >= 20) return Math.ceil(length * 0.4);
        if (length >= 8) return 4;
    }

    return 3;
}

// จำนวนตัวอักษรแต่ละตัว (ใช้กรองผู้สมัครก่อนเรียก difflib)
function charCounts(word) {
    const counts = new Map();

    for (const char of word) {
        counts.set(char, (counts.get(char) || 0) + 1);
    }

    return counts;
}

// ตัวอักษรร่วมกันอย่างน้อยเท่าไร — คำที่ OCR อ่านผิดมักเพี้ยนแค่ 1–2 ตัว
function commonChars(counts, candidate) {
    const remaining = new Map(counts);
    let common = 0;

    for (const char of candidate) {
        const count = remaining.get(char) || 0;

        if (count > 0) {
            remaining.set(char, count - 1);
            common += 1;
        }
    }

    return common;
}

// คำที่มีตัวอักษรชุดเดียวกันแต่สลับที่กัน (เงิน/เงนิ) — OCR มักสลับ
// สระ/วรรณยุกต์ จึงเป็นหลักฐานที่แม่นกว่าความคล้ายแบบ difflib
function sameCharacters(a, b) {
    if (a.length !== b.length) return false;

    return commonChars(charCounts(a), b) === a.length;
}

function toWords(value, split) {
    const list = Array.isArray(value) ? value : [];

    return list.map(function (item) {
        const text = String(item == null ? '' : item)
            .replace(/\s+/g, ' ')
            .trim();

        return text;
    }).filter(Boolean).reduce(function (words, text) {
        // ชื่อในข้อมูลหลักอาจมีหลายคำ (เช่น "บริษัท ทดสอบ จำกัด")
        // หรือมีวงเล็บ/จุด (เช่น "นักวิชาการ (ที่ปรึกษา)" / "ผศ.สุนิสา")
        // จึงแยกเป็นคำย่อยเพื่อเทียบกับคำที่ OCR ได้
        const parts = split
            ? text.split(/[\s,;/|().]+/)
            : [text];

        parts.forEach(function (part) {
            const word = part.trim();

            if (
                word.length >= MIN_WORD_LENGTH &&
                word.length <= MAX_WORD_LENGTH
            ) {
                words.push(word);
            }
        });

        return words;
    }, []);
}

// กลุ่มคำ + ดัชนีตามความยาว (ลดจำนวนผู้สมัครที่ต้องเทียบ)
function buildGroup(source, items, split) {
    const seen = new Set();
    const byLength = new Map();

    toWords(items, split).forEach(function (word) {
        if (seen.has(word)) return;

        seen.add(word);

        if (!byLength.has(word.length)) {
            byLength.set(word.length, []);
        }

        byLength.get(word.length).push(word);
    });

    return {
        source: source,
        byLength: byLength,
        set: seen
    };
}

function groupSize(group) {
    let size = 0;

    group.byLength.forEach(function (list) {
        size += list.length;
    });

    return size;
}

// ผู้สมัครที่ความยาวต่างกันไม่เกินระยะที่ยอมรับ
function candidatesOf(group, length, limit) {
    const candidates = [];
    const min = Math.max(MIN_WORD_LENGTH, length - limit);
    const max = length + limit;

    for (let size = min; size <= max; size++) {
        const list = group.byLength.get(size);

        if (!list) continue;

        for (let index = 0; index < list.length; index++) {
            candidates.push(list[index]);
        }
    }

    return candidates;
}

// คำที่ขึ้นต้นด้วยคำที่รู้จักแล้วเหลือท้าย 1 ตัว เช่น "ว่าที่ร" (ว่าที่ + ร)
// มักเป็นคำย่อ/คำผสมที่พจนานุกรมไม่มี — ไม่ควรตัดท้ายทิ้ง
function hasSingleCharTail(word, knownSet) {
    const max = Math.min(MAX_WORD_LENGTH, word.length - 1);

    for (let size = max; size >= MIN_WORD_LENGTH; size--) {
        if (knownSet.has(word.slice(0, size))) {
            return word.length - size === 1;
        }
    }

    return false;
}

// ตัดคำด้วยคำที่ยาวที่สุดจากชุดคำที่รู้จัก
// คืน true เมื่อตัดได้ครบทุกช่วง (ไม่ใช่คำผิด)
function isFullyKnown(word, knownSet) {
    let index = 0;

    while (index < word.length) {
        let length = 0;
        const max = Math.min(MAX_WORD_LENGTH, word.length - index);

        for (let size = max; size >= MIN_WORD_LENGTH; size--) {
            if (knownSet.has(word.slice(index, index + size))) {
                length = size;
                break;
            }
        }

        if (length === 0) return false;

        index += length;
    }

    return true;
}

// แยกส่วนของวลีด้วย "/" — แต่คง "2/2569" (ปี พ.ศ.) ไว้เป็นส่วนเดียว
function splitPhraseToken(token) {
    const parts = [];
    let current = '';

    for (let index = 0; index < token.length; index++) {
        const char = token[index];
        const numericSlash =
            char === '/' &&
            /[0-9]/.test(token[index - 1] || '') &&
            /[0-9]/.test(token[index + 1] || '');

        if (char === '/' && !numericSlash) {
            parts.push(current);
            current = '';
        } else {
            current += char;
        }
    }

    parts.push(current);

    return parts.filter(Boolean);
}

// วลีในคลังคำที่มีหลายส่วน — คั่นด้วยช่องว่างหรือ "/"
// (เช่น "โครงการ... นวัตกรรมและเทคโนโลยี" หรือ "ก/ข/ค")
function buildPhrases(items) {
    return (Array.isArray(items) ? items : [])
        .map(function (item) {
            return String(item == null ? '' : item)
                .replace(/\s+/g, ' ')
                .trim();
        })
        .map(function (value) {
            const parts = [];

            value.split(/\s+/).forEach(function (token) {
                splitPhraseToken(token).forEach(function (part) {
                    parts.push(part);
                });
            });

            return { value: value, parts: parts };
        })
        .filter(function (phrase) {
            return phrase.parts.length >= 2;
        });
}

// หาตำแหน่งของวลีที่ส่วนต่าง ๆ ปรากฏเรียงกันภายในระยะที่กำหนด
function findPhraseSpan(text, parts, from) {
    let first = text.indexOf(parts[0], from);

    while (first !== -1) {
        let lastEnd = first + parts[0].length;
        let position = lastEnd;
        let found = true;
        // ข้อความระหว่างส่วนของวลี (ไม่รวมตัวส่วนเอง) — ใช้ย้ายไปไว้หลังวลี
        const gaps = [];

        for (let index = 1; index < parts.length; index++) {
            const at = text.indexOf(parts[index], position);

            if (at === -1 || at - position > MAX_PHRASE_GAP) {
                found = false;
                break;
            }

            gaps.push(text.slice(position, at));

            lastEnd = at + parts[index].length;
            position = lastEnd;
        }

        if (found) {
            return {
                start: first,
                end: lastEnd,
                gaps: gaps
            };
        }

        first = text.indexOf(parts[0], first + 1);
    }

    return null;
}

// รวมส่วนของวลีที่ OCR ตัดข้ามบรรทัด โดยเก็บข้อความที่คั่นอยู่
// ไปไว้หลังวลี (เช่น ชื่อคนที่ OCR อ่านคั่นกลางชื่อโครงการ)
function reassemblePhrases(text, phrases) {
    let result = String(text == null ? '' : text);
    let count = 0;

    phrases.forEach(function (phrase) {
        let from = 0;

        while (from < result.length) {
            const span = findPhraseSpan(result, phrase.parts, from);

            if (!span) break;

            const gap = span.gaps.join(' ');

            // วลีที่อยู่บรรทัดเดียวกันอยู่แล้ว = ไม่ต้องทำอะไร
            // และไม่รวมถ้าข้อความคั่นยาว/หลายบรรทัดเกินไป (อาจคนละส่วนของเอกสาร)
            if (
                !gap.includes('\n') ||
                gap.length > MAX_PHRASE_GAP ||
                (gap.match(/\n/g) || []).length > MAX_PHRASE_LINES
            ) {
                from = span.start + 1;
                continue;
            }

            const between = gap.replace(/\s+/g, ' ').trim();
            const replacement = phrase.value +
                (between === '' ? '' : ' ' + between);

            result =
                result.slice(0, span.start) +
                replacement +
                result.slice(span.end);

            count += 1;
            from = span.start + replacement.length;
        }
    });

    return { text: result, count: count };
}

// หาคำที่ใกล้ที่สุดในกลุ่มเดียว — คืน { word, source } หรือ null
// lengthTolerance = ความยาวต่างได้กี่ตัว (ไม่ส่ง = ตามระยะแก้ไขของกลุ่ม)
function matchInGroup(token, group, cutoff, counts, lengthTolerance) {
    const limit = allowedDistance(token.length, group.source);
    const minCommon = token.length - limit;
    const range = lengthTolerance === undefined
        ? limit
        : Math.min(limit, lengthTolerance);

    const candidates = candidatesOf(group, token.length, range)
        .filter(function (candidate) {
            // คำที่แทนได้ต้องเป็นอักษรไทยล้วน — กันคำในพจนานุกรมที่มีจุด
            // (เช่น "ผศ.") ถูกเติมเข้าท้ายคำที่ OCR อ่านได้
            if (!THAI_ONLY.test(candidate)) return false;
            if (commonChars(counts, candidate) < minCommon) return false;

            // กันการแทนคำที่ถูกอยู่แล้วด้วยคำอื่นที่ความคล้ายสูงแต่ห่างหลายตัว
            return levenshtein(token, candidate) <= limit;
        });

    if (candidates.length === 0) return null;

    // ตัวอักษรชุดเดียวกัน = คำเดียวกันที่ถูกสลับที่ — ใช้ก่อนเสมอ
    if (token.length >= 4) {
        const anagram = candidates.find(function (candidate) {
            return sameCharacters(token, candidate);
        });

        if (anagram) {
            return {
                word: anagram,
                source: group.source
            };
        }
    }

    // cutoff เฉพาะกลุ่ม (ถ้าผู้เรียกกำหนดมา ใช้ค่านั้นทุกกลุ่ม)
    const limitRatio = cutoff === null
        ? (GROUP_CUTOFFS[group.source] || DEFAULT_CUTOFF)
        : cutoff;

    const matches = difflib.getCloseMatches(
        token,
        candidates,
        MATCH_LIMIT,
        limitRatio
    );

    return matches.length > 0
        ? { word: matches[0], source: group.source }
        : null;
}

// หาคำที่ใกล้ที่สุดจากกลุ่มตามลำดับความสำคัญ
// คืน { word, source } หรือ null
function correctToken(token, groups, knownSet, cutoff, lengthTolerance) {
    if (knownSet.has(token)) return null;

    // คำย่อ/คำผสมที่ขึ้นต้นด้วยคำรู้จักแล้วมีท้าย 1 ตัว = ปล่อยไว้
    if (hasSingleCharTail(token, knownSet)) return null;

    const counts = charCounts(token);

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        const group = groups[groupIndex];

        if (groupSize(group) === 0) continue;

        // พจนานุกรมอย่างเดียว: คำที่ตัดเป็นคำในพจนานุกรมได้ครบ = ไม่ใช่คำผิด
        // (ข้อมูลหลัก/คลังคำเป็นรายการที่ผู้ใช้ตั้งใจเพิ่ม จึงเทียบก่อนเสมอ
        //  แม้คำนั้นจะบังเอิญตัดเป็นคำในพจนานุกรมได้)
        if (
            group.source === 'dictionary' &&
            isFullyKnown(token, group.set)
        ) {
            return null;
        }

        const hit = matchInGroup(
            token,
            group,
            cutoff,
            counts,
            lengthTolerance
        );

        if (hit) return hit;
    }

    return null;
}

/**
 * แก้คำที่ OCR อ่านผิดโดยเทียบกับข้อมูลหลัก คลังคำศัพท์ และพจนานุกรม
 *
 * @param {string} text
 * @param {object} [options]
 * @param {Array} [options.master]      ข้อมูลหลัก (ชื่อ/กลุ่ม/กลุ่มย่อย)
 * @param {Array} [options.words]       คำในคลังคำศัพท์
 * @param {Array} [options.dictionary]  คำในพจนานุกรม (ไม่ส่ง = อ่านจาก th_TH.dic)
 * @param {number} [options.cutoff]     ความคล้ายขั้นต่ำของ difflib (0–1)
 * @returns {{text: string, changed: number, dots: number, replacements: Array}}
 */
function improveText(text, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const input = String(text == null ? '' : text);

    const dictionary = opts.dictionary === undefined
        ? loadDictionary()
        : opts.dictionary;

    // แทนจุดที่ OCR ใส่เกินด้วยช่องว่างก่อนตัดคำ
    const cleaned = replaceNoisePeriods(
        input,
        buildAbbreviations(opts.master, opts.words, dictionary),
        buildBoundaryRequired(opts.master, opts.words, dictionary)
    );
    const source = cleaned.text;

    const groups = [
        buildGroup('master', opts.master, true),
        buildGroup('wordbank', opts.words, true),
        buildGroup('dictionary', dictionary, false)
    ];

    // รวมคำทั้งหมดไว้ตรวจว่า "คำนี้รู้จักอยู่แล้ว" หรือไม่
    const knownSet = new Set();

    groups.forEach(function (group) {
        group.byLength.forEach(function (list) {
            list.forEach(function (word) {
                knownSet.add(word);
            });
        });
    });

    const cutoff = Number(opts.cutoff) >= 0 && Number(opts.cutoff) <= 1
        ? Number(opts.cutoff)
        : null;

    const replacements = [];

    // คำไทยที่ OCR ได้ (เรียงตามตำแหน่งในข้อความ)
    const tokens = [];
    let match;

    THAI_RUN.lastIndex = 0;

    while ((match = THAI_RUN.exec(source)) !== null) {
        tokens.push({
            text: match[0],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    function replaceWith(token, hit) {
        replacements.push({
            from: token,
            to: hit.word,
            source: hit.source
        });

        return hit.word;
    }

    // แก้คำเดียว — คืนข้อความเดิมเมื่อไม่ต้องแก้
    function correctOne(token) {
        if (
            token.length < MIN_WORD_LENGTH ||
            token.length > MAX_WORD_LENGTH
        ) {
            return token;
        }

        const hit = correctToken(token, groups, knownSet, cutoff);

        return hit ? replaceWith(token, hit) : token;
    }

    // เติมท้ายคำที่ OCR อ่านขาด (เฉพาะข้อมูลหลัก/คลังคำ) — รับเฉพาะคำที่ขึ้นต้นด้วยคำเดิม
    // (เช่น "ผู้อานวยก" → "ผู้อานวยการ") ไม่แก้คำที่ถูกอยู่แล้ว
    function completeWord(token) {
        const hit = correctToken(
            token,
            groups.slice(0, 2),
            knownSet,
            cutoff
        );
        const extra = hit ? hit.word.length - token.length : 0;

        return extra > 0 && extra <= 4
            ? replaceWith(token, hit)
            : token;
    }

    // ช่องว่างระหว่างคำไทย (รวมช่องว่างที่มาจากจุด) แต่ไม่ข้ามบรรทัด
    function isJoinableGap(text) {
        return /^[ \t]+$/.test(text) ||
            /^[ \t]*\u0001[ \t]*$/.test(text);
    }

    const parts = [];
    let last = 0;
    let index = 0;

    while (index < tokens.length) {
        // รวมคำไทยที่คั่นด้วยช่องว่างเป็นช่วงเดียว — OCR อาจแยกคำเดียว
        // เป็นสองก้อน (เช่น "จา นวนเงนิ") จึงลองเทียบทั้งช่วงก่อน
        const cluster = [tokens[index]];
        let next = index + 1;

        while (
            next < tokens.length &&
            isJoinableGap(
                source.slice(tokens[next - 1].end, tokens[next].start)
            )
        ) {
            cluster.push(tokens[next]);
            next += 1;
        }

        const start = cluster[0].start;
        const end = cluster[cluster.length - 1].end;
        const slice = source.slice(start, end);
        const hasNoiseGap = slice.includes(NOISE_GAP);

        parts.push(source.slice(last, start));

        if (cluster.length === 1) {
            parts.push(correctOne(cluster[0].text));

        } else {
            const joined = cluster.map(function (item) {
                return item.text;
            }).join('');

            // ทั้งช่วงเป็นคำที่รู้จักอยู่แล้ว = คงการเว้นวรรคเดิมไว้
            // (คำที่เพียง "ตัดเป็นคำได้" ยังต้องให้ correctToken ตรวจ
            //  ข้อมูลหลัก/คลังคำก่อน เพราะอาจเป็นคำที่ผู้ใช้ตั้งไว้)
            if (knownSet.has(joined)) {
                // คำที่รู้จักแล้ว: ยุบช่องว่างที่มาจากจุด แต่คงช่องว่างจริง
                parts.push(
                    hasNoiseGap
                        ? slice.split(NOISE_GAP).join('')
                        : slice
                );

            } else {
                // ช่วงที่รวมหลายคำเข้าด้วยกันจะแทนได้เฉพาะคำที่ความยาวใกล้เคียง
                // (กันการแทนทั้งชื่อด้วยคำสั้นกว่า เช่น ตัดนามสกุลทิ้ง)
                const hit = joined.length <= MAX_WORD_LENGTH
                    ? correctToken(joined, groups, knownSet, cutoff, 1)
                    : null;

                if (hit) {
                    // แทนทั้งช่วง (ตัดช่องว่างที่ OCR ใส่ผิดออก)
                    parts.push(replaceWith(joined, hit));

                } else if (hasNoiseGap) {
                    // จุดอาจคั่นระหว่างคำเต็ม ๆ (เช่น "เรียน.ผู้อานวยก")
                    // ถ้าทุกท่อนยาวพอ ให้แก้ทีละคำ — แต่ถ้ามีเศษคำสั้น ๆ
                    // ที่ถูกจุดตัด ให้คงไว้ก่อนเพื่อกันข้อความเพี้ยน
                    const allWords = cluster.every(function (item) {
                        return item.text.length >= 4;
                    });
                    // ต้องมีแต่ช่องว่างที่มาจากจุดจริง ๆ — ถ้ามีช่องว่างเดิม
                    // คั่นอยู่ด้วย แปลว่าอาจเป็นหลายคำในประโยค ไม่แก้ทีละท่อน
                    const sentinelOnly = !/[ \t]/.test(slice);

                    if (allWords && sentinelOnly) {
                        cluster.forEach(function (item, itemIndex) {
                            if (itemIndex > 0) {
                                parts.push(' ');
                            }

                            parts.push(completeWord(item.text));
                        });
                    } else {
                        parts.push(slice);
                    }

                } else {
                    // เทียบทั้งช่วงไม่ได้ = แก้ทีละคำ
                    cluster.forEach(function (item, itemIndex) {
                        if (itemIndex > 0) {
                            parts.push(
                                source.slice(
                                    cluster[itemIndex - 1].end,
                                    item.start
                                )
                            );
                        }

                        parts.push(correctOne(item.text));
                    });
                }
            }
        }

        last = end;
        index = next;
    }

    parts.push(source.slice(last));

    // ช่องว่างที่มาจากจุดและไม่ได้ถูกยุบรวม — แปลงเป็นช่องว่างจริง
    const improved = parts.join('').split(NOISE_GAP).join(' ');

    // ต่อวลีในคลังคำที่ OCR ตัดข้ามบรรทัด (หลังแก้คำแล้ว เพื่อให้ส่วนของวลี
    // สะกดตรงกับคลังคำ)
    const reassembled = reassemblePhrases(
        improved,
        buildPhrases(opts.words)
    );

    return {
        text: reassembled.text,
        changed: replacements.length,
        dots: cleaned.removed,
        phrases: reassembled.count,
        replacements: replacements
    };
}

module.exports = {
    DEFAULT_CUTOFF,
    buildAbbreviations,
    replaceNoisePeriods,
    GROUP_CUTOFFS,
    improveText,
    parseWords,
    loadDictionary,
    dictionaryPath,
    buildPhrases,
    reassemblePhrases,
    allowedDistance,
    hasSingleCharTail,
    isFullyKnown
};
