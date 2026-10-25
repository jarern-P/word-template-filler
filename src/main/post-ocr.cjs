// Post-OCR text improvement (แก้คำผิด + แบ่งประโยค)
//
// ตัวเลือกเอนจิน (ตั้งค่าที่หน้า ตั้งค่า OCR):
//   - library = ใช้พจนานุกรม/layout ในเครื่อง (จัดการฝั่งหน้าจอ)
//   - local   = Qwen2.5-3B-Instruct ผ่าน llama.cpp ในเครื่อง
//   - api     = Gemini API (ใช้ key เดิมของ OCR)
//
// หลักการ:
//   - แบ่งข้อความเป็นก้อน (chunk) ตามบรรทัด เพื่อไม่ให้ prompt ยาวเกิน context
//   - เลือกตัวอย่าง few-shot ที่ใกล้เคียงที่สุดด้วย vector (char n-gram)
//     หรือ embedding ของโมเดล local ถ้าใช้ได้ แล้วใส่ใน prompt
//   - ให้โมเดลตอบเฉพาะข้อความที่แก้แล้ว แบ่งประโยคละบรรทัด
//   - ตรวจคำตอบ (sanitize) ก่อนใช้ — ถ้าผิดรูปเกินไปจะเก็บข้อความเดิมของก้อนนั้น
'use strict';

const fs = require('fs');
const path = require('path');

const EXAMPLES_FILE = path.join(__dirname, 'post-ocr-examples.json');

// ขนาดก้อนข้อความต่อครั้ง — พอดีกับ context 8k ของ Qwen และลดโอกาสตอบขาด
const CHUNK_CHARS = 1200;

// จำนวนตัวอย่าง few-shot ที่ใส่ใน prompt
const FEW_SHOT_COUNT = 3;

// vector ของ char n-gram (ใช้เมื่อไม่มี embedding จากโมเดล)
const VECTOR_DIM = 256;

const GEMINI_API_BASE =
    'https://generativelanguage.googleapis.com/v1beta/models/';

const GEMINI_TIMEOUT_MS = 180 * 1000;

const SYSTEM_PROMPT = [
    'คุณเป็นตัวแก้ไขข้อความจาก OCR ภาษาไทย',
    '',
    'งาน:',
    '1. แก้คำที่ OCR อ่านผิดให้เป็นคำไทยที่ถูกต้อง (สระ/วรรณยุกต์ที่แยกจากพยัญชนะ ตัวอักษรใกล้เคียง คำที่ติดกัน) เช่น เงนิ → เงิน, วนั ที่ → วันที่',
    '2. ต้องเก็บเนื้อความของทุกบรรทัดไว้ครบ ห้ามตัดบรรทัด ห้ามข้ามข้อความ ห้ามย่อความ',
    '3. รักษาตัวเลข วันที่ เลขบัญชี รหัส ชื่อเฉพาะ และรูปแบบเดิมไว้ทุกตัวอักษร',
    '4. แบ่งประโยค: ให้แต่ละประโยคขึ้นบรรทัดใหม่ (แม้ต้นฉบับจะไม่มีจุดหรือเว้นวรรค)',
    '5. ห้ามเพิ่มข้อมูลใหม่ ห้ามอธิบาย ห้ามใส่ markdown',
    '6. ตอบเฉพาะข้อความที่แก้ไขแล้วเท่านั้น'
].join('\n');

function loadExamples() {
    try {
        const parsed = JSON.parse(fs.readFileSync(EXAMPLES_FILE, 'utf8'));
        const list = Array.isArray(parsed && parsed.examples)
            ? parsed.examples
            : [];

        return list
            .filter(function (item) {
                return (
                    item &&
                    typeof item.input === 'string' &&
                    typeof item.output === 'string' &&
                    item.input.trim() !== '' &&
                    item.output.trim() !== ''
                );
            })
            .map(function (item) {
                return {
                    input: item.input.trim(),
                    output: item.output.trim()
                };
            });

    } catch (error) {
        return [];
    }
}

