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

const INSTRUCTIONS = [
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

// คำสั่งเต็มที่ส่งให้โมเดล (แยกไว้เพื่อทดสอบได้โดยไม่ต้องเรียกเน็ต)
function buildPrompt(text) {
    return [
        INSTRUCTIONS,
        '',
        'ข้อความต้นฉบับ:',
        '<<<',
        String(text == null ? '' : text),
        '>>>'
    ].join('\n');
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

async function requestChunk(text, apiKey, model) {
    const body = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: buildPrompt(text) }
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

    return text_out;
}

// คืน { text, model, chunks } — ถ้าก้อนใดล้มเหลว จะโยน error ทั้งหมด
// (ไม่คืนข้อความบางส่วน เพื่อไม่ให้ข้อมูลหายเงียบ ๆ)
async function improveText(text, options) {
    const opts = options || {};
    const apiKey = String(opts.apiKey || '').trim();
    const source = String(text == null ? '' : text);

    if (source.trim() === '') {
        throw new Error('ไม่มีข้อความให้ปรับปรุง');
    }

    if (apiKey === '') {
        throw new Error('ยังไม่ได้ใส่ API key ของ Gemini — ไปที่ ตั้งค่า OCR ก่อน');
    }

    const model = sanitizeModel(opts.model);

    const chunks = splitChunks(source, opts.chunkChars);
    const results = [];

    for (let index = 0; index < chunks.length; index++) {
        if (typeof opts.onProgress === 'function') {
            opts.onProgress({
                stage: 'chunk',
                index: index + 1,
                total: chunks.length
            });
        }

        results.push(await requestChunk(chunks[index], apiKey, model));
    }

    return {
        text: results.join('\n'),
        model: model,
        chunks: chunks.length
    };
}

module.exports = {
    DEFAULT_MODEL,
    CHUNK_CHARS,
    improveText,
    buildPrompt,
    cleanResult,
    splitChunks,
    sanitizeModel
};
