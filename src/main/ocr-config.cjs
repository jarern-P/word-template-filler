// ค่าตั้ง OCR (เก็บที่ data/ocr-config.json)
//
// ทำไมเก็บเป็นไฟล์ ไม่เก็บในฐานข้อมูล:
//   - ค่าตั้งนี้เป็นของ "เครื่องนี้" ไม่ใช่ข้อมูลของแม่แบบ
//   - ไฟล์สำรองฐานข้อมูล (.db) จึงไม่พา API key ติดไปเครื่องอื่น
//
// โครงสร้าง (เวอร์ชัน 2):
//   {
//     "version": 2,
//     "provider": "paddle",          // paddle | paddleVL | gemini | iloveapi
//     "enabled": true,               // ใช้ OCR เมื่ออัปโหลด PDF
//     "mode": "auto",                // auto = เฉพาะหน้าที่ไม่มีข้อความ
//                                    // always = ทุกหน้า
//     "twoStage": false,             // ตัวเลือกย่อยของ PaddleOCR:
//                                    // true = Two-Stage Localized OCR
//     "improve": {
//       "prompt": ""                 // prompt ของปุ่ม "ปรับปรุง" (ว่าง = ค่าเริ่มต้น)
//     },
//     "gemini": {
//       "model": "gemini-2.5-flash",
//       "apiKey": "enc:..."          // เข้ารหัสด้วย safeStorage (DPAPI) เมื่อทำได้
//     },
//     "iloveapi": {
//       "apiKey": "enc:..."
//     }
//   }
//
// API key ไม่ถูกส่งกลับไปฝั่งหน้าจอ — read() คืนเฉพาะ hasKey (มี key เก็บไว้แล้ว)
// ส่วน readSecrets() ใช้ฝั่ง main ตอนเรียกผู้ให้บริการเท่านั้น
'use strict';

const fs = require('fs');
const path = require('path');

const improve = require('./ocr-improve.cjs');

const CONFIG_FILE = 'ocr-config.json';

const PROVIDERS = ['paddle', 'paddleVL', 'gemini', 'iloveapi'];
const MODES = ['auto', 'always'];

const DEFAULT_MODEL = 'gemini-2.5-flash';

// ความยาวสูงสุดของ prompt ที่แก้เองในหน้า ตั้งค่า OCR
const MAX_PROMPT_LENGTH = 8000;

// อนุญาตเฉพาะชื่อโมเดลที่ใช้ใน URL ได้ (กันการพิมพ์ผิด/แทรก path)
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function defaultConfig() {
    return {
        version: 2,
        provider: 'paddle',
        enabled: true,
        mode: 'auto',
        twoStage: false,
        improve: {
            prompt: ''
        },
        gemini: {
            apiKey: '',
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

// แปลงค่าจากไฟล์ (รวมเวอร์ชัน 1 เดิม) เป็นโครงปัจจุบัน
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
        version: 2,
        provider: pick(source.provider, PROVIDERS, 'paddle'),
        enabled: enabled,
        mode: mode,
        twoStage: source.twoStage === true,
        improve: {
            prompt: sanitizePrompt(improveInput.prompt)
        },
        gemini: {
            apiKey: typeof gemini.apiKey === 'string' ? gemini.apiKey : '',
            model: sanitizeModel(gemini.model)
        },
        iloveapi: {
            apiKey: typeof iloveapi.apiKey === 'string' ? iloveapi.apiKey : ''
        }
    };
}

// ค่าที่ส่งให้หน้าจอ — ไม่มี key จริง มีแค่ hasKey
function toPublic(raw) {
    return {
        version: 2,
        provider: raw.provider,
        enabled: raw.enabled,
        mode: raw.mode,
        twoStage: raw.twoStage,
        improve: {
            prompt: raw.improve.prompt,
            // prompt เริ่มต้นมาพร้อมกัน เพื่อให้หน้าจอแสดง/แก้ไขได้
            defaultPrompt: improve.DEFAULT_PROMPT
        },
        gemini: {
            apiKey: '',
            model: raw.gemini.model,
            // ถอดรหัสไม่ได้ (เช่น ย้ายไฟล์ข้ามเครื่อง) = ถือว่ายังไม่มี key
            hasKey: decryptKey(raw.gemini.apiKey) !== ''
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

    return {
        version: 2,
        provider: raw.provider,
        enabled: raw.enabled,
        mode: raw.mode,
        twoStage: raw.twoStage,
        improve: {
            prompt: raw.improve.prompt
        },
        gemini: {
            apiKey: decryptKey(raw.gemini.apiKey),
            model: raw.gemini.model
        },
        iloveapi: {
            apiKey: decryptKey(raw.iloveapi.apiKey)
        }
    };
}

// เขียนค่าตั้งแบบ atomic: เขียนไฟล์ชั่วคราวแล้ว rename ทับ
//
// payload.gemini.apiKey / payload.iloveapi.apiKey:
//   - มีข้อความ = ตั้ง key ใหม่ (เข้ารหัสก่อนเก็บ)
//   - ว่าง/ไม่ส่ง = ใช้ key เดิมที่เก็บไว้
//   - payload.<provider>.clearKey = true = ลบ key เดิม
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

    const geminiKey = geminiInput.clearKey === true
        ? ''
        : (String(geminiInput.apiKey || '').trim() !== ''
            ? encryptKey(geminiInput.apiKey)
            : current.gemini.apiKey);

    const iloveKey = iloveInput.clearKey === true
        ? ''
        : (String(iloveInput.apiKey || '').trim() !== ''
            ? encryptKey(iloveInput.apiKey)
            : current.iloveapi.apiKey);

    const saved = {
        version: 2,
        provider: pick(input.provider, PROVIDERS, current.provider),
        enabled: typeof input.enabled === 'boolean'
            ? input.enabled
            : current.enabled,
        mode: pick(input.mode, MODES, current.mode),
        twoStage: typeof input.twoStage === 'boolean'
            ? input.twoStage
            : current.twoStage,
        improve: {
            prompt: improveInput.prompt === undefined
                ? current.improve.prompt
                : sanitizePrompt(improveInput.prompt)
        },
        gemini: {
            apiKey: geminiKey,
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

    fs.mkdirSync(dataPath, { recursive: true });

    const file = configPath(dataPath);
    const temp = file + '.tmp';

    fs.writeFileSync(temp, JSON.stringify(saved, null, 2), 'utf8');
    fs.renameSync(temp, file);

    return toPublic(saved);
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
    sanitizeModel,
    sanitizePrompt
};
