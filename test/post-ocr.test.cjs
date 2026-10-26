// เทสต์ post-OCR: chunk / vector few-shot / prompt / ตรวจคำตอบ / เลือก engine
//
// ครอบเฉพาะส่วนที่ไม่ต้องเรียกเน็ตหรือโหลดโมเดล — ส่วนที่เรียก Gemini จริง
// และ Qwen ในเครื่องทดสอบผ่าน test:integration
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const postOcr = require('../src/main/post-ocr.cjs');

test('chunkText เก็บทุกบรรทัดและไม่เกินขนาดที่กำหนด', function () {
    const lines = [];

    for (let index = 1; index <= 60; index++) {
        lines.push('บรรทัดที่ ' + index + ' ' + 'ก'.repeat(20));
    }

    const text = lines.join('\n');
    const chunks = postOcr.chunkText(text, 200);

    assert.ok(chunks.length > 1, 'ข้อความยาวต้องถูกแบ่งหลายก้อน');

    chunks.forEach(function (chunk) {
        assert.ok(
            chunk.length <= 200,
            'ก้อนต้องไม่เกิน 200 ตัวอักษร แต่ได้ ' + chunk.length
        );
    });

    const rebuilt = chunks
        .join('\n')
        .split('\n')
        .filter(function (line) {
            return line.trim() !== '';
        });

    assert.deepStrictEqual(rebuilt, lines);
});

test('chunkText ตัดบรรทัดเดียวยาวเกินขนาดออกเป็นหลายก้อน', function () {
    const chunks = postOcr.chunkText('ข'.repeat(250), 100);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0].length, 100);
    assert.strictEqual(chunks[2].length, 50);
});

test('chunkText ไม่คืนก้อนที่เป็นช่องว่างล้วน', function () {
    const chunks = postOcr.chunkText('\n\n  \nข้อความ\n\n   \nอีกบรรทัด\n\n', 100);

    chunks.forEach(function (chunk) {
        assert.ok(chunk.trim() !== '', 'ต้องไม่มีก้อนที่ว่างเปล่า');
    });

    const joined = chunks.join('\n');

    assert.ok(joined.includes('ข้อความ'));
    assert.ok(joined.includes('อีกบรรทัด'));
});

test('buildUnits โหมด line: หนึ่งบรรทัด = หนึ่งหน่วย และคงบรรทัดว่างไว้', function () {
    const built = postOcr.buildUnits(
        'จา นวนเงนิ 4,000.00 บาท\n\n  ผตู้ รวจสอบ  ',
        'line'
    );

    assert.strictEqual(built.unit, 'line');
    assert.deepStrictEqual(built.units, [
        'จา นวนเงนิ 4,000.00 บาท',
        'ผตู้ รวจสอบ'
    ]);

    assert.strictEqual(
        postOcr.assemble(built.parts, [
            'จำนวนเงิน 4,000.00 บาท',
            'ผู้ตรวจสอบ'
        ]),
        'จำนวนเงิน 4,000.00 บาท\n\n  ผู้ตรวจสอบ  '
    );
});

test('buildUnits โหมด sentence: แยกประโยคในบรรทัดเดียวและต่อกลับได้เท่าเดิม', function () {
    const text = 'ทดสอบหนึ่ง. ทดสอบสอง!';
    const built = postOcr.buildUnits(text, 'sentence');

    assert.strictEqual(built.unit, 'sentence');
    assert.strictEqual(built.units.length, 2, 'ต้องแยกเป็น 2 ประโยค');
    assert.strictEqual(postOcr.assemble(built.parts, built.units), text);
});

test('buildUnits โหมด chunk รวมบรรทัดสั้นเป็นก้อนเดียว และ normalizeUnit กันค่าที่ไม่รู้จัก', function () {
    const built = postOcr.buildUnits('หนึ่ง\nสอง', 'chunk', 1200);

    assert.strictEqual(built.units.length, 1);
    assert.strictEqual(postOcr.normalizeUnit('bogus'), 'chunk');
    assert.strictEqual(postOcr.DEFAULT_UNIT, 'chunk');
});

test('resolveUnit: AI API ส่งทั้งก้อนเสมอ ไม่สนใจค่าที่เลือก', function () {
    assert.strictEqual(postOcr.resolveUnit('api', 'line'), 'chunk');
    assert.strictEqual(postOcr.resolveUnit('api', 'sentence'), 'chunk');
    assert.strictEqual(postOcr.resolveUnit('api', undefined), 'chunk');

    assert.strictEqual(postOcr.resolveUnit('local', 'line'), 'line');
    assert.strictEqual(postOcr.resolveUnit('local', 'sentence'), 'sentence');
    assert.strictEqual(postOcr.resolveUnit('local', 'bogus'), 'chunk');
});

