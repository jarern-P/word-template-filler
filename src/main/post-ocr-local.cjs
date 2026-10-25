// Local AI สำหรับ Post-OCR — Qwen2.5-3B-Instruct ผ่าน llama.cpp
//
// ใช้ llama.cpp runtime ชุดเดียวกับ PaddleOCR-VL (data/ocr/runtime)
// แล้วดาวน์โหลดโมเดล GGUF แยกไว้ที่ data/post-ocr/models
//
// งาน:
//   - chat()  = แก้คำผิด + แบ่งประโยค
//   - embed() = vector ของตัวอย่าง few-shot (ถ้าเซิร์ฟเวอร์รองรับ)
//               ถ้าไม่รองรับ จะคืน null ให้ post-ocr.cjs ใช้ char n-gram แทน
//
// ทุกอย่างทำงานในเครื่อง ไม่มีข้อความออกนอกเครื่อง
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const llama = require('./ocr-paddle-vl.cjs');

const MODEL_REPO =
    'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/' +
    '7dabda4d13d513e3e842b20f0d435c732f172cbe';

const MODEL_FILE = 'qwen2.5-3b-instruct-q4_k_m.gguf';

const MODEL_SIZE = 2104932768;

const MODEL_LABEL = 'โมเดล Qwen2.5-3B-Instruct (Q4_K_M)';

// context พอสำหรับ prompt + ข้อความก้อนละ ~1200 ตัวอักษร
const CONTEXT_SIZE = 8192;

const SERVER_START_TIMEOUT_MS = 300 * 1000;

// CPU 3B อาจใช้เวลาหลายนาทีต่อก้อน
const CHAT_TIMEOUT_MS = 10 * 60 * 1000;

const EMBED_TIMEOUT_MS = 60 * 1000;

// ไม่ได้ใช้สักพัก = คืน RAM (โมเดลกินราว 2.3 GB)
const SERVER_IDLE_MS = 10 * 60 * 1000;

// ------------------------------------------------------------------
// ตำแหน่งไฟล์
// ------------------------------------------------------------------

function rootDir(dataPath) {
    return path.join(path.resolve(dataPath), 'post-ocr');
}

function modelDir(dataPath) {
    return path.join(rootDir(dataPath), 'models');
}

function modelPath(dataPath) {
    return path.join(modelDir(dataPath), MODEL_FILE);
}

function fileState(file) {
    try {
        const stat = fs.statSync(file);

        return {
            exists: stat.isFile(),
            size: stat.size,
            complete: stat.isFile() && stat.size === MODEL_SIZE
        };

    } catch (error) {
        return {
            exists: false,
            size: 0,
            complete: false
        };
    }
}

function directoryBytes(dir) {
    let total = 0;

    try {
        fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                total += directoryBytes(full);
                return;
            }

            try {
                total += fs.statSync(full).size;
            } catch (error) {
                // ไฟล์ถูกลบไปแล้ว
            }
        });

    } catch (error) {
        return 0;
    }

    return total;
}

// ------------------------------------------------------------------
// สถานะ
// ------------------------------------------------------------------

function status(dataPath) {
    const state = fileState(modelPath(dataPath));
    const runtimeReady = llama.runtimeReady(dataPath);

    const missing = [];

    if (!runtimeReady) missing.push('llama.cpp');
    if (!state.complete) missing.push(MODEL_LABEL);

    return {
        ready: runtimeReady && state.complete,
        runtimeReady: runtimeReady,
        modelReady: state.complete,
        modelBytes: state.size,
        expectedBytes: MODEL_SIZE,
        missing: missing,
        running: Boolean(server && server.ready && !server.exited),
        modelPath: modelPath(dataPath),
        engine: 'Qwen2.5-3B-Instruct (llama.cpp)'
    };
}

// ------------------------------------------------------------------
// เตรียม runtime + โมเดล
// ------------------------------------------------------------------

