// OCR ด้วย PaddleOCR-VL 0.9B (ทำงานในเครื่องทั้งหมด)
//
// ใช้ llama.cpp (llama-server) รันโมเดล GGUF ของ PaddleOCR-VL 1.6 (0.9B)
// ซึ่งเป็นโมเดล vision-language สำหรับอ่านเอกสาร — รองรับภาษาไทย
// ต่างจาก ocr-paddle.cjs ที่ใช้ PP-OCRv5 (ตรวจจับบรรทัด + อ่านทีละบรรทัด)
// โมเดลนี้รับ "ภาพทั้งแถบ" แล้วคืนข้อความที่อ่านได้
//
// ขั้นตอน:
//   1. ดาวน์โหลด llama-server (CPU build ~24 MB) + โมเดล (~1.8 GB) ครั้งแรก
//   2. เริ่ม llama-server บน 127.0.0.1 (พอร์ตว่าง) แล้วโหลดโมเดลไว้ในหน่วยความจำ
//   3. pdf.js วาดหน้าเป็น PNG → ตัดเป็นแถบแนวนอน → ส่งให้โมเดลอ่านทีละแถบ
//      (ตัดแถบเพราะโมเดลจำกัดขนาดภาพ ~1 ล้านพิกเซล ภาพทั้งหน้าจะถูกย่อจนตัวอักษรเล็ก)
//   4. รวมข้อความเป็นบรรทัด แล้วให้ pdf-text.cjs ใช้ต่อ
//
// ไม่มีข้อมูลออกจากเครื่องหลังดาวน์โหลดเสร็จ — ข้อความทั้งหมดประมวลผลในเครื่อง
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const { renderPageToPng } = require('./ocr-paddle.cjs');

// ความละเอียดที่ใช้วาดหน้า (~200 DPI)
// ต่ำกว่านี้ตัวอักษรไทยเล็ก ๆ จะอ่านผิด, สูงกว่านี้ช้าขึ้นโดยไม่คุ้ม
const VL_SCALE = 200 / 72;

// โมเดลถูกฝึกมาให้อ่านภาพขนาด ~1 ล้านพิกเซล — แถบที่ใหญ่กว่านี้จะถูกย่อ
const MAX_BAND_PIXELS = 1000 * 1000;

// แถบสุดท้ายที่เตี้ยมากไม่คุ้มที่จะส่งแยก — รวมกับแถบก่อนหน้า
const MIN_BAND_HEIGHT = 220;

// คาบเกี่ยวระหว่างแถบ เพื่อไม่ให้ข้อความถูกตัดขาดตรงรอยต่อ
const BAND_OVERLAP_RATIO = 0.12;
const MAX_BAND_OVERLAP = 100;

// เวลารอเซิร์ฟเวอร์โหลดโมเดล (CPU ปกติใช้ไม่กี่วินาที)
const SERVER_START_TIMEOUT_MS = 180 * 1000;

// เวลารอคำตอบต่อหนึ่งแถบ (CPU ช้า แต่ไม่ควรเกินนี้)
const OCR_TIMEOUT_MS = 300 * 1000;

// ไม่ได้ใช้ OCR สักพัก = คืนหน่วยความจำ (โมเดลกิน RAM ราว 2 GB)
const SERVER_IDLE_MS = 10 * 60 * 1000;

const MODEL_REPO =
    'https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.6-GGUF/resolve/' +
    '511b09642bb324401f15f97cc23bc67e8f0a291d';

const MODEL_FILES = {
    main: {
        name: 'PaddleOCR-VL-1.6-GGUF.gguf',
        size: 935769056,
        label: 'โมเดล PaddleOCR-VL 1.6'
    },
    mmproj: {
        name: 'PaddleOCR-VL-1.6-GGUF-mmproj.gguf',
        size: 881770560,
        label: 'ตัวอ่านภาพ (mmproj)'
    }
};

// llama.cpp เวอร์ชันที่ทดสอบแล้วว่าโหลดโมเดลนี้ได้
const RUNTIME_VERSION = 'b11849';

