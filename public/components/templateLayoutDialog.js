// Template Layout Dialog - หน้าจัดตำแหน่ง: ดูเอกสารจริง + แก้ข้อความ + บันทึกกลับ
//
// ต่างจาก previewDialog.js (ที่ตั้งใจแสดงแค่ข้อความตามลำดับย่อหน้า ไม่แสดงฟอนต์/ระยะ)
// หน้านี้เรนเดอร์เอกสารด้วย docx-preview ให้เห็นฟอนต์ ขนาดกระดาษ ขอบกระดาษ
// และการตัดขึ้นหน้าใหม่เหมือนเปิดใน Word แล้วพิมพ์แก้ข้อความได้ตรงหน้า
//
// การเขียนกลับลงไฟล์:
// - เก็บข้อความเดิมของแต่ละย่อหน้าที่เรนเดอร์ไว้ เทียบตอนกดบันทึกว่าแก้ย่อหน้าไหน
// - เขียนกลับเฉพาะช่วงที่ต่าง ผ่าน Replace.setParagraphTexts
//   run ที่ไม่ถูกแก้จึงคงฟอนต์/ตัวหนาเดิมไว้
// - docx-preview เรนเดอร์ย่อหน้าออกมาเป็น <p> ตามลำดับ w:p ในเอกสาร
//   จึงจับคู่ด้วย "ข้อความ + ลำดับ" (ตัวเรนเดอร์ข้าม/แยกย่อหน้าบ้างเป็นเรื่องปกติ)
//
// ข้อจำกัดที่แสดงให้ผู้ใช้เห็น (ไม่เงียบ ๆ):
// - ย่อหน้าที่ตัวเรนเดอร์ตัดขึ้นหน้าใหม่กลางย่อหน้า (มี w:br type="page")
//   จับคู่กับต้นฉบับไม่ได้ จึงล็อกไว้ไม่ให้แก้
// - หัว/ท้ายกระดาษและเชิงอรรถแสดงให้เห็น แต่แก้ไม่ได้ (ไม่ใช่เนื้อเรื่อง)
// - กด Enter เพิ่มย่อหน้าใหม่ไม่ได้ (w:p ใหม่ต้องสร้างใน Word แล้วอัปโหลดทับ)
//
// การจัดรูปแบบข้อความ (ตัวหนา / ตัวบาง / ตัวเอียง / ขีดเส้นใต้):
// - ทำกับข้อความที่เลือกในย่อหน้าที่แก้ได้ (Ctrl+B / Ctrl+I / Ctrl+U หรือปุ่มบนแถบ)
// - ตอนบันทึกจะเทียบรูปแบบที่เห็นบนหน้าจอกับตอนเรนเดอร์ แล้วเขียน w:b / w:i / w:u
//   กลับลงเฉพาะช่วงที่เปลี่ยน ผ่าน Replace.setParagraphFormats
//   การตัด run ใหม่คง rPr เดิมไว้ (ฟอนต์/ขนาด/สี/ระยะ ไม่เพี้ยน)
//
// สัญลักษณ์ (w:sym) และแท็บ (w:tab) ของเอกสาร:
// - ตัวเรนเดอร์วาดเป็นอักขระ Private Use Area / \u2003 ซึ่งไม่มีอักขระจริงในเอกสาร
//   จึงล็อกชิ้นเหล่านี้ไม่ให้แก้หรือลบ และตัดอักขระเหล่านั้นออกตอนเขียนข้อความกลับ
//   (ถ้าเขียนกลับเป็นตัวอักษรจริง เครื่องหมายถูก/กล่องสี่เหลี่ยมจะเพี้ยนและซ้อนกัน)
//
// การขึ้นหน้าใหม่:
// - docx-preview แยกหน้ากระดาษตาม w:br type="page", w:lastRenderedPageBreak,
//   w:pageBreakBefore และการเปลี่ยน section — หน้ากระดาษที่ 2 ขึ้นไปจะติดป้าย
//   "ขึ้นหน้าใหม่" ให้เห็นตรงกับที่ Word ตัดหน้า (ดู style.css)
//
// ไฟล์/ฐานข้อมูลเป็นเรื่องของ app.js — ที่นี่แค่เรียก payload.save / payload.download
(function (scope) {
    'use strict';

    const FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_ก-๙]+)\s*\}\}/g;

    // อักขระที่ docx-preview วาดขึ้นเอง — ไม่มีอยู่ใน w:t ของเอกสาร
    // (สัญลักษณ์ w:sym → อักขระ Private Use Area, แท็บ w:tab → em space)
    // ตอนเขียนข้อความกลับต้องตัดออก ไม่งั้นจะกลายเป็น "ตัวอักษรจริง" ใน Word
    // แล้วสัญลักษณ์/แท็บเดิมที่ยังอยู่ในเอกสารจะซ้อนขึ้นมาอีกชิ้น
    const RENDERED_ONLY = /[\uE000-\uF8FF\u2003]/g;

    // ปุ่มบนแถบเครื่องมือ → คำสั่งจัดรูปแบบของ contentEditable
    const FORMAT_BUTTONS = {
        layoutBoldBtn: 'bold',
        layoutItalicBtn: 'italic',
        layoutUnderlineBtn: 'underline',
        layoutThinBtn: 'thin'
    };

    // ชื่อ highlight ของ CSS Custom Highlight API (ไฮไลต์ {{...}} เป็นสีเหลือง)
    const FIELD_HIGHLIGHT = 'layout-field';

    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

    // 1 EMU = 1/914400 นิ้ว, 1 px = 1/96 นิ้ว → 914400 / 96 = 9525 EMU ต่อ px
    const EMU_PER_PX = 9525;

    // 1 twip = 1/1440 นิ้ว, 1 px = 1/96 นิ้ว → 1440 / 96 = 15 twips ต่อ px
    const TWIPS_PER_PX = 15;

    // ระยะชดเชยแนวตั้ง (px) ของวัตถุที่อ้างจาก "ย่อหน้า/บรรทัด"
    //
    // Word วัดระยะแนวตั้งจากบรรทัดแรกของย่อหน้า ส่วน CSS วัดจากขอบบนของกล่องย่อหน้า
    // (ต่างกันที่ half-leading ของ line-height) ค่านี้ตั้งเทียบกับเอกสารราชการจริง
    // (ดู commit 85fe65f "add top position -10") — อย่าแก้โดยไม่เทียบกับไฟล์จริง
    //
    // วัตถุที่อ้างจากหน้า/ขอบกระดาษ ไม่ใช้ค่านี้ เพราะคำนวณจากกล่องหน้าตรง ๆ อยู่แล้ว
    const PARAGRAPH_TOP_CORRECTION_PX = 10;

    // อ่าน word/document.xml เป็น DOM (คืน null ถ้า XML เสีย)
    function parseXml(xml) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');

        return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
    }

    const HTML = [
        '<div class="layout-backdrop" data-layout-close></div>',
        '<div class="layout-dialog" role="dialog" aria-modal="true" aria-labelledby="layoutTitle">',
        '    <div class="layout-head">',
        '        <h2 id="layoutTitle">จัดตำแหน่ง</h2>',
        '        <button type="button" class="layout-close" data-layout-close aria-label="ปิด">&times;</button>',
        '    </div>',
        '    <div class="layout-toolbar">',
        '        <label class="layout-toggle"><input type="checkbox" id="layoutEditToggle" checked> แก้ไขข้อความ</label>',
        '        <div class="layout-format" role="toolbar" aria-label="จัดรูปแบบข้อความ">',
        '            <button type="button" id="layoutBoldBtn" class="layout-fmt" title="ตัวหนา (Ctrl+B) — กดซ้ำเพื่อกลับเป็นตัวบาง"><strong>B</strong></button>',
        '            <button type="button" id="layoutThinBtn" class="layout-fmt" title="ตัวบาง — เอาตัวหนาออกจากข้อความที่เลือก">ตัวบาง</button>',
        '            <button type="button" id="layoutItalicBtn" class="layout-fmt" title="ตัวเอียง (Ctrl+I)"><em>I</em></button>',
        '            <button type="button" id="layoutUnderlineBtn" class="layout-fmt" title="ขีดเส้นใต้ (Ctrl+U)"><u>U</u></button>',
        '        </div>',
        '        <label class="layout-toggle"><input type="checkbox" id="layoutFieldToggle" checked> ไฮไลต์ {{}} สีเหลือง</label>',
        '        <label class="layout-toggle">ย่อ/ขยาย',
        '            <select id="layoutZoom">',
        '                <option value="fit" selected>พอดีความกว้าง</option>',
        '                <option value="0.5">50%</option>',
        '                <option value="0.75">75%</option>',
        '                <option value="1">100%</option>',
        '                <option value="1.25">125%</option>',
        '                <option value="1.5">150%</option>',
        '                <option value="2">200%</option>',
        '            </select>',
        '        </label>',
        '        <span class="layout-hint">คลิกข้อความในเอกสารแล้วพิมพ์แก้ได้เลย · เลือกข้อความแล้วจัดรูปแบบจากปุ่มด้านบน · หัว/ท้ายกระดาษกับสัญลักษณ์ของเอกสารแก้ไม่ได้</span>',
        '        <span id="layoutStatus" class="layout-status"></span>',
        '        <div class="layout-actions">',
        '            <button type="button" id="layoutResetBtn" class="plain">ย้อนกลับ</button>',
        '            <button type="button" id="layoutDownloadBtn" class="plain">ดาวน์โหลด .docx</button>',
        '            <button type="button" id="layoutSaveBtn">บันทึกกลับเข้าไป</button>',
        '        </div>',
        '    </div>',
        '    <div class="layout-body" id="layoutBody">',
        '        <div class="layout-preview" id="layoutPreview"></div>',
        '    </div>',
        '    <div class="layout-style" id="layoutStyle"></div>',
        '</div>'
    ].join('\n');

    let overlay = null;      // popup (สร้างครั้งเดียวตอนเปิดครั้งแรก)
    let host = null;         // กล่องเนื้อเอกสารที่ docx-preview เรนเดอร์ลง
    let styleHost = null;    // ที่วาง <style> ของ docx-preview
    let statusEl = null;     // ข้อความสถานะบนแถบเครื่องมือ
    let current = null;      // { payload, xml, bytes, pairs, statusKind }
    let renderToken = 0;     // กันผลการเรนเดอร์รอบเก่ามาทับรอบใหม่
    let touched = new Set(); // ย่อหน้าที่ถูกแก้ตั้งแต่เรนเดอร์ครั้งล่าสุด
    let highlightTimer = 0;  // กันการไฮไลต์ {{}} ถี่เกินไประหว่างพิมพ์
    let layoutTimer = 0;     // กันการจัดตำแหน่งรูป/กล่องข้อความถี่เกินไประหว่างพิมพ์

    function el(id) {
        return document.getElementById(id);
    }

    function messageOf(error) {
        return error && error.message ? error.message : String(error);
    }

    function setStatus(text, kind) {
        if (!current) return;

        current.statusKind = kind || '';

        if (!statusEl) return;

        statusEl.textContent = text || '';
        statusEl.className = 'layout-status' + (kind ? ' ' + kind : '');
    }

    function editOn() {
        const toggle = el('layoutEditToggle');
        return !!(toggle && toggle.checked);
    }

    // ──────────────────────────────────────────────────────────────
    // เปิด / ปิด
    // ──────────────────────────────────────────────────────────────

    function close() {
        if (!overlay) return;

        overlay.classList.remove('open');

        // เรนเดอร์ที่ค้างอยู่ไม่ต้องทำต่อ (และไม่ต้องแก้เนื้อหาเดิม)
        renderToken++;

        if (current) current.pairs = new Map();

        // ลบไฮไลต์ {{}} ออกจากทะเบียนของเอกสาร (range อ้าง node ที่จะถูกล้าง)
        clearFieldHighlight();
    }

    // payload = { name, bytes, xml, save(newXml) -> Promise<newBytes>, download(newXml) }
    function open(payload) {
        buildOverlay();

        const data = payload || {};

        current = {
            payload: data,
            xml: data.xml || '',
            bytes: data.bytes || null,
            pairs: new Map(),
            statusKind: ''
        };

        const title = el('layoutTitle');

        if (title) {
            title.textContent = 'จัดตำแหน่ง — ' + (data.name || '');
        }

        const editToggle = el('layoutEditToggle');
        if (editToggle) editToggle.checked = true;

        const fieldToggle = el('layoutFieldToggle');
        if (fieldToggle) fieldToggle.checked = true;

        setStatus('');
        overlay.classList.add('open');

        return renderDocx(current.bytes);
    }

    // ──────────────────────────────────────────────────────────────
    // เรนเดอร์เอกสาร
    // ──────────────────────────────────────────────────────────────

    async function renderDocx(bytes) {
        if (!host) return;

        const token = ++renderToken;

        if (bytes) current.bytes = bytes;

        host.innerHTML = '';
        applyFieldHighlight();

        if (!current.bytes) {
            setStatus('ไม่พบไฟล์เอกสาร', 'error');
            return;
        }

        if (!scope.docx || !scope.docx.renderAsync) {
            setStatus('โหลดไลบรารี docx-preview ไม่ได้ (ไฟล์ vendor หาย)', 'error');
            return;
        }

        setStatus('กำลังเรนเดอร์เอกสาร...');

        try {
            await scope.docx.renderAsync(current.bytes, host, styleHost, {
                className: 'docx',
                inWrapper: true,
                // ตัดขึ้นหน้าใหม่ + ใช้ขนาดกระดาษ/ขอบจากไฟล์จริง
                breakPages: true,
                ignoreWidth: false,
                ignoreHeight: false,
                // หัว/ท้ายกระดาษ/เชิงอรรถแสดงให้เห็น แต่แก้ไม่ได้
                renderHeaders: true,
                renderFooters: true,
                renderFootnotes: true,
                useBase64URL: false
            });
        } catch (error) {
            console.error(error);

            if (token === renderToken) {
                setStatus('เรนเดอร์เอกสารไม่สำเร็จ: ' + messageOf(error), 'error');
            }

            return;
        }

        // มีการปิด/เรนเดอร์ใหม่ระหว่างรอ = ทิ้งผลรอบนี้
        if (token !== renderToken) return;

        // วาดเสร็จแล้ว → ย่อ/ขยายให้พอดี แล้ววางรูปที่ลอย/กล่องข้อความ/ตารางให้ตรงตำแหน่ง
        // (applyZoom เป็นคนเรียก fixRenderedLayout หลังตั้ง zoom แล้ว)
        applyZoom();

        // ฟอนต์โหลดเสร็จอาจขยับตำแหน่งข้อความ → รูปที่อ้างจากย่อหน้าต้องจัดใหม่
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                if (token === renderToken) fixRenderedLayout();
            });
        }

        // เรนเดอร์รอบใหม่ = เริ่มนับการแก้ใหม่ทั้งหมด
        touched = new Set();

        prepareEditing();
        applyFieldHighlight();
        setStatus('');
    }

    // ──────────────────────────────────────────────────────────────
    // จับคู่ย่อหน้าในเอกสารที่เรนเดอร์แล้ว กับ w:p ใน word/document.xml
    // ──────────────────────────────────────────────────────────────

    // ข้อความสำหรับเทียบ — เอาเฉพาะ "ตัวอักษรที่พิมพ์ได้"
    //
    // ฝั่ง XML (listParagraphTexts) เก็บแต่ข้อความใน <w:t> ส่วนแท็บ (<w:tab/>)
    // และสัญลักษณ์ (<w:sym/>) ไม่ถูกนับ แต่ฝั่งเรนเดอร์ docx-preview วาดแท็บเป็น
    // \u2003 และวาด <w:sym/> เป็นตัวอักษร Private Use Area (กล่อง/เครื่องหมายถูก)
    // ถ้าเทียบตรงตัวจะไม่ตรงตั้งแต่ย่อหน้าแรก ๆ ที่มีช่องทำเครื่องหมาย
    // แล้วจับคู่เพี้ยนต่อกันเป็นทอด ๆ จนแก้ข้อความไม่ได้
    function normalizeText(text) {
        return String(text == null ? '' : text)
            .replace(/[\uE000-\uF8FF]/g, '')      // PUA (สัญลักษณ์ที่ตัวเรนเดอร์วาด)
            .replace(/\u2003/g, '')                // แท็บที่ตัวเรนเดอร์วาด
            .replace(/\s+/g, '');                  // ช่องว่างทั้งหมด
    }

    // ย่อหน้าของเนื้อเรื่อง — หัว/ท้ายกระดาษและเชิงอรรถอยู่นอก <article>
    function bodyParagraphs() {
        return Array.from(host.querySelectorAll('article p'));
    }

    // ข้อความของย่อหน้าหนึ่ง ๆ ในหน้าที่เรนเดอร์แล้ว
    // ไม่นับข้อความของย่อหน้าที่ซ้อนอยู่ข้างใน (กล่องข้อความ VML เรนเดอร์เป็น <p>
    // ซ้อนอยู่ใน <p> ของย่อหน้าแม่) — ให้ตรงกับฝั่ง XML ที่นับย่อหน้าซ้อนแยกกัน
    function renderedText(node) {
        let text = '';

        function walk(current) {
            for (let i = 0; i < current.childNodes.length; i++) {
                const child = current.childNodes[i];

                if (child.nodeType !== 1) {
                    text += child.textContent || '';
                    continue;
                }

                if (child.localName === 'p') continue;

                walk(child);
            }
        }

        walk(node);
        return text;
    }

    // ข้อความของย่อหน้าสำหรับ "แก้/บันทึก" — ตัดอักขระที่ตัวเรนเดอร์วาดเองออก
    // (สัญลักษณ์ w:sym และแท็บ w:tab ไม่มีอักขระในเอกสาร ถ้าเขียนกลับจะเพี้ยน)
    function cleanText(text) {
        return String(text == null ? '' : text).replace(RENDERED_ONLY, '');
    }

    // ──────────────────────────────────────────────────────────────
    // รูปแบบข้อความที่เห็นบนหน้าจอ (ตัวหนา / ตัวเอียง / ขีดเส้นใต้)
    //
    // docx-preview เขียนรูปแบบเป็นสไตล์ในบรรทัด (font-weight: bold,
    // font-style: italic, text-decoration: underline) ไม่ได้ใช้ <b>/<i>/<u>
    // จึงต้องอ่านจาก computed style ของชิ้นที่ครอบข้อความนั้น
    // ──────────────────────────────────────────────────────────────

    function isBold(element) {
        const weight = window.getComputedStyle(element).fontWeight;

        if (!weight) return false;

        if (weight === 'bold' || weight === 'bolder') return true;

        const numeric = Number(weight);

        return isFinite(numeric) && numeric >= 600;
    }

    function isItalic(element) {
        return window.getComputedStyle(element).fontStyle === 'italic';
    }

    function isUnderlined(element) {
        const style = window.getComputedStyle(element);

        return String(style.textDecorationLine || style.textDecoration || '')
            .indexOf('underline') !== -1;
    }

    // อักขระ PUA ที่ตัวเรนเดอร์วาดแทน w:sym (ไม่มีอักขระจริงในเอกสาร)
    function symbolOf(element) {
        if (!element || element.localName !== 'span') return null;

        const text = element.textContent || '';

        if (text.length !== 1) return null;

        const code = text.charCodeAt(0);

        if (!(code >= 0xE000 && code <= 0xF8FF)) return null;

        return {
            char: code,
            font: element.style.fontFamily || ''
        };
    }

    // แท็บ w:tab — ตัวเรนเดอร์วาดเป็น em space ใน <span>
    function isTabSpan(element) {
        return !!element
            && element.localName === 'span'
            && element.textContent === '\u2003';
    }

    // ชิ้นของเอกสารที่ไม่มีอักขระจริง — ห้ามแก้/ลบ
    function isSpecialSpan(element) {
        return isTabSpan(element) || symbolOf(element) !== null;
    }

    // ล็อกสัญลักษณ์/แท็บของเอกสาร (ไม่ให้พิมพ์ทับหรือลบ) พร้อมอธิบายว่าคืออะไร
    // - สัญลักษณ์ที่ฟอนต์ไม่ครบจะเห็นเป็นกล่อง — tooltip บอกว่าเป็นสัญลักษณ์อะไร
    function decorateSpecials() {
        if (!host) return;

        host.querySelectorAll('article span').forEach(function (span) {
            const symbol = symbolOf(span);
            const tab = isTabSpan(span);

            if (!symbol && !tab) return;

            span.classList.add('layout-special');
            span.contentEditable = 'false';
            span.setAttribute('spellcheck', 'false');

            span.title = symbol
                ? 'สัญลักษณ์ของเอกสาร (' + (symbol.font || 'symbol font') +
                    ' รหัส ' + symbol.char.toString(16).toUpperCase() +
                    ') — แก้จากที่นี่ไม่ได้'
                : 'แท็บ (ระยะจัดแนวของเอกสาร) — แก้จากที่นี่ไม่ได้';
        });
    }

    // รูปแบบของ "ทุกอักขระ" ในย่อหน้า — รวมช่วงที่รูปแบบเดียวกันไว้ด้วยกัน
    // ชิ้นที่ไม่ใช่ข้อความ (แท็บ/สัญลักษณ์/รูป) ถูกข้าม จึงตรงกับข้อความของย่อหน้า
    // ในเอกสาร (ดู listParagraphTexts) ทำให้เทียบ offset กันได้ตรง ๆ
    function domFormatRuns(node) {
        const runs = [];

        function push(text, element) {
            if (!text) return;

            const bold = isBold(element);
            const italic = isItalic(element);
            const underline = isUnderlined(element);
            const last = runs[runs.length - 1];

            if (last && last.bold === bold && last.italic === italic
                && last.underline === underline) {
                last.text += text;
                return;
            }

            runs.push({
                text: text,
                bold: bold,
                italic: italic,
                underline: underline
            });
        }

        (function walk(current) {
            for (let i = 0; i < current.childNodes.length; i++) {
                const child = current.childNodes[i];

                if (child.nodeType === 3) {
                    push(cleanText(child.textContent || ''), child.parentNode);
                    continue;
                }

                if (child.nodeType !== 1) continue;

                // กล่องข้อความซ้อน / ขึ้นบรรทัดใหม่ / แท็บ / สัญลักษณ์ = ไม่นับอักขระ
                if (child.localName === 'p') continue;
                if (child.localName === 'br') continue;
                if (isSpecialSpan(child)) continue;

                walk(child);
            }
        })(node);

        return runs;
    }

    // รูปแบบของแต่ละอักขระ (index = ตำแหน่งในข้อความย่อหน้า)
    function flagsPerChar(runs) {
        const flags = [];

        runs.forEach(function (run) {
            for (let i = 0; i < run.text.length; i++) {
                flags.push({
                    bold: run.bold,
                    italic: run.italic,
                    underline: run.underline
                });
            }
        });

        return flags;
    }

    // ช่วงที่ต่างของข้อความก่อน/หลัง (ตัดหัว-ท้ายที่เหมือนกันออก)
    function textDiff(before, after) {
        let start = 0;
        const limit = Math.min(before.length, after.length);

        while (start < limit && before.charAt(start) === after.charAt(start)) start++;

        let endBefore = before.length;
        let endAfter = after.length;

        while (
            endBefore > start &&
            endAfter > start &&
            before.charAt(endBefore - 1) === after.charAt(endAfter - 1)
        ) {
            endBefore--;
            endAfter--;
        }

        return { start: start, endBefore: endBefore, endAfter: endAfter };
    }

    // รวมช่วงที่ติดกันและมี "รูปแบบเป้าหมาย/รูปแบบเดิม" เหมือนกันเข้าด้วยกัน
    function mergeChange(changes, index, flag, reference) {
        const last = changes[changes.length - 1];

        if (
            last &&
            last.end === index &&
            last.bold === flag.bold &&
            last.italic === flag.italic &&
            last.underline === flag.underline &&
            last.wasBold === !!reference.bold &&
            last.wasItalic === !!reference.italic &&
            last.wasUnderline === !!reference.underline
        ) {
            last.end = index + 1;
            return;
        }

        changes.push({
            start: index,
            end: index + 1,
            bold: flag.bold,
            italic: flag.italic,
            underline: flag.underline,
            wasBold: !!reference.bold,
            wasItalic: !!reference.italic,
            wasUnderline: !!reference.underline
        });
    }

    // ช่วงที่รูปแบบเปลี่ยน (เทียบกับที่เห็นตอนเรนเดอร์) — ใช้เป็นข้อมูลเขียน w:b/w:i/w:u
    //
    // ค่าก่อนแก้ (was*) มาจากตอนเรนเดอร์ จึงรวมรูปแบบที่มาจากสไตล์ของย่อหน้า
    // การ "เอาตัวหนาออก" ในย่อหน้าที่หนาจากสไตล์จึงเขียน w:b val="0" ได้จริง
    function formatChanges(pair, node, text) {
        // ข้อความบนหน้าจอไม่ตรงกับต้นฉบับ (เช่นมีเลขเชิงอรรถ/ฟิลด์)
        // → offset ไม่ตรงกัน ไม่กล้าเขียนรูปแบบกลับ
        if (!pair.formatSafe) return [];

        if (pair.domRuns.length === 0) return [];

        const beforeRuns = pair.domRuns;
        const afterRuns = domFormatRuns(node);
        const beforeText = beforeRuns.map(function (run) { return run.text; }).join('');
        const afterText = afterRuns.map(function (run) { return run.text; }).join('');

        // อักขระที่ได้จากการไล่ DOM ต้องเท่ากับข้อความที่ใช้ตอนเก็บการแก้ไข
        if (afterText !== text) return [];

        const beforeFlags = flagsPerChar(beforeRuns);
        const afterFlags = flagsPerChar(afterRuns);
        const diff = textDiff(beforeText, afterText);
        const delta = afterText.length - beforeText.length;
        const changes = [];

        for (let i = 0; i < afterText.length; i++) {
            let reference = null;

            if (i < diff.start) {
                reference = beforeFlags[i];
            } else if (i >= diff.endAfter) {
                reference = beforeFlags[i - delta];
            } else {
                // อักขระที่พิมพ์ใหม่ — เทียบกับอักขระที่อยู่ก่อนหน้า (ถ้าไม่มีก็ตัวแรก)
                reference = beforeFlags[diff.start > 0 ? diff.start - 1 : 0];
            }

            const flag = afterFlags[i];

            if (!flag || !reference) continue;

            if (
                flag.bold === !!reference.bold &&
                flag.italic === !!reference.italic &&
                flag.underline === !!reference.underline
            ) {
                continue;
            }

            mergeChange(changes, i, flag, reference);
        }

        return changes;
    }

    // หาลำดับย่อหน้าที่ตรงกันเป๊ะ (ข้อความไม่ว่าง) ด้วย LCS
    // คืนรายการ [indexXml, indexDom] เรียงจากน้อยไปมาก
    // (ใช้เป็นจุดยึดของการจัดแนว เหมือน diff)
    function lcsMatches(xmlNorm, nodeNorm) {
        const n = xmlNorm.length;
        const m = nodeNorm.length;
        const width = m + 1;
        const dp = new Int32Array((n + 1) * width);

        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                const index = i * width + j;
                const skipXml = dp[(i + 1) * width + j];
                const skipDom = dp[i * width + (j + 1)];

                // ย่อหน้าว่างจับคู่ไม่ได้ (มีหลายย่อหน้าเหมือนกัน)
                const same = xmlNorm[i] !== '' && xmlNorm[i] === nodeNorm[j];

                dp[index] = same
                    ? dp[(i + 1) * width + (j + 1)] + 1
                    : (skipXml >= skipDom ? skipXml : skipDom);
            }
        }

        const matches = [];
        let i = 0;
        let j = 0;

        while (i < n && j < m) {
            if (xmlNorm[i] !== '' && xmlNorm[i] === nodeNorm[j]) {
                matches.push([i, j]);
                i++;
                j++;
            } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
                i++;
            } else {
                j++;
            }
        }

        return matches;
    }

    // จับคู่ย่อหน้าด้วยการจัดแนวแบบ diff:
    //   1) จุดยึด = ย่อหน้าที่ข้อความตรงกันเป๊ะ (LCS)
    //   2) ช่วงระหว่างจุดยึดจับคู่กันตามตำแหน่ง (ย่อหน้าที่ 1 ของช่วงคู่กับที่ 1)
    // เดิมใช้การไล่หาคู่ข้างหน้าแบบจำกัดระยะ ทำให้พอเจอย่อหน้า
    // ที่ต่างกัน (เช่นมีสัญลักษณ์ช่องทำเครื่องหมาย) หลายอันติดกัน จับคู่เพี้ยนต่อกัน
    // เป็นทอด ๆ และล็อกย่อหน้าจริงไปทั้งช่วง
    function pairParagraphs(xmlTexts, nodes) {
        const pairs = new Map();
        const xmlNorm = xmlTexts.map(normalizeText);
        const nodeTexts = nodes.map(renderedText);
        const nodeNorm = nodeTexts.map(normalizeText);

        function pairByPosition(xmlFrom, xmlTo, nodeFrom, nodeTo) {
            const count = Math.min(xmlTo - xmlFrom, nodeTo - nodeFrom);

            for (let k = 0; k < count; k++) {
                const xmlIndex = xmlFrom + k;
                const nodeIndex = nodeFrom + k;

                // "ย่อหน้าว่าง" กับ "ย่อหน้ามีข้อความ" จับคู่กันไม่ได้ — ตัวเรนเดอร์
                // อาจข้ามหรือเพิ่มย่อหน้า ทำให้ตำแหน่งเยื้องกัน ถ้าจับคู่แล้วแก้
                // ข้อความจะไปเขียนผิดย่อหน้า (ปล่อยให้ล็อกไว้ปลอดภัยกว่า)
                const xmlEmpty = xmlNorm[xmlIndex] === '';
                const nodeEmpty = nodeNorm[nodeIndex] === '';

                if (xmlEmpty !== nodeEmpty) continue;

                pairs.set(nodes[nodeIndex], {
                    index: xmlIndex,
                    xmlText: xmlTexts[xmlIndex],
                    domText: nodeTexts[nodeIndex]
                });
            }
        }

        let xmlCursor = 0;
        let nodeCursor = 0;

        lcsMatches(xmlNorm, nodeNorm).forEach(function (match) {
            pairByPosition(xmlCursor, match[0], nodeCursor, match[1]);

            pairs.set(nodes[match[1]], {
                index: match[0],
                xmlText: xmlTexts[match[0]],
                domText: nodeTexts[match[1]]
            });

            xmlCursor = match[0] + 1;
            nodeCursor = match[1] + 1;
        });

        pairByPosition(xmlCursor, xmlNorm.length, nodeCursor, nodeNorm.length);

        return pairs;
    }

    // ชื่อ field ที่อยู่ในข้อความย่อหน้า
    function fieldNames(text) {
        const names = [];
        const regex = new RegExp(FIELD_PATTERN.source, 'g');

        let match;

        while ((match = regex.exec(text || '')) !== null) {
            if (names.indexOf(match[1]) === -1) names.push(match[1]);
        }

        return names;
    }

    function prepareEditing() {
        const nodes = bodyParagraphs();

        const xmlTexts = scope.Replace && scope.Replace.listParagraphTexts
            ? scope.Replace.listParagraphTexts(current.xml)
            : null;

        if (!xmlTexts) {
            setStatus('อ่านข้อความจากไฟล์ต้นฉบับไม่ได้ จึงแก้ข้อความไม่ได้', 'error');
            return;
        }

        const pairs = pairParagraphs(xmlTexts, nodes);
        current.pairs = pairs;

        const editable = editOn();
        let lockedCount = 0;

        nodes.forEach(function (node) {
            const pair = pairs.get(node);
            const text = cleanText(renderedText(node));
            const fields = fieldNames(text);

            node.classList.add('layout-para');
            node.setAttribute('spellcheck', 'false');

            if (pair) {
                // ข้อความ + รูปแบบตอนเรนเดอร์ = ฐานสำหรับเทียบว่าอะไรถูกแก้
                // (ข้อความเก็บแบบ "ตัดอักขระที่ตัวเรนเดอร์วาดเอง" ให้ตรงกับ w:t)
                pair.domText = text;
                pair.xmlText = xmlTexts[pair.index];
                pair.domRuns = domFormatRuns(node);

                // เขียนรูปแบบกลับได้เฉพาะเมื่อ offset ตรงกับต้นฉบับเป๊ะ
                // (ย่อหน้าที่มีกล่องข้อความซ้อน/อักขระที่ไม่ตรง จะแก้ได้แต่ข้อความ)
                pair.formatSafe = text === pair.xmlText
                    && node.querySelector('p') === null;
            }

            // ไฮไลต์ย่อหน้าที่มี {{field}} — ช่วยหาตำแหน่งของ field ในเอกสาร
            if (fields.length > 0) {
                node.classList.add('layout-field-para');
            }

            if (!pair) {
                // จับคู่กับต้นฉบับไม่ได้ = ไม่รู้จะเขียนกลับไปตรงไหน
                node.classList.add('layout-para-locked');
                node.contentEditable = 'false';

                if (normalizeText(text) !== '') {
                    lockedCount++;

                    node.title =
                        'ย่อหน้านี้แก้ไม่ได้ (ตัวเรนเดอร์ตัดย่อหน้าออกจากต้นฉบับ ' +
                        'เช่น ขึ้นหน้าใหม่กลางย่อหน้า) — แก้ในไฟล์ Word แล้วกด ' +
                        '"อัปโหลดไฟล์ใหม่ทับไฟล์เดิม" แทน';
                }

                return;
            }

            node.contentEditable = editable ? 'true' : 'false';

            if (fields.length > 0) {
                node.title = 'field: ' + fields.join(', ');
            }
        });

        decorateSpecials();
        refreshFormatButtons();

        if (lockedCount > 0) {
            setStatus(
                'มี ' + lockedCount + ' ย่อหน้าที่แก้ไม่ได้ในหน้านี้ (ดูคำอธิบายเมื่อชี้เมาส์)',
                'warn'
            );
        }

        updateDirty();
    }

    // ──────────────────────────────────────────────────────────────
    // เก็บการแก้ไข / บันทึก
    // ──────────────────────────────────────────────────────────────

    // การแก้ของย่อหน้าหนึ่ง — คืน null เมื่อย่อหน้านี้ไม่ได้ถูกแก้
    // (นับเฉพาะข้อความของย่อหน้านั้นเอง ไม่รวมของกล่องข้อความที่ซ้อนอยู่)
    function paragraphEdit(pair, node) {
        const text = cleanText(renderedText(node));
        const textChanged = text !== pair.domText;
        const changes = formatChanges(pair, node, text);

        if (!textChanged && changes.length === 0) return null;

        return {
            text: textChanged ? { index: pair.index, text: text } : null,
            format: changes.length > 0 ? { index: pair.index, changes: changes } : null
        };
    }

    // onlyTouched = ตรวจเฉพาะย่อหน้าที่เพิ่งถูกแก้ (ตอนพิมพ์ — เร็ว)
    // ส่วนตอนบันทึกตรวจทั้งหมด (กันพลาด)
    function collectEdits(onlyTouched) {
        const texts = [];
        const formats = [];

        current.pairs.forEach(function (pair, node) {
            if (onlyTouched && !touched.has(node)) return;

            const edit = paragraphEdit(pair, node);

            if (!edit) return;

            if (edit.text) texts.push(edit.text);
            if (edit.format) formats.push(edit.format);
        });

        return { texts: texts, formats: formats };
    }

    function updateDirty() {
        if (!current) return;

        const edits = collectEdits(true);
        const changed = edits.texts.length + edits.formats.length;
        const saveBtn = el('layoutSaveBtn');

        if (saveBtn) {
            saveBtn.disabled = changed === 0;
            saveBtn.title = changed === 0
                ? 'ยังไม่มีการแก้ไข'
                : 'บันทึกทับไฟล์ต้นฉบับของแม่แบบ';
        }

        if (changed > 0) {
            setStatus('แก้ไขแล้ว ' + changed + ' ย่อหน้า (ยังไม่บันทึก)', 'dirty');
        } else if (current.statusKind === 'dirty') {
            setStatus('');
        }
    }

    // ย่อหน้าที่โฟกัส/อักขระอยู่ (สำหรับปุ่มจัดรูปแบบ และการนับว่าแก้ย่อหน้าไหน)
    function paragraphOf(node) {
        const element = node && node.nodeType === 1
            ? node
            : (node ? node.parentNode : null);

        if (!element || !element.closest) return null;

        const paragraph = element.closest('.layout-para');

        return paragraph && paragraph.contentEditable === 'true' ? paragraph : null;
    }

    function touchParagraph(paragraph) {
        if (paragraph) touched.add(paragraph);
    }

    function setBusy(busy) {
        ['layoutSaveBtn', 'layoutDownloadBtn', 'layoutResetBtn'].forEach(function (id) {
            const btn = el(id);
            if (btn) btn.disabled = busy;
        });

        // บันทึกเสร็จ = ปุ่มกลับมาตามจำนวนย่อหน้าที่แก้ค้างอยู่
        if (!busy) {
            updateDirty();
            refreshFormatButtons();
        }
    }

    // รวมการแก้ทั้งหมดลงใน xml (ข้อความก่อน แล้วค่อยรูปแบบ — offset จึงตรงกัน)
    // คืน { xml, skipped } — skipped = ย่อหน้าที่จัดรูปแบบกลับไม่ได้
    function writeEdits(xml, edits) {
        const withTexts = scope.Replace.setParagraphTexts(xml, edits.texts);

        return scope.Replace.setParagraphFormats(withTexts, edits.formats);
    }

    function editSummary(edits) {
        const parts = [];

        if (edits.texts.length > 0) {
            parts.push('ข้อความ ' + edits.texts.length + ' ย่อหน้า');
        }

        if (edits.formats.length > 0) {
            parts.push('รูปแบบ ' + edits.formats.length + ' ย่อหน้า');
        }

        return parts.join(' · ');
    }

    async function save() {
        if (!current || !current.payload.save) return;

        const edits = collectEdits(false);
        const changed = edits.texts.length + edits.formats.length;

        if (changed === 0) {
            setStatus('ยังไม่มีการแก้ไข');
            return;
        }

        const name = current.payload.name || 'แม่แบบนี้';

        if (!(await scope.AppDialog.confirm(
            'บันทึกทับไฟล์ต้นฉบับของ "' + name + '"?\n\n' +
            'บันทึก: ' + editSummary(edits) + '\n' +
            'ค่า type / ล็อกตำแหน่ง / placeholder / ตาราง ของ field ที่ยังมีอยู่จะถูกเก็บไว้\n' +
            'ต้องการบันทึกหรือไม่?',
            { title: 'ยืนยันการบันทึก', okText: 'บันทึก' }
        ))) {
            return;
        }

        setBusy(true);
        setStatus('กำลังบันทึก...');

        try {
            const result = writeEdits(current.xml, edits);
            const bytes = await current.payload.save(result.xml);

            current.xml = result.xml;

            await renderDocx(bytes || current.bytes);

            const skipped = result.skipped.length;

            setStatus(
                'บันทึกแล้ว — ' + editSummary(edits) +
                (skipped > 0
                    ? ' · ข้ามการจัดรูปแบบ ' + skipped +
                        ' ย่อหน้าที่มีกล่องข้อความ/ฟิลด์ (แก้ใน Word แทน)'
                    : ''),
                skipped > 0 ? 'warn' : 'ok'
            );

        } catch (error) {
            console.error(error);
            setStatus('บันทึกไม่สำเร็จ: ' + messageOf(error), 'error');
        } finally {
            setBusy(false);
        }
    }

    async function download() {
        if (!current || !current.payload.download) return;

        const edits = collectEdits(false);

        // ดาวน์โหลด = เอาไฟล์ที่แก้แล้วไปตรวจก่อน (ไม่บันทึกในฐานข้อมูล)
        const result = writeEdits(current.xml, edits);

        try {
            await current.payload.download(result.xml);
            setStatus('ดาวน์โหลดไฟล์ที่แก้แล้วแล้ว', 'ok');
        } catch (error) {
            console.error(error);
            setStatus('ดาวน์โหลดไม่สำเร็จ: ' + messageOf(error), 'error');
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ย่อ/ขยาย — เอกสารที่กว้างกว่าหน้ากระดาษ (หรือหน้ากว้าง/แนวนอน)
    // ย่อให้เห็นทั้งหน้าได้ ไม่ต้องเลื่อนแนวนอน
    // ──────────────────────────────────────────────────────────────

    // อัตราย่อที่ทำความกว้างหน้ากระดาษพอดีกับกรอบแสดงผล
    // ย่อได้อย่างเดียว (ไม่ขยายอัตโนมัติ) เพื่อให้เห็นสัดส่วนจริงของเอกสาร
    function fitZoom(wrapper) {
        const body = el('layoutBody');
        const section = wrapper.querySelector('section.docx');

        if (!body || !section) return 1;

        // วัดตอนยังไม่ซูม (offsetWidth ขึ้นกับค่า zoom ที่ค้างอยู่)
        const previous = wrapper.style.zoom;

        wrapper.style.zoom = '1';

        const pageWidth = section.offsetWidth;
        const wrapperStyle = window.getComputedStyle(wrapper);
        const padding =
            (parseFloat(wrapperStyle.paddingLeft) || 0) +
            (parseFloat(wrapperStyle.paddingRight) || 0);

        wrapper.style.zoom = previous;

        if (!(pageWidth > 0)) return 1;

        return Math.min(body.clientWidth / (pageWidth + padding), 1);
    }

    function applyZoom() {
        const wrapper = host ? host.querySelector('.docx-wrapper') : null;
        const select = el('layoutZoom');

        if (!wrapper) return;

        const value = select ? select.value : 'fit';

        // ใช้ zoom ของ CSS (ไม่ใช่ transform) เพื่อให้แถบเลื่อน/ความสูงคำนวณถูก
        wrapper.style.zoom = String(
            value === 'fit' ? fitZoom(wrapper) : Number(value)
        );

        // ย่อ/ขยายแล้วข้อความอาจตัดบรรทัดใหม่ → ระยะจากย่อหน้าของรูป/กล่องข้อความเปลี่ยน
        // (เรียกทุกครั้งที่ค่า zoom เปลี่ยน รวมครั้งแรกหลังเรนเดอร์)
        fixRenderedLayout();
    }

    // ──────────────────────────────────────────────────────────────
    // วางตำแหน่งรูปที่ลอย กล่องข้อความ และตาราง
    //
    // docx-preview วางรูปที่ลอย (wp:anchor) ด้วย position: relative + left/top
    // ซึ่งเลื่อนจาก "ตำแหน่งที่ย่อหน้าอยู่" ไม่ใช่จากหน้า/ขอบกระดาษตามที่ Word ทำ
    // รูปหัวกระดาษ/ลายน้ำ (anchor จากหน้า) จึงไปโผล่ผิดที่
    // ที่นี่อ่าน wp:anchor จาก word/document.xml แล้ววางใหม่เป็น position: absolute
    // โดยเทียบกับหน้า/ขอบกระดาษ/ย่อหน้า ตาม relativeFrom ของเอกสาร
    //
    // กล่องข้อความแบบ VML (w:pict) ก็เจอปัญหาเดียวกัน (margin วัดจากย่อหน้า)
    // จึงย้ายฐานเมื่อเอกสารระบุ mso-position-*-relative เป็น page/margin
    //
    // ตารางที่ตั้ง w:tblInd ติดลบ (ดึงตารางกว้างให้พ้นขอบ) ก็ถูกไลบรารีมองข้าม
    // จึงใส่ระยะเยื้องกลับให้ (ดู tableIndents)
    // ──────────────────────────────────────────────────────────────

    // นามสเปซที่ mc:Choice รองรับ — บิลด์ docx-preview ที่ใช้อยู่ยังไม่มีเลย
    // จึงเลือกสาขา mc:Fallback (VML) ทุกครั้งที่เอกสารมี AlternateContent
    // (ดู supportedNamespaceURIs ใน docx-preview ถ้าอัปเกรดไลบรารีแล้วลิสต์เปลี่ยน)
    const CHOICE_NAMESPACES = [];

    // สาขาที่ตัวเรนเดอร์เลือกจาก mc:AlternateContent (null = เอกสารมี Choice
    // แต่ไม่มี Fallback ให้ใช้ → ตัวเรนเดอร์ข้ามทั้งบล็อกนั้น)
    function preferredBranch(alternate) {
        const children = Array.from(alternate.childNodes)
            .filter(function (node) { return node.nodeType === 1; });

        const choice = children.find(function (n) { return n.localName === 'Choice'; });
        const fallback = children.find(function (n) { return n.localName === 'Fallback'; });

        if (choice) {
            const requires = choice.getAttribute('Requires');
            const ns = requires ? alternate.lookupNamespaceURI(requires) : null;

            if (ns && CHOICE_NAMESPACES.indexOf(ns) !== -1) return choice.firstElementChild;
        }

        return fallback ? fallback.firstElementChild : null;
    }

    // วัตถุที่ตัวเรนเดอร์วาดจริง (รูป/ตาราง)
    // Word ห่อรูปไว้ใน mc:AlternateContent เสมอ (Choice = DrawingML, Fallback = VML)
    // ถ้าไม่กรองสาขาที่ไม่ถูกเลือกออก จะนับเกินจริงแล้วจับคู่ผิดทั้งชุด
    function isRenderedNode(element) {
        let node = element.parentNode;

        while (node && node.nodeType === 1) {
            if (node.localName === 'AlternateContent') {
                const chosen = preferredBranch(node);

                return chosen !== null && (chosen === element || chosen.contains(element));
            }

            node = node.parentNode;
        }

        return true;
    }

    // wp:anchor ของวัตถุลอยทุกอันตามลำดับในเอกสาร
    //
    // เอกสารเก็บวัตถุลอยไว้ทั้งแบบ DrawingML (mc:Choice) และ VML (mc:Fallback)
    // ตำแหน่งจริงคือ "wp:anchor" เสมอ — ส่วนสไตล์ VML ที่เรนเดอร์จริง (margin/
    // mso-position-*) บางอันไม่ตรงกับ wp:anchor (เช่น left:0 ตรง ๆ)
    // จึงใช้ wp:anchor เป็นแหล่งตำแหน่ง แล้วจับคู่กับที่วาดจริงตามลำดับ
    function shapeAnchors(xml) {
        const doc = parseXml(xml);

        if (!doc) return null;

        return Array.from(doc.getElementsByTagNameNS(WP_NS, 'anchor')).map(readAnchor);
    }

    // อ่านระยะเยื้องของตารางทุกอันที่ถูกวาดจริง (px, null = ไม่ได้ระบุ)
    //
    // docx-preview อ่าน w:tblInd ผิดแบบ — parseIndentation ของมันไปอ่าน
    // attribute ชื่อ left/start แต่ w:tblInd ใช้ w:w + w:type จึงไม่มีผลเลย
    // ตารางของแบบฟอร์มที่ตั้ง tblInd ติดลบ (ดึงตารางกว้างให้พ้นขอบ) จึงไปเริ่ม
    // ที่ขอบข้อความปกติ แล้วล้นออกนอกหน้ากระดาษทางขวา
    function tableIndents(xml) {
        const doc = parseXml(xml);

        if (!doc) return null;

        return Array.from(doc.getElementsByTagNameNS(W_NS, 'tbl'))
            .filter(isRenderedNode)
            .map(function (tbl) {
                const pr = tbl.getElementsByTagNameNS(W_NS, 'tblPr')[0];
                const ind = pr ? pr.getElementsByTagNameNS(W_NS, 'tblInd')[0] : null;

                if (!ind) return null;

                // tblInd ใช้ได้ทั้ง dxa (twips) และ pct — รองรับเฉพาะ dxa ที่พบบ่อย
                const type = String(ind.getAttribute('w:type') || 'dxa').toLowerCase();
                const width = Number(ind.getAttribute('w:w'));

                if (type !== 'dxa' || !isFinite(width)) return null;

                return width / TWIPS_PER_PX;
            });
    }

    function readAnchor(anchor) {
        // simplePos = 1 ใช้พิกัด x/y ตรง ๆ (พบน้อย) — ยังไม่รองรับ
        const simplePos = anchor.getAttribute('simplePos') === '1';

        const extents = anchor.getElementsByTagNameNS(WP_NS, 'extent');
        const width = extents.length > 0
            ? Number(extents[0].getAttribute('cx')) / EMU_PER_PX
            : 0;
        const height = extents.length > 0
            ? Number(extents[0].getAttribute('cy')) / EMU_PER_PX
            : 0;

        return {
            behindDoc: anchor.getAttribute('behindDoc') === '1',
            width: isFinite(width) ? width : 0,
            height: isFinite(height) ? height : 0,
            horizontal: simplePos ? null : readPosition(anchor, 'positionH'),
            vertical: simplePos ? null : readPosition(anchor, 'positionV')
        };
    }

    // ตำแหน่งของแกนหนึ่งจาก positionH / positionV
    function readPosition(anchor, name) {
        const nodes = anchor.getElementsByTagNameNS(WP_NS, name);

        if (nodes.length === 0) return null;

        const node = nodes[0];
        const offsets = node.getElementsByTagNameNS(WP_NS, 'posOffset');
        const aligns = node.getElementsByTagNameNS(WP_NS, 'align');
        const rawOffset = offsets.length > 0 ? Number(offsets[0].textContent) : NaN;

        return {
            relativeFrom: String(node.getAttribute('relativeFrom') || '').toLowerCase(),
            offset: isFinite(rawOffset) ? rawOffset / EMU_PER_PX : null,
            align: aligns.length > 0
                ? String(aligns[0].textContent).trim().toLowerCase()
                : ''
        };
    }

    // ที่ครอบวัตถุลอยที่ถูกวาดจริง เรียงตามลำดับในเอกสาร
    // - กล่องข้อความ/รูปแบบ VML (mc:Fallback) = <svg>
    // - รูปแบบ DrawingML = <div> ที่ renderDrawing ติด text-indent: 0px
    function shapeContainers() {
        return Array.from(host.querySelectorAll('article svg, article div'))
            .filter(function (node) {
                if (node.localName === 'svg') return true;

                return String(node.getAttribute('style') || '')
                    .indexOf('text-indent: 0px') !== -1;
            });
    }

    // ขนาด/ขอบของหน้า (px) ใช้เป็นฐานของ relativeFrom
    //
    // ต้องใช้ "หน้าที่วัตถุนั้นอยู่" ไม่ใช่หน้าแรก — ตอนเปิด breakPages
    // docx-preview แยกหน้ากระดาษออกเป็น <section class="docx"> หน้าละอัน
    // และ section.docx เป็น position: relative → มันคือกล่องอ้างอิงของรูปที่ลอย
    //
    // ค่า getBoundingClientRect เป็น px บนจอ (ถูกคูณด้วย zoom ของ wrapper) แต่ค่า
    // left/top ที่เขียนกลับเป็น px ในพื้นที่ย่อ/ขยาย จึงต้องหารด้วย zoom ก่อน
    // ส่วน clientWidth / computed style ไม่ถูก zoom คูณอยู่แล้ว
    function pageGeometry(reference) {
        const section = (reference && reference.closest
            ? reference.closest('section.docx')
            : null) || host.querySelector('section.docx');
        const wrapper = host.querySelector('.docx-wrapper');

        if (!section) return null;

        const style = window.getComputedStyle(section);
        const padLeft = parseFloat(style.paddingLeft) || 0;
        const padTop = parseFloat(style.paddingTop) || 0;
        const padRight = parseFloat(style.paddingRight) || 0;
        const padBottom = parseFloat(style.paddingBottom) || 0;
        const scale = wrapper ? Number(wrapper.style.zoom) || 1 : 1;

        return {
            rect: section.getBoundingClientRect(),
            scale: scale,
            padLeft: padLeft,
            padTop: padTop,
            pageWidth: section.clientWidth,
            pageHeight: section.clientHeight,
            marginWidth: Math.max(section.clientWidth - padLeft - padRight, 0),
            marginHeight: Math.max(section.clientHeight - padTop - padBottom, 0)
        };
    }

    // ตำแหน่ง (px จากมุมซ้ายบนของหน้า) ของแกนหนึ่ง — null = เอกสารไม่ได้ระบุ
    function axisPixel(side, options) {
        if (!side) return null;

        const page = options.page;
        const horizontal = options.horizontal;
        const pageRect = page.rect;

        // ค่าเริ่มต้นตามสเปก OOXML: แนวนอนอ้างจากคอลัมน์ แนวตั้งอ้างจากย่อหน้า
        const relative = side.relativeFrom || (horizontal ? 'column' : 'paragraph');

        let origin = 0;
        let area = horizontal ? page.pageWidth : page.pageHeight;

        if (
            relative === 'margin' ||
            relative === 'column' ||
            relative === 'insideMargin' ||
            relative === 'outsideMargin'
        ) {
            origin = horizontal ? page.padLeft : page.padTop;
            area = horizontal ? page.marginWidth : page.marginHeight;
        } else if (
            relative === 'paragraph' ||
            relative === 'line' ||
            relative === 'character'
        ) {
            // ย่อหน้าที่รูปวางอยู่ (line/character ใช้กล่องย่อหน้าแทน)
            const block = options.wrapper.closest('p') || options.wrapper;
            const blockRect = block.getBoundingClientRect();

            // ย่อหน้าอยู่ในพื้นที่ที่ถูก zoom → หารกลับเป็น px ในพื้นที่นั้น
            origin = (horizontal
                ? blockRect.left - pageRect.left
                : blockRect.top - pageRect.top) / (page.scale || 1);

            area = horizontal ? block.clientWidth : block.clientHeight;
        }

        if (side.offset !== null) return origin + side.offset;

        if (side.align) {
            if (side.align === 'center') return origin + (area - options.boxSize) / 2;

            if (
                side.align === 'right' ||
                side.align === 'bottom' ||
                side.align === 'outside'
            ) {
                return origin + area - options.boxSize;
            }

            // left / top / inside / inline
            return origin;
        }

        return null;
    }

    // วางวัตถุลอย (รูประหว่างบรรทัด/ลอย กล่องข้อความ) ตาม wp:anchor ของเอกสาร
    function positionAnchors(anchors, wrappers) {
        // วัดตำแหน่งเดิมและวางแผนก่อน แล้วค่อยย้ายทีเดียว
        // (ย้ายรูปแรกทันทีจะทำให้ย่อหน้าถัดไปขยับ แล้ววัดรูปถัดไปผิด)
        const plan = [];

        anchors.forEach(function (anchor, index) {
            if (!anchor) return;

            const wrapper = wrappers[index];
            if (!wrapper) return;

            const page = pageGeometry(wrapper);
            if (!page) return;

            // กล่องที่ครอบรูปเป็น 0x0 จึงใช้ขนาดจาก wp:extent ของเอกสาร
            const rect = wrapper.getBoundingClientRect();
            const scale = page.scale || 1;
            const currentLeft = (rect.left - page.rect.left) / scale;
            const currentTop = (rect.top - page.rect.top) / scale;

            const left = axisPixel(anchor.horizontal, {
                horizontal: true,
                page: page,
                wrapper: wrapper,
                boxSize: anchor.width > 0 ? anchor.width : rect.width / scale
            });

            const top = axisPixel(anchor.vertical, {
                horizontal: false,
                page: page,
                wrapper: wrapper,
                boxSize: anchor.height > 0 ? anchor.height : rect.height / scale
            });

            // ไม่ได้ระบุตำแหน่งทั้งสองแกน = ปล่อยตามที่เรนเดอร์
            if (left === null && top === null) return;

            // ชดเชยแนวตั้งเฉพาะวัตถุที่อ้างจากย่อหน้า/บรรทัด (ดู PARAGRAPH_TOP_CORRECTION_PX)
            // วัตถุที่อ้างจากหน้า/ขอบกระดาษคำนวณจากกล่องหน้าตรง ๆ อยู่แล้ว
            const correction = top !== null && isParagraphRelative(anchor.vertical)
                ? PARAGRAPH_TOP_CORRECTION_PX
                : 0;

            plan.push({
                wrapper: wrapper,
                left: left === null ? currentLeft : left,
                top: (top === null ? currentTop : top) - correction,
                behind: anchor.behindDoc
            });
        });

        plan.forEach(function (item) {
            item.wrapper.style.position = 'absolute';
            item.wrapper.style.left = item.left.toFixed(2) + 'px';
            item.wrapper.style.top = item.top.toFixed(2) + 'px';

            // left/top คิดจาก wp:anchor แล้ว — margin ของ docx-preview/VML
            // ต้องล้างทิ้ง ไม่ให้บวกซ้ำเป็นระยะเพิ่ม
            item.wrapper.style.marginLeft = '0px';
            item.wrapper.style.marginTop = '0px';

            // รูปที่ตั้งให้อยู่หลังข้อความ (behindDoc) ต้องอยู่หลังเนื้อเรื่องจริง
            item.wrapper.style.zIndex = item.behind ? '-1' : 'auto';
        });
    }

    // ระยะขอบเดิมของกล่อง VML ก่อนถูกย้ายฐาน
    // เก็บไว้ที่ data-* เพราะฟังก์ชันนี้ถูกเรียกซ้ำ (หลังเรนเดอร์, หลังฟอนต์โหลดเสร็จ,
    // ตอนย่อ/ขยาย) ถ้าอ่าน margin ที่ตัวเองเขียนไว้จะบวกซ้ำทุกครั้ง
    function vmlMargin(svg, axis) {
        const key = axis === 'left' ? 'vmlMarginLeft' : 'vmlMarginTop';

        if (svg.dataset[key] === undefined) {
            svg.dataset[key] = String(
                parseFloat(window.getComputedStyle(svg)['margin' + (axis === 'left' ? 'Left' : 'Top')]) || 0
            );
        }

        return Number(svg.dataset[key]) || 0;
    }

    // ค่า mso-position-<axis>-relative: จากสไตล์ VML
    function vmlRelative(styleText, axis) {
        const match = new RegExp(
            'mso-position-' + axis + '-relative\\s*:\\s*([a-z]+)',
            'i'
        ).exec(styleText);

        return match ? match[1].toLowerCase() : '';
    }

    // ค่า left/top ที่ VML ประกาศไว้เอง (เช่น "left:0")
    // เก็บค่าเดิมไว้ที่ data-* เพราะฟังก์ชันนี้ถูกเรียกซ้ำ (หลังเรนเดอร์/หลังฟอนต์/
    // ตอนย่อ-ขยาย) ถ้าอ่านค่าที่ตัวเองเขียนไว้จะเพี้ยน
    function vmlDeclared(svg, axis) {
        const key = axis === 'left' ? 'vmlDeclaredLeft' : 'vmlDeclaredTop';

        if (svg.dataset[key] === undefined) {
            svg.dataset[key] = svg.style[axis] || '';
        }

        return svg.dataset[key];
    }

    // แกนที่อ้างจากย่อหน้า/บรรทัด/ตัวอักษร (ค่าเริ่มต้นของแกนแนวตั้งตามสเปก)
    function isParagraphRelative(side) {
        if (!side) return false;

        const relative = side.relativeFrom || 'paragraph';

        return relative === 'paragraph'
            || relative === 'line'
            || relative === 'character';
    }

    // อ้างอิงจากย่อหน้า/บรรทัด ("ข้อความ") ไม่ใช่จากหน้า/ขอบกระดาษ
    function isTextRelative(value) {
        return (
            value === 'text' ||
            value === 'paragraph' ||
            value === 'char' ||
            value === 'character' ||
            value === 'line'
        );
    }

    // กล่องข้อความแบบ VML (w:pict) — docx-preview คัดสไตล์ VML มาใช้ตรง ๆ
    // (position: absolute + margin) ซึ่งวัดจากตำแหน่งของย่อหน้า
    // ถ้าเอกสารบอกว่าอ้างจากหน้า/ขอบกระดาษ จึงต้องย้ายฐานให้ตรง
    function positionVmlTextBoxes() {
        const boxes = Array.from(host.querySelectorAll('article svg'))
            .filter(function (svg) {
                return svg.querySelector('foreignObject') !== null;
            });

        boxes.forEach(function (svg) {
            const page = pageGeometry(svg);
            if (!page) return;

            const styleText = String(svg.getAttribute('style') || '');
            const horizontal = vmlRelative(styleText, 'horizontal');
            const vertical = vmlRelative(styleText, 'vertical');

            const marginLeft = vmlMargin(svg, 'left');
            const marginTop = vmlMargin(svg, 'top');

            let left = null;
            let top = null;

            if (horizontal === 'page') left = 0;
            else if (horizontal === 'margin' || horizontal === 'column') left = page.padLeft;

            if (vertical === 'page') top = 0;
            else if (vertical === 'margin') top = page.padTop;

            if (left !== null) {
                svg.style.left = '0px';
                svg.style.marginLeft = (left + marginLeft) + 'px';
            }

            if (top !== null) {
                svg.style.top = '0px';
                svg.style.marginTop = (top + marginTop) + 'px';
            }

            // เอกสารบางอันตั้ง left/top เป็น 0 ตรง ๆ (เช่น "left:0")
            // เบราว์เซอร์จะวางจากขอบซ้ายบนของหน้า (position:absolute) แทนที่จะ
            // อ้างจากคอลัมน์ข้อความ กล่องที่มี margin ติดลบจึงหลุดออกนอกกระดาษ
            //
            // อ้างอิงที่ถูกคือ "คอลัมน์" (ขอบซ้ายของเนื้อเรื่อง = padLeft/padTop)
            // โดย wp:anchor ของกล่องเดียวกันระบุ relativeFrom="column" + posOffset
            // เท่ากับ margin ใน VML พอดี
            reanchorDeclaredBox(svg, page, horizontal, 'left');
            reanchorDeclaredBox(svg, page, vertical, 'top');
        });
    }

    // ย้ายฐานของกล่องที่อ้างจากข้อความ/คอลัมน์ เมื่อ VML ประกาศ left/top ไว้ตรง ๆ
    // (ตั้ง left/top ใหม่ = ขอบเนื้อเรื่องของหน้า + ค่าที่เอกสารระบุ)
    function reanchorDeclaredBox(svg, page, relative, axis) {
        if (!isTextRelative(relative)) return;

        const declared = vmlDeclared(svg, axis);
        if (declared === '') return;

        const value = parseFloat(declared);
        if (!isFinite(value)) return;

        const origin = axis === 'left' ? page.padLeft : page.padTop;

        svg.style[axis] = (origin + value).toFixed(2) + 'px';
    }

    // ตาราง — ใส่ระยะเยื้องตาม w:tblInd ของเอกสาร (ดู tableIndents)
    // ค่าเป็น px ในพื้นที่ของ wrapper จึงไม่ต้องคูณ/หาร zoom
    function positionTables() {
        const indents = tableIndents(current.xml);

        if (!indents || indents.length === 0) return;

        const tables = Array.from(host.querySelectorAll('article table'));

        // จำนวนไม่ตรง = จับคู่ตารางมั่นใจไม่ได้ จึงไม่แตะเลย (ปลอดภัยกว่าแก้ผิดตาราง)
        if (indents.length !== tables.length) {
            console.warn(
                'จัดตำแหน่งตาราง: จำนวนตารางในไฟล์ (' + indents.length +
                ') ไม่ตรงกับที่แสดง (' + tables.length + ') จึงไม่ปรับระยะเยื้อง'
            );

            return;
        }

        indents.forEach(function (indent, index) {
            if (indent === null) return;

            tables[index].style.marginLeft = indent.toFixed(2) + 'px';
        });
    }

    // แก้ตำแหน่งวัตถุที่ docx-preview วางไม่ตรงกับ Word
    function fixRenderedLayout() {
        if (!current || !current.xml || !host) return;

        const anchors = shapeAnchors(current.xml);
        const containers = shapeContainers();

        // จำนวนตรงกัน = จับคู่ทีละอันตามลำดับในเอกสารได้ จึงวางตาม wp:anchor
        // (รวมกล่องข้อความ VML ที่ VML style เองอาจไม่ตรงกับ wp:anchor)
        if (anchors && anchors.length > 0 && anchors.length === containers.length) {
            positionAnchors(anchors, containers);
        } else {
            // จับคู่ไม่ครบ = ไม่กล้าแก้วัตถุผิดอัน ใช้วิธีย้ายฐานกล่อง VML แบบเดิม
            if (anchors && anchors.length > 0) {
                console.warn(
                    'จัดตำแหน่งวัตถุลอย: จำนวนในไฟล์ (' + anchors.length +
                    ') ไม่ตรงกับที่แสดง (' + containers.length +
                    ') จึงใช้การย้ายฐานเฉพาะกล่องข้อความ'
                );
            }

            positionVmlTextBoxes();
        }

        positionTables();
    }

    // ──────────────────────────────────────────────────────────────
    // แถบเครื่องมือ / การพิมพ์ในเอกสาร
    // ──────────────────────────────────────────────────────────────

    function applyEditToggle() {
        const editable = editOn();

        host.querySelectorAll('.layout-para').forEach(function (node) {
            if (node.classList.contains('layout-para-locked')) return;

            node.contentEditable = editable ? 'true' : 'false';
        });

        refreshFormatButtons();
    }

    // ──────────────────────────────────────────────────────────────
    // ไฮไลต์ {{...}} เป็นสีเหลือง
    //
    // ใช้ CSS Custom Highlight API (::highlight(layout-field) ใน style.css)
    // → ไม่ต้องห่อ span ในเอกสารเลย ตำแหน่งข้อความ/caret จึงไม่ขยับ
    // ถ้าเบราว์เซอร์ไม่รองรับ จะเหลือแค่เงาที่ขอบซ้ายของย่อหน้าที่มี field
    // ──────────────────────────────────────────────────────────────

    function fieldRanges() {
        const ranges = [];

        if (!host) return ranges;

        bodyParagraphs().forEach(function (paragraph) {
            const walker = document.createTreeWalker(
                paragraph,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            let node;

            while ((node = walker.nextNode()) !== null) {
                const text = node.textContent || '';
                const regex = new RegExp(FIELD_PATTERN.source, 'g');
                let match;

                while ((match = regex.exec(text)) !== null) {
                    const range = document.createRange();

                    range.setStart(node, match.index);
                    range.setEnd(node, match.index + match[0].length);
                    ranges.push(range);
                }
            }
        });

        return ranges;
    }

    function highlightSupported() {
        return !!(scope.CSS && scope.CSS.highlights && scope.Highlight);
    }

    function clearFieldHighlight() {
        if (highlightSupported()) scope.CSS.highlights.delete(FIELD_HIGHLIGHT);
    }

    function applyFieldHighlight() {
        const toggle = el('layoutFieldToggle');
        const on = !!(toggle && toggle.checked);

        if (!host) return;

        // เงาที่ขอบซ้ายของย่อหน้าที่มี field — ใช้หาตำแหน่งได้ง่ายทั้งสองโหมด
        host.classList.toggle('show-fields', on);

        if (!highlightSupported()) {
            host.classList.toggle('show-fields-plain', on);
            return;
        }

        scope.CSS.highlights.delete(FIELD_HIGHLIGHT);

        if (!on) return;

        const highlight = new scope.Highlight();

        fieldRanges().forEach(function (range) {
            highlight.addRange(range);
        });

        scope.CSS.highlights.set(FIELD_HIGHLIGHT, highlight);
    }

    // ระหว่างพิมพ์ข้อความ ตัว {{}} ถูกพิมพ์/ลบทีละตัว — ไฮไลต์ต้องตามให้ทัน
    // (หน่วงเล็กน้อย เพื่อไม่ให้คำนวณใหม่ทุกคีย์)
    function scheduleFieldHighlight() {
        window.clearTimeout(highlightTimer);

        highlightTimer = window.setTimeout(applyFieldHighlight, 120);
    }

    // ──────────────────────────────────────────────────────────────
    // ปุ่มจัดรูปแบบข้อความ (ตัวหนา / ตัวบาง / ตัวเอียง / ขีดเส้นใต้)
    // ──────────────────────────────────────────────────────────────

    // ข้อความที่เลือกอยู่ต้องอยู่ในย่อหน้าที่แก้ได้จึงจัดรูปแบบได้
    // (paragraphOf คืน null เมื่อย่อหน้าถูกล็อกหรือแก้ข้อความถูกปิด)
    function activeParagraph() {
        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) return null;

        return paragraphOf(selection.anchorNode);
    }

    function formatState(command) {
        try {
            return document.queryCommandState(command) === true;
        } catch (error) {
            return false;
        }
    }

    // ปุ่มสว่างตามสถานะของข้อความที่เลือก (ตัวบาง = ยังไม่หนา)
    function refreshFormatButtons() {
        const enabled = activeParagraph() !== null;
        const bold = enabled && formatState('bold');

        const states = {
            layoutBoldBtn: bold,
            layoutThinBtn: enabled && !bold,
            layoutItalicBtn: enabled && formatState('italic'),
            layoutUnderlineBtn: enabled && formatState('underline')
        };

        Object.keys(states).forEach(function (id) {
            const button = el(id);

            if (!button) return;

            button.disabled = !enabled;
            button.classList.toggle('active', states[id]);
        });
    }

    // คำสั่งจัดรูปแบบของ contentEditable — ผลลัพธ์เป็น <b>/<i>/<u>
    // ตอนบันทึกจะอ่านรูปแบบที่เห็นบนหน้าจอกลับเป็น w:b / w:i / w:u
    function applyFormat(command) {
        const paragraph = activeParagraph();

        if (!paragraph) {
            setStatus('เลือกข้อความในเอกสารก่อนจึงจัดรูปแบบได้', 'warn');
            refreshFormatButtons();
            return;
        }

        if (command === 'thin') {
            // ตัวบาง = เอาตัวหนาออก (ถ้าข้อความที่เลือกหนาอยู่)
            if (!formatState('bold')) {
                setStatus('ข้อความที่เลือกเป็นตัวบางอยู่แล้ว', 'warn');
                refreshFormatButtons();
                return;
            }

            document.execCommand('bold', false, null);
        } else {
            document.execCommand(command, false, null);
        }

        touchParagraph(paragraph);
        scheduleFieldHighlight();
        scheduleLayoutFix();
        refreshFormatButtons();
        updateDirty();
    }

    // คีย์ลัด Ctrl+B / Ctrl+I / Ctrl+U เหมือน Word
    function onFormatKeydown(event) {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;

        const key = String(event.key || '').toLowerCase();
        const command = key === 'b' ? 'bold'
            : key === 'i' ? 'italic'
                : key === 'u' ? 'underline'
                    : null;

        if (!command) return;

        const paragraph = activeParagraph();

        if (!paragraph) return;

        event.preventDefault();
        document.execCommand(command, false, null);

        touchParagraph(paragraph);
        scheduleFieldHighlight();
        scheduleLayoutFix();
        refreshFormatButtons();
        updateDirty();
    }

    // กด Enter เพิ่มย่อหน้าใหม่ไม่ได้ — w:p ใหม่ต้องสร้างใน Word
    function onKeydown(event) {
        if (event.key !== 'Enter') return;

        const paragraph = event.target && event.target.closest
            ? event.target.closest('.layout-para')
            : null;

        if (!paragraph || paragraph.contentEditable !== 'true') return;

        event.preventDefault();

        setStatus(
            'กด Enter เพิ่มย่อหน้าใหม่ไม่ได้ — เพิ่มย่อหน้าในไฟล์ Word ' +
            'แล้วใช้ "อัปโหลดไฟล์ใหม่ทับไฟล์เดิม"',
            'warn'
        );
    }

    // พิมพ์แล้วย่อหน้าเปลี่ยนความสูง = รูป/กล่องข้อความที่อ้างจากย่อหน้านั้น
    // ต้องถูกจัดตำแหน่งใหม่ให้ตามไปด้วย ไม่ให้ค้างอยู่ที่เดิมแล้วทับข้อความ
    function scheduleLayoutFix() {
        window.clearTimeout(layoutTimer);

        layoutTimer = window.setTimeout(function () {
            if (current && current.xml) fixRenderedLayout();
        }, 200);
    }

    // พิมพ์ในเอกสาร — นับว่าย่อหน้าไหนถูกแก้ + อัปเดตไฮไลต์ {{}} + จัดตำแหน่งใหม่
    function onInput(event) {
        touchParagraph(paragraphOf(event.target));
        scheduleFieldHighlight();
        scheduleLayoutFix();
        updateDirty();
    }

    // วางเป็นข้อความล้วน — วางจาก Word จะพา span/สไตล์ขยะเข้ามาในเอกสาร
    function onPaste(event) {
        const paragraph = event.target && event.target.closest
            ? event.target.closest('.layout-para')
            : null;

        if (!paragraph || paragraph.contentEditable !== 'true') return;

        event.preventDefault();

        const text = (event.clipboardData || window.clipboardData).getData('text/plain') || '';

        if (!text) return;

        document.execCommand('insertText', false, text.replace(/\s*\r?\n\s*/g, ' '));
    }

    function buildOverlay() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'layout-overlay';
        overlay.id = 'templateLayoutDialog';
        overlay.innerHTML = HTML;

        document.body.appendChild(overlay);

        host = el('layoutPreview');
        styleHost = el('layoutStyle');
        statusEl = el('layoutStatus');

        overlay.querySelectorAll('[data-layout-close]').forEach(function (node) {
            node.addEventListener('click', close);
        });

        const editToggle = el('layoutEditToggle');
        if (editToggle) editToggle.addEventListener('change', applyEditToggle);

        const fieldToggle = el('layoutFieldToggle');
        if (fieldToggle) fieldToggle.addEventListener('change', applyFieldHighlight);

        // ปุ่มจัดรูปแบบข้อความ — mousedown preventDefault สำคัญมาก
        // ถ้าไม่กันไว้ การคลิกปุ่มจะย้ายโฟกัสออกจากข้อความที่เลือก
        // แล้วคำสั่งจัดรูปแบบจะไม่มีข้อความให้ทำ
        Object.keys(FORMAT_BUTTONS).forEach(function (id) {
            const button = el(id);

            if (!button) return;

            button.addEventListener('mousedown', function (event) {
                event.preventDefault();
            });

            button.addEventListener('click', function () {
                applyFormat(FORMAT_BUTTONS[id]);
            });
        });

        const zoomSelect = el('layoutZoom');
        if (zoomSelect) zoomSelect.addEventListener('change', applyZoom);

        // หน้าต่างเปลี่ยนขนาด = "พอดีความกว้าง" ต้องคำนวณใหม่
        window.addEventListener('resize', function () {
            const select = el('layoutZoom');

            if (current && select && select.value === 'fit') applyZoom();
        });

        const saveBtn = el('layoutSaveBtn');
        if (saveBtn) saveBtn.addEventListener('click', save);

        const downloadBtn = el('layoutDownloadBtn');
        if (downloadBtn) downloadBtn.addEventListener('click', download);

        const resetBtn = el('layoutResetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                setStatus('');
                renderDocx(current ? current.bytes : null);
            });
        }

        host.addEventListener('input', onInput);
        host.addEventListener('keydown', onKeydown);
        host.addEventListener('keydown', onFormatKeydown);
        host.addEventListener('paste', onPaste);

        // เลือกข้อความใหม่ = อัปเดตสถานะปุ่มจัดรูปแบบ
        document.addEventListener('selectionchange', function () {
            if (!overlay.classList.contains('open')) return;

            refreshFormatButtons();
        });

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            if (!overlay.classList.contains('open')) return;

            // กำลังพิมพ์แก้ข้อความอยู่ = ไม่ปิด (กด × หรือคลิกนอกกล่องแทน)
            const active = document.activeElement;

            if (active && active.isContentEditable && host.contains(active)) return;

            close();
        });
    }

    scope.TemplateLayoutDialog = {
        open: open,
        close: close,
        isOpen: function () {
            return !!(overlay && overlay.classList.contains('open'));
        }
    };
})(window);
