// AI ช่วยแก้ข้อความที่ OCR อ่านผิด (Google Gemini)
//
// ทำงานฝั่ง main process ทั้งหมด:
//   - เก็บค่าตั้ง (เปิด/ปิด AI, โมเดล, prompt ของระบบ, API key) ไว้ที่ data/ocr-ai.json
//     โดย API key ถูกเข้ารหัสด้วย safeStorage ของ Electron (DPAPI บน Windows)
//   - ส่งภาพหน้า + ข้อความที่ tesseract อ่านได้ ให้ Gemini ช่วยแก้ "เฉพาะคำที่อ่านผิด"
//   - เทียบข้อความก่อน/หลังเพื่อเก็บคู่คำที่แก้ไว้ใช้ตอน AI ปิด (เรียนรู้สะสมในเครื่อง)
//
// ถ้า AI ปิด / ไม่มี key / เน็ตหลุด → ผู้เรียกใช้ข้อความของ tesseract ต่อได้ทันที
// (ทุกฟังก์ชันที่ยิงเน็ตคืน error ออกมาเป็นข้อความไทย ผู้เรียกไม่ต้อง throw ต่อ)
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = "ocr-ai.json";

const DEFAULT_MODEL = "gemini-2.5-flash";

// จำนวนบรรทัดต่อหนึ่งคำขอ — หน้าที่มีข้อความเยอะจะถูกแบ่งเป็นหลายรอบ
// (กันคำตอบยาวเกินเพดาน token จน JSON ขาดกลางคัน)
const MAX_LINES_PER_REQUEST = 120;

// เวลารอคำตอบต่อหนึ่งคำขอ
const REQUEST_TIMEOUT_MS = 120 * 1000;

// เพดาน token ของคำตอบ — 120 บรรทัดภาษาไทยใช้ราว 3-5 พัน token
// เผื่อไว้ให้โมเดลที่ "คิดก่อนตอบ" ใช้ token ภายในได้ด้วย
const MAX_OUTPUT_TOKENS = 16384;

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

// prompt เริ่มต้น — ผู้ใช้แก้ได้ในหน้า "ตั้งค่า AI (OCR)"
// เขียนให้ยึดภาพเป็นหลักและห้ามแต่งข้อความเพิ่ม เพราะผลลัพธ์ถูกใช้จับ regex ต่อ
const DEFAULT_PROMPT = [
    "คุณเป็นผู้ตรวจแก้ข้อความ OCR ภาษาไทยจากเอกสารราชการและเอกสารธุรกิจ",
    "คุณจะได้รับภาพหน้าต้นฉบับ และข้อความที่ OCR อ่านได้ (บรรทัดละรายการ พร้อม id)",
    "",
    "หน้าที่: แก้เฉพาะคำที่ OCR อ่านผิด สะกดผิด หรือตัวอักษรเพี้ยน โดยยึดภาพเป็นหลัก",
    "",
    "กฎ:",
    "1. คงจำนวนบรรทัดและ id เดิมทุกบรรทัด ห้ามรวม แยก เพิ่ม หรือลบบรรทัด",
    "2. ห้ามแต่งเนื้อหาเพิ่ม และห้ามแก้ข้อความที่ถูกต้องอยู่แล้ว",
    "3. ตัวเลข วันที่ เลขบัญชี และชื่อเฉพาะ ให้คัดลอกตามที่เห็นในภาพให้แม่นที่สุด",
    "4. ถ้าภาพส่วนใดอ่านไม่ออกจริง ๆ ให้คงข้อความเดิมของบรรทัดนั้นไว้",
    "5. ตอบเป็น JSON ตาม schema เท่านั้น"
].join("\n");

// ------------------------------------------------------------------
// ค่าตั้ง (เก็บในไฟล์ ไม่เก็บในฐานข้อมูล — key ต้องไม่ติดไปกับไฟล์สำรอง .db)
// ------------------------------------------------------------------

function configPath(dataPath) {
    return path.join(dataPath, CONFIG_FILE);
}

