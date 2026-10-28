// OCR ด้วย Gemini API (Google AI Studio)
//
// ทำงานฝั่ง main process: วาดหน้า PDF เป็นภาพแล้วส่งให้ Gemini อ่าน
// — ต้องมี API key ที่ผู้ใช้กรอกในหน้า "ตั้งค่า OCR"
//
// ข้อดี: อ่านภาษาไทย/ตาราง/เอกสารเอียงได้ดีโดยไม่ต้องโหลดโมเดลในเครื่อง
// ข้อเสีย: ต้องต่ออินเทอร์เน็ตทุกครั้ง และใช้โควตาตามบัญชีของผู้ใช้
'use strict';

const { renderPageToPng } = require('./ocr-paddle.cjs');

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

const DEFAULT_MODEL = 'gemini-2.5-flash';

const REQUEST_TIMEOUT_MS = 120 * 1000;

const MAX_OUTPUT_TOKENS = 8192;

const PROMPT = [
    'อ่านข้อความทั้งหมดจากภาพเอกสารนี้',
    '',
    'กฎ:',
    '1. ตอบเฉพาะข้อความที่เห็นในภาพ ห้ามสรุป ห้ามอธิบาย ห้ามใส่ markdown',
    '2. รักษาการขึ้นบรรทัดตามต้นฉบับ (1 บรรทัดในภาพ = 1 บรรทัดในคำตอบ)',
    '3. ตัวเลข วันที่ เลขบัญชี และชื่อเฉพาะ ให้คัดลอกตามที่เห็นให้แม่นที่สุด',
    '4. ถ้าภาพส่วนใดอ่านไม่ออก ให้ข้ามส่วนนั้น ไม่ต้องเดา',
    '5. ถ้าภาพไม่มีข้อความเลย ให้ตอบเป็นสตริงว่าง'
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

// ตัด code fence ที่โมเดลอาจใส่มา แม้ prompt จะสั่งห้าม
function cleanText(text) {
    return String(text == null ? '' : text)
        .replace(/^\s*```[A-Za-z0-9_-]*\s*\n?/, '')
        .replace(/\n?```\s*$/, '')
        .replace(/\r\n?/g, '\n')
        .trim();
}

function textToLines(text) {
    return cleanText(text)
        .split('\n')
        .map(function (line) {
            return line.replace(/[ \t]+/g, ' ').trim();
        })
        .filter(function (line) {
            return line !== '';
        })
        .map(function (line) {
            // ไม่มีพิกัดบรรทัดจาก API — joinWrappedLines จะไม่เย็บข้ามบรรทัดให้
            return { text: line };
        });
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

// ส่งภาพหนึ่งหน้าให้ Gemini ด้วย key หนึ่ง — คืนข้อมูล JSON ที่ได้
async function requestPage(png, apiKey, model) {
    const body = {
        contents: [
            {
                role: 'user',
                parts: [
                    { text: PROMPT },
                    {
                        inline_data: {
                            mime_type: 'image/png',
                            data: png.toString('base64')
                        }
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0,
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
        clearTimeout(timer);

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

    return data;
}

async function ocrPage(page, options) {
    const opts = options || {};
    const keys = normalizeApiKeys(opts);

    if (keys.length === 0) {
        throw new Error('ยังไม่ได้ใส่ API key ของ Gemini — ไปที่ ตั้งค่า OCR ก่อน');
    }

    const model = sanitizeModel(opts.model);

    // วาดหน้าครั้งเดียว — ใช้ภาพเดิมกับทุก key
    const png = await renderPageToPng(page);

    let lastError = null;

    // ใช้ key ตามลำดับ — key ใดขัดข้องจึงลอง key ถัดไป
    for (let index = 0; index < keys.length; index++) {
        const key = keys[index];

        try {
            const data = await requestPage(png, key.apiKey, model);

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

            const text = cleanText(
                parts
                    .map(function (part) {
                        return part && typeof part.text === 'string' ? part.text : '';
                    })
                    .filter(Boolean)
                    .join('\n')
            );

            // ถูกบล็อกด้วย safety หรือจบเพราะ MAX_TOKENS โดยไม่มีข้อความ
            if (text === '' && candidate && candidate.finishReason === 'SAFETY') {
                throw new Error('Gemini ไม่ยอมอ่านหน้านี้ (ถูกระบบความปลอดภัยบล็อก)');
            }

            return {
                text: text,
                lines: textToLines(text),
                confidence: 0,
                // ข้อมูลสำหรับบันทึก token ในหน้า ตั้งค่า OCR
                keyId: key.id,
                usage: readUsage(data)
            };

        } catch (error) {
            lastError = error;

            console.warn(
                '[Gemini OCR] API key ลำดับที่ ' + (index + 1) +
                ' ใช้ไม่ได้ — ลอง key ถัดไป: ' +
                ((error && error.message) || String(error))
            );
        }
    }

    throw lastError || new Error('Gemini อ่านหน้านี้ไม่สำเร็จ — ลองใหม่อีกครั้ง');
}

module.exports = {
    DEFAULT_MODEL,
    ocrPage,
    // ใช้ทดสอบการแปลงข้อความโดยไม่ต้องเรียกเน็ต
    textToLines
};
