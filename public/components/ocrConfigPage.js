// OCR Config Page - ตั้งค่าว่าจะใช้ OCR จากที่ไหนเมื่ออัปโหลด PDF
//
// หน้าแรกที่เปิดใช้คือ PaddleOCR (ทำงานในเครื่อง ไม่ต้องใช้ API key)
// อีกสองตัวเลือก (Gemini API / i love api) ถูกวางโครงไว้ให้เห็นตั้งแต่ตอนนี้
// แต่ยังปิดไว้จนกว่าจะพัฒนาเสร็จ — ผู้ใช้จะไม่เห็นตัวเลือกที่กดแล้วไม่ทำงาน
//
// ค่าตั้งถูกเก็บฝั่ง main process ที่ data/ocr-config.json
// (ดู src/main/ocr-config.cjs) ไม่ได้อยู่ในฐานข้อมูล จึงไม่ติดไปกับไฟล์สำรอง .db
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
        '                <input type="radio" name="ocrProvider" value="paddle" id="ocrProviderPaddle" checked>',
        '                <span class="ocr-provider-body">',
        '                    <span class="ocr-provider-title">',
        '                        <strong>PaddleOCR (Local AI)</strong>',
        '                        <span class="ocr-badge ok">พร้อมใช้</span>',
        '                    </span>',
        '                    <small>ทำงานในเครื่องนี้ทั้งหมด — ไม่ต้องใช้ API key ',
        '                        และไม่ต้องต่ออินเทอร์เน็ตหลังโหลดโมเดลครั้งแรกแล้ว',
        '                        (โมเดล PP-OCRv5 ภาษาไทย + อังกฤษ)</small>',
        '                </span>',
        '            </label>',

        '            <label class="ocr-provider is-disabled">',
        '                <input type="radio" name="ocrProvider" value="gemini" disabled data-keep-disabled="1">',
        '                <span class="ocr-provider-body">',
        '                    <span class="ocr-provider-title">',
        '                        <strong>Gemini API</strong>',
        '                        <span class="ocr-badge pending">ยังไม่เปิดใช้งาน</span>',
        '                    </span>',
        '                    <small>ใช้ API key ของ Google Gemini — จะเปิดให้เลือกในเวอร์ชันถัดไป</small>',
        '                </span>',
        '            </label>',

        '            <label class="ocr-provider is-disabled">',
        '                <input type="radio" name="ocrProvider" value="iloveapi" disabled data-keep-disabled="1">',
        '                <span class="ocr-provider-body">',
        '                    <span class="ocr-provider-title">',
        '                        <strong>i love api</strong>',
        '                        <span class="ocr-badge pending">ยังไม่เปิดใช้งาน</span>',
        '                    </span>',
        '                    <small>ใช้ API key ของ i love api — จะเปิดให้เลือกในเวอร์ชันถัดไป</small>',
        '                </span>',
        '            </label>',

        '        </div>',
        '    </section>',

        // ── PaddleOCR ──
        '    <section class="suggest-settings">',
        '        <h2>PaddleOCR</h2>',

        '        <label class="switch-toggle">',
        '            <input type="checkbox" id="ocrPaddleEnabled">',
        '            <span class="switch-box"></span>',
        '            <span>ใช้ OCR เมื่ออัปโหลด PDF</span>',
        '        </label>',

        '        <div class="ocr-mode">',
        '            <span class="ocr-mode-label">ช่วงที่ให้ OCR</span>',

        '            <label class="ocr-choice">',
        '                <input type="radio" name="ocrPaddleMode" value="auto" id="ocrModeAuto" checked>',
        '                <span>',
        '                    <strong>เฉพาะหน้าที่เป็นรูปสแกน (แนะนำ)</strong>',
        '                    <small>หน้าที่ยังมีชั้นข้อความอยู่แล้วจะใช้ข้อความเดิม — เร็วกว่าและไม่ผิดเพี้ยน</small>',
        '                </span>',
        '            </label>',

        '            <label class="ocr-choice">',
        '                <input type="radio" name="ocrPaddleMode" value="always" id="ocrModeAlways">',
        '                <span>',
        '                    <strong>ทุกหน้า</strong>',
        '                    <small>ใช้ข้อความจาก OCR แทนข้อความในไฟล์ทุกหน้า — ช้ากว่า แต่ช่วยเมื่อชั้นข้อความเป็นขยะ</small>',
        '                </span>',
        '            </label>',
        '        </div>',

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

        '    <div class="form-actions page-actions">',
        '        <button id="ocrSaveBtn" type="button">บันทึกการตั้งค่า</button>',
        '    </div>',

        '    <p id="ocrPageStatus" class="db-status"></p>',
        '</div>'
    ].join('\n');

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

        return (value / (1024 * 1024)).toFixed(1) + ' MB';
    }

    // ──────────────────────────────────────────────────────────────
    // ค่าที่กรอกอยู่บนหน้าจอ
    // ──────────────────────────────────────────────────────────────

    function currentConfig() {
        return {
            provider: 'paddle',
            paddle: {
                enabled: el('ocrPaddleEnabled').checked,
                mode: el('ocrModeAlways').checked ? 'always' : 'auto'
            }
        };
    }

    function applyConfig(config) {
        const paddle = (config && config.paddle) || {};

        el('ocrPaddleEnabled').checked = paddle.enabled !== false;
        el('ocrModeAuto').checked = paddle.mode !== 'always';
        el('ocrModeAlways').checked = paddle.mode === 'always';

        updateModeState();
    }

    // ปิดช่องเลือกช่วงการทำงานเมื่อ OCR ถูกปิด
    function updateModeState() {
        const enabled = el('ocrPaddleEnabled').checked;

        el('ocrModeAuto').disabled = !enabled;
        el('ocrModeAlways').disabled = !enabled;
    }

    // ──────────────────────────────────────────────────────────────
    // สถานะเครื่อง
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
            title.textContent = 'ยังใช้ OCR ไม่ได้';
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

    // ──────────────────────────────────────────────────────────────
    // ปุ่ม
    // ──────────────────────────────────────────────────────────────

    async function saveConfig() {
        const electron = api();
        const button = el('ocrSaveBtn');

        if (!electron || !electron.ocrSaveConfig) {
            setStatus('เปิดหน้านี้ในแอปเพื่อบันทึกค่าตั้ง', 'error');
            return;
        }

        button.disabled = true;
        setStatus('กำลังบันทึก...');

        try {
            const result = await electron.ocrSaveConfig(currentConfig());

            if (!result || result.ok === false) {
                throw new Error((result && result.error) || 'บันทึกไม่สำเร็จ');
            }

            applyConfig(result.config);
            setStatus('บันทึกการตั้งค่า OCR แล้ว', 'ok');

        } catch (error) {
            setStatus(
                'บันทึกการตั้งค่าไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ'),
                'error'
            );

        } finally {
            button.disabled = false;
        }
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
        el('ocrSaveBtn').addEventListener('click', saveConfig);
        el('ocrRefreshBtn').addEventListener('click', refreshStatus);
        el('ocrPrepareBtn').addEventListener('click', prepareModels);

        el('ocrPaddleEnabled').addEventListener('change', updateModeState);
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
        }
    };

    scope.OcrConfigPage = page;
})(window);
