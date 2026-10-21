// Data Extract - ดึงค่าของแต่ละ field จากข้อความ/ไฟล์ ด้วย regex
//
// ใช้ร่วมกัน 2 ที่:
//   1. หน้าตั้งค่าแม่แบบ → ปุ่ม "ข้อมูล"  (แก้ regex + ทดสอบ)
//   2. หน้ารายงาน       → ปุ่ม "ใส่ข้อมูล" (ดึงค่าจากข้อความ/ไฟล์ แล้วเติมลงฟอร์ม)
//
// ข้อความที่ใช้จับ:
//   - ข้อความที่พิมพ์/วางในช่อง
//   - เนื้อหาไฟล์ .docx (อ่าน word/document.xml ด้วย JSZip)
//   - เนื้อหาไฟล์ .pdf  (อ่านที่ main process — ดู src/main/pdf-text.cjs)
//     หน้าไหนไม่มีชั้นข้อความ (ไฟล์จากการสแกน) จะถูก OCR ให้อัตโนมัติ
//
// รูปแบบ regex ที่รองรับ:
//   - พิมพ์เฉพาะ pattern เช่น   เลขที่\s*([^\n]+)
//   - หรือพิมพ์แบบมี /.../flags เช่น   /เลขที่\s*([^\n]+)/i
//   ถ้ามีวงเล็บจับกลุ่ม จะใช้กลุ่มแรก (group 1) ที่จับได้ เป็นค่า
//   ถ้าไม่มีวงเล็บเลย จะใช้ข้อความที่ match ทั้งก้อน
//
// type list (รายการ): regex หนึ่งตัว = หนึ่งแถว
//   - เติม flag g และ m ให้อัตโนมัติ → เก็บทุก match เป็นแถว
//     เขียนแบบ ^-\s*(.+)$ ได้เลย
//   - list ที่อยู่กลุ่ม (Group) เดียวกัน ถูกวาดเป็นแถวเดียวหลายคอลัมน์
//     วงเล็บที่ n ของ regex = คอลัมน์ที่ n ของกลุ่ม (เรียงตามลำดับ field)
(function (scope) {
    'use strict';

    // field ที่เป็นตารางจะถูกข้าม (ข้อมูลตารางกรอกเป็นแถวในหน้ารายงาน)
    const TABLE_TYPE = 'table';
    const LIST_TYPE = 'list';
    const CURRENCY_TYPE = 'currency';
    const CHECKBOX_TYPE = 'checkbox';

    // ──────────────────────────────────────────────────────────────
    // คำที่แก้เอง (แทนคำที่ OCR อ่านผิด)
    // ──────────────────────────────────────────────────────────────
    // OCR ภาษาไทยมักตกไม้โท/สระบนตัวอักษรเล็ก (เช่น "เลขที" แทน "เลขที่")
    // ผู้ใช้แก้คำที่เจอได้ในกล่อง "ข้อมูล" แล้วระบบจะแทนให้อัตโนมัติ
    // เก็บใน localStorage เพราะเป็นการตั้งค่าของเครื่องนี้ (เหมือนค่าตั้งอื่น ๆ ของแอป)
    const TEXT_FIX_KEY = 'wordTemplateFiller:textFixes';
    const TEXT_FIX_LIMIT = 200;

    function normalizeTextFix(entry) {
        const from = String((entry && entry.from) || '').trim();
        const to = String((entry && entry.to) || '').trim();

        return from === '' ? null : { from: from, to: to };
    }

    function loadTextFixes() {
        try {
            const raw = window.localStorage.getItem(TEXT_FIX_KEY);
            const list = raw ? JSON.parse(raw) : [];

            if (!Array.isArray(list)) return [];

            return list
                .map(normalizeTextFix)
                .filter(Boolean)
                .slice(0, TEXT_FIX_LIMIT);

        } catch (error) {
            // ข้อมูลใน localStorage เสีย/อ่านไม่ได้ = เริ่มจากรายการว่าง
            return [];
        }
    }

    function saveTextFixes(list) {
        try {
            window.localStorage.setItem(
                TEXT_FIX_KEY,
                JSON.stringify(
                    (list || [])
                        .map(normalizeTextFix)
                        .filter(Boolean)
                        .slice(0, TEXT_FIX_LIMIT)
                )
            );
        } catch (error) {
            // เก็บไม่ได้ก็ยังใช้กับข้อความรอบนี้ได้
        }
    }

    // อักขระที่ต้องหลบก่อนเอาไปสร้าง RegExp (คีย์ค้นหามาจากผู้ใช้)
    // รวม backslash (charCode 92) ด้วย เผื่อผู้ใช้พิมพ์ backslash มาในคำ
    const BACKSLASH = String.fromCharCode(92);
    const REGEX_SPECIALS = '.*+?^${}()|[]' + BACKSLASH;

    function escapeRegExp(value) {
        const backslash = BACKSLASH;

        return String(value)
            .split('')
            .map(function (char) {
                return REGEX_SPECIALS.indexOf(char) === -1
                    ? char
                    : backslash + char;
            })
            .join('');
    }

    // แทนคำแบบตรงตัว (ไม่ใช่ regex) — คำยาวก่อน กันคำสั้นแทนซ้อนข้างใน
    // คืน { text, changed } เพื่อให้หน้าจอรู้ว่ามีการแก้จริงหรือไม่
    //
    // คำที่ถูกต้องมักมีคำที่ผิดเป็นส่วนนำ (เช่น "เลขที" -> "เลขที่")
    // ถ้าแทนซ้ำ (อ่านไฟล์ใหม่/แก้ข้อความอีกครั้ง) จะเติมไม้โทเพิ่มอีกตัว
    // จึงไม่แทนเมื่อมีส่วนที่เพิ่มอยู่แล้ว — แทนซ้ำกี่ครั้งผลก็เท่าเดิม
    function applyTextFixes(text) {
        const source = String(text == null ? '' : text);
        const fixes = loadTextFixes().sort(function (a, b) {
            return b.from.length - a.from.length;
        });

        let result = source;

        fixes.forEach(function (fix) {
            if (fix.to === fix.from) return;

            const suffix = fix.to.indexOf(fix.from) === 0
                ? fix.to.slice(fix.from.length)
                : '';

            const pattern = new RegExp(
                escapeRegExp(fix.from) +
                (suffix === '' ? '' : '(?!' + escapeRegExp(suffix) + ')'),
                'g'
            );

            result = result.replace(pattern, function () {
                return fix.to;
            });
        });

        return {
            text: result,
            changed: result !== source
        };
    }

    // ──────────────────────────────────────────────────────────────
    // ข้อความจากไฟล์ .docx
    // ──────────────────────────────────────────────────────────────

    function decodeXml(text) {
        return String(text)
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, function (_, code) {
                return String.fromCharCode(Number(code));
            })
            .replace(/&#x([0-9a-fA-F]+);/g, function (_, code) {
                return String.fromCharCode(parseInt(code, 16));
            })
            .replace(/&amp;/g, '&');
    }

    // ข้อความในย่อหน้าเดียว (ตามลำดับในเอกสาร)
    // w:t = ข้อความ, w:tab = แท็บ, w:br / w:cr = ขึ้นบรรทัดใหม่
    function paragraphText(xml) {
        const tokenPattern =
            /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>|<w:tab(?:\s[^>]*)?\/>|<w:br(?:\s[^>]*)?\/>|<w:cr(?:\s[^>]*)?\/>/g;

        let text = '';
        let match;

        while ((match = tokenPattern.exec(xml)) !== null) {
            const token = match[0];

            if (token.indexOf('<w:tab') === 0) {
                text += ' ';
            } else if (token.indexOf('<w:br') === 0 || token.indexOf('<w:cr') === 0) {
                text += ' ';
            } else if (match[1] !== undefined) {
                text += decodeXml(match[1]);
            }
        }

        return text;
    }

    // ข้อความจาก word/document.xml (บรรทัดละย่อหน้า)
    function textFromDocumentXml(xml) {
        const paragraphs = [];
        const paragraphPattern = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;

        let match;

        while ((match = paragraphPattern.exec(String(xml))) !== null) {
            paragraphs.push(paragraphText(match[1]));
        }

        return normalizeText(paragraphs.join('\n'));
    }

    async function textFromDocx(data) {
        if (!scope.JSZip) {
            throw new Error('ไม่พบไลบรารี JSZip (โหลดหน้าใหม่แล้วลองอีกครั้ง)');
        }

        const zip = await scope.JSZip.loadAsync(data);
        const entry = zip.file('word/document.xml');

        if (!entry) {
            const error = new Error(
                'ไฟล์ DOCX ไม่ถูกต้อง (ไม่พบ word/document.xml)'
            );

            error.expected = true;
            throw error;
        }

        return textFromDocumentXml(await entry.async('string'));
    }

    // ──────────────────────────────────────────────────────────────
    // ข้อความจากไฟล์ .pdf
    // ──────────────────────────────────────────────────────────────

    // คืน { text, ocrPages }
    //   ocrPages = เลขหน้าที่ไม่มีชั้นข้อความ จึงต้องอ่านด้วย OCR (ไฟล์สแกน)
    async function textFromPdf(data) {
        if (!window.electronAPI || !window.electronAPI.extractPdfText) {
            throw new Error(
                'อ่านไฟล์ PDF ได้เฉพาะในแอป (Electron) — ' +
                'หรือใช้การวางข้อความแทน'
            );
        }

        const result = await window.electronAPI.extractPdfText({
            data: data
        });

        if (!result || !result.ok) {
            const error = new Error(
                (result && result.error) || 'อ่านข้อความจาก PDF ไม่สำเร็จ'
            );

            error.expected = true;
            throw error;
        }

        const text = normalizeText(result.text || '');
        const ocrPages = Array.isArray(result.ocrPages) ? result.ocrPages : [];

        // เอกสารสแกน + OCR ใช้ไม่ได้ = ไม่มีข้อความให้ regex จับเลย
        // ต้องบอกสาเหตุ ไม่ใช่ปล่อยให้ผู้ใช้เห็นช่องว่างเฉย ๆ
        if (text === '' && result.ocrError) {
            const error = new Error(
                'PDF นี้เป็นเอกสารสแกน และ OCR อ่านไม่สำเร็จ: ' +
                result.ocrError
            );

            error.expected = true;
            throw error;
        }

        return {
            text: text,
            ocrPages: ocrPages,
            // หน้า OCR พร้อมภาพตัวอย่าง + ตำแหน่งของแต่ละคำ
            // ใช้ในหน้าจอ "ตรวจคำบน PDF" (หน้าเอกสารที่มีชั้นข้อความไม่มีภาพ)
            pages: Array.isArray(result.pages) ? result.pages : []
        };
    }

    // ──────────────────────────────────────────────────────────────
    // ข้อความที่ใช้จับ regex
    // ──────────────────────────────────────────────────────────────

    // รวมช่องว่างซ้ำ, ตัดช่องว่างหัวท้ายแต่ละบรรทัด
    // และยุบบรรทัดว่างติดกันให้เหลือบรรทัดเดียว
    function normalizeText(text) {
        const lines = String(text == null ? '' : text)
            .replace(/\r\n?/g, '\n')
            .replace(/\u00a0/g, ' ')
            .replace(/[\u200b\u200e\u200f\ufeff]/g, '')
            .split('\n')
            .map(function (line) {
                return line.replace(/[ \t]+/g, ' ').trim();
            });

        const kept = [];

        lines.forEach(function (line) {
            if (line === '' && kept.length > 0 && kept[kept.length - 1] === '') {
                return;
            }

            kept.push(line);
        });

        while (kept.length > 0 && kept[0] === '') kept.shift();
        while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();

        return kept.join('\n');
    }

    // คืน { text, ocrPages, pages, fixed }
    //   pages = หน้า OCR พร้อมภาพ+ตำแหน่งคำ (สำหรับหน้าจอตรวจคำ)
    //   fixed = มีการแทนคำตามรายการ "คำที่แก้เอง" หรือไม่
    async function extractFile(file) {
        const name = String((file && file.name) || '').toLowerCase();

        if (!file) {
            throw new Error('ไม่พบไฟล์');
        }

        let result;

        if (name.endsWith('.pdf')) {
            result = await textFromPdf(await file.arrayBuffer());
        } else if (name.endsWith('.docx')) {
            result = {
                text: await textFromDocx(await file.arrayBuffer()),
                ocrPages: [],
                pages: []
            };
        } else {
            const error = new Error('รองรับเฉพาะไฟล์ .docx และ .pdf');
            error.expected = true;
            throw error;
        }

        // คำที่ผู้ใช้แก้ไว้ ใช้กับข้อความที่อ่านจากไฟล์ทุกชนิด
        const fixed = applyTextFixes(result.text);

        return {
            text: fixed.text,
            ocrPages: result.ocrPages,
            pages: result.pages || [],
            fixed: fixed.changed
        };
    }

    // ──────────────────────────────────────────────────────────────
    // Regex ของแต่ละ field
    // ──────────────────────────────────────────────────────────────

    const FLAG_LETTERS = 'dgimsuvy';

    // แยก "/pattern/flags" หรือ pattern ธรรมดา
    function parsePattern(pattern) {
        const raw = String(pattern == null ? '' : pattern).trim();

        if (raw === '') return null;

        const literal = /^\/([\s\S]+)\/([a-z]*)$/.exec(raw);

        if (literal) {
            const flags = literal[2]
                .split('')
                .filter(function (flag, index, all) {
                    return (
                        FLAG_LETTERS.indexOf(flag) !== -1 &&
                        flag !== 'g' &&
                        flag !== 'y' &&
                        flag !== 'd' &&
                        all.indexOf(flag) === index
                    );
                })
                .join('');

            return {
                source: literal[1],
                flags: flags
            };
        }

        return {
            source: raw,
            flags: ''
        };
    }

    // ค่าจากผล match: วงเล็บกลุ่มแรกถ้ามี ไม่งั้นใช้ทั้งก้อน
    function captureValue(match) {
        if (!match) return '';

        if (match.length > 1) {
            for (let index = 1; index < match.length; index++) {
                if (match[index] !== undefined) {
                    return String(match[index]);
                }
            }
        }

        return String(match[0]);
    }

    function cleanValue(value) {
        return String(value == null ? '' : value)
            .replace(/[\u200b\u200e\u200f\ufeff]/g, '')
            .trim();
    }

    // ค่าของ "คอลัมน์ที่ n" จากผล match (ใช้กับ type list ที่อยู่กลุ่มเดียวกัน)
    // - n = 0/ไม่ระบุ → ใช้วงเล็บแรกที่มีค่า (หรือทั้งก้อนเมื่อไม่มีวงเล็บ)
    // - n เกินจำนวนวงเล็บ → ถอยไปใช้วงเล็บแรก เพื่อไม่ให้แถวนั้นหายไป
    function captureColumn(match, column) {
        if (!match) return '';

        const index = Number(column) || 0;

        if (index > 0 && index < match.length && match[index] !== undefined) {
            return cleanValue(match[index]);
        }

        return cleanValue(captureValue(match));
    }

    // ลำดับคอลัมน์ของ list ที่ใช้กลุ่ม (Group) เดียวกัน
    //
    // หน้ารายงานวาด list ที่กลุ่มเดียวกันเป็น "แถวเดียว หลายคอลัมน์"
    // จึงต้องรู้ว่า field ไหนคือคอลัมน์ที่เท่าไรของกลุ่ม:
    //   วงเล็บที่ 1 ของ regex = คอลัมน์ที่ 1, วงเล็บที่ 2 = คอลัมน์ที่ 2, ...
    // เรียงตามลำดับ field ในแม่แบบ (ลำดับเดียวกับที่แสดงในกล่อง "ข้อมูล")
    //
    // field ที่อยู่คนเดียวในกลุ่ม (หรือไม่มีกลุ่ม) ไม่ต้องใช้เลขคอลัมน์
    // → คืนเฉพาะ field ที่กลุ่มมีสมาชิกมากกว่า 1
    function listColumns(fields, types, listGroups) {
        const typeMap = types || {};
        const groupMap = listGroups || {};
        const byGroup = {};
        const columns = {};

        (fields || []).forEach(function (field) {
            if (typeMap[field] !== LIST_TYPE) return;

            const group = String(groupMap[field] == null ? '' : groupMap[field]).trim();

            if (group === '') return;

            if (!byGroup[group]) byGroup[group] = [];
            byGroup[group].push(field);
        });

        Object.keys(byGroup).forEach(function (group) {
            const members = byGroup[group];

            if (members.length < 2) return;

            members.forEach(function (field, index) {
                columns[field] = index + 1;
            });
        });

        return columns;
    }

    // แปลงค่าที่จับได้ให้ตรงกับชนิดของช่องในหน้ารายงาน
    function valueForType(type, value) {
        const text = cleanValue(value);

        if (type === CURRENCY_TYPE) {
            // "1,000.00 บาท" → "1000.00" (ค่าที่เก็บในช่องต้องเป็นตัวเลขล้วน)
            const numeric = text
                .replace(/,/g, '')
                .replace(/[\s]/g, '')
                .match(/-?\d+(?:\.\d+)?/);

            return numeric ? numeric[0] : text;
        }

        if (type === CHECKBOX_TYPE) {
            if (text === '') return 'false';

            const falsy = ['0', 'false', 'no', 'n', 'ไม่', '✗', '☐', '-'];
            const checked = falsy.indexOf(text.toLowerCase()) === -1;

            return checked ? 'true' : 'false';
        }

        return text;
    }

    // ใช้ regex ของ field หนึ่งกับข้อความ
    // คืน { value, error } — value = '' เมื่อไม่พบ
    //
    // options.column = เลขคอลัมน์ของ type list ที่อยู่ในกลุ่ม (1 = วงเล็บแรก)
    function matchField(text, pattern, type, options) {
        const parsed = parsePattern(pattern);

        if (!parsed) {
            return { value: '', error: null };
        }

        // list: เก็บทุก match เป็นแถว จึงใส่ g ให้อัตโนมัติ
        // และใส่ m ด้วย (^ $ ของแต่ละบรรทัด) — pattern เขียนแบบ ^-\s*(.+)$ ได้เลย
        const flags = type === LIST_TYPE
            ? parsed.flags +
                'g' +
                (parsed.flags.indexOf('m') === -1 ? 'm' : '')
            : parsed.flags;

        const regex = new RegExp(parsed.source, flags);
        const source = String(text == null ? '' : text);

        if (type === LIST_TYPE) {
            const column = Number(options && options.column) || 0;
            const items = [];
            let match;

            // 1 match = 1 แถวของ list (ใช้ flag g ให้อัตโนมัติ)
            while ((match = regex.exec(source)) !== null) {
                // เก็บแถวที่มีค่าว่างไว้ด้วย เพื่อให้จำนวนแถวของทุกคอลัมน์ในกลุ่มตรงกัน
                items.push(captureColumn(match, column));

                // กันลูปค้างเมื่อ pattern ว่างหรือจับได้ศูนย์ตัวอักษร
                if (match[0] === '') regex.lastIndex++;
            }

            // แถวว่างที่ค้างอยู่ท้ายรายการไม่ใช่ข้อมูล
            while (items.length > 0 && items[items.length - 1] === '') items.pop();

            return {
                value: items.length > 0 ? { items: items } : '',
                error: null
            };
        }

        const match = regex.exec(source);
        const raw = captureValue(match);

        return {
            value: match ? valueForType(type, raw) : '',
            error: null
        };
    }

    /**
     * จับค่าทุก field จากข้อความ
     * @param {string} text ข้อความต้นทาง
     * @param {string[]} fields ชื่อ field ทั้งหมดของแม่แบบ
     * @param {Object} types field → type ('text'/'currency'/...)
     * @param {Object} patterns field → regex
     * @param {Object} options { listGroups: field → ชื่อกลุ่ม }
     */
    function apply(text, fields, types, patterns, options) {
        const result = {
            values: {},
            matched: [],
            unmatched: [],
            missingPattern: [],
            errors: [],
            skipped: []
        };

        const typeMap = types || {};
        const patternMap = patterns || {};

        // list ที่อยู่กลุ่มเดียวกัน: วงเล็บที่ n = คอลัมน์ที่ n ของกลุ่ม
        const columns = listColumns(
            fields,
            typeMap,
            options && options.listGroups
        );

        (fields || []).forEach(function (field) {
            const type = typeMap[field] || 'text';
            const pattern = String(patternMap[field] == null ? '' : patternMap[field]).trim();

            if (type === TABLE_TYPE) {
                result.skipped.push({
                    field: field,
                    reason: 'ตารางกรอกเป็นแถวในหน้ารายงาน (ใช้ regex ไม่ได้)'
                });
                return;
            }

            if (pattern === '') {
                result.missingPattern.push(field);
                return;
            }

            try {
                const matched = matchField(text, pattern, type, {
                    column: columns[field] || 0
                });

                if (matched.value === '' ||
                    (matched.value && Array.isArray(matched.value.items) && matched.value.items.length === 0)) {
                    result.unmatched.push(field);
                    return;
                }

                result.values[field] = matched.value;
                result.matched.push({
                    field: field,
                    value: matched.value
                });

            } catch (error) {
                result.errors.push({
                    field: field,
                    message: error && error.message ? error.message : String(error)
                });
            }
        });

        return result;
    }

    // เพิ่ม/แก้คำที่อ่านผิด (คีย์คือคำที่อ่านผิด — มีได้ครั้งเดียว)
    function setTextFix(from, to) {
        const key = String(from == null ? '' : from).trim();
        const value = String(to == null ? '' : to).trim();

        if (key === '' || value === '' || key === value) return false;

        const fixes = loadTextFixes();
        const existing = fixes.find(function (fix) {
            return fix.from === key;
        });

        if (existing) {
            if (existing.to === value) return false;
            existing.to = value;
        } else {
            fixes.push({ from: key, to: value });
        }

        saveTextFixes(fixes);
        return true;
    }

    // ลบคำที่แก้ — คืน true เมื่อมีรายการให้ลบจริง
    function deleteTextFix(from) {
        const key = String(from == null ? '' : from).trim();
        const fixes = loadTextFixes();
        const rest = fixes.filter(function (fix) {
            return fix.from !== key;
        });

        if (rest.length === fixes.length) return false;

        saveTextFixes(rest);
        return true;
    }

    // คำที่แก้ของคำนี้ (ถ้ามี)
    function findTextFix(from) {
        const key = String(from == null ? '' : from).trim();

        return loadTextFixes().find(function (fix) {
            return fix.from === key;
        }) || null;
    }

    scope.DataExtract = {
        TEXT_FIX_KEY: TEXT_FIX_KEY,
        loadTextFixes: loadTextFixes,
        saveTextFixes: saveTextFixes,
        setTextFix: setTextFix,
        deleteTextFix: deleteTextFix,
        findTextFix: findTextFix,
        applyTextFixes: applyTextFixes,
        normalizeText: normalizeText,
        textFromDocumentXml: textFromDocumentXml,
        textFromDocx: textFromDocx,
        textFromPdf: textFromPdf,
        extractFile: extractFile,
        parsePattern: parsePattern,
        listColumns: listColumns,
        matchField: matchField,
        apply: apply
    };
})(window);
