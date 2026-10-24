// ค่าตั้ง OCR (เก็บที่ data/ocr-config.json)
//
// ทำไมเก็บเป็นไฟล์ ไม่เก็บในฐานข้อมูล:
//   - ค่าตั้งนี้เป็นของ "เครื่องนี้" ไม่ใช่ข้อมูลของแม่แบบ
//   - ไฟล์สำรองฐานข้อมูล (.db) จึงไม่พา API key / ค่าตั้ง OCR ติดไปเครื่องอื่น
//
// โครงสร้างปัจจุบัน (เวอร์ชัน 1):
//   {
//     "version": 1,
//     "provider": "paddle",              // ผู้ให้บริการที่ใช้: paddle | gemini | iloveapi
//     "paddle": {
//       "enabled": true,                 // เปิด OCR ตอนอัปโหลด PDF
//       "mode": "auto"                   // auto = เฉพาะหน้าที่ไม่มีชั้นข้อความ
//                                        // always = ทุกหน้า
//     }
//   }
//
// provider อื่นถูกออกแบบไว้ล่วงหน้า แต่ยังไม่เปิดใช้งาน (ดู ocrConfigPage.js)
// — เพิ่มค่าตั้งของเจ้านั้นในไฟล์นี้ได้โดยไม่กระทบของเดิม
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'ocr-config.json';

// เรียงตามที่แสดงในหน้า "ตั้งค่า OCR"
const PROVIDERS = ['paddle', 'gemini', 'iloveapi'];
const MODES = ['auto', 'always'];

const DEFAULT_CONFIG = {
    version: 1,
    provider: 'paddle',
    paddle: {
        enabled: true,
        mode: 'auto'
    }
};

function cloneDefault() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function pick(value, allowed, fallback) {
    return allowed.indexOf(value) === -1 ? fallback : value;
}

function normalize(input) {
    const source = input && typeof input === 'object' ? input : {};
    const paddle = source.paddle && typeof source.paddle === 'object'
        ? source.paddle
        : {};

    return {
        version: 1,
        provider: pick(source.provider, PROVIDERS, DEFAULT_CONFIG.provider),
        paddle: {
            // ค่าที่ไม่ใช่ boolean ถือว่ายังไม่ได้ตั้ง → ใช้ค่าเริ่มต้น (เปิด)
            enabled: typeof paddle.enabled === 'boolean'
                ? paddle.enabled
                : DEFAULT_CONFIG.paddle.enabled,
            mode: pick(paddle.mode, MODES, DEFAULT_CONFIG.paddle.mode)
        }
    };
}

function configPath(dataPath) {
    return path.join(dataPath, CONFIG_FILE);
}

// อ่านค่าตั้ง — ไฟล์ยังไม่มี/เสียหาย = ใช้ค่าเริ่มต้น (ไม่ทำให้แอปเปิดไม่ได้)
function read(dataPath) {
    try {
        const raw = fs.readFileSync(configPath(dataPath), 'utf8');

        return normalize(JSON.parse(raw));

    } catch (error) {
        return cloneDefault();
    }
}

// เขียนค่าตั้งแบบ atomic: เขียนไฟล์ชั่วคราวแล้ว rename ทับ
// (ไฟดับกลางคันจะไม่เหลือไฟล์ค่าตั้งที่เขียนค้างครึ่งเดียว)
function save(dataPath, payload) {
    const config = normalize(payload);
    const file = configPath(dataPath);

    fs.mkdirSync(dataPath, { recursive: true });

    const temp = file + '.tmp';

    fs.writeFileSync(temp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(temp, file);

    return config;
}

module.exports = {
    CONFIG_FILE,
    PROVIDERS,
    MODES,
    read,
    save,
    normalize
};
