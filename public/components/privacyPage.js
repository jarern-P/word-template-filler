// คำเฉพาะ (Privacy Terms) — ตั้งคำ/pattern ที่เป็นความลับก่อนส่งให้ AI
// (เมนู ประวัติและการตั้งค่า → คำเฉพาะ)
//
// ทำงานร่วมกับปุ่ม "ปรับปรุง" ในกล่องใส่ข้อมูล: ข้อความที่อ่านได้และข้อมูล
// อ้างอิงจากฐานข้อมูลจะถูกแทนค่าด้วยตัวแปร [[NAME_1]] ก่อนออกจากเครื่อง
// แล้วแทนคืนด้วยค่าเดิมเมื่อ AI ตอบกลับ (ดู src/main/privacy-mask.cjs)
//
// รองรับ 2 ชนิด
//   คำ    = คำธรรมดา (เทียบทั้งคำ ไม่สนตัวพิมพ์เล็ก/ใหญ่)
//   regex = pattern ที่เขียนเอง ใส่ flag ได้ทั้งแบบ /.../i หรือพิมพ์เฉพาะ pattern
//
// รายการถูกเก็บในฐานข้อมูล (ตาราง sensitive_terms) จึงติดไปกับไฟล์สำรอง .db
// หน้านี้ไม่ผูกกับไฟล์ .docx — standalone = true
(function (scope) {
    'use strict';

    const MODAL_ID = 'privacyTermModal';

    const KIND_LABELS = {
        text: 'คำ',
        regex: 'regex'
    };

    const HTML = [
        '<h1>คำเฉพาะ (ปกปิดก่อนส่ง AI)</h1>',

        '<div id="privacyPage">',

        '    <p class="hint">',
        '        คำและ pattern ที่เปิดใช้จะถูกแทนด้วยตัวแปร เช่น [[MONEY_1]] ในข้อความทุกครั้ง',
        '        ที่กดปุ่ม "ปรับปรุง" (ส่งให้ Gemini) แล้วแทนค่าคืนให้อัตโนมัติเมื่อ AI ตอบกลับ',
        '        — ข้อมูลจริงจึงไม่ออกจากเครื่อง',
        '    </p>',

        '    <p class="hint">',
        '        รายการที่ติ๊ก "ต้องมีคำในระบบเท่านั้น" จะปกปิดเฉพาะค่าที่ตรงหรือใกล้เคียง',
        '        กับคำในระบบ (คลังคำศัพท์ + ข้อมูลหลัก) ตาม % ที่กำหนดด้านล่าง — ค่าที่ regex จับได้',
        '        แต่ไม่มีในระบบจะไม่ถูกแทนด้วยตัวแปร',
        '    </p>',

        // ── สรุปสถานะ ──
        '    <section class="suggest-settings">',
        '        <h2>การปกปิด</h2>',
        '        <p class="hint" id="privacyStats"></p>',
        '        <p class="hint">',
        '            ชื่อตัวแปรใช้ได้เฉพาะ A–Z, 0–9 และ _ (อักขระอื่นถูกแทนด้วย _)',
        '            · ตัวเลขลำดับท้ายตัวแปรเติมให้เองตามค่าที่พบ',
        '        </p>',

        '        <div class="field">',
        '            <label for="privacyMinSimilarity">เทียบกับคำในระบบขั้นต่ำ (%)</label>',
        '            <input type="number" id="privacyMinSimilarity" min="0" max="100"' +
            ' step="1" inputmode="numeric" value="80">',
        '        </div>',

        '        <p class="hint">',
        '            ใช้ร่วมกันทุกรายการที่ติ๊ก "ต้องมีคำในระบบเท่านั้น" — ค่าที่ใกล้เคียงที่สุด',
        '            ตั้งแต่ % นี้ขึ้นไปจะถูกแทนด้วยคำในระบบ (คำที่สะกดถูก) ก่อนแปลงเป็นตัวแปร',
        '        </p>',

        '        <div class="form-actions">',
        '            <button id="privacyMinSimilaritySaveBtn" type="button" class="plain">บันทึก % ขั้นต่ำ</button>',
        '        </div>',

        '        <p id="privacySettingsStatus" class="db-status"></p>',
        '        <p id="privacyKnownWords" class="hint"></p>',
        '    </section>',

        // ── รายการ (list-first) ──
        '    <section class="saved-templates">',
        '        <div class="list-head">',
        '            <h2>คำ/pattern ที่ตั้งไว้</h2>',
        '            <button id="privacyNewBtn" type="button" class="plain"' +
            ' data-modal-open="' + MODAL_ID + '">+ เพิ่มคำ/pattern</button>',
        '        </div>',

        '        <div class="master-toolbar">',
        '            <label for="privacySearch">ค้นหา</label>',
        '            <input type="text" id="privacySearch" placeholder="คำ / ชื่อตัวแปร"' +
            ' autocomplete="off">',
        '        </div>',

        '        <p id="privacyDbStatus" class="db-status"></p>',
        '        <ul id="privacyList" class="saved-list"></ul>',
        '    </section>',

        // ── ทดสอบกับข้อความ ──
        '    <section class="suggest-settings">',
        '        <h2>ทดสอบกับข้อความ</h2>',
        '        <p class="hint">',
        '            ทดสอบกับรายการที่ <b>เปิดใช้</b> เท่านั้น — ผลที่ได้จึงตรงกับตอนกด "ปรับปรุง"',
        '            (ถ้าต้องการทดลอง pattern ที่ยังไม่เปิด ให้เปิดสวิตช์รายการนั้นก่อนทดสอบ)',
        '        </p>',

        '        <div class="field">',
        '            <label for="privacySample">ข้อความตัวอย่าง</label>',
        '            <textarea id="privacySample" rows="5" spellcheck="false"',
        '                      placeholder="วางข้อความที่มีข้อมูลอ่อนไหว เช่น&#10;จำนวนเงิน 4,000.00 บาท&#10;ผู้ยื่น นางสาวทดสอบ ระบบ"></textarea>',
        '        </div>',

        '        <div class="form-actions">',
        '            <button id="privacyPreviewBtn" type="button">ทดสอบ</button>',
        '        </div>',

        '        <p id="privacyPreviewStatus" class="db-status"></p>',
        '        <pre id="privacyPreviewResult" class="regex-code empty"></pre>',
        '    </section>',

        // ── ฟอร์มเพิ่ม/แก้ไข (อยู่ในโมดัล) ──
        '    <div class="page-modal" id="' + MODAL_ID + '">',
        '        <div class="page-modal-backdrop" data-modal-close="' + MODAL_ID + '"></div>',
        '        <div class="page-modal-dialog">',
        '            <div class="page-modal-head">',
        '                <h2 id="privacyFormTitle">เพิ่มคำเฉพาะ</h2>',
        '                <button type="button" class="page-modal-close"' +
            ' data-modal-close="' + MODAL_ID + '" aria-label="ปิด">&times;</button>',
        '            </div>',

        '            <div class="page-modal-body">',
        '                <div class="field">',
        '                    <label for="privacyName">ชื่อตัวแปร</label>',
        '                    <input type="text" id="privacyName" placeholder="เช่น MONEY"' +
            ' autocomplete="off">',
        '                </div>',

        '                <div class="field">',
        '                    <label for="privacyKind">ชนิด</label>',
        '                    <select id="privacyKind">',
        '                        <option value="text">คำ (เทียบทั้งคำตามที่พิมพ์)</option>',
        '                        <option value="regex">regex (pattern ที่เขียนเอง)</option>',
        '                    </select>',
        '                </div>',

        '                <div class="field">',
        '                    <label for="privacyPattern">คำ หรือ pattern</label>',
        '                    <textarea id="privacyPattern" rows="3" spellcheck="false"',
        '                              placeholder="เช่น บริษัท ทดสอบ จำกัด&#10;หรือ \\d[\\d,]*\\.\\d{2}\\s*บาท"></textarea>',
        '                </div>',

        '                <label class="switch-toggle" for="privacyEnabled">',
        '                    <input type="checkbox" id="privacyEnabled" checked>',
        '                    <span class="switch-box" aria-hidden="true"></span>',
        '                    <span class="switch-text">เปิดใช้เมื่อส่ง AI</span>',
        '                </label>',

        '                <label class="switch-toggle" for="privacyRequireKnown">',
        '                    <input type="checkbox" id="privacyRequireKnown">',
        '                    <span class="switch-box" aria-hidden="true"></span>',
        '                    <span class="switch-text">ต้องมีคำในระบบเท่านั้น</span>',
        '                </label>',

        '                <p class="hint">',
        '                    ติ๊ก "ต้องมีคำในระบบเท่านั้น" = ค่าที่ regex จับได้จะถูกเทียบกับ',
        '                    คลังคำศัพท์ + ข้อมูลหลัก ถ้าความคล้ายถึง % ขั้นต่ำ (ตั้ง ởด้านบนของหน้า)',
        '                    จะใช้คำในระบบแทนแล้วแปลงเป็นตัวแปร — ถ้าไม่มีคำที่ถึงเกณฑ์ จะไม่ถูกแทนค่า',
        '                </p>',

        '                <input type="hidden" id="privacyId" value="">',

        '                <p class="hint">',
        '                    คำจะถูกแทนทั้งคำตามที่พิมพ์ ส่วน regex ใช้กับข้อความแบบ',
        '                    ค้นหาทุกจุดที่พบ (g) — ทดสอบกับข้อความจริงได้ในส่วน "ทดสอบกับข้อความ"',
        '                    ด้านบน โดยทดสอบเฉพาะรายการที่เปิดใช้ (สวิตช์ "เปิดใช้เมื่อส่ง AI")',
        '                </p>',

        '                <div class="form-actions">',
        '                    <button id="privacySaveBtn" type="button">เพิ่ม</button>',
        '                    <button id="privacyCancelBtn" type="button" class="plain"',
        '                            data-modal-close="' + MODAL_ID + '">ยกเลิก</button>',
        '                </div>',

        '                <p id="privacyFormStatus" class="db-status"></p>',
        '            </div>',
        '        </div>',
        '    </div>',

        '</div>'
    ].join('\n');

    let records = [];       // รายการล่าสุดจากฐานข้อมูล
    let searchText = '';
    let previewBusy = false;
    let minSimilarity = 80; // % ขั้นต่ำของการเทียบกับคำในระบบ (ใช้ร่วมกันทุกรายการ)
    let knownWords = 0;     // จำนวนคำในระบบ (คลังคำศัพท์ + ข้อมูลหลัก)

    // ค่าที่พิมพ์ไว้ — จำข้ามการเปลี่ยนหน้า (DOM ถูกวาดใหม่ทุกครั้ง)
    const state = {
        sample: ''
    };

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────

    function el(id) {
        return document.getElementById(id);
    }

    function setStatus(node, message, kind) {
        if (!node) return;

        node.textContent = message || '';
        node.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    function setValue(id, value) {
        const node = el(id);
        if (node) node.value = value === null || value === undefined ? '' : String(value);
    }

    function formatDate(isoText) {
        const date = new Date(isoText);
        if (isNaN(date.getTime())) return isoText || '';
        return date.toLocaleString('th-TH');
    }

    function appendEmpty(list, message) {
        const item = document.createElement('li');
        item.className = 'empty';
        item.textContent = message;
        list.appendChild(item);
    }

    function findRecord(id) {
        return records.find(function (record) {
            return Number(record.id) === Number(id);
        }) || null;
    }

    // ตรวจ regex ก่อนบันทึก เพื่อให้รู้ทันทีว่าพิมพ์ผิด (ฝั่ง main ตรวจซ้ำ)
    function checkPattern(kind, pattern) {
        if (kind !== 'regex') return '';

        const wrapped = /^\/(.+)\/([gimsuy]*)$/.exec(pattern);

        try {
            new RegExp(wrapped ? wrapped[1] : pattern, wrapped ? wrapped[2] : '');
            return '';

        } catch (error) {
            return 'regex ไม่ถูกต้อง: ' + (error.message || String(error));
        }
    }

    // ใช้ textContent ทุกจุด เพราะคำ/pattern มาจากผู้ใช้ (กัน XSS)
    function createItem(record) {
        const item = document.createElement('li');
        item.className = 'saved-item';

        const info = document.createElement('div');
        info.className = 'info';

        const name = document.createElement('strong');
        name.textContent = record.name;

        const pattern = document.createElement('code');
        pattern.className = 'regex-match-value';
        pattern.textContent = record.kind === 'regex' && record.pattern === ''
            ? '(ว่าง)'
            : record.pattern;

        const metaParts = [
            KIND_LABELS[record.kind] || KIND_LABELS.text,
            'ตัวแปร [[' + record.name + '_1]]'
        ];

        if (Number(record.require_known) === 1) {
            metaParts.push('ต้องมีคำในระบบ ≥ ' + minSimilarity + '%');
        }

        metaParts.push('อัปเดต ' + formatDate(record.updated_at));

        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = metaParts.join(' · ');

        info.appendChild(name);
        info.appendChild(pattern);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'actions';

        const toggle = document.createElement('label');
        toggle.className = 'switch-toggle';
        toggle.title = 'เปิด/ปิดการใช้รายการนี้';

        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = Number(record.enabled) === 1;
        toggleInput.dataset.action = 'term-toggle';
        toggleInput.dataset.id = String(record.id);

        const toggleBox = document.createElement('span');
        toggleBox.className = 'switch-box';
        toggleBox.setAttribute('aria-hidden', 'true');

        toggle.appendChild(toggleInput);
        toggle.appendChild(toggleBox);

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = 'แก้ไข';
        editBtn.dataset.action = 'term-edit';
        editBtn.dataset.id = String(record.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'ลบ';
        deleteBtn.dataset.action = 'term-delete';
        deleteBtn.dataset.id = String(record.id);

        actions.appendChild(toggle);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);

        return item;
    }

    function updateStats() {
        const node = el('privacyStats');
        if (!node) return;

        const enabled = records.filter(function (record) {
            return Number(record.enabled) === 1;
        }).length;

        node.textContent = records.length === 0
            ? 'ยังไม่มีรายการ — กด "+ เพิ่มคำ/pattern" เพื่อเริ่ม'
            : 'เปิดใช้ ' + enabled + ' จาก ' + records.length + ' รายการ' +
                (enabled === 0
                    ? ' · ยังไม่มีการปกปิด เพราะยังไม่มีรายการที่เปิดใช้'
                    : '');
    }

    function renderList() {
        const list = el('privacyList');
        if (!list) return;

        list.innerHTML = '';

        if (records.length === 0) {
            appendEmpty(list, 'ยังไม่มีคำ/pattern — กด "+ เพิ่มคำ/pattern" ด้านบน');
            updateStats();
            return;
        }

        const filtered = records.filter(function (record) {
            if (!searchText) return true;

            return (
                String(record.name || '').toLowerCase().indexOf(searchText) !== -1 ||
                String(record.pattern || '').toLowerCase().indexOf(searchText) !== -1
            );
        });

        if (filtered.length === 0) {
            appendEmpty(list, 'ไม่พบรายการที่ค้นหา');
            updateStats();
            return;
        }

        filtered.forEach(function (record) {
            list.appendChild(createItem(record));
        });

        updateStats();
    }

    // ──────────────────────────────────────────────────────────────
    // ฐานข้อมูล
    // ──────────────────────────────────────────────────────────────

    async function load() {
        const status = el('privacyDbStatus');

        setStatus(status, 'กำลังโหลด...');

        try {
            records = await scope.Db.privacyList();

            renderList();
            setStatus(status, '');

        } catch (error) {
            records = [];
            renderList();
            setStatus(status, 'โหลดรายการไม่สำเร็จ: ' + error.message, 'error');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ค่าตั้งที่ใช้ร่วมกัน (% ขั้นต่ำ + จำนวนคำในระบบ)
    // ──────────────────────────────────────────────────────────────

    function updateKnownWordsText() {
        const node = el('privacyKnownWords');
        if (!node) return;

        node.textContent = 'คำในระบบที่ใช้เทียบ: ' + knownWords + ' คำ' +
            ' (คลังคำศัพท์ + ข้อมูลหลัก)' +
            (knownWords === 0
                ? ' — ยังไม่มีคำในระบบ รายการที่ติ๊ก "ต้องมีคำในระบบเท่านั้น" จะไม่ปกปิดค่าใดเลย'
                : '');
    }

    async function loadSettings() {
        const status = el('privacySettingsStatus');
        const input = el('privacyMinSimilarity');

        if (!window.electronAPI || !window.electronAPI.privacySettingsGet) {
            updateKnownWordsText();
            return;
        }

        try {
            const response = await window.electronAPI.privacySettingsGet();

            if (!response || response.ok === false) {
                throw new Error(
                    (response && response.error) || 'โหลดค่าตั้งไม่สำเร็จ'
                );
            }

            minSimilarity = Number(response.minSimilarity);
            knownWords = Number(response.knownWords) || 0;

            if (input) input.value = String(minSimilarity);

            setStatus(status, '');
            updateKnownWordsText();

            // ป้าย "ต้องมีคำในระบบ ≥ N%" ในรายการต้องตรงกับค่าที่บันทึกไว้
            renderList();

        } catch (error) {
            setStatus(status, 'โหลดค่าตั้งไม่สำเร็จ: ' + error.message, 'error');
            updateKnownWordsText();
        }
    }

    async function saveSettings() {
        const status = el('privacySettingsStatus');
        const input = el('privacyMinSimilarity');
        const button = el('privacyMinSimilaritySaveBtn');

        if (!window.electronAPI || !window.electronAPI.privacySettingsSave) {
            setStatus(status, 'เปิดหน้านี้ในแอป (Electron) เพื่อบันทึกได้', 'error');
            return;
        }

        const value = Number(input ? input.value : minSimilarity);

        if (!isFinite(value) || value < 0 || value > 100) {
            setStatus(status, 'กรุณากรอกตัวเลข 0–100', 'error');
            return;
        }

        if (button) button.disabled = true;

        setStatus(status, 'กำลังบันทึก...');

        try {
            const response = await window.electronAPI.privacySettingsSave({
                minSimilarity: value
            });

            if (!response || response.ok === false) {
                throw new Error(
                    (response && response.error) || 'บันทึกไม่สำเร็จ'
                );
            }

            minSimilarity = Number(response.minSimilarity);

            if (input) input.value = String(minSimilarity);

            renderList();

            setStatus(
                status,
                'บันทึก % ขั้นต่ำแล้ว: ' + minSimilarity + '%',
                'ok'
            );

        } catch (error) {
            setStatus(status, 'บันทึกไม่สำเร็จ: ' + error.message, 'error');

        } finally {
            if (button) button.disabled = false;
        }
    }

    async function save() {
        const form = readForm();
        const status = el('privacyFormStatus');

        if (!form.pattern) {
            setStatus(status, 'กรุณาระบุคำหรือ pattern', 'error');
            return;
        }

        const invalid = checkPattern(form.kind, form.pattern);

        if (invalid) {
            setStatus(status, invalid, 'error');
            return;
        }

        const saveBtn = el('privacySaveBtn');
        if (saveBtn) saveBtn.disabled = true;

        setStatus(status, 'กำลังบันทึก...');

        try {
            await scope.Db.privacySave({
                id: form.id,
                name: form.name,
                kind: form.kind,
                pattern: form.pattern,
                enabled: form.enabled ? 1 : 0,
                require_known: form.requireKnown ? 1 : 0
            });

            await load();

            setStatus(
                el('privacyDbStatus'),
                form.id
                    ? 'บันทึกการแก้ไขแล้ว: ' + form.pattern
                    : 'เพิ่มรายการแล้ว: ' + form.pattern,
                'ok'
            );

            resetForm();
            scope.PageModal.close(MODAL_ID);

        } catch (error) {
            setStatus(status, 'บันทึกไม่สำเร็จ: ' + error.message, 'error');

        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function toggleRecord(id, enabled) {
        const record = findRecord(id);
        const status = el('privacyDbStatus');

        try {
            await scope.Db.privacySave({
                id: Number(id),
                enabled: enabled ? 1 : 0
            });

            if (record) record.enabled = enabled ? 1 : 0;

            updateStats();

            setStatus(
                status,
                (enabled ? 'เปิดใช้แล้ว: ' : 'ปิดใช้แล้ว: ') +
                    ((record && record.name) || id),
                'ok'
            );

        } catch (error) {
            setStatus(status, 'บันทึกไม่สำเร็จ: ' + error.message, 'error');

            // ค่าจริงในฐานข้อมูลไม่เปลี่ยน — โหลดกลับมาให้ตรง
            await load();
        }
    }

    async function deleteRecord(id) {
        if (!id) return;

        const confirmed = await scope.AppDialog.confirm(
            'ต้องการลบรายการนี้ใช่ไหม?',
            { title: 'ยืนยันการลบ', okText: 'ลบ', danger: true }
        );

        if (!confirmed) return;

        const status = el('privacyDbStatus');

        try {
            await scope.Db.privacyDelete(Number(id));

            await load();

            setStatus(status, 'ลบรายการแล้ว', 'ok');

        } catch (error) {
            setStatus(status, 'ลบไม่สำเร็จ: ' + error.message, 'error');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ฟอร์มเพิ่ม/แก้ไข
    // ──────────────────────────────────────────────────────────────

    function readForm() {
        const id = el('privacyId');
        const name = el('privacyName');
        const kind = el('privacyKind');
        const pattern = el('privacyPattern');
        const enabled = el('privacyEnabled');
        const requireKnown = el('privacyRequireKnown');

        return {
            id: (id && id.value) ? Number(id.value) : 0,
            name: name ? name.value.trim() : '',
            kind: kind && kind.value === 'regex' ? 'regex' : 'text',
            pattern: pattern ? pattern.value.trim() : '',
            enabled: enabled ? enabled.checked : true,
            requireKnown: requireKnown ? requireKnown.checked : false
        };
    }

    function setEditing(record) {
        const editing = !!record;

        setValue('privacyId', editing ? record.id : '');

        const title = el('privacyFormTitle');
        if (title) {
            title.textContent = editing ? 'แก้ไขคำเฉพาะ' : 'เพิ่มคำเฉพาะ';
        }

        const saveBtn = el('privacySaveBtn');
        if (saveBtn) {
            saveBtn.textContent = editing ? 'บันทึกการแก้ไข' : 'เพิ่ม';
        }
    }

    function loadIntoForm(record) {
        if (!record) return;

        setValue('privacyName', record.name);
        setValue('privacyKind', record.kind === 'regex' ? 'regex' : 'text');
        setValue('privacyPattern', record.pattern);

        const enabled = el('privacyEnabled');
        if (enabled) enabled.checked = Number(record.enabled) === 1;

        const requireKnown = el('privacyRequireKnown');
        if (requireKnown) requireKnown.checked = Number(record.require_known) === 1;

        setEditing(record);

        const pattern = el('privacyPattern');
        if (pattern && pattern.focus) pattern.focus();
    }

    function resetForm() {
        setValue('privacyName', '');
        setValue('privacyKind', 'text');
        setValue('privacyPattern', '');

        const enabled = el('privacyEnabled');
        if (enabled) enabled.checked = true;

        const requireKnown = el('privacyRequireKnown');
        if (requireKnown) requireKnown.checked = false;

        setEditing(null);
    }

    // ──────────────────────────────────────────────────────────────
    // ทดสอบกับข้อความ
    // ──────────────────────────────────────────────────────────────

    async function runPreview() {
        if (previewBusy) return;

        const sample = el('privacySample');
        const status = el('privacyPreviewStatus');
        const output = el('privacyPreviewResult');
        const text = sample ? sample.value : '';

        if (!window.electronAPI || !window.electronAPI.privacyPreview) {
            setStatus(status, 'เปิดหน้านี้ในแอป (Electron) เพื่อทดสอบได้', 'error');
            return;
        }

        if (text.trim() === '') {
            setStatus(status, 'วางข้อความตัวอย่างก่อนกดทดสอบ');
            return;
        }

        if (records.length === 0) {
            setStatus(status, 'ยังไม่มีรายการให้ทดสอบ — เพิ่มคำ/pattern ด้านบนก่อน');
            return;
        }

        previewBusy = true;

        const button = el('privacyPreviewBtn');
        if (button) button.disabled = true;

        setStatus(status, 'กำลังทดสอบ...');

        try {
            // ทดสอบตามสถานะเปิด/ปิดจริงของแต่ละรายการ — ผลที่ได้จะตรงกับตอนส่งจริง
            // (รายการที่ยังไม่เปิดจะไม่ถูกนำมาแทนค่า)
            const terms = records.map(function (record) {
                return {
                    name: record.name,
                    kind: record.kind,
                    pattern: record.pattern,
                    enabled: Number(record.enabled) === 1 ? 1 : 0,
                    require_known: Number(record.require_known) === 1 ? 1 : 0
                };
            });

            const enabledCount = terms.filter(function (term) {
                return term.enabled === 1;
            }).length;

            const requireKnownCount = terms.filter(function (term) {
                return term.enabled === 1 && term.require_known === 1;
            }).length;

            // ใช้ % ที่พิมพ์ค้างอยู่ในช่อง (ยังไม่กดบันทึกก็ทดสอบได้)
            const input = el('privacyMinSimilarity');
            const typed = Number(input ? input.value : minSimilarity);

            const response = await window.electronAPI.privacyPreview({
                text: text,
                terms: terms,
                minSimilarity: isFinite(typed) && typed >= 0 && typed <= 100
                    ? typed
                    : minSimilarity
            });

            if (!response || response.ok === false) {
                throw new Error(
                    (response && response.error) || 'ทดสอบไม่สำเร็จ'
                );
            }

            const result = response.result || {};
            const masked = String(result.text || '');
            const errors = Array.isArray(result.errors) ? result.errors : [];

            if (output) {
                output.textContent = masked;
                output.classList.toggle('empty', masked === '');
            }

            // ผลที่ได้ตรงกับตอนส่งจริง เพราะทดสอบเฉพาะรายการที่เปิดใช้
            setStatus(
                status,
                'ปกปิด ' + Number(result.count || 0) + ' จุด' +
                    ' · ตัวแปร ' + Number(result.placeholders || 0) + ' ตัว' +
                    ' · ใช้ ' + enabledCount + ' รายการที่เปิดใช้' +
                    (enabledCount === 0
                        ? ' (ยังไม่มีรายการที่เปิดใช้ — ตอนส่งจริงจะไม่มีการปกปิด)'
                        : '') +
                    (requireKnownCount > 0
                        ? ' · ต้องมีคำในระบบ ' + requireKnownCount + ' รายการ' +
                            ' (≥ ' + Number(result.minSimilarity || 0) + '%,' +
                            ' คำในระบบ ' + Number(result.knownWords || 0) + ' คำ)'
                        : '') +
                    (errors.length > 0
                        ? ' · ใช้ไม่ได้ ' + errors.length + ' รายการ: ' +
                            errors.map(function (item) {
                                return item.name + ' (' + item.error + ')';
                            }).join(', ')
                        : ''),
                enabledCount === 0 ? 'error' : ''
            );

        } catch (error) {
            setStatus(status, 'ทดสอบไม่สำเร็จ: ' + error.message, 'error');

        } finally {
            previewBusy = false;
            if (button) button.disabled = false;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ผูก event (DOM ถูกสร้างใหม่ทุกครั้งที่เข้าหน้า)
    // ──────────────────────────────────────────────────────────────

    function bind() {
        const list = el('privacyList');
        const search = el('privacySearch');
        const saveBtn = el('privacySaveBtn');
        const cancelBtn = el('privacyCancelBtn');
        const previewBtn = el('privacyPreviewBtn');
        const sample = el('privacySample');
        const settingsSaveBtn = el('privacyMinSimilaritySaveBtn');

        if (!list) return;

        // ปุ่มเปิดโมดัลใช้ data-modal-open (app.js เป็นผู้เปิด + เรียก onModalOpen)
        list.addEventListener('click', function (event) {
            const trigger = event.target.closest
                ? event.target.closest('[data-action]')
                : null;

            if (!trigger) return;

            const action = trigger.dataset.action;
            const id = Number(trigger.dataset.id);

            if (action === 'term-edit') {
                loadIntoForm(findRecord(id));
                scope.PageModal.open(MODAL_ID);
                return;
            }

            if (action === 'term-delete') {
                deleteRecord(id);
            }
        });

        list.addEventListener('change', function (event) {
            const trigger = event.target;

            if (!trigger || trigger.dataset.action !== 'term-toggle') return;

            // ปุ่มถูกปิดระหว่างบันทึก กันกดรัว (ค่าจริงมาจากฐานข้อมูล)
            trigger.disabled = true;

            toggleRecord(Number(trigger.dataset.id), trigger.checked)
                .finally(function () {
                    trigger.disabled = false;
                });
        });

        if (search) {
            search.addEventListener('input', function () {
                searchText = search.value.trim().toLowerCase();
                renderList();
            });
        }

        if (saveBtn) {
            saveBtn.addEventListener('click', save);
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                resetForm();
                setStatus(el('privacyFormStatus'), '');
            });
        }

        if (previewBtn) {
            previewBtn.addEventListener('click', runPreview);
        }

        if (settingsSaveBtn) {
            settingsSaveBtn.addEventListener('click', saveSettings);
        }

        if (sample) {
            sample.addEventListener('input', function () {
                state.sample = sample.value;
            });

            // Ctrl+Enter = ทดสอบ (พิมพ์หลายบรรทัดจึงใช้ Enter เฉย ๆ ไม่ได้)
            sample.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    runPreview();
                }
            });
        }
    }

    function applyState() {
        setValue('privacySearch', searchText);
        setValue('privacySample', state.sample);

        const output = el('privacyPreviewResult');
        if (output) {
            output.textContent = '';
            output.classList.add('empty');
        }
    }

    const page = {

        // หน้านี้จัดการ UI และฐานข้อมูลเอง ไม่ขึ้นกับ state ของไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        // เรียกจาก app.js หลังวาดหน้าเสร็จ
        onShow: function () {
            bind();
            resetForm();
            applyState();
            loadSettings();
            load();
        },

        // เรียกจาก app.js ตอนกด "+ เพิ่มคำ/pattern" (เตรียมฟอร์มก่อนเปิดโมดัล)
        onModalOpen: function (modalId) {
            if (modalId !== MODAL_ID) return;

            resetForm();
            setStatus(el('privacyFormStatus'), '');
        }
    };

    scope.PrivacyPage = page;
})(window);
