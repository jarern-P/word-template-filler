// AI OCR Page - ตั้งค่าให้ AI ช่วยแก้คำที่ OCR อ่านผิด (Google Gemini)
// (เมนู ประวัติและการตั้งค่า → ตั้งค่า AI (OCR))
//
// หน้านี้ไม่ผูกกับไฟล์ .docx และไม่ต้องมีแม่แบบ — standalone = true
//
// ทำไมเปลี่ยนจากหน้า "ฝึก OCR" เดิม:
//   - การแก้คำทีละคำด้วยคนช้าและไม่ครอบคลุม ระบบจึงใช้ AI ช่วยตรวจทั้งหน้า
//   - AI ทำงาน "หลัง" tesseract: tesseract หาตำแหน่งคำ/confidence ตามเดิม
//     แล้ว AI ช่วยแก้เฉพาะคำที่อ่านผิด → ตรวจคำบนภาพ/คลังคำเดิมยังใช้ได้
//   - ค่าที่ AI แก้ถูกจำลงคลังคำอัตโนมัติ (เฉพาะคำที่ tesseract มั่นใจต่ำ)
//     เมื่อปิด AI ระบบจึงแทนคำเหล่านั้นให้เอง — ยิ่งใช้ยิ่งฉลาดโดยไม่ต้องมีเน็ต
//
// หน้านี้จึงเหลือ: เปิด/ปิด AI, API key, โมเดล, prompt ของระบบ และสถิติการเรียนรู้
(function (scope) {
    'use strict';

    const HTML = [
        '<div id="ocrAiRoot" class="ocr-ai">',

        '    <h1>ตั้งค่า AI (OCR)</h1>',

        '    <p class="hint ocr-intro">',
        '        ให้ AI (Google Gemini) ช่วยแก้คำที่ OCR อ่านผิดจากเอกสารสแกน',
        '        โดยยังใช้ tesseract หาตำแหน่งคำและตรวจคำบนภาพเหมือนเดิม',
        '        คำที่ AI แก้จะถูกจำไว้ในเครื่อง เมื่อปิด AI ระบบยังอ่านไฟล์ได้',
        '        และแทนคำที่เคยแก้ให้อัตโนมัติ — ผังหน้าที่เคยอ่านจะถูกใช้',
        '        จับคู่หน้าเดิมและจัดลำดับคอลัมน์ให้เองโดยไม่ต้องใช้ AI',
        '    </p>',

        '    <section class="suggest-settings">',
        '        <h2>การทำงาน</h2>',

        '        <label class="switch-toggle" for="ocrAiEnabled">',
        '            <input type="checkbox" id="ocrAiEnabled">',
        '            <span class="switch-box" aria-hidden="true"></span>',
        '            <span class="switch-text">ใช้ AI ช่วยแก้คำหลัง OCR</span>',
        '        </label>',

        '        <p class="hint">',
        '            เปิด = ส่งภาพหน้า + ข้อความจาก tesseract ให้ AI ช่วยแก้ (ต้องมี API key และอินเทอร์เน็ต)',
        '            · ปิด = ใช้ tesseract กับคลังคำที่เรียนรู้ไว้อย่างเดียว',
        '            ซึ่งทำงานได้เต็มที่โดยไม่ต้องมีเน็ตหรือเสียงบค่า API',
        '        </p>',
        '    </section>',

        '    <section class="suggest-settings">',
        '        <h2>การเชื่อมต่อ</h2>',

        '        <div class="field">',
        '            <label for="ocrAiModel">โมเดล</label>',
        '            <input type="text" id="ocrAiModel" list="ocrAiModelList"',
        '                   autocomplete="off" spellcheck="false" placeholder="gemini-2.5-flash">',
        '            <datalist id="ocrAiModelList">',
        '                <option value="gemini-2.5-flash"></option>',
        '                <option value="gemini-2.5-pro"></option>',
        '                <option value="gemini-2.0-flash"></option>',
        '            </datalist>',
        '            <p class="hint">',
        '                ชื่อโมเดลตามที่ Google เปิดให้ใช้ — flash เร็วและถูกกว่า,',
        '                pro แม่นขึ้นแต่ช้าและแพงกว่า',
        '            </p>',
        '        </div>',

        '        <div class="field">',
        '            <label for="ocrAiKey">API key</label>',
        '            <div class="ocr-ai-key">',
        '                <input type="password" id="ocrAiKey" autocomplete="new-password"',
        '                       spellcheck="false" placeholder="วาง API key ที่นี่">',
        '                <button type="button" id="ocrAiKeyToggle" class="plain">แสดง</button>',
        '            </div>',
        '            <p class="hint" id="ocrAiKeyState"></p>',
        '        </div>',

        '        <div class="form-actions">',
        '            <button type="button" id="ocrAiSaveBtn">บันทึก</button>',
        '            <button type="button" id="ocrAiTestBtn" class="plain">บันทึกแล้วทดสอบ</button>',
        '            <button type="button" id="ocrAiClearKeyBtn" class="plain">ลบ key</button>',
        '        </div>',

        '        <p id="ocrAiConnectionStatus" class="db-status"></p>',
        '    </section>',

        '    <section class="suggest-settings">',
        '        <h2>Prompt ของระบบ</h2>',

        '        <p class="hint">',
        '            คำสั่งที่ส่งให้ AI ทุกครั้งที่ตรวจคำ — บอกบทบาท วิธีแก้ และรูปแบบคำตอบ',
        '            (ระบบกำหนดรูปแบบ JSON ให้เองอยู่แล้ว จึงไม่ต้องเขียนรูปแบบคำตอบในนี้)',
        '        </p>',

        '        <div class="field">',
        '            <label for="ocrAiPrompt">คำสั่ง (system prompt)</label>',
        '            <textarea id="ocrAiPrompt" class="ocr-prompt" rows="12" spellcheck="false"></textarea>',
        '        </div>',

        '        <div class="form-actions">',
        '            <button type="button" id="ocrAiPromptSaveBtn">บันทึก prompt</button>',
        '            <button type="button" id="ocrAiPromptResetBtn" class="plain">คืนค่าเริ่มต้น</button>',
        '            <span id="ocrAiPromptMeta" class="hint"></span>',
        '        </div>',

        '        <p id="ocrAiPromptStatus" class="db-status"></p>',
        '    </section>',

        '    <section class="saved-templates">',
        '        <div class="list-head">',
        '            <h2>การเรียนรู้ในเครื่อง</h2>',
        '            <button type="button" id="ocrAiStatsRefresh" class="plain">รีเฟรช</button>',
        '        </div>',

        '        <div class="ocr-stats" id="ocrAiStats"></div>',

        '        <p class="hint" id="ocrAiStatsHint">',
        '            ผังหน้าและคำที่แก้ถูกเก็บในฐานข้อมูลของแอป',
        '            — ไม่ได้ส่งข้อมูลขึ้นคลาวด์ นอกจากภาพหน้าและข้อความที่ส่งให้ AI ตอนเปิดใช้งาน',
        '        </p>',
        '    </section>',

        '</div>'
    ].join('\n');

    const state = {
        loaded: false,
        hasKey: false,
        defaultPrompt: '',
        defaultModel: 'gemini-2.5-flash',
        busy: false
    };

    function el(id) {
        return document.getElementById(id);
    }

    function api() {
        return window.electronAPI || null;
    }

    function setStatus(targetId, text, kind) {
        const node = el(targetId);

        if (!node) return;

        node.textContent = text || '';
        node.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    function setBusy(busy) {
        state.busy = !!busy;

        ['ocrAiSaveBtn', 'ocrAiTestBtn', 'ocrAiClearKeyBtn',
            'ocrAiPromptSaveBtn', 'ocrAiPromptResetBtn',
            'ocrAiStatsRefresh'].forEach(function (id) {
            const button = el(id);

            if (button) button.disabled = state.busy;
        });

        const toggle = el('ocrAiKeyToggle');

        if (toggle) toggle.disabled = state.busy;
    }

    function formatDate(isoText) {
        const date = new Date(isoText);

        if (!isoText || isNaN(date.getTime())) return '';

        return date.toLocaleString('th-TH');
    }

    function currentPrompt() {
        const node = el('ocrAiPrompt');

        return node ? String(node.value || '') : '';
    }

    function setPromptMeta(isDefault) {
        const node = el('ocrAiPromptMeta');

        if (!node) return;

        node.textContent = isDefault ? 'ใช้ prompt เริ่มต้น' : 'กำหนดเอง';
    }

    function updateKeyState(hasKey) {
        state.hasKey = !!hasKey;

        const node = el('ocrAiKeyState');

        if (!node) return;

        node.textContent = hasKey
            ? 'มี key บันทึกไว้แล้ว (เข้ารหัสในเครื่อง) — เว้นช่องว่างไว้เพื่อใช้ key เดิม'
            : 'ยังไม่มี key — AI จะไม่ทำงานจนกว่าจะใส่ key แล้วบันทึก';

        node.className = 'hint' + (hasKey ? ' ok' : '');
    }

    function applyConfig(config) {
        if (!config) return;

        const enabled = el('ocrAiEnabled');
        const model = el('ocrAiModel');
        const prompt = el('ocrAiPrompt');

        if (enabled) enabled.checked = config.enabled === true;

        if (model) {
            model.value = config.model || state.defaultModel;
        }

        if (prompt) {
            prompt.value = config.prompt || state.defaultPrompt;
        }

        state.defaultPrompt = config.defaultPrompt || state.defaultPrompt;
        state.defaultModel = config.defaultModel || state.defaultModel;

        setPromptMeta(config.isDefaultPrompt === true);
        updateKeyState(config.hasKey === true);
    }

    // ──────────────────────────────────────────────────────────────
    // โหลด / บันทึกค่าตั้ง
    // ──────────────────────────────────────────────────────────────

    async function loadConfig() {
        const bridge = api();

        if (!bridge || typeof bridge.ocrAiGetConfig !== 'function') {
            setStatus(
                'ocrAiConnectionStatus',
                'ตั้งค่า AI ได้เฉพาะในแอป (Electron)',
                'warn'
            );
            return;
        }

        try {
            const result = await bridge.ocrAiGetConfig();

            if (!result || !result.ok) {
                throw new Error(
                    (result && result.error) || 'อ่านค่าตั้งไม่สำเร็จ'
                );
            }

            applyConfig(result.config);
            state.loaded = true;
        } catch (error) {
            setStatus(
                'ocrAiConnectionStatus',
                (error && error.message) || 'อ่านค่าตั้งไม่สำเร็จ',
                'error'
            );
        }
    }

    // options.fromPrompt = บันทึกเฉพาะ prompt (ปุ่มในส่วน prompt)
    async function saveConfig(options) {
        const bridge = api();
        const opts = options || {};

        if (!bridge || typeof bridge.ocrAiSaveConfig !== 'function') {
            setStatus(
                'ocrAiConnectionStatus',
                'บันทึกค่าตั้งได้เฉพาะในแอป (Electron)',
                'warn'
            );
            return false;
        }

        const enabled = el('ocrAiEnabled');
        const model = el('ocrAiModel');
        const key = el('ocrAiKey');

        const payload = {
            enabled: !!(enabled && enabled.checked),
            model: model ? String(model.value || '').trim() : '',
            prompt: currentPrompt()
        };

        // ช่อง key ว่าง = ใช้ key เดิม (ไม่ส่งไป = ไม่ทับ)
        const typedKey = key ? String(key.value || '').trim() : '';

        if (typedKey !== '') {
            payload.apiKey = typedKey;
        }

        try {
            const result = await bridge.ocrAiSaveConfig(payload);

            if (!result || !result.ok) {
                throw new Error(
                    (result && result.error) || 'บันทึกค่าตั้งไม่สำเร็จ'
                );
            }

            applyConfig(result.config);

            if (key) key.value = '';

            setStatus(
                opts.statusTarget || 'ocrAiConnectionStatus',
                opts.statusText === undefined ? 'บันทึกแล้ว' : opts.statusText,
                'ok'
            );

            return true;
        } catch (error) {
            setStatus(
                opts.statusTarget || 'ocrAiConnectionStatus',
                (error && error.message) || 'บันทึกค่าตั้งไม่สำเร็จ',
                'error'
            );

            return false;
        }
    }

    async function testConnection() {
        const bridge = api();

        if (!bridge || typeof bridge.ocrAiTest !== 'function') {
            setStatus(
                'ocrAiConnectionStatus',
                'ทดสอบการเชื่อมต่อได้เฉพาะในแอป (Electron)',
                'warn'
            );
            return;
        }

        // บันทึกค่าที่กรอกอยู่ก่อน — ทดสอบด้วยค่าที่ผู้ใช้เห็นบนจอ
        const saved = await saveConfig({
            statusTarget: 'ocrAiConnectionStatus',
            statusText: ''
        });

        if (!saved) return;

        setBusy(true);
        setStatus('ocrAiConnectionStatus', 'กำลังทดสอบการเชื่อมต่อ...');

        try {
            const result = await bridge.ocrAiTest();

            if (!result || !result.ok) {
                throw new Error(
                    (result && result.error) || 'ทดสอบไม่สำเร็จ'
                );
            }

            setStatus(
                'ocrAiConnectionStatus',
                'เชื่อมต่อได้: ' + (result.model || '') +
                    (result.message ? ' (ตอบกลับ: ' + result.message + ')' : ''),
                'ok'
            );
        } catch (error) {
            setStatus(
                'ocrAiConnectionStatus',
                (error && error.message) || 'ทดสอบไม่สำเร็จ',
                'error'
            );
        } finally {
            setBusy(false);
        }
    }

    async function clearKey() {
        const confirmed = await scope.AppDialog.confirm(
            'ลบ API key ที่บันทึกไว้?\n' +
            'AI จะหยุดทำงานจนกว่าจะใส่ key ใหม่ — การอ่านไฟล์ยังใช้ tesseract + คลังคำได้ตามเดิม',
            { danger: true }
        );

        if (!confirmed) return;

        const bridge = api();

        if (!bridge || typeof bridge.ocrAiSaveConfig !== 'function') {
            setStatus(
                'ocrAiConnectionStatus',
                'ลบ key ได้เฉพาะในแอป (Electron)',
                'warn'
            );
            return;
        }

        setBusy(true);

        try {
            const result = await bridge.ocrAiSaveConfig({
                enabled: false,
                model: el('ocrAiModel') ? el('ocrAiModel').value : '',
                prompt: currentPrompt(),
                clearKey: true
            });

            if (!result || !result.ok) {
                throw new Error(
                    (result && result.error) || 'ลบ key ไม่สำเร็จ'
                );
            }

            applyConfig(result.config);

            setStatus('ocrAiConnectionStatus', 'ลบ API key แล้ว', 'ok');
        } catch (error) {
            setStatus(
                'ocrAiConnectionStatus',
                (error && error.message) || 'ลบ key ไม่สำเร็จ',
                'error'
            );
        } finally {
            setBusy(false);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // สถิติการเรียนรู้
    // ──────────────────────────────────────────────────────────────

    function renderStats(stats) {
        const host = el('ocrAiStats');

        if (!host) return;

        const items = [
            [stats.blueprints, 'ผังหน้าที่เก็บไว้'],
            [stats.aiPages, 'หน้าที่ AI ช่วยอ่าน'],
            [stats.localPages, 'หน้าที่อ่านในเครื่อง'],
            [stats.learned, 'คำที่เรียนรู้จาก AI'],
            [stats.fixes, 'คำในคลังทั้งหมด']
        ];

        host.innerHTML = '';

        items.forEach(function (item) {
            const card = document.createElement('div');
            card.className = 'ocr-stat';

            const value = document.createElement('strong');
            value.textContent = String(Number(item[0]) || 0);

            const label = document.createElement('span');
            label.textContent = item[1];

            card.appendChild(value);
            card.appendChild(label);
            host.appendChild(card);
        });

        const hint = el('ocrAiStatsHint');

        if (hint) {
            const extras = [
                stats.wordGroups ? stats.wordGroups + ' กลุ่มคำข้ามบรรทัด' : '',
                stats.dropWords ? stats.dropWords + ' คำที่ตัดออก' : '',
                stats.pageLayouts ? stats.pageLayouts + ' ลำดับคอลัมน์' : '',
                stats.lastUpdated
                    ? 'อัปเดตล่าสุด ' + formatDate(stats.lastUpdated)
                    : ''
            ].filter(Boolean);

            hint.textContent =
                'ผังหน้าและคำที่แก้ถูกเก็บในฐานข้อมูลของแอป' +
                (extras.length > 0 ? ' · ' + extras.join(' · ') : '') +
                ' — ไม่ได้ส่งข้อมูลขึ้นคลาวด์ นอกจากภาพหน้าและข้อความที่ส่งให้ AI ตอนเปิดใช้งาน';
        }
    }

    async function loadStats() {
        if (!scope.Db || typeof scope.Db.ocrAiStats !== 'function') return;

        const refresh = el('ocrAiStatsRefresh');

        if (refresh) refresh.disabled = true;

        try {
            const stats = await scope.Db.ocrAiStats();

            renderStats(stats || {});
        } catch (error) {
            const hint = el('ocrAiStatsHint');

            if (hint) {
                hint.textContent =
                    (error && error.message) || 'อ่านสถิติไม่สำเร็จ';
            }
        } finally {
            if (refresh) refresh.disabled = false;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Bind
    // ──────────────────────────────────────────────────────────────

    function bind() {
        const enabled = el('ocrAiEnabled');
        const key = el('ocrAiKey');
        const prompt = el('ocrAiPrompt');

        if (enabled) {
            enabled.addEventListener('change', function () {
                setStatus(
                    'ocrAiConnectionStatus',
                    enabled.checked
                        ? 'เปิดใช้ AI — กด "บันทึก" เพื่อให้มีผลกับการอ่านไฟล์ครั้งถัดไป'
                        : 'ปิดใช้ AI — กด "บันทึก" เพื่อให้มีผลกับการอ่านไฟล์ครั้งถัดไป',
                    'warn'
                );
            });
        }

        if (key) {
            key.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    saveConfig();
                }
            });
        }

        if (prompt) {
            prompt.addEventListener('input', function () {
                setPromptMeta(prompt.value === state.defaultPrompt);
            });
        }

        const saveBtn = el('ocrAiSaveBtn');

        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                if (state.busy) return;

                setBusy(true);
                saveConfig().finally(function () {
                    setBusy(false);
                    loadStats();
                });
            });
        }

        const testBtn = el('ocrAiTestBtn');

        if (testBtn) {
            testBtn.addEventListener('click', function () {
                if (state.busy) return;
                testConnection();
            });
        }

        const clearBtn = el('ocrAiClearKeyBtn');

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (state.busy) return;
                clearKey();
            });
        }

        const keyToggle = el('ocrAiKeyToggle');

        if (keyToggle && key) {
            keyToggle.addEventListener('click', function () {
                const hidden = key.type === 'password';

                key.type = hidden ? 'text' : 'password';
                keyToggle.textContent = hidden ? 'ซ่อน' : 'แสดง';
            });
        }

        const promptSave = el('ocrAiPromptSaveBtn');

        if (promptSave) {
            promptSave.addEventListener('click', function () {
                if (state.busy) return;

                setBusy(true);

                saveConfig({
                    statusTarget: 'ocrAiPromptStatus',
                    statusText: 'บันทึก prompt แล้ว'
                }).finally(function () {
                    setBusy(false);
                });
            });
        }

        const promptReset = el('ocrAiPromptResetBtn');

        if (promptReset) {
            promptReset.addEventListener('click', function () {
                if (state.busy) return;

                if (prompt) {
                    prompt.value = state.defaultPrompt;
                    setPromptMeta(true);
                }

                setStatus(
                    'ocrAiPromptStatus',
                    'คืนค่า prompt เริ่มต้นแล้ว — กด "บันทึก prompt" เพื่อใช้',
                    'warn'
                );
            });
        }

        const refresh = el('ocrAiStatsRefresh');

        if (refresh) {
            refresh.addEventListener('click', function () {
                loadStats();
            });
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Page
    // ──────────────────────────────────────────────────────────────

    const page = {

        // หน้านี้จัดการ UI เอง ไม่ขึ้นกับไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        // เรียกจาก app.js หลังวาดหน้าเสร็จ
        onShow: function () {
            bind();
            setBusy(false);
            setStatus('ocrAiConnectionStatus', '');
            setStatus('ocrAiPromptStatus', '');

            loadConfig().then(function () {
                if (state.loaded) loadStats();
            });
        }
    };

    scope.OcrTrainingPage = page;
})(window);
