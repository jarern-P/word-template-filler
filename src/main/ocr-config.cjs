// ค่าตั้ง OCR (เก็บที่ data/ocr-config.json)
//
// ทำไมเก็บเป็นไฟล์ ไม่เก็บในฐานข้อมูล:
//   - ค่าตั้งนี้เป็นของ "เครื่องนี้" ไม่ใช่ข้อมูลของแม่แบบ
//   - ไฟล์สำรองฐานข้อมูล (.db) จึงไม่พา API key ติดไปเครื่องอื่น
//
// โครงสร้าง (เวอร์ชัน 3):
//   {
//     "version": 3,
//     "provider": "paddle",          // paddle | paddleVL | gemini | iloveapi
//     "enabled": true,               // ใช้ OCR เมื่ออัปโหลด PDF
//     "mode": "auto",                // auto = เฉพาะหน้าที่ไม่มีข้อความ
//                                    // always = ทุกหน้า
//     "twoStage": false,             // ตัวเลือกย่อยของ PaddleOCR:
//                                    // true = Two-Stage Localized OCR
//     "improve": {
//       "engine": "ai",             // ai = Gemini | difflib = แก้คำในเครื่อง
//       "prompt": ""                 // prompt ของปุ่ม "ปรับปรุง" (ว่าง = ค่าเริ่มต้น)
//     },
//     "gemini": {
//       "model": "gemini-2.5-flash",
//       "keys": [                    // ใช้เรียงตามลำดับ — key แรกขัดข้องจึงลอง key ถัดไป
//         {
//           "id": "k...",
//           "apiKey": "enc:...",     // เข้ารหัสด้วย safeStorage (DPAPI) เมื่อทำได้
//           "usage": {               // token ที่ใช้ไป (สะสม + รอบล่าสุด)
//             "inputTotal": 0,
//             "outputTotal": 0,
//             "inputLast": 0,
//             "outputLast": 0,
//             "requests": 0,
//             "updatedAt": ""
//           }
//         }
//       ]
//     },
//     "iloveapi": {
//       "apiKey": "enc:..."
//     }
//   }
//
// ไฟล์เวอร์ชันเก่าที่เก็บ gemini.apiKey เดียว ยังอ่านได้ (ย้ายเข้า keys ให้อัตโนมัติ)
// API key ไม่ถูกส่งกลับไปฝั่งหน้าจอ — read() คืนเฉพาะ hasKey (มี key เก็บไว้แล้ว)
// ส่วน readSecrets() ใช้ฝั่ง main ตอนเรียกผู้ให้บริการเท่านั้น
'use strict';

const fs = require('fs');
const path = require('path');

const improve = require('./ocr-improve.cjs');

const CONFIG_FILE = 'ocr-config.json';

const PROVIDERS = ['paddle', 'paddleVL', 'gemini', 'iloveapi'];
const MODES = ['auto', 'always'];

// วิธีปรับปรุงข้อความ (ปุ่ม "ปรับปรุง")
// ai = ส่งให้ Gemini | difflib = เทียบคำกับข้อมูลหลัก/คลังคำ/พจนานุกรมในเครื่อง
const IMPROVE_ENGINES = ['ai', 'difflib'];

const DEFAULT_MODEL = 'gemini-2.5-flash';

// ความยาวสูงสุดของ prompt ที่แก้เองในหน้า ตั้งค่า OCR
const MAX_PROMPT_LENGTH = 8000;

// อนุญาตเฉพาะชื่อโมเดลที่ใช้ใน URL ได้ (กันการพิมพ์ผิด/แทรก path)
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function defaultUsage() {
    return {
        inputTotal: 0,
        outputTotal: 0,
        inputLast: 0,
        outputLast: 0,
        requests: 0,
        updatedAt: ''
    };
}

function toTokenCount(value) {
    const number = Math.floor(Number(value));

    return isFinite(number) && number > 0 ? number : 0;
}

// ทำความสะอาดสถิติ token ที่อ่านจากไฟล์ (ค่าผิดรูป = 0)
function normalizeUsage(value) {
    const source = value && typeof value === 'object' ? value : {};

    return {
        inputTotal: toTokenCount(source.inputTotal),
        outputTotal: toTokenCount(source.outputTotal),
        inputLast: toTokenCount(source.inputLast),
        outputLast: toTokenCount(source.outputLast),
        requests: toTokenCount(source.requests),
        updatedAt:
            typeof source.updatedAt === 'string' ? source.updatedAt : ''
    };
}

// id ของ key ใช้ผูกสถิติ token — สร้างครั้งเดียวแล้วเก็บลงไฟล์
function makeKeyId() {
    return 'k' + Date.now().toString(36) +
        Math.random().toString(36).slice(2, 8);
}

