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
const crypto = require("crypto");

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

// สถานะการหมุน key ในรอบการทำงานนี้ (ไม่เขียนลงไฟล์ — เริ่มใหม่เมื่อเปิดแอป)
//   cooldown = key ที่โควตาหมด/เซิร์ฟเวอร์สะดุด → พักชั่วคราว
//   invalid  = key ที่ถูกปฏิเสธ (401/403) → ไม่ใช้จนกว่าจะเปิดแอปใหม่
//   failures = นับครั้งที่ล้มเหลว เพื่อเพิ่มเวลาพักแบบทวีคูณ
const KEY_COOLDOWN_BASE_MS = 60 * 1000;
const KEY_COOLDOWN_MAX_MS = 15 * 60 * 1000;
const KEY_SERVER_COOLDOWN_MS = 30 * 1000;

const keyState = {
    cooldown: new Map(),
    failures: new Map(),
    invalid: new Set(),
    activeId: ""
};

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

// คำสั่งเพิ่มเมื่อเปิด "จัดข้อความเป็นหัวข้อ: ค่า"
// ใช้ต่อท้าย prompt หลัก — ยังยึดภาพและห้ามแต่งเนื้อหา
const STRUCTURE_INSTRUCTION = [
    "",
    "การจัดโครงสร้าง (structured):",
    "- ใส่ structured เฉพาะคู่ \"หัวข้อ: ค่า\" ที่ปรากฏจริงในภาพ",
    "- ต้องใส่ให้ครบทุกคู่ที่เห็นในภาพ (ทุกช่องของฟอร์ม ทุกคอลัมน์) ห้ามสรุป ห้ามเลือกเฉพาะบางช่อง",
    "- ถ้าหัวข้อกับค่าอยู่คนละบรรทัด ให้จับคู่กันเป็นคู่เดียว",
    "- หัวข้อใช้คำเดียวกับที่พิมพ์ในเอกสาร เช่น เลขที่ วันที่ ชื่อบัญชี รหัสบัญชี เดบิต เครดิต",
    "- value คัดลอกค่าจากภาพให้ครบทุกตัวอักษร ห้ามปัดเศษ ห้ามตัดทศนิยม",
    "- ถ้าไม่แน่ใจว่าเป็นคู่หัวข้อ:ค่า ให้ข้ามไป ไม่ต้องเดา",
    "- lines ยังต้องส่งครบทุกลำดับ id เหมือนเดิม"
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

// ท้าย ๆ ของ key ไว้ให้ผู้ใช้จำได้ว่าเป็นอันไหน (ไม่ใช่ความลับทั้งก้อน)
function keyHint(value) {
    const text = String(value || "");

    if (text === "") return "";

    return "…" + text.slice(-4);
}

// รายการ key ที่เก็บในไฟล์
// รองรับไฟล์รุ่นก่อนที่เก็บ key เดียวในฟิลด์ apiKey
function readKeyEntries(raw) {
    const entries = [];

    if (Array.isArray(raw && raw.keys)) {
        raw.keys.forEach(function (item) {
            const enc = String((item && item.enc) || "");

            if (enc === "") return;

            entries.push({
                id: String((item && item.id) || ("key-" + (entries.length + 1))),
                enc: enc,
                hint: String((item && item.hint) || ""),
                addedAt: String((item && item.addedAt) || "")
            });
        });
    }

    if (
        entries.length === 0 &&
        typeof raw.apiKey === "string" &&
        raw.apiKey !== ""
    ) {
        entries.push({
            id: "key-1",
            enc: raw.apiKey,
            hint: "",
            addedAt: String(raw.savedAt || "")
        });
    }

    return entries;
}

// ค่าที่ใช้ทำงานจริง (มี key ถอดรหัสแล้ว) — ห้ามส่งกลับไปหน้าจอ
function getConfig(dataPath) {
    const raw = readRawConfig(dataPath);

    const keys = readKeyEntries(raw)
        .map(function (entry) {
            const value = decryptKey(entry.enc);

            return {
                id: entry.id,
                value: value,
                hint: entry.hint || keyHint(value),
                addedAt: entry.addedAt
            };
        })
        .filter(function (key) {
            return key.value !== "";
        });

    return {
        enabled: raw.enabled === true,
        model: String(raw.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
        prompt: typeof raw.prompt === "string" && raw.prompt.trim() !== ""
            ? raw.prompt
            : DEFAULT_PROMPT,
        apiKeys: keys,
        savedAt: raw.savedAt || ""
    };
}

// สถานะของ key ในรอบการทำงานนี้ (ไม่เขียนลงไฟล์ — เริ่มใหม่เมื่อเปิดแอป)
function keyStatusOf(id) {
    if (keyState.invalid.has(id)) return "invalid";

    if ((keyState.cooldown.get(id) || 0) > Date.now()) return "cooldown";

    return "ready";
}

// ค่าที่ส่งให้หน้าจอ — ไม่มี key มีแต่คำใบ้/สถานะ
function getPublicConfig(dataPath) {
    const config = getConfig(dataPath);

    return {
        enabled: config.enabled,
        model: config.model,
        prompt: config.prompt,
        keys: config.apiKeys.map(function (key) {
            return {
                id: key.id,
                hint: key.hint,
                addedAt: key.addedAt,
                status: keyStatusOf(key.id),
                retryAt: keyState.cooldown.get(key.id) || 0
            };
        }),
        keyCount: config.apiKeys.length,
        hasKey: config.apiKeys.length > 0,
        isDefaultPrompt: config.prompt === DEFAULT_PROMPT,
        defaultModel: DEFAULT_MODEL,
        defaultPrompt: DEFAULT_PROMPT,
        savedAt: config.savedAt
    };
}

// patch = { enabled, model, prompt,
//           addKey, removeKeyId, clearKeys, apiKey (ชื่อเดิม), clearKey (ชื่อเดิม) }
//   addKey       = เพิ่ม key ใหม่ (ซ้ำกับที่มีอยู่ = ไม่เพิ่ม)
//   removeKeyId  = ลบ key ตาม id
//   clearKeys    = ลบทั้งหมด
//   ไม่ส่งมาเลย = คงรายการเดิม
function saveConfig(dataPath, patch) {
    const body = patch && typeof patch === "object" ? patch : {};
    const raw = readRawConfig(dataPath);
    const now = new Date().toISOString();

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
        keys: readKeyEntries(raw).map(function (entry) {
            return {
                id: entry.id,
                enc: entry.enc,
                hint: entry.hint || keyHint(decryptKey(entry.enc)),
                addedAt: entry.addedAt
            };
        }),
        savedAt: now
    };

    if (body.clearKeys === true || body.clearKey === true) {
        next.keys = [];
    }

    if (typeof body.removeKeyId === "string" && body.removeKeyId !== "") {
        next.keys = next.keys.filter(function (entry) {
            return entry.id !== body.removeKeyId;
        });
    }

    // apiKey = ชื่อเดิมของ addKey (รับไว้ให้หน้าจอรุ่นก่อนยังใช้ได้)
    const newKey = typeof body.addKey === "string"
        ? body.addKey.trim()
        : (typeof body.apiKey === "string" ? body.apiKey.trim() : "");

    if (newKey !== "") {
        const exists = next.keys.some(function (entry) {
            return decryptKey(entry.enc) === newKey;
        });

        if (!exists) {
            next.keys.push({
                id: "key-" + crypto.randomUUID(),
                enc: encryptKey(newKey),
                hint: keyHint(newKey),
                addedAt: now
            });
        }
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

// สถานะที่ควรลอง key ถัดไป (ปัญหาของ key นั้น ไม่ใช่ของคำขอ)
const ROTATE_STATUSES = new Set([401, 403, 429, 500, 502, 503, 504]);

function isRotatableFailure(result) {
    return ROTATE_STATUSES.has(Number(result && result.status));
}

function markKeyFailure(key, result) {
    const status = Number(result && result.status);

    // key ผิด/ถูกระงับ → ไม่ใช้เลยในรอบนี้
    if (status === 401 || status === 403) {
        keyState.invalid.add(key.id);
        keyState.cooldown.delete(key.id);
        return;
    }

    const failures = (keyState.failures.get(key.id) || 0) + 1;
    keyState.failures.set(key.id, failures);

    // โควตาหมด: พักนานขึ้นทุกครั้ง (1 → 2 → 4 ... นาที)
    const duration = status === 429
        ? Math.min(
            KEY_COOLDOWN_MAX_MS,
            KEY_COOLDOWN_BASE_MS * Math.pow(2, failures - 1)
        )
        : KEY_SERVER_COOLDOWN_MS;

    keyState.cooldown.set(key.id, Date.now() + duration);
}

function markKeySuccess(key) {
    keyState.invalid.delete(key.id);
    keyState.cooldown.delete(key.id);
    keyState.failures.delete(key.id);
    keyState.activeId = key.id;
}

// key ที่พร้อมใช้ — ถ้าทุกอันติด cooldown ให้ลองอันที่หมดพักก่อน
function usableKeys(keys) {
    const now = Date.now();

    const ready = keys.filter(function (key) {
        return (
            !keyState.invalid.has(key.id) &&
            (keyState.cooldown.get(key.id) || 0) <= now
        );
    });

    if (ready.length > 0) {
        // ใช้ key ที่เพิ่งสำเร็จเป็นอันแรก — ลดการสลับ key โดยไม่จำเป็น
        const activeId = keyState.activeId;

        return ready.slice().sort(function (a, b) {
            if (a.id === activeId) return -1;
            if (b.id === activeId) return 1;
            return 0;
        });
    }

    const fallback = keys.filter(function (key) {
        return !keyState.invalid.has(key.id);
    });

    if (fallback.length === 0) return [];

    return [fallback.slice().sort(function (a, b) {
        return (keyState.cooldown.get(a.id) || 0) -
            (keyState.cooldown.get(b.id) || 0);
    })[0]];
}

/**
 * เรียก Gemini โดยหมุน API key ให้อัตโนมัติ
 *
 * ใช้ key แรกที่พร้อมจนกว่าจะเจอปัญหา:
 *   429 (โควตาหมด) / 401-403 (key ใช้ไม่ได้) / 5xx → พัก key นั้น แล้วลองอันถัดไป
 *   400/404 (คำขอ/โมเดลผิด) → คืน error ทันที (เปลี่ยน key ก็ไม่ช่วย)
 *
 * @param {Object} config { apiKeys: [{id, value, hint}], model }
 * @param {Object} body เนื้อคำขอ
 * @returns {Promise<{ok:boolean, text?:string, usage?:Object, error?:string,
 *                    status?:number, keyId?:string, keyHint?:string}>}
 */
async function callGemini(config, body) {
    const keys = Array.isArray(config && config.apiKeys)
        ? config.apiKeys.filter(function (key) {
            return key && String(key.value || "").trim() !== "";
        })
        : [];

    if (keys.length === 0) {
        return { ok: false, error: "ยังไม่ได้ใส่ API key" };
    }

    const candidates = usableKeys(keys);

    if (candidates.length === 0) {
        return {
            ok: false,
            error: "API key ทุกอันถูกระงับชั่วคราว — รอสักครู่แล้วลองใหม่"
        };
    }

    let lastError = null;

    for (const key of candidates) {
        const result = await requestGemini(
            config,
            String(key.value).trim(),
            body
        );

        if (result.ok) {
            markKeySuccess(key);

            return Object.assign({}, result, {
                keyId: key.id,
                keyHint: key.hint || keyHint(key.value)
            });
        }

        if (!isRotatableFailure(result)) {
            return result;
        }

        markKeyFailure(key, result);
        lastError = result;

        console.warn(
            "Gemini key " + (key.hint || key.id) + " ใช้ไม่ได้:",
            result.error
        );
    }

    return {
        ok: false,
        status: lastError ? lastError.status : undefined,
        error: (candidates.length > 1
            ? "API key ทั้ง " + candidates.length + " อันใช้ไม่ได้ — "
            : "") + ((lastError && lastError.error) ||
                "เรียก Gemini ไม่สำเร็จ")
    };
}

/**
 * ยิงคำขอหนึ่งครั้งด้วย key หนึ่งอัน
 * @param {Object} config { model }
 * @param {string} keyValue
 * @param {Object} body เนื้อคำขอ (contents/systemInstruction/generationConfig)
 * @returns {Promise<{ok:boolean, text?:string, usage?:Object, error?:string, status?:number}>}
 */
async function requestGemini(config, keyValue, body) {
    const key = String(keyValue || "").trim();

    if (key === "") {
        return { ok: false, error: "ยังไม่ได้ใส่ API key" };
    }

    const model = String((config && config.model) || DEFAULT_MODEL).trim() ||
        DEFAULT_MODEL;

    const url = API_BASE + encodeURIComponent(model) + ":generateContent";

    // คำขอเดียวต่อ key — ถ้าโดนจำกัดโควตาหรือเซิร์ฟเวอร์สะดุด
    // callGemini จะพัก key นี้แล้วลองอันถัดไปเอง
    for (let attempt = 0; attempt < 1; attempt++) {
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
        },
        structured: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    title: { type: "STRING" },
                    value: { type: "STRING" }
                },
                required: ["title", "value"],
                propertyOrdering: ["title", "value"]
            }
        }
    },
    required: ["lines"],
    propertyOrdering: ["lines", "structured"]
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

    // ทุกครั้งที่เรียก AI จะแก้คำผิดและจัด "หัวข้อ: ค่า" ให้เองเสมอ
    // (หน้าเกินเพดานบรรทัดจะยิงหลายรอบ แล้วรวมผลมาจัดเรียงต่อกัน)
    const corrected = [];
    const structured = [];
    const structuredSeen = new Set();
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
                parts: [
                    {
                        text:
                            (config.prompt || DEFAULT_PROMPT) +
                            "\n" +
                            STRUCTURE_INSTRUCTION
                    }
                ]
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
                                "โดยมีครบทุกลำดับ id" +
                                ' และ structured:[{"title":"หัวข้อ","value":"ค่า"}] ' +
                                "เฉพาะคู่หัวข้อ:ค่าที่เห็นในภาพ"
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

        {
            const list = parsed && Array.isArray(parsed.structured) ? parsed.structured : [];

            list.forEach(function (item) {
                const title = String((item && item.title) || "").replace(/[\r\n]+/g, " ").trim();
                const value = String((item && item.value) || "").replace(/[\r\n]+/g, " ").trim();

                if (title === "" || value === "") return;

                // หลายรอบ/หลาย chunk อาจส่งคู่เดิมซ้ำ — เก็บครั้งเดียว
                const signature = title + "\u0000" + value;

                if (structuredSeen.has(signature)) return;

                structuredSeen.add(signature);
                structured.push({ title: title, value: value });
            });
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

    return {
        ok: true,
        lines: corrected,
        structured: structured,
        usage: usage
    };
}