// safeStorage ใช้ได้เฉพาะใน Electron (ตอนรันเทสต์ด้วย Node ธรรมดาจะไม่มี)
// คืน null = เข้ารหัสไม่ได้ → เก็บแบบ base64 พร้อมบอก prefix ไว้ให้รู้
function keyCipher() {
    try {
        const { safeStorage } = require("electron");

        if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
            return null;
        }

        return safeStorage;
    } catch (error) {
        return null;
    }
}

function encryptKey(plain) {
    const value = String(plain || "");

    if (value === "") {
        return "";
    }

    const cipher = keyCipher();

    if (cipher) {
        return "enc:" + cipher.encryptString(value).toString("base64");
    }

    return "plain:" + Buffer.from(value, "utf8").toString("base64");
}

function decryptKey(stored) {
    const value = String(stored || "");

    if (value === "") {
        return "";
    }

    try {
        if (value.indexOf("enc:") === 0) {
            const cipher = keyCipher();

            if (!cipher) {
                return "";
            }

            return cipher.decryptString(
                Buffer.from(value.slice(4), "base64")
            );
        }

        if (value.indexOf("plain:") === 0) {
            return Buffer.from(value.slice(6), "base64").toString("utf8");
        }
    } catch (error) {
        // เครื่องอื่น/ผู้ใช้ Windows คนละคนถอดรหัสไม่ได้ — ต้องกรอก key ใหม่
        return "";
    }

    return "";
}

function readRawConfig(dataPath) {
    try {
        const raw = fs.readFileSync(configPath(dataPath), "utf8");
        const parsed = JSON.parse(raw);

        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
        return {};
    }
}

