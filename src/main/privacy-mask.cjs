// ปกปิดคำเฉพาะก่อนส่งข้อความให้ AI (Gemini) แล้วแทนค่าคืนเมื่อได้ผลลัพธ์
//
// ใช้กับปุ่ม "ปรับปรุง" (ocr:improve) — ทั้งข้อความต้นฉบับและบริบทที่ดึงจาก
// ฐานข้อมูลถูกสแกนด้วย pattern ที่ตั้งไว้ในหน้า "คำเฉพาะ" แล้วแทนด้วยตัวแปร
// รูปแบบ [[MONEY_1]] เพื่อไม่ให้ข้อมูลอ่อนไหว/ความลับออกไปนอกเครื่อง
//
// เมื่อ AI ตอบกลับ ตัวแปรถูกแทนคืนด้วยค่าเดิม (restore) ก่อนแสดงผล
//
// รายการแต่ละอันมี 2 ชนิด (kind):
//   text  = คำธรรมดา (เทียบทั้งคำตามที่พิมพ์ ไม่สนตัวพิมพ์เล็ก/ใหญ่)
//   regex = pattern ที่เขียนเอง ใส่ flag ได้ทั้งแบบ /.../i หรือพิมพ์เฉพาะ pattern
'use strict';

// เพดานกันข้อมูลชุดใหญ่ผิดปกติ (สแกนทั้งข้อความต่อ 1 คำขอ)
const MAX_TERMS = 500;

const MAX_PATTERN_LENGTH = 500;

// จำนวนจุดสูงสุดที่สแกนต่อ 1 pattern — กันข้อความยาวผิดปกติ
const MAX_MATCHES_PER_TERM = 2000;

const MAX_NAME_LENGTH = 24;

// ชื่อตัวแปรเมื่อผู้ใช้ไม่ได้ตั้ง (หรือตั้งเป็นอักษรที่ใช้ในตัวแปรไม่ได้)
const FALLBACK_NAME = 'TERM';

// คำสั่งที่แนบไปกับ prompt เมื่อมีการปกปิดจริง — AI ต้องคัดลอกตัวแปรกลับมาให้ครบ
const MASK_INSTRUCTION = [
    'หมายเหตุสำคัญ — มีการปกปิดข้อมูลอ่อนไหวไว้:',
    '- ข้อความและข้อมูลอ้างอิงถูกแทนค่าด้วยตัวแปรในวงเล็บเหลี่ยมสองชั้น เช่น [[MONEY_1]] [[NAME_2]]',
    '- ห้ามแก้ แปล แยกคำ เพิ่ม หรือลบตัวแปรเหล่านี้ — คัดลอกมาให้ครบและเหมือนเดิมทุกตัวอักษร',
    '- ห้ามเดาว่าตัวแปรคือค่าอะไร ให้คงตัวแปรไว้ในตำแหน่งเดิมของมัน'
].join('\n');

// pattern เริ่มต้นที่แถมให้ (ยังปิดอยู่ — เปิดใช้เองในหน้า "คำเฉพาะ")
// เรียงตามลำดับความสำคัญ: จำนวนเงินต้องถูกจับก่อนตัวเลข เพื่อไม่ให้ทับกัน
const DEFAULT_TERMS = [
    {
        name: 'MONEY',
        kind: 'regex',
        pattern: '\\d[\\d,]*(?:\\.\\d{1,2})?\\s*(?:บาท|THB|฿)|(?:฿|THB)\\s*\\d[\\d,]*(?:\\.\\d{1,2})?',
        enabled: 0
    },
    {
        name: 'NUMBER',
        kind: 'regex',
        pattern: '\\d+(?:[.,]\\d+)*',
        enabled: 0
    },
    {
        name: 'NAME',
        kind: 'regex',
        pattern: '(?:นาย|นาง|นางสาว|ด\\.ช\\.|ด\\.ญ\\.|Mr\\.|Mrs\\.|Ms\\.)\\s*[ก-๙A-Za-z]+(?:\\s+[ก-๙A-Za-z]+)?',
        enabled: 0
    },
    {
        name: 'NAME',
        kind: 'regex',
        pattern: '(?<=(?:ชื่อ|ผู้ยื่น|ผู้รับ|ลูกค้า|คู่สัญญา)\\s*[:：]?\\s*)[ก-๙]+(?:\\s+[ก-๙]+){1,2}',
        enabled: 0
    }
];