test('isAcceptableOutput กันคำตอบที่จำนวนบรรทัดไม่เท่าเดิม', function () {
    assert.strictEqual(postOcr.isAcceptableOutput('a\nb', 'a\nb', 'chunk'), true);
    assert.strictEqual(
        postOcr.isAcceptableOutput('a\nb\nc', 'a\nb', 'chunk'),
        false
    );
    assert.strictEqual(postOcr.isAcceptableOutput('a b', 'a\nb', 'line'), true);
    assert.strictEqual(postOcr.isAcceptableOutput(null, 'a', 'line'), false);
});

test('ชุดตัวอย่าง built-in แก้เฉพาะคำ ไม่เปลี่ยนจำนวนบรรทัด', function () {
    const examples = postOcr.loadExamples();

    assert.ok(examples.length > 0);

    examples.forEach(function (example) {
        assert.strictEqual(
            postOcr.nonEmptyLineCount(example.output),
            postOcr.nonEmptyLineCount(example.input),
            'ตัวอย่าง "' + example.input + '" ต้องมีจำนวนบรรทัดเท่าเดิม'
        );
    });
});

test('cleanUnitOutput ต่อบรรทัดที่โมเดลเผลอแบ่งกลับเป็นบรรทัดเดียว', function () {
    const raw = 'จำนวนเงิน 4,000.00 บาท\nวันที่ 25/10/2569';
    const original = 'จา นวนเงนิ 4,000.00 บาท วันที่ 25/10/2569';

    assert.strictEqual(
        postOcr.cleanUnitOutput(raw, original, 'line'),
        'จำนวนเงิน 4,000.00 บาท วันที่ 25/10/2569'
    );

    assert.strictEqual(postOcr.cleanUnitOutput(raw, raw, 'chunk'), raw);
    assert.strictEqual(postOcr.cleanUnitOutput('   ', original, 'line'), null);
});

test('SYSTEM_PROMPT สั่งแก้คำผิดอย่างเดียว ไม่ให้แบ่งประโยค', function () {
    assert.ok(postOcr.SYSTEM_PROMPT.includes('ห้ามแบ่งประโยค'));
    assert.ok(postOcr.SYSTEM_PROMPT.includes('คงจำนวนบรรทัด'));
    assert.ok(!/ให้แต่ละประโยคขึ้นบรรทัดใหม่/.test(postOcr.SYSTEM_PROMPT));
});

test('charNgramVector เป็นเวกเตอร์หนึ่งหน่วย และข้อความเดียวกันได้ cosine = 1', function () {
    const vector = postOcr.charNgramVector('แบบขออนุมัติเบิกเงิน');

    const length = Math.sqrt(vector.reduce(function (sum, item) {
        return sum + item * item;
    }, 0));

    assert.ok(Math.abs(length - 1) < 1e-9, 'ความยาวเวกเตอร์ต้องเป็น 1');

    assert.ok(
        Math.abs(
            postOcr.cosine(
                vector,
                postOcr.charNgramVector('แบบขออนุมัติเบิกเงิน')
            ) - 1
        ) < 1e-9
    );

    assert.ok(
        postOcr.cosine(vector, postOcr.charNgramVector('วันที่')) < 0.9,
        'ข้อความต่างกันต้องได้คะแนนต่ำกว่า'
    );
});

test('cosine คืน 0 เมื่อเวกเตอร์ว่างหรือขนาดไม่ตรงกัน', function () {
    assert.strictEqual(postOcr.cosine([], []), 0);
    assert.strictEqual(postOcr.cosine([1, 2], [1, 2, 3]), 0);
    assert.strictEqual(postOcr.cosine(null, [1]), 0);
});

test('selectExamples เลือกตัวอย่างที่ใกล้เคียงข้อความมากที่สุดก่อน', function () {
    const examples = [
        { input: 'จำนวนเงน', output: 'จำนวนเงิน' },
        { input: 'วันที่ ๑ มกราคม ๒๕๖๙', output: 'วันที่ 1 มกราคม 2569' },
        { input: 'เลขทเอกสาร RC05', output: 'เลขที่เอกสาร RC05' }
    ];

    const selected = postOcr.selectExamples('จำนวนเงน', examples, 1);

    assert.strictEqual(selected.length, 1);
    assert.strictEqual(selected[0].output, 'จำนวนเงิน');
});