// ค่าที่ใช้ทำงานจริง (มี key ถอดรหัสแล้ว) — ห้ามส่งกลับไปหน้าจอ
function getConfig(dataPath) {
    const raw = readRawConfig(dataPath);

    return {
        enabled: raw.enabled === true,
        model: String(raw.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
        prompt: typeof raw.prompt === "string" && raw.prompt.trim() !== ""
            ? raw.prompt
            : DEFAULT_PROMPT,
        apiKey: decryptKey(raw.apiKey),
        savedAt: raw.savedAt || ""
    };
}

// ค่าที่ส่งให้หน้าจอ — ไม่มี key มีแต่บอกว่ามี key อยู่หรือไม่
function getPublicConfig(dataPath) {
    const config = getConfig(dataPath);

    return {
        enabled: config.enabled,
        model: config.model,
        prompt: config.prompt,
        hasKey: config.apiKey !== "",
        isDefaultPrompt: config.prompt === DEFAULT_PROMPT,
        defaultModel: DEFAULT_MODEL,
        defaultPrompt: DEFAULT_PROMPT,
        savedAt: config.savedAt
    };
}

// patch = { enabled, model, prompt, apiKey, clearKey }
// apiKey ที่ไม่ส่งมา = คง key เดิม, clearKey = true = ลบ key ทิ้ง
function saveConfig(dataPath, patch) {
    const body = patch && typeof patch === "object" ? patch : {};
    const raw = readRawConfig(dataPath);
    const next = {
        enabled: body.enabled === undefined
            ? raw.enabled === true
            : body.enabled === true,
        model: String(
            body.model === undefined
                ? (raw.model || DEFAULT_MODEL)
                : body.model
        ).trim() || DEFAULT_MODEL,
        prompt: String(
            body.prompt === undefined
                ? (typeof raw.prompt === "string" ? raw.prompt : DEFAULT_PROMPT)
                : body.prompt
        ),
        apiKey: raw.apiKey || "",
        savedAt: new Date().toISOString()
    };

    if (body.clearKey === true) {
        next.apiKey = "";
    } else if (typeof body.apiKey === "string" && body.apiKey.trim() !== "") {
        next.apiKey = encryptKey(body.apiKey.trim());
    }

    fs.mkdirSync(dataPath, { recursive: true });

    // เขียนทับแบบ atomic — ไฟดับกลางคันจะไม่เหลือไฟล์ค่าตั้งที่อ่านไม่ได้
    const target = configPath(dataPath);
    const temp = target + ".tmp";

    fs.writeFileSync(temp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(temp, target);

    return getPublicConfig(dataPath);
}

// ------------------------------------------------------------------
// เรียก Gemini
// ------------------------------------------------------------------

function apiErrorText(status, body) {
    let detail = "";

    try {
        const parsed = JSON.parse(body);

        detail =
            (parsed.error && parsed.error.message) ||
            parsed.error_description ||
            "";
    } catch (error) {
        detail = String(body || "").slice(0, 300);
    }

    if (status === 400) {
        return "คำขอไม่ถูกต้อง (ตรวจชื่อโมเดล/รูปแบบ prompt)" +
            (detail ? ": " + detail : "");
    }

    if (status === 401 || status === 403) {
        return "API key ไม่ถูกต้องหรือไม่มีสิทธิ์ใช้โมเดลนี้" +
            (detail ? ": " + detail : "");
    }

    if (status === 404) {
        return "ไม่พบโมเดลที่ระบุ — ตรวจชื่อโมเดลอีกครั้ง" +
            (detail ? ": " + detail : "");
    }

    if (status === 429) {
        return "ใช้งานเกินโควตาชั่วคราว (429) — รอสักครู่แล้วลองใหม่";
    }

    return "เรียก Gemini ไม่สำเร็จ (" + status + ")" +
        (detail ? ": " + detail : "");
}

function requestTimeout() {
    const controller = new AbortController();
    const timer = setTimeout(function () {
        controller.abort();
    }, REQUEST_TIMEOUT_MS);

    if (timer && typeof timer.unref === "function") {
        timer.unref();
    }

    return {
        signal: controller.signal,
        done: function () {
            clearTimeout(timer);
        }
    };
}

function sleep(ms) {
    return new Promise(function (resolve) {
        const timer = setTimeout(resolve, ms);

        if (timer && typeof timer.unref === "function") {
            timer.unref();
        }
    });
}

/**
 * ยิงคำขอไปที่ Gemini
 * @param {Object} config { apiKey, model }
 * @param {Object} body เนื้อคำขอ (contents/systemInstruction/generationConfig)
 * @returns {Promise<{ok:boolean, text?:string, usage?:Object, error?:string, status?:number}>}
 */
async function callGemini(config, body) {
    const key = String((config && config.apiKey) || "").trim();

    if (key === "") {
        return { ok: false, error: "ยังไม่ได้ใส่ API key" };
    }

    const model = String((config && config.model) || DEFAULT_MODEL).trim() ||
        DEFAULT_MODEL;

    const url = API_BASE + encodeURIComponent(model) + ":generateContent";

    // ลองซ้ำหนึ่งครั้งเมื่อโดนจำกัดโควตาหรือเซิร์ฟเวอร์สะดุด
    for (let attempt = 0; attempt < 2; attempt++) {
        const timeout = requestTimeout();

        let response;

        try {
            response = await fetch(url, {
                method: "POST",
                signal: timeout.signal,
                headers: {
                    "Content-Type": "application/json",
                    // ส่ง key ทาง header เพื่อไม่ให้ไปโผล่ใน log ของ URL
                    "x-goog-api-key": key
                },
                body: JSON.stringify(body)
            });
        } catch (error) {
            timeout.done();

            if (error && error.name === "AbortError") {
                return { ok: false, error: "Gemini ไม่ตอบภายใน " +
                    Math.round(REQUEST_TIMEOUT_MS / 1000) + " วินาที" };
            }

            return {
                ok: false,
                error: "เชื่อมต่อ Gemini ไม่ได้: " +
                    ((error && error.message) || String(error))
            };
        }

        timeout.done();

        const raw = await response.text();

        if (response.ok) {
            let parsed;

            try {
                parsed = JSON.parse(raw);
            } catch (error) {
                return { ok: false, error: "คำตอบจาก Gemini ไม่ใช่ JSON" };
            }

            const candidate =
                parsed &&
                Array.isArray(parsed.candidates) &&
                parsed.candidates[0];

            if (!candidate) {
                const blocked =
                    parsed &&
                    parsed.promptFeedback &&
                    parsed.promptFeedback.blockReason;

                return {
                    ok: false,
                    error: blocked
                        ? "Gemini ปฏิเสธคำขอ (" + blocked + ")"
                        : "Gemini ไม่ได้ส่งคำตอบกลับมา"
                };
            }

            const text =
                Array.isArray(candidate.content && candidate.content.parts)
                    ? candidate.content.parts
                        .map(function (part) {
                            return part && typeof part.text === "string"
                                ? part.text
                                : "";
                        })
                        .join("")
                    : "";

            if (text.trim() === "") {
                return {
                    ok: false,
                    error: "Gemini ตอบเปล่า" +
                        (candidate.finishReason
                            ? " (finishReason: " + candidate.finishReason + ")"
                            : "")
                };
            }

            return {
                ok: true,
                text: text,
                usage: parsed.usageMetadata || null,
                finishReason: candidate.finishReason || ""
            };
        }

        const retryable =
            response.status === 429 ||
            response.status === 500 ||
            response.status === 503;

        if (retryable && attempt === 0) {
            await sleep(1500);
            continue;
        }

        return {
            ok: false,
            status: response.status,
            error: apiErrorText(response.status, raw)
        };
    }

    return { ok: false, error: "เรียก Gemini ไม่สำเร็จ" };
}

// แยก data URL (data:image/webp;base64,...) เป็นส่วนที่ Gemini รับได้
function inlineImagePart(dataUrl) {
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(dataUrl || ""));

    if (!match) {
        return null;
    }

    return {
        inline_data: {
            mime_type: match[1],
            data: match[2]
        }
    };
}

// แยก JSON จากคำตอบ (บางรุ่นครอบด้วย ```json ... ```)
function parseJsonAnswer(text) {
    let value = String(text || "").trim();

    const fenced = /^```(?:json)?\s*([\s\S]*?)```$/i.exec(value);

    if (fenced) {
        value = fenced[1].trim();
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        // เผื่อมีข้อความอื่นปนมา — ตัดเอาเฉพาะก้อน JSON ก้อนแรก
        const start = value.indexOf("{");
        const end = value.lastIndexOf("}");

        if (start !== -1 && end > start) {
            try {
                return JSON.parse(value.slice(start, end + 1));
            } catch (inner) {
                return null;
            }
        }

        return null;
    }
}

// ค่าที่ Gemini ส่งมาเป็น object/array ตาม schema
// (รับได้ทั้ง { lines: [...] } และ array ตรง ๆ)
function answerLines(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (payload && Array.isArray(payload.lines)) {
        return payload.lines;
    }

    if (payload && Array.isArray(payload.items)) {
        return payload.items;
    }

    return [];
}

const RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        lines: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    id: { type: "INTEGER" },
                    text: { type: "STRING" }
                },
                required: ["id", "text"],
                propertyOrdering: ["id", "text"]
            }
        }
    },
    required: ["lines"],
    propertyOrdering: ["lines"]
};

