// เทสต์การปรับปรุงข้อความด้วย AI — prompt, การแบ่งก้อน, ทำความสะอาดผลลัพธ์ และการเรียก Gemini
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const fs = require('fs');
const os = require('os');
const path = require('path');

const improve = require('../src/main/ocr-improve.cjs');
const ocrConfig = require('../src/main/ocr-config.cjs');

function withTempDir(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-improve-'));

    try {
        return fn(dir);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('buildPrompt สั่งแก้คำผิดและจัดเป็น key-value พร้อมแนบข้อความเดิม', function () {
    const prompt = improve.buildPrompt('จา นวนเงนิ 4,000.00 บาท');

    assert.ok(prompt.includes('key-value pair'));
    assert.ok(prompt.includes('"ชื่อฟิลด์: ค่า"'));
    assert.ok(prompt.includes('แก้คำที่ OCR อ่านผิด'));
    assert.ok(prompt.includes('จา นวนเงนิ 4,000.00 บาท'));
    assert.ok(prompt.includes('<<<') && prompt.includes('>>>'));
});

test('cleanResult ตัด code fence บรรทัดว่าง และช่องว่างเกิน', function () {
    const cleaned = improve.cleanResult(
        '```text\n' +
        '  เลขที่:    702057001  \n' +
        '\n' +
        'วันที่:\t25/10/2569\n' +
        '```\n'
    );

    assert.strictEqual(
        cleaned,
        'เลขที่: 702057001\nวันที่: 25/10/2569'
    );
});

test('splitChunks แบ่งตามบรรทัดและไม่ตัดกลางบรรทัด', function () {
    const text = [
        'เลขที่: 702057001',
        'วันที่: 25/10/2569',
        'จำนวนเงิน: 4,000.00 บาท',
        'ผู้ยื่น: นางสาวทดสอบ ระบบ'
    ].join('\n');

    const chunks = improve.splitChunks(text, 40);

    assert.ok(chunks.length > 1);
    assert.strictEqual(chunks.join('\n'), text);

    chunks.forEach(function (chunk) {
        // แต่ละก้อนต้องไม่ทำให้บรรทัดถูกผ่าครึ่ง
        assert.ok(
            text.includes(chunk.trim()),
            'ก้อนต้องเป็นส่วนของข้อความเดิม: ' + chunk
        );
    });
});

test('splitChunks ตัดบรรทัดเดียวยาวเกินกำหนด', function () {
    const chunks = improve.splitChunks('ก'.repeat(25), 10);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks.join(''), 'ก'.repeat(25));
});

test('improveText ส่งคำขอ Gemini ด้วย key/model ที่กำหนด และคืนข้อความที่จัดแล้ว', async function () {
    const originalFetch = global.fetch;
    const calls = [];

    global.fetch = async function (url, init) {
        calls.push({ url: url, init: init });

        return {
            ok: true,
            status: 200,
            json: async function () {
                return {
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: 'เลขที่: 702057001\nวันที่: 25/10/2569'
                                    }
                                ]
                            }
                        }
                    ]
                };
            }
        };
    };

    try {
        const result = await improve.improveText(
            'เลขที่ 702057001\nวันที่ 25/10/2569',
            { apiKey: 'test-key', model: 'gemini-2.5-flash' }
        );

        assert.strictEqual(calls.length, 1);
        assert.ok(calls[0].url.includes('gemini-2.5-flash:generateContent'));
        assert.strictEqual(calls[0].init.headers['x-goog-api-key'], 'test-key');

        const body = JSON.parse(calls[0].init.body);
        assert.ok(body.contents[0].parts[0].text.includes('702057001'));
        assert.strictEqual(body.generationConfig.temperature, 0.1);

        assert.strictEqual(
            result.text,
            'เลขที่: 702057001\nวันที่: 25/10/2569'
        );
        assert.strictEqual(result.model, 'gemini-2.5-flash');
        assert.strictEqual(result.chunks, 1);

    } finally {
        global.fetch = originalFetch;
    }
});

test('improveText แบ่งก้อนและรายงานความคืบหน้าเมื่อข้อความยาว', async function () {
    const originalFetch = global.fetch;
    let calls = 0;
    const progress = [];

    global.fetch = async function () {
        calls += 1;

        return {
            ok: true,
            status: 200,
            json: async function () {
                return {
                    candidates: [
                        {
                            content: {
                                parts: [{ text: 'ฟิลด์: ค่า' + calls }]
                            }
                        }
                    ]
                };
            }
        };
    };

    try {
        const result = await improve.improveText(
            ['บรรทัดที่หนึ่ง', 'บรรทัดที่สอง', 'บรรทัดที่สาม'].join('\n'),
            {
                apiKey: 'test-key',
                chunkChars: 20,
                onProgress: function (value) {
                    progress.push(value);
                }
            }
        );

        assert.strictEqual(result.chunks, calls);
        assert.ok(result.chunks > 1);
        assert.deepStrictEqual(
            progress.map(function (item) {
                return item.index;
            }),
            progress.map(function (_, index) {
                return index + 1;
            })
        );
        assert.strictEqual(progress[0].total, result.chunks);

    } finally {
        global.fetch = originalFetch;
    }
});

