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
//
// รูปแบบ regex ที่รองรับ:
//   - พิมพ์เฉพาะ pattern เช่น   เลขที่\s*([^\n]+)
//   - หรือพิมพ์แบบมี /.../flags เช่น   /เลขที่\s*([^\n]+)/i
//   ถ้ามีวงเล็บจับกลุ่ม จะใช้กลุ่มแรก (group 1) ที่จับได้ เป็นค่า
//   ถ้าไม่มีวงเล็บเลย จะใช้ข้อความที่ match ทั้งก้อน
(function (scope) {
    'use strict';

    // field ที่เป็นตารางจะถูกข้าม (ข้อมูลตารางกรอกเป็นแถวในหน้ารายงาน)
    const TABLE_TYPE = 'table';
    const LIST_TYPE = 'list';
    const CURRENCY_TYPE = 'currency';
    const CHECKBOX_TYPE = 'checkbox';

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

        return normalizeText(result.text || '');
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

    async function extractFile(file) {
        const name = String((file && file.name) || '').toLowerCase();

        if (!file) {
            throw new Error('ไม่พบไฟล์');
        }

        if (name.endsWith('.pdf')) {
            return textFromPdf(await file.arrayBuffer());
        }

        if (name.endsWith('.docx')) {
            return textFromDocx(await file.arrayBuffer());
        }

        const error = new Error('รองรับเฉพาะไฟล์ .docx และ .pdf');
        error.expected = true;
        throw error;
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
    function matchField(text, pattern, type) {
        const parsed = parsePattern(pattern);

        if (!parsed) {
            return { value: '', error: null };
        }

        const flags = type === LIST_TYPE
            ? parsed.flags + 'g'
            : parsed.flags;

        const regex = new RegExp(parsed.source, flags);
        const source = String(text == null ? '' : text);

        if (type === LIST_TYPE) {
            const items = [];
            let match;

            while ((match = regex.exec(source)) !== null) {
                const value = cleanValue(captureValue(match));

                if (value !== '') items.push(value);

                // กันลูปค้างเมื่อ pattern ว่างหรือจับได้ศูนย์ตัวอักษร
                if (match[0] === '') regex.lastIndex++;
            }

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
     */
    function apply(text, fields, types, patterns) {
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
                const matched = matchField(text, pattern, type);

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

    scope.DataExtract = {
        normalizeText: normalizeText,
        textFromDocumentXml: textFromDocumentXml,
        textFromDocx: textFromDocx,
        textFromPdf: textFromPdf,
        extractFile: extractFile,
        parsePattern: parsePattern,
        matchField: matchField,
        apply: apply
    };
})(window);
