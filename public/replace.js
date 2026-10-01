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

    // รูปแบบหัวคอลัมน์ (จัดตำแหน่ง / ตัวหนา) — ค่าเริ่มต้นหนา ชิดซ้าย
    function normalizeHeaderStyle(style) {
        const raw = style && typeof style === 'object' ? style : {};

        return {
            align: raw.align === 'center' || raw.align === 'right' ? raw.align : 'left',
            bold: raw.bold !== false
        };
    }

    // รูปแบบข้อความในช่อง (จัดตำแหน่ง / ตัวหนา / ตัวเอียง) — ค่าตั้งต้นชิดซ้าย ไม่หนา ไม่เอียง
    function normalizeCellStyle(style) {
        const raw = style && typeof style === 'object' ? style : {};

        return {
            align: raw.align === 'center' || raw.align === 'right' ? raw.align : 'left',
            bold: raw.bold === true,
            italic: raw.italic === true
        };
    }

    // เติมตัวหนา/ตัวเอียงลง rPr ตามลำดับที่ schema กำหนด
    function styledRunProps(doc, runProps, style) {
        if (!style || (!style.bold && !style.italic)) return runProps;

        const props = runProps ? runProps.cloneNode(true) : el(doc, 'rPr');

        if (style.bold && props.getElementsByTagNameNS(W_NS, 'b').length === 0) {
            insertRunProp(props, el(doc, 'b'));
        }

        if (style.italic && props.getElementsByTagNameNS(W_NS, 'i').length === 0) {
            insertRunProp(props, el(doc, 'i'));
        }

        return props;
    }

    // ย่อหน้าในเซลล์ — ไม่เว้นระยะก่อน/หลัง เพื่อให้ตารางกระชับ
    // style = การจัดตำแหน่ง / ตัวหนา / ตัวเอียง ของช่องนั้น
    function buildCellParagraph(doc, text, runProps, style) {
        const paragraph = el(doc, 'p');
        const paragraphProps = el(doc, 'pPr');

        const spacing = el(doc, 'spacing');
        setVal(spacing, 'before', 0);
        setVal(spacing, 'after', 0);
        paragraphProps.appendChild(spacing);

        const cellStyle = normalizeCellStyle(style);

        // w:jc อยู่หลัง spacing และก่อน rPr ตามลำดับของ pPr ใน schema
        if (cellStyle.align === 'center' || cellStyle.align === 'right') {
            const jc = el(doc, 'jc');
            setVal(jc, 'val', cellStyle.align);
            paragraphProps.appendChild(jc);
        }

        const styled = styledRunProps(doc, runProps, cellStyle);

        if (styled) {
            paragraphProps.appendChild(styled.cloneNode(true));
        }

        paragraph.appendChild(paragraphProps);

        // ขึ้นบรรทัดใหม่ในข้อความ (\n) → w:br ในย่อหน้าเดียวกัน
        // (Word ขึ้นบรรทัดใหม่โดยไม่ขึ้นย่อหน้าใหม่)
        const lines =
            String(text == null ? '' : text).split(/\r\n|\r|\n/);

        lines.forEach(function (line, index) {

            if (index > 0) {

                const brRun = el(doc, 'r');

                if (styled) {
                    brRun.appendChild(styled.cloneNode(true));
                }

                brRun.appendChild(el(doc, 'br'));

                paragraph.appendChild(brRun);
            }

            const run = el(doc, 'r');

            if (styled) {
                run.appendChild(styled.cloneNode(true));
            }

            const textNode = el(doc, 't');
            setText(textNode, line);
            run.appendChild(textNode);

            paragraph.appendChild(run);
        });

        return paragraph;
    }

    // เซลล์ 1 ช่อง (gridSpan > 1 = รวมช่องกับช่องติดกัน)
    // style = จัดตำแหน่ง/ตัวหนา/ตัวเอียง ของช่องนั้น
    function buildCell(doc, text, runProps, width, gridSpan, style) {
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
        cell.appendChild(buildCellParagraph(doc, text, runProps, style));

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

        // สัดส่วนความกว้างของแต่ละคอลัมน์ (ตั้งไว้ที่หน้า Template Configuration)
        // ค่าไม่ถูกต้อง/ไม่มี = ใช้สัดส่วน 1 (แบ่งเท่ากัน)
        const ratios = columns.map(function (_, index) {
            const value = Number(
                Array.isArray(spec.widths) ? spec.widths[index] : null
            );

            return isFinite(value) && value > 0 ? value : 1;
        });

        const ratioSum = ratios.reduce(function (all, value) {
            return all + value;
        }, 0) || columns.length;

        // แบ่งความกว้างเนื้อหาตามสัดส่วน แล้วปัดเศษให้รวมเท่าความกว้างเดิมพอดี
        // (คอลัมน์สุดท้ายรับเศษที่เหลือ กันความกว้างรวมเพี้ยนจากการปัด)
        const columnWidths = [];
        let used = 0;

        ratios.forEach(function (ratio, index) {
            const isLast = index === ratios.length - 1;

            const columnWidth = isLast
                ? contentWidth - used
                : Math.round(contentWidth * ratio / ratioSum);

            columnWidths.push(Math.max(columnWidth, 1));
            used += columnWidths[index];
        });

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

        // ── tblGrid (ความกว้างตามสัดส่วนที่ตั้งไว้) ──
        const grid = el(doc, 'tblGrid');

        columns.forEach(function (_, index) {
            const column = el(doc, 'gridCol');
            setVal(column, 'w', columnWidths[index]);
            grid.appendChild(column);
        });

        table.appendChild(grid);

        // ── แถวหัวตาราง (จัดตำแหน่ง / ตัวหนา ตามที่ตั้งไว้ในหน้า Configuration) ──
        const header = el(doc, 'tr');
        const headerStyles = Array.isArray(spec.headerStyles) ? spec.headerStyles : [];

        columns.forEach(function (name, index) {

            const headerStyle =
                normalizeHeaderStyle(headerStyles[index]);

            // ตัวหนา: เติม w:b จากฟอนต์ของ {{field}} | ตัวบาง: ใช้ rPr ของ {{field}} ตรง ๆ
            const props = headerStyle.bold
                ? boldRunProps(doc, runProps)
                : runProps;

            header.appendChild(
                buildCell(
                    doc,
                    name,
                    props,
                    columnWidths[index],
                    1,
                    // ตัวหนาจัดการจาก props แล้ว จึงส่งเฉพาะการจัดตำแหน่ง
                    { align: headerStyle.align, bold: false }
                )
            );
        });

        table.appendChild(header);

        // ── แถวข้อมูล (ช่องที่ผสานกันจะกลายเป็นช่องเดียวตาม w:gridSpan) ──
        const cellStyles = Array.isArray(spec.cellStyles) ? spec.cellStyles : [];

        rows.forEach(function (row, rowIndex) {
            const tr = el(doc, 'tr');
            const styleRow = cellStyles[rowIndex];

            let columnIndex = 0;

            normalizeRowSpans(rowSpans[rowIndex], columns.length).forEach(function (span) {
                const style = normalizeCellStyle(
                    Array.isArray(styleRow) ? styleRow[columnIndex] : null
                );

                // ช่องที่ผสานกว้างเท่าผลรวมความกว้างของคอลัมน์ที่รวมกัน
                const spanWidth = columnWidths
                    .slice(columnIndex, columnIndex + span)
                    .reduce(function (all, value) {
                        return all + value;
                    }, 0);

                tr.appendChild(
                    buildCell(doc, row[columnIndex], runProps, spanWidth, span, style)
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

    // ──────────────────────────────────────────────────────────────
    // แก้ข้อความทั้งย่อหน้า (ใช้โดยหน้าจัดตำแหน่ง)
    //
    // หน้าจัดตำแหน่งเรนเดอร์เอกสารด้วย docx-preview แล้วให้ผู้ใช้พิมพ์แก้ข้อความ
    // บนเอกสารที่เห็น จึงอ้างย่อหน้าด้วย "ลำดับที่" — ต้องเป็นลำดับเดียวกับที่
    // ตัวเรนเดอร์วาด นั่นคือไล่ทุก w:p ตามลำดับในเอกสาร (รวมย่อหน้าในตาราง)
    // โดยย่อหน้าในกล่องข้อความ (w:txbxContent) นับเป็นย่อหน้าของตัวเอง
    // ไม่รวมอยู่ในย่อหน้าแม่
    // ──────────────────────────────────────────────────────────────

    // text node ของย่อหน้าหนึ่ง ๆ โดยไม่รวมข้อความของย่อหน้าที่ซ้อนอยู่ข้างใน
    function paragraphTextNodes(paragraph) {
        const nodes = [];

        function walk(node) {
            for (let i = 0; i < node.childNodes.length; i++) {
                const child = node.childNodes[i];

                if (child.nodeType !== 1) continue;

                // ย่อหน้าซ้อน (กล่องข้อความ) มีลำดับของตัวเองแล้ว
                if (child.localName === 'p') continue;

                if (child.localName === 't') {
                    nodes.push(child);
                    continue;
                }

                walk(child);
            }
        }

        walk(paragraph);
        return nodes;
    }

    function paragraphText(paragraph) {
        return paragraphTextNodes(paragraph)
            .map(function (node) {
                return node.textContent || '';
            })
            .join('');
    }

    function parseDocument(xml) {
        if (!xml) return null;

        const doc = new DOMParser().parseFromString(xml, 'application/xml');

        return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
    }

    // ข้อความของทุกย่อหน้าตามลำดับในเอกสาร (null = อ่าน XML ไม่ได้)
    function listParagraphTexts(xml) {
        const doc = parseDocument(xml);

        if (!doc) return null;

        return Array.from(doc.getElementsByTagNameNS(W_NS, 'p'))
            .map(paragraphText);
    }

    // ช่วงที่ต่างกันของ before/after (ตัดหัว-ท้ายที่เหมือนกันออก)
    // แก้เฉพาะช่วงที่ต่างจริง run ที่ไม่ถูกแตะจึงคงรูปแบบ (ฟอนต์/ตัวหนา) ไว้
    function diffRange(before, after) {
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

        return {
            start: start,
            end: endBefore,
            text: after.slice(start, endAfter)
        };
    }

    // edits = [ { index, text } ] — index = ลำดับ w:p ในเอกสาร (ตาม listParagraphTexts)
    // ย่อหน้าที่ไม่มี text node เดิม (เช่นมีแต่รูป) จะถูกข้าม ไม่เขียนทับ
    function setParagraphTexts(xml, edits) {
        if (!xml || !edits || edits.length === 0) return xml;

        const doc = parseDocument(xml);

        if (!doc) {
            console.error('XML Parse Error: ไม่สามารถแก้ข้อความในเอกสารได้');
            return xml;
        }

        const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));

        edits.forEach(function (edit) {
            const paragraph = paragraphs[edit.index];
            if (!paragraph) return;

            const textNodes = paragraphTextNodes(paragraph);
            if (textNodes.length === 0) return;

            // w:t อยู่บรรทัดเดียว — ขึ้นบรรทัดใหม่ที่ผู้ใช้พิมพ์ให้กลายเป็นช่องว่าง
            const text = normalizeValue(edit.text);
            const before = paragraphText(paragraph);

            if (before === text) return;

            applyEdits(textNodes, [diffRange(before, text)]);
        });

        return new XMLSerializer().serializeToString(doc);
    }

    // ──────────────────────────────────────────────────────────────
    // หน้าจัดตำแหน่ง: เขียนรูปแบบข้อความ (ตัวหนา / ตัวเอียง / ขีดเส้นใต้)
    //
    // ต่างจาก setParagraphTexts ที่แก้ข้อความล้วน (และเก็บ run เดิมครบอยู่แล้ว)
    // ตัวนี้ใช้เมื่อผู้ใช้กดปุ่มจัดรูปแบบบนหน้าจอ (Ctrl+B / ปุ่มบนแถบเครื่องมือ)
    //
    // หลักการ:
    // - รับการเปลี่ยนแปลงเป็น "ช่วงอักขระ" ของข้อความย่อหน้า แล้ว "ตัด run" ที่มี
    //   ข้อความทับช่วงนั้น ตามขอบเขตที่รูปแบบเปลี่ยน — run ที่ตัดออกใหม่คัด rPr เดิม
    //   มาทั้งก้อน ฟอนต์/ขนาด/สี/ระยะ ของ run เดิมจึงคงอยู่ (ไม่สร้าง run ใหม่ทั้งย่อหน้า)
    // - เขียน w:b / w:i / w:u เฉพาะ run ที่รูปแบบต่างจาก "ค่าก่อนแก้" ของช่วงนั้น
    //   (ถ้าค่าก่อนแก้เป็นเท็จเพราะสไตล์ของย่อหน้าทำให้หนา ก็เขียน w:b val="0" ให้จริง)
    // - run ที่ไม่ใช่ข้อความ (w:tab / w:sym / รูป) และอิลิเมนต์อื่น ไม่ถูกแตะเลย
    // - ต้องเรียกหลัง setParagraphTexts (ข้อความย่อหน้าตรงกันแล้ว) offset จึงตรงกัน
    // - ย่อหน้าที่ตัด run ไม่ปลอดภัย (hyperlink / bookmark / ฟิลด์ / กล่องข้อความซ้อน)
    //   จะถูกข้าม แล้วรายงานกลับให้หน้าจอเตือน (ดู skipped)
    // ──────────────────────────────────────────────────────────────

    function directChild(node, name) {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 1 && child.localName === name) return child;
        }

        return null;
    }

    // ช่วงข้อความของ run ที่ "ตัดได้" (run ข้อความล้วน = มีแต่ w:rPr กับ w:t)
    // คืน null เมื่อย่อหน้านี้ตัด run ได้ไม่ปลอดภัย
    function paragraphSegments(paragraph) {
        // กล่องข้อความซ้อนอยู่ในย่อหน้า → ข้อความสองชั้น ไล่ offset ไม่ตรง
        if (paragraph.getElementsByTagNameNS(W_NS, 'p').length > 0) return null;

        const segments = [];
        let offset = 0;

        for (const child of Array.from(paragraph.childNodes)) {
            if (child.nodeType !== 1) continue;

            const name = child.localName;

            if (name === 'pPr' || name === 'sectPr') continue;

            // hyperlink / bookmark / field / smartTag ฯลฯ — ไม่กล้าแตะโครง
            if (name !== 'r') return null;

            let text = '';
            let plain = true;

            for (const node of Array.from(child.childNodes)) {
                if (node.nodeType !== 1) continue;

                if (node.localName === 't') {
                    text += node.textContent || '';
                    continue;
                }

                if (node.localName === 'rPr') continue;

                // w:tab / w:sym / รูป อยู่ใน run เดียวกับข้อความ = ตัด run นี้ไม่ได้
                plain = false;
            }

            // run ที่ไม่มีข้อความ (tab/สัญลักษณ์/รูป) ไม่ถูกนับและไม่ถูกแตะ
            if (text === '') continue;

            if (!plain) return null;

            segments.push({
                run: child,
                text: text,
                start: offset,
                end: offset + text.length
            });

            offset += text.length;
        }

        return segments.length > 0 ? segments : null;
    }

    // เขียน w:b / w:i / w:u ลง rPr
    // value = รูปแบบที่ผู้ใช้เห็นบนหน้าจอ, base = รูปแบบเดิมของย่อหน้า
    // เท่ากัน = ไม่ต้องเขียน (สืบทอดจาก rPr ที่คัดมา/สไตล์ของย่อหน้า)
    function applyRunFlag(doc, props, name, value, base) {
        if (value === base) return;

        const existing = directChild(props, name);
        const node = existing || el(doc, name);

        if (name === 'u') {
            setVal(node, 'val', value ? 'single' : 'none');
        } else {
            setVal(node, 'val', value ? '1' : '0');
        }

        if (!existing) insertRunProp(props, node);
    }

    // รูปแบบเป้าหมายของช่วงหนึ่ง (change = ช่วงที่รูปแบบเปลี่ยน)
    function formatOfChange(change) {
        return {
            bold: change.bold === true,
            italic: change.italic === true,
            underline: change.underline === true
        };
    }

    // ค่าที่เขียนไม่เหมือนเดิมจริง (อย่างน้อยหนึ่งรูปแบบ)
    function changeDiffers(change) {
        return (change.bold === true) !== (change.wasBold === true)
            || (change.italic === true) !== (change.wasItalic === true)
            || (change.underline === true) !== (change.wasUnderline === true);
    }

    // ช่วงย่อยของ run ที่รูปแบบเท่ากัน — คืน null เมื่อ run นี้ไม่ต้องแก้
    function splitSegment(segment, changes) {
        const bounds = [segment.start, segment.end];

        changes.forEach(function (change) {
            const start = Math.max(change.start, segment.start);
            const end = Math.min(change.end, segment.end);

            if (end <= start) return;

            bounds.push(start, end);
        });

        if (bounds.length === 2) return null;

        const points = bounds
            .filter(function (value, index, list) { return list.indexOf(value) === index; })
            .sort(function (a, b) { return a - b; });

        const pieces = [];

        for (let i = 0; i < points.length - 1; i++) {
            const start = points[i];
            const end = points[i + 1];

            if (end <= start) continue;

            const change = changes.find(function (item) {
                return item.start <= start && item.end >= end;
            }) || null;

            pieces.push({
                text: segment.text.slice(start - segment.start, end - segment.start),
                change: change && changeDiffers(change) ? change : null
            });
        }

        return pieces.some(function (piece) { return piece.change; }) ? pieces : null;
    }

    // run ใหม่ 1 ก้อน — คัด rPr เดิมของ run ต้นทางมาทั้งก้อน แล้วเขียนเฉพาะรูปแบบที่เปลี่ยน
    // ค่าก่อนแก้ (was*) ต่างจากค่าเป้าหมายเสมอ จึงเขียนค่าจริงลงไปทั้งเปิดและปิด
    // (การ "เอาตัวหนาออก" ในย่อหน้าที่หนาจากสไตล์ จึงเขียน w:b val="0" ได้ถูกต้อง)
    function buildFormatRun(doc, run, piece) {
        const element = run.cloneNode(true);
        const props = directChild(element, 'rPr') || el(doc, 'rPr');

        if (piece.change) {
            applyRunFlag(doc, props, 'b', piece.change.bold === true, piece.change.wasBold === true);
            applyRunFlag(doc, props, 'i', piece.change.italic === true, piece.change.wasItalic === true);
            applyRunFlag(doc, props, 'u', piece.change.underline === true, piece.change.wasUnderline === true);
        }

        // ตัดข้อความเดิมออกทั้งหมด แล้วใส่ข้อความของช่วงนี้แทน
        Array.from(element.childNodes).forEach(function (child) {
            if (child.nodeType === 1 && child.localName === 't') element.removeChild(child);
        });

        if (props.parentNode !== element) element.insertBefore(props, element.firstChild);

        const text = el(doc, 't');
        setText(text, piece.text);
        element.appendChild(text);

        return element;
    }

    // edits = [ { index, changes: [ change ] } ]
    //   index   = ลำดับ w:p ในเอกสาร (ตาม listParagraphTexts)
    //   change  = { start, end, bold, italic, underline, wasBold, wasItalic, wasUnderline }
    //             start/end = ช่วงอักขระในข้อความย่อหน้า (นับจาก 0)
    //             was*      = รูปแบบที่เห็นก่อนแก้ (ใช้เทียบว่าต้องเขียนค่าจริงหรือปล่อยเดิม)
    //
    // คืน { xml, skipped } — skipped = ลำดับย่อหน้าที่เขียนไม่ได้ (ย่อหน้ายังไม่ถูกแก้)
    function setParagraphFormats(xml, edits) {
        const skipped = [];

        if (!xml || !edits || edits.length === 0) {
            return { xml: xml, skipped: skipped };
        }

        const doc = parseDocument(xml);

        if (!doc) {
            console.error('XML Parse Error: ไม่สามารถจัดรูปแบบข้อความในเอกสารได้');
            return { xml: xml, skipped: edits.map(function (edit) { return edit.index; }) };
        }

        const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));

        edits.forEach(function (edit) {
            const paragraph = paragraphs[edit.index];

            if (!paragraph) return;

            const changes = (edit.changes || []).filter(function (change) {
                return change && change.end > change.start && changeDiffers(change);
            });

            if (changes.length === 0) return;

            const segments = paragraphSegments(paragraph);

            if (!segments) {
                skipped.push(edit.index);
                return;
            }

            segments.forEach(function (segment) {
                const pieces = splitSegment(segment, changes);

                if (!pieces) return;

                const parent = segment.run.parentNode;
                const next = segment.run.nextSibling;

                pieces.forEach(function (piece) {
                    parent.insertBefore(buildFormatRun(doc, segment.run, piece), next);
                });

                parent.removeChild(segment.run);
            });
        });

        return {
            xml: new XMLSerializer().serializeToString(doc),
            skipped: skipped
        };
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

        // ── หน้าจัดตำแหน่ง: อ่าน/เขียนข้อความย่อหน้าทั้งก้อน ──

        // ข้อความของทุกย่อหน้าตามลำดับในเอกสาร
        listParagraphTexts: listParagraphTexts,

        // แทนข้อความย่อหน้าที่ระบุ (เก็บรูปแบบของ run ที่ไม่ถูกแก้)
        setParagraphTexts: setParagraphTexts,

        // แทนรูปแบบข้อความย่อหน้า (ตัวหนา/เอียง/ขีดเส้นใต้) — หน้าจัดตำแหน่ง
        // ตัด run ตามขอบเขตที่รูปแบบเปลี่ยน โดยคง rPr เดิมของแต่ละ run ไว้
        setParagraphFormats: setParagraphFormats,

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
