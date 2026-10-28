// ปรับปรุงข้อความด้วย AI (Gemini) — ตรวจคำผิด + จัดเป็น Key-Value Pair
//
// ใช้กับปุ่ม "ปรับปรุง" ในกล่องใส่ข้อมูล (หน้ารายงาน / หน้าตั้งค่าแม่แบบ)
// โดยใช้ API key + ชื่อโมเดลที่บันทึกไว้ในหน้า ตั้งค่า OCR (ส่วน Gemini)
//
// ข้อความยาวถูกแบ่งเป็นก้อนตามบรรทัด (ไม่ตัดกลางบรรทัด) แล้วส่งทีละก้อน
// เพื่อไม่ให้ผลลัพธ์ถูกตัดเพราะ maxOutputTokens
'use strict';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

const DEFAULT_MODEL = 'gemini-2.5-flash';

const REQUEST_TIMEOUT_MS = 120 * 1000;

const MAX_OUTPUT_TOKENS = 8192;

// จำนวนตัวอักษรต่อก้อนที่ส่งให้ AI (ภาษาไทย ~1 ตัวอักษรต่อ 1 token โดยประมาณ)
const CHUNK_CHARS = 6000;

// prompt เริ่มต้น — แสดง/แก้ได้ในหน้า ตั้งค่า OCR (ถ้าเว้นว่าง = ใช้ชุดนี้)
const DEFAULT_PROMPT = [
    'คุณเป็นบรรณาธิการข้อความภาษาไทยที่ได้จาก OCR',
    '',
    'ทำ 2 อย่างเท่านั้น:',
    '1. แก้คำที่ OCR อ่านผิด (สะกดคำ วรรคตอน และช่องว่าง) โดยดูจากบริบท',
    '2. จัดข้อความใหม่เป็น key-value pair — หนึ่งฟิลด์ต่อหนึ่งบรรทัด ในรูปแบบ "ชื่อฟิลด์: ค่า"',
    '',
    'กฎ:',
    '- รักษาข้อมูลเดิมทุกอย่าง ห้ามเพิ่ม ห้ามสรุป ห้ามตัดทิ้ง',
    '- ตัวเลข วันที่ เลขที่ รหัส จำนวนเงิน อีเมล และชื่อเฉพาะ คัดลอกตามเดิมทุกตัวอักษร',
    '- ชื่อฟิลด์เป็นภาษาไทยสั้น ๆ ตามความหมาย เช่น เลขที่, วันที่, ชื่อผู้ยื่น, หน่วยงาน, จำนวนเงิน',
    '- ถ้าฟิลด์เดียวมีหลายค่า ให้ใส่ชื่อฟิลด์ครั้งเดียว แล้วขึ้นบรรทัดถัดไปด้วย "- ค่า" บรรทัดละค่า',
    '- ค่ายาวให้อยู่บรรทัดเดียว ห้ามตัดขึ้นบรรทัดใหม่กลางค่า',
    '- คงลำดับข้อมูลตามต้นฉบับ',
    '- ถ้าค่าใดอ่านไม่ออก ให้ข้ามฟิลด์นั้น ไม่ต้องเดา',
    '- ไม่ต้องเว้นบรรทัดว่าง ไม่ต้องใส่ markdown หรือ code fence และไม่ต้องอธิบายเพิ่ม',
    '- ถ้าข้อความไม่มีอะไรให้แก้ ก็ตอบกลับเป็น key-value ตามเดิม'
].join('\n');

function sanitizeModel(value) {
    const model = String(value || '').trim();

    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(model)
        ? model
        : DEFAULT_MODEL;
}

function friendlyError(status, message) {
    const detail = String(message || '').slice(0, 300);

    if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(detail)) {
        return 'API key ของ Gemini ไม่ถูกต้อง — ตรวจ key ในหน้า ตั้งค่า OCR';
    }

    if (status === 400) {
        return 'Gemini ปฏิเสธคำขอ (อาจชื่อโมเดลไม่ถูกต้อง): ' + detail;
    }

    if (status === 401 || status === 403) {
        return 'API key ของ Gemini ไม่ถูกต้อง หรือไม่มีสิทธิ์ใช้งานโมเดลนี้';
    }

    if (status === 404) {
        return 'ไม่พบโมเดล Gemini ที่ระบุ — ตรวจชื่อโมเดลในหน้าตั้งค่า OCR';
    }

    if (status === 429) {
        return 'โควตาหรือ rate limit ของ Gemini เต็ม — รอสักครู่แล้วลองใหม่';
    }

    if (status >= 500) {
        return 'เซิร์ฟเวอร์ Gemini ขัดข้องชั่วคราว — ลองใหม่อีกครั้ง';
    }

    return detail || ('Gemini ตอบกลับสถานะ ' + status);
}

