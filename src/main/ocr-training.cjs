// คลังฝึก OCR — เก็บบรรทัดข้อความจากไฟล์ที่เคยอัปโหลด
// ให้ผู้ใช้พิมพ์ข้อความที่ถูกต้อง แล้วใช้คู่ "ผิด → ถูก" เป็นตัวอย่าง
// few-shot ให้ post-OCR (Vector Few-Shot) ครั้งต่อไป
//
// เก็บเป็น JSON ในโฟลเดอร์ data ของแอป (data/ocr-training.json)
// ทุกอย่างอยู่ในเครื่อง ไม่มีการส่งข้อความออกนอกเครื่อง
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_NAME = 'ocr-training.json';

const VERSION = 1;

// จำกัดจำนวนบรรทัดเพื่อไม่ให้ไฟล์โตเกินไป (vector few-shot ใช้แค่ไม่กี่คู่ต่อครั้ง)
const MAX_LINES = 5000;

// ความยาวสูงสุดต่อบรรทัด (กันข้อมูลแปลกปลอมเข้ามาในไฟล์)
const MAX_TEXT_LENGTH = 2000;

const STATUSES = ['new', 'trained', 'skipped'];

function filePath(dataPath) {
    return path.join(path.resolve(dataPath), FILE_NAME);
}

// ทำความสะอาดหนึ่งบรรทัด: ตัดอักขระควบคุม/ช่องว่างซ้ำ
function cleanLine(value) {
    return String(value == null ? '' : value)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT_LENGTH);
}

// ใช้เทียบบรรทัดซ้ำ — ไม่สนช่องว่างและตัวพิมพ์เล็ก/ใหญ่
function dedupeKey(text) {
    return String(text == null ? '' : text)
        .replace(/\s+/g, '')
        .toLowerCase();
}

function emptyStore() {
    return {
        version: VERSION,
        lines: []
    };
}

function normalizeLine(item) {
    const status = STATUSES.indexOf(item && item.status) === -1
        ? 'new'
        : item.status;

    const input = cleanLine(item && item.input);
    const output = status === 'trained' ? cleanLine(item && item.output) : '';

    return {
        id: String((item && item.id) || ''),
        source: cleanLine(item && item.source).slice(0, 260),
        input: input,
        output: output,
        status: status,
        createdAt: String((item && item.createdAt) || ''),
        updatedAt: String((item && item.updatedAt) || '')
    };
}

function normalizeStore(raw) {
    const store = emptyStore();

    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines)) {
        return store;
    }

    const seen = new Set();

    store.lines = raw.lines
        .map(normalizeLine)
        .filter(function (item) {
            if (item.id === '' || item.input === '') return false;

            const key = dedupeKey(item.input);

            if (key === '' || seen.has(key)) return false;

            seen.add(key);

            return true;
        })
        .slice(0, MAX_LINES);

    return store;
}

function load(dataPath) {
    try {
        const parsed = JSON.parse(
            fs.readFileSync(filePath(dataPath), 'utf8')
        );

        return normalizeStore(parsed);

    } catch (error) {
        return emptyStore();
    }
}

// เขียนแบบ atomic: เขียนไฟล์ชั่วคราวแล้ว rename ทับ
function save(dataPath, store) {
    const target = filePath(dataPath);
    const temp = target + '.tmp';

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(temp, target);
}

// เพิ่มบรรทัดจากไฟล์ที่อัปโหลด — ข้ามบรรทัดซ้ำและบรรทัดสั้นเกินไป
function addLines(dataPath, source, lines) {
    const store = load(dataPath);
    const seen = new Set(store.lines.map(function (item) {
        return dedupeKey(item.input);
    }));

    const now = new Date().toISOString();
    const list = Array.isArray(lines) ? lines : [];

    let added = 0;
    let duplicates = 0;
    let skipped = 0;

    for (let index = 0; index < list.length; index++) {
        if (store.lines.length >= MAX_LINES) {
            skipped += list.length - index;
            break;
        }

        const input = cleanLine(list[index]);

        if (input.length < 3) {
            skipped += 1;
            continue;
        }

        const key = dedupeKey(input);

        if (key === '' || seen.has(key)) {
            duplicates += 1;
            continue;
        }

        seen.add(key);

        store.lines.push({
            id: crypto.randomUUID(),
            source: cleanLine(source).slice(0, 260),
            input: input,
            output: '',
            status: 'new',
            createdAt: now,
            updatedAt: now
        });

        added += 1;
    }

    if (added > 0) {
        save(dataPath, store);
    }

    return {
        added: added,
        duplicates: duplicates,
        skipped: skipped,
        total: store.lines.length
    };
}