function defaultConfig() {
    return {
        version: 3,
        provider: 'paddle',
        enabled: true,
        mode: 'auto',
        twoStage: false,
        improve: {
            engine: 'ai',
            prompt: ''
        },
        gemini: {
            keys: [],
            model: DEFAULT_MODEL
        },
        iloveapi: {
            apiKey: ''
        }
    };
}

function pick(value, allowed, fallback) {
    return allowed.indexOf(value) === -1 ? fallback : value;
}

function sanitizeModel(value) {
    const model = String(value == null ? '' : value).trim();

    return MODEL_PATTERN.test(model) ? model : DEFAULT_MODEL;
}

// prompt ที่แก้เอง: เก็บเป็นข้อความหลายบรรทัดได้ (ว่าง = ใช้ค่าเริ่มต้น)
function sanitizePrompt(value) {
    const text = String(value == null ? '' : value)
        .replace(/\r\n?/g, '\n')
        // ตัดช่องว่างท้ายบรรทัด (มองไม่เห็น) แต่คงการย่อหน้าไว้ตามที่พิมพ์
        .split('\n')
        .map(function (line) {
            return line.replace(/[ \t]+$/, '');
        })
        .join('\n')
        .trim();

    return text.length > MAX_PROMPT_LENGTH
        ? text.slice(0, MAX_PROMPT_LENGTH).trim()
        : text;
}

// ------------------------------------------------------------------
// เข้ารหัส/ถอดรหัส API key
// ------------------------------------------------------------------

function keyCipher() {
    try {
        const { safeStorage } = require('electron');

        if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
            return null;
        }

        return safeStorage;

    } catch (error) {
        // รันด้วย Node ธรรมดา (เทสต์) ไม่มี safeStorage
        return null;
    }
}

function encryptKey(plain) {
    const value = String(plain == null ? '' : plain).trim();

    if (value === '') return '';

    const cipher = keyCipher();

    if (cipher) {
        return 'enc:' + cipher.encryptString(value).toString('base64');
    }

    return 'plain:' + Buffer.from(value, 'utf8').toString('base64');
}

function decryptKey(stored) {
    const value = String(stored == null ? '' : stored);

    if (value === '') return '';

    try {
        if (value.startsWith('enc:')) {
            const cipher = keyCipher();

            if (!cipher) return '';

            return cipher.decryptString(
                Buffer.from(value.slice(4), 'base64')
            );
        }

        if (value.startsWith('plain:')) {
            return Buffer.from(value.slice(6), 'base64').toString('utf8');
        }

    } catch (error) {
        return '';
    }

    return '';
}

// ------------------------------------------------------------------
// อ่าน/เขียนไฟล์
// ------------------------------------------------------------------

function configPath(dataPath) {
    return path.join(dataPath, CONFIG_FILE);
}

function loadRaw(dataPath) {
    try {
        const parsed = JSON.parse(
            fs.readFileSync(configPath(dataPath), 'utf8')
        );

        return parsed && typeof parsed === 'object' ? parsed : {};

    } catch (error) {
        return {};
    }
}

// เขียนค่าตั้งแบบ atomic: เขียนไฟล์ชั่วคราวแล้ว rename ทับ
function writeRaw(dataPath, config) {
    fs.mkdirSync(dataPath, { recursive: true });

    const file = configPath(dataPath);
    const temp = file + '.tmp';

    fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(temp, file);
}

// รายการ key ของ Gemini จากค่าที่อ่านในไฟล์
// - keys = โครงใหม่ (หลาย key)
// - apiKey = โครงเก่า (key เดียว) — ย้ายเข้า keys ให้อัตโนมัติ
function normalizeKeys(gemini) {
    const source = gemini && typeof gemini === 'object' ? gemini : {};

    const hasKeys = Array.isArray(source.keys);

    const legacy =
        typeof source.apiKey === 'string' && source.apiKey !== ''
            ? [{
                id: 'k1',
                apiKey: source.apiKey,
                usage: defaultUsage()
            }]
            : [];

    const list = hasKeys ? source.keys : legacy;

    return list
        .map(function (item, index) {
            const key = item && typeof item === 'object' ? item : {};

            return {
                // ไม่มี id ในไฟล์เก่า = ใช้ลำดับเป็น id ชั่วคราว
                id: String(key.id || ('k' + (index + 1))),
                apiKey: typeof key.apiKey === 'string' ? key.apiKey : '',
                usage: normalizeUsage(key.usage)
            };
        })
        .filter(function (key) {
            return key.apiKey !== '';
        });
}