/**
 * ให้ AI ช่วยแก้ข้อความทีละบรรทัด
 *
 * @param {Object} config { apiKey, model, prompt }
 * @param {Object} input
 *   image = data URL ของภาพหน้า (webp/png)
 *   lines = [{ id: number, text: string }] ข้อความจาก tesseract
 * @returns {Promise<{ok:boolean, lines?:Array<{id:number,text:string}>, usage?:Object,
 *                    error?:string, model?:string}>}
 */
async function correctLines(config, input) {
    const source = Array.isArray(input && input.lines) ? input.lines : [];
    const imagePart = inlineImagePart(input && input.image);

    if (source.length === 0) {
        return { ok: true, lines: [] };
    }

    if (!imagePart) {
        return { ok: false, error: "ไม่มีภาพหน้าสำหรับส่งให้ AI" };
    }

    const corrected = [];
    let usage = null;

    for (
        let offset = 0;
        offset < source.length;
        offset += MAX_LINES_PER_REQUEST
    ) {
        const chunk = source.slice(offset, offset + MAX_LINES_PER_REQUEST);

        const list = chunk
            .map(function (line) {
                return line.id + "| " + String(line.text || "");
            })
            .join("\n");

        const body = {
            systemInstruction: {
                parts: [{ text: config.prompt || DEFAULT_PROMPT }]
            },
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text:
                                "ข้อความจาก tesseract (id|ข้อความ):\n" +
                                list +
                                "\n\nแก้คำที่อ่านผิดให้ตรงกับภาพ แล้วตอบเป็น JSON " +
                                '{"lines":[{"id":<id เดิม>,"text":"<ข้อความที่แก้แล้ว>"}]} ' +
                                "โดยมีครบทุกลำดับ id"
                        },
                        imagePart
                    ]
                }
            ],
            generationConfig: {
                temperature: 0,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                responseMimeType: "application/json",
                responseSchema: RESPONSE_SCHEMA
            }
        };

        const result = await callGemini(config, body);

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                status: result.status
            };
        }

        if (result.usage) {
            usage = usage || {
                promptTokenCount: 0,
                candidatesTokenCount: 0,
                totalTokenCount: 0
            };

            usage.promptTokenCount +=
                Number(result.usage.promptTokenCount) || 0;
            usage.candidatesTokenCount +=
                Number(result.usage.candidatesTokenCount) || 0;
            usage.totalTokenCount +=
                Number(result.usage.totalTokenCount) || 0;
        }

        const parsed = parseJsonAnswer(result.text);
        const rows = answerLines(parsed);

        if (rows.length === 0) {
            return { ok: false, error: "AI ตอบในรูปแบบที่อ่านไม่ได้" };
        }

        const byId = {};

        rows.forEach(function (row) {
            const id = Math.floor(Number(row && row.id));

            if (!isFinite(id)) return;

            const text = String((row && row.text) || "")
                .replace(/[\r\n]+/g, " ")
                .trim();

            if (text === "") return;

            byId[id] = text;
        });

        chunk.forEach(function (line) {
            const text = byId[line.id];

            corrected.push({
                id: line.id,
                text: text === undefined ? line.text : text
            });
        });
    }

    return { ok: true, lines: corrected, usage: usage };
}