function escapeRegExp(value) {
    return String(value == null ? '' : value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ชื่อตัวแปรที่ปลอดภัยสำหรับใส่ใน placeholder — เก็บเฉพาะ A-Z 0-9 _
function sanitizeName(value) {
    const name = String(value == null ? '' : value)
        .toUpperCase()
        .replace(/[^A-Z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, MAX_NAME_LENGTH)
        .replace(/^_+|_+$/g, '');

    return name || FALLBACK_NAME;
}

// แถวจากฐานข้อมูลเก็บ enabled เป็น 0/1 ส่วนเทสต์/หน้าจออาจส่ง true/false
function isEnabled(term) {
    return Boolean(term) && (term.enabled === true || Number(term.enabled) === 1);
}

// แปลง pattern เป็น RegExp
//
//   text  -> ปิดอักขระพิเศษทั้งหมด (เทียบตามตัวอักษร) ไม่สนตัวพิมพ์เล็ก/ใหญ่
//   regex -> ใช้ pattern ตรง ๆ ถ้าอยู่ในรูป /.../flags ก็แยก flag ออกมาใช้
function parseExpression(kind, pattern) {
    const source = String(pattern == null ? '' : pattern).trim();

    if (source === '') {
        return { ok: false, error: 'ไม่มีคำ/pattern' };
    }

    if (source.length > MAX_PATTERN_LENGTH) {
        return {
            ok: false,
            error: 'ยาวเกิน ' + MAX_PATTERN_LENGTH + ' ตัวอักษร'
        };
    }

    if (kind !== 'regex') {
        return { ok: true, regex: new RegExp(escapeRegExp(source), 'gi') };
    }

    // รูปแบบ /pattern/flags — เก็บ flag ที่ผู้ใช้ใส่ไว้ แต่บังคับ g เพื่อหาทุกจุด
    const wrapped = /^\/(.+)\/([gimsuy]*)$/.exec(source);

    const body = wrapped ? wrapped[1] : source;
    const flags = (wrapped ? wrapped[2] : '').replace(/g/g, '') + 'g';

    try {
        return { ok: true, regex: new RegExp(body, flags) };

    } catch (error) {
        return {
            ok: false,
            error: 'regex ไม่ถูกต้อง: ' + (error.message || String(error))
        };
    }
}

// ตรวจ pattern ก่อนบันทึก (หน้า "คำเฉพาะ" ใช้แสดง error ทันที)
function validatePattern(kind, pattern) {
    const parsed = parseExpression(kind, pattern);

    return parsed.ok
        ? { ok: true }
        : { ok: false, error: parsed.error };
}

// สร้างตัวปกปิด/คืนค่าจากรายการที่ตั้งไว้
//
// ใช้ตัวเดียวกันกับทั้งข้อความต้นฉบับและบริบทจากฐานข้อมูล เพื่อให้ค่าเดียวกัน
// ได้ placeholder เดียวกันเสมอ (AI เห็นเป็นตัวแปรเดียวกันทั้งชุด)
function createMasker(terms) {
    const compiled = [];
    const errors = [];
    const list = Array.isArray(terms) ? terms : [];

    list.slice(0, MAX_TERMS).forEach(function (term) {
        if (!isEnabled(term)) return;

        const name = sanitizeName(term.name);
        const parsed = parseExpression(term.kind, term.pattern);

        if (!parsed.ok) {
            errors.push({ name: name, error: parsed.error });
            return;
        }

        compiled.push({ name: name, regex: parsed.regex });
    });

    const byValue = new Map();    // name + ค่า -> placeholder
    const counts = {};            // name -> ลำดับถัดไป
    const map = [];               // [{ placeholder, value }]
    const matched = new Set();    // ชื่อตัวแปรที่เจอค่าจริงในข้อความชุดนี้
    let count = 0;                // จำนวนจุดที่ถูกแทน

    // ช่วงที่ถูกปกปิดใน "ข้อความนั้น" — กันรายการถัดไปทับค่าที่แทนไปแล้ว
    // (ต้องเป็นของแต่ละครั้งที่เรียก mask เพราะข้อความคนละก้อนมีตำแหน่งคนละชุด)
    function overlaps(ranges, start, end) {
        for (let index = 0; index < ranges.length; index++) {
            const range = ranges[index];

            if (start < range[1] && end > range[0]) {
                return true;
            }
        }

        return false;
    }

    function placeholderFor(name, value) {
        const key = name + '\u0000' + value;
        const existing = byValue.get(key);

        if (existing) return existing;

        counts[name] = (counts[name] || 0) + 1;

        const placeholder = '[[' + name + '_' + counts[name] + ']]';

        byValue.set(key, placeholder);
        map.push({ placeholder: placeholder, value: value });
        matched.add(name);

        return placeholder;
    }

    // แทนค่าที่พบด้วย placeholder (คืนข้อความใหม่ ไม่แก้ค่าที่รับมา)
    function mask(text) {
        const source = String(text == null ? '' : text);

        if (compiled.length === 0 || source === '') {
            return source;
        }

        const replacements = [];
        const ranges = [];

        compiled.forEach(function (term) {
            const regex = term.regex;
            let guard = 0;
            let match;

            regex.lastIndex = 0;

            while ((match = regex.exec(source)) !== null) {
                // regex ที่จับค่าว่างได้ (เช่น a*) จะวนไม่จบ
                if (match[0] === '') {
                    regex.lastIndex += 1;
                    continue;
                }

                if (++guard > MAX_MATCHES_PER_TERM) break;

                const start = match.index;
                const end = start + match[0].length;

                if (overlaps(ranges, start, end)) continue;

                const value = match[0];

                ranges.push([start, end]);
                replacements.push({
                    start: start,
                    end: end,
                    text: placeholderFor(term.name, value)
                });

                count += 1;
            }
        });

        if (replacements.length === 0) {
            return source;
        }

        // ต่อข้อความใหม่จากท้ายมาหน้า เพื่อให้ตำแหน่งเดิมยังถูกต้อง
        replacements.sort(function (a, b) {
            return b.start - a.start;
        });

        let result = source;

        replacements.forEach(function (item) {
            result =
                result.slice(0, item.start) +
                item.text +
                result.slice(item.end);
        });

        return result;
    }

    // แทน placeholder กลับเป็นค่าเดิม — ทนช่องว่างที่ AI อาจแทรกในวงเล็บ
    function restore(text) {
        let result = String(text == null ? '' : text);

        map.forEach(function (item) {
            const name = item.placeholder.slice(2, -2);
            const regex = new RegExp(
                '\\[\\[\\s*' + escapeRegExp(name) + '\\s*\\]\\]',
                'gi'
            );

            result = result.replace(regex, function () {
                return item.value;
            });
        });

        return result;
    }

    return {
        mask: mask,
        restore: restore,
        get map() {
            return map;
        },
        get count() {
            return count;
        },
        get used() {
            return map.length;
        },
        get errors() {
            return errors;
        },
        // ชื่อตัวแปรทั้งหมดที่ "เปิดใช้ + ใช้ได้" (มีซ้ำได้ถ้าตั้งหลายรายการใช้ชื่อเดียวกัน)
        get names() {
            return compiled.map(function (term) {
                return term.name;
            });
        },
        // ชื่อตัวแปรที่เจอค่าจริง — ที่เหลือคือรายการที่เปิดใช้แต่ไม่พบในข้อความชุดนี้
        get matched() {
            return Array.from(matched);
        }
    };
}

// รูปแบบตัวแปรที่เราสร้าง — เทียบกับข้อความที่ได้จาก AI เพื่อดูว่ามีตัวไหนค้างอยู่
const PLACEHOLDER_PATTERN = /\[\[[^\]\r\n]{1,60}\]\]/g;

// ตัวแปรที่ยังค้างในข้อความหลังแทนค่าคืน (AI อาจแก้/ตัด/เพิ่มตัวแปร)
// ถ้ามี = ค่านั้นกู้กลับมาไม่ได้ ต้องเตือนผู้ใช้ให้ตรวจข้อความนั้นเอง
function findPlaceholders(text) {
    const found = String(text == null ? '' : text).match(PLACEHOLDER_PATTERN);

    return found ? Array.from(new Set(found)) : [];
}


// สแกนหลายก้อนข้อความด้วยตัวปกปิด "ตัวเดียวกัน" แล้วสรุปผลเป็นชุดเดียว
//
// ใช้ทั้งตอนส่งจริง (ocr:improve) และตอนตรวจก่อนส่ง (privacy:inspect)
// ทั้งสองที่จึงได้ผลตรงกันเสมอ — ต่างกันแค่ว่าจะส่งออกหรือไม่ส่งออก
//
// chunks = [ข้อความ, (บริบทจากฐานข้อมูล)]
// คืน {
//   masked      : ข้อความแต่ละก้อนหลังปกปิด (ลำดับเดียวกับ chunks)
//   counts      : จำนวนจุดที่ปกปิดของแต่ละก้อน
//   count/placeholders/items/unmatched/errors/enabled/total
// }
function inspect(terms, chunks) {
    const list = Array.isArray(terms) ? terms : [];
    const masker = createMasker(list);
    const masked = [];
    const counts = [];

    (Array.isArray(chunks) ? chunks : []).forEach(function (chunk) {
        const before = masker.count;

        masked.push(masker.mask(chunk));
        counts.push(masker.count - before);
    });

    const names = Array.from(new Set(masker.names));

    return {
        masked: masked,
        counts: counts,
        count: masker.count,
        placeholders: masker.used,
        items: masker.map,
        names: names,
        // รายการที่เปิดใช้แต่ไม่เจอค่าจริงในข้อความชุดนี้
        unmatched: names.filter(function (name) {
            return masker.matched.indexOf(name) === -1;
        }),
        errors: masker.errors,
        // จำนวนรายการที่เปิดใช้/ทั้งหมด — 0 = ยังไม่มีการปกปิดเลย
        enabled: list.filter(isEnabled).length,
        total: list.length,
        // คืนค่าเดิมได้ด้วย (ตอนส่งจริงใช้แทนค่ากลับในคำตอบของ AI)
        restore: masker.restore
    };
}


module.exports = {
    MAX_TERMS,
    MAX_PATTERN_LENGTH,
    MAX_NAME_LENGTH,
    FALLBACK_NAME,
    MASK_INSTRUCTION,
    DEFAULT_TERMS,
    escapeRegExp,
    sanitizeName,
    isEnabled,
    validatePattern,
    createMasker,
    inspect,
    findPlaceholders
};