const RUNTIME_URL =
    'https://github.com/ggml-org/llama.cpp/releases/download/' +
    RUNTIME_VERSION +
    '/llama-' +
    RUNTIME_VERSION +
    '-bin-win-cpu-x64.zip';

const RUNTIME_FILES = [
    'llama-server.exe',
    'llama.dll',
    'ggml.dll',
    'ggml-base.dll',
    'mtmd.dll'
];

const PROMPT = 'OCR:';

// ------------------------------------------------------------------
// ตำแหน่งไฟล์
// ------------------------------------------------------------------

function rootDir(dataPath) {
    // path.resolve เพื่อให้ spawn(exe, { cwd }) ใช้ path สัมพัทธ์ไม่ได้
    return path.join(path.resolve(dataPath), 'ocr');
}

function modelDir(dataPath) {
    return path.join(rootDir(dataPath), 'models', 'paddleocr-vl');
}

function runtimeDir(dataPath) {
    return path.join(
        rootDir(dataPath),
        'runtime',
        'llama-' + RUNTIME_VERSION
    );
}

function fileState(file, expectedSize) {
    try {
        const stat = fs.statSync(file);

        return {
            exists: stat.isFile(),
            size: stat.size,
            complete: stat.size === expectedSize
        };

    } catch (error) {
        return {
            exists: false,
            size: 0,
            complete: false
        };
    }
}

// ขนาดไฟล์ทั้งหมดในโฟลเดอร์ (ใช้รายงานพื้นที่ที่คืนกลับมา)
function directoryBytes(dir) {
    let entries;

    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });

    } catch (error) {
        return 0;
    }

    let total = 0;

    entries.forEach(function (entry) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            total += directoryBytes(full);
            return;
        }

        try {
            total += fs.statSync(full).size;
        } catch (error) {
            // ไฟล์ถูกลบไปแล้ว — ไม่นับ
        }
    });

    return total;
}

function runtimeReady(dataPath) {
    const dir = runtimeDir(dataPath);

    return RUNTIME_FILES.every(function (name) {
        return fileState(path.join(dir, name), 0).exists;
    });
}

function modelStates(dataPath) {
    const dir = modelDir(dataPath);

    return {
        main: fileState(
            path.join(dir, MODEL_FILES.main.name),
            MODEL_FILES.main.size
        ),
        mmproj: fileState(
            path.join(dir, MODEL_FILES.mmproj.name),
            MODEL_FILES.mmproj.size
        )
    };
}

// ------------------------------------------------------------------
// สถานะสำหรับหน้า "ตั้งค่า OCR"
// ------------------------------------------------------------------

function status(dataPath) {
    const files = modelStates(dataPath);
    const runtime = runtimeReady(dataPath);

    const missing = [];

    if (!runtime) missing.push('llama.cpp');
    if (!files.main.complete) missing.push(MODEL_FILES.main.label);
    if (!files.mmproj.complete) missing.push(MODEL_FILES.mmproj.label);

    const modelBytes =
        (files.main.complete ? files.main.size : 0) +
        (files.mmproj.complete ? files.mmproj.size : 0);

    return {
        ready: runtime && files.main.complete && files.mmproj.complete,
        runtimeReady: runtime,
        modelReady: files.main.complete && files.mmproj.complete,
        modelBytes: modelBytes,
        expectedBytes:
            MODEL_FILES.main.size + MODEL_FILES.mmproj.size,
        missing: missing,
        modelPath: modelDir(dataPath),
        runtimePath: runtimeDir(dataPath),
        running: Boolean(server && server.ready && !server.exited),
        language: 'ไทย + อังกฤษ (PaddleOCR-VL 1.6 · 0.9B)'
    };
}

// ------------------------------------------------------------------
// ดาวน์โหลด (รองรับดาวน์โหลดต่อจากไฟล์ .part เดิม)
// ------------------------------------------------------------------

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