/**
 * ทดสอบว่า key/โมเดลใช้ได้จริง (คำขอย่อย ไม่ส่งภาพ)
 * @param {Object} config { apiKey, model }
 * @returns {Promise<{ok:boolean, model?:string, message?:string}>}
 */
async function testConnection(config) {
    const key = String((config && config.apiKey) || "").trim();

    if (key === "") {
        return { ok: false, error: "ยังไม่ได้ใส่ API key" };
    }

    const result = await callGemini(config, {
        contents: [
            {
                role: "user",
                parts: [{ text: "ตอบคำเดียวว่า OK" }]
            }
        ],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 256
        }
    });

    if (!result.ok) {
        return { ok: false, error: result.error };
    }

    return {
        ok: true,
        model: String((config && config.model) || DEFAULT_MODEL),
        message: String(result.text || "").trim().slice(0, 40)
    };
}

// ------------------------------------------------------------------
// เรียนรู้จากคำที่ AI แก้ (ใช้ตอน AI ปิด)
// ------------------------------------------------------------------

// แยกเป็นคำด้วยช่องว่าง — ภาษาไทยไม่เว้นวรรคกลางคำอยู่แล้ว
// ถ้าจำนวนคำสองฝั่งไม่เท่ากัน (AI รวม/แยกคำ) จะไม่เรียนคู่นั้น
// เพราะแทนทั้งข้อความอาจไปโดนคำอื่นผิดตำแหน่ง
function tokenize(text) {
    return String(text == null ? "" : text)
        .trim()
        .split(/\s+/)
        .filter(function (token) {
            return token !== "";
        });
}

// ความยาวสูงสุดของคำที่ยอมให้เรียนรู้ (กันทั้งบรรทัดหลุดมาเป็น "คำ")
const MAX_LEARNED_WORD = 80;

// จำนวนตัวอักษรที่ต่างกันได้ เมื่อคำนั้น tesseract มั่นใจสูง
// (แก้ไม้โท/สระที่หายไป = ควรจำ เพราะเป็นรูปแบบความผิดพลาดของ OCR)
const MINOR_EDIT_LIMIT = 2;

