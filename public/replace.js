// Replace Module - แทน {{field}} ใน XML ด้วยค่าจาก values
// รองรับ "ล็อกตำแหน่ง" ของ field ที่ติ๊กไว้ในหน้า Template Configuration
(function (scope) {
    'use strict';

    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    // กันลูปไม่รู้จบ กรณีค่าที่แทนเข้าไปมีรูปแบบ {{field}} เหมือนเดิม
    const MAX_ITERATIONS_PER_PARAGRAPH = 10;
    // อักขระที่เป็น "ช่องว่าง" ซึ่งเพิ่ม/ลบได้ (เว้นวรรค + เว้นวรรคแบบไม่ตัดคำ)
    const SPACE_CHARS = ' \u00A0';

    function escapeRegex(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // w:t เก็บข้อความบรรทัดเดียว จึงแปลงขึ้นบรรทัดใหม่เป็นช่องว่าง
    function normalizeValue(value) {
        return String(value == null ? '' : value).replace(/\r\n?|\n/g, ' ');
    }

    // ใส่ข้อความลง text node และคงช่องว่างไว้ (Word ตัด/ยุบช่องว่างถ้าไม่มี xml:space)
    // ต้องกันทั้งช่องว่างหัว-ท้าย และช่องว่างซ้ำกลางข้อความที่มาจากการล็อกตำแหน่ง
    function setText(node, text) {
        node.textContent = text;
        if (text && (text !== text.trim() || /\s{2,}/.test(text))) {
            node.setAttribute('xml:space', 'preserve');
        }
    }

    function buildFieldRegex(fields) {
        if (fields.length === 0) return null;
        const pattern = fields.map(escapeRegex).join('|');
        return new RegExp('\\{\\{\\s*(' + pattern + ')\\s*\\}\\}', 'g');
    }

    // แปลงข้อมูล field ที่ถูกล็อกตำแหน่งให้เป็น lookup object
    // รับได้ทั้ง { A: true } และ [ 'A' ]
    function toLockedSet(lockedFields) {
        const locked = {};

        if (!lockedFields) return locked;

        if (Array.isArray(lockedFields)) {
            lockedFields.forEach(function (field) {
                if (field) locked[field] = true;
            });
            return locked;
        }

        Object.keys(lockedFields).forEach(function (field) {
            if (lockedFields[field]) locked[field] = true;
        });
        return locked;
    }

    // ──────────────────────────────────────────────────────────────
    // การวัดความกว้างข้อความ
    // ──────────────────────────────────────────────────────────────
    //
    // "ล็อกตำแหน่ง" เทียบเป็นความกว้างจริง (แนวไม้บรรทัด) ไม่ใช่จำนวนตัวอักษร
    // จึงต้องมีตัววัดที่รู้ความกว้างจริงของแต่ละตัวอักษรในฟอนต์ของเอกสาร
    //
    // แอป (renderer) จะติดตั้งตัววัดจริงจาก canvas ผ่าน setMeasurer()
    // (canvas วัดได้เป็น px แล้วแปลงเป็น cm ให้)
    //
    // ถ้ายังไม่ได้ติดตั้ง (เช่นตอนทดสอบ) ใช้ตัววัดสำรองที่ประมาณเป็น "ช่องอักษร":
    //   อักษรไทย = 2 ช่อง, อักษรละติน/ตัวเลข/เครื่องหมาย/เว้นวรรค = 1 ช่อง,
    //   สระ-วรรณยุกต์ไทยที่ซ้อนทับ (combining) = 0 ช่อง
    //
    // สำคัญ: ทุกการวัดในการชดเชยตำแหน่งต้องใช้ตัววัดตัวเดียวกัน หน่วยจึงไม่ปนกัน
    // ──────────────────────────────────────────────────────────────

    const THAI_COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/;
    const THAI_CHAR = /[\u0E01-\u0E5B]/;

    function defaultMeasure(text) {
        let width = 0;

        for (const char of String(text == null ? '' : text)) {
            // วรรณยุกต์/สระบน-ล่างซ้อนทับตัวอักษรเดิม ไม่กินความกว้างเพิ่ม
            if (THAI_COMBINING.test(char)) continue;
            width += THAI_CHAR.test(char) ? 2 : 1;
        }

        return width;
    }

    let measure = defaultMeasure;

    function setMeasurer(fn) {
        measure = typeof fn === 'function' ? fn : defaultMeasure;
    }

    // หน่วยที่ตัววัดใช้ (ตัววัดจริงบอกว่า "cm") ใช้ตอนรายงานผลให้ผู้ใช้
    function unitOf(value, unit) {
        return measure.unit === 'cm'
            ? { value: value, unit: 'cm' }
            : { value: value, unit: unit };
    }

    // ฟอนต์/ขนาดของ run ที่ข้อความ offset นี้อยู่ เพื่อวัดด้วยฟอนต์ของเอกสารจริง
    // (Word เก็บขนาดเป็น half-point เช่น w:sz val="32" = 16pt)
    function findRunFont(textNodes, parts, offset) {
        const position = locateOffset(parts, offset);

        if (!position) return null;

        let node = textNodes[position.index];

        while (node && node.nodeType === 1 && node.localName !== 'r') {
            node = node.parentNode;
        }

        if (!node || node.localName !== 'r') return null;

        const fonts = node.getElementsByTagNameNS(W_NS, 'rFonts')[0];
        const size = node.getElementsByTagNameNS(W_NS, 'sz')[0];

        return {
            // ข้อความละตินใช้ w:ascii, ข้อความไทย (complex script) ใช้ w:cs
            family: fonts ? (fonts.getAttribute('w:ascii') || '') : '',
            csFamily: fonts ? (fonts.getAttribute('w:cs') || '') : '',
            halfPoints: size
                ? Number(size.getAttribute('w:val')) || 0
                : 0
        };
    }

    // ──────────────────────────────────────────────────────────────
    // Text Node Helper
    // ──────────────────────────────────────────────────────────────

    // หา text node ที่ offset ตกอยู่ พร้อมตำแหน่งภายใน node นั้น
    function locateOffset(parts, offset) {
        let position = 0;

        for (let i = 0; i < parts.length; i++) {
            const end = position + parts[i].length;

            // ใช้ < เพื่อให้ offset ที่อยู่ตรงรอยต่อไปอยู่ที่ node ถัดไป
            if (offset < end || i === parts.length - 1) {
                return { index: i, offset: Math.max(0, offset - position) };
            }

            position = end;
        }

        return null;
    }

    // แทนข้อความช่วง [start, start + length) ด้วย replacement
    // เขียนลง text node โดยไม่ยุบรวม node เพื่อรักษารูปแบบ (ฟอนต์/ตัวหนา) ของแต่ละ run
    function applyEdit(textNodes, start, length, replacement) {
        const parts = textNodes.map(node => node.textContent || '');

        const from = locateOffset(parts, start);
        const to = locateOffset(parts, start + length);

        if (!from || !to || to.index < from.index) return false;

        const before = parts[from.index].slice(0, from.offset);
        const after = parts[to.index].slice(to.offset);

        if (from.index === to.index) {
            setText(textNodes[from.index], before + replacement + after);
            return true;
        }

        setText(textNodes[from.index], before + replacement);

        for (let i = from.index + 1; i < to.index; i++) {
            textNodes[i].textContent = '';
        }

        setText(textNodes[to.index], after);
        return true;
    }

    // ──────────────────────────────────────────────────────────────
    // การวางแผนแก้ข้อความในย่อหน้า
    // ──────────────────────────────────────────────────────────────

    // หา placeholder ทั้งหมดตามลำดับในข้อความของย่อหน้า
    function findMatches(regex, fullText) {
        const finder = new RegExp(regex.source, 'g');
        const matches = [];

        let match;
        while ((match = finder.exec(fullText)) !== null) {

            matches.push({
                field: match[1],
                raw: match[0],
                start: match.index,
                end: match.index + match[0].length
            });

            // กัน regex ที่ match ความยาว 0 ไม่ให้วนไม่จบ
            if (finder.lastIndex === match.index) finder.lastIndex++;
        }

        return matches;
    }

    // ช่องว่างที่ "ลบได้" หน้า placeholder คืนเป็นช่วง ๆ เรียงจากใกล้ placeholder ไปไกล
    // - ลบได้ทุกช่วงเว้นวรรคก่อน field นี้ ไม่ใช่เฉพาะช่องว่างติดกับ field
    //   (ช่องว่างกันคอลัมน์อยู่ก่อนหน้าป้ายชื่อ จึงต้องใช้ได้ด้วย)
    // - เว้นวรรคต้นย่อหน้า (ก่อนตัวอักษรแรก) ใช้ลบไม่ได้ เพราะเป็นตำแหน่งย่อหน้า
    // - แต่ละช่วงเหลืออย่างน้อย 1 ช่อง เพื่อไม่ให้ค่าไปติดกับข้อความ/ค่าข้างเคียง
    // - ต้องไม่ล้ำเข้าไปใน placeholder ตัวก่อนหน้า เพราะช่วงนั้นจะถูกแทนค่าทั้งก้อน
    function findRemovableSpaces(fullText, start, previousEnd) {
        const areas = [];
        let index = start - 1;

        while (index >= previousEnd) {
            if (SPACE_CHARS.indexOf(fullText.charAt(index)) === -1) {
                index--;
                continue;
            }

            let begin = index;

            while (
                begin > previousEnd &&
                SPACE_CHARS.indexOf(fullText.charAt(begin - 1)) !== -1
            ) {
                begin--;
            }

            const isIndent = !/\S/.test(fullText.slice(0, begin));

            if (!isIndent) {
                areas.push({
                    start: begin,
                    removable: index - begin   // หัก 1 ช่องไว้กันข้อความติดกัน
                });
            }

            index = begin - 1;
        }

        return areas.filter(area => area.removable > 0);
    }

    // ช่องว่างที่ "ลบได้" ด้านหลัง field (จาก start ไปทางขวาถึง limit)
    // เรียงจากใกล้ field ไปไกล และต้องไม่เลยเข้าไปใน placeholder ตัวถัดไป
    function findRemovableSpacesAfter(fullText, start, limit) {
        const areas = [];
        let index = start;

        while (index < limit) {
            if (SPACE_CHARS.indexOf(fullText.charAt(index)) === -1) {
                index++;
                continue;
            }

            let end = index;

            while (end < limit && SPACE_CHARS.indexOf(fullText.charAt(end)) !== -1) {
                end++;
            }

            areas.push({
                start: index,
                removable: end - index - 1   // หัก 1 ช่องไว้กันข้อความติดกัน
            });

            index = end;
        }

        return areas.filter(area => area.removable > 0);
    }

    function totalRemovable(areas) {
        return areas.reduce((sum, area) => sum + area.removable, 0);
    }

    // เก็บคำเตือน "ล็อกตำแหน่งไม่ได้" (field + ด้าน เตือนครั้งเดียว)
    function addWarning(warnings, field, side, needed, available, spaceWidth) {
        if (warnings.some(item => item.field === field && item.side === side)) return;

        const missing = needed - available;

        warnings.push({
            field: field,
            side: side,
            needed: needed,
            available: available,
            // ระยะที่ยังชดเชยไม่ได้ (cm) ใช้แสดงให้ผู้ใช้เห็นว่าคลาดไปเท่าไร
            missing: unitOf(missing * spaceWidth, 'ช่อง')
        });

        console.warn(
            'ล็อกตำแหน่ง: ช่องว่างด้าน' + (side === 'before' ? 'หน้า' : 'หลัง') +
            'ของ "' + field + '" ไม่พอ ต้องลบ ' + needed +
            ' ช่อง แต่ลบได้ ' + available + ' ช่อง'
        );
    }

    // เก็บว่าชดเชยตำแหน่งอะไรไปแล้วบ้าง (แสดงบนหน้ารายงาน)
    function addApplied(applied, field, side, action, count, distance) {
        const found = applied.find(item => item.field === field && item.side === side);

        if (found) {
            found.count += count;
            found.distance = unitOf(found.distance.value + distance.value, distance.unit);
            return;
        }

        applied.push({
            field: field,
            side: side,
            action: action,
            count: count,
            distance: distance
        });
    }

    // ── ด้านหน้า: ทำให้ field ที่ล็อก "เริ่ม" ที่ตำแหน่งเดิมของ template ──
    // ตำแหน่งเริ่มต้น = ตำแหน่งใน template + ผลต่างความกว้างจากค่าที่แทนไปแล้ว
    //                + ความกว้างที่ชดเชยด้วยช่องว่างไปแล้ว
    // ค่าสั้นกว่า -> เติมช่องว่างด้านหน้า / ค่ายาวกว่า -> ลบช่องว่างด้านหน้า
    function lockStartEdits(match, context) {
        const areas = findRemovableSpaces(context.fullText, match.start, context.previousEnd);

        const spaceWidth = measure(' ', areas.length > 0
            ? findRunFont(context.textNodes, context.parts, areas[0].start)
            : context.font);

        if (!(spaceWidth > 0)) return null;

        const delta = context.widthDelta + context.correction;

        // คลาดเคลื่อนไม่ถึงครึ่งช่อง ถือว่าอยู่ตำแหน่งเดิมแล้ว
        if (Math.abs(delta) <= spaceWidth / 2) return null;

        if (delta < 0) {
            const count = Math.round(-delta / spaceWidth);

            context.correction += count * spaceWidth;
            addApplied(context.applied, match.field, 'before', 'add', count,
                unitOf(count * spaceWidth, 'ช่อง'));

            return [{ start: match.start, end: match.start, text: ' '.repeat(count) }];
        }

        const needed = Math.round(delta / spaceWidth);
        const edits = [];

        let remaining = needed;

        for (const area of areas) {
            if (remaining <= 0) break;

            const remove = Math.min(remaining, area.removable);

            edits.push({ start: area.start, end: area.start + remove, text: '' });

            remaining -= remove;
            context.correction -= remove * spaceWidth;
        }

        const removed = needed - remaining;

        if (removed > 0) {
            addApplied(context.applied, match.field, 'before', 'remove', removed,
                unitOf(removed * spaceWidth, 'ช่อง'));
        }

        if (remaining > 0) {
            addWarning(context.warnings, match.field, 'before', needed,
                totalRemovable(areas), spaceWidth);
        }

        return edits.length > 0 ? edits : null;
    }

    // ── ด้านหลัง: ทำให้ข้อความที่ตามหลัง field ที่ล็อกอยู่ตำแหน่งเดิมของ template ──
    // ช่องของ field = ความกว้างของ {{field}} เดิม ซึ่งรวมปีกกา {{ }} ที่อยู่ในเอกสารจริง
    //   ค่าสั้นกว่า -> เติมช่องว่างหลังค่า ให้ข้อความถัดไปไม่เลื่อนเข้ามา
    //   ค่ายาวกว่า -> ลบช่องว่างหลังค่า (ถ้า field ถัดไปล็อกอยู่ ให้ตัวนั้นจัดการแทน)
    function lockEndEdits(match, deltaSelf, context, nextIsLocked) {
        const limit = context.nextStart === null ? context.fullText.length : context.nextStart;

        // ไม่มีข้อความตามหลัง ก็ไม่มีตำแหน่งต้องรักษา
        if (!/\S/.test(context.fullText.slice(match.end, limit))) return null;

        const areas = findRemovableSpacesAfter(context.fullText, match.end, limit);

        const spaceWidth = measure(' ', areas.length > 0
            ? findRunFont(context.textNodes, context.parts, areas[0].start)
            : context.font);

        if (!(spaceWidth > 0)) return null;

        if (Math.abs(deltaSelf) <= spaceWidth / 2) return null;

        if (deltaSelf < 0) {
            const count = Math.round(-deltaSelf / spaceWidth);

            context.correction += count * spaceWidth;
            addApplied(context.applied, match.field, 'after', 'add', count,
                unitOf(count * spaceWidth, 'ช่อง'));

            return [{ start: match.end, end: match.end, text: ' '.repeat(count) }];
        }

        // ช่องว่างช่วงเดียวกันจะถูกชดเชยด้วยการลบของ field ที่ล็อกตัวถัดไป
        if (nextIsLocked) return null;

        const needed = Math.round(deltaSelf / spaceWidth);
        const edits = [];

        let remaining = needed;

        for (const area of areas) {
            if (remaining <= 0) break;

            const remove = Math.min(remaining, area.removable);

            edits.push({ start: area.start, end: area.start + remove, text: '' });

            remaining -= remove;
            context.correction -= remove * spaceWidth;
        }

        const removed = needed - remaining;

        if (removed > 0) {
            addApplied(context.applied, match.field, 'after', 'remove', removed,
                unitOf(removed * spaceWidth, 'ช่อง'));
        }

        if (remaining > 0) {
            addWarning(context.warnings, match.field, 'after', needed,
                totalRemovable(areas), spaceWidth);
        }

        return edits.length > 0 ? edits : null;
    }

    // วางแผนแก้ข้อความทั้งย่อหน้า (offset อ้างอิงข้อความต้นฉบับของย่อหน้านี้)
    function buildEdits(textNodes, parts, fullText, matches, values, locked, warnings, applied) {
        const edits = [];

        const context = {
            textNodes: textNodes,
            parts: parts,
            fullText: fullText,
            warnings: warnings,
            applied: applied,
            font: null,
            nextStart: null,
            widthDelta: 0,     // ความกว้างที่ค่าจริงต่างจาก placeholder สะสม
            correction: 0,     // ความกว้างที่ชดเชยไปแล้วด้วยช่องว่าง
            previousEnd: 0
        };

        for (let i = 0; i < matches.length; i++) {
            const match = matches[i];
            const next = matches[i + 1] || null;

            const value = normalizeValue(values[match.field]);

            context.font = findRunFont(textNodes, parts, match.start);
            context.nextStart = next ? next.start : null;

            const rawWidth = measure(match.raw, context.font);
            const valueWidth = measure(value, context.font);

            if (locked[match.field] === true) {
                // ตำแหน่งเริ่มต้นของ field
                pushEdits(edits, lockStartEdits(match, context));

                // ตำแหน่งของข้อความที่ตามหลัง field
                pushEdits(edits, lockEndEdits(
                    match,
                    valueWidth - rawWidth,
                    context,
                    next ? locked[next.field] === true : false
                ));
            }

            edits.push({ start: match.start, end: match.end, text: value });

            context.widthDelta += valueWidth - rawWidth;
            context.previousEnd = match.end;
        }

        return edits;
    }

    function pushEdits(edits, list) {
        if (list) edits.push(...list);
    }

    // แก้ข้อความตามแผน โดยเลื่อน offset ของ edit ถัดไปตามความยาวที่เปลี่ยนไป
    // ต้องเรียงจาก offset น้อยไปมาก (sort แบบ stable จึงรักษาลำดับ edit ที่ offset เท่ากัน)
    function applyEdits(textNodes, edits) {
        let shift = 0;

        edits.sort((a, b) => a.start - b.start);

        for (const edit of edits) {
            const start = edit.start + shift;
            const length = edit.end - edit.start;

            if (applyEdit(textNodes, start, length, edit.text)) {
                shift += edit.text.length - length;
            }
        }
    }

    // locked = field ที่ติ๊ก "ล็อกตำแหน่ง" ไว้ในหน้า Template Configuration
    function replaceInParagraph(paragraph, regex, values, locked, warnings, applied) {
        const textNodes = Array.from(paragraph.getElementsByTagNameNS(W_NS, 't'));
        if (textNodes.length === 0) return;

        let iterations = 0;

        while (iterations++ < MAX_ITERATIONS_PER_PARAGRAPH) {
            const parts = textNodes.map(node => node.textContent || '');
            const fullText = parts.join('');

            const matches = findMatches(regex, fullText);
            if (matches.length === 0) return;

            applyEdits(
                textNodes,
                buildEdits(textNodes, parts, fullText, matches, values, locked, warnings, applied)
            );
        }

        console.warn('หยุดแทนค่าใน paragraph หนึ่งเพราะถึงขีดจำกัดรอบ');
    }

    // ──────────────────────────────────────────────────────────────
    // ตาราง (type = table)
    //
    // ย่อหน้าที่มี {{field}} ของตารางจะถูก "แทนที่ทั้งย่อหน้า" ด้วยตาราง Word จริง
    // (w:tbl) ที่สร้างจากโครงในหน้า Template Configuration + แถวจากหน้ารายงาน
    // ช่องที่ผสานไว้ในหน้ารายงานเขียนเป็น w:gridSpan (แถวรวมยอดก็ทำแบบเดียวกัน)
    // ──────────────────────────────────────────────────────────────

    // ความกว้างเนื้อหาหน้ากระดาษ (twips) ใช้หารความกว้างของแต่ละคอลัมน์
    // 9026 = A4 หักขอบซ้าย/ขวา 2.54 ซม. (ค่ามาตรฐานของ Word)
    const DEFAULT_CONTENT_WIDTH = 9026;

    // ลำดับลูกของ w:rPr ตาม schema — Word เข้มงวดเรื่องลำดับของ property
    const RPR_ORDER = [
        'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps',
        'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint',
        'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing',
        'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect',
        'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang',
        'eastAsianLayout', 'specVanish', 'oMath'
    ];

    function el(doc, name) {
        return doc.createElementNS(W_NS, 'w:' + name);
    }

    function setVal(node, name, value) {
        node.setAttribute('w:' + name, String(value));
    }

    // ความกว้างเนื้อเรื่อง (twips) อ่านจาก section ตัวสุดท้ายของเอกสาร
    function contentWidthTwips(doc) {
        const sections = doc.getElementsByTagNameNS(W_NS, 'sectPr');
        const section = sections.length > 0 ? sections[sections.length - 1] : null;

        if (!section) return DEFAULT_CONTENT_WIDTH;

        const size = section.getElementsByTagNameNS(W_NS, 'pgSz')[0];
        const margins = section.getElementsByTagNameNS(W_NS, 'pgMar')[0];

        const page = size ? Number(size.getAttribute('w:w')) : 0;

        if (!(page > 0)) return DEFAULT_CONTENT_WIDTH;

        const left = margins ? Number(margins.getAttribute('w:left')) || 0 : 0;
        const right = margins ? Number(margins.getAttribute('w:right')) || 0 : 0;

        const width = page - left - right;

        return width > 1000 ? width : DEFAULT_CONTENT_WIDTH;
    }

    // ฟอนต์/ขนาดของข้อความในย่อหน้าต้นทาง เพื่อให้ตารางที่สร้างใหม่หน้าตาเหมือนเอกสาร
    function cloneRunProps(paragraph) {
        const runs = Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r'));

        for (const run of runs) {
            const props = run.getElementsByTagNameNS(W_NS, 'rPr')[0];

            if (props) return props.cloneNode(true);
        }

        const paragraphProps = paragraph.getElementsByTagNameNS(W_NS, 'pPr')[0];

        if (paragraphProps) {
            const props = paragraphProps.getElementsByTagNameNS(W_NS, 'rPr')[0];

            if (props) return props.cloneNode(true);
        }

        return null;
    }

    // แทรก property ลงใน w:rPr ตามลำดับที่ schema กำหนด
    function insertRunProp(props, node) {
        const order = RPR_ORDER.indexOf(node.localName);

        if (order === -1) {
            props.appendChild(node);
            return;
        }

        for (const child of Array.from(props.childNodes)) {
            if (child.nodeType !== 1) continue;

            const at = RPR_ORDER.indexOf(child.localName);

            if (at > order) {
                props.insertBefore(node, child);
                return;
            }
        }

        props.appendChild(node);
    }

    // ชุด rPr ของหัวตาราง (ตัวหนา) — คัดลอกจากเอกสารแล้วเติม w:b
    function boldRunProps(doc, runProps) {
        const props = runProps ? runProps.cloneNode(true) : el(doc, 'rPr');

        if (props.getElementsByTagNameNS(W_NS, 'b').length === 0) {
            insertRunProp(props, el(doc, 'b'));
        }

        return props;
    }

    // ย่อหน้าในเซลล์ — ไม่เว้นระยะก่อน/หลัง เพื่อให้ตารางกระชับ
    function buildCellParagraph(doc, text, runProps) {
        const paragraph = el(doc, 'p');
        const paragraphProps = el(doc, 'pPr');

        const spacing = el(doc, 'spacing');
        setVal(spacing, 'before', 0);
        setVal(spacing, 'after', 0);
        paragraphProps.appendChild(spacing);

        if (runProps) {
            paragraphProps.appendChild(runProps.cloneNode(true));
        }

        paragraph.appendChild(paragraphProps);

        const run = el(doc, 'r');

        if (runProps) {
            run.appendChild(runProps.cloneNode(true));
        }

        const textNode = el(doc, 't');
        setText(textNode, text);
        run.appendChild(textNode);

        paragraph.appendChild(run);
        return paragraph;
    }

    // เซลล์ 1 ช่อง (gridSpan > 1 = รวมช่องกับช่องติดกัน)
    function buildCell(doc, text, runProps, width, gridSpan) {
        const cell = el(doc, 'tc');
        const props = el(doc, 'tcPr');

        // ลำดับใน tcPr ต้องเป็น tcW ก่อน gridSpan
        const cellWidth = el(doc, 'tcW');
        setVal(cellWidth, 'w', Math.round(width * gridSpan));
        setVal(cellWidth, 'type', 'dxa');
        props.appendChild(cellWidth);

        if (gridSpan > 1) {
            const span = el(doc, 'gridSpan');
            setVal(span, 'val', gridSpan);
            props.appendChild(span);
        }

        cell.appendChild(props);
        cell.appendChild(buildCellParagraph(doc, text, runProps));

        return cell;
    }

    // ขนาดกลุ่มช่องของแถว (1 = ไม่ผสาน) — ผลรวมต้องเท่ากับจำนวนคอลัมน์
    // ถ้าไม่ตรง (ค่าที่เพี้ยน/ไฟล์เก่า) กลับไปเป็น "ไม่ผสานทุกช่อง"
    function normalizeRowSpans(spans, columnCount) {
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

    // สร้าง w:tbl จากโครงตาราง + แถวที่กรอกไว้
    function buildTableElement(doc, spec, runProps, contentWidth) {
        let columns = Array.isArray(spec.columns) ? spec.columns : [];

        columns = columns.map(function (name) {
            return String(name == null ? '' : name);
        });

        if (columns.length === 0) columns = [''];

        const rows = (Array.isArray(spec.rows) ? spec.rows : []).map(function (row) {
            return columns.map(function (_, index) {
                return row && row[index] != null ? String(row[index]) : '';
            });
        });

        const rowSpans = Array.isArray(spec.rowSpans) ? spec.rowSpans : [];

        const width = contentWidth / columns.length;

        const table = el(doc, 'tbl');

        // ── tblPr (ความกว้าง + เส้นตาราง) ──
        const tableProps = el(doc, 'tblPr');

        const tableWidth = el(doc, 'tblW');
        setVal(tableWidth, 'w', 0);
        setVal(tableWidth, 'type', 'auto');
        tableProps.appendChild(tableWidth);

        const borders = el(doc, 'tblBorders');

        ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].forEach(function (side) {
            const border = el(doc, side);
            setVal(border, 'val', 'single');
            setVal(border, 'sz', 4);
            setVal(border, 'space', 0);
            setVal(border, 'color', 'auto');
            borders.appendChild(border);
        });

        tableProps.appendChild(borders);

        const look = el(doc, 'tblLook');
        setVal(look, 'val', '04A0');
        setVal(look, 'firstRow', 1);
        setVal(look, 'lastRow', 0);
        setVal(look, 'firstColumn', 0);
        setVal(look, 'lastColumn', 0);
        setVal(look, 'noHBand', 0);
        setVal(look, 'noVBand', 1);
        tableProps.appendChild(look);

        table.appendChild(tableProps);

        // ── tblGrid (ความกว้างเท่ากันทุกคอลัมน์) ──
        const grid = el(doc, 'tblGrid');

        columns.forEach(function () {
            const column = el(doc, 'gridCol');
            setVal(column, 'w', Math.round(width));
            grid.appendChild(column);
        });

        table.appendChild(grid);

        // ── แถวหัวตาราง (ตัวหนา) ──
        const header = el(doc, 'tr');
        const headerProps = boldRunProps(doc, runProps);

        columns.forEach(function (name) {
            header.appendChild(buildCell(doc, name, headerProps, width, 1));
        });

        table.appendChild(header);

        // ── แถวข้อมูล (ช่องที่ผสานกันจะกลายเป็นช่องเดียวตาม w:gridSpan) ──
        rows.forEach(function (row, rowIndex) {
            const tr = el(doc, 'tr');

            let columnIndex = 0;

            normalizeRowSpans(rowSpans[rowIndex], columns.length).forEach(function (span) {
                tr.appendChild(
                    buildCell(doc, row[columnIndex], runProps, width, span)
                );

                columnIndex += span;
            });

            table.appendChild(tr);
        });

        return table;
    }

    function hasChildParagraph(node) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 1 && child.localName === 'p') return true;
        }

        return false;
    }

    // element ถัดไป (ข้ามช่องว่างระหว่างแท็ก ซึ่งไม่มีในไฟล์ที่ Word สร้าง)
    function nextElementSibling(node) {
        let next = node.nextSibling;

        while (
            next &&
            next.nodeType === 3 &&
            String(next.nodeValue || '').trim() === ''
        ) {
            next = next.nextSibling;
        }

        return next;
    }

    // Word ต้องการย่อหน้าหลังตารางที่อยู่ท้ายเนื้อเรื่อง และเซลล์ต้องมีย่อหน้าอย่างน้อย 1 อัน
    function ensureParagraphAfterTable(doc, table) {
        const parent = table.parentNode;
        if (!parent) return;

        const next = nextElementSibling(table);

        const atEnd =
            !next ||
            (next.nodeType === 1 && next.localName === 'sectPr');

        const emptyCell =
            parent.localName === 'tc' && !hasChildParagraph(parent);

        if (atEnd || emptyCell) {
            parent.insertBefore(el(doc, 'p'), table.nextSibling);
        }
    }

    // แทนที่ย่อหน้าที่มี {{field}} ของตารางด้วยตาราง Word จริง
    // (field ที่ยังไม่มีแถวเลยจะไม่ถูกแตะ — ยังเห็น {{field}} ว่าไม่ได้กรอก)
    function insertTables(doc, tables) {
        const fields = Object.keys(tables).filter(function (field) {
            const spec = tables[field];

            return !!(spec && Array.isArray(spec.rows) && spec.rows.length > 0);
        });

        if (fields.length === 0) return;

        const regex = buildFieldRegex(fields);
        if (!regex) return;

        const contentWidth = contentWidthTwips(doc);

        // ต้องคัดลอกเป็น array ก่อน เพราะแก้ DOM ระหว่างวน
        const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));

        for (const paragraph of paragraphs) {
            const textNodes = Array.from(paragraph.getElementsByTagNameNS(W_NS, 't'));

            const text = textNodes.map(function (node) {
                return node.textContent || '';
            }).join('');

            const matches = findMatches(regex, text);
            if (matches.length === 0) continue;

            const parent = paragraph.parentNode;
            if (!parent) continue;

            const anchor = paragraph.nextSibling;
            const runProps = cloneRunProps(paragraph);

            // ย่อหน้าเดียว = ตารางเดียวต่อ field
            // ({{field}} ที่พิมพ์ซ้ำในย่อหน้าเดียวกัน ไม่ทำให้ได้ตารางซ้อนกัน)
            const placed = [];

            matches.forEach(function (match) {
                if (placed.indexOf(match.field) !== -1) return;

                const spec = tables[match.field];
                if (!spec) return;

                placed.push(match.field);

                const table = buildTableElement(doc, spec, runProps, contentWidth);

                // วางตารางไว้ตรงตำแหน่งของย่อหน้าเดิม (index อ้างจากย่อหน้าเดิม)
                parent.insertBefore(table, anchor);
                ensureParagraphAfterTable(doc, table);
            });

            // {{field}} ของตารางต้องอยู่บรรทัดเดียวของมันเอง → ทิ้งย่อหน้าเดิมทั้งอัน
            parent.removeChild(paragraph);
        }
    }

    let lastWarnings = [];
    let lastApplied = [];

    // tables = { field: { columns, rows, rowSpans } } ของ field ที่เป็น type Table
    function replaceFields(xml, values, lockedFields, tables) {
        lastWarnings = [];
        lastApplied = [];

        if (!xml) return xml;

        const tableValues =
            tables && typeof tables === 'object' ? tables : {};

        // ค่าปกติ (ข้อความ) — field ที่เป็นตารางแยกออกไปสร้างเป็นตาราง
        const scalarValues = {};

        if (values) {
            Object.keys(values).forEach(function (field) {
                if (!Object.prototype.hasOwnProperty.call(tableValues, field)) {
                    scalarValues[field] = values[field];
                }
            });
        }

        if (
            Object.keys(scalarValues).length === 0 &&
            Object.keys(tableValues).length === 0
        ) {
            return xml;
        }

        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length > 0) {
            console.error('XML Parse Error: ไม่สามารถแทนค่าได้');
            return xml;
        }

        // 1) field ที่เป็นตาราง: แทนที่ทั้งย่อหน้าด้วยตาราง Word
        insertTables(doc, tableValues);

        // 2) field ปกติ: แทนค่าในข้อความ (อ่านย่อหน้าใหม่หลังแทรกตารางแล้ว)
        const regex = buildFieldRegex(Object.keys(scalarValues));

        if (regex) {
            const locked = toLockedSet(lockedFields);
            const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));

            for (const paragraph of paragraphs) {
                replaceInParagraph(
                    paragraph,
                    regex,
                    scalarValues,
                    locked,
                    lastWarnings,
                    lastApplied
                );
            }
        }

        return new XMLSerializer().serializeToString(doc);
    }

    scope.Replace = {
        replaceFields: replaceFields,

        // ตัววัดสำรอง (ใช้อ้างอิงเมื่อแอปวัดด้วยฟอนต์จริงไม่ได้)
        defaultMeasure: defaultMeasure,

        // ให้แอปติดตั้งตัววัดความกว้างจริง (canvas) ก่อนเรียก replaceFields
        setMeasurer: setMeasurer,

        // คำเตือนจาก replaceFields ครั้งล่าสุด: ล็อกตำแหน่งไม่ได้เพราะช่องว่างไม่พอ
        getWarnings: function () {
            return lastWarnings.slice();
        },

        // สิ่งที่ชดเชยไปแล้วจาก replaceFields ครั้งล่าสุด (ให้ผู้ใช้ตรวจสอบได้)
        getApplied: function () {
            return lastApplied.map(function (item) {
                return {
                    field: item.field,
                    side: item.side,
                    action: item.action,
                    count: item.count,
                    distance: item.distance
                };
            });
        }
    };
})(window);