async function downloadFile(url, destination, options) {
    const opts = options || {};
    const expectedSize = Number(opts.expectedSize) || 0;
    const temp = destination + '.part';

    if (expectedSize > 0) {
        const done = fileState(destination, expectedSize);

        if (done.complete) {
            if (typeof opts.onProgress === 'function') {
                opts.onProgress({
                    stage: opts.stage,
                    label: opts.label,
                    received: expectedSize,
                    total: expectedSize,
                    percent: 100
                });
            }

            return;
        }

        // ไฟล์เดิมมีขนาดเกินกำหนด = เสียหาย เริ่มใหม่
        const existing = fileState(destination, 0);

        if (existing.exists && existing.size > expectedSize) {
            fs.rmSync(destination, { force: true });
        }
    }

    fs.mkdirSync(path.dirname(destination), { recursive: true });

    let start = 0;

    try {
        const part = fs.statSync(temp);

        if (part.isFile() && part.size > 0) {
            start = part.size;
        }

    } catch (error) {
        start = 0;
    }

    if (expectedSize > 0 && start > expectedSize) {
        fs.rmSync(temp, { force: true });
        start = 0;
    }

    // ดาวน์โหลดครบแล้วแต่ยังไม่ได้เปลี่ยนชื่อ (เช่น แอปถูกปิดตอนนั้น)
    if (expectedSize > 0 && start === expectedSize) {
        fs.rmSync(destination, { force: true });
        fs.renameSync(temp, destination);

        if (typeof opts.onProgress === 'function') {
            opts.onProgress({
                stage: opts.stage,
                label: opts.label,
                received: expectedSize,
                total: expectedSize,
                percent: 100
            });
        }

        return;
    }

    const headers = {};

    if (start > 0) {
        headers.Range = 'bytes=' + start + '-';
    }

    let response;

    try {
        response = await fetch(url, {
            headers: headers,
            redirect: 'follow'
        });

    } catch (error) {
        throw new Error(
            'เชื่อมต่อเซิร์ฟเวอร์ดาวน์โหลดไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต'
        );
    }

    // เซิร์ฟเวอร์ไม่รองรับ Range (หรือไฟล์ .part ใหญ่เกิน) = เริ่มใหม่
    if (start > 0 && response.status !== 206) {
        fs.rmSync(temp, { force: true });
        start = 0;

        try {
            response = await fetch(url, { redirect: 'follow' });
        } catch (error) {
            throw new Error(
                'เชื่อมต่อเซิร์ฟเวอร์ดาวน์โหลดไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต'
            );
        }
    }

    if (!response.ok || !response.body) {
        throw new Error(
            'ดาวน์โหลด ' + (opts.label || 'ไฟล์') +
            ' ไม่สำเร็จ (สถานะ ' + response.status + ')'
        );
    }

    let total = expectedSize;

    if (!total) {
        const range = response.headers.get('content-range') || '';
        const rangeTotal = range.match(/\/(\d+)\s*$/);

        if (rangeTotal) {
            total = Number(rangeTotal[1]);
        } else {
            total =
                start +
                (Number(response.headers.get('content-length')) || 0);
        }
    }

    let received = start;
    let lastEmit = 0;

    const meter = new Transform({
        transform: function (chunk, encoding, callback) {
            received += chunk.length;

            const now = Date.now();

            if (
                typeof opts.onProgress === 'function' &&
                (now - lastEmit > 200 || received === total)
            ) {
                lastEmit = now;

                opts.onProgress({
                    stage: opts.stage,
                    label: opts.label,
                    received: received,
                    total: total,
                    percent: total > 0
                        ? Math.min(100, Math.round((received / total) * 100))
                        : 0
                });
            }

            callback(null, chunk);
        }
    });

    try {
        await pipeline(
            Readable.fromWeb(response.body),
            meter,
            fs.createWriteStream(temp, {
                flags: start > 0 ? 'a' : 'w'
            })
        );

    } catch (error) {
        throw new Error(
            'ดาวน์โหลด ' + (opts.label || 'ไฟล์') +
            ' ขาดกลางทาง — กดเตรียมโมเดลอีกครั้งเพื่อดาวน์โหลดต่อ'
        );
    }

    const downloaded = fileState(temp, expectedSize);

    if (expectedSize > 0 && downloaded.size !== expectedSize) {
        throw new Error(
            'ไฟล์ ' + (opts.label || '') +
            ' ที่ดาวน์โหลดมาไม่สมบูรณ์ — กดเตรียมโมเดลอีกครั้ง'
        );
    }

    fs.rmSync(destination, { force: true });
    fs.renameSync(temp, destination);
}