test('selectExamples ใช้ embedding ที่ส่งมาแทน char n-gram', function () {
    const examples = [
        { input: 'ก', output: 'หนึ่ง' },
        { input: 'ข', output: 'สอง' }
    ];

    const selected = postOcr.selectExamples('ข้อความอะไรก็ได้', examples, 1, {
        textVector: [1, 0],
        exampleVectors: [[0, 1], [1, 0]]
    });

    assert.strictEqual(selected[0].output, 'สอง');
});

test('selectExamples ไม่เกินจำนวนที่ขอ และคืน [] เมื่อไม่มีตัวอย่าง', function () {
    const examples = [
        { input: 'ก', output: '1' },
        { input: 'ข', output: '2' },
        { input: 'ค', output: '3' }
    ];

    assert.strictEqual(postOcr.selectExamples('ก', examples, 2).length, 2);
    assert.deepStrictEqual(postOcr.selectExamples('ก', [], 3), []);
});

test('buildMessages วาง system prompt, คู่ตัวอย่าง แล้วปิดด้วยข้อความจริง', function () {
    const examples = [
        { input: 'จำนวนเงน', output: 'จำนวนเงิน' }
    ];

    const messages = postOcr.buildMessages('ข้อความจาก OCR', examples);

    assert.strictEqual(messages[0].role, 'system');
    assert.strictEqual(messages[0].content, postOcr.SYSTEM_PROMPT);

    assert.strictEqual(messages[1].role, 'user');
    assert.ok(messages[1].content.includes('จำนวนเงน'));
    assert.strictEqual(messages[2].role, 'assistant');
    assert.strictEqual(messages[2].content, 'จำนวนเงิน');

    const last = messages[messages.length - 1];

    assert.strictEqual(last.role, 'user');
    assert.ok(last.content.includes('ข้อความจาก OCR'));
});

test('toGeminiBody แปลง system/assistant เป็นรูปแบบ Gemini', function () {
    const body = postOcr.toGeminiBody(
        postOcr.buildMessages('ทดสอบ', []),
        { maxOutputTokens: 1234 }
    );

    assert.ok(body.systemInstruction.parts[0].text.includes('ตัวแก้ไขข้อความ'));
    assert.strictEqual(body.contents.length, 1);
    assert.strictEqual(body.contents[0].role, 'user');
    assert.strictEqual(body.generationConfig.temperature, 0);
    assert.strictEqual(body.generationConfig.maxOutputTokens, 1234);
});

test('sanitizeOutput ตัด code fence และป้ายนำหน้าคำตอบ', function () {
    const raw = '```th\nข้อความที่แก้ไขแล้ว: แบบขออนุมัติเบิกเงิน\n```';

    assert.strictEqual(
        postOcr.sanitizeOutput(raw, 'แบบขออนุมัติเบิกเงน'),
        'แบบขออนุมัติเบิกเงิน'
    );
});

test('sanitizeOutput คืน null เมื่อคำตอบสั้นหรือยาวผิดรูป', function () {
    const original = 'แบบขออนุมัติเบิกเงิน จำนวน 4,000.00 บาท';

    assert.strictEqual(postOcr.sanitizeOutput('สั้น', original), null);
    assert.strictEqual(
        postOcr.sanitizeOutput(original + original + original, original),
        null
    );
    assert.strictEqual(postOcr.sanitizeOutput('   ', original), null);
});

test('sanitizeOutput คืน null เมื่อโมเดลส่ง prompt กลับมา', function () {
    assert.strictEqual(
        postOcr.sanitizeOutput(postOcr.SYSTEM_PROMPT, 'ข้อความเดิม'),
        null
    );
});

test('missingNumbers ตรวจตัวเลข/วันที่/รหัสที่หายไป', function () {
    assert.deepStrictEqual(
        postOcr.missingNumbers(
            'จำนวน 4,000.00 บาท วันที่ 25/10/2569 เลขที่ 702057001',
            'จำนวน 4,000.00 บาท เลขที่ 702057001'
        ),
        ['25/10/2569']
    );

    assert.deepStrictEqual(
        postOcr.missingNumbers('ไม่มีตัวเลข', 'ไม่มีตัวเลข'),
        []
    );
});