async function prepare(dataPath, onProgress) {
    const emit = typeof onProgress === 'function'
        ? onProgress
        : function () {};

    // runtime llama.cpp ใช้ร่วมกับ PaddleOCR-VL (ถ้ามีแล้วจะข้าม)
    await llama.ensureRuntime(dataPath, emit);

    const target = modelPath(dataPath);

    if (!fileState(target).complete) {
        emit({
            stage: 'model',
            label: 'กำลังดาวน์โหลด ' + MODEL_LABEL,
            received: 0,
            total: MODEL_SIZE,
            percent: 0
        });

        await llama.downloadFile(
            MODEL_REPO + '/' + MODEL_FILE,
            target,
            {
                expectedSize: MODEL_SIZE,
                label: MODEL_LABEL,
                stage: 'model',
                onProgress: emit
            }
        );
    }

    emit({
        stage: 'start',
        label: 'กำลังเริ่มเซิร์ฟเวอร์ Qwen',
        received: 0,
        total: 0,
        percent: 0
    });

    await ensureServer(dataPath);

    return status(dataPath);
}

// ------------------------------------------------------------------
// llama-server
// ------------------------------------------------------------------

let server = null;
let serverPromise = null;

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

    if (entry.idleTimer.unref) {
        entry.idleTimer.unref();
    }
}

function sleep(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

function serverLogs(entry) {
    return entry.logs.slice(-8).join('\n');
}

async function waitUntilReady(entry) {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (entry.exited) {
            throw new Error(
                'เซิร์ฟเวอร์ Qwen หยุดทำงานก่อนพร้อมใช้งาน' +
                (serverLogs(entry) ? ':\n' + serverLogs(entry) : '')
            );
        }

        try {
            const response = await fetch(entry.baseUrl + '/health', {
                signal: AbortSignal.timeout(2000)
            });

            if (response.ok) return;

        } catch (error) {
            // ยังไม่ขึ้น — รอต่อ
        }

        await sleep(500);
    }

    throw new Error(
        'เซิร์ฟเวอร์ Qwen ใช้เวลาเริ่มนานเกินไป — ลองปิดโปรแกรมอื่นที่ใช้ RAM มาก'
    );
}

async function startServer(dataPath) {
    const state = fileState(modelPath(dataPath));

    if (!llama.runtimeReady(dataPath)) {
        throw new Error(
            'ยังไม่มี llama.cpp — กด "เตรียมโมเดล" ในหน้าตั้งค่า OCR ก่อน'
        );
    }

    if (!state.complete) {
        throw new Error(
            'ยังไม่มีโมเดล Qwen2.5-3B — กด "เตรียมโมเดล" ในหน้าตั้งค่า OCR ' +
            '(ดาวน์โหลด ~2 GB)'
        );
    }

    const port = await llama.findFreePort();
    const runtime = llama.runtimeDir(dataPath);
    const exe = path.join(runtime, 'llama-server.exe');

    const child = spawn(
        exe,
        [
            '-m', modelPath(dataPath),
            '--host', '127.0.0.1',
            '--port', String(port),
            '-c', String(CONTEXT_SIZE)
        ],
        {
            cwd: runtime,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        }
    );

    const entry = {
        child: child,
        port: port,
        baseUrl: 'http://127.0.0.1:' + port,
        ready: false,
        exited: false,
        logs: [],
        idleTimer: null,
        lastUsed: Date.now()
    };

    function collect(chunk) {
        const text = String(chunk || '');

        text.split(/\r?\n/).forEach(function (line) {
            if (line.trim() !== '') {
                entry.logs.push(line.trim());
            }
        });

        if (entry.logs.length > 40) {
            entry.logs = entry.logs.slice(-40);
        }
    }

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    child.on('error', function (error) {
        entry.exited = true;
        entry.logs.push((error && error.message) || 'spawn error');
    });

    child.on('exit', function () {
        entry.exited = true;
        entry.ready = false;

        if (server === entry) {
            server = null;
        }
    });

    server = entry;

    try {
        await waitUntilReady(entry);

    } catch (error) {
        stopEntry(entry);
        throw error;
    }

    entry.ready = true;
    touch(entry);

    return entry;
}

function ensureServer(dataPath) {
    if (server && server.ready && !server.exited) {
        touch(server);
        return Promise.resolve(server);
    }

    if (serverPromise) return serverPromise;

    serverPromise = startServer(dataPath).catch(function (error) {
        serverPromise = null;
        throw error;
    });

    serverPromise.then(function () {
        serverPromise = null;
    }, function () {
        serverPromise = null;
    });

    return serverPromise;
}