// ชื่อชนิดของฟิลด์ที่ส่งไปให้ AI อ่าน (ค่าที่เก็บในฐานข้อมูลเป็นภาษาอังกฤษ)
const FIELD_TYPE_LABELS = {
    text: 'ข้อความ',
    number: 'ตัวเลข',
    currency: 'จำนวนเงิน',
    date: 'วันที่',
    checkbox: 'ติ๊ก/ไม่ติ๊ก',
    textarea: 'ข้อความยาว',
    email: 'อีเมล',
    list: 'รายการ',
    table: 'ตาราง'
};

function fieldTypeLabel(type) {
    const key = String(type == null ? '' : type).trim().toLowerCase();

    return FIELD_TYPE_LABELS[key] || key;
}

// ฟิลด์ที่ส่งมาให้ AI ใช้เป็น key — รับได้ทั้งชื่อ (สตริง) และ
// { name, type, placeholder } — ตัดช่องว่างซ้ำ/ชื่อว่าง/ชื่อซ้ำออก
function normalizeFieldNames(value) {
    const seen = new Set();
    const fields = [];

    (Array.isArray(value) ? value : []).forEach(function (item) {
        const raw = item && typeof item === 'object' ? item : { name: item };

        const name = String(raw.name == null ? '' : raw.name)
            .replace(/\s+/g, ' ')
            .trim();

        if (name === '' || seen.has(name)) return;

        seen.add(name);

        const placeholder = String(raw.placeholder == null ? '' : raw.placeholder)
            .replace(/\s+/g, ' ')
            .trim();

        fields.push({
            name: name,
            type: fieldTypeLabel(raw.type),
            placeholder: placeholder
        });
    });

    return fields;
}

// หนึ่งฟิลด์ต่อหนึ่งบรรทัด: "- ชื่อฟิลด์ · ชนิด: … · ตัวอย่าง: …"
function fieldLine(field) {
    const parts = [field.name];

    if (field.type) parts.push('ชนิด: ' + field.type);
    if (field.placeholder) parts.push('ตัวอย่าง: ' + field.placeholder);

    return '- ' + parts.join(' · ');
}

// คำสั่งเต็มที่ส่งให้โมเดล (แยกไว้เพื่อทดสอบได้โดยไม่ต้องเรียกเน็ต)
// prompt ที่ผู้ใช้แก้ในหน้าตั้งค่าจะแทนที่ชุดเริ่มต้น ส่วนข้อความต้นฉบับ
// ถูกต่อท้ายด้วยรูปแบบเดิมเสมอ เพื่อไม่ให้ตำแหน่งข้อความหายไป
// fieldNames = ฟิลด์ของแม่แบบ [{ name, type, placeholder }] หรือชื่อฟิลด์ (ว่าง = ไม่แนบ)
function buildPrompt(text, prompt, contextRawText, maskInstruction, fieldNames) {
    const instructions =
        String(prompt == null ? '' : prompt).trim() || DEFAULT_PROMPT;

    const parts = [
        instructions
    ];

    // ปกปิดคำเฉพาะอยู่ = บอก AI ว่าตัวแปรในวงเล็บต้องคัดลอกกลับมาให้ครบ
    const mask = String(maskInstruction == null ? '' : maskInstruction).trim();

    if (mask !== '') {
        parts.push('', mask);
    }

    // ชื่อฟิลด์ของแม่แบบ — ให้ AI ใช้เป็น key ให้ตรงกับฟิลด์จริง
    const fields = normalizeFieldNames(fieldNames);

    if (fields.length > 0) {
        parts.push(
            '',
            'ชื่อฟิลด์ของแม่แบบ (ใช้ชื่อต่อไปนี้เป็น key ในผลลัพธ์ — เขียนให้ตรงตามที่กำหนด):',
            '<<<',
            fields.map(fieldLine).join('\n'),
            '>>>',
            'ชนิดและตัวอย่างข้อมูลของแต่ละฟิลด์เป็นเพียงแนวทาง — ห้ามนำค่าตัวอย่างไปใส่แทนข้อมูลจริง',
            'ถ้าข้อมูลในข้อความตรงกับฟิลด์ใด ให้ใช้ชื่อฟิลด์นั้นเป็น key',
            'ถ้าไม่ตรงกับฟิลด์ใดเลย ให้ตั้งชื่อฟิลด์ใหม่ตามความหมายเหมือนเดิม'
        );
    }

    parts.push(
        '',
        'ข้อความต้นฉบับ:',
        '<<<',
        String(text == null ? '' : text),
        '>>>'
    );

    if (contextRawText && contextRawText.trim()) {
        parts.push('', 'ข้อมูลอ้างอิงจากฐานข้อมูล (ข้อมูลหลัก + คลังคำ):', '<<<', contextRawText, '>>>');
    }
    console.log(parts);
    return parts.join('\n');
}