// ------------------------------------------------------------------
// Vector few-shot
// ------------------------------------------------------------------

function normalizeForVector(text) {
    return String(text == null ? '' : text)
        .replace(/\s+/g, '')
        .replace(/[.,:;()\[\]{}"'“”‘’]/g, '');
}

// FNV-1a 32-bit — ใช้ hash n-gram ลง vector ขนาดคงที่
function hash(text) {
    let value = 0x811c9dc5;

    for (let index = 0; index < text.length; index++) {
        value ^= text.charCodeAt(index);
        value = Math.imul(value, 0x01000193);
    }

    return value >>> 0;
}

// vector จาก char n-gram 2-4 ตัว — ภาษาไทยไม่เว้นวรรคจึงใช้ระดับตัวอักษร
function charNgramVector(text, dims) {
    const size = Number(dims) > 0 ? Number(dims) : VECTOR_DIM;
    const vector = new Array(size).fill(0);
    const value = normalizeForVector(text);
    const chars = Array.from(value);

    for (let n = 2; n <= 4; n++) {
        for (let index = 0; index + n <= chars.length; index++) {
            const gram = chars.slice(index, index + n).join('');
            vector[hash(gram) % size] += 1;
        }
    }

    const length = Math.sqrt(vector.reduce(function (sum, item) {
        return sum + item * item;
    }, 0));

    if (length > 0) {
        for (let index = 0; index < vector.length; index++) {
            vector[index] /= length;
        }
    }

    return vector;
}

function cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return 0;
    }

    let dot = 0;
    let left = 0;
    let right = 0;

    for (let index = 0; index < a.length; index++) {
        const x = Number(a[index]) || 0;
        const y = Number(b[index]) || 0;

        dot += x * y;
        left += x * x;
        right += y * y;
    }

    if (left === 0 || right === 0) return 0;

    return dot / (Math.sqrt(left) * Math.sqrt(right));
}

// เลือกตัวอย่างที่ใกล้เคียงกับข้อความมากที่สุด
// opts.exampleVectors = vector ของตัวอย่าง (ถ้ามี embedding)
// opts.textVector     = vector ของข้อความ (ถ้ามี embedding)
function selectExamples(text, examples, count, opts) {
    const options = opts || {};
    const limit = Number(count) > 0 ? Number(count) : FEW_SHOT_COUNT;

    if (!Array.isArray(examples) || examples.length === 0) return [];

    const textVector = Array.isArray(options.textVector)
        ? options.textVector
        : charNgramVector(text);

    const scored = examples.map(function (example, index) {
        const vector = Array.isArray(options.exampleVectors) &&
            Array.isArray(options.exampleVectors[index])
            ? options.exampleVectors[index]
            : charNgramVector(example.input);

        return {
            example: example,
            score: cosine(textVector, vector)
        };
    });

    scored.sort(function (a, b) {
        return b.score - a.score;
    });

    return scored.slice(0, limit).map(function (item) {
        return item.example;
    });
}

// ------------------------------------------------------------------
// Prompt / chunk
// ------------------------------------------------------------------

function chunkText(text, maxChars) {
    const limit = Number(maxChars) > 0 ? Number(maxChars) : CHUNK_CHARS;

    const lines = String(text == null ? '' : text)
        .replace(/\r\n?/g, '\n')
        .split('\n');

    const chunks = [];
    let current = '';

    function flush() {
        if (current.trim() !== '') {
            chunks.push(current);
        }

        current = '';
    }

    lines.forEach(function (line) {
        if (line.length > limit) {
            flush();

            for (let index = 0; index < line.length; index += limit) {
                chunks.push(line.slice(index, index + limit));
            }

            return;
        }

        if (current === '') {
            current = line;
            return;
        }

        if (current.length + line.length + 1 > limit) {
            flush();
            current = line;
            return;
        }

        current += '\n' + line;
    });

    flush();

    return chunks;
}