// ------------------------------------------------------------------
// เตรียม engine + โมเดล
// ------------------------------------------------------------------

async function ensureRuntime(dataPath, emit) {
    const dir = runtimeDir(dataPath);

    if (runtimeReady(dataPath)) return;

    const zipPath = path.join(
        rootDir(dataPath),
        'runtime',
        'llama-' + RUNTIME_VERSION + '.zip'
    );

    emit({
        stage: 'engine',
        label: 'กำลังดาวน์โหลด llama.cpp',
        received: 0,
        total: 0,
        percent: 0
    });

    fs.mkdirSync(path.dirname(zipPath), { recursive: true });

    // ไฟล์ zip เล็ก (~24 MB) — โหลดใหม่ทุกครั้งที่ยังแตกไฟล์ไม่สำเร็จ
    await downloadFile(RUNTIME_URL, zipPath, {
        label: 'llama.cpp',
        stage: 'engine',
        onProgress: emit
    });

    emit({
        stage: 'extract',
        label: 'กำลังแตกไฟล์ llama.cpp',
        received: 0,
        total: 0,
        percent: 0
    });

    let AdmZip;

    try {
        AdmZip = require('adm-zip');

    } catch (error) {
        throw new Error(
            'ไม่พบไลบรารี adm-zip — กรุณาติดตั้ง dependencies ของแอปใหม่ (npm install)'
        );
    }

    try {
        const zip = new AdmZip(zipPath);

        zip.extractAllTo(dir, true);

    } catch (error) {
        // แตกไฟล์ไม่สำเร็จ = ลบ zip เพื่อไม่ให้ใช้ไฟล์เสียในครั้งถัดไป
        fs.rmSync(zipPath, { force: true });

        throw new Error(
            'แตกไฟล์ llama.cpp ไม่สำเร็จ: ' +
            ((error && error.message) || 'ไม่ทราบสาเหตุ')
        );
    }

    fs.rmSync(zipPath, { force: true });

    if (!runtimeReady(dataPath)) {
        throw new Error(
            'ไฟล์ llama.cpp ที่แตกออกมาไม่ครบ — กดเตรียมโมเดลอีกครั้ง'
        );
    }
}

async function prepare(dataPath, onProgress) {
    const emit = typeof onProgress === 'function'
        ? onProgress
        : function () {};

    await ensureRuntime(dataPath, emit);

    const dir = modelDir(dataPath);
    const states = modelStates(dataPath);

    if (!states.main.complete) {
        await downloadFile(
            MODEL_REPO + '/' + MODEL_FILES.main.name,
            path.join(dir, MODEL_FILES.main.name),
            {
                expectedSize: MODEL_FILES.main.size,
                label: MODEL_FILES.main.label,
                stage: 'model',
                onProgress: emit
            }
        );
    }

    if (!states.mmproj.complete) {
        await downloadFile(
            MODEL_REPO + '/' + MODEL_FILES.mmproj.name,
            path.join(dir, MODEL_FILES.mmproj.name),
            {
                expectedSize: MODEL_FILES.mmproj.size,
                label: MODEL_FILES.mmproj.label,
                stage: 'model',
                onProgress: emit
            }
        );
    }

    // เริ่มเซิร์ฟเวอร์จริงเพื่อยืนยันว่าโมเดลโหลดได้ก่อนบอกว่า "พร้อม"
    emit({
        stage: 'start',
        label: 'กำลังเริ่มเซิร์ฟเวอร์ OCR',
        received: 0,
        total: 0,
        percent: 0
    });

    await ensureServer(dataPath);

    return status(dataPath);
}

// ------------------------------------------------------------------
// llama-server (เริ่มเมื่อใช้ครั้งแรก / หยุดเมื่อว่างนาน)
// ------------------------------------------------------------------

let server = null;

function findFreePort() {
    return new Promise(function (resolve, reject) {
        const probe = net.createServer();

        probe.unref();

        probe.once('error', reject);

        probe.listen(0, '127.0.0.1', function () {
            const port = probe.address().port;

            probe.close(function () {
                resolve(port);
            });
        });
    });
}