// ตัด code fence, บรรทัดว่าง และช่องว่างเกิน ที่โมเดลอาจใส่มา
function cleanResult(text) {
    const body = String(text == null ? '' : text)
        .replace(/^\s*```[A-Za-z0-9_-]*\s*\n?/, '')
        .replace(/\n?```\s*$/, '');

    return body
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map(function (line) {
            return line.replace(/[ \t]+/g, ' ').trim();
        })
        .filter(function (line) {
            return line !== '';
        })
        .join('\n');
}

// แบ่งข้อความเป็นก้อนตามบรรทัด — ไม่ตัดกลางบรรทัด เว้นแต่บรรทัดเดียวยาวเกินกำหนด
function splitChunks(text, limit) {
    const max = Number(limit) > 0 ? Number(limit) : CHUNK_CHARS;

    const chunks = [];
    let current = [];
    let size = 0;

    function flush() {
        if (current.length === 0) return;

        chunks.push(current.join('\n'));
        current = [];
        size = 0;
    }

    String(text == null ? '' : text)
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .forEach(function (line) {
            let rest = line;

            while (rest.length > max) {
                flush();

                chunks.push(rest.slice(0, max));
                rest = rest.slice(max);
            }

            if (current.length > 0 && size + rest.length + 1 > max) {
                flush();
            }

            current.push(rest);
            size += rest.length + 1;
        });

    flush();

    return chunks;
}

// token ที่ Gemini รายงานกลับมา — ใช้แสดง/สะสมในหน้า ตั้งค่า OCR
function readUsage(data) {
    const usage =
        data && data.usageMetadata && typeof data.usageMetadata === 'object'
            ? data.usageMetadata
            : {};

    return {
        input: Math.max(0, Math.floor(Number(usage.promptTokenCount) || 0)),
        output: Math.max(0, Math.floor(Number(usage.candidatesTokenCount) || 0))
    };
}

// รายการ key ตามลำดับที่ใช้ — รองรับทั้ง apiKeys (หลาย key) และ apiKey เดียว
function normalizeApiKeys(options) {
    const opts = options || {};
    const keys = [];
    const seen = new Set();

    function add(value, id) {
        const apiKey = String(value == null ? '' : value).trim();

        if (apiKey === '' || seen.has(apiKey)) return;

        seen.add(apiKey);

        keys.push({
            id: String(id == null ? '' : id),
            apiKey: apiKey
        });
    }

    if (Array.isArray(opts.apiKeys)) {
        opts.apiKeys.forEach(function (item) {
            if (item && typeof item === 'object') {
                add(item.apiKey, item.id);
            } else {
                add(item, '');
            }
        });
    }

    if (keys.length === 0) add(opts.apiKey, '');

    return keys;
}

async function requestChunk(text, apiKey, model, prompt, contextRawText, maskInstruction, fieldNames) {
    const body = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: buildPrompt(text, prompt, contextRawText, maskInstruction, fieldNames) }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.1,
            maxOutputTokens: MAX_OUTPUT_TOKENS
        }
    };

    const controller = new AbortController();
    const timer = setTimeout(function () {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    let response;

    try {
        response = await fetch(
            API_BASE + encodeURIComponent(model) + ':generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify(body),
                signal: controller.signal
            }
        );

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('Gemini ใช้เวลานานเกินไป (timeout) — ลองใหม่อีกครั้ง');
        }

        throw new Error(
            'เชื่อมต่อ Gemini ไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต'
        );

    } finally {
        clearTimeout(timer);
    }

    let data = null;

    try {
        data = await response.json();

    } catch (error) {
        data = null;
    }

    if (!response.ok) {
        const message =
            (data && data.error && data.error.message) ||
            (data && data.message) ||
            '';

        throw new Error(friendlyError(response.status, message));
    }

    const candidate =
        data &&
        Array.isArray(data.candidates) &&
        data.candidates[0];

    const parts =
        candidate &&
        candidate.content &&
        Array.isArray(candidate.content.parts)
            ? candidate.content.parts
            : [];

    const text_out = cleanResult(
        parts
            .map(function (part) {
                return part && typeof part.text === 'string' ? part.text : '';
            })
            .filter(Boolean)
            .join('\n')
    );

    if (text_out === '') {
        if (candidate && candidate.finishReason === 'SAFETY') {
            throw new Error('Gemini ไม่ยอมประมวลผลข้อความนี้ (ถูกระบบความปลอดภัยบล็อก)');
        }

        throw new Error('Gemini ไม่ได้ส่งข้อความกลับมา — ลองใหม่อีกครั้ง');
    }

    return {
        text: text_out,
        usage: readUsage(data)
    };
}