function buildMessages(chunk, examples, options) {
    const opts = options || {};

    const messages = [
        {
            role: 'system',
            content: SYSTEM_PROMPT
        }
    ];

    (examples || []).forEach(function (example) {
        messages.push({
            role: 'user',
            content: 'แก้ข้อความ OCR นี้:\n' + example.input
        });

        messages.push({
            role: 'assistant',
            content: example.output
        });
    });

    // รอบสอง (strict): เน้นย้ำเมื่อรอบแรกทำตัวเลข/วันที่หาย
    const strictNote = opts.strict === true
        ? 'คำเตือน: ต้องเก็บทุกบรรทัดและตัวเลข/วันที่/รหัสให้ครบทุกตัว ' +
          'ห้ามตัดหรือข้ามข้อความ\n\n'
        : '';

    messages.push({
        role: 'user',
        content: strictNote + 'แก้ข้อความ OCR นี้:\n' + chunk
    });

    return messages;
}

// ตัวเลข/วันที่/รหัสที่ต้องปรากฏเหมือนเดิมในคำตอบ (เช่น 4,000.00 · 25/10/2569 · 702057001)
function numberTokens(text) {
    return String(text == null ? '' : text)
        .match(/\d[\d,./-]*\d|\d/g) || [];
}

// คืนรายการตัวเลขที่หายไปจากคำตอบ
function missingNumbers(original, output) {
    const expected = numberTokens(original);

    if (expected.length === 0) return [];

    const found = new Set(numberTokens(output));

    return expected.filter(function (token) {
        return !found.has(token);
    });
}

function toGeminiBody(messages, options) {
    const opts = options || {};
    const system = messages.filter(function (message) {
        return message.role === 'system';
    });

    const contents = messages
        .filter(function (message) {
            return message.role !== 'system';
        })
        .map(function (message) {
            return {
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }]
            };
        });

    return {
        systemInstruction: system.length > 0
            ? {
                parts: system.map(function (message) {
                    return { text: message.content };
                })
            }
            : undefined,
        contents: contents,
        generationConfig: {
            temperature: 0,
            maxOutputTokens: Number(opts.maxOutputTokens) || 4096,
            // Gemini 2.5 flash: ปิด thinking เพื่อลดเวลาและโควตา
            thinkingConfig: {
                thinkingBudget: 0
            }
        }
    };
}

// ------------------------------------------------------------------
// ตรวจคำตอบจากโมเดล
// ------------------------------------------------------------------

function compactLength(text) {
    return String(text == null ? '' : text).replace(/\s+/g, '').length;
}