// ------------------------------------------------------------------
// Chat / Embeddings
// ------------------------------------------------------------------

function contentToText(content) {
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
        return content
            .map(function (part) {
                return part && typeof part.text === 'string' ? part.text : '';
            })
            .filter(Boolean)
            .join('\n');
    }

    return '';
}

async function chat(messages, options) {
    const opts = options || {};
    const entry = await ensureServer(opts.dataPath);

    touch(entry);

    const timeout = Number(opts.timeoutMs) > 0
        ? Number(opts.timeoutMs)
        : CHAT_TIMEOUT_MS;

    const controller = new AbortController();
    const timer = setTimeout(function () {
        controller.abort();
    }, timeout);

    let response;

    try {
        response = await fetch(entry.baseUrl + '/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen2.5-3b-instruct',
                messages: messages,
                temperature: 0,
                max_tokens: 2048,
                stream: false
            }),
            signal: controller.signal
        });

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('Qwen ใช้เวลาประมวลผลนานเกินไป (timeout)');
        }

        if (server === entry) {
            stopEntry(entry);
        }

        throw new Error('เชื่อมต่อเซิร์ฟเวอร์ Qwen ในเครื่องไม่ได้ — ลองใหม่');

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

        throw new Error('Qwen อ่านข้อความไม่สำเร็จ: ' + detail);
    }

    const choice = data && Array.isArray(data.choices)
        ? data.choices[0]
        : null;

    const text = choice && choice.message
        ? contentToText(choice.message.content)
        : '';

    if (String(text).trim() === '') {
        throw new Error('Qwen ตอบกลับเป็นข้อความว่าง');
    }

    touch(entry);

    return text;
}

const embedCache = new Map();

// คืน null เมื่อเซิร์ฟเวอร์ไม่รองรับ embeddings — ผู้เรียกจะใช้ char n-gram แทน
async function embed(texts, dataPath) {
    const list = (Array.isArray(texts) ? texts : [])
        .map(function (text) {
            return String(text == null ? '' : text);
        });

    if (list.length === 0) return null;

    const cached = list.map(function (text) {
        return embedCache.get(text) || null;
    });

    if (cached.every(Boolean)) return cached;

    let entry;

    try {
        entry = await ensureServer(dataPath);
    } catch (error) {
        return null;
    }

    touch(entry);

    const controller = new AbortController();
    const timer = setTimeout(function () {
        controller.abort();
    }, EMBED_TIMEOUT_MS);

    let response;

    try {
        response = await fetch(entry.baseUrl + '/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'qwen2.5-3b-instruct',
                input: list
            }),
            signal: controller.signal
        });

    } catch (error) {
        return null;

    } finally {
        clearTimeout(timer);
    }

    if (!response.ok) return null;

    let data = null;

    try {
        data = await response.json();
    } catch (error) {
        return null;
    }

    const rows = data && Array.isArray(data.data) ? data.data : [];

    if (rows.length !== list.length) return null;

    const vectors = rows.map(function (row) {
        return Array.isArray(row && row.embedding) ? row.embedding : null;
    });

    if (vectors.some(function (vector) { return !vector; })) return null;

    list.forEach(function (text, index) {
        embedCache.set(text, vectors[index]);
    });

    if (embedCache.size > 500) {
        const first = embedCache.keys().next().value;
        embedCache.delete(first);
    }

    return vectors;
}

// ------------------------------------------------------------------
// ถอนการติดตั้ง / หยุด
// ------------------------------------------------------------------

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
            'ลบไฟล์ Qwen ไม่สำเร็จ: ' +
            ((error && error.message) || 'ไม่ทราบสาเหตุ') +
            ' — ปิดโปรแกรมที่เปิดไฟล์ในโฟลเดอร์ data\\post-ocr อยู่แล้วลองใหม่'
        );
    }

    embedCache.clear();

    return Object.assign(status(dataPath), {
        removedBytes: removedBytes
    });
}

function stop() {
    stopEntry(server);
    server = null;
    embedCache.clear();
}

module.exports = {
    MODEL_FILE,
    MODEL_SIZE,
    MODEL_LABEL,
    status,
    prepare,
    chat,
    embed,
    remove,
    stop
};