function findLine(store, id) {
    const target = String(id == null ? '' : id);

    const index = store.lines.findIndex(function (item) {
        return item.id === target;
    });

    return {
        index: index,
        line: index === -1 ? null : store.lines[index]
    };
}

// บันทึกข้อความที่ถูกต้องของผู้ใช้
function saveCorrection(dataPath, id, output) {
    const store = load(dataPath);
    const found = findLine(store, id);

    if (!found.line) {
        throw new Error('ไม่พบบรรทัดนี้ — อาจถูกลบไปแล้ว');
    }

    const text = cleanLine(output);

    if (text === '') {
        throw new Error('กรุณาพิมพ์ข้อความที่ถูกต้องก่อนบันทึก');
    }

    if (dedupeKey(text) === dedupeKey(found.line.input)) {
        throw new Error(
            'ข้อความที่แก้เหมือนต้นฉบับ — แก้จุดที่ OCR อ่านผิดก่อนบันทึก'
        );
    }

    found.line.output = text;
    found.line.status = 'trained';
    found.line.updatedAt = new Date().toISOString();

    save(dataPath, store);

    return found.line;
}

function setStatus(dataPath, id, status) {
    if (STATUSES.indexOf(status) === -1) {
        throw new Error('สถานะไม่ถูกต้อง');
    }

    const store = load(dataPath);
    const found = findLine(store, id);

    if (!found.line) {
        throw new Error('ไม่พบบรรทัดนี้ — อาจถูกลบไปแล้ว');
    }

    found.line.status = status;
    found.line.updatedAt = new Date().toISOString();

    if (status !== 'trained') {
        found.line.output = '';
    }

    save(dataPath, store);

    return found.line;
}

function remove(dataPath, id) {
    const store = load(dataPath);
    const found = findLine(store, id);

    if (!found.line) {
        throw new Error('ไม่พบบรรทัดนี้ — อาจถูกลบไปแล้ว');
    }

    store.lines.splice(found.index, 1);
    save(dataPath, store);

    return { total: store.lines.length };
}

function stats(store) {
    const counts = {
        total: store.lines.length,
        new: 0,
        trained: 0,
        skipped: 0
    };

    store.lines.forEach(function (item) {
        counts[item.status] = (counts[item.status] || 0) + 1;
    });

    return counts;
}

// ตัวอย่าง few-shot จากคู่ที่ฝึกแล้ว
function examples(dataPath) {
    return load(dataPath).lines
        .filter(function (item) {
            return (
                item.status === 'trained' &&
                item.input !== '' &&
                item.output !== ''
            );
        })
        .map(function (item) {
            return {
                input: item.input,
                output: item.output
            };
        });
}

// รายการสำหรับหน้าจอ — กรองตามสถานะ/คำค้น และจำกัดจำนวนที่แสดง
function list(dataPath, options) {
    const opts = options || {};
    const status = STATUSES.indexOf(opts.status) === -1 ? 'all' : opts.status;
    const search = String(opts.search == null ? '' : opts.search)
        .trim()
        .toLowerCase();

    const limit = Number(opts.limit) > 0
        ? Math.min(Number(opts.limit), 500)
        : 200;

    const store = load(dataPath);

    const filtered = store.lines
        .filter(function (item) {
            if (status !== 'all' && item.status !== status) return false;
            if (search === '') return true;

            return (
                item.input.toLowerCase().includes(search) ||
                item.output.toLowerCase().includes(search) ||
                item.source.toLowerCase().includes(search)
            );
        })
        .sort(function (a, b) {
            return String(b.createdAt).localeCompare(String(a.createdAt));
        });

    return {
        lines: filtered.slice(0, limit),
        shown: Math.min(filtered.length, limit),
        matched: filtered.length,
        stats: stats(store),
        limit: limit
    };
}

module.exports = {
    FILE_NAME,
    MAX_LINES,
    STATUSES,
    filePath,
    cleanLine,
    dedupeKey,
    load,
    save,
    addLines,
    saveCorrection,
    setStatus,
    remove,
    stats,
    examples,
    list
};