// คืนข้อความที่ใช้ได้ หรือ null เมื่อคำตอบดูผิดรูป
function sanitizeOutput(raw, original) {
    let text = String(raw == null ? '' : raw)
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n');

    text = text
        .replace(/^\s*```[A-Za-z0-9_-]*\s*\n?/, '')
        .replace(/\n?```\s*$/, '');

    text = text
        .split('\n')
        .map(function (line) {
            return line.replace(/[ \t]+/g, ' ').trim();
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // ลบป้ายที่โมเดลอาจใส่หน้า/ท้ายคำตอบ
    text = text
        .replace(/^(?:ข้อความ(?:ที่)?แก้ไข(?:แล้ว)?|แก้ไขแล้ว|ผลลัพธ์)\s*[:：]\s*/i, '')
        .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, '')
        .trim();

    if (text === '') return null;

    // คำตอบที่หลุด prompt กลับมา = ใช้ไม่ได้
    if (/ตอบเฉพาะข้อความที่แก้ไขแล้ว|คุณเป็นตัวแก้ไขข้อความจาก OCR/.test(text)) {
        return null;
    }

    // กันโมเดลสรุป/เพิ่ม/ลบเนื้อหาจนผิดรูป
    const before = compactLength(original);
    const after = compactLength(text);

    if (before > 0) {
        const ratio = after / before;

        if (ratio < 0.4 || ratio > 2.5) {
            return null;
        }
    }

    return text;
}

function countSentences(text) {
    return String(text == null ? '' : text)
        .split('\n')
        .filter(function (line) {
            return line.trim() !== '';
        })
        .length;
}

// ------------------------------------------------------------------
// เรียก Gemini
// ------------------------------------------------------------------

function friendlyGeminiError(status, message) {
    const detail = String(message || '').slice(0, 300);

    if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(detail)) {
        return 'API key ของ Gemini ไม่ถูกต้อง — ตรวจ key ในหน้า ตั้งค่า OCR';
    }

    if (status === 401 || status === 403) {
        return 'API key ของ Gemini ไม่มีสิทธิ์ใช้งานโมเดลนี้';
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

function sanitizeModel(value) {
    const model = String(value || '').trim();

    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(model)
        ? model
        : 'gemini-2.5-flash';
}

async function geminiChunk(messages, options) {
    const opts = options || {};
    const apiKey = String(opts.apiKey || '').trim();

    if (apiKey === '') {
        throw new Error('ยังไม่ได้ใส่ API key ของ Gemini — ไปที่ ตั้งค่า OCR ก่อน');
    }

    const model = sanitizeModel(opts.model);

    const controller = new AbortController();
    const timer = setTimeout(function () {
        controller.abort();
    }, GEMINI_TIMEOUT_MS);

    let response;

    try {
        response = await fetch(
            GEMINI_API_BASE + encodeURIComponent(model) + ':generateContent',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                },
                body: JSON.stringify(toGeminiBody(messages, opts)),
                signal: controller.signal
            }
        );

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('Gemini ใช้เวลานานเกินไป (timeout) — ลองใหม่');
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

        throw new Error(friendlyGeminiError(response.status, message));
    }

    const candidate = data &&
        Array.isArray(data.candidates) &&
        data.candidates[0];

    const parts = candidate &&
        candidate.content &&
        Array.isArray(candidate.content.parts)
        ? candidate.content.parts
        : [];

    return parts
        .map(function (part) {
            return part && typeof part.text === 'string' ? part.text : '';
        })
        .filter(Boolean)
        .join('\n');
}

// ------------------------------------------------------------------
// ตัวประสานงาน
// ------------------------------------------------------------------

