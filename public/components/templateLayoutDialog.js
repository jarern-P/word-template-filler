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
// ไฟล์/ฐานข้อมูลเป็นเรื่องของ app.js — ที่นี่แค่เรียก payload.save / payload.download
(function (scope) {
    'use strict';

    const FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_ก-๙]+)\s*\}\}/g;

    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

    // 1 EMU = 1/914400 นิ้ว, 1 px = 1/96 นิ้ว → 914400 / 96 = 9525 EMU ต่อ px
    const EMU_PER_PX = 9525;

    // 1 twip = 1/1440 นิ้ว, 1 px = 1/96 นิ้ว → 1440 / 96 = 15 twips ต่อ px
    const TWIPS_PER_PX = 15;

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
        '        <label class="layout-toggle"><input type="checkbox" id="layoutFieldToggle" checked> ไฮไลต์ {{field}}</label>',
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
        '        <span class="layout-hint">คลิกข้อความในเอกสารแล้วพิมพ์แก้ได้เลย · หัว/ท้ายกระดาษแก้ไม่ได้</span>',
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

        prepareEditing();
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
            const text = renderedText(node);
            const fields = fieldNames(text);

            node.classList.add('layout-para');
            node.setAttribute('spellcheck', 'false');

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

    // ย่อหน้าที่ข้อความไม่เหมือนตอนเรนเดอร์ = ย่อหน้าที่ผู้ใช้แก้
    // (นับเฉพาะข้อความของย่อหน้านั้นเอง ไม่รวมของกล่องข้อความที่ซ้อนอยู่)
    function collectEdits() {
        const edits = [];

        current.pairs.forEach(function (pair, node) {
            const text = renderedText(node);

            if (text === pair.domText) return;

            edits.push({
                index: pair.index,
                text: text
            });
        });

        return edits;
    }

    function updateDirty() {
        if (!current) return;

        const changed = collectEdits().length;
        const saveBtn = el('layoutSaveBtn');

        if (saveBtn) {
            saveBtn.disabled = changed === 0;
            saveBtn.title = changed === 0
                ? 'ยังไม่มีการแก้ไขข้อความ'
                : 'บันทึกทับไฟล์ต้นฉบับของแม่แบบ';
        }

        if (changed > 0) {
            setStatus('แก้ไขแล้ว ' + changed + ' ย่อหน้า (ยังไม่บันทึก)', 'dirty');
        } else if (current.statusKind === 'dirty') {
            setStatus('');
        }
    }

    function setBusy(busy) {
        ['layoutSaveBtn', 'layoutDownloadBtn', 'layoutResetBtn'].forEach(function (id) {
            const btn = el(id);
            if (btn) btn.disabled = busy;
        });

        // บันทึกเสร็จ = ปุ่มกลับมาตามจำนวนย่อหน้าที่แก้ค้างอยู่
        if (!busy) updateDirty();
    }

    async function save() {
        if (!current || !current.payload.save) return;

        const edits = collectEdits();

        if (edits.length === 0) {
            setStatus('ยังไม่มีการแก้ไขข้อความ');
            return;
        }

        const name = current.payload.name || 'แม่แบบนี้';

        if (!window.confirm(
            'บันทึกทับไฟล์ต้นฉบับของ "' + name + '"?\n\n' +
            'แก้ข้อความ ' + edits.length + ' ย่อหน้า ลงในไฟล์ .docx ที่เก็บไว้\n' +
            'ค่า type / ล็อกตำแหน่ง / placeholder / ตาราง ของ field ที่ยังมีอยู่จะถูกเก็บไว้\n' +
            'ต้องการบันทึกหรือไม่?'
        )) {
            return;
        }

        setBusy(true);
        setStatus('กำลังบันทึก...');

        try {
            const xml = scope.Replace.setParagraphTexts(current.xml, edits);
            const bytes = await current.payload.save(xml);

            current.xml = xml;

            await renderDocx(bytes || current.bytes);

            setStatus('บันทึกแล้ว — แก้ไป ' + edits.length + ' ย่อหน้า', 'ok');

        } catch (error) {
            console.error(error);
            setStatus('บันทึกไม่สำเร็จ: ' + messageOf(error), 'error');
        } finally {
            setBusy(false);
        }
    }

    async function download() {
        if (!current || !current.payload.download) return;

        const edits = collectEdits();

        // ดาวน์โหลด = เอาไฟล์ที่แก้แล้วไปตรวจก่อน (ไม่บันทึกในฐานข้อมูล)
        const xml = edits.length > 0
            ? scope.Replace.setParagraphTexts(current.xml, edits)
            : current.xml;

        try {
            await current.payload.download(xml);
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

            plan.push({
                wrapper: wrapper,
                left: left === null ? currentLeft : left,
                top: top === null ? currentTop : top,
                behind: anchor.behindDoc
            });
        });

        plan.forEach(function (item) {
            item.wrapper.style.position = 'absolute';
            item.wrapper.style.left = item.left.toFixed(2) + 'px';
            // item.wrapper.style.top = item.top.toFixed(2) + 'px';
            item.wrapper.style.top = (item.top - 10).toFixed(2) + 'px';

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
    }

    function applyFieldHighlight() {
        const toggle = el('layoutFieldToggle');

        host.classList.toggle('show-fields', !!(toggle && toggle.checked));
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

        host.addEventListener('input', updateDirty);
        host.addEventListener('keydown', onKeydown);
        host.addEventListener('paste', onPaste);

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