// แปลงค่าจากไฟล์ (รวมเวอร์ชัน 1/2 เดิม) เป็นโครงปัจจุบัน
// ไม่ถอดรหัส key — คงค่าที่เก็บไว้ตามเดิม
function normalizeRaw(input) {
    const source = input && typeof input === 'object' ? input : {};
    const paddle = source.paddle && typeof source.paddle === 'object'
        ? source.paddle
        : {};
    const gemini = source.gemini && typeof source.gemini === 'object'
        ? source.gemini
        : {};
    const iloveapi = source.iloveapi && typeof source.iloveapi === 'object'
        ? source.iloveapi
        : {};
    const improveInput = source.improve && typeof source.improve === 'object'
        ? source.improve
        : {};

    // เวอร์ชัน 1 เก็บ enabled/mode ไว้ใต้ paddle — อ่านเป็นค่าเริ่มต้นให้
    const enabled = typeof source.enabled === 'boolean'
        ? source.enabled
        : (typeof paddle.enabled === 'boolean' ? paddle.enabled : true);

    const mode = pick(
        source.mode || paddle.mode,
        MODES,
        'auto'
    );

    return {
        version: 3,
        provider: pick(source.provider, PROVIDERS, 'paddle'),
        enabled: enabled,
        mode: mode,
        twoStage: source.twoStage === true,
        improve: {
            engine: pick(improveInput.engine, IMPROVE_ENGINES, 'ai'),
            prompt: sanitizePrompt(improveInput.prompt)
        },
        gemini: {
            keys: normalizeKeys(gemini),
            model: sanitizeModel(gemini.model)
        },
        iloveapi: {
            apiKey: typeof iloveapi.apiKey === 'string' ? iloveapi.apiKey : ''
        }
    };
}

// ค่าที่ส่งให้หน้าจอ — ไม่มี key จริง มีแค่ hasKey + สถิติ token ของแต่ละ key
function toPublic(raw) {
    const keys = raw.gemini.keys.map(function (key) {
        return {
            id: key.id,
            hasKey: decryptKey(key.apiKey) !== '',
            usage: normalizeUsage(key.usage)
        };
    });

    return {
        version: 3,
        provider: raw.provider,
        enabled: raw.enabled,
        mode: raw.mode,
        twoStage: raw.twoStage,
        improve: {
            engine: raw.improve.engine,
            prompt: raw.improve.prompt,
            // prompt เริ่มต้นมาพร้อมกัน เพื่อให้หน้าจอแสดง/แก้ไขได้
            defaultPrompt: improve.DEFAULT_PROMPT
        },
        gemini: {
            apiKey: '',
            model: raw.gemini.model,
            // ถอดรหัสไม่ได้ (เช่น ย้ายไฟล์ข้ามเครื่อง) = ถือว่ายังไม่มี key
            hasKey: keys.some(function (key) {
                return key.hasKey;
            }),
            // หลาย key — เรียงตามลำดับที่ใช้ (key แรกก่อน)
            keys: keys
        },
        iloveapi: {
            apiKey: '',
            hasKey: decryptKey(raw.iloveapi.apiKey) !== ''
        }
    };
}

// อ่านสำหรับหน้าจอ
function read(dataPath) {
    return toPublic(normalizeRaw(loadRaw(dataPath)));
}

// อ่านพร้อม key จริง (ใช้ใน main process ตอนเรียกผู้ให้บริการเท่านั้น)
function readSecrets(dataPath) {
    const raw = normalizeRaw(loadRaw(dataPath));

    const apiKeys = raw.gemini.keys
        .map(function (key) {
            return {
                id: key.id,
                apiKey: decryptKey(key.apiKey)
            };
        })
        .filter(function (key) {
            return key.apiKey !== '';
        });

    return {
        version: 3,
        provider: raw.provider,
        enabled: raw.enabled,
        mode: raw.mode,
        twoStage: raw.twoStage,
        improve: {
            engine: raw.improve.engine,
            prompt: raw.improve.prompt
        },
        gemini: {
            // apiKey เดียว = key แรก (เก็บไว้ให้โค้ดเดิมใช้ได้)
            apiKey: apiKeys.length > 0 ? apiKeys[0].apiKey : '',
            // รายการ key ตามลำดับที่ใช้
            apiKeys: apiKeys,
            model: raw.gemini.model
        },
        iloveapi: {
            apiKey: decryptKey(raw.iloveapi.apiKey)
        }
    };
}