test('buildPrompt ใช้ prompt ที่ผู้ใช้แก้แทนชุดเริ่มต้น', function () {
    const prompt = improve.buildPrompt(
        'เลขที่ 702057001',
        'ตอบเป็นภาษาไทย บรรทัดละฟิลด์'
    );

    assert.ok(prompt.includes('ตอบเป็นภาษาไทย บรรทัดละฟิลด์'));
    assert.ok(!prompt.includes('คุณเป็นบรรณาธิการข้อความภาษาไทย'));
    assert.ok(prompt.includes('เลขที่ 702057001'));

    // prompt ว่าง/ช่องว่าง = กลับไปใช้ค่าเริ่มต้น
    assert.ok(
        improve.buildPrompt('x', '   ').includes('key-value pair')
    );
});

test('improveText ส่ง prompt ที่แก้เองไปในคำขอ', async function () {
    const originalFetch = global.fetch;
    let body = null;

    global.fetch = async function (url, init) {
        body = JSON.parse(init.body);

        return {
            ok: true,
            status: 200,
            json: async function () {
                return {
                    candidates: [
                        { content: { parts: [{ text: 'จำนวนเงิน: 4,000.00' }] } }
                    ]
                };
            }
        };
    };

    try {
        await improve.improveText('จา นวนเงนิ 4,000.00', {
            apiKey: 'k',
            prompt: 'แก้คำผิดเท่านั้น'
        });

        const sent = body.contents[0].parts[0].text;

        assert.ok(sent.startsWith('แก้คำผิดเท่านั้น'));
        assert.ok(sent.includes('จา นวนเงนิ 4,000.00'));

    } finally {
        global.fetch = originalFetch;
    }
});

test('ocr-config เก็บ prompt ที่แก้เองและคืน prompt เริ่มต้นให้หน้าจอ', function () {
    withTempDir(function (dir) {
        const initial = ocrConfig.read(dir);

        assert.strictEqual(initial.improve.prompt, '');
        assert.strictEqual(initial.improve.defaultPrompt, improve.DEFAULT_PROMPT);

        const saved = ocrConfig.save(dir, {
            improve: { prompt: '  บรรทัดละฟิลด์  \nคงตัวเลขเดิม ' }
        });

        assert.strictEqual(saved.improve.prompt, 'บรรทัดละฟิลด์\nคงตัวเลขเดิม');
        assert.strictEqual(
            ocrConfig.readSecrets(dir).improve.prompt,
            'บรรทัดละฟิลด์\nคงตัวเลขเดิม'
        );

        // ไม่ส่ง prompt มา = ใช้ค่าเดิมที่เก็บไว้
        const again = ocrConfig.save(dir, { provider: 'gemini' });
        assert.strictEqual(again.improve.prompt, 'บรรทัดละฟิลด์\nคงตัวเลขเดิม');

        // ส่งสตริงว่าง = กลับไปใช้ค่าเริ่มต้น
        const reset = ocrConfig.save(dir, { improve: { prompt: '' } });
        assert.strictEqual(reset.improve.prompt, '');
    });
});

test('ocr-config ตัด prompt ที่ยาวเกินกำหนด', function () {
    withTempDir(function (dir) {
        const saved = ocrConfig.save(dir, {
            improve: { prompt: 'ก'.repeat(ocrConfig.MAX_PROMPT_LENGTH + 500) }
        });

        assert.strictEqual(
            saved.improve.prompt.length,
            ocrConfig.MAX_PROMPT_LENGTH
        );
    });
});

test('improveText ปฏิเสธเมื่อไม่มี key หรือข้อความว่าง', async function () {
    await assert.rejects(
        function () {
            return improve.improveText('ข้อความ', { apiKey: '' });
        },
        /API key ของ Gemini/
    );

    await assert.rejects(
        function () {
            return improve.improveText('   ', { apiKey: 'k' });
        },
        /ไม่มีข้อความให้ปรับปรุง/
    );
});

test('improveText แปลงสถานะ 429 เป็นข้อความที่ผู้ใช้อ่านเข้าใจ', async function () {
    const originalFetch = global.fetch;

    global.fetch = async function () {
        return {
            ok: false,
            status: 429,
            json: async function () {
                return { error: { message: 'quota exceeded' } };
            }
        };
    };

    try {
        await assert.rejects(
            function () {
                return improve.improveText('ข้อความ', { apiKey: 'k' });
            },
            /โควตาหรือ rate limit/
        );

    } finally {
        global.fetch = originalFetch;
    }
});

test('improveText ไม่คืนข้อความบางส่วนเมื่อก้อนหลังล้มเหลว', async function () {
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async function () {
        calls += 1;

        if (calls === 1) {
            return {
                ok: true,
                status: 200,
                json: async function () {
                    return {
                        candidates: [
                            { content: { parts: [{ text: 'ก้อนแรก: ok' }] } }
                        ]
                    };
                }
            };
        }

        return {
            ok: false,
            status: 500,
            json: async function () {
                return {};
            }
        };
    };

    try {
        await assert.rejects(
            function () {
                return improve.improveText(
                    'หนึ่ง\nสอง\nสาม',
                    { apiKey: 'k', chunkChars: 8 }
                );
            },
            /เซิร์ฟเวอร์ Gemini/
        );

    } finally {
        global.fetch = originalFetch;
    }
});