test('buildMessages แบบ strict เน้นย้ำเรื่องตัวเลขและทุกบรรทัด', function () {
    const normal = postOcr.buildMessages('ข้อความ', []);
    const strict = postOcr.buildMessages('ข้อความ', [], { strict: true });

    const lastNormal = normal[normal.length - 1].content;
    const lastStrict = strict[strict.length - 1].content;

    assert.ok(!lastNormal.includes('คำเตือน'));
    assert.ok(lastStrict.includes('คำเตือน'));
    assert.ok(lastStrict.includes('ตัวเลข'));
    assert.ok(lastStrict.includes('ข้อความ'));
});

test('countSentences นับเฉพาะบรรทัดที่มีข้อความ', function () {
    assert.strictEqual(
        postOcr.countSentences('ประโยคหนึ่ง\n\nประโยคสอง\n   \nประโยคสาม'),
        3
    );

    assert.strictEqual(postOcr.countSentences(''), 0);
});

test('processText ด้วย engine library คืนข้อความเดิมโดยไม่เรียกโมเดล', async function () {
    const text = 'ข้อความทดสอบ\nบรรทัดที่สอง';
    const result = await postOcr.processText(text, { engine: 'library' });

    assert.strictEqual(result.text, text);
    assert.strictEqual(result.engine, 'library');
    assert.strictEqual(result.chunks, 0);
    assert.strictEqual(result.sentences, 2);
    assert.deepStrictEqual(result.warnings, []);
});

test('processText ปฏิเสธข้อความว่าง', async function () {
    await assert.rejects(
        function () {
            return postOcr.processText('   ', { engine: 'library' });
        },
        /ไม่มีข้อความให้ปรับ/
    );
});

test('processText ด้วย engine api แจ้งเมื่อยังไม่มี API key', async function () {
    await assert.rejects(
        function () {
            return postOcr.processText('ข้อความทดสอบ', { engine: 'api' });
        },
        /API key ของ Gemini/
    );
});

test('processText ด้วย engine local แจ้งเมื่อยังไม่มีโมเดล Qwen', async function () {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-ocr-local-'));

    try {
        await assert.rejects(
            function () {
                return postOcr.processText('ข้อความทดสอบ', {
                    engine: 'local',
                    dataPath: dir
                });
            },
            /llama\.cpp|โมเดล Qwen2\.5-3B/
        );

    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('engine api ลองใหม่แบบ strict เมื่อคำตอบทำตัวเลขหาย', async function () {
    const originalFetch = global.fetch;
    const bodies = [];

    // รอบแรกทำตัวเลขหาย → รอบสอง (strict) ต้องได้บรรทัดเดิมครบทุกตัวเลข
    const replies = [
        'แบบขออนุมัติเบิกเงิน',
        'แบบขออนุมัติเบิกเงิน จำนวน 4,000.00 บาท วันที่ 25/10/2569'
    ];

    global.fetch = async function (url, init) {
        bodies.push(JSON.parse(init.body));

        const text = replies[Math.min(bodies.length - 1, replies.length - 1)];

        return {
            ok: true,
            status: 200,
            json: async function () {
                return {
                    candidates: [{ content: { parts: [{ text: text }] } }]
                };
            }
        };
    };

    try {
        const result = await postOcr.processText(
            'แบบขออนุมัติเบิกเงน จำนวน 4,000.00 บาท วันที่ 25/10/2569',
            { engine: 'api', apiKey: 'test-key', unit: 'chunk' }
        );

        assert.strictEqual(bodies.length, 2, 'ต้องเรียกซ้ำหนึ่งครั้ง');

        const firstUser = bodies[0].contents[bodies[0].contents.length - 1];
        const secondUser = bodies[1].contents[bodies[1].contents.length - 1];

        assert.ok(!firstUser.parts[0].text.includes('คำเตือน'));
        assert.ok(secondUser.parts[0].text.includes('คำเตือน'));

        assert.strictEqual(
            result.text,
            'แบบขออนุมัติเบิกเงิน จำนวน 4,000.00 บาท วันที่ 25/10/2569'
        );
        assert.deepStrictEqual(result.warnings, []);

    } finally {
        global.fetch = originalFetch;
    }
});

test('engine api ใช้ข้อความเดิมพร้อมแจ้งเตือน เมื่อคำตอบยังทำตัวเลขหาย', async function () {
    const originalFetch = global.fetch;
    let calls = 0;

    global.fetch = async function () {
        calls += 1;

        return {
            ok: true,
            status: 200,
            json: async function () {
                return {
                    candidates: [
                        { content: { parts: [{ text: 'แบบขออนุมัติเบิกเงิน' }] } }
                    ]
                };
            }
        };
    };

    const source = 'แบบขออนุมัติเบิกเงน จำนวน 4,000.00 บาท วันที่ 25/10/2569';

    try {
        await assert.rejects(
            function () {
                return postOcr.processText(source, {
                    engine: 'api',
                    apiKey: 'test-key'
                });
            },
            /ใช้ข้อความเดิม/
        );

        assert.strictEqual(calls, 2, 'ต้องลองใหม่หนึ่งครั้งก่อนใช้ข้อความเดิม');

    } finally {
        global.fetch = originalFetch;
    }
});

test('engine api ใช้คู่ที่ฝึกเอง (หน้า ฝึก OCR) เป็น few-shot', async function () {
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
                        {
                            content: {
                                parts: [{ text: 'รหัสทดสอบ XYZ99 ถูก' }]
                            }
                        }
                    ]
                };
            }
        };
    };

    try {
        const result = await postOcr.processText('รหัสทดสอบ XYZ99 ผด', {
            engine: 'api',
            apiKey: 'test-key',
            examples: [
                {
                    input: 'รหัสทดสอบ XYZ99 ผด',
                    output: 'รหัสทดสอบ XYZ99 ถูก'
                }
            ]
        });

        assert.strictEqual(result.text, 'รหัสทดสอบ XYZ99 ถูก');

        const modelTurns = body.contents.filter(function (item) {
            return item.role === 'model';
        });

        assert.ok(
            modelTurns.some(function (item) {
                return item.parts[0].text === 'รหัสทดสอบ XYZ99 ถูก';
            }),
            'คำตอบของคู่ที่ฝึกต้องถูกใส่ใน prompt'
        );

    } finally {
        global.fetch = originalFetch;
    }
});

