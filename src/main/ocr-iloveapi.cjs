// OCR ด้วย i love api (iLoveAPI — REST API ของ iLovePDF)
//
// iLoveAPI ไม่ได้คืนข้อความตรง ๆ แต่ทำ PDF ที่สแกนให้เป็น "PDF ที่มีชั้นข้อความ"
// (searchable PDF) จึงต้องส่ง PDF ทั้งไฟล์ไป แล้วโหลดไฟล์ผลลัพธ์กลับมาอ่านข้อความ
// ด้วย pdf.js อีกครั้ง (ทำใน main.cjs)
//
// ขั้นตอนตามเอกสาร (https://www.iloveapi.com/docs/api-reference):
//   1. POST /v1/auth                    แลก Public Key เป็น token
//   2. GET  /v1/start/pdfocr            ขอ server + task id
//   3. POST https://{server}/v1/upload  อัปโหลด PDF
//   4. POST https://{server}/v1/process สั่ง OCR (tha + eng)
//   5. GET  https://{server}/v1/download/{task}  โหลด PDF ที่มีข้อความ
'use strict';

const API_ORIGIN = 'https://api.ilovepdf.com';
const API_VERSION = 'v1';

const AUTH_TIMEOUT_MS = 60 * 1000;
const START_TIMEOUT_MS = 60 * 1000;
const UPLOAD_TIMEOUT_MS = 180 * 1000;
const PROCESS_TIMEOUT_MS = 300 * 1000;
const DOWNLOAD_TIMEOUT_MS = 180 * 1000;

// token ใช้ได้ 1 ชั่วโมง — เก็บไว้ใช้ซ้ำระหว่างการทำงานของแอป
const tokenCache = new Map();

function apiUrl(path) {
    return API_ORIGIN + '/' + API_VERSION + path;
}

function withTimeout(ms) {
    const controller = new AbortController();
    const timer = setTimeout(function () {
        controller.abort();
    }, ms);

    return {
        signal: controller.signal,
        done: function () {
            clearTimeout(timer);
        }
    };
}

async function readJson(response) {
    try {
        return await response.json();

    } catch (error) {
        return null;
    }
}

function serverMessage(data) {
    if (!data) return '';

    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error.message === 'string') {
        return data.error.message;
    }

    if (typeof data.message === 'string') return data.message;

    return '';
}

function responseError(status, data, fallback) {
    const detail = serverMessage(data).slice(0, 300);

    if (status === 401 || status === 403) {
        return 'i love api ปฏิเสธ key — ใช้ "Public Key" ของโปรเจกต์ (ไม่ใช่ Secret Key)';
    }

    if (status === 429) {
        return 'โควตาของ i love api เต็มหรือเรียกถี่เกินไป — รอสักครู่แล้วลองใหม่';
    }

    return (fallback || 'i love api ตอบกลับผิดพลาด') +
        (detail ? ': ' + detail : ' (สถานะ ' + status + ')');
}

async function auth(apiKey) {
    const cached = tokenCache.get(apiKey);

    if (cached && cached.expiresAt > Date.now()) {
        return cached.token;
    }

    const timeout = withTimeout(AUTH_TIMEOUT_MS);
    let response;

    try {
        response = await fetch(apiUrl('/auth'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                public_key: apiKey
            }),
            signal: timeout.signal
        });

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('ขอ token จาก i love api ไม่สำเร็จ (timeout)');
        }

        throw new Error('เชื่อมต่อ i love api ไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต');

    } finally {
        timeout.done();
    }

    const data = await readJson(response);

    if (!response.ok || !data || !data.token) {
        throw new Error(
            responseError(
                response.status,
                data,
                'ยืนยันตัวตนกับ i love api ไม่สำเร็จ'
            )
        );
    }

    // token อายุ 1 ชั่วโมง — ต่ออายุล่วงหน้า 5 นาที
    tokenCache.set(apiKey, {
        token: data.token,
        expiresAt: Date.now() + 55 * 60 * 1000
    });

    return data.token;
}

async function startTask(token) {
    const timeout = withTimeout(START_TIMEOUT_MS);
    let response;

    try {
        response = await fetch(apiUrl('/start/pdfocr'), {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token
            },
            signal: timeout.signal
        });

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('เริ่มงาน OCR กับ i love api ไม่สำเร็จ (timeout)');
        }

        throw new Error('เชื่อมต่อ i love api ไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต');

    } finally {
        timeout.done();
    }

    const data = await readJson(response);

    if (!response.ok || !data || !data.server || !data.task) {
        throw new Error(
            responseError(
                response.status,
                data,
                'เริ่มงาน OCR กับ i love api ไม่สำเร็จ'
            )
        );
    }

    return data;
}