// opts.maskInstruction = คำสั่งเรื่องตัวแปรที่ใช้แทนคำเฉพาะ (ว่าง = ไม่แนบ)
// opts.fieldNames = ฟิลด์ของแม่แบบที่ใช้เป็น key พร้อมชนิด/ตัวอย่าง (ว่าง = ไม่แนบ)
// opts.apiKeys = [{ id, apiKey }] — ใช้เรียงตามลำดับ ถ้า key หนึ่งขัดข้องจึงลอง key ถัดไป
// opts.onUsage(keyId, { input, output }) = แจ้ง token ของแต่ละ key (ถ้าส่งมา)
// คืน { text, model, chunks, usageByKey } — ถ้าก้อนใดล้มเหลว จะโยน error ทั้งหมด
// (ไม่คืนข้อความบางส่วน เพื่อไม่ให้ข้อมูลหายเงียบ ๆ)
async function improveText(text, options) {
    const opts = options || {};
    const source = String(text == null ? '' : text);
    const contextRawText = String(opts.contextRawText || '').trim();
    const keys = normalizeApiKeys(opts);

    if (source.trim() === '') {
        throw new Error('ไม่มีข้อความให้ปรับปรุง');
    }

    if (keys.length === 0) {
        throw new Error('ยังไม่ได้ใส่ API key ของ Gemini — ไปที่ ตั้งค่า OCR ก่อน');
    }

    const model = sanitizeModel(opts.model);

    const chunks = splitChunks(source, opts.chunkChars);
    const results = [];
    const usageByKey = [];

    // key ที่ล้มเหลวในรอบนี้ = ไม่ลองซ้ำ แต่ใช้ key ถัดไปแทน
    const failedKeys = new Set();

    let lastError = null;

    for (let index = 0; index < chunks.length; index++) {
        if (typeof opts.onProgress === 'function') {
            opts.onProgress({
                stage: 'chunk',
                index: index + 1,
                total: chunks.length
            });
        }

        let done = false;

        for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
            const key = keys[keyIndex];

            if (failedKeys.has(key.apiKey)) continue;

            try {
                const result = await requestChunk(
                    chunks[index],
                    key.apiKey,
                    model,
                    opts.prompt,
                    opts.contextRawText,
                    opts.maskInstruction,
                    opts.fieldNames
                );

                results.push(result.text);

                // สะสม token ของ key นี้ (หลายก้อนอาจใช้ key เดียวกัน)
                const id = key.id || ('key-' + (keyIndex + 1));

                let entry = null;

                for (const item of usageByKey) {
                    if (item.id === id) {
                        entry = item;
                        break;
                    }
                }

                if (!entry) {
                    entry = { id: id, input: 0, output: 0 };
                    usageByKey.push(entry);
                }

                entry.input += result.usage.input;
                entry.output += result.usage.output;

                if (typeof opts.onUsage === 'function') {
                    try {
                        opts.onUsage(id, result.usage);
                    } catch (error) {
                        // นับ token ไม่สำเร็จไม่ควรทำให้การปรับปรุงล้มเหลว
                    }
                }

                done = true;
                break;

            } catch (error) {
                lastError = error;
                failedKeys.add(key.apiKey);

                console.warn(
                    '[ปรับปรุง] API key ลำดับที่ ' + (keyIndex + 1) +
                    ' ใช้ไม่ได้ — ลอง key ถัดไป: ' +
                    ((error && error.message) || String(error))
                );
            }
        }

        if (!done) {
            throw lastError || new Error('Gemini ไม่ได้ส่งข้อความกลับมา — ลองใหม่อีกครั้ง');
        }
    }

    return {
        text: results.join('\n'),
        model: model,
        chunks: chunks.length,
        usageByKey: usageByKey
    };
}

module.exports = {
    DEFAULT_MODEL,
    DEFAULT_PROMPT,
    CHUNK_CHARS,
    improveText,
    buildPrompt,
    cleanResult,
    splitChunks,
    sanitizeModel
};