function serverLogs(entry) {
    return entry.logs.slice(-5).join('\n');
}

function stopEntry(entry) {
    if (!entry) return;

    if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
        entry.idleTimer = null;
    }

    try {
        entry.child.kill();
    } catch (error) {
        // โปรเซสอาจจบไปแล้ว
    }

    entry.ready = false;

    if (server === entry) {
        server = null;
    }
}

function touch(entry) {
    entry.lastUsed = Date.now();

    if (entry.idleTimer) {
        clearTimeout(entry.idleTimer);
    }

    entry.idleTimer = setTimeout(function () {
        stopEntry(entry);
    }, SERVER_IDLE_MS);

    // ไม่ให้ timer กันไม่ให้โปรแกรมจบ
    if (entry.idleTimer.unref) {
        entry.idleTimer.unref();
    }
}

async function waitUntilReady(entry) {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (entry.exited) {
            const detail =
                serverLogs(entry) ||
                (entry.startError && entry.startError.message) ||
                '';

            throw new Error(
                'เซิร์ฟเวอร์ OCR หยุดทำงานก่อนพร้อมใช้งาน' +
                (detail ? ':\n' + detail : '')
            );
        }

        try {
            const response = await fetch(entry.baseUrl + '/health', {
                signal: AbortSignal.timeout(2000)
            });

            if (response.ok) {
                return;
            }

        } catch (error) {
            // ยังไม่ขึ้น — รอต่อ
        }

        await sleep(500);
    }

    throw new Error(
        'เซิร์ฟเวอร์ OCR ใช้เวลาเริ่มนานเกินไป — ' +
        'ลองปิดโปรแกรมอื่นที่ใช้หน่วยความจำมากแล้วกดเตรียมโมเดลอีกครั้ง'
    );
}