async function upload(task, server, token, pdf) {
    const timeout = withTimeout(UPLOAD_TIMEOUT_MS);

    const form = new FormData();

    form.append('task', task);
    form.append(
        'file',
        new Blob([pdf], { type: 'application/pdf' }),
        'document.pdf'
    );

    let response;

    try {
        response = await fetch(
            'https://' + server + '/' + API_VERSION + '/upload',
            {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token
                },
                body: form,
                signal: timeout.signal
            }
        );

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('อัปโหลด PDF ไป i love api ไม่สำเร็จ (timeout)');
        }

        throw new Error('เชื่อมต่อ i love api ไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต');

    } finally {
        timeout.done();
    }

    const data = await readJson(response);

    if (!response.ok || !data || !data.server_filename) {
        throw new Error(
            responseError(
                response.status,
                data,
                'อัปโหลด PDF ไป i love api ไม่สำเร็จ'
            )
        );
    }

    return data.server_filename;
}

async function processTask(task, server, token, serverFilename) {
    const timeout = withTimeout(PROCESS_TIMEOUT_MS);
    let response;

    try {
        response = await fetch(
            'https://' + server + '/' + API_VERSION + '/process',
            {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    task: task,
                    tool: 'pdfocr',
                    // ภาษาไทย + อังกฤษ (เอกสารไทยมีเลข/คำอังกฤษปน)
                    ocr_languages: ['tha', 'eng'],
                    files: [
                        {
                            server_filename: serverFilename,
                            filename: 'document.pdf',
                            rotate: 0,
                            password: ''
                        }
                    ]
                }),
                signal: timeout.signal
            }
        );

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('i love api ทำ OCR นานเกินไป (timeout) — ลองไฟล์ที่เล็กกว่า');
        }

        throw new Error('เชื่อมต่อ i love api ไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต');

    } finally {
        timeout.done();
    }

    const data = await readJson(response);

    if (!response.ok || !data) {
        throw new Error(
            responseError(
                response.status,
                data,
                'i love api ทำ OCR ไม่สำเร็จ'
            )
        );
    }

    return data;
}

async function download(task, server, token) {
    const timeout = withTimeout(DOWNLOAD_TIMEOUT_MS);
    let response;

    try {
        response = await fetch(
            'https://' + server + '/' + API_VERSION + '/download/' + encodeURIComponent(task),
            {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + token
                },
                signal: timeout.signal
            }
        );

    } catch (error) {
        if (error && error.name === 'AbortError') {
            throw new Error('ดาวน์โหลดผลลัพธ์จาก i love api ไม่สำเร็จ (timeout)');
        }

        throw new Error('เชื่อมต่อ i love api ไม่ได้ — ตรวจการเชื่อมต่ออินเทอร์เน็ต');

    } finally {
        timeout.done();
    }

    if (!response.ok) {
        let data = null;

        try {
            data = await response.json();
        } catch (error) {
            data = null;
        }

        throw new Error(
            responseError(
                response.status,
                data,
                'ดาวน์โหลดผลลัพธ์จาก i love api ไม่สำเร็จ'
            )
        );
    }

    const contentType = String(
        response.headers.get('content-type') || ''
    ).toLowerCase();

    const buffer = Buffer.from(await response.arrayBuffer());

    // ไฟล์ผลลัพธ์ต้องเป็น PDF จริง ๆ (บางกรณีเซิร์ฟเวอร์ตอบ JSON)
    if (
        contentType.indexOf('json') !== -1 ||
        buffer.slice(0, 5).toString('latin1') !== '%PDF-'
    ) {
        throw new Error(
            'i love api ส่งไฟล์ผลลัพธ์กลับมาไม่ถูกต้อง — ลองใหม่อีกครั้ง'
        );
    }

    return buffer;
}

/**
 * OCR PDF ทั้งไฟล์ด้วย i love api
 * @param {Buffer|Uint8Array} pdf เนื้อไฟล์ PDF ต้นฉบับ
 * @param {Object} options { apiKey }
 * @returns {Promise<Buffer>} PDF ที่มีชั้นข้อความแล้ว
 */
async function ocrPdf(pdf, options) {
    const apiKey = String((options && options.apiKey) || '').trim();

    if (apiKey === '') {
        throw new Error('ยังไม่ได้ใส่ API key ของ i love api — ไปที่ ตั้งค่า OCR ก่อน');
    }

    const buffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);

    if (buffer.length === 0) {
        throw new Error('ไม่พบข้อมูลไฟล์ PDF');
    }

    const token = await auth(apiKey);
    const started = await startTask(token);
    const serverFilename = await upload(
        started.task,
        started.server,
        token,
        buffer
    );

    await processTask(
        started.task,
        started.server,
        token,
        serverFilename
    );

    return download(
        started.task,
        started.server,
        token
    );
}

module.exports = {
    ocrPdf
};