test('processText ด้วย engine api ส่งคำขอและใช้คำตอบที่แก้แล้ว', async function () {
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
                                    { text: 'แบบขออนุมัติเบิกเงิน\nจำนวน 4,000.00 บาท' }
                                ]
                            },
                            finishReason: 'STOP'
                        }
                    ]
                };
            }
        };
    };

    try {
        const result = await postOcr.processText(
            'แบบขออนุมัติเบิกเงน\nจำนวน 4,000.00 บาท',
            {
                engine: 'api',
                apiKey: 'test-key',
                model: 'gemini-2.5-flash',
                unit: 'chunk',
                chunkChars: 500
            }
        );

        assert.strictEqual(result.engine, 'api');
        assert.strictEqual(result.chunks, 1);
        assert.strictEqual(result.sentences, 2);
        assert.strictEqual(
            result.text,
            'แบบขออนุมัติเบิกเงิน\nจำนวน 4,000.00 บาท'
        );

        assert.strictEqual(calls.length, 1);
        assert.ok(
            calls[0].url.includes('models/gemini-2.5-flash:generateContent')
        );
        assert.strictEqual(calls[0].init.headers['x-goog-api-key'], 'test-key');

        const body = JSON.parse(calls[0].init.body);

        assert.ok(Array.isArray(body.contents));
        assert.ok(body.systemInstruction.parts[0].text.includes('OCR'));
        assert.strictEqual(body.generationConfig.temperature, 0);

    } finally {
        global.fetch = originalFetch;
    }
});

test('runChunks โหมด line ส่งทีละบรรทัดและรักษาโครงสร้างเดิม', async function () {
    const calls = [];

    const result = await postOcr.runChunks(
        'จา นวนเงนิ 4,000.00 บาท\n\nผตู้ รวจสอบ',
        {
            unit: 'line',
            call: function (chunk) {
                calls.push(chunk);

                return Promise.resolve(
                    chunk.replace('จา นวนเงนิ', 'จำนวนเงิน')
                );
            }
        }
    );

    assert.deepStrictEqual(calls, [
        'จา นวนเงนิ 4,000.00 บาท',
        'ผตู้ รวจสอบ'
    ]);

    assert.strictEqual(result.unit, 'line');
    assert.strictEqual(result.chunks, 2);
    assert.strictEqual(
        result.text,
        'จำนวนเงิน 4,000.00 บาท\n\nผตู้ รวจสอบ'
    );
    assert.deepStrictEqual(result.warnings, []);
});