function startServer(dataPath) {
    const entry = {
        child: null,
        port: 0,
        baseUrl: '',
        logs: [],
        ready: false,
        exited: false,
        lastUsed: 0,
        idleTimer: null
    };

    const start = async function () {
        const port = await findFreePort();

        const exe = path.join(
            runtimeDir(dataPath),
            'llama-server.exe'
        );

        const mainModel = path.join(
            modelDir(dataPath),
            MODEL_FILES.main.name
        );

        const mmproj = path.join(
            modelDir(dataPath),
            MODEL_FILES.mmproj.name
        );

        entry.port = port;
        entry.baseUrl = 'http://127.0.0.1:' + port;

        const child = spawn(
            exe,
            [
                '-m', mainModel,
                '--mmproj', mmproj,
                '--host', '127.0.0.1',
                '--port', String(port),
                '-c', '8192',
                '-np', '1',
                '--temp', '0',
                '--no-webui'
            ],
            {
                cwd: runtimeDir(dataPath),
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );

        entry.child = child;

        const collect = function (chunk) {
            String(chunk)
                .split(/\r?\n/)
                .map(function (line) {
                    return line.trim();
                })
                .filter(Boolean)
                .forEach(function (line) {
                    entry.logs.push(line);

                    if (entry.logs.length > 40) {
                        entry.logs.shift();
                    }
                });
        };

        child.stdout.on('data', collect);
        child.stderr.on('data', collect);

        child.once('error', function (error) {
            entry.exited = true;
            entry.startError = error;
        });

        child.once('exit', function () {
            entry.exited = true;
            entry.ready = false;

            if (entry.idleTimer) {
                clearTimeout(entry.idleTimer);
                entry.idleTimer = null;
            }

            if (server === entry) {
                server = null;
            }
        });

        await waitUntilReady(entry);

        entry.ready = true;
        touch(entry);

        return entry;
    };

    entry.promise = start().catch(function (error) {
        stopEntry(entry);

        throw new Error(
            'เริ่มเซิร์ฟเวอร์ OCR ในเครื่องไม่สำเร็จ: ' +
            ((error && error.message) || 'ไม่ทราบสาเหตุ')
        );
    });

    return entry.promise;
}

async function ensureServer(dataPath) {
    if (server) {
        if (server.ready && !server.exited) {
            touch(server);
            return server;
        }

        if (server.promise) {
            return server.promise;
        }

        stopEntry(server);
    }

    const state = status(dataPath);

    if (!state.ready) {
        throw new Error(
            'ยังไม่ได้เตรียมโมเดล PaddleOCR-VL — ' +
            'ไปที่ ตั้งค่า OCR แล้วกด "เตรียมโมเดล" ก่อน'
        );
    }

    server = {};

    const promise = startServer(dataPath).then(function (entry) {
        server = entry;
        return entry;
    }).catch(function (error) {
        server = null;
        throw error;
    });

    server.promise = promise;

    return promise;
}

// ------------------------------------------------------------------
// OCR หนึ่งหน้า
// ------------------------------------------------------------------

function cleanLine(line) {
    return String(line == null ? '' : line)
        .replace(/[\u200b\u200e\u200f\ufeff\u00ad]/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

function cleanText(text) {
    return String(text == null ? '' : text)
        .replace(/\r\n?/g, '\n')
        .replace(/^\s*```[A-Za-z0-9_-]*\s*$/gm, '')
        .replace(/\n?```\s*$/, '')
        .split('\n')
        .map(cleanLine)
        .filter(function (line) {
            return line !== '' && !/^OCR:\s*$/.test(line);
        });
}

function normalizeForCompare(text) {
    return String(text || '')
        .replace(/[\u200b\u200e\u200f\ufeff\u00ad]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// ต่อบรรทัดของแถบใหม่เข้ากับของเดิม โดยตัดบรรทัดที่ซ้ำตรงรอยต่อ
function mergeLines(target, incoming) {
    let overlap = 0;
    const max = Math.min(target.length, incoming.length);

    for (let size = max; size >= 1; size--) {
        let same = true;

        for (let index = 0; index < size; index++) {
            const left = target[target.length - size + index];
            const right = incoming[index];

            if (
                normalizeForCompare(left.text) !==
                normalizeForCompare(right.text)
            ) {
                same = false;
                break;
            }
        }

        if (same) {
            overlap = size;
            break;
        }
    }

    for (let index = overlap; index < incoming.length; index++) {
        target.push(incoming[index]);
    }
}

async function requestBand(entry, png) {
    const body = {
        model: 'paddleocr-vl',
        temperature: 0,
        max_tokens: 2048,
        stream: false,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image_url',
                        image_url: {
                            url:
                                'data:image/png;base64,' +
                                png.toString('base64')
                        }
                    },
                    {
                        type: 'text',
                        text: PROMPT
                    }
                ]
            }
        ]
    };

    const controller = new AbortController();

    const timer = setTimeout(function () {
        controller.abort();
    }, OCR_TIMEOUT_MS);

    let response;

    try {
        response = await fetch(
            entry.baseUrl + '/v1/chat/completions',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body),
                signal: controller.signal
            }
        );

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error(
                'PaddleOCR-VL ใช้เวลาอ่านนานเกินไป (timeout) — ลองใหม่อีกครั้ง'
            );
        }

        // เซิร์ฟเวอร์อาจตายระหว่างอ่าน — รอบถัดไปจะเริ่มใหม่
        if (server === entry) {
            stopEntry(entry);
        }

        throw new Error(
            'เชื่อมต่อเซิร์ฟเวอร์ OCR ในเครื่องไม่ได้ — ลองใหม่อีกครั้ง'
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
        const detail =
            (data && data.error && data.error.message) ||
            (data && data.error) ||
            ('สถานะ ' + response.status);

        throw new Error(
            'PaddleOCR-VL อ่านหน้านี้ไม่สำเร็จ: ' + detail
        );
    }

    const choice = data && Array.isArray(data.choices)
        ? data.choices[0]
        : null;

    const content = choice && choice.message
        ? choice.message.content
        : '';

    let text = '';

    if (typeof content === 'string') {
        text = content;

    } else if (Array.isArray(content)) {
        text = content
            .map(function (part) {
                return part && typeof part.text === 'string'
                    ? part.text
                    : '';
            })
            .filter(Boolean)
            .join('\n');
    }

    if (
        String(text).trim() === '' &&
        choice &&
        choice.finish_reason === 'length'
    ) {
        throw new Error(
            'PaddleOCR-VL อ่านข้อความได้ยาวเกินกำหนดของแถบนี้'
        );
    }

    return cleanText(text).map(function (line) {
        return { text: line };
    });
}