/**
 * ทดสอบว่า key/โมเดลใช้ได้จริง (คำขอย่อย ไม่ส่งภาพ)
 * @param {Object} config { apiKey, model }
 * @returns {Promise<{ok:boolean, model?:string, message?:string}>}
 */
async function testConnection(config) {
    const keys = Array.isArray(config && config.apiKeys)
        ? config.apiKeys.filter(function (key) {
            return key && String(key.value || "").trim() !== "";
        })
        : [];

    if (keys.length === 0) {
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
        message: String(result.text || "").trim().slice(0, 40),
        keyHint: result.keyHint || "",
        keyCount: keys.length
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

// จำนวนคำสูงสุดต่อบรรทัดที่ยังจับคู่ด้วย LCS (กันตารางใหญ่เกินจำเป็น)
const MAX_ALIGN_TOKENS = 200;

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
// คำที่เป็นตัวเลขสั้น (<= 4 หลัก) ห้ามเรียนเป็นคู่คำ
// เพราะ applyTextFixes แทนคำตรงตัว -> เลข "1" ในเอกสารทุกหน้าจะกลายเป็นคำอื่น
function isShortNumber(value) {
    const compact = String(value || "").replace(/[\s,.\-\/]/g, "");
    return /^\d{1,4}$/.test(compact);
}

// คำที่มีแต่ตัวเลข/เครื่องหมาย (วันที่ รหัสบัญชี จำนวนเงิน)
const NUMBER_LIKE = /^[\d\s,.\-\/:]+$/;

// ตรวจว่าคู่นี้ปลอดภัยพอจะจำไปใช้แทนคำตรงตัวหรือไม่
function isSafeLearnedPair(wrong, right, trusted) {
    if (!wrong || !right) return false;
    if (wrong === right) return false;
    if (wrong.length > MAX_LEARNED_WORD) return false;
    if (right.length > MAX_LEARNED_WORD) return false;

    // ตัวอักษรเหมือนกันแต่ลำดับ/ช่องว่างต่าง = ไม่ใช่คำที่อ่านผิด
    if (wrong.replace(/\s/g, "") === right.replace(/\s/g, "")) return false;

    // ตัวเลขสั้นห้ามเรียนเด็ดขาด (ต้นเหตุเอกสารเพี้ยนทั้งฉบับ)
    if (isShortNumber(wrong) || isShortNumber(right)) return false;

    if (right === "") return false;

    // แทนด้วยจุด/เครื่องหมายยาว ๆ = ขยะ ไม่ใช่การแก้คำ
    // (คู่สั้น ๆ อย่าง "we" -> "(-)" ยังใช้ได้)
    if (!/[0-9A-Za-z\u0E00-\u0E7F]/.test(right) && right.length >= 6) return false;

    // อักขระเดียวห้ามกลายเป็นคำยาว — เคยทำให้ "ล" ถูกแทนด้วยชื่อหน่วยงาน
    // ทั้งวลีทุกจุดในเอกสาร (1:1 ยังใช้ได้ เช่น ล <-> ส)
    const shortSide = Math.min(wrong.length, right.length);
    const longSide = Math.max(wrong.length, right.length);

    if (shortSide === 1 && longSide > 1) return false;

    // ยาวขึ้น/สั้นลงหลายเท่า = ไม่ใช่การอ่านผิด
    if (longSide >= shortSide * 3 && longSide - shortSide >= 4) return false;

    const wrongNumber = NUMBER_LIKE.test(wrong);
    const rightNumber = NUMBER_LIKE.test(right);

    // ถ้าฝั่งหนึ่งเป็นตัวเลข อีกฝั่งต้องเป็นตัวเลข และแก้ได้แค่หลักเดียว
    // (กันการจำว่าเลขหนึ่งกลายเป็นเลขอีกตัว -> ไปเปลี่ยนเลขที่เอกสารอื่น)
    if (wrongNumber || rightNumber) {
        if (!wrongNumber || !rightNumber) return false;

        const a = wrong.replace(/\D/g, "");
        const b = right.replace(/\D/g, "");

        if (a.length < 5 || a.length !== b.length) return false;
        if (a === b) return false;

        return editDistance(a, b, 1) === 1;
    }

    // คำที่ tesseract มั่นใจสูงมักถูกอยู่แล้ว — ถ้า AI ไปเขียนใหม่ทั้งคำ
    // แล้วเราจำไว้ ความผิดพลาดจะถูกใช้ซ้ำตอน AI ปิด
    // จึงยอมจำเฉพาะคำที่ "แก้นิดเดียว" (เช่น เติมไม้โท/สระที่หาย)
    if (trusted && editDistance(wrong, right, MINOR_EDIT_LIMIT) > MINOR_EDIT_LIMIT) {
        return false;
    }

    return true;
}

// เรียงคำสองฝั่งด้วย LCS แล้วจับคู่เฉพาะช่วงที่ "ลบ n คำ + เพิ่ม n คำ" ติดกัน
// ทำให้ AI ที่สลับคำ (ชื่อ/ตำแหน่ง) ไม่ถูกจำว่าเป็นคู่คำผิด
function alignTokens(before, after) {
    const n = before.length;
    const m = after.length;
    const table = [];

    for (let row = 0; row <= n; row++) {
        table.push(new Array(m + 1).fill(0));
    }

    for (let row = n - 1; row >= 0; row--) {
        for (let column = m - 1; column >= 0; column--) {
            table[row][column] =
                before[row] === after[column]
                    ? table[row + 1][column + 1] + 1
                    : Math.max(table[row + 1][column], table[row][column + 1]);
        }
    }

    const ops = [];
    let row = 0;
    let column = 0;

    while (row < n && column < m) {
        if (before[row] === after[column]) {
            ops.push({ type: "same" });
            row++;
            column++;
        } else if (table[row + 1][column] >= table[row][column + 1]) {
            ops.push({ type: "del", value: before[row] });
            row++;
        } else {
            ops.push({ type: "ins", value: after[column] });
            column++;
        }
    }

    while (row < n) ops.push({ type: "del", value: before[row++] });
    while (column < m) ops.push({ type: "ins", value: after[column++] });

    const pairs = [];

    for (let index = 0; index < ops.length; ) {
        if (ops[index].type === "same") {
            index++;
            continue;
        }

        const removed = [];
        const added = [];

        while (index < ops.length && ops[index].type !== "same") {
            if (ops[index].type === "del") {
                removed.push(ops[index].value);
            } else {
                added.push(ops[index].value);
            }

            index++;
        }

        if (removed.length > 0 && removed.length === added.length) {
            for (let step = 0; step < removed.length; step++) {
                pairs.push([removed[step], added[step]]);
            }
        }
    }

    return pairs;
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

        if (before.length === 0 || after.length === 0) return;
        if (before.length > MAX_ALIGN_TOKENS || after.length > MAX_ALIGN_TOKENS) return;

        const confidence = Number(pair.confidence);
        const trusted = Number.isFinite(confidence) && confidence >= 70;

        alignTokens(before, after).forEach(function (matched) {
            const wrong = matched[0];
            const right = matched[1];

            if (!isSafeLearnedPair(wrong, right, trusted)) return;

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
        });
    });

    const fixes = Object.keys(found)
        .map(function (key) {
            return found[key];
        })
        .filter(function (fix) {
            return !fix.conflict;
        });

    // ตัดคู่ย้อนกลับ A->B + B->A ทิ้งทั้งคู่ (จะทำให้แทนคำวนกันเอง)
    const byWrong = {};

    fixes.forEach(function (fix) {
        byWrong[fix.wrong] = fix;
    });

    return fixes.filter(function (fix) {
        const reverse = byWrong[fix.right];

        return !(reverse && reverse.right === fix.wrong);
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
    alignTokens: alignTokens,
    isSafeLearnedPair: isSafeLearnedPair,
    isShortNumber: isShortNumber,
    tokenize: tokenize,
    editDistance: editDistance,
    // ใช้ในเทสต์ ไม่ต้องยิงเน็ต
    parseJsonAnswer: parseJsonAnswer,
    inlineImagePart: inlineImagePart
};