// รวมรายการ key ที่หน้าจอส่งมากับ key/สถิติเดิมในไฟล์
//
// payload.gemini.keys[i] = { id, apiKey }
//   - id ว่าง + apiKey ว่าง = ช่องว่าง (ข้าม)
//   - พิมพ์ apiKey ใหม่ = ใช้ key นี้ และเริ่มนับ token ใหม่
//   - เว้น apiKey ว่าง + มี id = ใช้ key เดิมและสถิติเดิม
function resolveKeys(geminiInput, current) {
    // ลบ key ทั้งหมด
    if (geminiInput.clearKey === true) {
        return [];
    }

    const inputKeys = Array.isArray(geminiInput.keys)
        ? geminiInput.keys
        : null;

    if (inputKeys) {
        const currentById = {};

        current.gemini.keys.forEach(function (key) {
            currentById[key.id] = key;
        });

        const keys = [];

        inputKeys.forEach(function (item) {
            const row = item && typeof item === 'object' ? item : {};
            const plain = String(row.apiKey || '').trim();
            const id = String(row.id || '').trim();

            // พิมพ์ key ใหม่ = ใช้ key นี้ และเริ่มนับ token ใหม่
            if (plain !== '') {
                keys.push({
                    id: id || makeKeyId(),
                    apiKey: encryptKey(plain),
                    usage: defaultUsage()
                });
                return;
            }

            // ช่องเดิม (เว้นว่าง) = ใช้ key และสถิติเดิม
            const existing = id ? currentById[id] : null;

            if (existing) {
                keys.push({
                    id: existing.id,
                    apiKey: existing.apiKey,
                    usage: normalizeUsage(existing.usage)
                });
            }
        });

        return keys;
    }

    // payload แบบเดิม: apiKey เดียว
    const plain = String(geminiInput.apiKey || '').trim();

    if (plain !== '') {
        return [{
            id: makeKeyId(),
            apiKey: encryptKey(plain),
            usage: defaultUsage()
        }];
    }

    return current.gemini.keys;
}

// เขียนค่าตั้ง
//
// payload.gemini.keys / payload.gemini.apiKey:
//   - keys = รายการ key จากหน้าจอ (ดู resolveKeys)
//   - apiKey = ตั้ง key เดียวแบบเดิม
//   - clearKey = true = ลบ key ทั้งหมด
function save(dataPath, payload) {
    const input = payload && typeof payload === 'object' ? payload : {};
    const current = normalizeRaw(loadRaw(dataPath));

    const geminiInput = input.gemini && typeof input.gemini === 'object'
        ? input.gemini
        : {};
    const iloveInput = input.iloveapi && typeof input.iloveapi === 'object'
        ? input.iloveapi
        : {};
    const improveInput = input.improve && typeof input.improve === 'object'
        ? input.improve
        : {};

    const iloveKey = iloveInput.clearKey === true
        ? ''
        : (String(iloveInput.apiKey || '').trim() !== ''
            ? encryptKey(iloveInput.apiKey)
            : current.iloveapi.apiKey);

    const saved = {
        version: 3,
        provider: pick(input.provider, PROVIDERS, current.provider),
        enabled: typeof input.enabled === 'boolean'
            ? input.enabled
            : current.enabled,
        mode: pick(input.mode, MODES, current.mode),
        twoStage: typeof input.twoStage === 'boolean'
            ? input.twoStage
            : current.twoStage,
        improve: {
            engine: improveInput.engine === undefined
                ? current.improve.engine
                : pick(improveInput.engine, IMPROVE_ENGINES, current.improve.engine),
            prompt: improveInput.prompt === undefined
                ? current.improve.prompt
                : sanitizePrompt(improveInput.prompt)
        },
        gemini: {
            keys: resolveKeys(geminiInput, current),
            model: sanitizeModel(
                geminiInput.model !== undefined
                    ? geminiInput.model
                    : current.gemini.model
            )
        },
        iloveapi: {
            apiKey: iloveKey
        }
    };

    writeRaw(dataPath, saved);

    return toPublic(saved);
}

// เพิ่มสถิติ token ของ key หนึ่ง (เรียกหลังเรียก Gemini สำเร็จ)
// - input/output = token ของรอบนี้
// - สะสมบวกเพิ่มเข้าค่าเดิม และเก็บรอบล่าสุดไว้ด้วย
function addGeminiUsage(dataPath, keyId, usage) {
    const id = String(keyId || '').trim();

    if (id === '') return false;

    const input = toTokenCount(usage && usage.input);
    const output = toTokenCount(usage && usage.output);

    if (input === 0 && output === 0) return false;

    const raw = normalizeRaw(loadRaw(dataPath));

    let found = false;

    raw.gemini.keys.forEach(function (key) {
        if (key.id !== id) return;

        found = true;

        key.usage = normalizeUsage({
            inputTotal: key.usage.inputTotal + input,
            outputTotal: key.usage.outputTotal + output,
            inputLast: input,
            outputLast: output,
            requests: key.usage.requests + 1,
            updatedAt: new Date().toISOString()
        });
    });

    if (!found) return false;

    writeRaw(dataPath, raw);

    return true;
}

module.exports = {
    CONFIG_FILE,
    PROVIDERS,
    MODES,
    DEFAULT_MODEL,
    MAX_PROMPT_LENGTH,
    read,
    readSecrets,
    save,
    addGeminiUsage,
    defaultUsage,
    normalizeUsage,
    sanitizeModel,
    sanitizePrompt
};
