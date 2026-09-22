// Xlsx Module - สร้าง / อ่านไฟล์ .xlsx ด้วย JSZip (ไม่พึ่งไลบรารีภายนอก)
//
// ทำไมเขียนเอง: แอปนี้ไม่ใช้ bundler กับไฟล์ใน public/
// และมี JSZip อยู่แล้ว (.docx) จึงใช้ JSZip ประกอบไฟล์ .xlsx ตรง ๆ
//
// - createBlob(rows, sheetName)
//     rows = array ของ array ของข้อความ (แถวแรกมักเป็นหัวตาราง)
//     เขียนทุกช่องเป็น inline string จึงไม่ต้องมี sharedStrings.xml
// - readRows(bytes)
//     คืน array ของ array ของข้อความ
//     รองรับไฟล์ที่ Excel บันทึกจริง: sharedStrings / inlineStr / ตัวเลข
//     และ sheet ที่ไม่ใช่ sheet1.xml (อ่านความสัมพันธ์จาก workbook.xml)
(function (scope) {
    'use strict';

    const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

    const NS_SPREADSHEET = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const NS_DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const NS_PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

    // ชนิดไฟล์ใน [Content_Types].xml
    const CONTENT_TYPE = {
        workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
        worksheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
        styles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'
    };

    // ──────────────────────────────────────────────────────────────
    // XML Helpers
    // ──────────────────────────────────────────────────────────────

    // ตัดอักขระที่ใส่ใน XML 1.0 ไม่ได้ (เช่น \u0000) แล้ว escape เครื่องหมาย
    function escapeXml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function parseXml(text) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');

        if (doc.getElementsByTagName('parsererror').length > 0) {
            throw new Error('อ่าน XML ภายในไฟล์ Excel ไม่ได้ (ไฟล์อาจเสียหาย)');
        }

        return doc;
    }

    // ชื่อ element แบบไม่สนใจ prefix (localName) เพื่อทนไฟล์ที่ใช้ prefix ต่างกัน
    function findElements(root, localName) {
        const all = root.getElementsByTagName('*');
        const found = [];

        for (let i = 0; i < all.length; i++) {
            if (all[i].localName === localName) found.push(all[i]);
        }

        return found;
    }

    function findChild(element, localName) {
        for (let i = 0; i < element.childNodes.length; i++) {
            const node = element.childNodes[i];
            if (node.nodeType === 1 && node.localName === localName) return node;
        }

        return null;
    }

    // รวมข้อความจาก <t> ทุกตัวข้างใน (shared string ที่มีหลาย run จะได้ครบ)
    function collectText(element) {
        const texts = findElements(element, 't');
        let text = '';

        for (let i = 0; i < texts.length; i++) {
            text += texts[i].textContent || '';
        }

        return text;
    }

    // ──────────────────────────────────────────────────────────────
    // สร้างไฟล์ (Export)
    // ──────────────────────────────────────────────────────────────

    function columnName(index) {
        let name = '';
        let n = index + 1;

        while (n > 0) {
            name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
            n = Math.floor((n - 1) / 26);
        }

        return name;
    }

    function cellRef(rowIndex, colIndex) {
        return columnName(colIndex) + (rowIndex + 1);
    }

    // ชื่อ sheet มีข้อจำกัดของ Excel: ห้ามมี \ / ? * [ ] : และยาวไม่เกิน 31 ตัว
    function safeSheetName(name) {
        const cleaned = String(name === null || name === undefined ? '' : name)
            .replace(/[\\\/?*\[\]:]/g, ' ')
            .trim();

        return (cleaned || 'Sheet1').slice(0, 31);
    }

    function contentTypesXml() {
        return XML_HEADER +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/xl/workbook.xml" ContentType="' + CONTENT_TYPE.workbook + '"/>' +
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="' + CONTENT_TYPE.worksheet + '"/>' +
            '<Override PartName="/xl/styles.xml" ContentType="' + CONTENT_TYPE.styles + '"/>' +
            '</Types>';
    }

    function packageRelsXml() {
        return XML_HEADER +
            '<Relationships xmlns="' + NS_PACKAGE_REL + '">' +
            '<Relationship Id="rId1" Type="' + NS_DOC_REL + '/officeDocument"' +
            ' Target="xl/workbook.xml"/>' +
            '</Relationships>';
    }

    function workbookXml(sheetName) {
        return XML_HEADER +
            '<workbook xmlns="' + NS_SPREADSHEET + '" xmlns:r="' + NS_DOC_REL + '">' +
            '<sheets>' +
            '<sheet name="' + escapeXml(sheetName) + '" sheetId="1" r:id="rId1"/>' +
            '</sheets>' +
            '</workbook>';
    }

    function workbookRelsXml() {
        return XML_HEADER +
            '<Relationships xmlns="' + NS_PACKAGE_REL + '">' +
            '<Relationship Id="rId1" Type="' + NS_DOC_REL + '/worksheet"' +
            ' Target="worksheets/sheet1.xml"/>' +
            '<Relationship Id="rId2" Type="' + NS_DOC_REL + '/styles"' +
            ' Target="styles.xml"/>' +
            '</Relationships>';
    }

    // styles.xml แบบพื้นฐาน: Excel ต้องการ part นี้มากกว่าจะเดาให้เอง
    function stylesXml() {
        return XML_HEADER +
            '<styleSheet xmlns="' + NS_SPREADSHEET + '">' +
            '<fonts count="1">' +
            '<font><sz val="11"/><color theme="1"/><name val="Calibri"/>' +
            '<family val="2"/><scheme val="minor"/></font>' +
            '</fonts>' +
            '<fills count="2">' +
            '<fill><patternFill patternType="none"/></fill>' +
            '<fill><patternFill patternType="gray125"/></fill>' +
            '</fills>' +
            '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
            '<cellStyleXfs count="1">' +
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
            '</cellStyleXfs>' +
            '<cellXfs count="1">' +
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
            '</cellXfs>' +
            '<cellStyles count="1">' +
            '<cellStyle name="Normal" xfId="0" builtinId="0"/>' +
            '</cellStyles>' +
            '</styleSheet>';
    }

    function sheetXml(rows) {
        const list = Array.isArray(rows) ? rows : [];

        let maxColumns = 0;

        list.forEach(function (row) {
            const count = Array.isArray(row) ? row.length : 0;
            if (count > maxColumns) maxColumns = count;
        });

        if (maxColumns === 0) maxColumns = 1;

        const body = list.map(function (row, rowIndex) {
            const cells = (Array.isArray(row) ? row : []).map(function (value, colIndex) {
                const text = String(value === null || value === undefined ? '' : value);

                if (text === '') return '';

                // ช่องว่างหัว-ท้าย/ขึ้นบรรทัดใหม่ต้องสั่งให้ Word เก็บไว้ (ไม่งั้น Excel ตัดทิ้ง)
                const preserve = (text !== text.trim() || /[\n\r\t]/.test(text))
                    ? ' xml:space="preserve"'
                    : '';

                return '<c r="' + cellRef(rowIndex, colIndex) + '" t="inlineStr">' +
                    '<is><t' + preserve + '>' + escapeXml(text) + '</t></is></c>';
            }).join('');

            return '<row r="' + (rowIndex + 1) + '">' + cells + '</row>';
        }).join('');

        const dimension = 'A1:' + columnName(maxColumns - 1) + Math.max(1, list.length);

        return XML_HEADER +
            '<worksheet xmlns="' + NS_SPREADSHEET + '">' +
            '<dimension ref="' + dimension + '"/>' +
            '<sheetData>' + body + '</sheetData>' +
            '</worksheet>';
    }

    // rows = array ของ array ของข้อความ, sheetName = ชื่อ sheet ที่แสดงใน Excel
    async function createBlob(rows, sheetName) {
        if (typeof JSZip === 'undefined') {
            throw new Error('ไม่พบ JSZip (ต้องโหลด vendor/jszip.min.js ก่อน)');
        }

        const zip = new JSZip();

        zip.file('[Content_Types].xml', contentTypesXml());
        zip.file('_rels/.rels', packageRelsXml());
        zip.file('xl/workbook.xml', workbookXml(safeSheetName(sheetName)));
        zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml());
        zip.file('xl/styles.xml', stylesXml());
        zip.file('xl/worksheets/sheet1.xml', sheetXml(rows));

        return zip.generateAsync({
            type: 'blob',
            mimeType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
    }

    // ──────────────────────────────────────────────────────────────
    // อ่านไฟล์ (Import)
    // ──────────────────────────────────────────────────────────────

    // "B7" -> 1 (คอลัมน์ B) และ "AA3" -> 26
    function columnIndex(ref) {
        const match = /^([A-Za-z]+)/.exec(String(ref || ''));
        if (!match) return 0;

        let index = 0;
        const letters = match[1].toUpperCase();

        for (let i = 0; i < letters.length; i++) {
            index = index * 26 + (letters.charCodeAt(i) - 64);
        }

        return index - 1;
    }

    function cellText(cell, sharedStrings) {
        const type = cell.getAttribute('t') || '';

        // inlineStr = ข้อความฝังในช่องเลย
        if (type === 'inlineStr') {
            return collectText(cell);
        }

        const valueNode = findChild(cell, 'v');
        const raw = valueNode ? (valueNode.textContent || '') : '';

        if (type === 's') {
            const index = Number(raw);
            const text = sharedStrings[index];
            return text === undefined ? '' : text;
        }

        if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';

        // str = ผลลัพธ์ของสูตร, e = error, อื่น ๆ = ตัวเลข
        return raw;
    }

    function sheetRows(xml, sharedStrings) {
        const doc = parseXml(xml);
        const rows = [];

        findElements(doc, 'row').forEach(function (rowNode) {
            const row = [];

            for (let i = 0; i < rowNode.childNodes.length; i++) {
                const cell = rowNode.childNodes[i];

                if (cell.nodeType !== 1 || cell.localName !== 'c') continue;

                const ref = cell.getAttribute('r') || '';
                // ช่องที่ไม่มี r ให้ต่อท้ายช่องก่อนหน้า
                const index = ref ? columnIndex(ref) : row.length;

                row[index] = cellText(cell, sharedStrings);
            }

            // แถวที่ข้ามเลขไว้ (เช่น 1,2,5) ให้คงตำแหน่งเดิม
            const rowRef = Number(rowNode.getAttribute('r'));
            rows[rowRef > 0 ? rowRef - 1 : rows.length] = row;
        });

        // สำคัญ: แถว/คอลัมน์ที่ถูกข้ามทำให้ array เป็น sparse
        // ต้องไล่ index เองแทน map() เพื่อไม่ให้ช่องว่างกลายเป็น undefined (JSON เป็น null)
        const dense = [];

        for (let i = 0; i < rows.length; i++) {
            const source = rows[i] || [];
            const row = [];

            for (let j = 0; j < source.length; j++) {
                const cell = source[j];
                row.push(cell === null || cell === undefined ? '' : String(cell));
            }

            dense.push(row);
        }

        return dense;
    }

    async function readSharedStrings(zip) {
        const file = zip.file('xl/sharedStrings.xml');
        if (!file) return [];

        const doc = parseXml(await file.async('string'));

        return findElements(doc, 'si').map(function (item) {
            return collectText(item);
        });
    }

    // ต่อ path ของ part ใน package (จัดการ ../ ให้ด้วย)
    function resolvePath(base, target) {
        const raw = String(target || '').replace(/\\/g, '/');

        if (raw === '') return '';

        const parts = raw.charAt(0) === '/'
            ? raw.slice(1).split('/')
            : (base + '/' + raw).split('/');

        const stack = [];

        parts.forEach(function (part) {
            if (part === '' || part === '.') return;
            if (part === '..') {
                stack.pop();
                return;
            }
            stack.push(part);
        });

        return stack.join('/');
    }

    // หา path ของ sheet แรกจากความสัมพันธ์ใน workbook.xml
    // (ไฟล์ที่ผู้ใช้บันทึกจาก Excel ชื่อไฟล์ sheet อาจไม่ใช่ sheet1.xml)
    async function firstSheetPath(zip) {
        const workbookFile = zip.file('xl/workbook.xml');

        if (workbookFile) {
            const workbook = parseXml(await workbookFile.async('string'));
            const sheets = findElements(workbook, 'sheet');

            if (sheets.length > 0) {
                const sheet = sheets[0];

                const relId =
                    sheet.getAttributeNS(NS_DOC_REL, 'id') ||
                    sheet.getAttribute('r:id');

                if (relId) {
                    const relsFile = zip.file('xl/_rels/workbook.xml.rels');

                    if (relsFile) {
                        const rels = parseXml(await relsFile.async('string'));

                        for (const rel of findElements(rels, 'Relationship')) {
                            if (rel.getAttribute('Id') !== relId) continue;

                            const path = resolvePath('xl', rel.getAttribute('Target'));
                            if (path) return path;
                        }
                    }
                }
            }
        }

        // เผื่ออ่านความสัมพันธ์ไม่ได้: ใช้ worksheet แรกที่เจอแทน
        const candidates = Object.keys(zip.files).filter(function (name) {
            return /^xl\/worksheets\/[^/]+\.xml$/.test(name);
        }).sort();

        if (candidates.length === 0) {
            throw new Error('ไม่พบ sheet ในไฟล์ Excel');
        }

        return candidates[0];
    }

    // คืน array ของ array ของข้อความ (แถวว่างจะกลายเป็น array ว่าง)
    async function readRows(bytes) {
        if (typeof JSZip === 'undefined') {
            throw new Error('ไม่พบ JSZip (ต้องโหลด vendor/jszip.min.js ก่อน)');
        }

        let zip;

        try {
            zip = await JSZip.loadAsync(bytes);
        } catch (error) {
            throw new Error(
                'เปิดไฟล์ไม่ได้ — รองรับเฉพาะไฟล์ .xlsx ' +
                '(ถ้าเป็น .xls เก่า กรุณาบันทึกเป็น Excel Workbook แล้วลองใหม่)'
            );
        }

        if (!zip.file('xl/workbook.xml')) {
            throw new Error(
                'ไฟล์นี้ไม่ใช่ Excel Workbook (.xlsx) — ' +
                'กรุณาบันทึกจาก Excel เป็นชนิด .xlsx'
            );
        }

        const path = await firstSheetPath(zip);
        const sheetFile = zip.file(path);

        if (!sheetFile) {
            throw new Error('ไม่พบ sheet ในไฟล์ Excel');
        }

        const sharedStrings = await readSharedStrings(zip);

        return sheetRows(await sheetFile.async('string'), sharedStrings);
    }

    scope.Xlsx = {
        createBlob: createBlob,
        readRows: readRows,

        // เปิดให้ทดสอบ/ใช้ซ้ำ
        columnName: columnName,
        columnIndex: columnIndex
    };
})(window);