test('runChunks ไม่รับคำตอบที่ยุบ/แยกบรรทัดและใช้ข้อความเดิม', async function () {
    let calls = 0;

    await assert.rejects(
        function () {
            return postOcr.runChunks('บรรทัดหนึ่ง\nบรรทัดสอง', {
                unit: 'chunk',
                call: function () {
                    calls += 1;

                    return Promise.resolve(
                        'บรรทัดหนึ่ง\nบรรทัดสอง\nบรรทัดสาม'
                    );
                }
            });
        },
        /ใช้ข้อความเดิม/
    );

    assert.strictEqual(calls, 2, 'ต้องลองใหม่หนึ่งครั้งก่อนยอมแพ้');
});

test('processText ด้วย api ส่งทั้งก้อนแม้ตั้งให้แก้ทีละบรรทัด', async function () {
    const originalFetch = global.fetch;
    const bodies = [];

    global.fetch = async function (url, init) {
        const body = JSON.parse(init.body);

        bodies.push(body);

        const request = body.contents[body.contents.length - 1].parts[0].text;
        const text = request.split('\n').slice(1).join('\n');

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
                                        text: text.replace(
                                            'จา นวนเงนิ',
                                            'จำนวนเงิน'
                                        )
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
        const result = await postOcr.processText(
            'จา นวนเงนิ 4,000.00 บาท\nผตู้ รวจสอบ\nวันที่ 25/10/2569',
            { engine: 'api', apiKey: 'test-key', unit: 'line' }
        );

        assert.strictEqual(bodies.length, 1, 'ต้องส่งทั้งก้อนในคำขอเดียว');
        assert.strictEqual(result.unit, 'chunk');
        assert.strictEqual(result.chunks, 1);
        assert.strictEqual(
            result.text,
            'จำนวนเงิน 4,000.00 บาท\nผตู้ รวจสอบ\nวันที่ 25/10/2569'
        );

    } finally {
        global.fetch = originalFetch;
    }
});

test('ocr-config เก็บและตรวจค่า postOcr.unit', function () {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const ocrConfig = require('../src/main/ocr-config.cjs');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-ocr-unit-'));

    try {
        assert.strictEqual(ocrConfig.read(dir).postOcr.unit, 'chunk');

        ocrConfig.save(dir, { postOcr: { unit: 'sentence' } });
        assert.strictEqual(ocrConfig.read(dir).postOcr.unit, 'sentence');
        assert.strictEqual(
            ocrConfig.readSecrets(dir).postOcr.unit,
            'sentence'
        );

        // ค่าที่ไม่รู้จักต้องไม่เขียนทับค่าเดิม
        ocrConfig.save(dir, { postOcr: { unit: 'unknown' } });
        assert.strictEqual(ocrConfig.read(dir).postOcr.unit, 'sentence');

        ocrConfig.save(dir, { postOcr: { unit: 'chunk' } });
        assert.strictEqual(ocrConfig.read(dir).postOcr.unit, 'chunk');

    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('ocr-config เก็บและตรวจค่า postOcr.engine', function () {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const ocrConfig = require('../src/main/ocr-config.cjs');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'post-ocr-config-'));

    try {
        assert.strictEqual(ocrConfig.read(dir).postOcr.engine, 'library');

        ocrConfig.save(dir, { postOcr: { engine: 'local' } });
        assert.strictEqual(ocrConfig.read(dir).postOcr.engine, 'local');

        // ค่าที่ไม่รู้จักต้องไม่เขียนทับค่าเดิม
        ocrConfig.save(dir, { postOcr: { engine: 'unknown' } });
        assert.strictEqual(ocrConfig.read(dir).postOcr.engine, 'local');

        ocrConfig.save(dir, { postOcr: { engine: 'api' } });
        assert.strictEqual(ocrConfig.readSecrets(dir).postOcr.engine, 'api');

    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('loadExamples อ่านชุดตัวอย่างผิด → ถูก ที่เตรียมไว้ได้', function () {
    const examples = postOcr.loadExamples();

    assert.ok(examples.length > 0, 'ต้องมีชุดตัวอย่างใน post-ocr-examples.json');

    examples.forEach(function (example) {
        assert.strictEqual(typeof example.input, 'string');
        assert.strictEqual(typeof example.output, 'string');
        assert.ok(example.input.trim() !== '');
        assert.ok(example.output.trim() !== '');
    });
});