// ระยะแก้ไข (Levenshtein) แบบหยุดเมื่อเกิน max — ไม่ต้องคำนวณเต็มตาราง
function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;

    let previous = [];

    for (let column = 0; column <= b.length; column++) {
        previous[column] = column;
    }

    for (let row = 1; row <= a.length; row++) {
        const current = [row];
        let best = row;

        for (let column = 1; column <= b.length; column++) {
            const cost = a[row - 1] === b[column - 1] ? 0 : 1;

            current[column] = Math.min(
                previous[column] + 1,
                current[column - 1] + 1,
                previous[column - 1] + cost
            );

            if (current[column] < best) best = current[column];
        }

        if (best > max) return max + 1;

        previous = current;
    }

    return previous[b.length];
}

/**
 * เทียบข้อความก่อน/หลัง AI แล้วคืนคู่คำที่ควรจำ
 *
 * @param {Array<{before:string, after:string, confidence:number|null}>} pairs
 * @returns {Array<{wrong:string, right:string, confidence:number|null}>}
 */
function buildLearnedFixes(pairs) {
    const found = {};

    (Array.isArray(pairs) ? pairs : []).forEach(function (pair) {
        const before = tokenize(pair && pair.before);
        const after = tokenize(pair && pair.after);

        if (before.length === 0 || before.length !== after.length) {
            return;
        }

        const confidence = Number(pair.confidence);

        // คำที่ tesseract มั่นใจสูงมักถูกอยู่แล้ว — ถ้า AI ไปเขียนใหม่ทั้งคำ
        // แล้วเราจำไว้ ความผิดพลาดจะถูกใช้ซ้ำตอน AI ปิด
        // จึงยอมจำเฉพาะคำที่ "แก้นิดเดียว" (เช่น เติมไม้โท/สระที่หาย)
        const trusted = Number.isFinite(confidence) && confidence >= 70;

        for (let index = 0; index < before.length; index++) {
            const wrong = before[index];
            const right = after[index];

            if (wrong === right) continue;
            if (wrong.length === 0 || right.length === 0) continue;
            if (wrong.length > MAX_LEARNED_WORD) continue;
            if (right.length > MAX_LEARNED_WORD) continue;

            // ตัวอักษรเหมือนกันแต่ลำดับ/ช่องว่างต่าง = ไม่ใช่คำที่อ่านผิด
            if (wrong.replace(/\s/g, "") === right.replace(/\s/g, "")) {
                continue;
            }

            if (
                trusted &&
                editDistance(wrong, right, MINOR_EDIT_LIMIT) > MINOR_EDIT_LIMIT
            ) {
                continue;
            }

            const existing = found[wrong];

            if (existing) {
                // เจอคำเดิมถูกแก้เป็นคำเดียวกันซ้ำ = เก็บครั้งเดียว
                if (existing.right !== right) {
                    // ขัดแย้งกันเอง — ไม่จำคู่นี้เลย
                    existing.conflict = true;
                }
                return;
            }

            found[wrong] = {
                wrong: wrong,
                right: right,
                confidence: Number.isFinite(confidence) ? confidence : null
            };
        }
    });

    return Object.keys(found)
        .map(function (key) {
            return found[key];
        })
        .filter(function (fix) {
            return !fix.conflict;
        });
}

module.exports = {
    DEFAULT_MODEL: DEFAULT_MODEL,
    DEFAULT_PROMPT: DEFAULT_PROMPT,
    MAX_LINES_PER_REQUEST: MAX_LINES_PER_REQUEST,
    configPath: configPath,
    getConfig: getConfig,
    getPublicConfig: getPublicConfig,
    saveConfig: saveConfig,
    correctLines: correctLines,
    testConnection: testConnection,
    buildLearnedFixes: buildLearnedFixes,
    tokenize: tokenize,
    editDistance: editDistance,
    // ใช้ในเทสต์ ไม่ต้องยิงเน็ต
    parseJsonAnswer: parseJsonAnswer,
    inlineImagePart: inlineImagePart
};