async function ocrPage(page, options) {
    const opts = options || {};
    const dataPath = opts.dataPath;

    if (!dataPath) {
        throw new Error('ไม่ได้ระบุตำแหน่งข้อมูลสำหรับ OCR');
    }

    const entry = await ensureServer(dataPath);

    const png = await renderPageToPng(page, VL_SCALE);

    let image;

    try {
        const canvas = require('@napi-rs/canvas');
        image = await canvas.loadImage(png);

    } catch (error) {
        throw new Error(
            'เตรียมภาพของหน้า PDF ไม่สำเร็จ: ' +
            ((error && error.message) || 'ไม่ทราบสาเหตุ')
        );
    }

    const canvasModule = require('@napi-rs/canvas');

    const width = image.width;
    const height = image.height;

    const bandHeight = Math.max(
        MIN_BAND_HEIGHT,
        Math.min(height, Math.floor(MAX_BAND_PIXELS / width))
    );

    const overlap = Math.min(
        MAX_BAND_OVERLAP,
        Math.round(bandHeight * BAND_OVERLAP_RATIO)
    );

    const step = Math.max(1, bandHeight - overlap);

    const lines = [];

    try {
        for (let top = 0; top < height; top += step) {
            const sliceHeight = Math.min(bandHeight, height - top);

            // กัน timer หยุดเซิร์ฟเวอร์ระหว่างหน้าที่ใช้เวลานาน
            touch(entry);

            const canvas = canvasModule.createCanvas(
                width,
                sliceHeight
            );

            const context = canvas.getContext('2d');

            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, sliceHeight);
            context.drawImage(image, 0, -top);

            const bandLines = await requestBand(
                entry,
                canvas.toBuffer('image/png')
            );

            mergeLines(lines, bandLines);

            if (top + sliceHeight >= height) {
                break;
            }
        }

    } finally {
        touch(entry);
    }

    return {
        text: lines.map(function (line) {
            return line.text;
        }).join('\n'),
        lines: lines,
        confidence: 0
    };
}

// รอให้โปรเซสลูกจบจริงก่อน — บน Windows ไฟล์จะยังถูกล็อกอยู่
// ถ้าลบทันทีที่สั่ง kill
function waitForExit(entry, timeoutMs) {
    if (
        !entry ||
        !entry.child ||
        entry.exited ||
        entry.child.exitCode !== null ||
        entry.child.signalCode !== null
    ) {
        return Promise.resolve();
    }

    return new Promise(function (resolve) {
        const timer = setTimeout(finish, timeoutMs);

        function finish() {
            clearTimeout(timer);
            entry.child.removeListener('exit', finish);
            resolve();
        }

        entry.child.once('exit', finish);
    });
}

function stop() {
    stopEntry(server);
    server = null;
}

// ถอนการติดตั้ง: หยุดเซิร์ฟเวอร์แล้วลบ engine + โมเดลทั้งหมดในเครื่อง
// (ครั้งถัดไปที่ใช้ต้องดาวน์โหลดใหม่ ~1.8 GB)
async function remove(dataPath) {
    const root = rootDir(dataPath);

    if (server) {
        const entry = server;

        stopEntry(entry);

        await waitForExit(entry, 10 * 1000);
    }

    const removedBytes = directoryBytes(root);

    try {
        fs.rmSync(root, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 300
        });

    } catch (error) {
        throw new Error(
            'ลบไฟล์ PaddleOCR-VL ไม่สำเร็จ: ' +
            ((error && error.message) || 'ไม่ทราบสาเหตุ') +
            ' — ปิดโปรแกรมที่เปิดไฟล์ในโฟลเดอร์ data\\ocr อยู่แล้วลองใหม่'
        );
    }

    return Object.assign(status(dataPath), {
        removedBytes: removedBytes
    });
}

module.exports = {
    VL_SCALE,
    status,
    prepare,
    ocrPage,
    remove,
    stop
};
