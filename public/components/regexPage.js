// Regex Page - เครื่องมือสร้าง regex และอธิบาย regex เป็นภาษาคน
// (เมนู ประวัติและการตั้งค่า → Regex)
//
//   - ใส่คำขึ้นต้น / ตัวคั่น / ชนิดของค่า / คำลงท้าย แล้วได้ regex พร้อมคำอธิบาย
//   - วาง regex ที่มีอยู่แล้วให้อธิบายทีละส่วน
//   - ทดสอบกับข้อความตัวอย่างว่าจับอะไรได้บ้าง
//
// หน้านี้ไม่ผูกกับไฟล์ .docx และไม่ใช้ฐานข้อมูล — standalone = true
// ค่าที่กรอกถูกจำไว้ใน state ของโมดูล เพื่อกลับมาหน้าเดิมแล้วยังอยู่
(function (scope) {
    'use strict';

    const HTML = [
        '<h1>Regex</h1>',

        '<div class="regex-page" id="regexPage">',

        '    <p class="hint regex-intro">',
        '        สร้าง regex จากคำที่อยู่หน้าค่าและหลังค่า แล้วอ่านคำอธิบายว่า regex นั้นจับอะไร',
        '        — คัดลอกไปใช้ได้ที่หน้า "ตั้งค่าแม่แบบ" → ปุ่ม "ข้อมูล" ของแต่ละ field',
        '    </p>',

        // ── ตัวสร้าง regex ──
        '    <section class="suggest-settings">',
        '        <h2>ตัวสร้าง regex</h2>',

        '        <div class="regex-grid">',
        '            <div class="field">',
        '                <label for="regexPrefix">คำขึ้นต้น</label>',
        '                <input type="text" id="regexPrefix" autocomplete="off"',
        '                       placeholder="เช่น เลขที่">',
        '            </div>',

        '            <div class="field">',
        '                <label for="regexGap">ตัวคั่นหลังคำขึ้นต้น</label>',
        '                <select id="regexGap">',
        '                    <option value="colon-space">เว้นวรรคหรือเครื่องหมาย : (แนะนำ)</option>',
        '                    <option value="colon">เครื่องหมาย :</option>',
        '                    <option value="space">เว้นวรรค</option>',
        '                    <option value="none">ไม่มี (ติดกันเลย)</option>',
        '                </select>',
        '            </div>',

        '            <div class="field">',
        '                <label for="regexValueType">ชนิดของค่าที่จะจับ</label>',
        '                <select id="regexValueType">',
        '                    <option value="line">ข้อความจนจบบรรทัด</option>',
        '                    <option value="number">ตัวเลข (มี comma / ทศนิยมได้)</option>',
        '                    <option value="date">วันที่ (วว/ดด/ปปปป)</option>',
        '                    <option value="untilSuffix">ข้อความจนถึงคำลงท้าย</option>',
        '                </select>',
        '            </div>',

        '            <div class="field">',
        '                <label for="regexSuffix">คำลงท้าย</label>',
        '                <input type="text" id="regexSuffix" autocomplete="off"',
        '                       placeholder="เช่น บาท (เว้นว่าง = จนจบบรรทัด)">',
        '            </div>',
        '        </div>',

        '        <div class="regex-options">',
        '            <label><input type="checkbox" id="regexAnchor">',
        '                จับเฉพาะต้นบรรทัด ( ^ … $ )</label>',
        '            <label><input type="checkbox" id="regexIgnoreCase">',
        '                ไม่สนตัวพิมพ์เล็ก/ใหญ่ (i)</label>',
        '            <label><input type="checkbox" id="regexMultiline">',
        '                ^ $ ใช้ต่อบรรทัด (m)</label>',
        '            <label><input type="checkbox" id="regexGlobal">',
        '                จับทุกที่ที่พบ (g)</label>',
        '        </div>',

        '        <div class="regex-result">',
        '            <div class="regex-result-head">',
        '                <h3>regex ที่ได้</h3>',
        '                <button id="regexCopyBtn" type="button" class="plain">คัดลอก</button>',
        '            </div>',
        '            <pre id="regexOutput" class="regex-code empty">ยังไม่ได้ใส่คำขึ้นต้น/คำลงท้าย</pre>',
        '            <p class="hint" id="regexFlags"></p>',
        '            <p id="regexCopyStatus" class="db-status"></p>',
        '        </div>',

        '        <div class="regex-explain">',
        '            <h3>ความหมาย (อ่านเป็นภาษาคน)</h3>',
        '            <ol id="regexExplainList" class="regex-steps"></ol>',
        '            <p id="regexExplainStatus" class="db-status"></p>',
        '        </div>',
        '    </section>',

        // ── อธิบาย regex ที่มีอยู่ ──
        '    <section class="suggest-settings">',
        '        <h2>อธิบาย regex ที่มีอยู่</h2>',
        '        <p class="hint">วาง regex ที่ได้มาจากที่อื่น (หรือพิมพ์เอง) เพื่อดูว่ามันจับอะไร',
        '            — ใส่ flag ได้ทั้งแบบ /.../i หรือพิมพ์เฉพาะ pattern</p>',

        '        <div class="field">',
        '            <label for="regexCustom">regex</label>',
        '            <textarea id="regexCustom" rows="2" spellcheck="false"',
        '                      placeholder="เช่น เลขที่\\s*[:：]?\\s*([^\\n]+)"></textarea>',
        '        </div>',

        '        <ol id="regexCustomSteps" class="regex-steps"></ol>',
        '        <p id="regexCustomStatus" class="db-status"></p>',
        '    </section>',

        // ── ทดสอบกับข้อความ ──
        '    <section class="suggest-settings">',
        '        <h2>ทดสอบกับข้อความ</h2>',

        '        <div class="field">',
        '            <label for="regexTestSource">ใช้ regex จาก</label>',
        '            <select id="regexTestSource">',
        '                <option value="generated">regex ที่สร้างด้านบน</option>',
        '                <option value="custom">regex ที่พิมพ์ในช่องอธิบาย</option>',
        '            </select>',
        '        </div>',

        '        <div class="field">',
        '            <label for="regexSample">ข้อความตัวอย่าง</label>',
        '            <textarea id="regexSample" rows="5"',
        '                      placeholder="วางข้อความที่มีข้อมูลอยู่ เช่น &#10;เลขที่ 001/2569&#10;วันที่ 1/10/2569"></textarea>',
        '        </div>',

        '        <p class="hint" id="regexTestStatus"></p>',
        '        <ul id="regexTestList" class="regex-matches"></ul>',
        '    </section>',

        '</div>'
    ].join('\n');

    // ค่าที่กรอกไว้ — จำข้ามการเปลี่ยนหน้า (DOM ถูกวาดใหม่ทุกครั้ง)
    const state = {
        prefix: '',
        gap: 'colon-space',
        valueType: 'line',
        suffix: '',
        anchor: false,
        ignoreCase: false,
        multiline: false,
        global: false,
        custom: '',
        sample: '',
        testSource: 'generated'
    };

    const MAX_SHOWN_MATCHES = 50;

    function el(id) {
        return document.getElementById(id);
    }

    function setStatus(node, message, kind) {
        if (!node) return;

        node.textContent = message || '';
        node.className = 'db-status' + (kind ? ' ' + kind : '');
    }

    function renderSteps(list, parts) {
        if (!list) return;

        list.innerHTML = '';

        (parts || []).forEach(function (part) {
            const item = document.createElement('li');
            item.textContent = part.text;
            list.appendChild(item);
        });
    }

    // ยังไม่มีคำขึ้นต้น/คำลงท้าย = ยังไม่มีอะไรให้สร้าง
    function hasGeneratorInput() {
        return state.prefix.trim() !== '' || state.suffix.trim() !== '';
    }

    const EMPTY_OUTPUT = 'ยังไม่ได้ใส่คำขึ้นต้น/คำลงท้าย';

    function currentExpression() {
        if (state.testSource === 'custom') {
            return el('regexCustom') ? el('regexCustom').value : state.custom;
        }

        if (!hasGeneratorInput()) return '';

        const built = scope.RegexBuilder.build({
            prefix: state.prefix,
            gap: state.gap,
            valueType: state.valueType,
            suffix: state.suffix,
            anchor: state.anchor,
            ignoreCase: state.ignoreCase,
            multiline: state.multiline,
            global: state.global
        });

        return built.ok ? built.full : '';
    }

    // ──────────────────────────────────────────────────────────────
    // ตัวสร้าง regex
    // ──────────────────────────────────────────────────────────────

    function updateGenerated() {
        const output = el('regexOutput');
        const explainList = el('regexExplainList');
        const explainStatus = el('regexExplainStatus');
        const flagsLine = el('regexFlags');

        if (!hasGeneratorInput()) {
            if (output) {
                output.textContent = EMPTY_OUTPUT;
                output.classList.add('empty');
            }

            renderSteps(explainList, []);
            setStatus(explainStatus, '');

            if (flagsLine) flagsLine.textContent = '';

            return;
        }

        const built = scope.RegexBuilder.build({
            prefix: state.prefix,
            gap: state.gap,
            valueType: state.valueType,
            suffix: state.suffix,
            anchor: state.anchor,
            ignoreCase: state.ignoreCase,
            multiline: state.multiline,
            global: state.global
        });

        if (!built.ok) {
            if (output) {
                output.textContent = '';
                output.classList.add('empty');
            }

            renderSteps(explainList, []);
            setStatus(explainStatus, built.error, 'error');

            if (flagsLine) flagsLine.textContent = '';

            return;
        }

        if (output) {
            output.textContent = built.full;
            output.classList.remove('empty');
        }

        if (flagsLine) {
            const flagsText = scope.RegexBuilder.describeFlags(built.flags);

            flagsLine.textContent = built.flags
                ? 'flag: ' + built.flags + ' — ' + flagsText.join(' · ')
                : 'ไม่มี flag เพิ่มเติม';
        }

        const described = scope.RegexBuilder.describe(built.full);

        renderSteps(explainList, described.ok ? described.parts : []);
        setStatus(
            explainStatus,
            described.ok ? '' : described.error,
            described.ok ? '' : 'error'
        );
    }

    // ──────────────────────────────────────────────────────────────
    // อธิบาย regex ที่พิมพ์เอง
    // ──────────────────────────────────────────────────────────────

    function updateCustom() {
        const input = el('regexCustom');
        const list = el('regexCustomSteps');
        const status = el('regexCustomStatus');

        if (input) state.custom = input.value;

        const value = state.custom.trim();

        if (value === '') {
            renderSteps(list, []);
            setStatus(status, '');
            return;
        }

        const described = scope.RegexBuilder.describe(value);

        if (!described.ok) {
            renderSteps(list, []);
            setStatus(status, described.error, 'error');
            return;
        }

        renderSteps(list, described.parts);
        setStatus(
            status,
            described.flags.length > 0
                ? 'flag ' + described.flags + ' — ' +
                    described.flagsText.join(' · ')
                : ''
        );
    }

    // ──────────────────────────────────────────────────────────────
    // ทดสอบกับข้อความ
    // ──────────────────────────────────────────────────────────────

    function updateTest() {
        const list = el('regexTestList');
        const status = el('regexTestStatus');

        if (!list || !status) return;

        list.innerHTML = '';

        const expression = currentExpression();
        const sample = state.sample;

        if (expression === '') {
            setStatus(status, 'ยังไม่มี regex ให้ทดสอบ — ใส่คำขึ้นต้น/คำลงท้ายด้านบนก่อน');
            return;
        }

        if (sample.trim() === '') {
            setStatus(status, 'วางข้อความตัวอย่างเพื่อดูว่า regex จับอะไรได้');
            return;
        }

        const result = scope.RegexBuilder.findMatches(expression, sample);

        if (!result.ok) {
            setStatus(status, result.error, 'error');
            return;
        }

        if (result.matches.length === 0) {
            setStatus(status, 'ไม่พบข้อมูลที่ตรงกับ regex นี้ในข้อความตัวอย่าง', 'error');
            return;
        }

        setStatus(
            status,
            'พบ ' + result.matches.length + ' จุด' +
            (result.matches.length > 1 && !expression.match(/\/[a-z]*g/) &&
                state.testSource === 'custom'
                ? ' (regex ไม่มี flag g — ทดสอบนี้จับให้ทุกจุดอยู่แล้ว)'
                : '') +
            (result.truncated
                ? ' · แสดง ' + MAX_SHOWN_MATCHES + ' จุดแรก'
                : '')
        );

        result.matches.slice(0, MAX_SHOWN_MATCHES).forEach(function (match, index) {
            const item = document.createElement('li');

            const head = document.createElement('span');
            head.className = 'regex-match-head';
            head.textContent =
                '#' + (index + 1) +
                ' · บรรทัด ' + match.line +
                ' · ตำแหน่งที่ ' + (match.index + 1);

            const value = document.createElement('code');
            value.className = 'regex-match-value';
            value.textContent = match.value === '' ? '(ข้อความว่าง)' : match.value;

            item.appendChild(head);
            item.appendChild(value);

            const groups = match.groups.filter(function (group) {
                return group !== '';
            });

            if (groups.length > 0) {
                const groupText = document.createElement('span');
                groupText.className = 'regex-match-groups';
                groupText.textContent = 'กลุ่ม: ' + groups.join(' | ');
                item.appendChild(groupText);
            }

            list.appendChild(item);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // คัดลอก
    // ──────────────────────────────────────────────────────────────

    function fallbackCopy(value) {
        const area = document.createElement('textarea');

        area.value = value;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.opacity = '0';

        document.body.appendChild(area);
        area.select();

        const copied = document.execCommand('copy');

        document.body.removeChild(area);

        if (!copied) {
            throw new Error('คัดลอกไม่สำเร็จ');
        }
    }

    async function copyGenerated() {
        const output = el('regexOutput');
        const status = el('regexCopyStatus');

        if (!output || output.classList.contains('empty') || output.textContent === '') {
            setStatus(status, 'ยังไม่มี regex ให้คัดลอก');
            return;
        }

        const value = output.textContent;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                fallbackCopy(value);
            }

            setStatus(status, 'คัดลอกแล้ว');
        } catch (error) {
            try {
                fallbackCopy(value);
                setStatus(status, 'คัดลอกแล้ว');
            } catch (fallbackError) {
                setStatus(
                    status,
                    'คัดลอกไม่สำเร็จ — เลือกข้อความในกล่องแล้วกด Ctrl+C',
                    'error'
                );
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ผูก event (DOM ถูกสร้างใหม่ทุกครั้งที่เข้าหน้า)
    // ──────────────────────────────────────────────────────────────

    function bind() {
        const prefix = el('regexPrefix');
        const gap = el('regexGap');
        const valueType = el('regexValueType');
        const suffix = el('regexSuffix');
        const anchor = el('regexAnchor');
        const ignoreCase = el('regexIgnoreCase');
        const multiline = el('regexMultiline');
        const global = el('regexGlobal');
        const custom = el('regexCustom');
        const sample = el('regexSample');
        const testSource = el('regexTestSource');
        const copyBtn = el('regexCopyBtn');

        if (!prefix) return;

        prefix.addEventListener('input', function () {
            state.prefix = prefix.value;
            updateGenerated();
            updateTest();
        });

        gap.addEventListener('change', function () {
            state.gap = gap.value;
            updateGenerated();
            updateTest();
        });

        valueType.addEventListener('change', function () {
            state.valueType = valueType.value;
            updateGenerated();
            updateTest();
        });

        suffix.addEventListener('input', function () {
            state.suffix = suffix.value;
            updateGenerated();
            updateTest();
        });

        [
            { node: anchor, key: 'anchor' },
            { node: ignoreCase, key: 'ignoreCase' },
            { node: multiline, key: 'multiline' },
            { node: global, key: 'global' }
        ].forEach(function (item) {
            item.node.addEventListener('change', function () {
                state[item.key] = item.node.checked;
                updateGenerated();
                updateTest();
            });
        });

        custom.addEventListener('input', function () {
            updateCustom();
            updateTest();
        });

        sample.addEventListener('input', function () {
            state.sample = sample.value;
            updateTest();
        });

        testSource.addEventListener('change', function () {
            state.testSource = testSource.value;
            updateTest();
        });

        copyBtn.addEventListener('click', copyGenerated);
    }

    // เติมค่าที่จำไว้กลับเข้าช่อง (หลัง DOM ถูกวาดใหม่)
    function applyState() {
        const values = {
            regexPrefix: state.prefix,
            regexGap: state.gap,
            regexValueType: state.valueType,
            regexSuffix: state.suffix,
            regexCustom: state.custom,
            regexSample: state.sample,
            regexTestSource: state.testSource
        };

        Object.keys(values).forEach(function (id) {
            const node = el(id);

            if (node) node.value = values[id];
        });

        const checks = {
            regexAnchor: state.anchor,
            regexIgnoreCase: state.ignoreCase,
            regexMultiline: state.multiline,
            regexGlobal: state.global
        };

        Object.keys(checks).forEach(function (id) {
            const node = el(id);

            if (node) node.checked = checks[id];
        });
    }

    const page = {

        // หน้านี้จัดการ UI เอง ไม่ขึ้นกับไฟล์ .docx
        standalone: true,

        getHTML: function () {
            return HTML;
        },

        // เรียกจาก app.js หลังวาดหน้าเสร็จ — ผูก event + เติมค่าที่จำไว้
        onShow: function () {
            bind();
            applyState();
            updateGenerated();
            updateCustom();
            updateTest();
        }
    };

    scope.RegexPage = page;
})(window);
