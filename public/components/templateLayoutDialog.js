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
// การจัดรูปแบบข้อความ (ตัวหนา / ตัวเอียง / ขีดเส้นใต้):
// - ทำกับข้อความที่เลือกในย่อหน้าที่แก้ได้ (Ctrl+B / Ctrl+I / Ctrl+U หรือปุ่มบนแถบ)
// - ตอนบันทึกจะเทียบรูปแบบที่เห็นบนหน้าจอกับตอนเรนเดอร์ แล้วเขียน w:b / w:i / w:u
//   กลับลงเฉพาะช่วงที่เปลี่ยน ผ่าน Replace.setParagraphFormats
//   การตัด run ใหม่คง rPr เดิมไว้ (ฟอนต์/ขนาด/สี/ระยะ ไม่เพี้ยน)
//
// สัญลักษณ์ (w:sym) และแท็บ (w:tab) ของเอกสาร:
// - ตัวเรนเดอร์วาดเป็นอักขระ Private Use Area / \u2003 ซึ่งไม่มีอักขระจริงในเอกสาร
//   จึงล็อกชิ้นเหล่านี้ไม่ให้แก้หรือลบ และตัดอักขระเหล่านั้นออกตอนเขียนข้อความกลับ
//   (ถ้าเขียนกลับเป็นตัวอักษรจริง เครื่องหมายถูก/กล่องสี่เหลี่ยมจะเพี้ยนและซ้อนกัน)
// - ความกว้างของแท็บไม่ใช่ค่าตายตัว แต่คำนวณจาก tab stop ของแม่แบบ
//   (ดูหัวข้อ "ความกว้างแท็บ" ใต้ decorateSpecials)
//
// รูปทรง (shape):
// - Word เก็บรูปทรงไว้สองชุดใน mc:AlternateContent (Choice = wps:wsp ที่ Word ใช้,
//   Fallback = VML ที่ docx-preview วาด) — docx-preview ไม่รู้จัก wps:wsp จึงข้าม
//   สไตล์จริง (สีพื้น/เส้นขอบ/ความหนาเส้น) จึงต้องอ่านจากสาขา Choice มาใส่ให้
//   (ดู renderShapes) ถ้าจำนวนรูปทรงในไฟล์กับบนจอกันไม่ตรง จะไม่แก้เลยและเตือน
// - รองรับรูปทรงกล่อง (rect / roundRect / ellipse) และเส้นตรง (line)
// - ซอง SVG ที่ตัวเรนเดอร์วัดขนาดไม่สำเร็จ (width/height = 0 — เจอกับ v:line ที่สไตล์
//   VML ไม่บอก width/height) ต้องตั้งขนาดจาก bbox ของเนื้อหา ไม่งั้นรูปทรงหายทั้งอัน
//   (ดู sizeShapeFromContent)
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

    // นามสเปซที่ใช้ตอนอ่านรูปทรง (shape) จาก word/document.xml
    const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const WPS_NS = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
    const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

    // สีมาตรฐานของธีม Office — ใช้เมื่อรูปทรงอ้าง schemeClr / sysClr แทนรหัสสีตรง ๆ
    const THEME_COLORS = {
        dk1: '#000000',
        tx1: '#000000',
        lt1: '#FFFFFF',
        bg1: '#FFFFFF',
        dk2: '#44546A',
        tx2: '#44546A',
        lt2: '#E7E6E6',
        bg2: '#E7E6E6',
        accent1: '#4472C4',
        accent2: '#ED7D31',
        accent3: '#A5A5A5',
        accent4: '#FFC000',
        accent5: '#5B9BD5',
        accent6: '#70AD47',
        hlink: '#0563C1',
        folHlink: '#954F72'
    };

    // ชนิดรูปทรงที่วาดเป็น "กล่อง" ได้ด้วยขอบ/พื้นของซอง SVG (ค่าคือ border-radius)
    const BOX_GEOMETRY = {
        rect: '',
        roundRect: '8px',
        ellipse: '50%',
        oval: '50%'
    };

    // อักขระที่ docx-preview วาดขึ้นเอง — ไม่มีอยู่ใน w:t ของเอกสาร
    // (สัญลักษณ์ w:sym → อักขระ Private Use Area, แท็บ w:tab → em space)
    // ตอนเขียนข้อความกลับต้องตัดออก ไม่งั้นจะกลายเป็น "ตัวอักษรจริง" ใน Word
    // แล้วสัญลักษณ์/แท็บเดิมที่ยังอยู่ในเอกสารจะซ้อนขึ้นมาอีกชิ้น
    const RENDERED_ONLY = /[\uE000-\uF8FF\u2003]/g;

    // ปุ่มบนแถบเครื่องมือ → คำสั่งจัดรูปแบบของ contentEditable
    const FORMAT_BUTTONS = {
        layoutBoldBtn: 'bold',
        layoutItalicBtn: 'italic',
        layoutUnderlineBtn: 'underline'
    };

    // ชื่อ highlight ของ CSS Custom Highlight API (ไฮไลต์ {{...}} เป็นสีเหลือง)
    const FIELD_HIGHLIGHT = 'layout-field';

    // ไฮไลต์ผลค้นหา (layout-find = ทุกตำแหน่ง, layout-find-current = ตำแหน่งที่อยู่)
    const FIND_HIGHLIGHT = 'layout-find';
    const FIND_CURRENT_HIGHLIGHT = 'layout-find-current';

    // ไฮไลต์ "ทุกที่ที่ใช้ field นี้" (คลิกขวา → ไฮไลต์ทุกที่) — คนละสีกับ FIELD_HIGHLIGHT
    const FIELD_FOCUS_HIGHLIGHT = 'layout-field-focus';

    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

    // 1 EMU = 1/914400 นิ้ว, 1 px = 1/96 นิ้ว → 914400 / 96 = 9525 EMU ต่อ px
    const EMU_PER_PX = 9525;

    // 1 twip = 1/1440 นิ้ว, 1 px = 1/96 นิ้ว → 1440 / 96 = 15 twips ต่อ px
    const TWIPS_PER_PX = 15;

    // ค่าเริ่มต้นของ default tab stop เมื่อไฟล์ไม่ได้ระบุ (0.5 นิ้ว = 720 twip)
    const DEFAULT_TAB_STOP_TWIPS = 720;

    // ระยะชดเชยแนวตั้ง (px) ของวัตถุที่อ้างจาก "ย่อหน้า/บรรทัด"
    //
    // Word วัดระยะแนวตั้งจากบรรทัดแรกของย่อหน้า ส่วน CSS วัดจากขอบบนของกล่องย่อหน้า
    // (ต่างกันที่ half-leading ของ line-height) ค่านี้ตั้งเทียบกับเอกสารราชการจริง
    // (ดู commit 85fe65f "add top position -10") — อย่าแก้โดยไม่เทียบกับไฟล์จริง
    //
    // วัตถุที่อ้างจากหน้า/ขอบกระดาษ ไม่ใช้ค่านี้ เพราะคำนวณจากกล่องหน้าตรง ๆ อยู่แล้ว
    const PARAGRAPH_TOP_CORRECTION_PX = 10;

    // ระยะแนวตั้ง (จำนวนบรรทัด) ที่ยังนับว่าข้อความในเอกสารเป็น "คอลัมน์เดียวกัน"
    // กับกล่องข้อความ — ใช้ใน snapTextboxToColumn
    // ข้อความที่ไกลออกไปทั้งหน้าเริ่มตรงกันได้โดยบังเอิญ ไม่ใช่คอลัมน์ของกล่อง
    const COLUMN_SNAP_ROWS = 8;

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
        '        <button type="button" class="page-modal-close" data-layout-close aria-label="ปิด">&times;</button>',
        '    </div>',
        '    <div class="layout-toolbar">',
        '        <label class="layout-toggle"><input type="checkbox" id="layoutEditToggle" checked> แก้ไขข้อความ</label>',
        '        <div class="layout-format" role="toolbar" aria-label="จัดรูปแบบข้อความ">',
        '            <button type="button" id="layoutBoldBtn" class="layout-fmt" title="ตัวหนา (Ctrl+B) — กดอีกครั้งเพื่อเลิกหนา"><strong>B</strong></button>',
        '            <button type="button" id="layoutItalicBtn" class="layout-fmt" title="ตัวเอียง (Ctrl+I)"><em>I</em></button>',
        '            <button type="button" id="layoutUnderlineBtn" class="layout-fmt" title="ขีดเส้นใต้ (Ctrl+U)"><u>U</u></button>',
        '        </div>',
        '        <label class="layout-toggle"><input type="checkbox" id="layoutFieldToggle" checked> ไฮไลต์ตัวแปรเป็นสีเหลือง</label>',
        // แสดงเครื่องหมายจัดรูปแบบเหมือน Word (¶ · ° → ↵ ¬ ¤ รวมข้อความซ่อน/จุดแบ่งหน้า)
        // เป็นการแสดงผลอย่างเดียว — เครื่องหมายที่เพิ่มไม่มีผลต่อข้อความที่บันทึกกลับ
        '        <label class="layout-toggle" title="แสดง/ซ่อนเครื่องหมายจัดรูปแบบของ Word: ¶ ย่อหน้า · ช่องว่าง ° NBSP → แท็บ ↵ ขึ้นบรรทัดใหม่ ¬ ยัติภังค์ทางเลือก ¤ ท้ายเซลล์/แถว รวมข้อความซ่อนและจุดแบ่งหน้า"><input type="checkbox" id="layoutMarksToggle"> แสดงสัญลักษณ์จัดรูปแบบ</label>',
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
        '        <span class="layout-hint">คลิกข้อความในเอกสารแล้วพิมพ์แก้ได้เลย · กด Ctrl+F ค้นหาและแทนที่ · Ctrl+Space เพื่อแทรก {{field}} ที่เคอร์เซอร์ · เลือกข้อความแล้วจัดรูปแบบจากปุ่มด้านบน · หัว/ท้ายกระดาษกับสัญลักษณ์ของเอกสารแก้ไม่ได้</span>',
        '        <span id="layoutStatus" class="layout-status"></span>',
        '        <div class="layout-find-bar" id="layoutFindBar">',
        '            <input type="text" id="layoutFindQuery" placeholder="ค้นหา..." autocomplete="off" spellcheck="false">',
        '            <input type="text" id="layoutReplaceQuery" placeholder="แทนที่ด้วย..." autocomplete="off" spellcheck="false">',
        '            <button type="button" id="layoutFindPrev" class="plain" title="ก่อนหน้า (Shift+Enter)">‹</button>',
        '            <button type="button" id="layoutFindNext" class="plain" title="ถัดไป (Enter)">›</button>',
        '            <button type="button" id="layoutReplaceBtn" class="plain" title="แทนที่ตำแหน่งที่ค้นอยู่">แทนที่</button>',
        '            <button type="button" id="layoutReplaceAllBtn" class="plain" title="แทนที่ทุกตำแหน่ง">แทนที่ทั้งหมด</button>',
        '            <button type="button" id="layoutFindClose" class="plain" title="ปิดการค้นหา (คงผลค้นหาไว้)" aria-label="ปิดการค้นหา">×</button>',
        '            <span id="layoutFindCount" class="layout-find-count"></span>',
        '        </div>',
        '        <div class="layout-actions">',
        '            <button type="button" id="layoutResetBtn" class="plain">ย้อนกลับ</button>',
        '            <button type="button" id="layoutDownloadBtn" class="plain">ดาวน์โหลด .docx</button>',
        // อัปโหลดไฟล์ใหม่ทับไฟล์เดิม — เหมือนปุ่มในหน้าแก้ไข (ดู replaceFile ใน payload)
        // ใช้ id ของหน้านี้เอง เพราะ id ในหน้าแก้ไข (replaceTemplateBtn) มีอยู่พร้อมกันไม่ได้
        '            <button type="button" id="layoutReplaceFileBtn" class="danger">อัปโหลดไฟล์ใหม่ทับไฟล์เดิม</button>',
        '            <input type="file" id="layoutReplaceFileInput" accept=".docx" hidden>',
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
    let findBarOpen = false; // แถบค้นหาเปิดอยู่ไหม
    let findMatches = [];    // ตำแหน่งที่พบในเอกสาร [{ range, paragraph }]
    let findIndex = -1;      // ตำแหน่งที่กำลังอยู่ (index ใน findMatches)

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

        // popup ของหน้านี้ที่เปิดค้างอยู่ต้องปิดพร้อมหน้าต่าง
        closeFieldMenu();
        closeContextMenu();
        closeFieldDialog();
        clearFieldFocus();

        // ลบไฮไลต์ {{}} ออกจากทะเบียนของเอกสาร (range อ้าง node ที่จะถูกล้าง)
        clearFieldHighlight();

        // แถบค้นหาและไฮไลต์ของมันปิดไปพร้อมหน้าต่าง
        closeFindBar();
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

        // เครื่องหมายจัดรูปแบบเริ่มที่ "ซ่อน" (เหมือนเปิดเอกสารใน Word)
        const marksToggle = el('layoutMarksToggle');
        if (marksToggle) marksToggle.checked = false;

        // แถบค้นหาเริ่มที่ "ปิด" — เปิดด้วยปุ่มค้นหา หรือ Ctrl+F / Ctrl+H
        closeFindBar();

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

    if (bytes) {
        current.bytes = bytes;
    }

    // ปิดเมนู/popup ก่อน — range ที่จำไว้ตอนเปิดอ้าง TextNode ที่กำลังจะถูกลบ
    // (กล่องแก้รายละเอียด field ปิดด้วย เพราะตัวเลข/สถานะอ้างเอกสารชุดเก่า)
    closeFieldMenu();
    closeContextMenu();
    closeFieldDialog();
    clearFieldFocus();

    // ล้าง highlight เดิมก่อนล้าง DOM
    // เพราะ Range เดิมอ้าง TextNode ที่กำลังจะถูกลบ
    clearFieldHighlight();
    clearFind();

    // ล้าง DOM เดิม
    host.innerHTML = '';

    if (!current.bytes) {
        setStatus('ไม่พบไฟล์เอกสาร', 'error');
        return;
    }

    if (!scope.docx || !scope.docx.renderAsync) {
        setStatus(
            'โหลดไลบรารี docx-preview ไม่ได้ (ไฟล์ vendor หาย)',
            'error'
        );
        return;
    }

    setStatus('กำลังเรนเดอร์เอกสาร...');

    try {
        await scope.docx.renderAsync(
            current.bytes,
            host,
            styleHost,
            {
                className: 'docx',
                inWrapper: true,
                breakPages: true,
                ignoreWidth: false,
                ignoreHeight: false,
                renderHeaders: true,
                renderFooters: true,
                renderFootnotes: true,
                useBase64URL: false
            }
        );
    } catch (error) {
        console.error(error);

        if (token === renderToken) {
            setStatus(
                'เรนเดอร์เอกสารไม่สำเร็จ: ' + messageOf(error),
                'error'
            );
        }

        return;
    }

    // ถ้าระหว่าง render มีการเปิด/ปิด หรือ render รอบใหม่
    // ไม่เอาผลของรอบเก่ามาใช้
    if (token !== renderToken) return;

    // ค่า tab stop ของแม่แบบ (default tab stop จาก word/settings.xml
    // + tab stop ของ style จาก word/styles.xml) — ใช้ตอนคำนวณความกว้างแท็บ
    current.tabSettings = await loadTabSettings(current.bytes);

    if (token !== renderToken) return;

    // ตั้ง zoom และจัดตำแหน่ง Shape / TextBox / Table
    applyZoom();

    // รอฟอนต์โหลดครบก่อน เพราะ font metric มีผลกับตำแหน่ง
    // ของข้อความและวัตถุที่อ้างจาก paragraph
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () {
            if (token !== renderToken) return;

            // ฟอนต์ของเอกสารโหลดครบ = ผลวัดความสูงบรรทัดที่แคชไว้ใช้ไม่ได้แล้ว
            naturalLineCache.clear();
            naturalRatioCache.clear();

            fixRenderedLayout();
        });
    }

    // render รอบใหม่ = reset touched
    touched = new Set();

    // จับคู่ paragraph + เตรียม contentEditable
    prepareEditing();

    // ระยะห่างระหว่างบรรทัดตาม w:spacing ของไฟล์ต้นฉบับ
    applyLineSpacing();

    // ความสูงบรรทัดของย่อหน้าว่าง ให้เท่าหนึ่งบรรทัดของ Word
    // (ต้องทำก่อนจัดตำแหน่งวัตถุลอย — ตำแหน่งแนวตั้งของวัตถุอ้างจากบรรทัด)
    applyParagraphMarkHeights();

    // เครื่องหมายที่ตัวเรนเดอร์ไม่วาด ให้วาดเพิ่ม (ต้องทำหลัง prepareEditing
    // เพราะต้องรู้ pair.index ของแต่ละย่อหน้าก่อน)
    applyXmlMarks();

    // ความกว้างแท็บตาม tab stop ของแม่แบบ (ต้องทำหลัง decorateSpecials)
    applyTabStops();

    // ย่อหน้าแบบกระจายตัวอักษร (thaiDistribute) — ต้องทำหลังจัดความกว้างแท็บ
    // เพราะการยืดเปลี่ยนตำแหน่งของทุกอย่างในบรรทัด
    applyThaiDistribute();

    // ชดเชยระยะบรรทัดหลังห่อ span ครบแล้ว (แท็บ/กระจายตัวอักษรเพิ่ม span ซ้อน)
    refineLineSpacing();

    // เครื่องหมายจัดรูปแบบ (ถ้าเปิดสวิตช์ค้างไว้) — ต้องทำก่อนไฮไลต์ field
    // เพราะการห่อช่องว่างด้วย span เปลี่ยน TextNode ที่ Range ของไฮไลต์อ้างถึง
    setFormatMarks(isFormatMarksOn());

    // สำคัญ:
    // ต้องเรียกหลัง docx-preview render เสร็จและหลัง prepareEditing()
    // เพราะ fieldRanges() ต้องอ่าน TextNode จริงจาก DOM
    applyFieldHighlight();

    // แถบค้นหาเปิดอยู่ = ค้นใหม่ เพราะ Range เดิมอ้าง DOM ที่เพิ่งถูกล้างไป
    if (findBarOpen) runFind(false);

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

                // เครื่องหมายที่เราวาดเพิ่ม (applyXmlMarks) = ไม่นับเป็นข้อความของย่อหน้า
                if (child.dataset && child.dataset.layoutMark === '1') continue;

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

            // span.classList.add('layout-special');
            if (isTabSpan(span)) {
                span.classList.add('layout-special', 'layout-tab');
            } else{
                span.classList.add('layout-special', 'layout-symbol');
            }
            span.contentEditable = 'false';
            span.setAttribute('spellcheck', 'false');

            span.title = symbol
                ? 'สัญลักษณ์ของเอกสาร (' + (symbol.font || 'symbol font') +
                    ' รหัส ' + symbol.char.toString(16).toUpperCase() +
                    ') — แก้จากที่นี่ไม่ได้'
                : 'แท็บ (ระยะจัดแนวของเอกสาร) — แก้จากที่นี่ไม่ได้';
        });
    }

    // ──────────────────────────────────────────────────────────────
    // แสดง/ซ่อนเครื่องหมายจัดรูปแบบ (เหมือนปุ่ม ¶ ของ Word)
    //
    // วาดด้วย canvas ลอยเหนือหน้ากระดาษ — ไม่เพิ่ม/ห่อ/ย้าย node ของข้อความ
    // เปิด/ปิดสวิตช์แล้ว layout จึงไม่เปลี่ยนเลย
    //
    //   ·  ช่องว่าง (U+0020)
    //   °  ช่องว่างไม่ตัดคำ (U+00A0)
    //   →  แท็บ (w:tab / w:ptab)
    //   ¶  ท้ายย่อหน้า
    //   ↵  ขึ้นบรรทัดใหม่ (w:br / w:cr)
    //   ¬  ยัติภังค์ทางเลือก (w:softHyphen / U+00AD)
    //   ¤  ท้ายเซลล์ / ท้ายแถว
    //   ข้อความที่ซ่อน (w:vanish) — position:absolute + ขีดเส้นใต้จุด
    //   Page Break / Section Break — ใช้ป้าย ::before ที่มีอยู่แล้ว
    //
    // ข้อความใน DOM ไม่ถูกแก้ จึงบันทึก/ค้นหา/จับคู่ย่อหน้าได้เหมือนเดิม
    // ──────────────────────────────────────────────────────────────

    const FORMAT_MARK_COLOR = '#b26a00';
    const FORMAT_MARK_FONT = '11px "Segoe UI Symbol", "Segoe UI", sans-serif';

    function isFormatMarksOn() {
        const toggle = el('layoutMarksToggle');

        return !!(toggle && toggle.checked);
    }

    function removeMarkOverlays() {
        if (!host) return;

        host.querySelectorAll('canvas.layout-marks-overlay').forEach(function (canvas) {
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        });
    }

    function removeFormatMarks() {
        removeMarkOverlays();

        // ข้อความที่ซ่อน — คืนสถานะซ่อนตาม inline style เดิม
        host.querySelectorAll('.layout-fmt-hidden').forEach(function (span) {
            span.style.marginLeft = '';
            span.classList.remove('layout-fmt-hidden');
        });
    }

    // สร้าง canvas ของหน้ากระดาษหนึ่ง + ตัวแปลงพิกัดจาก viewport → local (ไม่คิด zoom)
    function sectionOverlay(section, scale) {
        const width = section.clientWidth;
        const height = section.clientHeight;

        if (!(width > 0) || !(height > 0)) return null;

        const canvas = document.createElement('canvas');
        const dpr = window.devicePixelRatio || 1;

        canvas.className = 'layout-marks-overlay';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.width = Math.ceil(width * dpr);
        canvas.height = Math.ceil(height * dpr);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        section.appendChild(canvas);

        const ctx = canvas.getContext('2d');

        if (!ctx) {
            canvas.remove();
            return null;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = FORMAT_MARK_FONT;
        ctx.fillStyle = FORMAT_MARK_COLOR;
        ctx.globalAlpha = 0.9;

        const rect = section.getBoundingClientRect();
        const originX = rect.left + section.clientLeft;
        const originY = rect.top + section.clientTop;

        return {
            canvas: canvas,
            ctx: ctx,
            width: width,
            height: height,
            localLeft: function (x) {
                return (x - originX) / scale;
            },
            localTop: function (y) {
                return (y - originY) / scale;
            },
            localRect: function (r) {
                return {
                    left: (r.left - originX) / scale,
                    right: (r.right - originX) / scale,
                    top: (r.top - originY) / scale,
                    bottom: (r.bottom - originY) / scale,
                    width: r.width / scale,
                    height: r.height / scale
                };
            }
        };
    }

    function drawMark(overlay, text, x, y, align) {
        if (!overlay || !overlay.ctx) return;

        if (!(x > -20 && x < overlay.width + 20 && y > -20 && y < overlay.height + 20)) {
            return;
        }

        const ctx = overlay.ctx;

        ctx.textAlign = align || 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
    }

    function overlayForNode(node, overlays) {
        if (!node || !node.closest) return null;

        const section = node.closest('section.docx');

        return section ? overlays.get(section) || null : null;
    }

    // ข้อความที่ถูกซ่อนอยู่ (ทั้งก่อนและหลังติดคลาส layout-fmt-hidden)
    function isInsideHiddenText(node) {
        let element = node && node.nodeType === 1 ? node : node && node.parentElement;

        while (element && element !== host) {
            if (element.classList && element.classList.contains('layout-fmt-hidden')) {
                return true;
            }

            if (element.style && element.style.display === 'none') {
                return true;
            }

            element = element.parentElement;
        }

        return false;
    }

    function rangeRect(node, start, end) {
        const range = document.createRange();

        range.setStart(node, start);
        range.setEnd(node, end);

        let rect = range.getBoundingClientRect();

        if (!(rect.height > 0)) {
            const rects = range.getClientRects();

            rect = rects.length ? rects[0] : rect;
        }

        return rect;
    }

    // ตำแหน่งของอักขระที่มองเห็นได้ตัวสุดท้ายในย่อหน้า
    function lastCharRect(paragraph) {
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];
        let node;

        while ((node = walker.nextNode()) !== null) {
            if (isDirectParagraphTextNode(node, paragraph)) nodes.push(node);
        }

        for (let i = nodes.length - 1; i >= 0; i--) {
            if (isInsideHiddenText(nodes[i])) continue;

            const text = nodes[i].nodeValue || '';

            for (let j = text.length - 1; j >= 0; j--) {
                const rect = rangeRect(nodes[i], j, j + 1);

                if (rect.height > 0 && rect.width > 0) return rect;
            }
        }

        return null;
    }

    // scale = zoom ของหน้า (rect เป็น px บนจอ ส่วนระยะเยื้อง/line-height เป็น CSS px)
    function paragraphMarkPoint(paragraph, scale) {
        const rect = lastCharRect(paragraph);

        if (rect) {
            return { x: rect.right + 2, y: (rect.top + rect.bottom) / 2 };
        }

        // ย่อหน้าว่าง — ไม่มีบรรทัดให้อ้าง ใช้กล่องของย่อหน้าเอง
        // (สูงเท่าระยะบรรทัดที่ตั้งไว้) แล้ววางตามการจัดแนวของย่อหน้า
        // เหมือนที่ Word วางเครื่องหมายย่อหน้าของบรรทัดว่าง
        const zoom = scale > 0 ? scale : 1;
        const box = paragraph.getBoundingClientRect();
        const style = window.getComputedStyle(paragraph);
        const indent = (parseFloat(style.textIndent) || 0) * zoom;
        const align = style.textAlign;

        let x = box.left + indent + 1;

        if (align === 'center') {
            x = box.left + box.width / 2;
        } else if (align === 'right' || align === 'end') {
            x = box.right - indent - 1;
        }

        return { x: x, y: (box.top + box.bottom) / 2 };
    }

    function drawSpaceMarks(overlay, paragraph) {
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, null, false);
        let node;

        while ((node = walker.nextNode()) !== null) {
            if (!isDirectParagraphTextNode(node, paragraph)) continue;
            if (isInsideHiddenText(node)) continue;

            const text = node.nodeValue || '';

            for (let i = 0; i < text.length; i++) {
                const char = text.charAt(i);

                if (char !== ' ' && char !== '\u00A0' && char !== '\u00AD') continue;

                const rect = rangeRect(node, i, i + 1);

                if (!(rect.height > 0)) continue;

                const point = overlay.localRect(rect);
                const x = point.left + point.width / 2;
                const y = point.top + point.height / 2;

                if (char === '\u00AD') {
                    drawMark(overlay, '¬', point.left, y, 'left');
                } else if (char === '\u00A0') {
                    drawMark(overlay, '°', x, y);
                } else {
                    drawMark(overlay, '·', x, y);
                }
            }
        }
    }

    function drawTabMarks(overlay, section) {
        section.querySelectorAll('span.layout-tab').forEach(function (span) {
            if (wrapsTab(span) || isInsideHiddenText(span)) return;

            const rect = span.getBoundingClientRect();

            if (!(rect.height > 0) || !(rect.width > 0)) return;

            const point = overlay.localRect(rect);

            drawMark(
                overlay,
                '→',
                point.left + point.width / 2,
                point.top + point.height / 2
            );
        });
    }

    // ¬ ของ w:softHyphen — applyXmlMarks สร้าง span ที่มี data-layout-mark
    // จึงถูกข้ามโดย drawSpaceMarks ต้องวาดจาก span โดยตรง
    function drawSoftHyphenMarks(overlay, section) {
        section.querySelectorAll('span.layout-mark-softHyphen').forEach(function (span) {
            if (isInsideHiddenText(span)) return;

            const rect = span.getBoundingClientRect();

            if (!(rect.height > 0)) return;

            const point = overlay.localRect(rect);

            drawMark(overlay, '¬', point.left, point.top + point.height / 2, 'left');
        });
    }

    // rect ของข้อความช่วงสุดท้ายก่อน node (ใช้หาจุดขึ้นบรรทัดใหม่)
    function lastRectBefore(node) {
        const paragraph = node.closest ? node.closest('p') : null;

        if (!paragraph) return null;

        const range = document.createRange();

        range.selectNodeContents(paragraph);

        try {
            range.setEndBefore(node);
        } catch (error) {
            return null;
        }

        const rects = range.getClientRects();

        for (let i = rects.length - 1; i >= 0; i--) {
            if (rects[i].height > 0) return rects[i];
        }

        return null;
    }

    function drawLineBreakMarks(overlay, section) {
        section.querySelectorAll('article br').forEach(function (br) {
            if (isInsideHiddenText(br)) return;

            // ใช้ปลายข้อความบนบรรทัดก่อน <br> ก่อน (ตรงกับที่ Word วาง ↵)
            let rect = lastRectBefore(br);
            let x = null;
            let align = 'right';

            if (rect && rect.height > 0) {
                x = overlay.localLeft(rect.right - 1);
            } else {
                rect = br.getBoundingClientRect();

                if (!(rect.height > 0)) return;

                x = overlay.localLeft(rect.left);
                align = 'left';
            }

            drawMark(overlay, '↵', x, overlay.localTop((rect.top + rect.bottom) / 2), align);
        });
    }

    function visibleCell(cell) {
        if (!cell || (cell.localName !== 'td' && cell.localName !== 'th')) {
            return false;
        }

        if (cell.style.display === 'none') return false;

        const table = cell.closest('table');

        return !(table && table.style.display === 'none');
    }

    // ย่อหน้าสุดท้ายที่เป็นของเซลล์นี้เอง (ไม่ใช่ของตารางซ้อน)
    function lastOwnParagraph(cell) {
        const paragraphs = Array.from(cell.querySelectorAll('p')).filter(function (p) {
            return p.closest('td,th') === cell;
        });

        return paragraphs.length ? paragraphs[paragraphs.length - 1] : null;
    }

    // เก็บ ¤ ของทุกเซลล์/แถว + ย่อหน้าที่ไม่ต้องวาด ¶ (ท้ายเซลล์ใช้ ¤ แทน)
    function collectTableMarks() {
        const cellMarks = [];
        const rowMarks = [];
        const skipParagraphs = new Set();

        host.querySelectorAll('article table').forEach(function (table) {
            if (table.style.display === 'none') return;

            table.querySelectorAll('tr').forEach(function (row) {
                // ข้ามแถวของตารางซ้อน — จะถูกทำตอนวน table ของมันเอง
                if (row.closest('table') !== table) return;

                const cells = Array.from(row.children).filter(visibleCell);

                if (!cells.length) return;

                cells.forEach(function (cell) {
                    const paragraph = lastOwnParagraph(cell);

                    cellMarks.push({ cell: cell, paragraph: paragraph });

                    if (paragraph) skipParagraphs.add(paragraph);
                });

                rowMarks.push(cells[cells.length - 1]);
            });
        });

        return {
            cellMarks: cellMarks,
            rowMarks: rowMarks,
            skipParagraphs: skipParagraphs
        };
    }

    function cellMarkPoint(cell, scale) {
        const zoom = scale > 0 ? scale : 1;
        const box = cell.getBoundingClientRect();
        const style = window.getComputedStyle(cell);
        const paddingLeft = (parseFloat(style.paddingLeft) || 0) * zoom;
        const paddingTop = (parseFloat(style.paddingTop) || 0) * zoom;
        const lineHeight = parseFloat(style.lineHeight)
            || (parseFloat(style.fontSize) || 16) * 1.2;

        return {
            x: box.left + paddingLeft + 1,
            y: box.top + paddingTop + lineHeight * zoom / 2
        };
    }

    function drawTableMarks(overlays, tableMarks, scale) {
        tableMarks.cellMarks.forEach(function (mark) {
            const overlay = overlayForNode(mark.paragraph || mark.cell, overlays);

            if (!overlay) return;

            const point = mark.paragraph
                ? paragraphMarkPoint(mark.paragraph, scale)
                : cellMarkPoint(mark.cell, scale);

            drawMark(
                overlay,
                '¤',
                overlay.localLeft(point.x),
                overlay.localTop(point.y),
                'left'
            );
        });

        tableMarks.rowMarks.forEach(function (cell) {
            const overlay = overlayForNode(cell, overlays);

            if (!overlay) return;

            const point = overlay.localRect(cell.getBoundingClientRect());

            drawMark(overlay, '¤', point.right - 4, point.bottom - 4, 'right');
        });
    }

    // วาดเครื่องหมายทั้งหมดลง canvas ของแต่ละหน้า (ไม่แตะ DOM ข้อความ)
    function drawFormatMarksOverlay() {
        if (!host || !current) return;

        removeMarkOverlays();

        const wrapper = host.querySelector('.docx-wrapper');

        if (!wrapper) return;

        const scale = Number(wrapper.style.zoom) || 1;
        const overlays = new Map();

        host.querySelectorAll('.docx-wrapper > section.docx').forEach(function (section) {
            const overlay = sectionOverlay(section, scale);

            if (overlay) overlays.set(section, overlay);
        });

        if (!overlays.size) return;

        const tableMarks = collectTableMarks();

        bodyParagraphs().forEach(function (paragraph) {
            const overlay = overlayForNode(paragraph, overlays);

            if (!overlay) return;

            drawSpaceMarks(overlay, paragraph);

            if (tableMarks.skipParagraphs.has(paragraph)) return;

            const point = paragraphMarkPoint(paragraph, scale);

            drawMark(
                overlay,
                '¶',
                overlay.localLeft(point.x),
                overlay.localTop(point.y),
                'left'
            );
        });

        overlays.forEach(function (overlay, section) {
            drawTabMarks(overlay, section);
            drawSoftHyphenMarks(overlay, section);
            drawLineBreakMarks(overlay, section);
        });

        drawTableMarks(overlays, tableMarks, scale);
    }

    // ข้อความที่ซ่อน (w:vanish) — แสดงแบบ position:absolute ไม่กินพื้นที่ใน layout
    function markHiddenText() {
        if (!host) return;

        const spans = [];

        host.querySelectorAll('span').forEach(function (span) {
            if (span.style.display !== 'none') return;

            span.classList.add('layout-fmt-hidden');
            spans.push(span);
        });

        // span ที่ซ่อนติดกันจะอยู่ตำแหน่ง static เดียวกัน (เพราะตัวก่อนหน้า
        // หลุดออกจาก flow) — เลื่อนตัวถัดไปด้วย margin-left เพื่อไม่ให้ทับกัน
        let previous = null;

        spans.forEach(function (span) {
            let rect = span.getBoundingClientRect();

            if (previous && Math.abs(rect.top - previous.top) < 2
                && rect.left < previous.right - 0.5) {
                span.style.marginLeft = (previous.right - rect.left) + 'px';
                rect = span.getBoundingClientRect();
            }

            previous = rect;
        });
    }

    function setFormatMarks(on) {
        if (!host) return;

        host.classList.toggle('show-format-marks', !!on);

        // เคลียร์ของเดิมก่อนทุกครั้ง — เรียกซ้ำได้หลัง re-render/layout เปลี่ยน
        removeFormatMarks();

        if (!on) return;

        // วัดตอนข้อความซ่อนยัง display:none อยู่ แล้วค่อยแสดงเป็น overlay
        drawFormatMarksOverlay();
        markHiddenText();
    }

    // เปลี่ยนสวิตช์ — layout ไม่เปลี่ยน แต่คำนวณไฮไลต์/ผลค้นหาใหม่กัน Range ค้าง
    function applyFormatMarks() {
        setFormatMarks(isFormatMarksOn());

        applyFieldHighlight();

        if (findBarOpen) runFind(false);
    }

    // ──────────────────────────────────────────────────────────────
    // เครื่องหมายในบรรทัดที่ตัวเรนเดอร์ "ไม่วาด" ให้
    //
    // docx-preview รู้จักลูกของ w:r แค่บางตัว ที่เหลือถูกทิ้งเงียบ ๆ
    // (ตรวจจากโค้ดของไลบรารี: ไม่มีกรณีของ cr / noBreakHyphen / softHyphen
    // / ptab เลย) เอกสารจาก Word จึงขาดเครื่องหมายพวกนี้ไปทั้งชิ้น:
    //
    //   w:cr              ขึ้นบรรทัดใหม่ในย่อหน้า (แบบเดียวกับ w:br) → แทรก <br>
    //   w:noBreakHyphen   ยัติภังค์แบบห้ามตัดบรรทัด — ไลบรารีวาดเป็น <wbr>
    //                     ซึ่งไม่มีอักขระ จึงเหลือแค่จุดที่ตัดบรรทัดได้ (ผิดความหมาย)
    //   w:softHyphen      ยัติภังค์ที่โผล่เฉพาะเมื่อตัดบรรทัด
    //   w:ptab            แท็บแบบกำหนดตำแหน่งเอง → วาดเป็นแท็บ (โดยประมาณ)
    //   w:ffData>w:checkBox  ช่องติ๊กของ form field รุ่นเก่าที่ยังไม่มี
    //                     "ผลลัพธ์ที่ Word แคชไว้" → วาดเป็นกล่อง (ติ๊ก/ไม่ติ๊ก)
    //
    // รายการข้างบนเพิ่มได้ด้วยสาเหตุเดียวกัน ถ้าตรวจเจอว่าตัวเรนเดอร์ทิ้งอีก
    //
    // สิ่งที่วาดเพิ่มอยู่ในสแปน data-layout-mark="1" ซึ่ง renderedText(),
    // domFormatRuns() และ isDirectParagraphTextNode() ข้ามไป (เหมือนไม่มีข้อความ)
    // จึงไม่กระทบการจับคู่ย่อหน้า การค้นหา/แทนที่ การเทียบรูปแบบ และการบันทึก
    // ไฟล์ — เครื่องหมายที่มีจริงใน XML ไม่ถูกเขียนกลับซ้ำ
    // ──────────────────────────────────────────────────────────────

    // วาดเครื่องหมายที่ตัวเรนเดอร์ไม่วาด ให้ย่อหน้าที่จับคู่กับต้นฉบับได้
    // (ย่อหน้าที่จับคู่ไม่ได้ = แก้ไม่ได้อยู่แล้ว จึงไม่วาด เพราะไม่มีที่ให้เขียนกลับ)
    function applyXmlMarks() {
        if (!host || !current || !current.pairs) return;

        // w:noBreakHyphen — ตัวเรนเดอร์วาดเป็น <wbr> ซึ่งไม่มีอักขระ จึงเหลือแค่
        // "จุดที่ตัดบรรทัดได้" (ตรงข้ามกับความหมายของเครื่องหมาย) ทิ้งมันแล้ววาด
        // อักขระยัติภังค์แบบห้ามตัดบรรทัดแทนด้านล่าง
        // (<wbr> เกิดจาก w:noBreakHyphen ที่เดียว — ตรวจจากโค้ดของไลบรารี)
        host.querySelectorAll('article wbr').forEach(function (wbr) {
            wbr.parentNode.removeChild(wbr);
        });

        const paragraphs = paragraphNodes();

        if (!paragraphs.length) return;

        current.pairs.forEach(function (pair, node) {
            const xmlParagraph = paragraphs[pair.index];

            if (!xmlParagraph) return;

            const items = paragraphContentItems(xmlParagraph);

            if (!items.some(function (item) { return item.kind === 'mark'; })) return;

            const map = paragraphTextMap(node);
            const inserts = [];

            // เดินเทียบเนื้อหาใน XML กับข้อความที่เรนเดอร์แล้ว เพื่อรู้ว่า
            // เครื่องหมายแต่ละอันอยู่ตรงไหนของข้อความ
            let offset = 0;
            let aligned = true;

            for (const item of items) {
                if (item.kind === 'text') {
                    if (!item.text) continue;

                    const at = map.text.indexOf(item.text, offset);

                    if (at === -1) {
                        // เทียบไม่ตรง (ย่อหน้าถูกตัด หรือตัวเรนเดอร์เพิ่มอักขระเอง)
                        // ไม่วาดดีกว่าเดาตำแหน่ง
                        aligned = false;
                        break;
                    }

                    offset = at + item.text.length;
                    continue;
                }

                if (item.kind === 'mark') {
                    inserts.push({ at: offset, item: item });
                }
            }

            if (!aligned || !inserts.length) return;

            // แทรกจากท้ายมาหน้า — การตัด TextNode ของตำแหน่งหลัง
            // ไม่กระทบตำแหน่งที่ยังไม่ได้แทรก
            for (let i = inserts.length - 1; i >= 0; i--) {
                insertMark(node, map, inserts[i].at, inserts[i].item);
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // ความสูงของย่อหน้าที่ "ว่าง" — ต้องเท่าหนึ่งบรรทัดของ Word
    //
    // docx-preview ไม่ได้ยกฟอนต์/ขนาดของ "เครื่องหมายย่อหน้า" (w:pPr/w:rPr)
    // ขึ้นไปที่ <p> ย่อหน้าที่ไม่มีเนื้อหา (บรรทัดว่าง) จึงสูงเท่า 1em ของฟอนต์
    // ที่สืบทอดมาจาก UI (15px) แทนที่จะเป็นฟอนต์ของเอกสาร (16pt = 21.33px)
    // → บรรทัดว่างเตี้ยกว่าครึ่ง ข้อความที่ตามมาขยับขึ้นทีละบรรทัด ๆ
    // ทำให้ของที่ลอยอยู่ (รูป/กล่องข้อความ) ไปทับข้อความ (เช่น แม่แบบ
    // "บันทึกข้อความ ว119" ที่ตรามหาวิทยาลัยทับบรรทัด "ส่วนงาน")
    //
    // Word ใช้ขนาดของเครื่องหมายย่อหน้าเป็นความสูงของบรรทัดว่าง ที่นี่จึงวัด
    // ความสูง "หนึ่งบรรทัดตามธรรมชาติ" (line-height: normal) ของฟอนต์/ขนาด
    //นั้นจากเบราว์เซอร์ แล้วตั้ง min-height ให้ย่อหน้า
    // — ย่อหน้าที่มีเนื้อหาสูงกว่าอยู่แล้วจะไม่ถูกแตะ (min-height เป็นเพียงพื้นล่าง)
    // ──────────────────────────────────────────────────────────────

    // แคชผลวัด (คีย์ = ฟอนต์|ขนาด px) — ล้างเมื่อฟอนต์โหลดครบ
    const naturalLineCache = new Map();

    // ความสูงหนึ่งบรรทัดจริง (px) ของฟอนต์/ขนาดหนึ่ง
    function naturalLineHeight(font, sizePx) {
        const key = String(font || '') + '|' + sizePx;

        if (naturalLineCache.has(key)) return naturalLineCache.get(key);

        const probe = document.createElement('div');

        probe.style.cssText = 'position:absolute;visibility:hidden;left:-99999px;top:0;' +
            'white-space:pre;line-height:normal;margin:0;padding:0;border:0;' +
            'font-size:' + sizePx + 'px;font-family:' +
            (font ? JSON.stringify(font) + ',' : '') + 'sans-serif;';
        probe.textContent = 'x';
        document.body.appendChild(probe);

        const height = probe.getBoundingClientRect().height;

        document.body.removeChild(probe);
        naturalLineCache.set(key, height);

        return height;
    }

    // สัดส่วน "หนึ่งบรรทัดตามธรรมชาติ" ต่อขนาดฟอนต์ (เช่น TH SarabunIT๙ = 1.125)
    // วัดที่ขนาดใหญ่แล้วหารกลับ เพื่อลดผลการปัดเศษ px ของเบราว์เซอร์
    const naturalRatioCache = new Map();

    function naturalLineRatio(font) {
        const key = String(font || '');

        if (naturalRatioCache.has(key)) return naturalRatioCache.get(key);

        const probe = document.createElement('div');

        probe.style.cssText = 'position:absolute;visibility:hidden;left:-99999px;top:0;' +
            'white-space:pre;line-height:normal;margin:0;padding:0;border:0;' +
            'font-size:200px;font-family:' +
            (font ? JSON.stringify(font) + ',' : '') + 'sans-serif;';
        probe.textContent = 'x';
        document.body.appendChild(probe);

        const height = probe.getBoundingClientRect().height;

        document.body.removeChild(probe);

        const ratio = height > 0 ? height / 200 : 0;

        naturalRatioCache.set(key, ratio);

        return ratio;
    }

    // ──────────────────────────────────────────────────────────────
    // ระยะห่างระหว่างบรรทัด (w:spacing)
    //
    // Word คิดระยะบรรทัดจาก "หนึ่งบรรทัดธรรมชาติ" ของฟอนต์ ไม่ใช่ขนาดตัวอักษร:
    //   auto     w:line = 1/240 ของหนึ่งบรรทัด (240 = เดี่ยว, 360 = 1.5)
    //   atLeast  อย่างน้อย w:line/20 pt (แต่ไม่น้อยกว่าหนึ่งบรรทัดธรรมชาติ)
    //   exact    เท่ากับ w:line/20 pt เสมอ
    //
    // docx-preview แปลง auto เป็น line-height: 1.08 (คูณขนาดตัวอักษร) ซึ่งเตี้ยกว่า
    // ที่ Word แสดงจริง (ฟอนต์ไทยหนึ่งบรรทัดสูง ~1.1–1.4 เท่าของขนาด) และแปลง
    // atLeast เป็น calc(100% + Xpt) ซึ่งสูงเกิน — ที่นี่จึงคำนวณเป็น px เอง
    // โดยใช้สัดส่วนบรรทัดธรรมชาติที่วัดจากเบราว์เซอร์ (ตรงกับ Word สำหรับ
    // ฟอนต์ที่ใช้ในแม่แบบราชการ) แล้วตั้ง line-height ของย่อหน้า
    // ──────────────────────────────────────────────────────────────

    const PT_TO_PX = 4 / 3;

    // อ่าน w:spacing เฉพาะที่มี w:line (ค่า line เป็น 1/240 บรรทัด หรือ 1/20 pt)
    function readLineSpacing(pPr) {
        const spacing = pPr ? elementChild(pPr, 'spacing') : null;

        if (!spacing) return null;

        const line = Number(wAttr(spacing, 'line'));

        if (!(line > 0)) return null;

        // ไม่ระบุ lineRule = auto (ค่าเริ่มต้นของ OOXML) — ไม่ใช่ exact
        return { line: line, rule: wAttr(spacing, 'lineRule') || 'auto' };
    }

    // ระยะบรรทัดที่มีผลกับย่อหน้า: ย่อหน้า → style (ตาม w:basedOn) → docDefaults
    function paragraphLineSpacing(xmlParagraph, settings) {
        const defaults = (settings && settings.defaults) || {};
        const styles = settings && settings.styles;

        if (!xmlParagraph) return defaults.lineSpacing || null;

        const pPr = elementChild(xmlParagraph, 'pPr');
        const direct = readLineSpacing(pPr);

        if (direct) return direct;

        // attribute ของ w:spacing สืบทอดทีละตัว — w:spacing ที่มีแต่ w:after
        // ไม่ได้ล้าง w:line ที่มาจาก style
        const pStyle = pPr ? elementChild(pPr, 'pStyle') : null;
        const own = styleLineSpacing(pStyle ? wAttr(pStyle, 'val') : null, styles);

        if (own) return own;

        // ไม่มี pStyle = ใช้ style ย่อหน้าเริ่มต้นของเอกสาร (ปกติคือ Normal)
        // ซึ่งมักกำหนด line="240" เอง — ต้องอ่านก่อน docDefaults
        const inherited = styleLineSpacing(settings && settings.defaultParagraphStyle, styles);

        if (inherited) return inherited;

        return defaults.lineSpacing || { line: 240, rule: 'auto' };
    }

    // ระยะบรรทัดจาก style หนึ่ง (ตามสาย w:basedOn) — คืน null ถ้าไม่มี
    function styleLineSpacing(id, styles) {
        let depth = 0;

        while (id && styles && typeof styles.get === 'function' && depth++ < 10) {
            const style = styles.get(id);

            if (!style) break;
            if (style.lineSpacing) return style.lineSpacing;

            id = style.basedOn;
        }

        return null;
    }

    // ความสูงบรรทัดจริง (px) จาก w:spacing + หนึ่งบรรทัดธรรมชาติของฟอนต์
    function lineSpacingHeight(line, singlePx) {
        const exact = line.line / 20 * PT_TO_PX;

        switch (line.rule) {
            case 'exact':
                return exact;
            case 'atLeast':
                return Math.max(singlePx, exact);
            default:
                return singlePx * line.line / 240;
        }
    }

    // ชื่อฟอนต์แรกจาก computed font-family
    function firstFontFamily(value) {
        return String(value || '')
            .split(',')[0]
            .trim()
            .replace(/^["']|["']$/g, '');
    }

    // ฟอนต์/ขนาดที่กำหนดความสูงบรรทัดของย่อหน้า — Word คิดจาก run ที่ "สูงที่สุด"
    // (ขนาด × หนึ่งบรรทัดธรรมชาติของฟอนต์นั้น) ไม่ใช่แค่ขนาดตัวอักษรที่ใหญ่สุด:
    // ฟอนต์ 16pt ต่างกันมีระยะบรรทัดธรรมชาติไม่เท่ากัน
    function dominantRunFormat(node) {
        let best = null;

        function consider(size, font) {
            if (!(size > 0)) return;

            const height = (naturalLineRatio(font) || 0) * size;

            if (best && height <= best.height + 0.01) return;

            best = { size: size, font: font, height: height };
        }

        Array.from(node.querySelectorAll('span')).forEach(function (span) {
            if (span.closest('p') !== node) return;

            const style = window.getComputedStyle(span);

            consider(parseFloat(style.fontSize) || 0, firstFontFamily(style.fontFamily));
        });

        if (!best) {
            const style = window.getComputedStyle(node);

            consider(parseFloat(style.fontSize) || 0, firstFontFamily(style.fontFamily));
        }

        return best || { size: 0, font: '', height: 0 };
    }

    // ฟอนต์/ขนาดที่มีผลกับความสูงบรรทัด = ระหว่าง run ที่สูงที่สุด กับ
    // "เครื่องหมายย่อหน้า" (w:pPr/w:rPr) — Word ใช้เครื่องหมายย่อหน้าคิดความสูง
    // ของบรรทัดสุดท้าย/บรรทัดว่างด้วย ย่อหน้าว่างจึงต้องได้ระยะเท่าย่อหน้าข้อความ
    // ไม่ใช่ฟอนต์ที่สืบทอดมาจาก UI
    function paragraphRunFormat(node, xmlParagraph, settings) {
        const run = dominantRunFormat(node);
        const mark = paragraphMarkFormat(xmlParagraph, settings);

        if (!mark || !mark.size) return run;

        const markFormat = {
            size: mark.size * 2 / 3,
            font: mark.font || run.font,
            height: (naturalLineRatio(mark.font || run.font) || 0) * mark.size * 2 / 3
        };

        // ย่อหน้าว่างไม่มี run เลย — ฟอนต์ที่คำนวณได้เป็นฟอนต์ของ UI (สืบทอดมา)
        // ไม่ใช่ฟอนต์ของเอกสาร Word ใช้เครื่องหมายย่อหน้าเป็นตัวกำหนดบรรทัด
        if (!node.querySelector('span')) return markFormat;

        return markFormat.height > run.height + 0.01 ? markFormat : run;
    }

    // ระยะบรรทัดเป้าหมาย + ฟอนต์/ขนาดของ strut
    function paragraphLineTarget(node, xmlParagraph, settings) {
        const line = paragraphLineSpacing(xmlParagraph, settings);

        if (!line) return null;

        const run = paragraphRunFormat(node, xmlParagraph, settings);
        const ratio = naturalLineRatio(run.font);

        if (!(run.size > 0) || !(ratio > 0)) return null;

        return {
            run: run,
            height: lineSpacingHeight(line, ratio * run.size)
        };
    }

    // zoom ของหน้าจอ — getBoundingClientRect คืน px จริงบนจอ (คูณ zoom แล้ว)
    // ส่วนค่าที่คำนวณจากไฟล์ (line-height, ระยะบรรทัด) เป็น CSS px ยังไม่คูณ zoom
    // การวัดระยะจริงมาเทียบจึงต้องหารด้วยค่านี้ก่อน
    function layoutZoomScale() {
        const wrapper = host ? host.querySelector('.docx-wrapper') : null;
        const value = wrapper ? parseFloat(wrapper.style.zoom) : 0;

        return value > 0 ? value : 1;
    }

    // ระยะบรรทัดที่วัดได้จริง (px) — ค่ากลางของระยะระหว่างบรรทัดในย่อหน้า
    // (ค่ากลางกันบรรทัดที่มีฟอนต์ใหญ่กว่าปกติเพียงบรรทัดเดียว)
    function linePitchStats(node) {
        const lines = lineBoxes(directTextRects(node));

        if (lines.length < 2) return null;

        const pitches = [];

        for (let i = 1; i < lines.length; i++) {
            const pitch = lines[i].top - lines[i - 1].top;

            if (pitch > 0) pitches.push(pitch);
        }

        if (!pitches.length) return null;

        pitches.sort(function (a, b) {
            return a - b;
        });

        return {
            pitch: pitches[Math.floor(pitches.length / 2)]
        };
    }

    // ตั้งระยะบรรทัดของทุกย่อหน้าตามไฟล์ต้นฉบับ (แสดงผลอย่างเดียว)
    // — ตั้ง line-height ตามค่าที่คำนวณ ส่วนการชดเชยระยะที่เบราว์เซอร์
    //   บวกเพิ่มเองทำใน refineLineSpacing (หลังห่อ span ครบแล้ว)
    function applyLineSpacing() {
        if (!host || !current || !current.pairs) return;

        const settings = current.tabSettings || {};
        const paragraphs = paragraphNodes();

        if (!paragraphs.length) return;

        current.pairs.forEach(function (pair, node) {
            const xmlParagraph = paragraphs[pair.index];

            if (!xmlParagraph) return;

            const target = paragraphLineTarget(node, xmlParagraph, settings);

            if (!target || !(target.height > 0)) return;

            // strut ของย่อหน้าต้องเป็นฟอนต์/ขนาดเดียวกับ run ที่สูงสุด
            // — ถ้าฟอนต์ต่างกัน (เช่น strut เป็นฟอนต์ของ UI) ascent/descent
            //   ไม่ตรงกับ span เบราว์เซอร์จะดัน line box ให้สูงกว่า line-height
            //   เองอีก ~2px ต่อบรรทัด ตารางจึงไม่ตรงแถว (ดูเลข 5 กับข้อความข้าง ๆ)
            const size = target.run.size.toFixed(2) + 'px';

            if (node.style.fontSize !== size) node.style.fontSize = size;

            const family = target.run.font ? JSON.stringify(target.run.font) : '';

            if (family && node.style.fontFamily !== family) {
                node.style.fontFamily = family;
            }

            const value = target.height.toFixed(2) + 'px';

            if (node.style.lineHeight !== value) node.style.lineHeight = value;
        });
    }

    // ชดเชยระยะที่เบราว์เซอร์บวกเพิ่ม — เรียกหลังตกแต่ง span เสร็จแล้ว
    // (แท็บ/กระจายตัวอักษรห่อ span ซ้อน ซึ่งทำให้ line box สูงกว่า line-height)
    function refineLineSpacing() {
        if (!host || !current || !current.pairs) return;

        const settings = current.tabSettings || {};
        const paragraphs = paragraphNodes();

        if (!paragraphs.length) return;

        const items = [];

        current.pairs.forEach(function (pair, node) {
            const xmlParagraph = paragraphs[pair.index];

            if (!xmlParagraph) return;

            const target = paragraphLineTarget(node, xmlParagraph, settings);

            if (!target || !(target.height > 0)) return;

            const currentHeight = parseFloat(node.style.lineHeight) || 0;

            if (!(currentHeight > 0)) return;

            items.push({ node: node, target: target.height, current: currentHeight });
        });

        if (!items.length) return;

        // ระยะที่วัดได้เป็น px บนจอ (คูณ zoom) — แปลงกลับเป็น CSS px ก่อนเทียบ
        const scale = layoutZoomScale();

        items.forEach(function (item) {
            item.height = item.current;
            item.previousHeight = null;
            item.lastMeasured = null;
            item.done = false;
        });

        // แต่ละรอบ: วัดทุกย่อหน้า → ขยับ line-height ตามส่วนที่เกิน → วัดใหม่
        // ทำซ้ำไม่เกิน 4 รอบ เพราะระยะที่เบราว์เซอร์บวกเพิ่มไม่ได้คงที่เป๊ะ
        // (ปรับทีเดียวอาจเกิน/ขาด และการวัดควรทำหลัง layout นิ่งแล้วเท่านั้น)
        for (let pass = 0; pass < 4; pass++) {
            const measured = [];

            items.forEach(function (item) {
                if (item.done) return;

                const stats = linePitchStats(item.node);

                if (!stats) {
                    item.done = true;
                    return;
                }

                measured.push({ item: item, pitch: stats.pitch });
            });

            let changed = false;

            measured.forEach(function (entry) {
                const item = entry.item;
                const residual = entry.pitch / scale - item.target;

                // ตรงแล้ว (หรือต่างไม่ถึงครึ่งพิกเซล) = ไม่แตะ
                if (Math.abs(residual) < 0.5) {
                    item.done = true;
                    return;
                }

                // ขยับแล้วระยะไม่เปลี่ยน = ติดพื้นของเบราว์เซอร์ (เช่น exact ที่เตี้ยมาก)
                // คืนค่า line-height เดิม (ค่าตามไฟล์) ดีกว่าปล่อยให้เหลือค่าเล็กผิด ๆ
                if (item.lastMeasured != null && Math.abs(entry.pitch - item.lastMeasured) < 0.05) {
                    if (item.previousHeight != null) {
                        item.node.style.lineHeight = item.previousHeight.toFixed(2) + 'px';
                    }

                    item.done = true;
                    return;
                }

                const height = item.height - residual;

                // อย่าลดจนเส้นบรรทัดยุบ (ค่า exact ที่เป็นไปไม่ได้)
                if (!(height > 2)) {
                    item.done = true;
                    return;
                }

                item.previousHeight = item.height;
                item.height = height;
                item.lastMeasured = entry.pitch;
                item.node.style.lineHeight = height.toFixed(2) + 'px';
                changed = true;
            });

            if (!changed) break;
        }
    }

    // ฟอนต์/ขนาดของเครื่องหมายย่อหน้า (w:pPr/w:rPr) — สืบทอด style แล้ว docDefaults
    function paragraphMarkFormat(xmlParagraph, settings) {
        const defaults = (settings && settings.defaults) || {};
        const styles = settings && settings.styles;
        const target = { size: null, font: null };

        // attribute ที่ย่อหน้ากำหนดเองชนะ style เสมอ (ไม่ใช่เอาค่ามากสุด)
        // — readRPrFormat เลือก sz/szCs ที่มากกว่าของ "ชั้นเดียวกัน" ให้แล้ว
        function merge(format) {
            if (target.size == null && format.size != null) {
                target.size = format.size;
            }

            if (format.font && !target.font) target.font = format.font;
        }

        if (!xmlParagraph) return target;

        const pPr = elementChild(xmlParagraph, 'pPr');
        const pStyle = pPr ? elementChild(pPr, 'pStyle') : null;

        // 1) ที่ย่อหน้ากำหนดเอง
        merge(readRPrFormat(pPr ? elementChild(pPr, 'rPr') : null));

        // 2) ที่สืบทอดจาก style (ตามสาย w:basedOn)
        // ไม่มี pStyle = ใช้ style ย่อหน้าเริ่มต้นของเอกสาร (ปกติคือ Normal)
        let id = pStyle
            ? wAttr(pStyle, 'val')
            : (settings && settings.defaultParagraphStyle) || null;
        let depth = 0;

        while (id && styles && typeof styles.get === 'function' && depth++ < 10) {
            const style = styles.get(id);

            if (!style) break;

            merge({ size: style.size, font: style.font });

            id = style.basedOn;
        }

        // 3) ค่าเริ่มต้นของเอกสาร
        merge({ size: defaults.size, font: defaults.font });

        return target;
    }

    // ตั้ง min-height ของย่อหน้าตามขนาดเครื่องหมายย่อหน้า (ที่มา: ดูหัวข้อเหนือฟังก์ชัน)
    function applyParagraphMarkHeights() {
        if (!host || !current || !current.pairs) return;

        const settings = current.tabSettings || {};
        const paragraphs = paragraphNodes();

        if (!paragraphs.length) return;

        current.pairs.forEach(function (pair, node) {
            const xmlParagraph = paragraphs[pair.index];

            if (!xmlParagraph) return;

            const mark = paragraphMarkFormat(xmlParagraph, settings);

            if (!mark.size) return;

            const sizePx = mark.size * 2 / 3;
            const line = paragraphLineSpacing(xmlParagraph, settings);

            // Word ใช้ระยะบรรทัดกับ "เครื่องหมายย่อหน้า" ด้วย — ย่อหน้าว่าง
            // จึงสูงเท่าระยะบรรทัดจริง (ไม่ใช่หนึ่งบรรทัดเดี่ยวเสมอ)
            // exact = สูงตามค่าที่กำหนด แม้จะเตี้ยกว่าฟอนต์ก็ตาม (Word ตัดข้อความ)
            const height = line
                ? lineSpacingHeight(line, naturalLineRatio(mark.font) * sizePx)
                : naturalLineHeight(mark.font, sizePx);

            if (!(height > 0)) return;

            const existing = parseFloat(node.style.minHeight) || 0;

            if (Math.abs(existing - height) < 0.25) return;

            node.style.minHeight = height.toFixed(2) + 'px';
        });
    }

    // ──────────────────────────────────────────────────────────────
    // ความกว้างแท็บ (w:tab) — กำหนดจาก tab stop ของแม่แบบ
    //
    // เดิมกำหนดความกว้างตายตัว (40px) ทำให้ข้อความหลังแท็บเพี้ยนจากที่ Word
    // แสดง จึงอ่าน tab stop จากไฟล์ต้นฉบับ แล้วตั้งความกว้างให้แท็บจบพอดี
    // ที่แท็บถัดไปตามที่ Word คำนวณ:
    //   - w:tabs ของย่อหน้า (word/document.xml) และ w:tabs ของ style
    //     ที่ย่อหน้าใช้ (word/styles.xml ถ่ายทอดผ่าน w:basedOn)
    //     — ตาม Word tab stop ของ style ถูกสืบทอดมารวมกับของย่อหน้า
    //       และ w:val="clear" ใช้ลบ tab stop ที่สืบทอดมา
    //   - default tab stop (word/settings.xml ค่าเริ่มต้น 720 twip = 0.5 นิ้ว)
    //     แท็บเริ่มต้นที่อยู่ทางซ้ายของ tab stop ที่ตั้งเองถูกล้างไป (ตาม Word)
    //
    // ตำแหน่ง tab stop วัดจาก “ขอบซ้ายของเนื้อหาหน้ากระดาษ” (เหมือน w:ind)
    // จึงไม่ต้องปรับอะไรเพิ่มเมื่อย่อหน้ามีเยื้องซ้าย แล้วตั้งความกว้างของ
    // <span class="layout-tab"> ให้จบพอดีที่ tab stop — วัดซ้ำทุกครั้งที่มีการ
    // พิมพ์/ซูม/รอฟอนต์โหลด (เรียกผ่าน fixRenderedLayout)
    // ──────────────────────────────────────────────────────────────

    // อ่าน attribute แบบมี namespace (fallback ให้ไฟล์ที่ไม่ประกาศ xmlns:w)
    function wAttr(node, name) {
        if (!node || !node.getAttribute) return null;

        let value = node.getAttributeNS ? node.getAttributeNS(W_NS, name) : null;

        if (value == null || value === '') value = node.getAttribute('w:' + name);
        if (value == null || value === '') value = node.getAttribute(name);

        return value == null || value === '' ? null : value;
    }

    // เก็บ tab stop จาก <w:tabs> เข้า target = { stops, clears } (ตำแหน่งเป็น px)
    function collectTabs(tabsElement, target) {
        if (!tabsElement) return;

        Array.from(tabsElement.children).forEach(function (tab) {
            if (tab.localName !== 'tab') return;

            const raw = wAttr(tab, 'pos');

            if (raw == null || !isFinite(Number(raw))) return;

            // twip → px (15 twip ต่อ px)
            const pos = Number(raw) / TWIPS_PER_PX;
            const value = wAttr(tab, 'val') || 'left';

            if (value === 'clear') {
                target.clears.push(pos);
                return;
            }

            target.stops.push({
                pos: pos,
                type: value === 'center' || value === 'right' ? value : 'left',
                leader: wAttr(tab, 'leader') || ''
            });
        });
    }

    // word/settings.xml → default tab stop (twip)
    function parseDefaultTabStop(xml) {
        const doc = xml ? parseXml(xml) : null;

        if (!doc) return DEFAULT_TAB_STOP_TWIPS;

        const node = doc.getElementsByTagNameNS(W_NS, 'defaultTabStop')[0];
        const value = node ? Number(wAttr(node, 'val')) : 0;

        return value > 0 ? value : DEFAULT_TAB_STOP_TWIPS;
    }

    // ขนาด + ฟอนต์จาก <w:rPr> (คืนเฉพาะที่มี)
    function readRPrFormat(rPr) {
        const format = { size: null, font: null };

        if (!rPr) return format;

        // Word ใช้ขนาดของอักษร complex script (szCs) กับข้อความไทย — เอาค่าที่มากกว่า
        ['sz', 'szCs'].forEach(function (name) {
            const node = elementChild(rPr, name);
            const value = node ? Number(wAttr(node, 'val')) : 0;

            if (value > 0 && value > (format.size || 0)) format.size = value;
        });

        const fonts = elementChild(rPr, 'rFonts');

        if (fonts) {
            format.font = wAttr(fonts, 'ascii') || wAttr(fonts, 'hAnsi') || null;
        }

        return format;
    }

    // word/styles.xml → Map<styleId, { basedOn, stops, clears, size, font }>
    // (tab stop / ฟอนต์-ขนาด ถูกย่อหน้าสืบทอดผ่าน w:basedOn)
    function parseStyleTabs(xml) {
        const map = new Map();
        const doc = xml ? parseXml(xml) : null;

        if (!doc) return map;

        Array.from(doc.getElementsByTagNameNS(W_NS, 'style')).forEach(function (style) {
            const id = wAttr(style, 'styleId');

            if (!id) return;

            const pPr = elementChild(style, 'pPr');
            const tabs = pPr ? elementChild(pPr, 'tabs') : null;
            const basedOn = elementChild(style, 'basedOn');
            const target = { stops: [], clears: [] };

            collectTabs(tabs, target);

            const format = readRPrFormat(elementChild(style, 'rPr'));

            const kind = wAttr(style, 'type');
            const isDefault = wAttr(style, 'default');

            map.set(id, {
                basedOn: basedOn ? wAttr(basedOn, 'val') : null,
                stops: target.stops,
                clears: target.clears,
                size: format.size,
                font: format.font,
                lineSpacing: readLineSpacing(pPr),
                type: kind || 'paragraph',
                isDefault: isDefault === '1' || isDefault === 'true'
            });
        });

        return map;
    }

    // word/styles.xml → ค่าเริ่มต้นของเอกสาร (<w:docDefaults>)
    // (ฟอนต์/ขนาดจาก rPrDefault + ระยะบรรทัดจาก pPrDefault)
    function parseStyleDefaults(xml) {
        const doc = xml ? parseXml(xml) : null;
        const node = doc ? doc.getElementsByTagNameNS(W_NS, 'docDefaults')[0] : null;
        const rPrDefault = node ? elementChild(node, 'rPrDefault') : null;
        const pPrDefault = node ? elementChild(node, 'pPrDefault') : null;
        const format = readRPrFormat(rPrDefault ? elementChild(rPrDefault, 'rPr') : null);

        format.lineSpacing = readLineSpacing(
            pPrDefault ? elementChild(pPrDefault, 'pPr') : null
        );

        return format;
    }

    // อ่านค่าแท็บจากไฟล์ .docx ครั้งเดียวต่อการเปิด (ไม่มี JSZip = ใช้ค่ามาตรฐาน)
    async function loadTabSettings(bytes) {
        const settings = {
            defaultTabStop: DEFAULT_TAB_STOP_TWIPS,
            styles: new Map()
        };

        if (!bytes || typeof JSZip === 'undefined') return settings;

        try {
            const zip = await JSZip.loadAsync(bytes);
            const settingsFile = zip.file('word/settings.xml');
            const stylesFile = zip.file('word/styles.xml');

            if (settingsFile) {
                settings.defaultTabStop = parseDefaultTabStop(
                    await settingsFile.async('string')
                );
            }

            if (stylesFile) {
                const stylesXml = await stylesFile.async('string');

                settings.styles = parseStyleTabs(stylesXml);
                settings.defaults = parseStyleDefaults(stylesXml);

                // style ย่อหน้าเริ่มต้น (w:style w:type="paragraph" w:default="1")
                settings.styles.forEach(function (style, id) {
                    if (style.isDefault && style.type === 'paragraph') {
                        settings.defaultParagraphStyle = id;
                    }
                });
            }
        } catch (error) {
            console.warn('อ่านค่า tab stop จากไฟล์ไม่ได้ (ใช้ค่ามาตรฐานแทน)', error);
        }

        return settings;
    }

    // <w:p> ทั้งเอกสารเรียงตามลำดับ — ตรงกับ listParagraphTexts
    // จึงใช้เทียบกับ pair.index ของย่อหน้าที่เรนเดอร์แล้วได้
    function paragraphNodes() {
        if (!current) return [];

        if (current.paragraphXml === current.xml && current.xmlParagraphs) {
            return current.xmlParagraphs;
        }

        const doc = current.xml ? parseXml(current.xml) : null;

        current.xmlParagraphs = doc
            ? Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))
            : [];
        current.paragraphXml = current.xml;

        return current.xmlParagraphs;
    }

    // tab stop ของ style ที่ย่อหน้าใช้ รวมทั้งสายถ่ายทอด w:basedOn
    function styleTabTarget(styleId, target, settings) {
        const styles = settings && settings.styles;

        if (!styleId || !styles || typeof styles.get !== 'function') return;

        let id = styleId;
        let depth = 0;

        while (id && depth++ < 10) {
            const style = styles.get(id);

            if (!style) break;

            style.stops.forEach(function (stop) {
                target.stops.push(stop);
            });
            style.clears.forEach(function (pos) {
                target.clears.push(pos);
            });

            id = style.basedOn;
        }
    }

    // tab stop ที่ย่อหน้าในไฟล์ต้นฉบับกำหนดไว้ (ย่อหน้า + style ที่ใช้)
    function paragraphTabTarget(xmlParagraph, settings) {
        const target = { stops: [], clears: [] };

        if (!xmlParagraph) return target;

        const pPr = elementChild(xmlParagraph, 'pPr');
        const pStyle = pPr ? elementChild(pPr, 'pStyle') : null;

        styleTabTarget(pStyle ? wAttr(pStyle, 'val') : null, target, settings);
        collectTabs(pPr ? elementChild(pPr, 'tabs') : null, target);

        return target;
    }

    function isCleared(clears, pos) {
        for (let i = 0; i < clears.length; i++) {
            if (Math.abs(clears[i] - pos) < 1) return true;
        }

        return false;
    }

    // รายการ tab stop ที่มีผลจริงของย่อหน้า (px จากขอบซ้ายของเนื้อหาหน้า):
    //   = tab stop ที่ตั้งเอง (ย่อหน้า + style) 
    //     + แท็บเริ่มต้นที่เหลืออยู่ทางขวาของ tab stop ที่ตั้งเองตัวสุดท้าย
    //       (Word ล้างแท็บเริ่มต้นทางซ้ายของ tab stop ที่ตั้งเอง)
    function tabStopList(target, stepPx, maxPx) {
        const stops = [];

        target.stops.forEach(function (stop) {
            if (!(stop.pos >= 0) || isCleared(target.clears, stop.pos)) return;

            const duplicated = stops.some(function (other) {
                return Math.abs(other.pos - stop.pos) < 1;
            });

            if (!duplicated) stops.push(stop);
        });

        stops.sort(function (a, b) {
            return a.pos - b.pos;
        });

        const lastExplicit = stops.length ? stops[stops.length - 1].pos : 0;

        if (stepPx > 0) {
            for (
                let k = Math.floor(lastExplicit / stepPx) + 1;
                k * stepPx <= maxPx + stepPx;
                k++
            ) {
                const pos = k * stepPx;

                if (isCleared(target.clears, pos)) continue;

                stops.push({ pos: pos, type: 'left', leader: '' });
            }
        }

        return stops;
    }

    // ความกว้างของข้อความหลังแท็บ (จนถึงแท็บถัดไป หรือจบย่อหน้า)
    // — ใช้กับ tab แบบ center / right ที่ต้องจัดข้อความหลังแท็บด้วย
    function segmentWidth(span, nextSpan, paragraph, scale) {
        try {
            const range = document.createRange();

            range.setStartAfter(span);
            if (nextSpan) {
                range.setEndBefore(nextSpan);
            } else {
                range.setEnd(paragraph, paragraph.childNodes.length);
            }

            const rects = range.getClientRects();
            if (!rects.length) return 0;

            // เอาเฉพาะบรรทัดแรกที่แท็บนั้นอยู่
            return rects[0].width / scale;
        } catch (error) {
            return 0;
        }
    }

    // วาดจุดนำ (w:leader) ของแท็บ — ใช้ background เพื่อไม่ให้กระทบขนาดกล่อง
    function applyLeader(span, leader) {
        span.classList.toggle('leader-dot', leader === 'dot' || leader === 'middleDot');
        span.classList.toggle('leader-hyphen', leader === 'hyphen');
        span.classList.toggle('leader-heavy', leader === 'heavy' || leader === 'underscore');
    }

    // ตั้งความกว้างของแท็บทุกอันในย่อหน้าหนึ่ง ให้จบพอดีที่ tab stop ถัดไป
    function sizeParagraphTabs(paragraph, tabs, scale, stepPx, xmlParagraphs, settings) {
        const rect = paragraph.getBoundingClientRect();
        const foreign = paragraph.closest('foreignObject');
        const section = paragraph.closest('section.docx');

        // จุดตั้งต้นของ tab stop = ขอบซ้ายของเนื้อหาหน้า (ตาม w:pgMar)
        // กล่องข้อความ (foreignObject) มีพื้นที่ของตัวเอง จึงใช้ขอบกล่องแทน
        let originScreen;

        if (foreign) {
            originScreen = foreign.getBoundingClientRect().left;
        } else if (section) {
            const sectionRect = section.getBoundingClientRect();
            const sectionStyle = window.getComputedStyle(section);
            const inset =
                (parseFloat(sectionStyle.borderLeftWidth) || 0) +
                (parseFloat(sectionStyle.paddingLeft) || 0);

            // getBoundingClientRect ถูก zoom คูณ แต่ computed style ไม่ถูกคูณ
            originScreen = sectionRect.left + inset * scale;
        } else {
            originScreen = rect.left;
        }

        // แท็บขยายได้ไม่เกินขอบขวาของย่อหน้า (ในตาราง = ขอบขวาของเซลล์)
        const limitScreen = rect.right;
        const maxPx = (limitScreen - originScreen) / scale;

        if (!(maxPx > 0) || !(stepPx > 0)) return;

        const pair = current.pairs.get(paragraph);
        const xmlParagraph = pair ? xmlParagraphs[pair.index] : null;
        const target = paragraphTabTarget(xmlParagraph, settings);
        const stops = tabStopList(target, stepPx, maxPx);

        if (!stops.length) return;

        // รอบที่ 1 คำนวณทุกแท็บ / รอบที่ 2 ปรับซ้ำ — ย่อหน้าที่จัดกลาง/ขวา
        // พอความกว้างเปลี่ยน บรรทัดจะขยับตาม ทำให้ตำแหน่งแท็บเดิมเพี้ยน
        for (let pass = 0; pass < 2; pass++) {
            tabs.forEach(function (span, index) {
                const spanRect = span.getBoundingClientRect();

                // แท็บที่อยู่ชิดขอบซ้ายของหน้าพอดี ค่าจะติดลบเล็กน้อย
                // จากคลาดเคลื่อนของเลขทศนิยม — คิดเป็น 0 (ส่วน NaN ให้ข้ามไว้ล่าง)
                const x = Math.max(0, (spanRect.left - originScreen) / scale);

                if (!(x >= 0)) return;

                let start = -1;
                for (let i = 0; i < stops.length; i++) {
                    if (stops[i].pos > x + 0.5) {
                        start = i;
                        break;
                    }
                }

                if (start < 0) start = stops.length - 1;

                const limit = Math.max(0, (limitScreen - spanRect.left) / scale);
                let segment = -1;
                let width = -1;
                let chosen = stops[start];

                for (let i = start; i < stops.length; i++) {
                    const stop = stops[i];
                    let value;

                    if (stop.type === 'center' || stop.type === 'right') {
                        if (segment < 0) {
                            segment = segmentWidth(span, tabs[index + 1], paragraph, scale);
                        }
                        value = stop.type === 'center'
                            ? stop.pos - segment / 2 - x
                            : stop.pos - segment - x;
                    } else {
                        value = stop.pos - x;
                    }

                    // แท็บที่ได้ความกว้างติดลบ = เกินขอบ ลองแท็บถัดไปแทน
                    if (value >= -0.5) {
                        width = Math.min(value, limit);
                        chosen = stop;
                        break;
                    }
                }

                if (width < 0) width = 0;

                const rounded = Math.round(width * 100) / 100;
                const currentWidth = parseFloat(span.style.width) || 0;

                if (Math.abs(currentWidth - rounded) > 0.25) {
                    span.style.width = rounded + 'px';
                }

                applyLeader(span, chosen.leader || '');
            });
        }
    }

    // แท็บถูกครอบด้วย <span> ของ run อีกชั้น (decorateSpecials ใส่คลาสให้ทั้งคู่)
    // — ตั้งความกว้างเฉพาะแท็บตัวในสุด ตัวครอบจะขยายตามเนื้อหาเอง
    function wrapsTab(span) {
        return Array.from(span.querySelectorAll('span')).some(function (inner) {
            return inner.classList.contains('layout-tab') || isTabSpan(inner);
        });
    }

    // ความกว้างของแท็บทุกอันในเอกสาร — คำนวณจาก tab stop ของแม่แบบ
    function applyTabStops() {
        if (!host || !current) return;

        const wrapper = host.querySelector('.docx-wrapper');
        const scale = wrapper ? Number(wrapper.style.zoom) || 1 : 1;
        const settings = current.tabSettings || {
            defaultTabStop: DEFAULT_TAB_STOP_TWIPS,
            styles: new Map()
        };
        const stepPx =
            (Number(settings.defaultTabStop) || DEFAULT_TAB_STOP_TWIPS) / TWIPS_PER_PX;

        // กวาด span ทั้งเอกสารครั้งเดียว แล้วจับกลุ่มตามย่อหน้าที่มันอยู่
        const groups = new Map();
        host.querySelectorAll('article span').forEach(function (span) {
            if (!span.classList.contains('layout-tab') && !isTabSpan(span)) return;
            if (wrapsTab(span)) return;

            const paragraph = span.closest('p');

            if (!paragraph || !host.contains(paragraph)) return;

            if (!groups.has(paragraph)) groups.set(paragraph, []);

            groups.get(paragraph).push(span);
        });

        if (!groups.size) return;

        const xmlParagraphs = paragraphNodes();

        groups.forEach(function (tabs, paragraph) {
            sizeParagraphTabs(paragraph, tabs, scale, stepPx, xmlParagraphs, settings);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // ย่อหน้าแบบ "กระจายตัวอักษร" ของ Word (w:jc val=thaiDistribute)
    //
    // Word ยืดระยะระหว่างตัวอักษรของทุกบรรทัด (ยกเว้นบรรทัดสุดท้าย) ให้เต็ม
    // ความกว้างของย่อหน้า แต่เบราว์เซอร์จัดเป็นชิดซ้ายธรรมดา ข้อความบรรทัด
    // เดียวกันจึงจบก่อนขอบขวา และทุกอย่างทางขวา (รวมแท็บ) เหลื่อมจาก Word
    // มาก — แม่แบบในโปรเจกต์นี้ตั้งค่านี้ไว้กว่า 70 ย่อหน้าต่อไฟล์
    //
    // วิธีทำ: วัดความกว้างจริงของแต่ละบรรทัด แล้วยืดด้วย letter-spacing
    // เฉพาะบรรทัดนั้น (Word ยืดแบบ inter-character จึงเทียบได้ตรง)
    // ──────────────────────────────────────────────────────────────

    // ย่อหน้านี้ตั้ง w:jc เป็น thaiDistribute หรือไม่
    function isThaiDistribute(xmlParagraph) {
        if (!xmlParagraph) return false;

        const pPr = elementChild(xmlParagraph, 'pPr');
        const jc = pPr ? elementChild(pPr, 'jc') : null;

        return !!jc && wAttr(jc, 'val') === 'thaiDistribute';
    }

    // text node ที่เป็น "เนื้อความ" ของย่อหน้า (ข้ามแท็บ/สัญลักษณ์ที่เรนเดอร์เอง)
    function paragraphTextNodes(paragraph) {
        const nodes = [];
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, null, false);
        let node;

        while ((node = walker.nextNode()) !== null) {
            const parent = node.parentElement;

            if (!parent || !node.data) continue;
            if (isSpecialSpan(parent)) continue;

            nodes.push(node);
        }

        return nodes;
    }

    // อักขระ/ช่วงอักขระ อยู่ "บรรทัดเดียวกัน" หรือไม่
    //
    // เทียบขอบบนของกล่องตรง ๆ ไม่ได้ เพราะบรรทัดเดียวในเอกสารมักมี run หลายขนาด
    // (ตัวอย่างจริง: "เรื่อง" 20pt + เนื้อความ 16pt) ตัวใหญ่กล่องเริ่มสูงกว่า
    // ขอบบนต่างกันถึง 4px → ย่อหน้าบรรทัดเดียวถูกตัดเป็นหลาย "บรรทัด" แล้ว
    // ยืดตัวอักษรผิด ๆ (ระยะห่างเป็นร้อย px) จนข้อความตกไปบรรทัดถัดไป
    //
    // กล่องของอักขระ = ascent–descent ของฟอนต์ที่ขนาดนั้น เมื่อจุดอ้างอิงเดียวกัน
    // (baseline เดียวกัน) จุดกึ่งกลางกล่องจึงต่างกันไม่กี่ px ส่วนคนละบรรทัด
    // ห่างกันเท่าระยะบรรทัด (20px+) จึงเทียบที่จุดกึ่งกลาง และยอมให้ต่างได้
    // ไม่เกินครึ่งของกล่องที่เตี้ยกว่า
    function sameLine(box, line) {
        const lineHeight = line.bottom - line.top;
        const boxHeight = box.bottom - box.top;

        if (!(lineHeight > 0) || !(boxHeight > 0)) return false;

        const tolerance = Math.min(lineHeight, boxHeight) / 2;

        return Math.abs((box.top + box.bottom) / 2 - (line.top + line.bottom) / 2) <= tolerance;
    }

    // ตำแหน่งของอักขระทุกตัวในย่อหน้า จัดกลุ่มเป็น "บรรทัด"
    // คืนรายการบรรทัด: { top, bottom, left, right, chars: [{node, start, end}] }
    function paragraphLines(paragraph) {
        const nodes = paragraphTextNodes(paragraph);
        const lines = [];

        nodes.forEach(function (node) {
            const text = node.data || '';
            let index = 0;

            while (index < text.length) {
                // จับช่วงอักขระที่อยู่บรรทัดเดียวกันด้วย rect ต่ออักขระ
                // (1 อักขระ = 1 ช่วงสั้น ๆ — ต้องรู้ว่า "บรรทัดนี้มีอักขระใด")
                const start = index;
                let end = index;
                let line = null;
                let left = Infinity;
                let right = -Infinity;

                while (end < text.length) {
                    const range = document.createRange();

                    range.setStart(node, end);
                    range.setEnd(node, end + 1);

                    const rect = range.getBoundingClientRect();

                    // อักขระที่ไม่มีความสูง (วัดไม่ได้) ไม่มีผลต่อบรรทัด
                    if (!(rect.height > 0)) {
                        end++;
                        continue;
                    }

                    if (line === null) {
                        line = { top: rect.top, bottom: rect.bottom };
                    } else if (!sameLine(rect, line)) {
                        break;
                    } else {
                        if (rect.top < line.top) line.top = rect.top;
                        if (rect.bottom > line.bottom) line.bottom = rect.bottom;
                    }

                    if (rect.left < left) left = rect.left;
                    if (rect.right > right) right = rect.right;
                    end++;
                }

                if (end === start) break;

                lines.push({
                    top: line === null ? 0 : line.top,
                    bottom: line === null ? 0 : line.bottom,
                    left: left === Infinity ? 0 : left,
                    right: right === -Infinity ? 0 : right,
                    chars: [{ node: node, start: start, end: end }]
                });

                index = end;
            }
        });

        // รวมช่วงที่อยู่บรรทัดเดียวกัน (มาจากคนละ text node)
        const merged = [];

        lines.forEach(function (line) {
            const last = merged[merged.length - 1];

            if (last && sameLine(line, last)) {
                last.chars.push(line.chars[0]);
                last.left = Math.min(last.left, line.left);
                last.right = Math.max(last.right, line.right);
                last.top = Math.min(last.top, line.top);
                last.bottom = Math.max(last.bottom, line.bottom);
                return;
            }

            merged.push(line);
        });

        return merged;
    }

    // ยืดบรรทัดของย่อหน้าให้เต็มความกว้างเนื้อหา (เทียบเท่า thaiDistribute)
    function stretchParagraphLines(paragraph, scale) {
        const style = window.getComputedStyle(paragraph);
        const rect = paragraph.getBoundingClientRect();
        const border = parseFloat(style.borderRightWidth) || 0;
        const padding = parseFloat(style.paddingRight) || 0;
        const contentRight = rect.right - (border + padding) * scale;
        const lines = paragraphLines(paragraph);

        if (lines.length < 2) return;

        // เก็บงานทุกบรรทัดไว้ก่อน แล้วค่อยแก้ DOM ทีหลัง
        //
        // สำคัญ: ต้องแก้ "จากท้ายไปหน้า" เพราะการตัด text node (splitText)
        // ที่ตำแหน่งสูงกว่าไม่กระทบ offset ที่ต่ำกว่า แต่ถ้าทำจากหน้าไปหลัง
        // offset ของ text node เดียวกันจะเพี้ยนทันที
        const jobs = [];

        lines.forEach(function (line, index) {
            // บรรทัดสุดท้ายของย่อหน้าไม่ถูกยืด — ตรงกับ Word
            if (index === lines.length - 1) return;

            const count = line.chars.reduce(function (sum, part) {
                return sum + (part.end - part.start);
            }, 0);
            const target = contentRight - line.left;
            const natural = line.right - line.left;

            if (!(count > 0) || !(target > 0) || natural >= target - 0.1) return;

            // ค่าเริ่มต้น: เกลี่ยส่วนที่ขาดให้ทุกอักขระเท่ากัน (ปัดลงเสมอ —
            // ถ้าปัดขึ้นบรรทัดจะยาวเกินขอบแล้วตัดบรรทัดใหม่)
            const spacing = Math.floor((target - natural) / count * 100) / 100 / scale;

            if (window.__distDebug) {
                console.log('DIST ' + JSON.stringify(paragraph.textContent.slice(0, 24)) +
                    ' line=' + index + ' count=' + count +
                    ' natural=' + Math.round(natural * 100) / 100 +
                    ' target=' + Math.round(target * 100) / 100 +
                    ' spacing=' + spacing);
            }

            if (!(spacing > 0)) return;

            line.chars.forEach(function (part) {
                jobs.push({
                    node: part.node,
                    start: part.start,
                    end: part.end,
                    line: index,
                    spacing: spacing
                });
            });
        });

        applyDistJobs(jobs);

        // ── จังหวะที่ 2: วัดผลจริงแล้วแก้ให้พอดีเป้า ──
        //
        // การเกลี่ยในจังหวะแรกไม่เคยพอดี เพราะอักขระบางตัวไม่กว้าง
        // (ตัวควบคุม อักขระรวมรูป) แต่ letter-spacing ก็นับมันด้วย
        // และช่องว่างท้ายบรรทัดถูกตัดทิ้งเมื่อวัดความกว้าง
        // จึงวัดความกว้างที่ได้จริง แล้วขยายระยะตามสัดส่วนที่ขาด
        const after = paragraphLines(paragraph);

        after.forEach(function (line, index) {
            if (index === lines.length - 1) return;

            const target = contentRight - line.left;
            const width = line.right - line.left;
            const natural = lines[index] ? lines[index].right - lines[index].left : 0;
            const added = width - natural;

            if (!(target > 0) || !(width > 0) || !(added > 0)) return;

            const factor = (target - natural) / added;

            if (!(factor > 1) || factor > 6) return;

            paragraph.querySelectorAll('span.layout-thai-dist[data-line="' + index + '"]')
                .forEach(function (span) {
                    const spacing = parseFloat(span.style.letterSpacing) || 0;

                    if (!(spacing > 0)) return;

                    // ปัดลง — กันไม่ให้เกินขอบแล้วตัดบรรทัดใหม่
                    span.style.letterSpacing =
                        (Math.floor(spacing * factor * 100) / 100).toFixed(2) + 'px';
                });
        });
    }

    // ห่อช่วงอักขระด้วย span ที่กำหนดระยะตัวอักษร
    //
    // ต้องทำ "จากท้ายไปหน้า" เพราะการตัด text node (splitText) ที่ตำแหน่งสูงกว่า
    // ไม่กระทบ offset ที่ต่ำกว่า แต่ถ้าทำจากหน้าไปหลัง offset ของ node เดียวกันจะเพี้ยน
    function applyDistJobs(jobs) {
        for (let i = jobs.length - 1; i >= 0; i--) {
            const job = jobs[i];
            const span = document.createElement('span');

            span.className = 'layout-thai-dist';
            span.dataset.line = String(job.line);

            // ต้องบอกให้สืบทอดรูปแบบจากรันที่ห่ออยู่เอง
            //
            // docx-preview ตั้งค่าเริ่มต้นของเอกสารไว้เป็นกฎที่จับ span ทุกตัว
            // (.docx span { font-family: <ฟอนต์เริ่มต้นของเอกสาร>; font-size: 11pt })
            // กฎที่จับ "ตัว span เองโดยตรง" ชนะค่าที่สืบทอดมาจากแม่เสมอ — ต่อให้
            // แม่มีฟอนต์เป็นสไตล์ในบรรทัดก็ตาม span ที่เราสร้างจึงกลายเป็นฟอนต์/ขนาด
            // เริ่มต้นของเอกสาร (ไม่ใช่ของรัน) ทำให้ข้อความในย่อหน้า thaiDistribute
            // ทั้งย่อหน้าหน้าตาต่างจากย่อหน้าอื่น
            span.style.font = 'inherit';

            span.style.letterSpacing = job.spacing.toFixed(2) + 'px';

            // ห่อในที่เดิม — ย้ายออกจาก run แม่ไม่ได้ เพราะจะเสียรูปแบบ
            let node = job.node;

            if (job.end < node.data.length) node.splitText(job.end);
            if (job.start > 0) node = node.splitText(job.start);

            node.parentNode.insertBefore(span, node);
            span.appendChild(node);
        }
    }

    // ย่อหน้าที่ Word กระจายตัวอักษร (เรียกซ้ำได้ — เคลียร์ของเดิมก่อน)
    function applyThaiDistribute() {
        if (!host || !current) return;

        const wrapper = host.querySelector('.docx-wrapper');
        const scale = wrapper ? Number(wrapper.style.zoom) || 1 : 1;

        // คืน DOM ก่อนยืดรอบก่อน (การวัดต้องเริ่มจากความกว้างธรรมชาติ)
        host.querySelectorAll('span.layout-thai-dist').forEach(function (span) {
            const parent = span.parentNode;

            while (span.firstChild) parent.insertBefore(span.firstChild, span);

            parent.removeChild(span);
        });

        const xmlParagraphs = paragraphNodes();

        host.querySelectorAll('article p').forEach(function (paragraph) {
            const pair = current.pairs ? current.pairs.get(paragraph) : null;

            if (!pair) return;
            if (!isThaiDistribute(xmlParagraphs[pair.index])) return;

            stretchParagraphLines(paragraph, scale);
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

                // เครื่องหมายที่เราวาดเพิ่ม (applyXmlMarks) = ไม่มีอักขระของตัวเอง
                if (child.dataset && child.dataset.layoutMark === '1') continue;

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

    // ──────────────────────────────────────────────────────────────
    // กล่องข้อความ (text box) — 1 กล่อง = 1 ช่องแก้ไข
    //
    // เอกสารทั้งหมดรวมเป็นช่อง input เดียว (ดู prepareEditing)
    // ยกเว้นกล่องข้อความที่ยังแยกเป็นกล่องของตัวเองตามแบบ docx
    //
    // docx-preview วาดกล่องข้อความเป็น <p> หลายอันเรียงใน <foreignObject>
    // จึงห่อ <p> ของทั้งกล่องด้วย <div> หนึ่งอัน → 1 กล่อง = 1 ช่อง
    // (ตั้ง contentEditable ที่ตัว foreignObject เองไม่ได้ — SVG element ไม่รับ)
    // ──────────────────────────────────────────────────────────────
    function textboxRegion(paragraph) {
        const foreign = paragraph.closest ? paragraph.closest('foreignObject') : null;

        if (!foreign) return null;

        const existing = Array.from(foreign.children).find(function (child) {
            return child.dataset && child.dataset.layoutTextBox === '1';
        });

        if (existing) return existing;

        const wrapper = document.createElement('div');
        wrapper.className = 'layout-text-box layout-edit';
        wrapper.dataset.layoutTextBox = '1';
        wrapper.contentEditable = 'false';

        while (foreign.firstChild) wrapper.appendChild(foreign.firstChild);
        foreign.appendChild(wrapper);

        return wrapper;
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

        // ── ช่องแก้ไขหลัก — ทั้งเอกสารเป็นช่อง input เดียว ──
        // ย่อหน้าทั่วไปจึงไม่ได้ช่องของตัวเอง (ไม่ตั้ง contentEditable ต่อรายการ)
        // สืบทอดจากช่องนี้แทน — ยกเว้นกล่องข้อความที่มีช่องของตัวเอง
        const canvas = host.querySelector('.docx-wrapper') || host;
        canvas.classList.add('layout-edit');
        canvas.contentEditable = editable ? 'true' : 'false';

        nodes.forEach(function (node) {
            const pair = pairs.get(node);
            const text = cleanText(renderedText(node));
            const fields = fieldNames(text);

            // ย่อหน้าในกล่องข้อความ = อยู่ในช่องของกล่อง (1 กล่อง = 1 ช่อง)
            const region = textboxRegion(node);

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

            // ย่อหน้าทั่วไปไม่ตั้ง contentEditable — สืทธิ์แก้ไขสืบทอดจากช่องหลัก
            // (ช่องของกล่องข้อความถูกตั้งทีหลัง ดูด้านล่าง)
            if (region === null && !editable) {
                node.contentEditable = 'false';
            }

            if (fields.length > 0) {
                node.title = 'field: ' + fields.join(', ');
            }
        });

        // ช่องของกล่องข้อความ — 1 กล่อง = 1 ช่อง แยกจากช่องหลัก
        host.querySelectorAll('[data-layout-text-box]').forEach(function (region) {
            region.contentEditable = editable ? 'true' : 'false';
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

        if (!paragraph) return null;

        // อยู่ในกล่องข้อความ → ย่อหน้าต้องอยู่ "ใน" กล่องนั้น
        // (ไม่งั้นจะได้ย่อหน้าแม่ที่ครอบกล่อง ซึ่งไม่ใช่ย่อหน้าที่พิมพ์อยู่)
        const box = element.closest('[data-layout-text-box]');

        if (box && !box.contains(paragraph)) return null;

        // ย่อหน้าทั่วไปไม่มี contenteditable ของตัวเอง (สืทธิ์จากช่องหลัก)
        // จึงใช้ค่าที่ใช้งานจริง ไม่ใช่ค่าใน attribute
        return paragraph.isContentEditable ? paragraph : null;
    }

    // ย่อหน้าที่อักขระ (caret) อยู่จริง
    //
    // event.target ของ input ใน contenteditable คือ "ตัวช่อง" (editing host)
    // ไม่ใช่ <p> ที่พิมพ์อยู่ — ถ้าใช้ event.target จะไปนับย่อหน้าแม่ผิด
    function caretParagraph() {
        const selection = document.getSelection();

        return selection && selection.anchorNode
            ? paragraphOf(selection.anchorNode)
            : null;
    }

    function touchParagraph(paragraph) {
        if (paragraph) touched.add(paragraph);
    }

    function setBusy(busy) {
        ['layoutSaveBtn', 'layoutDownloadBtn', 'layoutResetBtn', 'layoutReplaceFileBtn'].forEach(function (id) {
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

    // silent = true : บันทึกเลยไม่ต้องยืนยัน (เรียกหลังผู้ใช้ยืนยันมาแล้ว)
    // คืน true เมื่อบันทึกสำเร็จ
    async function save(silent) {
        if (!current || !current.payload.save) return false;

        const edits = collectEdits(false);
        const changed = edits.texts.length + edits.formats.length;

        if (changed === 0) {
            setStatus('ยังไม่มีการแก้ไข');
            return false;
        }

        const name = current.payload.name || 'แม่แบบนี้';

        if (!silent && !(await scope.AppDialog.confirm(
            'บันทึกทับไฟล์ต้นฉบับของ "' + name + '"?\n\n' +
            'บันทึก: ' + editSummary(edits) + '\n' +
            'ค่า type / ล็อกตำแหน่ง / placeholder / ตาราง ของ field ที่ยังมีอยู่จะถูกเก็บไว้\n' +
            'ต้องการบันทึกหรือไม่?',
            { title: 'ยืนยันการบันทึก', okText: 'บันทึก' }
        ))) {
            return false;
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

            return true;

        } catch (error) {
            console.error(error);
            setStatus('บันทึกไม่สำเร็จ: ' + messageOf(error), 'error');

            return false;
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
    // อัปโหลดไฟล์ใหม่ทับไฟล์เดิม
    // ──────────────────────────────────────────────────────────────

    // ปุ่มในแถบเครื่องมือเปิดช่องเลือกไฟล์ (input ถูกซ่อนไว้)
    function openReplacePicker() {
        const input = el('layoutReplaceFileInput');
        if (input) input.click();
    }

    // เลือกไฟล์แล้ว: ยืนยัน → ให้ app.js เขียนทับในฐานข้อมูล → เรนเดอร์ไฟล์ใหม่
    // การเขียนฐานข้อมูลอยู่ใน app.js (ตัวนี้ไม่รู้จัก Db) ผ่าน payload.replaceFile
    async function onReplaceFileChosen(event) {
        const input = event.target;
        const file = input.files && input.files[0];

        // ล้างค่าทันที เพื่อให้เลือกไฟล์เดิมซ้ำได้ (และเมื่อกดยกเลิกในกล่องยืนยัน)
        input.value = '';

        if (!file || !current) return;

        const payload = current.payload || {};

        if (typeof payload.replaceFile !== 'function') {
            setStatus('หน้านี้ยังแทนที่ไฟล์ไม่ได้', 'warn');
            return;
        }

        const pending = pendingEdits();

        if (!(await scope.AppDialog.confirm(
            'ยืนยันการแทนที่ไฟล์?\n\n' +
            'ไฟล์ต้นฉบับของ "' + (payload.name || 'แม่แบบนี้') +
            '" จะถูกทับด้วย "' + (file.name || 'ไฟล์ใหม่') + '" ทันที\n' +
            'ค่า type / ล็อกตำแหน่ง / placeholder / ตาราง ของ field ' +
            'ที่มีอยู่ทั้งสองไฟล์จะถูกเก็บไว้\n' +
            (pending > 0
                ? 'ข้อความที่แก้ค้างในหน้านี้ ' + pending + ' จุดจะถูกทิ้งไป\n'
                : '') +
            'ต้องการดำเนินการต่อหรือไม่?',
            { title: 'ยืนยันการแทนที่ไฟล์', okText: 'แทนที่ไฟล์', danger: true }
        ))) {
            return;
        }

        setBusy(true);
        setStatus('กำลังแทนที่ไฟล์...');

        let bytes = null;
        let xml = '';

        try {
            const data = new Uint8Array(await file.arrayBuffer());
            const result = await payload.replaceFile(data, file.name || '');

            bytes = (result && result.bytes) || data;
            xml = (result && result.xml) || '';
        } catch (error) {
            console.error(error);
            setBusy(false);

            // error.expected = ไฟล์ที่อ่านได้แต่ไม่ใช่ .docx ที่ใช้ได้ (ข้อความไทยพร้อมใช้)
            // ที่เหลือคือไฟล์เปิดเป็น zip ไม่ได้ เช่น .docx เสียหาย หรือส่งไฟล์ผิดนามสกุลมา
            setStatus(
                'แทนที่ไฟล์ไม่สำเร็จ: ' +
                (error && error.expected
                    ? error.message
                    : 'อ่านไฟล์ DOCX ไม่ได้'),
                'error'
            );

            return;
        }

        // ย่อหน้าที่แก้ค้าง / ผลค้นหา / คู่ TextNode ของไฟล์เดิมไม่มีความหมายกับไฟล์ใหม่
        touched = new Set();
        findMatches = [];
        findIndex = -1;
        current.pairs = new Map();
        current.xml = xml;

        await renderDocx(bytes);
        setBusy(false);

        setStatus(
            'แทนที่ไฟล์ต้นฉบับแล้ว — ' + (file.name || 'ไฟล์ใหม่'),
            'ok'
        );
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

    // ──────────────────────────────────────────────────────────────
    // รูปทรง (shape) — กล่อง / เส้น
    //
    // Word เก็บรูปทรงไว้ 2 ชุดใน mc:AlternateContent
    //   mc:Choice   = w:drawing/wp:anchor/wps:wsp ← ที่ Word ใช้วาดจริง
    //                 (มี prstGeom = ชนิดรูปทรง, solid／noFill = สีพื้น, a:ln = เส้นขอบ)
    //   mc:Fallback = w:pict/v:shape|v:rect|v:line ← ที่ docx-preview วาด
    //
    // docx-preview รู้จักแต่ pic:pic จึงข้าม wps:wsp ทั้งก้อน — ข้อความในกล่องยัง
    // แสดง (มาจากสาขา VML) แต่สาขา VML ที่ Word สร้างมาอาจบอกว่า
    // filled="f" stroked="f" = โปร่งใส → กล่องที่มีสีพื้น/เส้นขอบจริงใน Word หายไป
    // (เห็นแต่ข้อความลอย ๆ) และเส้น v:line ไม่มีสี → มองไม่เห็นเลย
    //
    // ตรงนี้จึงอ่านสไตล์จริงจากสาขา Choice แล้วใส่ให้ซอง SVG ที่ตัวเรนเดอร์สร้างไว้
    // จับคู่ตามลำดับในเอกสาร — จำนวนไม่ตรง = ไม่กล้าแก้ ปล่อยไว้แล้วเตือน
    // ──────────────────────────────────────────────────────────────

    function elementChild(node, name) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 1 && child.localName === name) return child;
        }

        return null;
    }

    // สีจาก DrawingML — คืน null เมื่อปิดสีไว้ (a:noFill) หรือไม่ระบุ
    // ตรวจ noFill/solidFill เฉพาะลูกโดยตรง เพราะ a:ln มี solidFill/noFill เป็นของตัวเอง
    function drawingColor(container) {
        if (!container) return null;

        if (elementChild(container, 'noFill')) return null;

        const solid = elementChild(container, 'solidFill');

        if (!solid) return null;

        const srgb = solid.getElementsByTagNameNS(A_NS, 'srgbClr')[0];

        if (srgb) return '#' + String(srgb.getAttribute('val') || '').replace(/^#/, '');

        const scheme = solid.getElementsByTagNameNS(A_NS, 'schemeClr')[0];

        if (scheme) return THEME_COLORS[scheme.getAttribute('val')] || null;

        const system = solid.getElementsByTagNameNS(A_NS, 'sysClr')[0];

        if (system) {
            const last = system.getAttribute('lastClr');

            if (last) return '#' + String(last).replace(/^#/, '');

            return system.getAttribute('val') === 'window' ? '#FFFFFF' : '#000000';
        }

        return null;
    }

    // สไตล์รูปทรงทุกอันจากสาขา Choice เรียงตามลำดับในเอกสาร
    // (เฉพาะรูปทรงที่ Word เก็บเป็น wps:wsp — รูปภาพถูกข้าม)
    function shapeStyles(xml) {
        const doc = parseXml(xml);

        if (!doc) return null;

        const list = [];

        Array.from(doc.getElementsByTagNameNS(MC_NS, 'AlternateContent')).forEach(
            function (alternate) {
                const choice = elementChild(alternate, 'Choice');
                const wsp = choice
                    ? choice.getElementsByTagNameNS(WPS_NS, 'wsp')[0]
                    : null;

                if (!wsp) return;

                const props = wsp.getElementsByTagNameNS(WPS_NS, 'spPr')[0];
                const geom = props
                    ? props.getElementsByTagNameNS(A_NS, 'prstGeom')[0]
                    : null;
                const line = props
                    ? props.getElementsByTagNameNS(A_NS, 'ln')[0]
                    : null;
                const rawWidth = line ? Number(line.getAttribute('w')) : 0;

                list.push({
                    geometry: geom ? String(geom.getAttribute('prst') || '') : '',
                    fill: props ? drawingColor(props) : null,
                    lineColor: line ? drawingColor(line) : null,
                    // ค่าตั้งต้นของเส้นใน DrawingML = 9525 EMU (1px)
                    lineWidth: isFinite(rawWidth) && rawWidth > 0
                        ? rawWidth / EMU_PER_PX
                        : 1
                });
            }
        );

        return list;
    }

    // ซอง SVG ของรูปทรงที่ตัวเรนเดอร์วาดไว้ เรียงตามลำดับในเอกสาร
    // ตัด svg ที่เป็น "รูปภาพ" (VML image) ออก เพราะไม่ใช่รูปทรง
    function vmlShapeSvgs() {
        return Array.from(host.querySelectorAll('article svg'))
            .filter(function (svg) {
                return svg.querySelector('image') === null;
            });
    }

    // ตั้งขนาดซอง SVG จากเนื้อหาข้างใน เมื่อตัวเรนเดอร์วัดไม่ได้
    //
    // ตัวเรนเดอร์ตั้ง width/height ให้ซอง SVG ใน requestAnimationFrame ด้วย getBBox()
    // ของลูกตัวแรก แต่ตอนเปิดหน้าจัดตำแหน่ง getBBox() คืน 0 (กล่องเพิ่งเข้า DOM
    // / ตอนวัดยังไม่ถูกจัดวาง) → width/height เป็น 0 ค้างไว้
    //
    // กล่องข้อความยังรอดเพราะสไตล์ VML มี width/height เป็น pt อยู่ในตัว
    // แต่ v:line ไม่มี → ซองเป็น 0×0 → เส้นถูกตัดหายทั้งเส้น
    function sizeShapeFromContent(element) {
        if (!element.getBBox) return;

        const content = element.firstElementChild;

        if (!content || !content.getBBox) return;

        const width = Number(element.getAttribute('width'));
        const height = Number(element.getAttribute('height'));

        // ตัวเรนเดอร์วัดได้แล้ว = ใช้ค่านั้น ไม่ต้องยุ่ง
        if (width > 0 && height > 0) return;

        let box = null;

        try {
            box = content.getBBox();
        } catch (error) {
            return;
        }

        if (!box || !(box.width > 0 || box.height > 0)) return;

        // เหมือนกับที่ตัวเรนเดอร์ทำ: ขอบซอง = bbox.x + ความกว้าง (attribute นี้ถูก
        // สไตล์ width ของ VML ทับอยู่แล้วสำหรับกล่องข้อความ จึงไม่ทำให้กล่องเดิมเปลี่ยน)
        element.setAttribute('width', String(Math.ceil(box.x + box.width)));
        element.setAttribute('height', String(Math.ceil(box.y + box.height)));
    }

    function applyShapeStyle(element, style) {
        // ขนาดซองต้องมาก่อน ไม่งั้นรูปทรงที่ไม่มีสไตล์ width (เส้น) จะมองไม่เห็น
        sizeShapeFromContent(element);

        // เส้น — ตัวเรนเดอร์วาด <line> ไว้แล้วแต่ไม่มีสี (VML ไม่ได้บอกสี)
        if (style.geometry === 'line') {
            const line = element.querySelector('line');

            if (!line) return;

            const color = style.lineColor || '#000000';

            line.setAttribute('stroke', color);
            line.setAttribute('stroke-width', Math.max(style.lineWidth, 1).toFixed(2));

            // กันส่วนปลายเส้นถูกตัดเผื่อกรณีขนาดซองยังไม่พอดี
            element.style.overflow = 'visible';
            return;
        }

        const radius = BOX_GEOMETRY[style.geometry];

        if (radius === undefined) return;   // ชนิดอื่นยังไม่รองรับ — ปล่อยตามเดิม

        if (style.fill) element.style.background = style.fill;

        if (style.lineColor) {
            // Word วาดเส้นขอบ "ในกรอบ" ของรูปทรง — border-box จึงไม่ทำกล่องโตขึ้น
            element.style.boxSizing = 'border-box';
            element.style.border =
                Math.max(style.lineWidth, 1).toFixed(2) + 'px solid ' + style.lineColor;
        }

        if (radius) element.style.borderRadius = radius;
    }

    // ใส่สีพื้น/เส้นขอบจากสาขา DrawingML ให้รูปทรงที่แสดงอยู่
    function renderShapes() {
        if (!current || !current.xml || !host) return;

        const styles = shapeStyles(current.xml);

        if (!styles || styles.length === 0) return;

        const shapes = vmlShapeSvgs();

        // จำนวนไม่ตรง = จับคู่รูปทรงมั่นใจไม่ได้ จึงไม่แตะเลย (ปลอดภัยกว่าแก้ผิดรูปทรง)
        if (shapes.length !== styles.length) {
            console.warn(
                'จัดรูปแบบรูปทรง: จำนวนในไฟล์ (' + styles.length +
                ') ไม่ตรงกับที่แสดง (' + shapes.length +
                ') จึงไม่ปรับสีพื้น/เส้นขอบ'
            );

            return;
        }

        styles.forEach(function (style, index) {
            applyShapeStyle(shapes[index], style);
        });
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

    // ──────────────────────────────────────────────────────────────
    // ดึงกล่องข้อความให้อยู่ "แถวเดียวกัน" กับบรรทัดข้อความปกติ
    //
    // คนวางกล่องข้อความใน Word ด้วยมือมักเหลื่อมแนวตั้งจากบรรทัดข้าง ๆ
    // ไม่กี่ px ทั้งที่ตั้งใจให้อยู่บรรทัดเดียวกัน ที่นี่จึงวัดบรรทัดจริงบนจอ:
    // ถ้าบรรทัดแรกในกล่องห่างจากบรรทัดข้อความเป้าหมายไม่เกินครึ่งความสูงบรรทัด
    // ก็เลื่อนกล่องให้บรรทัดแรกไปตรงแถวนั้น
    //
    // วัด "บรรทัดแรกในกล่อง" จากกล่องบรรทัดที่เรนเดอร์จริง (getClientRects)
    // จึงไม่ขึ้นกับ padding ภายในกล่อง และเลื่อนกล่องเท่าที่ต่างจริง
    // วัตถุที่อ้างแนวตั้งจากหน้า/ขอบกระดาษ (ลายน้ำ/รูปหัวกระดาษ) ไม่ถูกดึง
    // ──────────────────────────────────────────────────────────────

    // ข้อความนี้อยู่ในย่อหน้า/กล่องข้อความที่ซ้อนอยู่ใน element หรือไม่
    // (ใช้ตัดข้อความของกล่องข้อความลอยออกจากการวัดบรรทัดของย่อหน้าแม่)
    function insideNestedParagraph(node, element) {
        let parent = node.parentElement;

        while (parent && parent !== element) {
            if (parent.localName === 'p') return true;
            if (parent.localName === 'foreignObject') return true;
            if (parent.dataset && parent.dataset.layoutTextBox === '1') return true;

            parent = parent.parentElement;
        }

        return false;
    }

    // กล่องบรรทัด (px บนจอ ถูกคูณ zoom แล้ว) ของข้อความที่อยู่ใน element ตรง ๆ
    function directTextRects(element) {
        const rects = [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);

        let node;

        while ((node = walker.nextNode()) !== null) {
            const value = node.textContent || '';

            if (value.replace(/\s+/g, '') === '') continue;
            if (insideNestedParagraph(node, element)) continue;

            try {
                const range = document.createRange();
                range.selectNodeContents(node);

                Array.from(range.getClientRects()).forEach(function (rect) {
                    if (rect.height > 0) rects.push(rect);
                });
            } catch (error) {
                // วัดไม่ได้ = ไม่มีข้อมูลบรรทัดนี้
            }
        }

        return rects;
    }

    // รวม rect ที่อยู่บรรทัดเดียวกันเป็น "กล่องบรรทัด" (เรียงจากบนลงล่าง)
    // บรรทัดหนึ่งมีหลาย rect ได้ (ข้อความถูกแยกเป็นหลาย span เช่น {{ / field / }})
    // left = จุดเริ่มของข้อความในบรรทัด (ใช้จับคู่คอลัมน์ — ดู snapTextboxToColumn)
    function lineBoxes(rects) {
        const sorted = rects.slice().sort(function (a, b) {
            return a.top - b.top;
        });
        const lines = [];

        sorted.forEach(function (rect) {
            const last = lines[lines.length - 1];

            // ซ้อนทับกันเกินครึ่งของกล่องที่เตี้ยกว่า = บรรทัดเดียวกัน
            const overlap = last
                ? Math.min(last.bottom, rect.bottom) - Math.max(last.top, rect.top)
                : 0;
            const shorter = last
                ? Math.min(last.bottom - last.top, rect.bottom - rect.top)
                : 0;

            if (last && overlap > shorter * 0.5) {
                last.top = Math.min(last.top, rect.top);
                last.bottom = Math.max(last.bottom, rect.bottom);
                last.left = Math.min(last.left, rect.left);
                return;
            }

            lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left });
        });

        return lines;
    }

    // จุดเริ่มของข้อความทุกช่วง (run) ในเอกสาร — ใช้เป็น "คอลัมน์" อ้างอิง
    // ของกล่องข้อความ (ดู snapTextboxToColumn)
    //
    // ไม่ใช่แค่จุดเริ่มบรรทัด: ป้ายอย่าง "ตำแหน่ง" อยู่กลางบรรทัด ต่อจากชื่อ
    // (เอกสารจัดตำแหน่งด้วยช่องว่าง ไม่ใช่แท็บ) จึงต้องใช้จุดเริ่มของทุกช่วงข้อความ
    //
    // ข้อความในกล่องข้อความถูกตัดออก — ย่อหน้าที่กล่องยึดอยู่มีตัวกล่องเป็นลูกอยู่
    // จึงต้องข้ามข้อความที่ซ้อนใน foreignObject/[data-layout-text-box] (ดู directTextRects)
    // ค่าที่คืนเป็น px ในพื้นที่เอกสาร (ยังไม่คูณ zoom) เทียบกับมุมซ้ายบนของหน้า
    // เก็บเป็นกล่องเต็ม (left/top/right/bottom) เพราะนอกจากใช้จับคู่ "คอลัมน์"
    // แล้ว ยังใช้ตรวจว่าข้อความในกล่องข้อความไปทับข้อความในเอกสารหรือไม่
    function documentTextRuns(section, pageRect, scale) {
        const runs = [];

        Array.from(section.querySelectorAll('p')).forEach(function (paragraph) {
            if (paragraph.closest('svg') || paragraph.closest('[data-layout-text-box]')) return;
            if ((paragraph.textContent || '').trim() === '') return;

            const fontSize = parseFloat(window.getComputedStyle(paragraph).fontSize) || 0;

            directTextRects(paragraph).forEach(function (rect) {
                runs.push({
                    left: (rect.left - pageRect.left) / scale,
                    top: (rect.top - pageRect.top) / scale,
                    right: (rect.right - pageRect.left) / scale,
                    bottom: (rect.bottom - pageRect.top) / scale,
                    fontSize: fontSize
                });
            });
        });

        return runs;
    }

    // กล่องเนื้อหาของ textbox (div ที่ห่อ <p> ไว้ข้างในกล่อง)
    function textboxContent(wrapper) {
        return wrapper.querySelector('[data-layout-text-box]')
            || wrapper.querySelector('foreignObject');
    }

    // บรรทัดทั้งหมดของข้อความ "ในกล่องข้อความ" (ทุกย่อหน้าในกล่อง)
    // ใช้ rect ที่เรนเดอร์จริง จึงไม่ขึ้นกับ padding ภายในกล่อง
    // แนบขนาดฟอนต์ของย่อหน้ามาด้วย (ใช้ตัด half-leading ตอนเทียบการทับ)
    function textboxLineRects(wrapper) {
        const region = textboxContent(wrapper);

        if (!region) return [];

        const rects = [];

        Array.from(region.querySelectorAll('p')).forEach(function (paragraph) {
            const fontSize = parseFloat(window.getComputedStyle(paragraph).fontSize) || 0;

            directTextRects(paragraph).forEach(function (rect) {
                rect.fontSize = fontSize;
                rects.push(rect);
            });
        });

        return rects;
    }

    // บรรทัดข้อความในกล่อง — แปลงเป็น px ในพื้นที่เอกสาร (ยังไม่คูณ zoom)
    // เทียบกับมุมซ้ายบนของหน้า (ใช้เทียบกับผลของ documentTextRuns)
    function textboxTextRects(wrapper, page) {
        if (!page) return [];

        const scale = page.scale || 1;

        return textboxLineRects(wrapper).map(function (rect) {
            return {
                left: (rect.left - page.rect.left) / scale,
                top: (rect.top - page.rect.top) / scale,
                right: (rect.right - page.rect.left) / scale,
                bottom: (rect.bottom - page.rect.top) / scale,
                fontSize: (rect.fontSize || 0) / scale
            };
        });
    }

    // แถบตัวอักษรจริงในกล่องบรรทัด (ตัด half-leading ออกทั้งบน/ล่าง)
    //
    // กล่องบรรทัด (line box) สูงกว่าตัวอักษรเสมอ — ถ้าเทียบกล่องบรรทัดตรง ๆ
    // จะนับว่า "ทับ" ทั้งที่ตัวอักษรยังห่างกัน (เช่น กล่องข้อความที่วางต่อ
    // จากบรรทัดของเอกสารพอดี) การตัด half-leading ทำให้เห็นว่าตัวอักษรทับกันจริงไหม
    function inkBand(rect) {
        const size = rect.fontSize || 0;
        const height = rect.bottom - rect.top;
        const inset = Math.max(0, (height - size) / 2);

        return { top: rect.top + inset, bottom: rect.bottom - inset };
    }

    // จำนวนจุดที่ข้อความในกล่องทับข้อความในเอกสาร เมื่อเลื่อนกล่องลง dy (px ในหน้า)
    // นับเฉพาะที่ตัวอักษร (ไม่ใช่กล่องบรรทัด) ทับกันเกิน 1px ทั้งสองแกน
    function textOverlapCount(boxRects, runs, dy) {
        const runBands = runs.map(function (run) {
            const band = inkBand(run);

            return {
                left: run.left,
                right: run.right,
                top: band.top,
                bottom: band.bottom
            };
        });

        let count = 0;

        boxRects.forEach(function (box) {
            const band = inkBand(box);
            const top = band.top + dy;
            const bottom = band.bottom + dy;

            runBands.forEach(function (run) {
                const vertical = Math.min(bottom, run.bottom) - Math.max(top, run.top);
                const horizontal = Math.min(box.right, run.right) - Math.max(box.left, run.left);

                if (vertical > 1 && horizontal > 1) count++;
            });
        });

        return count;
    }

    // นับการทับข้อความถ้าเลื่อนกล่องลง dy (เทียบกับตำแหน่งที่เรนเดอร์อยู่ตอนนี้)
    function textOverlapAfter(wrapper, info, dy) {
        if (!info || !info.page || !info.runs || !info.runs.length) return 0;

        const boxRects = textboxTextRects(wrapper, info.page);

        if (!boxRects.length) return 0;

        return textOverlapCount(boxRects, info.runs, dy);
    }

    // เลื่อนกล่องแนวตั้ง (px ในหน้า) ถ้าไม่ทำให้ข้อความในกล่องไปทับข้อความในเอกสารเพิ่ม
    // ตำแหน่งเดิมที่ทับอยู่แล้ว = การจับคู่บรรทัดที่ตั้งใจไว้ ยอมให้เลื่อน
    function applyTextboxMove(item, info, move) {
        if (textOverlapAfter(item.wrapper, info, move) > textOverlapAfter(item.wrapper, info, 0)) return;

        item.wrapper.style.top = (item.top + move).toFixed(2) + 'px';
    }

    // ความสูงบรรทัดตาม computed style (px ในพื้นที่เอกสาร ยังไม่คูณ zoom)
    function computedLineHeight(element) {
        const style = window.getComputedStyle(element);
        const value = parseFloat(style.lineHeight);

        if (isFinite(value) && value > 0) return value;

        return (parseFloat(style.fontSize) || 12) * 1.2;
    }

    // ระยะห่างระหว่างบรรทัด (px ในพื้นที่เอกสาร, 0 = วัดไม่ได้)
    function linePitch(lines, scale) {
        if (lines.length < 2) return 0;

        let total = 0;

        for (let i = 1; i < lines.length; i++) {
            total += lines[i].top - lines[i - 1].top;
        }

        return total / (lines.length - 1) / scale;
    }

    // ย่อหน้าเป้าหมายของกล่อง — ย่อหน้าที่กล่องยึดอยู่ แล้วต่อด้วยย่อหน้าถัดไป
    // จนครอบความสูงของกล่อง (กล่องหลายบรรทัดอาจคร่อมหลายย่อหน้า)
    function targetParagraphsFor(wrapper, target, tolerance) {
        const list = [target];
        const height = wrapper.getBoundingClientRect().height;

        let covered = target.getBoundingClientRect().height;
        let node = target.nextElementSibling;
        let guard = 0;

        while (node && node.localName === 'p' && guard < 8) {
            if (covered >= height - tolerance) break;

            list.push(node);
            covered += node.getBoundingClientRect().height;
            node = node.nextElementSibling;
            guard++;
        }

        return list;
    }

    // ปรับระยะบรรทัดของข้อความในกล่องให้เท่ากับระยะของแถวเป้าหมาย
    //
    // ระยะบรรทัดในกล่องกับแถวเป้าหมายมักไม่เท่ากัน (ย่อหน้าในกล่องมักไม่มี
    // w:spacing แต่ย่อหน้าเป้าหมายมี w:after) → เลื่อนกล่องทั้งก้อนแล้วตรงได้
    // ทีละบรรทัดเท่านั้น จึงปรับระยะในกล่องให้เท่ากันก่อน แล้วจึงจัดตำแหน่ง
    //
    // ปรับเฉพาะการแสดงผลในหน้านี้ — ไม่ได้เขียนกลับไฟล์ .docx
    function matchTextboxLineSpacing(wrapper, targetLines, scale) {
        const region = textboxContent(wrapper);

        if (!region || targetLines.length < 2) return;

        const inner = Array.from(region.querySelectorAll('p'));

        if (inner.length < 2) return;

        const boxLines = lineBoxes(textboxLineRects(wrapper));

        // ปรับเฉพาะเมื่อจำนวนบรรทัดเท่ากัน (1:1) — ถ้าไม่เท่ากัน
        // การยืดระยะให้เท่าค่าเฉลี่ยจะทำให้แย่ลง (เช่น กล่อง 7 บรรทัด แต่แถว 5 แถว)
        if (boxLines.length !== targetLines.length) return;

        const targetPitch = linePitch(targetLines, scale);

        if (!(targetPitch > 0)) return;

        // รอบที่ 1 — ล้างระยะท้ายย่อหน้า แล้ววัด "ระยะบรรทัดจริง" ของกล่อง
        // (ไม่ตั้ง line-height เอง เพราะความสูงบรรทัดจริงขึ้นกับฟอนต์/กล่อง
        //  ตั้งไปอาจคลาดเคลื่อนหรือทำข้อความทับกัน)
        inner.forEach(function (paragraph) {
            paragraph.style.marginTop = '0px';
            paragraph.style.marginBottom = '0px';
        });

        const naturalPitch = linePitch(lineBoxes(textboxLineRects(wrapper)), scale);

        if (!(naturalPitch > 0)) return;

        // ระยะเท่ากันอยู่แล้ว = ไม่ต้องแตะ
        if (Math.abs(targetPitch - naturalPitch) < 1) return;

        // รอบที่ 2 — เว้นระยะท้ายย่อหน้าเป็นตัวกำหนดระยะระหว่างบรรทัด
        // ให้ผลรวมตรงกับระยะของแถวเป้าหมาย (ย่อหน้าสุดท้ายไม่ต้องใส่)
        const margin = targetPitch - naturalPitch;

        inner.forEach(function (paragraph, index) {
            paragraph.style.marginBottom = index < inner.length - 1
                ? margin.toFixed(2) + 'px'
                : '0px';
        });

        // เนื้อหากล่องอาจสูง/ต่ำกว่าเดิม — ต้องไม่ถูกตัดขอบ
        wrapper.style.overflow = 'visible';
        region.style.overflow = 'visible';
    }

    // เลื่อนกล่องข้อความให้ "ทุกบรรทัด" ตรงกับบรรทัดข้อความปกติมากที่สุด
    //
    // กล่องข้อความมีหลายบรรทัดได้ (เช่น ตำแหน่งประธาน / กรรมการ / เลขานุการ)
    // จึงไม่ได้ดูแค่บรรทัดแรก: หา offset ที่ทำให้ระยะจากทุกบรรทัดในกล่อง
    // ถึงบรรทัดเป้าหมายที่ใกล้ที่สุด รวมกันน้อยที่สุด แล้วใช้ค่านั้น
    // (กล่องบรรทัดเดียวจะได้ผลเหมือนเดิม = ดึงเข้าบรรทัดที่ใกล้ที่สุด)
    //
    // การเลือก "แถวเป้าหมาย" ของกล่องหลายบรรทัด
    // - กล่องที่วางอยู่ "ใต้" บรรทัดของย่อหน้าที่ตัวเองยึดอยู่ = กล่องป้าย
    //   สำหรับแถวถัด ๆ ลงไป (เช่น ช่อง "ตำแหน่ง ..." ของรายชื่อด้านล่าง)
    //   จุดเริ่มจึงเลื่อนไปที่แถวแรกที่อยู่ใต้กล่อง
    // - กล่องที่ทับบรรทัดของย่อหน้าเอง (เช่น วางทับ {{field}} ในบรรทัดเดียวกัน)
    //   ยังเริ่มที่บรรทัดนั้นตามเดิม
    //
    // แล้วจับคู่ทีละบรรทัด (1:1) พร้อมปรับระยะบรรทัดในกล่องให้เท่ากับแถวเป้าหมาย
    // — ทำได้เฉพาะเมื่อจำนวนบรรทัดในกล่องเท่ากับจำนวนแถวเป้าหมาย
    //
    // กล่องบรรทัดเดียว / จับคู่ 1:1 ไม่ได้ ใช้ best-fit แบบเดิม:
    // - บรรทัดแรกต้องใกล้บรรทัดข้อความอยู่แล้ว (คลาดเคลื่อนไม่เกินครึ่งบรรทัด)
    //   ไม่งั้น = ตั้งใจวางเหลื่อม ไม่ดึง
    // - offset ที่จะใช้ต้องเลื่อนได้ไม่เกินครึ่งบรรทัด และต้องดีกว่า "ไม่ขยับ"
    function snapTextboxToLine(item, info) {
        const wrapper = item.wrapper;
        const target = wrapper.closest ? wrapper.closest('p') : null;

        if (!target || !textboxContent(wrapper)) return;

        const scale = item.scale || 1;
        const tolerance = computedLineHeight(target) * scale / 2;
        const middle = function (line) {
            return (line.top + line.bottom) / 2;
        };

        // บรรทัดเป้าหมายของย่อหน้าที่กล่องยึดอยู่ + ย่อหน้าถัดไป
        const paragraphs = targetParagraphsFor(wrapper, target, tolerance);
        const targetLines = [];

        paragraphs.forEach(function (paragraph) {
            lineBoxes(directTextRects(paragraph)).forEach(function (line) {
                targetLines.push(line);
            });
        });

        if (!targetLines.length) return;

        const boxLines = lineBoxes(textboxLineRects(wrapper));

        if (!boxLines.length) return;

        // จุดเริ่มของแถวเป้าหมาย (บุ๋กล่องที่วางอยู่ใต้บรรทัดของย่อหน้าเอง)
        let start = 0;
        const anchorLines = lineBoxes(directTextRects(target));
        const anchorLine = anchorLines.length ? anchorLines[anchorLines.length - 1] : null;

        if (anchorLine && middle(boxLines[0]) > middle(anchorLine) + 1) {
            while (
                start < targetLines.length - 1
                && middle(targetLines[start]) <= middle(boxLines[0])
            ) {
                start++;
            }
        }

        // กล่องหลายบรรทัด + แถวเป้าหมายพอ = จับคู่ทีละบรรทัด (1:1)
        if (boxLines.length >= 2 && targetLines.length - start >= boxLines.length) {
            const windowLines = targetLines.slice(start, start + boxLines.length);

            // ปรับระยะบรรทัดในกล่องให้เท่ากับแถวเป้าหมายก่อน
            matchTextboxLineSpacing(wrapper, windowLines, scale);

            const lines = lineBoxes(textboxLineRects(wrapper));

            if (lines.length === windowLines.length) {
                let sum = 0;

                for (let i = 0; i < lines.length; i++) {
                    sum += middle(windowLines[i]) - middle(lines[i]);
                }

                const delta = sum / lines.length;
                let worst = 0;

                for (let i = 0; i < lines.length; i++) {
                    const gap = Math.abs(
                        middle(windowLines[i]) - middle(lines[i]) - delta
                    );

                    if (gap > worst) worst = gap;
                }

                // ทุกบรรทัดตรงกับแถวของตัวเอง = ใช้ได้ (ระยะบรรทัดเท่ากันแล้ว)
                if (worst <= tolerance) {
                    const move = delta / scale;

                    if (Math.abs(move) >= 0.25) applyTextboxMove(item, info, move);

                    return;
                }
            }
        }

        // ── กล่องบรรทัดเดียว / จับคู่ 1:1 ไม่ได้ ──
        const firstLines = lineBoxes(textboxLineRects(wrapper));

        if (!firstLines.length) return;

        // ประตู: บรรทัดแรกต้องใกล้บรรทัดข้อความอยู่แล้ว
        // (เช็คก่อน — ไม่ผ่านจะไม่ไปปรับระยะบรรทัดให้กล่องเสียเปล่า)
        let nearest = Infinity;

        targetLines.forEach(function (line) {
            const distance = Math.abs(middle(line) - middle(firstLines[0]));

            if (distance < nearest) nearest = distance;
        });

        if (nearest > tolerance) return;

        // ปรับระยะบรรทัดในกล่องให้เท่ากับแถวเป้าหมาย (กล่องหลายบรรทัด)
        // เพื่อให้ทุกบรรทัดตรงได้จริง ไม่ใช่แค่บรรทัดแรก
        matchTextboxLineSpacing(wrapper, targetLines, scale);

        const lines = lineBoxes(textboxLineRects(wrapper));

        if (!lines.length) return;

        // ค่าเฉลี่ยระยะจากทุกบรรทัดในกล่อง ถึงบรรทัดเป้าหมายที่ใกล้ที่สุด
        // เมื่อเลื่อนกล่องไป delta px
        const residual = function (delta) {
            let total = 0;

            lines.forEach(function (line) {
                const value = middle(line) + delta;
                let nearest = Infinity;

                targetLines.forEach(function (candidate) {
                    const distance = Math.abs(middle(candidate) - value);

                    if (distance < nearest) nearest = distance;
                });

                total += nearest;
            });

            return total / lines.length;
        };

        // หา offset ที่ดีที่สุด — เลื่อนได้ไม่เกินครึ่งบรรทัด
        // (ไม่ลากกล่องไปเกาะบรรทัดอื่นที่ไกลออกไป)
        const baseline = residual(0);
        let best = null;

        lines.forEach(function (boxLine) {
            targetLines.forEach(function (targetLine) {
                const delta = middle(targetLine) - middle(boxLine);

                if (Math.abs(delta) > tolerance) return;

                const average = residual(delta);

                if (!best || average < best.average) {
                    best = { delta: delta, average: average };
                }
            });
        });

        // ไม่มีทางเลือก หรือขยับแล้วไม่ดีกว่าเดิม = ไม่แตะ
        if (!best || best.average >= baseline) return;

        const delta = best.delta / scale;

        if (Math.abs(delta) < 0.25) return;

        applyTextboxMove(item, info, delta);
    }

    // ──────────────────────────────────────────────────────────────
    // ดึง "คอลัมน์" ของข้อความในกล่องให้ตรงกับข้อความในเอกสาร
    //
    // กล่องข้อความในเทมเพลตมักถูกวางให้ข้อความในกล่องต่อเนื่องกับข้อความในเอกสาร
    // (เช่น กล่อง "ตำแหน่ง ผู้ตรวจรับพัสดุ" ที่ต้องเริ่มที่เดียวกับคำว่า "ตำแหน่ง"
    // ของบรรทัดอื่น ๆ ในบล็อกเดียวกัน) แต่ wp:anchor บอกตำแหน่งของ "ขอบกล่อง"
    // ไม่ใช่จุดเริ่มของข้อความในกล่อง และข้อความในเอกสารเองก็มักจัดตำแหน่ง
    // ด้วยช่องว่าง (ไม่ใช่แท็บ) ทำให้จุดเริ่มที่เรนเดอร์คลาดไปได้หลาย px
    //
    // จึงเลื่อนกล่องในแนวนอนให้จุดเริ่มของบรรทัดแรกในกล่องไปตรงกับจุดเริ่ม
    // ของข้อความที่ใกล้ที่สุด — เฉพาะเมื่อคลาดไม่เกินครึ่งความสูงบรรทัด
    // (เท่ากับเกณฑ์แนวตั้งของ snapTextboxToLine: เกินกว่านั้นถือว่าตั้งใจวางเหลื่อม)
    //
    // บรรทัดถัด ๆ ไปในกล่องเลื่อนตามทั้งกล่อง ระยะภายในกล่องจึงไม่เปลี่ยน
    // ข้อความที่จัดกึ่งกลาง/ขวาไม่แตะ — ขอบซ้ายของบรรทัดขึ้นกับความกว้างข้อความ
    // ไม่ใช่คอลัมน์ของกล่อง (เลื่อนกล่องไปแล้วจะพาไปผิดที่)
    // ──────────────────────────────────────────────────────────────
    function snapTextboxToColumn(item, columns) {
        const wrapper = item.wrapper;
        const region = textboxContent(wrapper);

        // เอกสารอ้างตำแหน่งแนวนอนด้วย align (center/right/inside) = ตำแหน่งคิดจาก
        // ขอบพื้นที่ ไม่ใช่ขอบซ้ายที่ระบุไว้ → ไม่มี "คอลัมน์" ให้ดึงเข้าหา
        if (item.alignH) return;

        if (!region || !columns || !columns.page || !columns.runs.length) return;

        const paragraph = region.querySelector('p');

        if (!paragraph) return;

        const align = window.getComputedStyle(paragraph).textAlign;

        if (align === 'center' || align === 'right' || align === 'end') return;

        const page = columns.page;
        const scale = page.scale || 1;
        const lines = lineBoxes(textboxLineRects(wrapper));

        if (!lines.length) return;

        // จุดเริ่มจริงของบรรทัดแรกในกล่อง (px ในพื้นที่เอกสาร เทียบมุมซ้ายบนของหน้า)
        const boxLeft = (lines[0].left - page.rect.left) / scale;
        const boxTop = (lines[0].top - page.rect.top) / scale;
        // ค่าเหล่านี้เป็น px ในพื้นที่เอกสาร (ยังไม่คูณ zoom) — เทียบกับ boxLeft/boxTop
        // ที่หาร scale ออกแล้ว (computed style ไม่ถูกคูณ zoom อยู่แล้ว)
        const lineHeight = computedLineHeight(paragraph);
        const tolerance = lineHeight / 2;
        const rowLimit = lineHeight * COLUMN_SNAP_ROWS;

        // เลือกข้อความที่อยู่บรรทัดใกล้กล่องที่สุด แล้วในบรรทัดเดียวกัน
        // ใช้ตัวที่คลาดแนวนอนน้อยที่สุด (ไม่ใช้ "คลาดน้อยสุด" อย่างเดียว
        // เพราะข้อความที่ต่อท้ายบรรทัดยาว ๆ อาจเริ่มใกล้พอดีทั้งที่คนละคอลัมน์)
        let best = null;

        columns.runs.forEach(function (run) {
            const delta = run.left - boxLeft;

            if (Math.abs(run.top - boxTop) > rowLimit) return;
            if (Math.abs(delta) > tolerance) return;

            const distance = Math.abs(run.top - boxTop);

            if (
                !best
                || distance < best.distance - 0.5
                || (Math.abs(distance - best.distance) <= 0.5 && Math.abs(delta) < Math.abs(best.delta))
            ) {
                best = { delta: delta, distance: distance };
            }
        });

        // ไม่มีคอลัมน์ใกล้พอ หรือตรงอยู่แล้ว = ไม่แตะ
        if (!best) return;
        if (Math.abs(best.delta) < 0.25) return;

        wrapper.style.left = (item.left + best.delta).toFixed(2) + 'px';
    }

    // ──────────────────────────────────────────────────────────────
    // ถอด "ตัวห่อ" ของวัตถุลอยออกจากผังข้อความ
    //
    // docx-preview ห่อ VML (w:pict) ไว้ใน <div> ซึ่งเป็น block อยู่ในย่อหน้า
    // (renderVmlPicture → renderContainer(elem, "div"))
    // <div> นี้อยู่ใน flow จึงดันข้อความข้าง ๆ (เช่น {{field}}) ขึ้นบรรทัดใหม่
    // กล่องข้อความกับข้อความในย่อหน้าเดียวกันจึงคนละบรรทัด
    // ทั้งที่ตัววัตถุถูกวาง position: absolute ไปแล้ว
    //
    // จึงถอด <div> ที่ทำหน้าที่แค่ห่อวัตถุออกจากผัง (display: contents)
    // ไล่ขึ้นไปจนถึงย่อหน้า — วัตถุ absolute จะไม่กินบรรทัดอีก
    // ถอดเฉพาะ <div> ที่มีแต่วัตถุ ไม่มีข้อความอื่นปน (กัน div ที่มีความหมายถูกถอด)
    // ──────────────────────────────────────────────────────────────
    function flattenShapeWrappers(wrapper) {
        let node = wrapper.parentElement;

        // ไล่ขึ้นเฉพาะผ่าน div/span ในย่อหน้า — เจอย่อหน้าหรือออกนอกย่อหน้า
        // (ตาราง/กล่องหน้า) ให้หยุด ไม่แตะตัวห่อของผังหลัก
        while (node) {
            if (node.localName === 'p') break;
            if (node.localName !== 'div' && node.localName !== 'span') break;

            const hasText = Array.from(node.childNodes).some(function (child) {
                return child.nodeType === 3
                    && (child.textContent || '').replace(/\s+/g, '') !== '';
            });

            if (node.localName === 'div' && !hasText && node.children.length === 1) {
                node.style.display = 'contents';
            }

            node = node.parentElement;
        }
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
                // ตำแหน่งที่เอกสารระบุ (ยังไม่ชดเชย) — ใช้เป็นทางเลือกเมื่อ
                // การชดเชยทําให้ข้อความในกล่องไปทับข้อความในเอกสาร
                declaredTop: top === null ? null : top,
                correction: correction,
                behind: anchor.behindDoc,
                // อ้างแนวนอนด้วย align (center/right/inside) หรือไม่ (ดู snapTextboxToColumn)
                alignH: anchor.horizontal ? anchor.horizontal.align : '',
                scale: page.scale || 1,
                // อ้างแนวตั้งจากย่อหน้า/บรรทัด = วัตถุที่ "อยู่กับข้อความ"
                // จึงดึงเข้าบรรทัดได้ (วัตถุที่อ้างจากหน้าไม่แตะ)
                textRelative: isParagraphRelative(anchor.vertical)
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

            // วัตถุ absolute ไม่ควรกินบรรทัด — ถอดตัวห่อ block ออก
            flattenShapeWrappers(item.wrapper);
        });

        // ดึงกล่องข้อความให้ตรงบรรทัด (แนวตั้ง) และตรงคอลัมน์ (แนวนอน)
        // ของข้อความในเอกสาร — ทำหลังวางทุกวัตถุแล้ว เพื่อวัดบรรทัดได้นิ่ง
        //
        // คอลัมน์ของข้อความในเอกสารคิดครั้งเดียวต่อหน้า แล้วใช้ร่วมกันทุกกล่อง
        // ในหน้านั้น (วัดข้อความทั้งหน้า = แพง)
        const columnsByPage = new Map();

        function columnsFor(wrapper) {
            const section = wrapper.closest ? wrapper.closest('section.docx') : null;
            const page = section ? pageGeometry(section) : null;

            if (!page) return { page: null, runs: [] };

            if (!columnsByPage.has(section)) {
                columnsByPage.set(
                    section,
                    documentTextRuns(section, page.rect, page.scale || 1)
                );
            }

            return { page: page, runs: columnsByPage.get(section) };
        }

        plan.forEach(function (item) {
            if (!item.textRelative) return;

            const info = columnsFor(item.wrapper);

            // การชดเชยแนวตั้ง (Word วัดจากบรรทัดแรกของย่อหน้า, CSS วัดจากขอบย่อหน้า)
            // ช่วยให้กล่องไปตรงบรรทัดในเอกสารเป็นส่วนใหญ่ แต่บางย่อหน้า
            // (เช่น ย่อหน้าที่กล่อง "ตำแหน่ง ..." เกาะอยู่) ชดเชยแล้วกล่องจะเลื่อน
            // ขึ้นไปทับข้อความในเอกสาร ซึ่งตำแหน่งที่เอกสารระบุไม่ได้ทับ
            // → ใช้ค่าที่เอกสารระบุแทน (ห้ามสร้างข้อความทับกัน)
            if (item.correction > 0 && item.declaredTop !== null) {
                const corrected = textOverlapAfter(item.wrapper, info, 0);
                const declared = textOverlapAfter(item.wrapper, info, item.correction);

                if (declared < corrected) {
                    item.wrapper.style.top = item.declaredTop.toFixed(2) + 'px';
                    item.top = item.declaredTop;
                }
            }

            snapTextboxToLine(item, info);
            snapTextboxToColumn(item, info);
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

            // วัตถุ absolute ไม่ควรกินบรรทัด — ถอดตัวห่อ block ออก
            flattenShapeWrappers(svg);
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

        // ความกว้างแท็บต้องตรง tab stop ก่อนจัดตำแหน่งวัตถุ
        // (ความกว้างแท็บเปลี่ยนการตัดบรรทัด = จุดอ้างอิงของรูป/กล่อง/ตารางเปลี่ยนด้วย)
        applyTabStops();

        // ย่อหน้าแบบกระจายตัวอักษร (thaiDistribute) — ยืดให้เต็มบรรทัดก่อน
        // เพราะการยืดเปลี่ยนจุดตัดบรรทัด = ตำแหน่งของรูป/กล่องเปลี่ยนตาม
        applyThaiDistribute();

        // ระยะบรรทัด (วัดฟอนต์ใหม่หลังโหลดครบ — ดู applyLineSpacing)
        applyLineSpacing();

        // ความสูงบรรทัดของย่อหน้าว่าง (วัดใหม่หลังฟอนต์โหลดครบ — ดู naturalLineHeight)
        applyParagraphMarkHeights();

        // ชดเชยระยะที่เบราว์เซอร์บวกเพิ่ม — ต้องเสร็จก่อนจัดตำแหน่งวัตถุลอย
        // (การเปลี่ยน line-height ทำให้ข้อความขยับ ตำแหน่งรูป/กล่องต้องคำนวณตามทีหลัง)
        refineLineSpacing();

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

        // รูปทรง (กล่อง/เส้น) — ใส่สีพื้น/เส้นขอบจากสาขา DrawingML
        // ทำหลังจัดตำแหน่ง เพราะใช้ขนาดกล่องที่ตัวเรนเดอร์ตั้งไว้
        renderShapes();

        // เปิดเครื่องหมายจัดรูปแบบอยู่ = วัดตำแหน่งใหม่หลัง layout ขยับ
        // (canvas ลอยอยู่ ไม่กระทบ layout และไม่เรียก fixRenderedLayout ซ้ำ)
        if (isFormatMarksOn() && current.pairs && current.pairs.size > 0) {
            drawFormatMarksOverlay();
        }
    }

    // ──────────────────────────────────────────────────────────────
    // แถบเครื่องมือ / การพิมพ์ในเอกสาร
    // ──────────────────────────────────────────────────────────────

    function applyEditToggle() {
        const editable = editOn();
        const canvas = host ? host.querySelector('.docx-wrapper') : null;

        // ช่องแก้ไขหลัก = ทั้งเอกสารช่องเดียว
        if (canvas) canvas.contentEditable = editable ? 'true' : 'false';

        // ช่องของกล่องข้อความ (1 กล่อง = 1 ช่อง)
        if (host) {
            host.querySelectorAll('[data-layout-text-box]').forEach(function (region) {
                region.contentEditable = editable ? 'true' : 'false';
            });
        }

        // ย่อหน้าที่จับคู่ไม่ได้ = แก้ไม่ได้เสมอ
        document.querySelectorAll('.layout-para-locked').forEach(function (node) {
            node.contentEditable = 'false';
        });

        // ปิดการแก้ข้อความ = เมนู field ที่เปิดค้างอยู่ต้องปิดด้วย
        if (!editable) closeFieldMenu();

        // ปิดการแก้ข้อความ = แถบค้นหาที่เปิดอยู่ปิดไปด้วย (สูงกว่าดี — ไม่มีโอกาสค้นหา
        // ในย่อหน้าที่ล็อกแล้ว) แต่ไม่ล้างผลค้นหา/ไฮไลต์ไปก่อน (ผู้ใช้อาจเปิดกลับมา
        // ได้โดยกด "ค้นหา" อีกครั้ง และเห็นผลค้นหาเดิมเหมือนเดิม)
        if (!editable && findBarOpen) dismissFindBar();

        refreshFormatButtons();
    }

    // ──────────────────────────────────────────────────────────────
    // ไฮไลต์ {{...}} เป็นสีเหลือง
    //
    // ใช้ CSS Custom Highlight API (::highlight(layout-field) ใน style.css)
    // → ไม่ต้องห่อ span ในเอกสารเลย ตำแหน่งข้อความ/caret จึงไม่ขยับ
    // ถ้าเบราว์เซอร์ไม่รองรับ จะเหลือแค่เงาที่ขอบซ้ายของย่อหน้าที่มี field
    // ──────────────────────────────────────────────────────────────

function isDirectParagraphTextNode(node, paragraph) {
    if (!node || !paragraph) return false;

    let parent = node.parentElement;

    while (parent && parent !== paragraph) {
        // ถ้าเจอ <p> ก่อนถึง paragraph เป้าหมาย
        // แปลว่า TextNode นี้อยู่ใน paragraph ซ้อน
        // เช่น VML TextBox
        if (parent.localName === 'p') {
            return false;
        }

        // เครื่องหมายที่ applyXmlMarks วาดเพิ่ม (ขึ้นบรรทัดใหม่/ยัติภังค์/ช่องติ๊ก)
        // ไม่ใช่ข้อความของย่อหน้า — ต้องไม่ถูกนับเป็นอักขระให้แก้/ค้น/แทน
        if (parent.dataset && parent.dataset.layoutMark === '1') {
            return false;
        }

        parent = parent.parentElement;
    }

    return parent === paragraph;
}

    // function fieldRanges() {
    //     const ranges = [];

    //     if (!host) return ranges;

    //     bodyParagraphs().forEach(function (paragraph) {
    //         const walker = document.createTreeWalker(
    //             paragraph,
    //             NodeFilter.SHOW_TEXT,
    //             null,
    //             false
    //         );

    //         let node;

    //         while ((node = walker.nextNode()) !== null) {
    //             const text = node.textContent || '';
    //             const regex = new RegExp(FIELD_PATTERN.source, 'g');
    //             let match;

    //             while ((match = regex.exec(text)) !== null) {
    //                 const range = document.createRange();

    //                 range.setStart(node, match.index);
    //                 range.setEnd(node, match.index + match[0].length);
    //                 ranges.push(range);
    //             }
    //         }
    //     });

    //     return ranges;
    // }
// อ่านข้อความของย่อหน้าหนึ่งเป็น "สายเดียว" พร้อมตำแหน่งของ TextNode แต่ละก้อน
//
// docx-preview แยก {{field}} ออกเป็นหลาย <span> ได้ ({{ / วันที่ / }})
// จึงต้องต่อข้อความของย่อหน้าเข้าด้วยกันก่อน แล้วค่อยหาช่วง {{...}} ในสายนั้น
//
// ห้าม cleanText() ตรงนี้ — จะลบ \u2003 / PUA แล้ว offset ของ Range เพี้ยน
// เนื้อหาของย่อหน้าตามลำดับที่ "ควรเห็น" บนจอ — ใช้เทียบกับข้อความที่เรนเดอร์แล้ว
//
//   { kind: 'text', text }        ข้อความที่ตัวเรนเดอร์วาดให้แล้ว
//   { kind: 'mark', mark, ... }   ตัวเรนเดอร์ไม่วาด ต้องวาดเพิ่ม (applyXmlMarks)
//   { kind: 'skip' }              ตัวเรนเดอร์ข้ามไป และไม่มีตัวอักษรบนจอ
//
// เครื่องหมายที่ไลบรารี "วาดเอง" (w:tab → em space, w:sym → อักขระ PUA,
// w:br → <br>) ต้องนับเป็น text/skip ให้ตรงกับที่ renderedText เห็น
function paragraphContentItems(xmlParagraph) {
    const items = [];
    let field = null;
    let inResult = false;
    let resultText = '';

    function pushMark(mark) {
        items.push({ kind: 'mark', mark: mark });
    }

    // w:ffData อาจอยู่ใต้ w:fldChar ตรง ๆ (form field รุ่นเก่า)
    function checkBoxOf(fldChar) {
        const ffData = elementChild(fldChar, 'ffData');

        return ffData ? elementChild(ffData, 'checkBox') : null;
    }

    // องค์ประกอบแบบ CT_OnOff (<w:checked/> / <w:default/>) — ไม่ระบุ w:val = เปิด
    // (คืน null เมื่อไม่มีองค์ประกอบนั้นเลย)
    function onOff(element) {
        if (!element) return null;

        const value = wAttr(element, 'val');

        return value == null ? true : value !== '0' && value !== 'false';
    }

    // run ที่อยู่ใต้ w:del / w:moveFrom ถูกซ่อน (renderChanges ปิดอยู่)
    function hidden(run) {
        let node = run.parentNode;

        while (node && node.localName !== 'p') {
            if (node.localName === 'del' || node.localName === 'moveFrom') return true;

            node = node.parentNode;
        }

        return false;
    }

    Array.from(xmlParagraph.getElementsByTagNameNS(W_NS, 'r')).forEach(function (run) {
        if (hidden(run)) return;

        Array.from(run.childNodes).forEach(function (child) {
            if (child.nodeType !== 1) return;

            switch (child.localName) {
                case 't':
                    if (field && inResult) resultText += child.textContent || '';
                    items.push({ kind: 'text', text: child.textContent || '' });
                    break;

                case 'tab':
                    if (field && inResult) resultText += 'tab';
                    items.push({ kind: 'text', text: '\u2003' });
                    break;

                case 'sym': {
                    // ตัวเรนเดอร์วาดเป็นอักขระ Private Use Area ตัวเดียว
                    const code = parseInt(wAttr(child, 'char') || '', 16);

                    if (field && inResult) resultText += 'sym';
                    items.push({
                        kind: 'text',
                        text: isFinite(code) ? String.fromCharCode(code) : ''
                    });
                    break;
                }

                case 'noBreakHyphen':
                    pushMark('noBreakHyphen');
                    break;

                case 'softHyphen':
                    pushMark('softHyphen');
                    break;

                case 'cr':
                    pushMark('cr');
                    break;

                case 'ptab':
                    pushMark('ptab');
                    break;

                case 'fldChar': {
                    const type = wAttr(child, 'fldCharType');
                    const box = type === 'begin' ? checkBoxOf(child) : null;

                    if (box) {
                        // w:checked / w:default เป็น "ลูก" ของ w:checkBox (CT_OnOff)
                        // ไม่ใช่ attribute ของ w:checkBox — ไม่ระบุ w:val = เปิด
                        const checked = onOff(elementChild(box, 'checked'));
                        const fallback = onOff(elementChild(box, 'default'));

                        field = {
                            mark: items.length,
                            checked: checked == null ? fallback === true : checked
                        };
                        inResult = false;
                        resultText = '';
                    } else if (type === 'end' && field) {
                        // ไม่มี "ผลลัพธ์ที่ Word แคชไว้" = ต้องวาดกล่องเอง
                        // (ถ้ามีผลลัพธ์อยู่ ตัวเรนเดอร์วาดข้อความให้แล้ว — ไม่วาดซ้ำ)
                        if (!resultText) {
                            items.splice(field.mark, 0, {
                                kind: 'mark',
                                mark: 'checkbox',
                                checked: field.checked
                            });
                        }

                        field = null;
                    } else if (type === 'separate' && field) {
                        inResult = true;
                    }

                    break;
                }

                // ตัวเรนเดอร์ไม่วาดให้ และไม่มีอักขระของตัวเอง (ไม่มีระยะในบรรทัด)
                case 'br':
                case 'lastRenderedPageBreak':
                case 'drawing':
                case 'pict':
                case 'object':
                case 'instrText':
                    items.push({ kind: 'skip' });
                    break;
            }
        });
    });

    return items;
}

// วางเครื่องหมายที่ "ขอบเขต" ของตำแหน่งในข้อความย่อหน้า
//
// offset คือตำแหน่งในสายข้อความของ paragraphTextMap — ใช้ได้ทั้งหัวและท้ายก้อน
// เพราะเครื่องหมายอยู่ระหว่างเนื้อหาสองชิ้นเสมอ
function insertMark(paragraph, map, offset, item) {
    let target = null;

    for (const part of map.items) {
        if (offset >= part.start && offset <= part.end) {
            target = { node: part.node, offset: offset - part.start };
            break;
        }
    }

    if (!target) return false;

    const range = document.createRange();

    range.setStart(target.node, target.offset);
    range.collapse(true);

    // ขึ้นบรรทัดใหม่ในย่อหน้า — ตัวเรนเดอร์ใช้ <br> เหมือนกัน
    if (item.mark === 'cr') {
        const lineBreak = document.createElement('br');

        lineBreak.setAttribute('data-layout-mark', '1');
        lineBreak.className = 'layout-mark layout-mark-cr';
        lineBreak.title = 'ขึ้นบรรทัดใหม่ในย่อหน้า (w:cr)';

        range.insertNode(lineBreak);

        return true;
    }

    const span = document.createElement('span');

    span.setAttribute('data-layout-mark', '1');
    span.className = 'layout-special layout-mark layout-mark-' + item.mark;
    span.contentEditable = 'false';
    span.setAttribute('spellcheck', 'false');

    if (item.mark === 'checkbox') {
        // ไม่ใส่ตัวอักษรลงในข้อความ — วาดกล่องด้วย CSS (layout-mark-checkbox)
        if (item.checked) span.classList.add('checked');
        span.title = item.checked
            ? 'ช่องติ๊กของเอกสาร (form field) — ติ๊กอยู่'
            : 'ช่องติ๊กของเอกสาร (form field) — ยังไม่ติ๊ก';
    } else if (item.mark === 'ptab') {
        span.textContent = '\u2003';
        span.classList.add('layout-tab');
        span.title = 'แท็บแบบกำหนดตำแหน่งเอง (w:ptab) — แก้จากที่นี่ไม่ได้';
    } else if (item.mark === 'noBreakHyphen') {
        span.textContent = '\u2011';
        span.title = 'ยัติภังค์แบบห้ามตัดบรรทัด (w:noBreakHyphen) — แก้จากที่นี่ไม่ได้';
    } else {
        span.textContent = '\u00ad';
        span.title = 'ยัติภังค์แบบตัดบรรทัดได้ (w:softHyphen) — แก้จากที่นี่ไม่ได้';
    }

    range.insertNode(span);

    return true;
}

function paragraphTextMap(paragraph) {
    const items = [];

    const walker = document.createTreeWalker(
        paragraph,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    let node;
    let text = '';
    let offset = 0;

    // เก็บเฉพาะ TextNode ที่อยู่ในย่อหน้านี้
    // ไม่เอา <p> ที่ซ้อนอยู่ เช่น VML TextBox
    while ((node = walker.nextNode()) !== null) {
        if (!isDirectParagraphTextNode(node, paragraph)) {
            continue;
        }

        const value = node.textContent || '';

        if (!value) {
            continue;
        }

        items.push({
            node: node,
            text: value,
            start: offset,
            end: offset + value.length
        });

        text += value;
        offset += value.length;
    }

    return { text: text, items: items };
}

// ตำแหน่งในสายข้อความ → ตำแหน่งใน TextNode จริง
//
// จุดเริ่มใช้ offset < item.end ส่วนจุดสิ้นสุดใช้ offset <= item.end
// เพราะ {{...}} มักจบที่สุดท้ายของ TextNode (span ของ "}}")
function nodeAtOffset(items, offset, isEnd) {
    for (const item of items) {
        if (isEnd) {
            if (offset > item.start && offset <= item.end) {
                return { node: item.node, offset: offset - item.start };
            }
        } else if (offset >= item.start && offset < item.end) {
            return { node: item.node, offset: offset - item.start };
        }
    }

    return null;
}

// {{field}} ทุกก้อนของย่อหน้าหนึ่ง — { name, range, paragraph }
// ใช้ร่วมกัน 3 ที่: ไฮไลต์เหลืองทั้งเอกสาร, ไฮไลต์เฉพาะ field, เมนูคลิกขวา
function paragraphFields(paragraph) {
    const map = paragraphTextMap(paragraph);
    const fields = [];
    const regex = new RegExp(FIELD_PATTERN.source, 'g');

    let match;

    while ((match = regex.exec(map.text)) !== null) {
        const start = nodeAtOffset(map.items, match.index, false);
        const end = nodeAtOffset(map.items, match.index + match[0].length, true);

        // --------------------------------------------------
        // ป้องกัน Range ผิดพลาด
        // --------------------------------------------------
        if (!start || !end) {
            continue;
        }

        try {
            const range = document.createRange();

            range.setStart(start.node, start.offset);
            range.setEnd(end.node, end.offset);

            fields.push({
                name: match[1],
                range: range,
                paragraph: paragraph,
                // ตำแหน่งของ {{...}} ใน "สายข้อความ" ของย่อหน้า (ใช้หาว่าคลิกตรงไหน)
                start: match.index,
                end: match.index + match[0].length
            });
        } catch (error) {
            console.warn(
                'สร้างช่วง {{field}} ไม่สำเร็จ',
                {
                    field: match[0],
                    error: error
                }
            );
        }
    }

    return fields;
}

// {{field}} ทุกก้อนในเนื้อเรื่อง (หัว/ท้ายกระดาษและเชิงอรรถอยู่นอกเนื้อเรื่อง)
function allParagraphFields() {
    const fields = [];

    bodyParagraphs().forEach(function (paragraph) {
        paragraphFields(paragraph).forEach(function (field) {
            fields.push(field);
        });
    });

    return fields;
}

// ช่วงข้อความของ {{field}} ทั้งหมด (ไฮไลต์เหลือง)
function fieldRanges() {
    return allParagraphFields().map(function (field) {
        return field.range;
    });
}

// ช่วงข้อความของ field ที่ระบุชื่อ (ไฮไลต์เฉพาะ field)
function fieldRangesOf(name) {
    return allParagraphFields()
        .filter(function (field) {
            return field.name === name;
        })
        .map(function (field) {
            return field.range;
        });
}
function highlightSupported() {
    return !!(
        scope.CSS &&
        scope.CSS.highlights &&
        scope.Highlight
    );
}

    // function clearFieldHighlight() {
    //     if (highlightSupported()) scope.CSS.highlights.delete(FIELD_HIGHLIGHT);
    // }
    function clearFieldHighlight() {
        if (!highlightSupported()) return;

        scope.CSS.highlights.delete(FIELD_HIGHLIGHT);
    }

function applyFieldHighlight() {
    const toggle = el('layoutFieldToggle');
    const on = !!(toggle && toggle.checked);

    if (!host) return;

    // --------------------------------------------------
    // class นี้ใช้สำหรับ fallback / แสดง indicator
    // ของ paragraph ที่มี field
    // --------------------------------------------------
    host.classList.toggle('show-fields', on);

    // --------------------------------------------------
    // ล้าง highlight เดิมก่อนทุกครั้ง
    // ป้องกัน Range เก่าค้าง
    // --------------------------------------------------
    clearFieldHighlight();

    // --------------------------------------------------
    // Browser ไม่รองรับ CSS Custom Highlight API
    // --------------------------------------------------
    if (!highlightSupported()) {
        host.classList.toggle('show-fields-plain', on);
        return;
    }

    host.classList.remove('show-fields-plain');

    // ปิด highlight
    if (!on) {
        return;
    }

    const ranges = fieldRanges();

    if (ranges.length === 0) {
        return;
    }

    const highlight = new scope.Highlight();

    ranges.forEach(function (range) {
        highlight.add(range);
    });

    scope.CSS.highlights.set(
        FIELD_HIGHLIGHT,
        highlight
    );
}

    // ระหว่างพิมพ์ข้อความ ตัว {{}} ถูกพิมพ์/ลบทีละตัว — ไฮไลต์ต้องตามให้ทัน
    // (หน่วงเล็กน้อย เพื่อไม่ให้คำนวณใหม่ทุกคีย์)
function scheduleFieldHighlight() {
    window.clearTimeout(highlightTimer);

    highlightTimer = window.setTimeout(function () {
        applyFieldHighlight();
    }, 120);
}

    // ──────────────────────────────────────────────────────────────
    // ปุ่มจัดรูปแบบข้อความ (ตัวหนา / ตัวเอียง / ขีดเส้นใต้)
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

    // ปุ่มสว่างตามสถานะของข้อความที่เลือก (B = หนา)
    function refreshFormatButtons() {
        const enabled = activeParagraph() !== null;
        const bold = enabled && formatState('bold');

        const states = {
            layoutBoldBtn: bold,
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

        document.execCommand(command, false, null);

        touchParagraph(paragraph);
        scheduleFieldHighlight();
        scheduleLayoutFix();
        refreshFormatButtons();
        updateDirty();
    }

    // ──────────────────────────────────────────────────────────────
    // แทรก {{field}} ที่ตำแหน่งเคอร์เซอร์ (Ctrl+Space)
    //
    // รายการที่ให้เลือก = field ที่มีอยู่ในแม่แบบนี้ — อ่านจากไฟล์ (xml)
    // รวมกับที่เพิ่งพิมพ์ค้างไว้บนจอ (ยังไม่บันทึก) ถ้าพิมพ์ชื่อที่ยังไม่มี
    // ในแม่แบบ จะเสนอ "แทรก {{ชื่อ}} ใหม่" เป็นรายการสุดท้าย
    //
    // popup ไม่มีช่องกรอกของตัวเอง — โฟกัสอยู่ที่เอกสารตลอด เคอร์เซอร์จึงไม่หาย
    // พิมพ์เพื่อกรองได้เหมือน suggestMenu (ตัวอักษรที่พิมพ์ไม่หลุดลงเอกสาร)
    // ──────────────────────────────────────────────────────────────

    const FIELD_MENU_GAP = 6;        // ระยะห่างจากเคอร์เซอร์
    const FIELD_MENU_MARGIN = 12;    // ระยะกันขอบจอ
    const FIELD_MENU_WIDTH = 320;    // ความกว้างของ popup

    let fieldMenu = null;       // popup (สร้างครั้งเดียวตอนใช้ครั้งแรก)
    let fieldQueryEl = null;    // บรรทัดบอกคำที่ใช้กรอง
    let fieldList = null;       // <ul> ของรายการ
    let fieldItems = [];        // รายการที่แสดงอยู่
    let fieldIndex = -1;        // รายการที่คีย์บอร์ดชี้อยู่
    let fieldQuery = '';        // ข้อความที่พิมพ์เพื่อกรอง
    let fieldRange = null;      // ตำแหน่งเคอร์เซอร์ตอนเปิดเมนู (ใช้แทรก)
    let fieldParagraph = null;  // ย่อหน้าที่เปิดเมนูอยู่ (ใช้ตอนแทรก)

    // ชื่อ field ทั้งหมดในแม่แบบนี้ — จากไฟล์ + ที่แก้ค้างอยู่บนจอ
    // (ใช้ตัวอ่านเดียวกับตอนบันทึก จึงตรงกับ field ที่ระบบรู้จัก)
    function documentFields() {
        const names = [];

        function add(name) {
            if (name && names.indexOf(name) === -1) names.push(name);
        }

        if (current && current.xml && scope.Extract) {
            scope.Extract.extractFields(current.xml).forEach(add);
        }

        if (host) {
            const regex = new RegExp(FIELD_PATTERN.source, 'g');
            const text = host.textContent || '';
            let match;

            while ((match = regex.exec(text)) !== null) add(match[1]);
        }

        return names.sort(function (a, b) {
            return a.localeCompare(b, 'th');
        });
    }

    // ชื่อที่พิมพ์มาใช้เป็นชื่อ field ได้หรือไม่ (ชุดเดียวกับ FIELD_PATTERN)
    function isFieldName(name) {
        return /^[a-zA-Z0-9_ก-๙]+$/.test(String(name || ''));
    }

    // รายการที่จะแสดง — field ที่ตรงกับคำที่พิมพ์กรอง
    function fieldCandidates() {
        const lower = fieldQuery.toLowerCase();
        const names = documentFields();

        const items = names
            .filter(function (name) {
                return !lower || name.toLowerCase().indexOf(lower) !== -1;
            })
            .map(function (name) {
                return { name: name, kind: 'field' };
            });

        // พิมพ์ชื่อที่ยังไม่มีในแม่แบบ = เสนอ "แทรก {{ชื่อ}} ใหม่"
        if (
            fieldQuery &&
            names.indexOf(fieldQuery) === -1 &&
            isFieldName(fieldQuery)
        ) {
            items.push({ name: fieldQuery, kind: 'new' });
        }

        return items;
    }

    function buildFieldMenu() {
        if (fieldMenu) return;

        fieldMenu = document.createElement('div');
        fieldMenu.className = 'field-menu';
        fieldMenu.id = 'layoutFieldMenu';
        fieldMenu.hidden = true;
        fieldMenu.innerHTML =
            '<p class="field-menu-query"></p>' +
            '<ul class="field-menu-list" role="listbox"></ul>';

        document.body.appendChild(fieldMenu);

        fieldQueryEl = fieldMenu.querySelector('.field-menu-query');
        fieldList = fieldMenu.querySelector('.field-menu-list');

        // mousedown ก่อน click: กันไม่ให้ caret ในเอกสารหาย
        // (คลิกรายการได้โดยไม่เสียตำแหน่งที่จะแทรก)
        fieldList.addEventListener('mousedown', function (event) {
            event.preventDefault();
        });

        fieldList.addEventListener('click', function (event) {
            const button = event.target.closest('.field-menu-item');

            if (!button) return;

            acceptFieldItem(Number(button.dataset.index));
        });

        window.addEventListener('resize', function () {
            if (fieldMenu && !fieldMenu.hidden) positionFieldMenu();
        });
    }

    function renderFieldMenu() {
        fieldQueryEl.textContent = fieldQuery
            ? 'กรอง: ' + fieldQuery
            : 'field ในแม่แบบนี้ (พิมพ์เพื่อกรอง · Enter = แทรก)';

        fieldList.innerHTML = '';

        if (fieldItems.length === 0) {
            const empty = document.createElement('li');

            empty.className = 'field-menu-empty';
            empty.textContent = 'ไม่พบ field ที่ตรงกับ "' + fieldQuery + '"';

            fieldList.appendChild(empty);
            return;
        }

        // textContent ทุกจุด เพราะชื่อ field มาจากผู้ใช้ (กัน XSS)
        fieldItems.forEach(function (item, index) {
            const row = document.createElement('li');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'field-menu-item';
            button.dataset.index = String(index);

            if (index === fieldIndex) {
                button.className += ' selected';
            }

            const name = document.createElement('span');
            name.className = 'field-menu-name';
            name.textContent = '{{' + item.name + '}}';

            button.appendChild(name);

            if (item.kind === 'new') {
                button.className += ' new';

                const tag = document.createElement('span');
                tag.className = 'field-menu-tag';
                tag.textContent = 'field ใหม่';

                button.appendChild(tag);
            }

            row.appendChild(button);
            fieldList.appendChild(row);
        });

        const marked = fieldList.querySelector('.field-menu-item.selected');

        if (marked && marked.scrollIntoView) {
            marked.scrollIntoView({ block: 'nearest' });
        }
    }

    // กล่องของเคอร์เซอร์ — ใช้จัดตำแหน่ง popup
    // (ย่อหน้าที่ถูกต้องเป็น fallback เมื่อเบราว์เซอร์ไม่บอกกล่องของ caret)
    function caretBox() {
        const selection = window.getSelection();

        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0).cloneRange();
            const rects = range.getClientRects();

            if (rects && rects.length > 0) return rects[0];

            const rect = range.getBoundingClientRect();

            if (rect && (rect.width > 0 || rect.height > 0 || rect.top > 0)) {
                return rect;
            }
        }

        const paragraph = fieldParagraph || activeParagraph();

        return paragraph ? paragraph.getBoundingClientRect() : null;
    }

    // ตำแหน่งของ popup = ใต้เคอร์เซอร์ (ล้นขอบล่างก็พลิกขึ้นด้านบน)
    function positionFieldMenu() {
        const box = caretBox();

        if (!fieldMenu || !box) return;

        fieldMenu.style.visibility = 'hidden';
        fieldMenu.style.left = '0px';
        fieldMenu.style.top = '0px';

        const width = Math.min(
            FIELD_MENU_WIDTH,
            window.innerWidth - FIELD_MENU_MARGIN * 2
        );

        const height = fieldMenu.offsetHeight;

        let left = box.left;

        if (left + width > window.innerWidth - FIELD_MENU_MARGIN) {
            left = window.innerWidth - FIELD_MENU_MARGIN - width;
        }

        if (left < FIELD_MENU_MARGIN) left = FIELD_MENU_MARGIN;

        let top = box.bottom + FIELD_MENU_GAP;

        if (top + height > window.innerHeight - FIELD_MENU_MARGIN) {
            top = box.top - height - FIELD_MENU_GAP;
        }

        if (top < FIELD_MENU_MARGIN) top = FIELD_MENU_MARGIN;

        fieldMenu.style.width = width + 'px';
        fieldMenu.style.left = left + 'px';
        fieldMenu.style.top = top + 'px';
        fieldMenu.style.visibility = 'visible';
    }

    function fieldMenuOpen() {
        return !!(fieldMenu && !fieldMenu.hidden);
    }

    function closeFieldMenu() {
        if (fieldMenu) fieldMenu.hidden = true;

        fieldItems = [];
        fieldIndex = -1;
        fieldQuery = '';
        fieldRange = null;
        fieldParagraph = null;
    }

    // สร้างรายการใหม่ตามคำที่กรอง แล้ววาด + ยึดตำแหน่งให้ตรงกับเคอร์เซอร์
    function refreshFieldMenu() {
        fieldItems = fieldCandidates();

        // ชี้รายการแรกไว้เลย Enter/Tab จึงแทรกได้ทันที
        fieldIndex = fieldItems.length > 0 ? 0 : -1;

        renderFieldMenu();

        fieldMenu.hidden = false;
        positionFieldMenu();
    }

    function openFieldMenu() {
        const selection = window.getSelection();
        const paragraph = activeParagraph();

        if (!paragraph || !selection || selection.rangeCount === 0) {
            setStatus('วางเคอร์เซอร์ในย่อหน้าที่แก้ได้ก่อนจึงแทรก field ได้', 'warn');
            return;
        }

        buildFieldMenu();

        fieldParagraph = paragraph;
        fieldRange = selection.getRangeAt(0).cloneRange();
        fieldQuery = '';

        fieldItems = fieldCandidates();

        if (fieldItems.length === 0) {
            closeFieldMenu();
            setStatus('แม่แบบนี้ยังไม่มี field ({{...}}) ให้แทรก', 'warn');
            return;
        }

        refreshFieldMenu();
    }

    function stepFieldSelection(step) {
        if (fieldItems.length === 0) return;

        let index = fieldIndex + step;

        if (index < 0) index = fieldItems.length - 1;
        if (index >= fieldItems.length) index = 0;

        fieldIndex = index;
        renderFieldMenu();
    }

    // แทรกข้อความ {{field}} ที่ตำแหน่งเคอร์เซอร์
    // ใช้ execCommand เพื่อให้ข้อความใหม่ไปรวมกับ run เดิม (รูปแบบไม่เพี้ยน)
    function insertField(name) {
        const text = '{{' + name + '}}';
        const selection = window.getSelection();

        // คืนเคอร์เซอร์กลับที่เดิมก่อนแทรก (กันตำแหน่งหายไประหว่างเมนูเปิดอยู่)
        if (
            selection &&
            fieldRange &&
            fieldRange.startContainer &&
            fieldRange.startContainer.isConnected
        ) {
            selection.removeAllRanges();
            selection.addRange(fieldRange);
        }

        document.execCommand('insertText', false, text);

        touchParagraph(caretParagraph() || fieldParagraph);
        scheduleFieldHighlight();
        scheduleLayoutFix();
        updateDirty();
    }

    function acceptFieldItem(index) {
        const item = fieldItems[index];

        if (!item) return false;

        insertField(item.name);
        closeFieldMenu();

        return true;
    }

    // Ctrl+Space = เปิดรายการ field ของแม่แบบนี้ที่ตำแหน่งเคอร์เซอร์
    function isFieldShortcut(event) {
        return !!(
            (event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            !event.shiftKey &&
            (event.key === ' ' || event.code === 'Space')
        );
    }

    // ขณะเมนูเปิดอยู่ ปุ่มทั้งหมดถูกจัดการที่นี่ (โฟกัสจึงอยู่ที่เอกสารตลอด)
    function onFieldKeydown(event) {
        if (!fieldMenuOpen()) {
            if (!isFieldShortcut(event)) return;

            // ไม่ได้อยู่ในย่อหน้าที่แก้ได้ = ไม่มีที่ให้แทรก
            if (!activeParagraph()) return;

            event.preventDefault();
            openFieldMenu();
            return;
        }

        // กำลังพิมพ์ด้วย IME (เช่นแป้นไทย) — ปล่อยให้พิมพ์ตามปกติ
        if (event.isComposing || event.keyCode === 229) {
            closeFieldMenu();
            return;
        }

        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                stepFieldSelection(1);
                return;

            case 'ArrowUp':
                event.preventDefault();
                stepFieldSelection(-1);
                return;

            case 'Enter':
            case 'Tab':
                event.preventDefault();
                acceptFieldItem(fieldIndex);
                return;

            case 'Escape':
                event.preventDefault();
                closeFieldMenu();
                return;

            case 'Backspace':
                // ยังไม่ได้พิมพ์กรอง = ปิดเมนู แล้วปล่อยให้ลบข้อความตามปกติ
                if (!fieldQuery) {
                    closeFieldMenu();
                    return;
                }

                event.preventDefault();
                fieldQuery = fieldQuery.slice(0, -1);
                refreshFieldMenu();
                return;

            default:
                break;
        }

        // คีย์ลัดอื่น (Ctrl+B / Ctrl+I / Ctrl+U) = ปิดเมนูแล้วทำงานตามปกติ
        if (event.ctrlKey || event.metaKey || event.altKey) {
            closeFieldMenu();
            return;
        }

        // พิมพ์ตัวอักษร = กรองรายการ (ไม่ให้ตัวอักษรหลุดลงเอกสาร)
        if (event.key.length === 1) {
            event.preventDefault();
            fieldQuery += event.key;
            refreshFieldMenu();
            return;
        }

        // ลูกศรซ้าย/ขวา, Home, End, Delete ... = ปิดเมนูแล้วให้ทำงานตามปกติ
        closeFieldMenu();
    }

    // ──────────────────────────────────────────────────────────────
    // คลิกขวาที่ {{field}} — แก้ไขรายละเอียดของ field นั้น / ไฮไลต์ทุกที่ที่ใช้
    //
    // รายละเอียดที่แก้ได้ในที่นี้ = type / ล็อกตำแหน่ง / placeholder / กลุ่ม (Group)
    // (เก็บและบันทึกผ่าน payload.getFieldConfig / saveFieldConfig ของ app.js)
    // ช่องกลุ่มแสดงเฉพาะ type List — เหมือนหน้า "ตั้งค่าแม่แบบ"
    // ส่วนค่าที่ลึกกว่า (โครงตาราง + รูปแบบหัวคอลัมน์) ทำที่หน้า "ตั้งค่าแม่แบบ"
    // จึงมีปุ่มพาไปหน้านั้นให้ (payload.editField) เฉพาะเมื่อ field เป็นตาราง
    // ──────────────────────────────────────────────────────────────

    const CONTEXT_MENU_GAP = 4;   // ระยะห่างจากจุดคลิกขวา

    const FIELD_MODAL_HTML = [
        '<div class="layout-field-backdrop" data-field-modal-close></div>',
        '<div class="layout-field-dialog" role="dialog" aria-modal="true" aria-labelledby="layoutFieldTitle">',
        '    <div class="layout-field-head">',
        '        <h2 id="layoutFieldTitle">แก้ไขรายละเอียด field</h2>',
        '        <button type="button" class="layout-close" data-field-modal-close aria-label="ปิด">&times;</button>',
        '    </div>',
        '    <div class="layout-field-body">',
        '        <p class="layout-field-name" id="layoutFieldName"></p>',
        '        <div class="field">',
        '            <label for="layoutFieldType">ชนิด (Type)</label>',
        '            <select id="layoutFieldType"></select>',
        '        </div>',
        '        <label class="layout-toggle"><input type="checkbox" id="layoutFieldLock"> ล็อกตำแหน่ง (รักษาตำแหน่งเดิมในเอกสาร)</label>',
        '        <div class="field">',
        '            <label for="layoutFieldPlaceholder">Placeholder (ข้อความตัวอย่างในหน้ารายงาน)</label>',
        '            <input type="text" id="layoutFieldPlaceholder" autocomplete="off" placeholder="เว้นว่าง = ใช้ค่าเริ่มต้น">',
        '        </div>',
        '        <div class="field" id="layoutFieldGroupBox" hidden>',
        '            <label for="layoutFieldGroup">กลุ่ม (Group)</label>',
        '            <input type="text" id="layoutFieldGroup" autocomplete="off" placeholder="เว้นว่าง = ไม่ใช้กลุ่ม">',
        '            <p class="hint">list ที่ใช้ชื่อกลุ่มเดียวกันจะแสดงเป็นแถวเดียวกันในหน้ารายงาน (คอลัมน์ละ field) — เพิ่ม/ลบแถวที่ตัวไหนก็มีผลกับทุกตัวในกลุ่ม</p>',
        '        </div>',
        '        <p class="hint" id="layoutFieldTableHint" hidden>field นี้เป็นตาราง — จำนวนคอลัมน์ / ชื่อคอลัมน์ / สัดส่วน / รูปแบบหัวคอลัมน์ ตั้งได้ที่หน้า "ตั้งค่าแม่แบบ"</p>',
        '        <p class="layout-status" id="layoutFieldStatus"></p>',
        '    </div>',
        '    <div class="layout-field-actions">',
        '        <button type="button" id="layoutFieldEditBtn" class="plain" hidden>เปิดหน้าแก้ไขเต็มรูปแบบ</button>',
        '        <button type="button" class="plain" data-field-modal-close>ยกเลิก</button>',
        '        <button type="button" id="layoutFieldSaveBtn">บันทึก</button>',
        '    </div>',
        '</div>'
    ].join('\n');

    let contextMenu = null;    // เมนูคลิกขวา (สร้างครั้งเดียวตอนใช้ครั้งแรก)
    let contextList = null;    // <ul> ของรายการในเมนู
    let contextField = null;   // { name, range } ของ field ที่คลิกขวา
    let fieldModal = null;     // กล่องแก้รายละเอียด field (สร้างครั้งเดียว)
    let fieldModalField = '';  // ชื่อ field ที่กล่องนี้กำลังแก้
    let fieldFocus = '';       // ชื่อ field ที่ไฮไลต์ทุกที่อยู่ (' = ไม่มี)

    // ── หา {{field}} ที่ตำแหน่งเมาส์ ──

    // ย่อหน้าของ node (ใช้ได้กับย่อหน้าที่แก้ไม่ได้ด้วย — แก้ค่าตั้งของ field
    // ไม่ได้แตะข้อความในเอกสาร)
    function paragraphAt(node) {
        const element = node && node.nodeType === 1
            ? node
            : (node ? node.parentNode : null);

        if (!element || !element.closest || !host) return null;

        const paragraph = element.closest('.layout-para');

        return paragraph && host.contains(paragraph) ? paragraph : null;
    }

    // ข้อความ {{field}} ที่จุดที่คลิกขวา (คืน null เมื่อไม่ได้คลิกบน field)
    function fieldAtPoint(clientX, clientY) {
        let node = null;
        let offset = 0;

        if (document.caretRangeFromPoint) {
            const caret = document.caretRangeFromPoint(clientX, clientY);

            if (caret) {
                node = caret.startContainer;
                offset = caret.startOffset;
            }
        } else if (document.caretPositionFromPoint) {
            const caret = document.caretPositionFromPoint(clientX, clientY);

            if (caret) {
                node = caret.offsetNode;
                offset = caret.offset;
            }
        }

        if (!node || node.nodeType !== 3) return null;

        const paragraph = paragraphAt(node);

        if (!paragraph) return null;

        const map = paragraphTextMap(paragraph);
        const item = map.items.find(function (entry) {
            return entry.node === node;
        });

        if (!item) return null;

        const caretOffset = item.start + offset;

        const found = paragraphFields(paragraph).find(function (field) {
            return caretOffset >= field.start && caretOffset <= field.end;
        });

        return found || null;
    }

    // ── เมนูคลิกขวา ──

    function buildContextMenu() {
        if (contextMenu) return;

        contextMenu = document.createElement('div');
        contextMenu.className = 'layout-context-menu';
        contextMenu.id = 'layoutContextMenu';
        contextMenu.hidden = true;
        contextMenu.innerHTML =
            '<p class="layout-context-title"></p>' +
            '<ul class="layout-context-list" role="menu"></ul>';

        document.body.appendChild(contextMenu);

        contextList = contextMenu.querySelector('.layout-context-list');

        // mousedown ก่อน click: กันไม่ให้ selection ในเอกสารหาย (และ caret ไม่ขยับ)
        contextMenu.addEventListener('mousedown', function (event) {
            event.preventDefault();
        });

        contextList.addEventListener('click', function (event) {
            const button = event.target.closest('.layout-context-item');

            if (!button) return;

            runContextAction(button.dataset.action);
        });
    }

    // รายการในเมนู — ปิดรายการที่แม่แบบนี้ยังไม่รองรับ (ยังไม่มี hook จาก app.js)
    function contextActions() {
        const payload = (current && current.payload) || {};

        return [
            {
                action: 'edit-field',
                label: 'แก้ไขรายละเอียด field',
                enabled: typeof payload.getFieldConfig === 'function' &&
                    typeof payload.saveFieldConfig === 'function'
            },
            {
                action: 'focus-field',
                label: 'ไฮไลต์ทุกที่ที่ใช้ field นี้',
                enabled: true
            }
        ];
    }

    function contextMenuOpen() {
        return !!(contextMenu && !contextMenu.hidden);
    }

    function positionContextMenu(clientX, clientY) {
        contextMenu.style.visibility = 'hidden';
        contextMenu.style.left = '0px';
        contextMenu.style.top = '0px';

        const width = contextMenu.offsetWidth;
        const height = contextMenu.offsetHeight;

        let left = clientX;
        let top = clientY;

        if (left + width > window.innerWidth - FIELD_MENU_MARGIN) {
            left = window.innerWidth - FIELD_MENU_MARGIN - width;
        }

        if (left < FIELD_MENU_MARGIN) left = FIELD_MENU_MARGIN;

        // ล้นขอบล่าง = พลิกขึ้นเหนือจุดคลิก
        if (top + height > window.innerHeight - FIELD_MENU_MARGIN) {
            top = clientY - height - CONTEXT_MENU_GAP;
        }

        if (top < FIELD_MENU_MARGIN) top = FIELD_MENU_MARGIN;

        contextMenu.style.left = left + 'px';
        contextMenu.style.top = top + 'px';
        contextMenu.style.visibility = 'visible';
    }

    function closeContextMenu() {
        if (contextMenu) contextMenu.hidden = true;

        contextField = null;
    }

    function runContextAction(action) {
        const field = contextField;

        if (!field) return;

        closeContextMenu();

        if (action === 'edit-field') {
            openFieldDialog(field.name);
            return;
        }

        if (action === 'focus-field') {
            toggleFieldFocus(field.name);
        }
    }

    // คลิกขวาในเอกสาร: เจอ {{field}} = เปิดเมนูของ field นั้น
    // ไม่เจอ = ปล่อยให้เป็นเมนูของระบบตามเดิม
    function onContextMenu(event) {
        const field = fieldAtPoint(event.clientX, event.clientY);

        if (!field) {
            closeContextMenu();
            return;
        }

        event.preventDefault();

        closeFieldMenu();

        // เลือก {{field}} ทั้งก้อน ให้เห็นว่ากำลังจะแก้ field ไหน
        const selection = window.getSelection();

        if (selection && field.range) {
            selection.removeAllRanges();
            selection.addRange(field.range);
        }

        buildContextMenu();

        contextField = field;
        contextMenu.querySelector('.layout-context-title').textContent =
            '{{' + field.name + '}}';

        contextList.innerHTML = '';

        // textContent ทุกจุด เพราะชื่อ field มาจากผู้ใช้ (กัน XSS)
        contextActions().forEach(function (item) {
            const row = document.createElement('li');
            const button = document.createElement('button');

            button.type = 'button';
            button.className = 'layout-context-item';
            button.dataset.action = item.action;
            button.textContent = item.label;
            button.disabled = !item.enabled;
            button.setAttribute('role', 'menuitem');

            row.appendChild(button);
            contextList.appendChild(row);
        });

        contextMenu.hidden = false;
        positionContextMenu(event.clientX, event.clientY);
    }

    // ── ไฮไลต์ทุกที่ที่ใช้ field เดียวกัน ──

    function clearFieldFocus() {
        fieldFocus = '';

        if (highlightSupported()) {
            scope.CSS.highlights.delete(FIELD_FOCUS_HIGHLIGHT);
        }
    }

    // ไฮไลต์ช่วงของ field นั้นทุกก้อน — คืนจำนวนช่วงที่ไฮไลต์
    function applyFieldFocus(name) {
        clearFieldFocus();

        if (!highlightSupported()) return 0;

        const ranges = fieldRangesOf(name);

        if (ranges.length === 0) return 0;

        const highlight = new scope.Highlight();

        ranges.forEach(function (range) {
            highlight.add(range);
        });

        scope.CSS.highlights.set(FIELD_FOCUS_HIGHLIGHT, highlight);

        fieldFocus = name;

        const first = ranges[0].startContainer;
        const element = first && (first.nodeType === 1 ? first : first.parentElement);

        if (element && element.scrollIntoView) {
            element.scrollIntoView({ block: 'center' });
        }

        return ranges.length;
    }

    // กดซ้ำที่ field เดิม = ยกเลิกไฮไลต์
    function toggleFieldFocus(name) {
        if (fieldFocus === name) {
            clearFieldFocus();
            setStatus('ยกเลิกไฮไลต์ "' + name + '" แล้ว');
            return;
        }

        const count = applyFieldFocus(name);

        if (count === 0) {
            setStatus('ไม่พบ {{' + name + '}} ในเอกสารให้ไฮไลต์', 'warn');
            return;
        }

        setStatus(
            'ไฮไลต์ "' + name + '" ' + count + ' แห่ง (กด Esc เพื่อยกเลิก)',
            'ok'
        );
    }

    // ── กล่องแก้ไขรายละเอียด field ──

    function fieldModalOpen() {
        return !!(fieldModal && fieldModal.classList.contains('open'));
    }

    function buildFieldModal() {
        if (fieldModal) return;

        fieldModal = document.createElement('div');
        fieldModal.className = 'layout-field-modal';
        fieldModal.id = 'layoutFieldModal';
        fieldModal.innerHTML = FIELD_MODAL_HTML;

        // อยู่ "ใน" หน้าจัดตำแหน่ง จึงปิดเมื่อหน้าจัดตำแหน่งปิด และทับบนเอกสารเสมอ
        overlay.appendChild(fieldModal);

        fieldModal.querySelectorAll('[data-field-modal-close]').forEach(function (node) {
            node.addEventListener('click', closeFieldDialog);
        });

        const typeSelect = fieldModal.querySelector('#layoutFieldType');

        scope.FieldTypes.options.forEach(function (type) {
            const option = document.createElement('option');

            option.value = type.value;
            option.textContent = type.label;

            typeSelect.appendChild(option);
        });

        typeSelect.addEventListener('change', refreshFieldModal);

        fieldModal.querySelector('#layoutFieldSaveBtn')
            .addEventListener('click', saveFieldDialog);

        fieldModal.querySelector('#layoutFieldEditBtn')
            .addEventListener('click', openFieldInConfigPage);
    }

    function setFieldModalStatus(text, kind) {
        const node = fieldModal && fieldModal.querySelector('#layoutFieldStatus');

        if (!node) return;

        node.textContent = text || '';
        node.className = 'layout-status' + (kind ? ' ' + kind : '');
    }

    // แสดงเฉพาะส่วนที่ใช้กับ type ที่เลือก:
    // ตาราง (คำอธิบาย + ปุ่มไปหน้าแก้ไข) / กลุ่ม (Group) ของ List
    function refreshFieldModal() {
        if (!fieldModal) return;

        const type =
            fieldModal.querySelector('#layoutFieldType').value;

        const isTable = type === 'table';
        const isList = type === 'list';

        fieldModal.querySelector('#layoutFieldTableHint').hidden = !isTable;
        fieldModal.querySelector('#layoutFieldEditBtn').hidden = !isTable;
        fieldModal.querySelector('#layoutFieldGroupBox').hidden = !isList;
    }

    function closeFieldDialog() {
        if (fieldModal) fieldModal.classList.remove('open');

        fieldModalField = '';
    }

    async function openFieldDialog(name) {
        const payload = (current && current.payload) || {};

        if (typeof payload.getFieldConfig !== 'function') {
            setStatus('หน้านี้ยังไม่รองรับการแก้รายละเอียด field', 'warn');
            return;
        }

        buildFieldModal();

        let values = null;

        try {
            values = (await payload.getFieldConfig(name)) || {};
        } catch (error) {
            setStatus(
                'อ่านค่าตั้งของ field ไม่สำเร็จ: ' + messageOf(error),
                'error'
            );
            return;
        }

        fieldModalField = name;
        fieldModal.querySelector('#layoutFieldName').textContent = '{{' + name + '}}';
        fieldModal.querySelector('#layoutFieldType').value =
            values.type || scope.FieldTypes.defaultValue;
        fieldModal.querySelector('#layoutFieldLock').checked = !!values.lock;
        fieldModal.querySelector('#layoutFieldPlaceholder').value =
            values.placeholder || '';
        fieldModal.querySelector('#layoutFieldGroup').value =
            values.listGroup || '';

        setFieldModalStatus('');
        refreshFieldModal();

        fieldModal.classList.add('open');

        const first = fieldModal.querySelector('#layoutFieldType');

        window.setTimeout(function () {
            if (fieldModalOpen() && first && first.focus) first.focus();
        }, 30);
    }

    async function saveFieldDialog() {
        const payload = (current && current.payload) || {};

        if (!fieldModalField || typeof payload.saveFieldConfig !== 'function') {
            return;
        }

        const field = fieldModalField;
        const values = {
            type: fieldModal.querySelector('#layoutFieldType').value,
            lock: fieldModal.querySelector('#layoutFieldLock').checked,
            placeholder: fieldModal.querySelector('#layoutFieldPlaceholder').value,
            listGroup: fieldModal.querySelector('#layoutFieldGroup').value
        };

        const button = fieldModal.querySelector('#layoutFieldSaveBtn');

        button.disabled = true;
        setFieldModalStatus('กำลังบันทึก...');

        try {
            await payload.saveFieldConfig(field, values);
        } catch (error) {
            setFieldModalStatus(
                'บันทึกไม่สำเร็จ: ' + messageOf(error),
                'error'
            );
            return;
        } finally {
            button.disabled = false;
        }

        closeFieldDialog();
        setStatus('บันทึกค่า field {{' + field + '}} แล้ว', 'ok');
    }

    // ไปแก้ค่าที่ลึกกว่านี้ (โครงตาราง/หัวคอลัมน์) ที่หน้า "ตั้งค่าแม่แบบ"
    async function openFieldInConfigPage() {
        const payload = (current && current.payload) || {};

        if (!fieldModalField || typeof payload.editField !== 'function') {
            return;
        }

        const field = fieldModalField;

        // ข้อความที่แก้ค้างในหน้านี้ต้องถูกบันทึกก่อน ไม่งั้นจะหายไปตอนปิดหน้านี้
        if (pendingEdits() > 0) {
            if (!(await scope.AppDialog.confirm(
                'มีข้อความที่แก้ค้างอยู่ในหน้าจัดตำแหน่ง\n\n' +
                'บันทึกก่อนเปิดหน้าแก้ไขหรือไม่?',
                { title: 'ยืนยันการบันทึก', okText: 'บันทึกและไปต่อ' }
            ))) {
                return;
            }

            if (!(await save(true))) return;
        }

        let opened = false;

        try {
            opened = (await payload.editField(field)) !== false;
        } catch (error) {
            setFieldModalStatus(
                'เปิดหน้าแก้ไขไม่สำเร็จ: ' + messageOf(error),
                'error'
            );
            return;
        }

        if (!opened) return;

        closeFieldDialog();
        close();
    }

    // จำนวนย่อหน้าที่แก้ค้างอยู่ (ยังไม่บันทึก)
    function pendingEdits() {
        if (!current) return 0;

        const edits = collectEdits(true);

        return edits.texts.length + edits.formats.length;
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

    // คีย์ลัด Ctrl+F / Ctrl+H = เปิดแถบค้นหาและแทนที่
    function isFindShortcut(event) {
        return (
            (event.ctrlKey || event.metaKey) &&
            !event.altKey &&
            !event.shiftKey &&
            (event.code === 'KeyF' || event.code === 'KeyH')
        );
    }

    function onFindKeydown(event) {
        if (!isFindShortcut(event)) return;

        event.preventDefault();

        const input = findInput();

        // ข้อความที่เลือกอยู่ในเอกสาร (อ่านก่อนย้ายโฟกัส) = คำค้น
        const selected = document.activeElement === input
            ? ''
            : String(window.getSelection() || '').trim();

        if (!findBarOpen) openFindBar();

        if (input && selected) {
            input.value = selected;
            runFind(false);
        }

        if (input) {
            input.focus();
            input.select();
        }
    }

    function findInput() {
        return el('layoutFindQuery');
    }

    // คำค้น — ตัดช่องว่างหัว/ท้ายทิ้ง เพื่อไม่ให้พิมพ์เผลอแล้วกลายเป็น "ไม่พบ"
    function findText() {
        const input = findInput();

        return input ? input.value.trim() : '';
    }

    function findReplaceText() {
        const input = el('layoutReplaceQuery');

        return input ? input.value : '';
    }

    // เปิดแถบค้นหาและแทนที่
    function openFindBar() {
        const bar = el('layoutFindBar');
        if (!bar) return;

        bar.classList.add('open');
        findBarOpen = true;

        const input = findInput();

        if (input) {
            // ค้นจากสิ่งที่พิมพ์ค้างไว้หรือไม่ก็ได้ (ผู้ใช้อาจกลับมาเปิดแถบซ้ำ)
            runFind(true);
            input.focus();
            input.select();
        }
    }

    // ปิดแถบค้นหาและแทนที่ (ล้างผลค้นหา/ไฮไลต์ด้วย)
    function closeFindBar() {
        const bar = el('layoutFindBar');

        if (bar) bar.classList.remove('open');

        findBarOpen = false;
        clearFind();
    }

    // ปิดแถบค้นหาเฉพาะแถบ — ไม่ล้างผลค้นหา/ไฮไลต์ (ใช้ได้ตอนผู้ใช้ปิดแถบเอง)
    function dismissFindBar() {
        const bar = el('layoutFindBar');

        if (bar) bar.classList.remove('open');

        findBarOpen = false;
    }

    // ล้างผลค้นหา (ไฮไลต์ที่ค้างในเอกสารถูกล้างไปด้วย)
    function clearFind() {
        findMatches = [];
        findIndex = -1;

        clearFindHighlights();
        updateFindCount();
    }

    function clearFindHighlights() {
        if (!highlightSupported()) return;

        scope.CSS.highlights.delete(FIND_HIGHLIGHT);
        scope.CSS.highlights.delete(FIND_CURRENT_HIGHLIGHT);
    }

    // ── ค้นหา ──

    // ย่อหน้าที่ค้นและแทนที่ได้ = ย่อหน้าเนื้อเรื่องที่แก้ไขได้
    // (ย่อหน้าที่จับคู่ต้นฉบับไม่ได้ หรือตอนปิด "แก้ไขข้อความ" จะข้ามไป)
    function findableParagraphs() {
        return bodyParagraphs().filter(function (paragraph) {
            return paragraph.isContentEditable;
        });
    }

    // หาทุกตำแหน่งของ query ในเอกสาร (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
    // คืน [{ range, paragraph }] เรียงตามลําดับในเอกสาร
    //
    // ใช้ paragraphTextMap/nodeAtOffset (ตัวเดียวกับไฮไลต์ {{field}}) เพราะ
    // docx-preview แยกข้อความย่อหน้าเดียวเป็นหลาย TextNode (คำ/{{field}} คนละ span)
    function collectFindMatches(query) {
        const matches = [];

        if (!query || !host) return matches;

        const needle = query.toLowerCase();

        findableParagraphs().forEach(function (paragraph) {
            const map = paragraphTextMap(paragraph);
            const haystack = map.text.toLowerCase();

            let pos = 0;

            while (pos <= haystack.length - needle.length) {
                const index = haystack.indexOf(needle, pos);

                if (index === -1) break;

                const start = nodeAtOffset(map.items, index, false);
                const end = nodeAtOffset(map.items, index + query.length, true);

                if (start && end) {
                    try {
                        const range = document.createRange();

                        range.setStart(start.node, start.offset);
                        range.setEnd(end.node, end.offset);

                        matches.push({ range: range, paragraph: paragraph });
                    } catch (error) {
                        console.warn('สร้างช่วงข้อความที่ค้นหาไม่สำเร็จ', {
                            query: query,
                            error: error
                        });
                    }
                }

                // ค้นต่อจากท้ายคำที่พบ (ไม่นับซ้อนกันเอง)
                pos = index + query.length;
            }
        });

        return matches;
    }

    // ค้นหาใหม่ทั้งเอกสาร — keepIndex = คงตำแหน่งปัจจุบันไว้ (ใช้หลังการแทนที่)
    function runFind(keepIndex) {
        const query = findText();
        const previous = keepIndex ? findIndex : 0;

        findMatches = collectFindMatches(query);

        if (findMatches.length === 0) {
            findIndex = -1;
        } else {
            // ตำแหน่งที่จำไว้เกินจำนวนที่เหลือ = วนกลับไปตำแหน่งแรก
            findIndex = previous >= 0 && previous < findMatches.length ? previous : 0;
        }

        // ไม่มีอะไรให้ค้นเลย เพราะปิด "แก้ไขข้อความ" อยู่ (ย่อหน้าถูกล็อกทั้งหมด)
        // บอกให้ตรง ๆ ไม่ปล่อยให้เห็นแค่ "ไม่พบ"
        if (query && findMatches.length === 0 && findableParagraphs().length === 0) {
            setStatus('ปิด "แก้ไขข้อความ" อยู่ — เปิดก่อนจึงจะค้นหาและแทนที่ได้', 'warn');
        }

        renderFindHighlights();
        updateFindCount();
        scrollToFindMatch();
    }

    // ไฮไลต์ทุกตำแหน่งที่พบ + ตำแหน่งที่กำลังอยู่
    function renderFindHighlights() {
        if (!highlightSupported()) return;

        clearFindHighlights();

        if (findMatches.length === 0) return;

        const all = new scope.Highlight();

        findMatches.forEach(function (match) {
            all.add(match.range);
        });

        scope.CSS.highlights.set(FIND_HIGHLIGHT, all);

        const currentMatch = findMatches[findIndex];

        if (currentMatch) {
            scope.CSS.highlights.set(
                FIND_CURRENT_HIGHLIGHT,
                new scope.Highlight(currentMatch.range)
            );
        }
    }

    // ตัวเลข "ตำแหน่งที่เท่าไร/ทั้งหมด" บนแถบค้นหา
    function updateFindCount() {
        const counter = el('layoutFindCount');

        if (!counter) return;

        if (findMatches.length === 0) {
            counter.textContent = findText() ? 'ไม่พบ' : '';
            return;
        }

        counter.textContent = (findIndex + 1) + '/' + findMatches.length;
    }

    // เลื่อนเอกสารให้เห็นตำแหน่งที่ค้นหา (เฉพาะที่อยู่นอกจอ)
    function scrollToFindMatch() {
        const match = findMatches[findIndex];
        const body = el('layoutBody');

        if (!match || !body) return;

        let rect = null;

        try {
            rect = match.range.getBoundingClientRect();
        } catch (error) {
            rect = null;
        }

        if (!rect || (!rect.width && !rect.height)) return;

        const view = body.getBoundingClientRect();

        if (rect.top < view.top || rect.bottom > view.bottom) {
            body.scrollTop += rect.top - view.top - (view.height - rect.height) / 2;
        }
    }

    // เลื่อนไปตำแหน่งก่อนหน้า/ถัดไป (วนกลับหัว/ท้ายเมื่อสุด)
    function stepFindMatch(step) {
        if (findMatches.length === 0) return;

        findIndex = (findIndex + step + findMatches.length) % findMatches.length;

        renderFindHighlights();
        updateFindCount();
        scrollToFindMatch();
    }

    // ── แทนที่ ──

    // แทนที่ข้อความในช่วงที่กำหนดด้วยข้อความล้วน (คงรูปแบบของ run ที่ครอบข้อความไว้)
    //
    // แก้ที่ DOM ที่เรนเดอร์อยู่ ไม่ใช่ String ของ word/document.xml — การตัด String
    // ที่ offset ของ XML จะตัดกลางแท็กและทำให้ไฟล์เสีย
    // พอเป็น "การแก้ในหน้าเอกสาร" แล้วเส้นทางบันทึกเดิม (collectEdits →
    // Replace.setParagraphTexts) จะเขียนข้อความใหม่ลง XML ตอนกดบันทึกเอง
    function replaceRange(match, text) {
        try {
            match.range.deleteContents();

            if (text) match.range.insertNode(document.createTextNode(text));
        } catch (error) {
            console.warn('แทนที่ข้อความไม่สำเร็จ', error);
            return false;
        }

        // นับเป็น "แก้ไข" เหมือนพิมพ์เอง — ปุ่มบันทึก/ไฮไลต์/สถานะอัปเดตตาม
        touchParagraph(match.paragraph);
        scheduleFieldHighlight();
        scheduleLayoutFix();
        updateDirty();

        return true;
    }

    // แทนที่ตำแหน่งที่กำลังอยู่ แล้วเลื่อนไปตำแหน่งถัดไป (เหมือน Word)
    function replaceCurrentMatch() {
        const query = findText();

        if (!query) {
            setStatus('กรุณาระบุข้อความที่ค้นหา', 'warn');
            return;
        }

        if (findMatches.length === 0) runFind(false);

        const target = findMatches[findIndex];

        if (!target) {
            setStatus('ไม่พบข้อความที่จะแทนที่', 'warn');
            return;
        }

        if (!replaceRange(target, findReplaceText())) {
            setStatus('แทนที่ข้อความไม่สำเร็จ', 'error');
            return;
        }

        // ค้นใหม่ (ตำแหน่งขยับแล้ว) โดยคง index เดิม = เลื่อนไปตำแหน่งถัดไปเอง
        runFind(true);

        setStatus('แทนที่แล้ว 1 ตำแหน่ง', 'ok');
    }

    // แทนที่ทุกตำแหน่ง — ทำจากท้ายมาหน้า เพื่อไม่ให้ช่วงที่อยู่ก่อนหน้าถูกทำให้เสีย
    function replaceAllMatches() {
        const query = findText();

        if (!query) {
            setStatus('กรุณาระบุข้อความที่ค้นหา', 'warn');
            return;
        }

        if (findMatches.length === 0) runFind(false);

        if (findMatches.length === 0) {
            setStatus('ไม่พบข้อความที่จะแทนที่', 'warn');
            return;
        }

        const text = findReplaceText();
        let done = 0;

        for (let i = findMatches.length - 1; i >= 0; i--) {
            if (replaceRange(findMatches[i], text)) done++;
        }

        runFind(false);

        setStatus(
            'แทนที่ทั้งหมด ' + done + ' ตำแหน่ง' +
            (findMatches.length > 0
                ? ' · ยังเหลือ ' + findMatches.length + ' ตำแหน่งที่ตรงกับคำค้น (ข้อความที่แทนลงไปตรงกับคำค้น)'
                : ''),
            'ok'
        );
    }

    // กด Enter เพิ่มย่อหน้าใหม่ไม่ได้ — w:p ใหม่ต้องสร้างใน Word
    function onKeydown(event) {
        if (event.key !== 'Enter') return;

        // กำลังเลือก field อยู่ = Enter คือ "ใช้ field ที่เลือก" (ดู onFieldKeydown)
        if (fieldMenuOpen()) return;

        // ทั้งเอกสารเป็นช่องเดียว → เจอ .layout-edit ก็ถือว่าอยู่ในช่องแก้ไข
        const region = event.target && event.target.closest
            ? event.target.closest('.layout-para, .layout-edit')
            : null;

        if (!region || !region.isContentEditable) return;

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
        touchParagraph(caretParagraph() || paragraphOf(event.target));
        scheduleFieldHighlight();
        scheduleLayoutFix();
        updateDirty();
    }

    // วางเป็นข้อความล้วน — วางจาก Word จะพา span/สไตล์ขยะเข้ามาในเอกสาร
    function onPaste(event) {
        const region = event.target && event.target.closest
            ? event.target.closest('.layout-para, .layout-edit')
            : null;

        if (!region || !region.isContentEditable) return;

        event.preventDefault();

        const text = (event.clipboardData || window.clipboardData).getData('text/plain') || '';

        if (!text) return;

        document.execCommand('insertText', false, text.replace(/\s*\r?\n\s*/g, ' '));
    }

    function buildOverlay() {
        if (overlay) {
            return;
        }

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

        // สร้าง popup ค้นหาและแทนที่ (สร้างหลังจาก overlay พร้อมแล้ว)
        // ช่องค้นหาและแทนที่ถูกเพิ่มใน getHTML() แล้ว (layout-find-bar)

        const editToggle = el('layoutEditToggle');
        if (editToggle) editToggle.addEventListener('change', applyEditToggle);

        const fieldToggle = el('layoutFieldToggle');
        if (fieldToggle) fieldToggle.addEventListener('change', applyFieldHighlight);

        const marksToggle = el('layoutMarksToggle');
        if (marksToggle) marksToggle.addEventListener('change', applyFormatMarks);

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

        // --- แถบค้นหา / แทนที่ ---
        const findToggle = el('layoutFindToggle');
        const findQuery = findInput();
        const replaceQuery = el('layoutReplaceQuery');
        const findPrev = el('layoutFindPrev');
        const findNext = el('layoutFindNext');
        const replaceBtn = el('layoutReplaceBtn');
        const replaceAllBtn = el('layoutReplaceAllBtn');
        const findClose = el('layoutFindClose');

        if (findToggle) {
            findToggle.addEventListener('click', function () {
                if (findBarOpen) closeFindBar();
                else openFindBar();
            });
        }

        if (findClose) {
            findClose.addEventListener('click', function () {
                closeFindBar();
            });
        }

        if (findQuery) {
            // พิมพ์แล้วค้นใหม่ทันที (กลับไปตำแหน่งแรกเสมอ)
            findQuery.addEventListener('input', function () {
                runFind(false);
            });

            findQuery.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    // กันไม่ให้ handler ชั้น document ปิดหน้าต่างต่อ
                    event.preventDefault();
                    event.stopPropagation();
                    closeFindBar();
                    return;
                }

                if (event.key !== 'Enter') return;

                event.preventDefault();

                if (findMatches.length === 0) runFind(false);
                else stepFindMatch(event.shiftKey ? -1 : 1);
            });
        }

        if (replaceQuery) {
            replaceQuery.addEventListener('keydown', function (event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    closeFindBar();
                    return;
                }

                if (event.key !== 'Enter') return;

                event.preventDefault();
                replaceCurrentMatch();
            });
        }

        if (findPrev) {
            findPrev.addEventListener('click', function () {
                if (findMatches.length === 0) {
                    runFind(false);
                    if (!findText()) {
                        setStatus('ระบุคำค้นหาแล้วกด Enter ค้นหา ก่อนจะใช้ลูกศรได้', 'warn');
                    } else {
                        setStatus('ไม่พบคำว่า ' + findText(), 'warn');
                    }
                } else stepFindMatch(-1);
            });
        }

        if (findNext) {
            findNext.addEventListener('click', function () {
                if (findMatches.length === 0) {
                    runFind(false);
                    if (!findText()) {
                        setStatus('ระบุคำค้นหาแล้วกด Enter ค้นหา ก่อนจะใช้ลูกศรได้', 'warn');
                    } else {
                        setStatus('ไม่พบคำว่า ' + findText(), 'warn');
                    }
                } else stepFindMatch(1);
            });
        }

        if (replaceBtn) {
            replaceBtn.addEventListener('click', replaceCurrentMatch);
        }

        if (replaceAllBtn) {
            replaceAllBtn.addEventListener('click', replaceAllMatches);
        }

        const saveBtn = el('layoutSaveBtn');

        // ต้องเรียก save(false) ไม่ใช่ส่ง event ตรง ๆ — ไม่งั้น event กลายเป็นค่า
        // silent=true แล้วกล่องยืนยันการบันทึกจะถูกข้ามไป
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                save(false);
            });
        }

        const downloadBtn = el('layoutDownloadBtn');
        if (downloadBtn) downloadBtn.addEventListener('click', download);

        const replaceFileBtn = el('layoutReplaceFileBtn');
        if (replaceFileBtn) replaceFileBtn.addEventListener('click', openReplacePicker);

        const replaceFileInput = el('layoutReplaceFileInput');
        if (replaceFileInput) replaceFileInput.addEventListener('change', onReplaceFileChosen);

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
        host.addEventListener('keydown', onFieldKeydown);
        host.addEventListener('paste', onPaste);

        // คลิกขวาที่ {{field}} = เมนูแก้รายละเอียด field / ไฮไลต์ทุกที่ที่ใช้
        host.addEventListener('contextmenu', onContextMenu);

        // คลิกที่อื่นในเอกสาร = เคอร์เซอร์ย้าย popup ของเอกสารปิดไปเลย
        // (กล่องแก้รายละเอียด field อยู่ชั้นบนสุด — ปิดด้วยปุ่ม/ฉากหลัง/Esc เท่านั้น)
        document.addEventListener('mousedown', function (event) {
            if (contextMenuOpen() && !contextMenu.contains(event.target)) {
                closeContextMenu();
            }

            if (!fieldMenuOpen()) return;
            if (fieldMenu.contains(event.target)) return;

            closeFieldMenu();
        });

        // เลื่อนดูเอกสาร = popup หลุดจากตำแหน่งเคอร์เซอร์ ให้ปิดแทนการยึดติด
        overlay.addEventListener('scroll', function () {
            if (fieldMenuOpen()) closeFieldMenu();
            if (contextMenuOpen()) closeContextMenu();
        }, true);

        // เลือกข้อความใหม่ = อัปเดตสถานะปุ่มจัดรูปแบบ
        document.addEventListener('selectionchange', function () {
            if (!overlay.classList.contains('open')) return;

            refreshFormatButtons();
        });

        document.addEventListener('keydown', function (event) {
            // Ctrl+F / Ctrl+H = เปิดแถบค้นหาและแทนที่ (ทำงานเมื่อ overlay เปิดอยู่)
            if (isFindShortcut(event) && overlay.classList.contains('open')) {
                event.preventDefault();
                onFindKeydown(event);
                return;
            }

            if (event.key !== 'Escape') return;
            if (!overlay.classList.contains('open')) return;

            // Esc ทีละชั้น: แถบค้นหา → กล่องแก้ field → เมนูคลิกขวา → ไฮไลต์ field → ปิดหน้าต่าง
            if (findBarOpen) {
                event.preventDefault();
                closeFindBar();
                return;
            }

            if (fieldModalOpen()) {
                event.preventDefault();
                closeFieldDialog();
                return;
            }

            if (contextMenuOpen()) {
                event.preventDefault();
                closeContextMenu();
                return;
            }

            if (fieldFocus) {
                event.preventDefault();
                clearFieldFocus();
                setStatus('');
                return;
            }

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
