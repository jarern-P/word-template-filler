// Preview Dialog - ตัวอย่างเอกสารหลังแทนค่า {{field}} ก่อนกดดาวน์โหลด
//
// โครงเดียวกับ components/masterLookup.js: สร้าง overlay ครั้งเดียวแล้วใช้ซ้ำ
//
// อ่านข้อความตามลำดับย่อหน้าจาก word/document.xml ต้นฉบับ แล้วแทน {{field}} ด้วยค่าที่จะเขียนจริง
// - ค่าที่กรอกแล้ว      = ไฮไลต์สีชมพู (ชี้เมาส์เห็นชื่อ field)
// - field ที่ยังไม่ได้กรอก = แสดง {{field}} สีเตือน ให้เห็นว่าเอกสารยังไม่ครบ
//
// ตั้งใจไม่แสดงรูปแบบ/ฟอนต์ เพราะการเรนเดอร์ Word ให้เหมือนจริงต้องใช้ไลบรารีเพิ่ม
// (ตัวอย่างนี้มีไว้ตรวจว่า "ค่าลงถูกช่องหรือไม่" ไม่ใช่ตรวจหน้าตาเอกสาร)
//
// field ที่เป็น type Table (ย่อหน้ามีแต่ {{field}}) จะวาดเป็นตารางให้เห็นคอลัมน์ แถว
// และช่องที่ผสานกัน — ตรงกับตาราง Word ที่จะถูกสร้างลงเอกสาร
(function (scope) {
    'use strict';

    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    // ชื่อ field ชุดเดียวกับ extract.js / replace.js
    const FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_ก-๙]+)\s*\}\}/g;

    const HTML = [
        '<div class="preview-backdrop" data-preview-close></div>',
        '<div class="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="previewTitle">',
        '    <div class="preview-head">',
        '        <h2 id="previewTitle">ตัวอย่างเอกสาร</h2>',
        '        <button type="button" class="preview-close" data-preview-close aria-label="ปิด">&times;</button>',
        '    </div>',
        '    <p id="previewMeta" class="preview-meta"></p>',
        '    <div id="previewBody" class="preview-body"></div>',
        '    <div id="previewNotes" class="preview-notes"></div>',
        '    <p class="preview-foot">ตัวอย่างนี้แสดงเฉพาะข้อความตามลำดับย่อหน้า ' +
            '(ตารางแสดงแบบง่าย ไม่มีฟอนต์/ระยะห่างของเอกสาร) — ' +
            'ตรวจแล้วกด "Download DOCX" เพื่อบันทึกไฟล์</p>',
        '</div>'
    ].join('\n');

    let overlay = null;   // popup (สร้างครั้งเดียวตอนเปิดครั้งแรก)

    function el(id) {
        return document.getElementById(id);
    }

    // ──────────────────────────────────────────────────────────────
    // อ่านข้อความจากเอกสาร
    // ──────────────────────────────────────────────────────────────

    // รวมข้อความในย่อหน้าเดียว โดยไล่ตามลำดับในเอกสาร
    // w:t เก็บข้อความ ส่วนแท็บ/ขึ้นบรรทัดใหม่เป็น element แยก จึงต้องเติมกลับเข้าไป
    // ไม่งั้นคำที่คั่นด้วยแท็บจะติดกันอ่านไม่ออก
    function paragraphText(paragraph) {
        let text = '';

        function walk(node) {
            for (let i = 0; i < node.childNodes.length; i++) {
                const child = node.childNodes[i];

                if (child.nodeType !== 1) continue;

                const name = child.localName;

                if (name === 't') {
                    text += child.textContent || '';
                    continue;
                }

                if (name === 'tab') {
                    text += '\t';
                    continue;
                }

                if (name === 'br' || name === 'cr') {
                    text += ' ';
                    continue;
                }

                // รูป/กล่องข้อความ/แผนภูมิ ไม่ใช่เนื้อเรื่องที่ผู้ใช้ตรวจ
                if (name === 'drawing' || name === 'pict' || name === 'object' || name === 'txbxContent') {
                    continue;
                }

                walk(child);
            }
        }

        walk(paragraph);
        return text;
    }

    // คืนข้อความของแต่ละย่อหน้าตามลำดับในเอกสาร (null = อ่านไฟล์ไม่ได้)
    function documentParagraphs(xml) {
        const doc = new DOMParser().parseFromString(xml, 'application/xml');

        if (doc.getElementsByTagName('parsererror').length > 0) {
            return null;
        }

        // ย่อหน้าในตารางเป็น w:p เหมือนกัน จึงได้ข้อความในตารางตามลำดับที่ควร
        const nodes = doc.getElementsByTagNameNS(W_NS, 'p');
        const lines = [];

        for (const node of nodes) {
            const text = paragraphText(node);

            if (text.trim() === '') {
                // ย่อหน้าว่างติดกันหลายอันย่อให้เหลือบรรทัดว่างเดียว
                if (lines.length > 0 && lines[lines.length - 1] !== '') {
                    lines.push('');
                }

                continue;
            }

            lines.push(text);
        }

        while (lines.length > 0 && lines[0] === '') lines.shift();
        while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

        return lines;
    }

    // ──────────────────────────────────────────────────────────────
    // แบ่งข้อความเป็นช่วง
    // ──────────────────────────────────────────────────────────────

    // ได้ทั้งข้อความคงที่ ช่วงที่เป็นค่าที่จะเขียนลงเอกสาร และ field ที่ยังไม่ได้กรอก
    // skipFields = field ที่เป็นตาราง (ถูกวาดเป็นตารางแยกอยู่แล้ว ไม่ต้องแทนในข้อความ)
    function splitSegments(text, values, skipFields) {
        const segments = [];
        const regex = new RegExp(FIELD_PATTERN.source, 'g');
        const skip = skipFields || [];

        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                segments.push({ text: text.slice(lastIndex, match.index) });
            }

            const field = match[1];

            if (skip.indexOf(field) !== -1) {
                lastIndex = match.index + match[0].length;
                continue;
            }
            const raw = values ? values[field] : undefined;
            const value = (raw === null || raw === undefined) ? '' : String(raw);

            segments.push({
                field: field,
                text: value.trim() === '' ? match[0] : value,
                missing: value.trim() === ''
            });

            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            segments.push({ text: text.slice(lastIndex) });
        }

        return segments;
    }

    // สร้าง DOM ทีละ node (ไม่ใช้ innerHTML) เพราะค่ามาจากผู้ใช้
    function renderSegment(segment) {
        if (!segment.field) {
            return document.createTextNode(segment.text);
        }

        const mark = document.createElement('mark');

        mark.className = segment.missing ? 'preview-missing' : 'preview-value';
        mark.textContent = segment.text;

        // ชี้เมาส์ที่เครื่องหมายจะเห็นว่าเป็น field ไหน
        mark.title = segment.missing
            ? 'ยังไม่ได้กรอก: ' + segment.field
            : segment.field;

        return mark;
    }

    // ──────────────────────────────────────────────────────────────
    // ตาราง (type = table)
    // ──────────────────────────────────────────────────────────────

    // field ที่เป็นตารางและมีแถวแล้วในบรรทัดนี้ (มีแถว = จะถูกวาดเป็นตารางจริง)
    // field ที่ตั้งเป็นตารางแต่ยังไม่มีแถว ปล่อยให้ขึ้นเป็น "ยังไม่ได้กรอก" ตามเดิม
    function lineTableFields(line, tables) {
        if (!tables) return [];

        const regex = new RegExp(FIELD_PATTERN.source, 'g');
        const fields = [];

        let match;

        while ((match = regex.exec(line || '')) !== null) {
            const spec = tables[match[1]];

            if (!spec || fields.indexOf(match[1]) !== -1) continue;
            if (!Array.isArray(spec.rows) || spec.rows.length === 0) continue;

            fields.push(match[1]);
        }

        return fields;
    }

    // ขนาดกลุ่มช่องของแถว (1 = ไม่ผสาน) ให้ตรงกับจำนวนคอลัมน์เสมอ
    function normalizeSpans(spans, columnCount) {
        const list = Array.isArray(spans)
            ? spans.map(function (value) {
                return Math.max(Math.round(Number(value)) || 1, 1);
            })
            : [];

        const sum = list.reduce(function (all, value) {
            return all + value;
        }, 0);

        const separated = [];

        for (let i = 0; i < columnCount; i++) {
            separated.push(1);
        }

        return list.length > 0 && sum === columnCount ? list : separated;
    }

    // รูปแบบข้อความในช่อง (จัดตำแหน่ง / ตัวหนา / ตัวเอียง) — ค่าตั้งต้นชิดซ้าย
    function normalizeCellStyle(style) {
        const raw = style && typeof style === 'object' ? style : {};

        return {
            align: raw.align === 'center' || raw.align === 'right' ? raw.align : 'left',
            bold: raw.bold === true,
            italic: raw.italic === true
        };
    }

    // วาดตารางแบบง่าย: หัวคอลัมน์ + แถวข้อมูล (ช่องที่ผสานแสดงเป็นช่องเดียว)
    function renderTable(spec) {
        const table = document.createElement('table');
        table.className = 'preview-table';

        const columns = Array.isArray(spec.columns) ? spec.columns : [];
        const rows = Array.isArray(spec.rows) ? spec.rows : [];

        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');

        columns.forEach(function (name, index) {
            const th = document.createElement('th');
            th.textContent = name || ('คอลัมน์ ' + (index + 1));
            headRow.appendChild(th);
        });

        thead.appendChild(headRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        const rowSpans = Array.isArray(spec.rowSpans) ? spec.rowSpans : [];
        const cellStyles = Array.isArray(spec.cellStyles) ? spec.cellStyles : [];

        rows.forEach(function (row, rowIndex) {
            const tr = document.createElement('tr');
            const styleRow = Array.isArray(cellStyles[rowIndex]) ? cellStyles[rowIndex] : [];

            let columnIndex = 0;

            normalizeSpans(rowSpans[rowIndex], columns.length).forEach(function (span) {
                const td = document.createElement('td');
                td.colSpan = span;
                td.textContent =
                    row && row[columnIndex] != null ? String(row[columnIndex]) : '';

                const style = normalizeCellStyle(styleRow[columnIndex]);

                if (style.align === 'center' || style.align === 'right') {
                    td.style.textAlign = style.align;
                }

                if (style.bold) td.style.fontWeight = '700';
                if (style.italic) td.style.fontStyle = 'italic';

                tr.appendChild(td);
                columnIndex += span;
            });

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);

        const wrapper = document.createElement('div');
        wrapper.className = 'preview-table-wrap';
        wrapper.appendChild(table);

        return wrapper;
    }

    // ──────────────────────────────────────────────────────────────
    // เปิด / ปิด
    // ──────────────────────────────────────────────────────────────

    function close() {
        if (overlay) {
            overlay.classList.remove('open');
        }
    }

    function buildOverlay() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'preview-overlay';
        overlay.id = 'documentPreview';
        overlay.innerHTML = HTML;

        document.body.appendChild(overlay);

        overlay.querySelectorAll('[data-preview-close]').forEach(function (node) {
            node.addEventListener('click', close);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                close();
            }
        });
    }

    // payload = { title, xml, values, notes: [{ text, kind }] }
    function open(payload) {
        buildOverlay();

        const data = payload || {};
        const lines = documentParagraphs(data.xml || '');

        const title = el('previewTitle');
        if (title) {
            title.textContent = data.title || 'ตัวอย่างเอกสาร';
        }

        const meta = el('previewMeta');
        const body = el('previewBody');
        const notes = el('previewNotes');

        body.innerHTML = '';
        notes.innerHTML = '';

        if (!lines || lines.length === 0) {
            meta.className = 'preview-meta warn';
            meta.textContent = 'อ่านข้อความจากเอกสารไม่ได้';

            const empty = document.createElement('p');
            empty.className = 'preview-para';
            empty.textContent = 'ไม่พบข้อความในไฟล์นี้';
            body.appendChild(empty);
        } else {
            // นับเป็นรายชื่อ field (field เดียวที่ใช้หลายที่ก็นับครั้งเดียว)
            const filledFields = [];
            const missingFields = [];

            lines.forEach(function (line) {
                if (line === '') {
                    const blank = document.createElement('p');
                    blank.className = 'preview-para blank';
                    body.appendChild(blank);
                    return;
                }

                // field ที่เป็นตารางในบรรทัดนี้ (จะวาดเป็นตารางต่อจากข้อความ)
                const tableFields = lineTableFields(line, data.tables);

                const paragraph = document.createElement('p');
                paragraph.className = 'preview-para';

                splitSegments(line, data.values, tableFields).forEach(function (segment) {
                    if (segment.field) {
                        const bucket = segment.missing ? missingFields : filledFields;

                        if (bucket.indexOf(segment.field) === -1) {
                            bucket.push(segment.field);
                        }
                    }

                    paragraph.appendChild(renderSegment(segment));
                });

                // บรรทัดที่มีแต่ {{field}} ของตาราง = ไม่มีย่อหน้าให้แสดง
                if (paragraph.childNodes.length > 0) {
                    body.appendChild(paragraph);
                }

                tableFields.forEach(function (field) {
                    if (filledFields.indexOf(field) === -1) {
                        filledFields.push(field);
                    }

                    body.appendChild(renderTable(data.tables[field]));
                });
            });

            meta.className = 'preview-meta' + (missingFields.length > 0 ? ' warn' : '');
            meta.textContent = [
                lines.length + ' ย่อหน้า',
                'กรอกแล้ว ' + filledFields.length + ' field',
                missingFields.length > 0
                    ? 'ยังไม่ได้กรอก ' + missingFields.length + ' field'
                    : 'กรอกครบทุก field'
            ].join(' · ');
        }

        (data.notes || []).forEach(function (note) {
            const line = document.createElement('p');

            line.className = 'preview-note' + (note.kind ? ' ' + note.kind : '');
            line.textContent = note.text;

            notes.appendChild(line);
        });

        body.scrollTop = 0;
        overlay.classList.add('open');

        const closeButton = overlay.querySelector('.preview-close');
        if (closeButton && closeButton.focus) {
            closeButton.focus();
        }
    }

    scope.PreviewDialog = {
        open: open,
        close: close
    };
})(window);
