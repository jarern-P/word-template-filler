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
// (OCR อาจแยกวลีข้ามบรรทัดโดยมีเนื้อหาคอลัมน์อื่นในตารางคั่น
//  ยาวหลายบรรทัด เช่น แผนงาน/หน่วยงาน/กองทุน ที่อ่านสลับกัน)
const MAX_PHRASE_GAP = 400;
const MAX_PHRASE_LINES = 20;

// ระยะจากจุดจบของส่วนหนึ่งถึงจุดเริ่มของส่วนถัดไปของวลีเดียวกัน
const MAX_PART_REACH = 200;

// การเทียบส่วนของวลีแบบผ่อน — OCR อาจตัดกลางคำ (เช่น "เทคโ"/"นโลยี")
// และมีข้อความอื่นคั่นกลางส่วน ส่วนต้องขึ้นต้นด้วยอักษรที่ตรงกัน
// ติดกันอย่างน้อย PART_PROBE ตัว (กันจับผิดเริ่มกลางคำ) แล้วจึงเทียบ
// ส่วนที่เหลือแบบข้ามข้อความคั่น
const PART_PROBE = 4;
const MAX_LEAD_SKIP = 4;        // อักษรต้นส่วนที่ OCR อ่านตก
const MAX_MID_SKIP = 4;         // อักษรกลางส่วนที่ OCR อ่านตก
const MAX_PART_TEXT_SKIP = 100; // ข้อความคั่นรวมกันภายในหนึ่งส่วน
const MAX_INLINE_SKIP = 12;     // ข้อความคั่นที่ไม่ข้ามบรรทัด

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

// เกณฑ์ความคล้ายของช่วงคำย่อย — เข้มกว่าเกณฑ์ปกติ เพราะช่วงสั้น
// จับคู่กับคำใกล้เคียงได้ง่าย (เช่น "นม" กับ "อนัม")
const FRAGMENT_CUTOFF = 0.88;

// ความยาวช่วงที่ยอมให้แทนในการแก้รันแบบค้นหา
// (สั้นกว่านี้มักเป็นเศษคำที่ตัดผิด แก้แล้วมักเพี้ยน)
const MIN_FRAGMENT_LENGTH = 4;

// ข้อจำกัดของการค้นหาการแทนในหนึ่งรัน — กันค้นนานเกินไป
// เท่ากับความยาวคำสูงสุด เพราะบรรทัดยาวที่มีคำผิดหนึ่งคำก็ต้องแก้ได้
// (เช่น "เห็นควรอนุมัตให้เบิกจ่ายได้ตามจำนวนเงินข้างต้น")
const MAX_SOLVE_LENGTH = MAX_WORD_LENGTH;
const MAX_SOLVE_PASSES = 6;

// อักษรที่ไม่รู้จักปนอยู่ในช่วงที่จะแทนได้สูงสุด
// (เกินนี้แปลว่าช่วงกินคำที่ไม่รู้จักจำนวนมาก = สุ่มเกินไป)
// คำไทยที่ OCR อ่านผิดมักยาว 5–8 ตัว จึงต้องเผื่อไว้มากกว่าหนึ่งคำสั้น
const MAX_RUN_UNKNOWN = 12;

// ช่วงที่ยังมีคำที่ตัดได้คั่นอยู่ ต้องไม่รู้จักปนไม่เกินนี้ — กันการแทน
// ช่วงยาวที่กลืนคำถูกต้องเข้าไปด้วย
const MAX_MIXED_UNKNOWN = 4;

// ความยาวสูงสุดของช่วงที่ไม่รู้จักล้วนที่จะลองแบ่งเป็นสองคำ
// (คำผิดสองคำติดกันโดยไม่มีคำที่รู้จักคั่น เช่น "นวตกรรมสงคม")
const MAX_SPLIT_LENGTH = 16;