async function runChunks(text, options) {
    const opts = options || {};
    const chunks = chunkText(text, opts.chunkChars);
    const examples = loadExamples();
    const outputs = [];
    const warnings = [];

    const embed = typeof opts.embed === 'function' ? opts.embed : null;

    let exampleVectors = null;

    if (embed && examples.length > 0) {
        try {
            exampleVectors = await embed(examples.map(function (example) {
                return example.input;
            }));

            if (
                !Array.isArray(exampleVectors) ||
                exampleVectors.length !== examples.length
            ) {
                exampleVectors = null;
            }

        } catch (error) {
            exampleVectors = null;
        }
    }

    for (let index = 0; index < chunks.length; index++) {
        const chunk = chunks[index];

        if (typeof opts.onProgress === 'function') {
            opts.onProgress({
                stage: 'chunk',
                index: index + 1,
                total: chunks.length,
                percent: Math.round((index / chunks.length) * 100)
            });
        }

        let selected;

        if (embed) {
            let textVector = null;

            try {
                const vectors = await embed([chunk]);

                if (Array.isArray(vectors) && Array.isArray(vectors[0])) {
                    textVector = vectors[0];
                }

            } catch (error) {
                textVector = null;
            }

            selected = selectExamples(chunk, examples, FEW_SHOT_COUNT, {
                exampleVectors: exampleVectors,
                textVector: textVector
            });

        } else {
            selected = selectExamples(chunk, examples, FEW_SHOT_COUNT);
        }

        try {
            const raw = await opts.call(chunk, buildMessages(chunk, selected));
            let clean = sanitizeOutput(raw, chunk);

            // คำตอบผิดรูป หรือตัวเลข/วันที่/รหัสหายไป = ใช้ไม่ได้ ลองใหม่หนึ่งครั้งแบบเข้มงวด
            if (clean === null || missingNumbers(chunk, clean).length > 0) {
                const retryRaw = await opts.call(
                    chunk,
                    buildMessages(chunk, selected, { strict: true })
                );

                const retry = sanitizeOutput(retryRaw, chunk);

                clean = retry !== null && missingNumbers(chunk, retry).length === 0
                    ? retry
                    : null;
            }

            if (clean === null) {
                warnings.push(
                    'ก้อนที่ ' + (index + 1) +
                    ' คำตอบไม่ครบ/ผิดรูป — ใช้ข้อความเดิม'
                );
                outputs.push(chunk);
            } else {
                outputs.push(clean);
            }

        } catch (error) {
            warnings.push(
                'ก้อนที่ ' + (index + 1) + ': ' +
                ((error && error.message) || 'ประมวลผลไม่สำเร็จ')
            );

            outputs.push(chunk);
        }
    }

    if (typeof opts.onProgress === 'function') {
        opts.onProgress({
            stage: 'done',
            index: chunks.length,
            total: chunks.length,
            percent: 100
        });
    }

    const resultText = outputs.join('\n').trim();

    if (resultText === '') {
        throw new Error('ไม่มีข้อความให้ปรับ — ตรวจข้อความต้นทางอีกครั้ง');
    }

    // ถ้าทุกก้อนล้มเหลว ให้แจ้งข้อผิดพลาดจริงแทนการคืนข้อความเดิมเงียบ ๆ
    if (warnings.length === chunks.length) {
        throw new Error(warnings[0]);
    }

    return {
        text: resultText,
        chunks: chunks.length,
        sentences: countSentences(resultText),
        warnings: warnings
    };
}

async function processWithGemini(text, options) {
    const opts = options || {};

    const result = await runChunks(text, {
        chunkChars: opts.chunkChars,
        onProgress: opts.onProgress,
        call: function (chunk, messages) {
            return geminiChunk(messages, {
                apiKey: opts.apiKey,
                model: opts.model
            });
        }
    });

    return Object.assign(result, {
        engine: 'api'
    });
}

async function processWithLocal(text, options) {
    const opts = options || {};
    const local = require('./post-ocr-local.cjs');

    const result = await runChunks(text, {
        chunkChars: opts.chunkChars,
        onProgress: opts.onProgress,
        embed: async function (texts) {
            // ถ้า endpoint embeddings ใช้ไม่ได้ จะคืน null → ใช้ char n-gram แทน
            return local.embed(texts, opts.dataPath);
        },
        call: function (chunk, messages) {
            return local.chat(messages, {
                dataPath: opts.dataPath,
                timeoutMs: opts.timeoutMs
            });
        }
    });

    return Object.assign(result, {
        engine: 'local'
    });
}

async function processText(text, options) {
    const opts = options || {};
    const source = String(text == null ? '' : text);

    if (source.trim() === '') {
        throw new Error('ไม่มีข้อความให้ปรับ');
    }

    if (opts.engine === 'local') {
        return processWithLocal(source, opts);
    }

    if (opts.engine === 'api') {
        return processWithGemini(source, opts);
    }

    return {
        text: source,
        engine: 'library',
        chunks: 0,
        sentences: countSentences(source),
        warnings: []
    };
}

module.exports = {
    CHUNK_CHARS,
    FEW_SHOT_COUNT,
    SYSTEM_PROMPT,
    loadExamples,
    charNgramVector,
    cosine,
    selectExamples,
    chunkText,
    buildMessages,
    toGeminiBody,
    sanitizeOutput,
    numberTokens,
    missingNumbers,
    countSentences,
    processText,
    processWithGemini,
    processWithLocal
};
