// Extract Module - อ่าน {{field}} จาก XML ของ word/document.xml
(function (scope) {
    'use strict';

    const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    // ชื่อ field: ตัวอักษร ตัวเลข _ และอักษรไทย
    const FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_ก-๙]+)\s*\}\}/g;

    // ตรวจว่า XML เสียรูปหรือไม่
    function hasParseError(doc) {
        return doc.getElementsByTagName('parsererror').length > 0;
    }

    function collectFromContainer(container, found) {
        const textNodes = container.getElementsByTagNameNS(W_NS, 't');

        let text = '';
        for (const node of textNodes) {
            text += node.textContent || '';
        }

        // สร้าง regex ใหม่ทุกครั้งเพื่อไม่ให้ lastIndex ค้างข้ามการเรียก
        const regex = new RegExp(FIELD_PATTERN.source, 'g');
        let match;
        while ((match = regex.exec(text)) !== null) {
            found.add(match[1]);
        }
    }

    function extractFields(xml) {
        if (!xml) return [];

        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (hasParseError(doc)) {
            console.error('XML Parse Error: ไม่สามารถอ่าน field ได้');
            return [];
        }

        // แยกอ่านทีละ paragraph เพื่อให้ตรงกับตอนแทนค่า (placeholder ที่ถูกตัดข้าม run จะถูกอ่านได้)
        const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
        const containers = paragraphs.length > 0
            ? Array.from(paragraphs)
            : [doc.documentElement];

        const found = new Set();
        for (const container of containers) {
            collectFromContainer(container, found);
        }

        return Array.from(found);
    }

    scope.Extract = {
        extractFields: extractFields
    };
})(window);