// อักษรไม่รู้จักในช่วงที่ยอมให้หายไปจากการแทน (ไม่เกิน 1 ตัว)
// กันการแทนแบบลบท้ายช่วง เช่น "เงินอุดหนุนทัว" → "เงินอุดหนุน"
// ที่ผลลัพธ์ดูเป็นคำถูกแต่ทำข้อมูลจริงหาย
const MAX_UNKNOWN_DROPPED = 1;

// ระยะแก้ไขสูงสุดของการแทนช่วงในรัน — เข้มกว่าเกณฑ์ปกติ เพราะการแทน
// ช่วงกลางรันเลื่อนได้หลายอักษร เช่น "ทัวไป" → "ทั่วไป" (ระยะ 1)
// แต่ "เพื่อการศึกษา" → "สื่อการศึกษา" (ระยะ 3) ต้องไม่ถูกแทน
function solveDistance(length) {
    return Math.max(1, Math.ceil(length * 0.15));
}

// คำสั้นที่ใช้เป็นจุดยึดตอนตัดช่วงคำ — พจนานุกรมกลางไม่มีคำเหล่านี้
// (เช่น "และ" ไม่มีใน dictionary/th_TH.dic) ถ้าไม่กำหนดเอง ช่วงไม่รู้จัก
// จะยาวรวมกันไปถึงคำที่ควรแก้ด้วย
const SEGMENT_ANCHORS = new Set([
    'และ', 'หรือ', 'ไม่', 'แล้ว', 'ให้', 'ก็', 'หรือไม่'
]);

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
    const collapsed = original.replace(
        /[ \t]*\.[ \t]*(?:\.[ \t]*)+/g,
        '.'
    );

    // จุดที่ OCR ใส่คั่นกลางวันที่ เช่น "1.4/10/2569" → "14/10/2569"
    // (ตัดเฉพาะจุด ตัวเลขต้องอยู่ครบ — ไม่แตะทศนิยมอย่าง 4,000.00)
    let dateDots = 0;

    const source = collapsed.replace(
        /([0-9\u0E50-\u0E59]{1,2})\.([0-9\u0E50-\u0E59]{1,2}\/[0-9\u0E50-\u0E59]{1,2}\/[0-9\u0E50-\u0E59]{2,4})/g,
        function (match, day, rest) {
            dateDots += 1;

            return day + rest;
        }
    );

    // จำนวนจุดที่ถูกแทน (นับจุดซ้ำที่ยุบไปด้วย)
    const collapsedDots =
        (original.match(/\./g) || []).length -
        (collapsed.match(/\./g) || []).length;

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

    // จุดนี้อยู่หน้าวันที่รูปแบบ d/m/yyyy (เช่น "วันที่.14/10/2569")
    // = จุดที่ OCR ใส่เกิน ไม่ใช่จุดของทศนิยม
    function startsDate(index) {
        return /^[ \t]*[0-9\u0E50-\u0E59]{1,2}\/[0-9\u0E50-\u0E59]{1,2}\/[0-9\u0E50-\u0E59]{2,4}/
            .test(source.slice(index + 1));
    }

    let result = '';
    let removed = 0;

    for (let index = 0; index < source.length; index++) {
        const char = source[index];

        // จุดที่ติดตัวเลขปกติ (ทศนิยม) คงไว้ — ยกเว้นจุดที่นำหน้าวันที่
        const noiseDot =
            hasThaiNeighbour(index) &&
            (startsDate(index) || !isNumericDot(index));

        if (
            char !== '.' ||
            !noiseDot ||
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

    return {
        text: result,
        removed: removed + collapsedDots + dateDots
    };
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
        // หรือมีวงเล็บ/จุด/ขีด (เช่น "นักวิชาการ (ที่ปรึกษา)" /
        // "สำคัญค้างจ่าย-ม.ทักษิณ") จึงแยกเป็นคำย่อยเพื่อเทียบกับคำที่ OCR ได้
        const parts = split
            ? text.split(/[\s,;/|().-]+/)
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

// หาตำแหน่งของส่วนหนึ่งของวลีในข้อความ — ตรงตัวก่อน แล้วค่อยเทียบแบบผ่อน
// reach = ระยะสูงสุดจากจุดค้นหา (ไม่ส่ง = ไม่จำกัด ใช้กับส่วนแรกของวลี)
// คืน { start, end, gaps } โดย gaps คือข้อความที่คั่นอยู่ภายในส่วน
function matchPart(text, part, from, reach) {
    const exact = text.indexOf(part, from);

    if (
        exact !== -1 &&
        (reach === undefined || exact - from <= reach)
    ) {
        return { start: exact, end: exact + part.length, gaps: [] };
    }

    for (
        let lead = 0;
        lead <= MAX_LEAD_SKIP && lead < part.length;
        lead++
    ) {
        const rest = part.slice(lead);

        // ข้ามอักษรต้นได้ก็ต่อเมื่อส่วนที่เหลือยังมีความยาวพอ
        // ที่จะเทียบติดกันได้ครบ PART_PROBE — กันส่วนสั้นถูกยุบ
        // จนเหลืออักษรเดียวแล้วไปจับอักษรมั่วในข้อความ
        if (lead > 0 && rest.length < PART_PROBE) break;

        const probe = rest.slice(0, Math.min(PART_PROBE, rest.length));
        let at = text.indexOf(probe, from);

        while (at !== -1) {
            if (reach !== undefined && at - from > reach) break;

            const span = alignPart(text, rest, at);

            if (span) return span;

            at = text.indexOf(probe, at + 1);
        }
    }

    return null;
}

// เทียบส่วนของวลีแบบยอมข้ามข้อความคั่น (คอลัมน์อื่นที่ OCR อ่านแทรก)
// และข้ามอักษรที่ OCR อ่านตก (จำกัดจำนวนเพื่อกันเทียบผิดตำแหน่ง)
function alignPart(text, rest, start) {
    let index = 0;
    let position = start;
    let skipped = 0;
    let dropped = 0;
    const gaps = [];

    while (index < rest.length) {
        if (text[position] === rest[index]) {
            position += 1;
            index += 1;
            continue;
        }

        const at = text.indexOf(rest[index], position);
        const gap = at === -1 ? null : text.slice(position, at);
        const tooLong =
            gap === null ||
            gap.length > MAX_PART_TEXT_SKIP ||
            (!gap.includes('\n') && gap.length > MAX_INLINE_SKIP);

        if (tooLong) {
            // ไม่พบอักษรตัวนี้ข้างหน้า = อาจเป็นอักษรที่ OCR อ่านตก
            if (dropped >= MAX_MID_SKIP) return null;

            dropped += 1;
            index += 1;
            continue;
        }

        gaps.push(gap);
        skipped += gap.length;

        // ข้ามไปที่ตัวอักษรที่ตรงกันแล้ว — position = at + 1 อย่างเดียว
        // ไม่พอ เพราะ index ยังค้างที่ตัวเดิม ทำให้รอบถัดไปไปค้นตัวเดิมซ้ำ
        position = at + 1;
        index += 1;

        if (skipped > MAX_PART_TEXT_SKIP) return null;
    }

    return { start: start, end: position, gaps: gaps };
}

// หาตำแหน่งของวลีที่ส่วนต่าง ๆ ปรากฏเรียงกันภายในระยะที่กำหนด
// ส่วนที่ OCR ตัดกลางคำ/มีข้อความคั่น จะเทียบแบบผ่อนด้วย matchPart
function findPhraseSpan(text, parts, from) {
    let first = matchPart(text, parts[0], from);

    while (first) {
        let position = first.end;
        let found = true;
        // ข้อความระหว่างส่วนของวลี (รวมข้อความคั่นภายในส่วน)
        // — ใช้ย้ายไปไว้หลังวลี (เช่น ชื่อคนที่ OCR อ่านคั่นกลางชื่อโครงการ)
        const gaps = first.gaps.slice();

        for (let index = 1; index < parts.length; index++) {
            const next = matchPart(
                text,
                parts[index],
                position,
                MAX_PART_REACH
            );

            if (!next) {
                found = false;
                break;
            }

            gaps.push(text.slice(position, next.start));

            next.gaps.forEach(function (gap) {
                gaps.push(gap);
            });

            position = next.end;
        }

        if (found) {
            return {
                start: first.start,
                end: position,
                gaps: gaps
            };
        }

        from = first.start + 1;
        first = matchPart(text, parts[0], from);
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

    if (matches.length === 0) return null;

    // เลือกคำที่เก็บตัวอักษรเดิมไว้ได้ครบที่สุด — difflib ดูแค่ความคล้าย
    // จึงอาจเลือกคำที่สั้นกว่าซึ่งทำให้ตัวอักษรหาย เช่น "บสำคัญ" → "สำคัญ"
    // (ข้อมูลหาย) ทั้งที่ "ใบสำคัญ" ใกล้เท่ากันและเก็บอักษรเดิมครบทุกตัว
    let best = matches[0];
    let bestCoverage = commonChars(counts, best);

    for (let index = 1; index < matches.length; index++) {
        const coverage = commonChars(counts, matches[index]);

        if (coverage > bestCoverage) {
            best = matches[index];
            bestCoverage = coverage;
        }
    }

    return { word: best, source: group.source };
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

// ── แก้รันคำไทยที่ทั้งรันไม่ตรงกับคำใด โดยค้นหาการแทนช่วงเดียว ──
//
// ภาษาไทยไม่มีช่องว่างคั่นคำ คำที่ OCR อ่านผิดบางช่วงจึงทำให้ทั้งรัน
// (เช่น "เงินอุดหนุนทัวไป" / "แบบขออนมัติ") ไม่ตรงกับคำใดในคลังคำ/
// พจนานุกรมเลย การเทียบทั้งรันจึงไม่ได้ผล
//
// วิธีนี้ค้นหาช่วงความยาวอย่างน้อย MIN_FRAGMENT_LENGTH ที่เมื่อแทนด้วย
// คำในระบบแล้ว "ทั้งรันตัดเป็นคำที่รู้จักได้ครบ" จึงยอมรับ — การตรวจว่า
// ผลลัพธ์ตัดได้ครบเป็นตัวกันแก้ผิด เช่น "กองทุนเพื่อการศึกษา" ที่ถูก
// ต้องอยู่แล้วแต่ longest match ตัดได้ช่วงแปลก ๆ จะต้องไม่ถูกแตะ

// ตัดคำแบบ longest match — คืนช่วงคำตามลำดับ { known, text }
function segmentPieces(token, knownSet) {
    function isKnown(text) {
        return knownSet.has(text) || SEGMENT_ANCHORS.has(text);
    }

    const pieces = [];
    let index = 0;
    let unknownStart = -1;

    while (index < token.length) {
        let length = 0;
        const max = Math.min(MAX_WORD_LENGTH, token.length - index);

        for (let size = max; size >= MIN_WORD_LENGTH; size--) {
            if (isKnown(token.slice(index, index + size))) {
                length = size;
                break;
            }
        }

        if (length > 0) {
            if (unknownStart !== -1) {
                pieces.push({
                    known: false,
                    text: token.slice(unknownStart, index)
                });
                unknownStart = -1;
            }

            pieces.push({
                known: true,
                text: token.slice(index, index + length)
            });

            index += length;

        } else {
            if (unknownStart === -1) unknownStart = index;
            index += 1;
        }
    }

    if (unknownStart !== -1) {
        pieces.push({ known: false, text: token.slice(unknownStart) });
    }

    return pieces;
}

// แก้ช่วงที่ไม่รู้จักล้วนซึ่งมีคำผิดติดกันสองคำ โดยลองแบ่งเป็นสองส่วน
// แล้วแก้ทีละส่วน — คืน { word, source } ของส่วนแรก หรือ null
//
// เลือกจุดแบ่งที่ระยะแก้ไขรวมน้อยที่สุด เพื่อไม่ให้ตัดผิดคำ
function splitCorrection(sub, groups, knownSet, cutoff) {
    let best = null;
    let bestDistance = Infinity;

    for (let cut = 3; cut <= sub.length - 3; cut++) {
        const left = sub.slice(0, cut);
        const right = sub.slice(cut);

        const first = correctToken(left, groups, knownSet, cutoff);

        if (!first) continue;

        const second = correctToken(right, groups, knownSet, cutoff);

        if (!second) continue;

        const distance =
            levenshtein(left, first.word) + levenshtein(right, second.word);

        // ต้องใกล้ทั้งสองส่วน — การแบ่งผิดคำจะทำให้ระยะรวมโต
        if (
            distance >
            solveDistance(left.length) + solveDistance(right.length)
        ) {
            continue;
        }

        if (distance < bestDistance) {
            bestDistance = distance;

            best = {
                word: first.word + second.word,
                source: first.source
            };
        }
    }

    return best;
}

// คำที่รู้จักใกล้ที่สุด โดยไม่ตรวจว่าคำเดิมตัดเป็นคำได้ครบหรือไม่
// ใช้กับช่วงที่ตัดคำแล้วดูเหมือนรู้จัก แต่เกิดจากคำสั้นมาต่อกันผิดคำ
// (เช่น "สงคม" ที่ตัดเป็น "สง" + "คม") ซึ่ง correctToken จะปล่อยผ่าน
function closestKnown(sub, groups, cutoff) {
    const counts = charCounts(sub);

    for (let index = 0; index < groups.length; index++) {
        const group = groups[index];

        if (groupSize(group) === 0) continue;

        const hit = matchInGroup(sub, group, cutoff, counts);

        if (hit && hit.word !== sub) return hit;
    }

    return null;
}

/**
 * แก้รันคำไทยที่ทั้งรันไม่ตรงกับคำใด — ค้นหาช่วงที่แทนแล้วทำให้รัน
 * ตัดเป็นคำรู้จักได้ดีขึ้น แล้วจึงยอมรับ (ทำซ้ำได้หลายช่วงในรันเดียว)
 *
 * ช่วงที่แทนต้องเป็นผลรวมของช่วงคำที่ตัดได้เท่านั้น (จับขอบช่วงกับ
 * การตัดคำ) — เว้นแต่ช่วงที่ตัดเป็นคำสั้น ๆ มาต่อกัน ซึ่งอาจเป็นคำเดียว
 * ที่ OCR อ่านผิด (เช่น "สง"/"คม" → "สังคม")
 *
 * การตรวจว่า "จำนวนอักษรที่ยังไม่รู้จักต้องลดลง" (หรือจำนวนคำที่ตัดได้
 * ลดลง) เป็นตัวกันแก้ผิด เช่น "กองทุนเพื่อการศึกษา" ที่ถูกต้องอยู่แล้ว
 * แต่ longest match ตัดได้ช่วงแปลก ๆ ("เพื่"/"อก"/"าร")
 *
 * ไม่บังคับให้ทั้งรันกลายเป็นคำรู้จักครบ เพราะบรรทัดหนึ่งมักมีคำผิด
 * มากกว่าหนึ่งคำและอาจมีชื่อเฉพาะที่ยังไม่รู้จักคั่นอยู่ (เช่น
 * "นวตกรรมสงคมและนวตกรร") — แก้ทีละช่วงได้ตราบใดที่ยังดีขึ้นจริง
 *
 * @param {string} token    รันคำไทยที่ correctToken แก้ทั้งรันไม่ได้
 * @param {Array} groups    กลุ่มคำเรียงตามลำดับความสำคัญ
 * @param {Set} knownSet    คำที่รู้จักทั้งหมด
 * @param {number|null} cutoff ความคล้ายที่ผู้ใช้กำหนด (ไม่ส่ง = ตามปกติ)
 * @param {Function} replaceWith บันทึกการแทนคำเพื่อนับจำนวนที่แก้
 * @returns {string|null} ข้อความใหม่ หรือ null เมื่อไม่พบการแทนที่ปลอดภัย
 */
function correctRun(token, groups, knownSet, cutoff, replaceWith) {
    if (token.length > MAX_SOLVE_LENGTH) return null;

    function piecesOf(text) {
        return segmentPieces(text, knownSet);
    }

    function fullyKnown(pieces) {
        for (let index = 0; index < pieces.length; index++) {
            if (!pieces[index].known) return false;
        }

        return true;
    }

    // จำนวนอักษรที่ยังตัดเป็นคำรู้จักไม่ได้ — ใช้เทียบว่าการแทนดีขึ้นจริง
    function unknownChars(pieces) {
        let total = 0;

        for (let index = 0; index < pieces.length; index++) {
            if (!pieces[index].known) total += pieces[index].text.length;
        }

        return total;
    }

    const firstPieces = piecesOf(token);

    if (fullyKnown(firstPieces)) return null;

    const fragmentCutoff = cutoff === null ? FRAGMENT_CUTOFF : cutoff;

    let current = token;
    let currentPieces = firstPieces;
    let count = 0;

    for (let pass = 0; pass < MAX_SOLVE_PASSES; pass++) {
        let applied = false;

        for (
            let start = 0;
            start < currentPieces.length && !applied;
            start++
        ) {
            let unknown = 0;
            let unknownText = '';
            let knownText = '';
            let position = 0;

            for (let index = 0; index < start; index++) {
                position += currentPieces[index].text.length;
            }

            for (
                let finish = start;
                finish < currentPieces.length;
                finish++
            ) {
                const piece = currentPieces[finish];

                if (!piece.known) {
                    unknown += piece.text.length;
                    unknownText += piece.text;
                } else {
                    knownText += piece.text;
                }

                const sub = currentPieces
                    .slice(start, finish + 1)
                    .map(function (item) { return item.text; })
                    .join('');
                position += piece.text.length;

                // ช่วงที่ตัดเป็นคำสั้น ๆ มาต่อกัน (เช่น "สง"/"คม") อาจเป็นคำที่
                // OCR อ่านผิดทั้งคำ แม้จะดูเหมือนรู้จักแล้ว — ลองเทียบเฉพาะ
                // ช่วงสั้น (ไม่เกิน 3 ชิ้น) และต้องเก็บอักษรเดิมไว้ครบ
                const shortSpan =
                    unknown === 0 &&
                    finish - start <= 2 &&
                    currentPieces
                        .slice(start, finish + 1)
                        .every(function (item) {
                            return item.text.length <= 2;
                        });

                if (
                    sub.length < MIN_FRAGMENT_LENGTH ||
                    (unknown === 0 && !shortSpan) ||
                    unknown > MAX_RUN_UNKNOWN
                ) {
                    continue;
                }

                // ช่วงที่ยังมีคำที่ตัดได้คั่นอยู่ = ต้องไม่รู้จักปนกันไม่เกิน
                // MAX_MIXED_UNKNOWN ตัว กันการแทนช่วงยาวที่กลืนคำถูกต้อง
                const allUnknown = unknown === sub.length;

                if (unknown > 0 && !allUnknown && unknown > MAX_MIXED_UNKNOWN) {
                    continue;
                }

                const hit = unknown === 0
                    ? closestKnown(sub, groups, fragmentCutoff)
                    : (correctToken(sub, groups, knownSet, fragmentCutoff) ||
                        (allUnknown && sub.length <= MAX_SPLIT_LENGTH
                            ? splitCorrection(
                                sub,
                                groups,
                                knownSet,
                                fragmentCutoff
                            )
                            : null));

                if (!hit) continue;

                // ต้องใกล้มากจริง ๆ — การแทนช่วงกลางรันอันตรายกว่า
                // การแทนทั้งรัน จึงคุมระยะให้สั้นกว่าเกณฑ์ปกติ
                if (levenshtein(sub, hit.word) > solveDistance(sub.length)) {
                    continue;
                }

                // อักษรที่ไม่รู้จักต้องยังอยู่ในคำใหม่ (หายได้ไม่เกิน 1 ตัว)
                // กันแทนแบบลบท้ายช่วง เช่น ตัด "ทัว" ทิ้งเฉย ๆ
                const kept = commonChars(charCounts(unknownText), hit.word);

                if (unknownText.length - kept > MAX_UNKNOWN_DROPPED) {
                    continue;
                }

                // อักษรของคำที่ตัดได้ต้องไม่หายไป — เช่น "อ" ใน "อก" ของ
                // "อการศึกษา" → "การศึกษา" (ข้อความที่ถูกอยู่แล้วจะเสีย)
                if (
                    commonChars(charCounts(knownText), hit.word) <
                    knownText.length
                ) {
                    continue;
                }

                // ช่วงที่ดูเหมือนรู้จักครบ (ตัดเป็นคำสั้น ๆ ได้) รับได้เฉพาะ
                // เมื่อคำใหม่เก็บอักษรเดิมครบทุกตัว ไม่งั้นจะกลายเป็นลบข้อมูล
                if (
                    unknown === 0 &&
                    commonChars(charCounts(sub), hit.word) < sub.length
                ) {
                    continue;
                }

                // กันการเติมอักษรซ้ำกับคำก่อนหน้า — เช่น "เพื่อก" + "การศึกษา"
                // กลายเป็น "เพื่อกการศึกษา" เพราะ "อก" ถูกตัดข้ามคำไปแล้ว
                const beforeChar =
                    current[position - sub.length - 1] || '';

                if (
                    beforeChar !== '' &&
                    hit.word[0] === beforeChar &&
                    hit.word[0] !== sub[0]
                ) {
                    continue;
                }

                const before = current.slice(0, position - sub.length);
                const after = current.slice(position);
                const next = before + hit.word + after;
                const nextPieces = piecesOf(next);

                // ผลลัพธ์ต้องดีขึ้นจริง — อักษรที่ยังไม่รู้จักต้องลดลง
                // หรืออย่างน้อยจำนวนคำที่ตัดได้ต้องลดลง (ตัดคำได้ยาวขึ้น)
                const nextUnknown = unknownChars(nextPieces);
                const nowUnknown = unknownChars(currentPieces);

                if (nextUnknown > nowUnknown) continue;

                if (
                    nextUnknown === nowUnknown &&
                    nextPieces.length >= currentPieces.length
                ) {
                    continue;
                }

                replaceWith(sub, hit);
                current = next;
                currentPieces = nextPieces;
                count += 1;
                applied = true;
                break;
            }
        }

        if (!applied) break;
    }

    return count > 0 ? current : null;
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

        if (hit) return replaceWith(token, hit);

        // ทั้งรันไม่ตรงคำใด — ค้นหาการแทนช่วงเดียวที่ทำให้รันตัดเป็น
        // คำที่รู้จักได้ครบ (กันแก้ผิด ถ้ายังตัดไม่ได้ครบจะไม่แตะ)
        const fixed = correctRun(
            token,
            groups,
            knownSet,
            cutoff,
            replaceWith
        );

        return fixed === null ? token : fixed;
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
    isFullyKnown,
    // DEBUG-TEMP
    matchPart,
    segmentPieces
};
