// Replace Module - แทน {{field}} ใน XML ด้วยค่าจาก values
// รองรับ "ล็อกตำแหน่ง" ของ field ที่ติ๊กไว้ในหน้า Template Configuration
(function (scope) {
    'use strict';

    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    // กันลูปไม่รู้จบ กรณีค่าที่แทนเข้าไปมีรูปแบบ {{field}} เหมือนเดิม
    const MAX_ITERATIONS_PER_PARAGRAPH = 1000;

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

    // ล็อกตำแหน่งแบบเข้ม: ค่าก่อนหน้าฟิลด์ที่ล็อกต้องกินความกว้างเท่า {{field}} เดิมเป๊ะ
    //   สั้นกว่า -> เติมช่องว่างท้าย
    //   ยาวกว่า -> ตัดให้พอดีช่อง (ถ้าไม่ตัด ฟิลด์ที่ล็อกจะถูกดันไปทางขวา)
    // อยากให้ช่องกว้างขึ้น เขียนช่องว่างใน placeholder ได้ เช่น {{A     }} (กว้าง 10)
    function fitWidth(value, width) {
        if (value.length === width) return value;
        if (value.length < width) return value + ' '.repeat(width - value.length);
        return value.slice(0, width);
    }

    // ในย่อหน้าเดียวกัน ยังมี field ที่ถูกล็อกตำแหน่งอยู่ถัดจากตำแหน่งนี้หรือไม่
    function hasLockedAfter(text, from, pattern, locked) {
        if (Object.keys(locked).length === 0) return false;

        const rest = text.slice(from);
        const regex = new RegExp(pattern, 'g');

        let match;
        while ((match = regex.exec(rest)) !== null) {
            if (locked[match[1]]) return true;
        }

        return false;
    }

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

    // แทนค่า match หนึ่งรายการ โดยรักษา text node อื่นใน paragraph ไว้
    function replaceMatch(textNodes, parts, match, replacement) {
        const start = locateOffset(parts, match.index);
        const end = locateOffset(parts, match.index + match[0].length);

        if (!start || !end || end.index < start.index) {
            return false;
        }

        const before = parts[start.index].slice(0, start.offset);
        const after = parts[end.index].slice(end.offset);

        if (start.index === end.index) {
            setText(textNodes[start.index], before + replacement + after);
            return true;
        }

        setText(textNodes[start.index], before + replacement);

        for (let i = start.index + 1; i < end.index; i++) {
            textNodes[i].textContent = '';
        }

        setText(textNodes[end.index], after);
        return true;
    }

    // locked = field ที่ติ๊ก "ล็อกตำแหน่ง" ไว้ในหน้า Template Configuration
    // ค่าที่อยู่ก่อนหน้าฟิลด์ที่ล็อกจะถูกบังคับให้กว้างเท่า placeholder เดิม
    // ทำให้ฟิลด์ที่ล็อกเริ่มที่ตำแหน่งเดิมในบรรทัดเสมอ
    function replaceInParagraph(paragraph, regex, values, locked) {
        const textNodes = Array.from(paragraph.getElementsByTagNameNS(W_NS, 't'));
        if (textNodes.length === 0) return;

        let iterations = 0;
        while (iterations++ < MAX_ITERATIONS_PER_PARAGRAPH) {
            const parts = textNodes.map(node => node.textContent || '');
            const fullText = parts.join('');

            if (fullText.indexOf('{{') === -1 || fullText.indexOf('}}') === -1) {
                return;
            }

            regex.lastIndex = 0;
            const match = regex.exec(fullText);
            if (!match) return;

            let replacement = normalizeValue(values[match[1]]);

            if (hasLockedAfter(fullText, match.index + match[0].length, regex.source, locked)) {

                // เตือนให้เห็นว่าเกิดการตัดข้อความ เพราะ field ถัดไปถูกล็อกตำแหน่งไว้
                if (replacement.length > match[0].length) {
                    console.warn(
                        'ล็อกตำแหน่ง: ตัดค่า "' + match[1] + '" จาก ' +
                        replacement.length + ' เหลือ ' + match[0].length + ' ตัวอักษร'
                    );
                }

                replacement = fitWidth(replacement, match[0].length);
            }

            if (!replaceMatch(textNodes, parts, match, replacement)) return;
        }

        console.warn('หยุดแทนค่าใน paragraph หนึ่งเพราะถึงขีดจำกัดรอบ');
    }

    function replaceFields(xml, values, lockedFields) {
        if (!xml || !values) return xml;

        const regex = buildFieldRegex(Object.keys(values));
        if (!regex) return xml;

        const locked = toLockedSet(lockedFields);

        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length > 0) {
            console.error('XML Parse Error: ไม่สามารถแทนค่าได้');
            return xml;
        }

        const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
        for (const paragraph of paragraphs) {
            replaceInParagraph(paragraph, regex, values, locked);
        }

        return new XMLSerializer().serializeToString(doc);
    }

    scope.Replace = {
        replaceFields: replaceFields
    };
})(window);
