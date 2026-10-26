// OCR Config Page - ตั้งค่าว่าจะใช้ OCR จากที่ไหนเมื่ออัปโหลด PDF
//
// ผู้ให้บริการที่เลือกได้:
//   - PaddleOCR (Local AI)    ทำงานในเครื่อง ไม่ต้องใช้ API key
//   - PaddleOCR-VL (Local AI) โมเดล vision-language ในเครื่อง (llama.cpp)
//   - Gemini API              ใช้ API key ของ Google AI Studio
//   - i love api              ใช้ Public Key ของ iLoveAPI (iLovePDF)
//
// ค่าตั้งถูกเก็บฝั่ง main process ที่ data/ocr-config.json
// (ดู src/main/ocr-config.cjs) — API key ถูกเข้ารหัสด้วย safeStorage
// และไม่ถูกส่งกลับมาที่หน้าจอนี้ (หน้าจอรู้แค่ว่า "มี key เก็บไว้แล้ว")
(function (scope) {
    'use strict';

    const HTML = [
        '<h1>ตั้งค่า OCR</h1>',

        '<div class="ocr-page" id="ocrConfigPage">',

        '    <p class="hint ocr-intro">',
        '        ใช้เมื่ออัปโหลดไฟล์ PDF ที่เป็นรูปสแกน (ไม่มีชั้นข้อความ) ',
        '        ระบบจะอ่านข้อความด้วย OCR ให้อัตโนมัติ ก่อนเอาไปจับค่าด้วย regex',
        '    </p>',

        // ── ผู้ให้บริการ ──
        '    <section class="suggest-settings">',
        '        <h2>ผู้ให้บริการ OCR</h2>',

        '        <div class="ocr-providers">',

        '            <label class="ocr-provider">',
        '                <input type="radio" name="ocrProvider" value="paddle" id="ocrProviderPaddle">',
        '                <span class="ocr-provider-body">',
        '                    <span class="ocr-provider-title">',
        '                        <strong>PaddleOCR (Local AI)</strong>',
        '                        <span class="ocr-badge ok">ในเครื่อง · ฟรี</span>',
        '                    </span>',
        '                    <small>ทำงานในเครื่องนี้ทั้งหมด — ไม่ต้องใช้ API key ',
        '                        และไม่ต้องต่ออินเทอร์เน็ตหลังโหลดโมเดลครั้งแรกแล้ว',
        '                        (โมเดล PP-OCRv5 ภาษาไทย + อังกฤษ)</small>',
        '                </span>',
        '            </label>',

        '            <label class="ocr-provider">',
        '                <input type="radio" name="ocrProvider" value="paddleVL" id="ocrProviderPaddleVl">',
        '                <span class="ocr-provider-body">',
        '                    <span class="ocr-provider-title">',
        '                        <strong>PaddleOCR-VL 0.9B (Local AI)</strong>',
        '                        <span class="ocr-badge ok">ในเครื่อง · ฟรี</span>',
        '                    </span>',
        '                    <small>โมเดล vision-language รุ่นใหม่ อ่านข้อความ ตาราง และเอกสารซับซ้อน ',
        '                        ทำงานในเครื่องทั้งหมด — ดาวน์โหลดโมเดลครั้งแรก ~1.8 GB</small>',
        '                </span>',
        '            </label>',

        '            <label class="ocr-provider">',
        '                <input type="radio" name="ocrProvider" value="gemini" id="ocrProviderGemini">',
        '                <span class="ocr-provider-body">',
        '                    <span class="ocr-provider-title">',
        '                        <strong>Gemini API</strong>',
        '                        <span class="ocr-badge pending">ใช้ API key</span>',
        '                    </span>',
        '                    <small>ส่งภาพแต่ละหน้าให้ Google Gemini อ่าน — ',
        '                        ต้องต่ออินเทอร์เน็ตและมี API key ของ Google AI Studio</small>',
        '                </span>',
        '            </label>',

        '            <label class="ocr-provider">',
        '                <input type="radio" name="ocrProvider" value="iloveapi" id="ocrProviderIloveapi">',
        '                <span class="ocr-provider-body">',
        '                    <span class="ocr-provider-title">',
        '                        <strong>i love api</strong>',
        '                        <span class="ocr-badge pending">ใช้ Public Key</span>',
        '                    </span>',
        '                    <small>ส่ง PDF ทั้งไฟล์ให้ iLoveAPI ทำ OCR แล้วอ่านข้อความที่ได้ — ',
        '                        ต้องต่ออินเทอร์เน็ตและมี Public Key ของโปรเจกต์</small>',
        '                </span>',
        '            </label>',

        '        </div>',
        '    </section>',

        // ── พฤติกรรม ──
        '    <section class="suggest-settings">',
        '        <h2>การทำงาน</h2>',

        '        <label class="switch-toggle">',
        '            <input type="checkbox" id="ocrEnabled">',
        '            <span class="switch-box"></span>',
        '            <span>ใช้ OCR เมื่ออัปโหลด PDF</span>',
        '        </label>',

        '        <div class="ocr-mode">',
        '            <span class="ocr-mode-label">ช่วงที่ให้ OCR</span>',

        '            <label class="ocr-choice">',
        '                <input type="radio" name="ocrMode" value="auto" id="ocrModeAuto" checked>',
        '                <span>',
        '                    <strong>เฉพาะหน้าที่เป็นรูปสแกน (แนะนำ)</strong>',
        '                    <small>หน้าที่ยังมีชั้นข้อความอยู่แล้วจะใช้ข้อความเดิม — เร็วกว่าและไม่ผิดเพี้ยน</small>',
        '                </span>',
        '            </label>',

        '            <label class="ocr-choice">',
        '                <input type="radio" name="ocrMode" value="always" id="ocrModeAlways">',
        '                <span>',
        '                    <strong>ทุกหน้า</strong>',
        '                    <small>ใช้ข้อความจาก OCR แทนข้อความในไฟล์ทุกหน้า — ช้ากว่า แต่ช่วยเมื่อชั้นข้อความเป็นขยะ</small>',
        '                </span>',
        '            </label>',
        '        </div>',
        '    </section>',

        // ── PaddleOCR ──
        '    <section class="suggest-settings ocr-provider-settings" id="ocrPaddleSection">',
        '        <h2>PaddleOCR (Local AI)</h2>',

        '        <label class="switch-toggle">',
        '            <input type="checkbox" id="ocrTwoStage">',
        '            <span class="switch-box"></span>',
        '            <span>Two-Stage Localized OCR (อ่านทีละบริเวณ)</span>',
        '        </label>',

        '        <p class="hint">',
        '            ระยะที่ 1 หาตำแหน่งข้อความบนหน้าก่อน ระยะที่ 2 ครอปเฉพาะบริเวณนั้น ',
        '            จากภาพความละเอียดสูง (~300 DPI) มาอ่านด้วย PP-OCRv5 — ',
        '            แม่นขึ้นเมื่อตัวอักษรเล็กหรือหน้ามีหลายคอลัมน์ แต่ใช้เวลามากกว่าปกติ',
        '        </p>',

        '        <p class="hint">',
        '            ครั้งแรกที่ใช้ ระบบจะดาวน์โหลดโมเดล (~15 MB) มาเก็บไว้ในเครื่อง ',
        '            หลังจากนั้น OCR จะทำงานออฟไลน์ได้',
        '        </p>',

        '        <div class="ocr-status-box" id="ocrStatusBox">',
        '            <p class="ocr-status-head" id="ocrStatusTitle">กำลังตรวจสอบสถานะ...</p>',
        '            <p class="hint" id="ocrStatusDetail"></p>',
        '        </div>',

        '        <div class="form-actions page-actions ocr-actions">',
        '            <button id="ocrRefreshBtn" type="button" class="plain">ตรวจสอบสถานะ</button>',
        '            <button id="ocrPrepareBtn" type="button" class="plain">เตรียมโมเดล OCR</button>',
        '        </div>',
        '    </section>',

        // ── PaddleOCR-VL ──
        '    <section class="suggest-settings ocr-provider-settings" id="ocrVlSection" hidden>',
        '        <h2>PaddleOCR-VL 0.9B (Local AI)</h2>',

        '        <p class="hint">',
        '            ทำงานในเครื่องผ่าน llama.cpp — หลังดาวน์โหลดเสร็จไม่ต้องต่ออินเทอร์เน็ต ',
        '            และไม่มีข้อมูลส่งออกไปข้างนอก ครั้งแรกต้องดาวน์โหลด engine (~24 MB) ',
        '            และโมเดล (~1.8 GB) โดยใช้เวลาหลายนาทีต่อหน้าเมื่อทำงานด้วย CPU',
        '        </p>',

        '        <div class="ocr-status-box">',
        '            <p class="ocr-status-head" id="ocrVlStatusTitle">กำลังตรวจสอบสถานะ...</p>',
        '            <p class="hint" id="ocrVlStatusDetail"></p>',
        '        </div>',

        '        <div class="form-actions page-actions ocr-actions">',
        '            <button id="ocrVlRefreshBtn" type="button" class="plain">ตรวจสอบสถานะ</button>',
        '            <button id="ocrVlPrepareBtn" type="button" class="plain">เตรียมโมเดล (~1.8 GB)</button>',
        '            <button id="ocrVlRemoveBtn" type="button" class="plain danger" disabled>ถอนการติดตั้ง</button>',
        '        </div>',

        '        <p class="hint">',
        '            ดาวน์โหลดจาก GitHub (llama.cpp) และ Hugging Face (PaddleOCR-VL 1.6) ',
        '            เก็บไว้ในโฟลเดอร์ data ของแอป — "ถอนการติดตั้ง" จะลบ engine และโมเดล ',
        '            คืนพื้นที่ทั้งหมด แต่ครั้งถัดไปที่เลือกผู้ให้บริการนี้จะต้องดาวน์โหลดใหม่',
        '        </p>',
        '    </section>',

        // ── Gemini ──
        '    <section class="suggest-settings ocr-provider-settings" id="ocrGeminiSection" hidden>',
        '        <h2>Gemini API</h2>',

        '        <div class="field">',
        '            <label for="ocrGeminiKey">API key</label>',
        '            <input type="password" id="ocrGeminiKey" autocomplete="new-password" spellcheck="false">',
        '            <p class="hint" id="ocrGeminiKeyHint"></p>',
        '        </div>',

        '        <div class="field">',
        '            <label for="ocrGeminiModel">โมเดล</label>',
        '            <input type="text" id="ocrGeminiModel" autocomplete="off" spellcheck="false"',
        '                   placeholder="gemini-2.5-flash">',
        '            <p class="hint">ชื่อโมเดลของ Gemini ที่รองรับการอ่านภาพ (ค่าเริ่มต้น gemini-2.5-flash)</p>',
        '        </div>',

        '        <div class="form-actions page-actions ocr-actions">',
        '            <button id="ocrGeminiClearBtn" type="button" class="plain">ลบ API key ที่เก็บไว้</button>',
        '        </div>',

        '        <p class="hint">',
        '            ขอ API key ได้ที่ <b>aistudio.google.com/apikey</b> — ',
        '            คีย์ถูกเก็บไว้ในเครื่องนี้ (เข้ารหัสด้วยระบบของ Windows) และไม่ถูกส่งไปที่อื่น',
        '            นอกจากคำขอ OCR ที่ส่งถึง Google',
        '        </p>',

        '        <p class="hint">',
        '            key และโมเดลชุดนี้ถูกใช้กับปุ่ม “ปรับปรุง” ในกล่องใส่ข้อมูลด้วย ',
        '            (ตรวจคำผิด + จัดข้อความเป็น “ชื่อฟิลด์: ค่า” ทีละบรรทัด)',
        '        </p>',
        '    </section>',

        // ── i love api ──
        '    <section class="suggest-settings ocr-provider-settings" id="ocrIloveSection" hidden>',
        '        <h2>i love api</h2>',

        '        <div class="field">',
        '            <label for="ocrIloveKey">Public Key</label>',
        '            <input type="password" id="ocrIloveKey" autocomplete="new-password" spellcheck="false">',
        '            <p class="hint" id="ocrIloveKeyHint"></p>',
        '        </div>',

        '        <div class="form-actions page-actions ocr-actions">',
        '            <button id="ocrIloveClearBtn" type="button" class="plain">ลบ API key ที่เก็บไว้</button>',
        '        </div>',

        '        <p class="hint">',
        '            ใช้ <b>Public Key</b> ของโปรเจกต์จาก iloveapi.com (ไม่ใช่ Secret Key) — ',
        '            ระบบจะส่ง PDF ทั้งไฟล์ไปทำ OCR และอ่านข้อความจากไฟล์ผลลัพธ์ ',
        '            การประมวลผลใช้โควตาตามบัญชีของท่าน (OCR 5 credits ต่อหน้า)',
        '        </p>',
        '    </section>',

        // ── ปรับปรุงข้อความด้วย AI (ปุ่ม “ปรับปรุง” ในกล่องใส่ข้อมูล) ──
        '    <section class="suggest-settings" id="ocrImproveSection">',
        '        <h2>ปรับปรุงข้อความด้วย AI</h2>',

        '        <p class="hint">',
        '            ใช้กับปุ่ม “ปรับปรุง” ในกล่องใส่ข้อมูล — ตรวจคำผิดและจัดข้อความเป็น ',
        '            “ชื่อฟิลด์: ค่า” ทีละบรรทัด ด้วย Gemini (key และโมเดลจากส่วน Gemini API) ',
        '            ข้อความต้นฉบับจะถูกต่อท้าย prompt นี้ให้อัตโนมัติ',
        '        </p>',

        '        <div class="field">',
        '            <label for="ocrImprovePrompt">Prompt ที่ส่งให้ AI</label>',
        '            <textarea id="ocrImprovePrompt" rows="14" spellcheck="false"></textarea>',
        '            <p class="hint" id="ocrImprovePromptHint"></p>',
        '        </div>',

        '        <div class="form-actions page-actions ocr-actions">',
        '            <button id="ocrImproveResetBtn" type="button" class="plain">คืนค่า prompt เริ่มต้น</button>',
        '        </div>',
        '    </section>',

        '    <div class="form-actions page-actions">',
        '        <button id="ocrSaveBtn" type="button">บันทึกการตั้งค่า</button>',
        '    </div>',

        '    <p id="ocrPageStatus" class="db-status"></p>',
        '</div>'
    ].join('\n');

    const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

    // ค่าล่าสุดจาก main process (ใช้ตัดสินว่า "มี key เก็บไว้แล้ว" ไหม)
    let settings = {
        provider: 'paddle',
        enabled: true,
        mode: 'auto',
        twoStage: false,
        improve: { prompt: '', defaultPrompt: '' },
        gemini: { model: DEFAULT_GEMINI_MODEL, hasKey: false },
        iloveapi: { hasKey: false }
    };

    function el(id) {
        return document.getElementById(id);
    }

    function api() {
        return window.electronAPI || null;
    }

    function setStatus(text, kind) {
        const status = el('ocrPageStatus');

        if (!status) return;

        status.textContent = text || '';
        status.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    function formatSize(bytes) {
        const value = Number(bytes) || 0;

        if (value < 1024) return value + ' B';
        if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
        if (value < 1024 * 1024 * 1024) {
            return (value / (1024 * 1024)).toFixed(1) + ' MB';
        }

        return (value / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    }

    // ──────────────────────────────────────────────────────────────
    // ผู้ให้บริการที่เลือก / ส่วนตั้งค่าที่แสดง
    // ──────────────────────────────────────────────────────────────

    function selectedProvider() {
        const checked = document.querySelector(
            'input[name="ocrProvider"]:checked'
        );

        return checked ? checked.value : 'paddle';
    }

    function selectProvider(provider) {
        const radio = document.querySelector(
            'input[name="ocrProvider"][value="' + provider + '"]'
        );

        if (radio) {
            radio.checked = true;
        } else {
            el('ocrProviderPaddle').checked = true;
        }

        updateProviderSections();
    }

    function updateProviderSections() {
        const provider = selectedProvider();

        el('ocrPaddleSection').hidden = provider !== 'paddle';
        el('ocrVlSection').hidden = provider !== 'paddleVL';
        el('ocrGeminiSection').hidden = provider !== 'gemini';
        el('ocrIloveSection').hidden = provider !== 'iloveapi';
    }

    // ปิดช่องเลือกช่วงการทำงานเมื่อ OCR ถูกปิด
    function updateModeState() {
        const enabled = el('ocrEnabled').checked;

        el('ocrModeAuto').disabled = !enabled;
        el('ocrModeAlways').disabled = !enabled;
    }

    // ──────────────────────────────────────────────────────────────
    // ค่าที่กรอกอยู่บนหน้าจอ
    // ──────────────────────────────────────────────────────────────

    function applyConfig(config) {
        const value = config || {};

        settings = {
            provider: value.provider || 'paddle',
            enabled: value.enabled !== false,
            mode: value.mode === 'always' ? 'always' : 'auto',
            twoStage: value.twoStage === true,
            improve: {
                prompt: (value.improve && value.improve.prompt) || '',
                defaultPrompt: (value.improve && value.improve.defaultPrompt) || ''
            },
            gemini: {
                model: (value.gemini && value.gemini.model) || DEFAULT_GEMINI_MODEL,
                hasKey: Boolean(value.gemini && value.gemini.hasKey)
            },
            iloveapi: {
                hasKey: Boolean(value.iloveapi && value.iloveapi.hasKey)
            }
        };

        selectProvider(settings.provider);

        el('ocrEnabled').checked = settings.enabled;
        el('ocrTwoStage').checked = settings.twoStage;

        el('ocrModeAuto').checked = settings.mode !== 'always';
        el('ocrModeAlways').checked = settings.mode === 'always';

        el('ocrGeminiModel').value = settings.gemini.model;
        el('ocrGeminiKey').value = '';
        el('ocrIloveKey').value = '';

        // prompt ที่แก้เอง — ถ้ายังไม่เคยแก้ (= ว่าง) ให้แสดงค่าเริ่มต้นให้เห็นและแก้ได้
        el('ocrImprovePrompt').value =
            settings.improve.prompt || settings.improve.defaultPrompt;

        updateKeyHints();
        updateImprovePromptHint();
        updateModeState();
    }

    // บอกว่าตอนนี้ใช้ prompt ที่แก้เองหรือค่าเริ่มต้น (+ เตือนให้กดบันทึก)
    function updateImprovePromptHint() {
        const textarea = el('ocrImprovePrompt');
        const hint = el('ocrImprovePromptHint');

        if (!textarea || !hint) return;

        const isDefault =
            textarea.value.trim() === settings.improve.defaultPrompt.trim();

        hint.textContent = isDefault
            ? 'ขณะนี้ใช้ prompt เริ่มต้น — แก้ข้อความข้างบนแล้วกด “บันทึกการตั้งค่า” เพื่อใช้เวอร์ชันของคุณ'
            : 'ใช้ prompt ที่แก้เอง — กด “บันทึกการตั้งค่า” เพื่อเก็บไว้ใช้กับปุ่ม ปรับปรุง';
    }

    function updateKeyHints() {
        const geminiHasKey = settings.gemini.hasKey;
        const iloveHasKey = settings.iloveapi.hasKey;

        el('ocrGeminiKeyHint').textContent = geminiHasKey
            ? 'มี API key เก็บไว้แล้ว — เว้นว่างเพื่อใช้ key เดิม'
            : 'ยังไม่มี API key — ต้องใส่ก่อนใช้ Gemini';

        el('ocrGeminiKey').placeholder = geminiHasKey
            ? '•••••••• (เว้นว่าง = ใช้ key เดิม)'
            : 'วาง API key ที่นี่';

        el('ocrIloveKeyHint').textContent = iloveHasKey
            ? 'มี Public Key เก็บไว้แล้ว — เว้นว่างเพื่อใช้ key เดิม'
            : 'ยังไม่มี Public Key — ต้องใส่ก่อนใช้ i love api';

        el('ocrIloveKey').placeholder = iloveHasKey
            ? '•••••••• (เว้นว่าง = ใช้ key เดิม)'
            : 'วาง Public Key ที่นี่';

        el('ocrGeminiClearBtn').disabled = !geminiHasKey;
        el('ocrIloveClearBtn').disabled = !iloveHasKey;
    }

    function currentPayload() {
        return {
            provider: selectedProvider(),
            enabled: el('ocrEnabled').checked,
            mode: el('ocrModeAlways').checked ? 'always' : 'auto',
            twoStage: el('ocrTwoStage').checked,
            improve: {
                // แก้กลับเป็นข้อความเริ่มต้น = เก็บเป็นว่าง (ใช้ค่าเริ่มต้นของโปรแกรม)
                prompt: el('ocrImprovePrompt').value.trim() ===
                    settings.improve.defaultPrompt.trim()
                    ? ''
                    : el('ocrImprovePrompt').value
            },
            gemini: {
                apiKey: el('ocrGeminiKey').value,
                model: el('ocrGeminiModel').value
            },
            iloveapi: {
                apiKey: el('ocrIloveKey').value
            }
        };
    }

    // ──────────────────────────────────────────────────────────────
    // สถานะ PaddleOCR (ในเครื่อง)
    // ──────────────────────────────────────────────────────────────

    function renderStatus(result) {
        const title = el('ocrStatusTitle');
        const detail = el('ocrStatusDetail');

        if (!result || result.ok === false) {
            title.textContent = 'ตรวจสอบสถานะไม่สำเร็จ';
            title.className = 'ocr-status-head error';
            detail.textContent = (result && result.error) || 'ไม่ทราบสาเหตุ';
            return;
        }

        if (!result.ready) {
            title.textContent = 'ยังใช้ OCR ในเครื่องไม่ได้';
            title.className = 'ocr-status-head error';

            const missing = Object.keys(result.engines || {})
                .filter(function (key) {
                    return !result.engines[key];
                });

            detail.textContent =
                'ขาดไลบรารี: ' + missing.join(', ') +
                ' — กรุณาติดตั้ง dependencies ของแอปใหม่ (npm install)';
            return;
        }

        title.textContent = 'พร้อมใช้งาน';
        title.className = 'ocr-status-head ok';

        const model = result.modelsCached
            ? 'โมเดลอยู่ในเครื่องแล้ว (' + formatSize(result.modelBytes) + ')'
            : 'ยังไม่มีโมเดล — ครั้งแรกที่ใช้จะดาวน์โหลด (~15 MB)';

        detail.textContent = [
            'ภาษา: ' + (result.language || '-'),
            model,
            'แคช: ' + (result.modelPath || '-')
        ].join(' · ');
    }

    async function refreshStatus() {
        const electron = api();

        if (!electron || !electron.ocrStatus) {
            el('ocrStatusTitle').textContent = 'เปิดในแอปเพื่อตรวจสอบสถานะ';
            el('ocrStatusTitle').className = 'ocr-status-head error';
            el('ocrStatusDetail').textContent = '';
            return null;
        }

        el('ocrStatusTitle').textContent = 'กำลังตรวจสอบสถานะ...';
        el('ocrStatusTitle').className = 'ocr-status-head';
        el('ocrStatusDetail').textContent = '';

        let result = null;

        try {
            result = await electron.ocrStatus();
        } catch (error) {
            result = {
                ok: false,
                error: (error && error.message) || 'ตรวจสอบสถานะไม่สำเร็จ'
            };
        }

        renderStatus(result);
        return result;
    }

    // ──────────────────────────────────────────────────────────────
    // สถานะ PaddleOCR-VL (ในเครื่อง)
    // ──────────────────────────────────────────────────────────────

    function renderVlStatus(result) {
        const title = el('ocrVlStatusTitle');
        const detail = el('ocrVlStatusDetail');
        const removeBtn = el('ocrVlRemoveBtn');

        // ปุ่มถอนการติดตั้งใช้ได้เมื่อมีไฟล์อยู่ในเครื่องเท่านั้น
        if (removeBtn) {
            removeBtn.disabled =
                !result ||
                result.ok === false ||
                !(result.runtimeReady || result.modelReady);
        }

        if (!result || result.ok === false) {
            title.textContent = 'ตรวจสอบสถานะไม่สำเร็จ';
            title.className = 'ocr-status-head error';
            detail.textContent = (result && result.error) || 'ไม่ทราบสาเหตุ';
            return;
        }

        if (!result.runtimeReady) {
            title.textContent = 'ยังไม่มี engine สำหรับ OCR';
            title.className = 'ocr-status-head error';
            detail.textContent =
                'ต้องดาวน์โหลด llama.cpp (~24 MB) ก่อน — กด "เตรียมโมเดล"';
            return;
        }

        if (!result.modelReady) {
            title.textContent = 'ยังไม่มีโมเดล PaddleOCR-VL';
            title.className = 'ocr-status-head error';
            detail.textContent =
                'ต้องดาวน์โหลดโมเดล (~1.8 GB) ก่อน — กด "เตรียมโมเดล" ' +
                (result.modelBytes > 0
                    ? '(มีแล้ว ' + formatSize(result.modelBytes) + ')'
                    : '');
            return;
        }

        title.textContent = 'พร้อมใช้งาน';
        title.className = 'ocr-status-head ok';

        detail.textContent = [
            'ภาษา: ' + (result.language || '-'),
            'โมเดลในเครื่อง ' + formatSize(result.modelBytes),
            result.running
                ? 'เซิร์ฟเวอร์ OCR กำลังทำงาน'
                : 'เซิร์ฟเวอร์จะเริ่มเมื่อใช้ครั้งแรก',
            'ที่เก็บ: ' + (result.modelPath || '-')
        ].join(' · ');
    }

    async function refreshVlStatus() {
        const electron = api();

        if (!electron || !electron.ocrVlStatus) {
            el('ocrVlStatusTitle').textContent = 'เปิดในแอปเพื่อตรวจสอบสถานะ';
            el('ocrVlStatusTitle').className = 'ocr-status-head error';
            el('ocrVlStatusDetail').textContent = '';
            return null;
        }

        el('ocrVlStatusTitle').textContent = 'กำลังตรวจสอบสถานะ...';
        el('ocrVlStatusTitle').className = 'ocr-status-head';
        el('ocrVlStatusDetail').textContent = '';

        let result = null;

        try {
            result = await electron.ocrVlStatus();
        } catch (error) {
            result = {
                ok: false,
                error: (error && error.message) || 'ตรวจสอบสถานะไม่สำเร็จ'
            };
        }

        renderVlStatus(result);
        return result;
    }

    async function prepareVlModels() {
        const electron = api();
        const button = el('ocrVlPrepareBtn');

        if (!electron || !electron.ocrVlPrepare) {
            setStatus('เปิดหน้านี้ในแอปเพื่อเตรียมโมเดล', 'error');
            return;
        }

        const onProgress = function (progress) {
            if (!progress) return;

            const percent = Number(progress.percent) || 0;
            const hasTotal = Number(progress.total) > 0;

            el('ocrVlStatusTitle').textContent =
                progress.label || 'กำลังเตรียมโมเดล...';
            el('ocrVlStatusTitle').className = 'ocr-status-head warn';

            el('ocrVlStatusDetail').textContent = hasTotal
                ? percent + '% · ' +
                  formatSize(progress.received) + ' / ' +
                  formatSize(progress.total)
                : 'กำลังเตรียมไฟล์ — อาจใช้เวลาสักครู่';

            setStatus(
                (progress.label || 'กำลังเตรียมโมเดล') +
                (hasTotal ? ' ' + percent + '%' : '') +
                '...',
                'warn'
            );
        };

        button.disabled = true;
        button.textContent = 'กำลังเตรียมโมเดล...';

        // ห้ามลบไฟล์ระหว่างดาวน์โหลด
        el('ocrVlRemoveBtn').disabled = true;

        if (electron.onOcrVlProgress) {
            electron.onOcrVlProgress(onProgress);
        }

        try {
            const result = await electron.ocrVlPrepare();

            if (!result || result.ok === false) {
                throw new Error((result && result.error) || 'เตรียมโมเดลไม่สำเร็จ');
            }

            renderVlStatus(result);
            setStatus('เตรียมโมเดล PaddleOCR-VL สำเร็จ — พร้อมใช้งาน', 'ok');

        } catch (error) {
            setStatus(
                'เตรียมโมเดลไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ'),
                'error'
            );

            await refreshVlStatus();

        } finally {
            if (electron.offOcrVlProgress) {
                electron.offOcrVlProgress();
            }

            button.disabled = false;
            button.textContent = 'เตรียมโมเดล (~1.8 GB)';
        }
    }

    async function removeVlModels() {
        const electron = api();
        const button = el('ocrVlRemoveBtn');

        if (!electron || !electron.ocrVlRemove) {
            setStatus('เปิดหน้านี้ในแอปเพื่อถอนการติดตั้ง', 'error');
            return;
        }

        if (scope.AppDialog && scope.AppDialog.confirm) {
            const confirmed = await scope.AppDialog.confirm(
                'ลบ engine llama.cpp และโมเดล PaddleOCR-VL ออกจากเครื่องนี้?\n' +
                'พื้นที่ที่ใช้อยู่จะถูกคืนกลับทั้งหมด — ' +
                'ถ้าจะใช้ PaddleOCR-VL อีกครั้ง จะต้องดาวน์โหลดใหม่ (~1.8 GB)',
                {
                    title: 'ถอนการติดตั้ง PaddleOCR-VL',
                    okText: 'ถอนการติดตั้ง',
                    danger: true
                }
            );

            if (!confirmed) return;
        }

        button.disabled = true;
        button.textContent = 'กำลังถอนการติดตั้ง...';

        // ห้ามกดเตรียมโมเดลซ้ำระหว่างลบไฟล์
        el('ocrVlPrepareBtn').disabled = true;

        setStatus('กำลังลบ engine และโมเดล PaddleOCR-VL...', 'warn');

        try {
            const result = await electron.ocrVlRemove();

            if (!result || result.ok === false) {
                throw new Error((result && result.error) || 'ถอนการติดตั้งไม่สำเร็จ');
            }

            renderVlStatus(result);

            setStatus(
                'ถอนการติดตั้ง PaddleOCR-VL แล้ว' +
                (result.removedBytes > 0
                    ? ' — คืนพื้นที่ ' + formatSize(result.removedBytes)
                    : ''),
                'ok'
            );

        } catch (error) {
            setStatus(
                'ถอนการติดตั้งไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ'),
                'error'
            );

            await refreshVlStatus();

        } finally {
            el('ocrVlPrepareBtn').disabled = false;
            button.textContent = 'ถอนการติดตั้ง';
        }
    }

    // ──────────────────────────────────────────────────────────────
    // โหลด / บันทึก
    // ──────────────────────────────────────────────────────────────

    async function loadConfig() {
        const electron = api();

        if (!electron || !electron.ocrGetConfig) {
            setStatus('เปิดหน้านี้ในแอปเพื่อแก้ค่าตั้ง OCR', 'error');
            return;
        }

        try {
            const result = await electron.ocrGetConfig();

            if (!result || result.ok === false) {
                throw new Error((result && result.error) || 'อ่านค่าตั้งไม่สำเร็จ');
            }

            applyConfig(result.config);
            setStatus('');

        } catch (error) {
            setStatus(
                'อ่านค่าตั้ง OCR ไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ'),
                'error'
            );
        }
    }

    async function saveConfig(payload, successMessage) {
        const electron = api();
        const button = el('ocrSaveBtn');

        if (!electron || !electron.ocrSaveConfig) {
            setStatus('เปิดหน้านี้ในแอปเพื่อบันทึกค่าตั้ง', 'error');
            return false;
        }

        button.disabled = true;
        setStatus('กำลังบันทึก...');

        try {
            const result = await electron.ocrSaveConfig(payload);

            if (!result || result.ok === false) {
                throw new Error((result && result.error) || 'บันทึกไม่สำเร็จ');
            }

            applyConfig(result.config);
            setStatus(successMessage || 'บันทึกการตั้งค่า OCR แล้ว', 'ok');

            return true;

        } catch (error) {
            setStatus(
                'บันทึกการตั้งค่าไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ'),
                'error'
            );

            return false;

        } finally {
            button.disabled = false;
        }
    }

    async function onSave() {
        const provider = selectedProvider();
        const payload = currentPayload();

        // ตรวจ key ก่อนบันทึก เฉพาะผู้ให้บริการที่ต้องใช้
        if (provider === 'gemini') {
            const hasKey =
                String(payload.gemini.apiKey || '').trim() !== '' ||
                settings.gemini.hasKey;

            if (!hasKey) {
                setStatus('กรุณาใส่ API key ของ Gemini ก่อนใช้งาน', 'error');
                el('ocrGeminiKey').focus();
                return;
            }
        }

        if (provider === 'iloveapi') {
            const hasKey =
                String(payload.iloveapi.apiKey || '').trim() !== '' ||
                settings.iloveapi.hasKey;

            if (!hasKey) {
                setStatus('กรุณาใส่ Public Key ของ i love api ก่อนใช้งาน', 'error');
                el('ocrIloveKey').focus();
                return;
            }
        }

        await saveConfig(payload);
    }

    async function clearKey(provider) {
        const isGemini = provider === 'gemini';

        if (scope.AppDialog && scope.AppDialog.confirm) {
            const confirmed = await scope.AppDialog.confirm(
                isGemini
                    ? 'ลบ API key ของ Gemini ที่เก็บไว้ในเครื่องนี้?'
                    : 'ลบ API key ของ i love api ที่เก็บไว้ในเครื่องนี้?'
            );

            if (!confirmed) return;
        }

        const payload = currentPayload();

        if (isGemini) {
            payload.gemini = {
                apiKey: '',
                model: el('ocrGeminiModel').value,
                clearKey: true
            };
        } else {
            payload.iloveapi = {
                apiKey: '',
                clearKey: true
            };
        }

        await saveConfig(payload, 'ลบ API key แล้ว');
    }

    async function prepareModels() {
        const electron = api();
        const button = el('ocrPrepareBtn');

        if (!electron || !electron.ocrPrepare) {
            setStatus('เปิดหน้านี้ในแอปเพื่อเตรียมโมเดล', 'error');
            return;
        }

        button.disabled = true;
        button.textContent = 'กำลังเตรียมโมเดล...';
        setStatus('กำลังโหลดโมเดล OCR — ครั้งแรกอาจใช้เวลาสักครู่', 'warn');

        try {
            const result = await electron.ocrPrepare();

            if (!result || result.ok === false) {
                throw new Error((result && result.error) || 'เตรียมโมเดลไม่สำเร็จ');
            }

            renderStatus(result);
            setStatus('เตรียมโมเดล OCR สำเร็จ — พร้อมใช้งาน', 'ok');

        } catch (error) {
            setStatus(
                'เตรียมโมเดลไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ'),
                'error'
            );

        } finally {
            button.disabled = false;
            button.textContent = 'เตรียมโมเดล OCR';
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ผูก event (DOM ถูกวาดใหม่ทุกครั้งที่เข้าหน้า จึงผูกใหม่ได้เลย)
    // ──────────────────────────────────────────────────────────────

    function bind() {
        el('ocrSaveBtn').addEventListener('click', onSave);
        el('ocrRefreshBtn').addEventListener('click', refreshStatus);
        el('ocrPrepareBtn').addEventListener('click', prepareModels);
        el('ocrVlRefreshBtn').addEventListener('click', refreshVlStatus);
        el('ocrVlPrepareBtn').addEventListener('click', prepareVlModels);
        el('ocrVlRemoveBtn').addEventListener('click', removeVlModels);
        el('ocrImproveResetBtn').addEventListener('click', function () {
            el('ocrImprovePrompt').value = settings.improve.defaultPrompt;
            updateImprovePromptHint();
            setStatus('คืนค่า prompt เริ่มต้นแล้ว — กด “บันทึกการตั้งค่า” เพื่อยืนยัน');
        });
        el('ocrImprovePrompt').addEventListener('input', updateImprovePromptHint);
        el('ocrGeminiClearBtn').addEventListener('click', function () {
            clearKey('gemini');
        });
        el('ocrIloveClearBtn').addEventListener('click', function () {
            clearKey('iloveapi');
        });

        el('ocrEnabled').addEventListener('change', updateModeState);

        document
            .querySelectorAll('input[name="ocrProvider"]')
            .forEach(function (radio) {
                radio.addEventListener('change', updateProviderSections);
            });
    }

    const page = {

        // หน้านี้ไม่ผูกกับไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        // เรียกจาก app.js หลังวาดหน้าเสร็จ
        onShow: function () {
            bind();
            loadConfig();
            refreshStatus();
            refreshVlStatus();
        }
    };

    scope.OcrConfigPage = page;
})(window);
