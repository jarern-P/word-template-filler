// Regex Builder - สร้าง regex จากคำขึ้นต้น/คำลงท้าย และอธิบาย regex เป็นภาษาคน
//
// ใช้ในหน้า "Regex" (เมนู ประวัติและการตั้งค่า) — เป็นเครื่องมือล้วน ไม่แตะฐานข้อมูล
//
//   RegexBuilder.build({ prefix, gap, valueType, suffix, anchor, ignoreCase, multiline, global })
//     → { ok, pattern, flags, full }        full = /pattern/flags (ถ้ามี flag)
//
//   RegexBuilder.describe('เลขที่\s*[:：]?\s*([^\n]+)')
//     → { ok, pattern, flags, parts: [{ kind, text }], steps, flagsText }
//
//   RegexBuilder.findMatches(expr, text)
//     → { ok, matches: [{ value, index, line, groups }], truncated }
//
// อธิบายทีละส่วนจากซ้ายไปขวา เพื่อให้อ่านรู้เรื่องว่า regex จับอะไร
// (ไม่ใช่การแปลไวยากรณ์ regex ทั้งหมด — รองรับสิ่งที่ใช้จริงในแอปนี้)
(function (scope) {
    'use strict';

    // อักขระที่ทำให้จบข้อความธรรมดา (ต้องอ่านเป็นคำสั่งของ regex)
    const SPECIAL = '\\^$.|?*+()[]';

    const ESCAPES = {
        d: 'ตัวเลข 0-9',
        D: 'ตัวที่ไม่ใช่ตัวเลข',
        w: 'ตัวอักษร ตัวเลข หรือขีดล่าง',
        W: 'ตัวที่ไม่ใช่ตัวอักษร/ตัวเลข/ขีดล่าง',
        s: 'ช่องว่าง (เว้นวรรค แท็บ ขึ้นบรรทัดใหม่)',
        S: 'ตัวที่ไม่ใช่ช่องว่าง',
        b: 'ขอบคำ',
        B: 'ตำแหน่งที่ไม่ใช่ขอบคำ',
        n: 'ขึ้นบรรทัดใหม่',
        r: 'ขึ้นบรรทัดใหม่ (CR)',
        t: 'แท็บ',
        f: 'ฟอร์มฟีด',
        v: 'แท็บแนวตั้ง',
        0: 'อักขระ null'
    };

    const FLAG_TEXT = {
        i: 'ไม่สนใจตัวพิมพ์เล็ก/ใหญ่',
        g: 'จับทุกที่ที่พบ (ไม่หยุดที่ผลแรก)',
        m: 'ให้ ^ และ $ หมายถึงต้น/จบบรรทัด',
        s: 'ให้ . จับขึ้นบรรทัดใหม่ได้ด้วย',
        u: 'รองรับ Unicode เต็มรูปแบบ',
        y: 'จับต่อเนื่องจากตำแหน่งเดิม',
        d: 'เก็บตำแหน่งของผลที่จับได้'
    };

    function text(value) {
        return String(value == null ? '' : value);
    }

    // ──────────────────────────────────────────────────────────────
    // ตัวสร้าง regex
    // ──────────────────────────────────────────────────────────────

    // ข้อความที่ผู้ใช้พิมพ์ = ตัวอักษรธรรมดา ต้อง escape ก่อนเอาไปเป็น regex
    function escapeLiteral(value) {
        return text(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }

    function gapPattern(gap) {
        if (gap === 'none') return '';
        if (gap === 'space') return '\\s+';
        if (gap === 'colon') return '\\s*[:：]\\s*';

        // ค่าเริ่มต้น: เว้นวรรคหรือเครื่องหมาย : ก็ได้ (หรือไม่มีเลย)
        return '\\s*[:：]?\\s*';
    }

    function build(options) {
        const opt = options || {};

        const prefix = text(opt.prefix);
        const suffix = text(opt.suffix);
        const hasSuffix = suffix !== '';
        const valueType = opt.valueType || 'line';

        let pattern = '';

        if (prefix !== '') pattern += escapeLiteral(prefix);

        pattern += gapPattern(opt.gap);

        // ค่าที่จะจับ — เก็บเป็นกลุ่มที่ 1 เสมอ (ปุ่ม "ข้อมูล" ใช้กลุ่มแรกเป็นค่า)
        let value;

        if (valueType === 'number') {
            value = '([\\d,]+(?:\\.\\d+)?)';
        } else if (valueType === 'date') {
            value = '(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4})';
        } else if (hasSuffix) {
            // มีคำลงท้าย = จับแบบสั้นที่สุดจนเจอคำลงท้าย
            value = '(.+?)';
        } else {
            // ข้อความจนจบบรรทัด
            value = '(.+)';
        }

        pattern += value;

        if (hasSuffix) pattern += escapeLiteral(suffix);

        if (opt.anchor) pattern = '^' + pattern + '$';

        const flags = [
            opt.ignoreCase ? 'i' : '',
            opt.multiline ? 'm' : '',
            opt.global ? 'g' : ''
        ].join('');

        try {
            // ตรวจว่าสร้าง regex ได้จริง
            new RegExp(pattern, flags);
        } catch (error) {
            return {
                ok: false,
                error: 'สร้าง regex ไม่สำเร็จ: ' + error.message
            };
        }

        return {
            ok: true,
            pattern: pattern,
            flags: flags,
            full: flags ? '/' + pattern + '/' + flags : pattern
        };
    }

    // ──────────────────────────────────────────────────────────────
    // อ่านรูปแบบ /.../flags
    // ──────────────────────────────────────────────────────────────

    function splitExpression(expression) {
        const raw = text(expression).trim();

        if (raw === '') {
            return { ok: false, error: 'ยังไม่มี regex ให้อธิบาย' };
        }

        if (raw.charAt(0) !== '/') {
            return { ok: true, pattern: raw, flags: '' };
        }

        // หา / ปิดตัวสุดท้ายที่ไม่ได้ escape
        let end = -1;

        for (let i = raw.length - 1; i > 0; i -= 1) {
            if (raw.charAt(i) === '/' && raw.charAt(i - 1) !== '\\') {
                end = i;
                break;
            }
        }

        if (end <= 0) {
            return { ok: false, error: 'รูปแบบ /.../flags ไม่ครบ' };
        }

        const flags = raw.slice(end + 1);

        if (!/^[dgimsuvy]*$/.test(flags)) {
            return { ok: false, error: 'flag ไม่ถูกต้อง: ' + flags };
        }

        return { ok: true, pattern: raw.slice(1, end), flags: flags };
    }

    // ──────────────────────────────────────────────────────────────
    // คำอธิบายของแต่ละส่วน
    // ──────────────────────────────────────────────────────────────

    function withQuantifier(part, quantifier) {
        if (!quantifier) return part;

        return {
            kind: part.kind,
            text: part.text + ' — ' + quantifier
        };
    }

    // อ่านตัวคูณ (* + ? {n} {n,} {n,m}) และตัวเลือกแบบสั้นที่สุด (?)
    function readQuantifier(source, index) {
        const char = source.charAt(index);

        let phrase = '';
        let i = index;

        if (char === '*') {
            phrase = 'ซ้ำได้ 0 ครั้งขึ้นไป (จะมีหรือไม่มีก็ได้)';
            i += 1;
        } else if (char === '+') {
            phrase = 'ซ้ำได้ 1 ครั้งขึ้นไป';
            i += 1;
        } else if (char === '?') {
            phrase = 'มีหรือไม่มีก็ได้';
            i += 1;
        } else if (char === '{') {
            const match = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(index));

            if (match) {
                const min = Number(match[1]);

                if (match[2] === undefined) {
                    phrase = 'ซ้ำ ' + min + ' ครั้ง';
                } else if (match[3] === '') {
                    phrase = 'ซ้ำอย่างน้อย ' + min + ' ครั้ง';
                } else {
                    phrase = 'ซ้ำ ' + min + ' ถึง ' + Number(match[3]) + ' ครั้ง';
                }

                i = index + match[0].length;
            }
        }

        if (phrase !== '' && source.charAt(i) === '?') {
            phrase += ' แบบสั้นที่สุด (หยุดเมื่อเจอส่วนถัดไป)';
            i += 1;
        }

        return { text: phrase, index: i };
    }

    // อักขระเดี่ยวในวงเล็บเหลี่ยม (รองรับ \x)
    function readClassChar(body, index) {
        const char = body.charAt(index);

        if (char === '\\') {
            const next = body.charAt(index + 1);

            if (next === '') {
                return { error: 'มี \\ ท้ายวงเล็บเหลี่ยมโดยไม่มีอักขระตามหลัง' };
            }

            if (ESCAPES[next]) {
                return {
                    label: ESCAPES[next],
                    char: null,
                    index: index + 2
                };
            }

            return {
                label: quote(next),
                char: next,
                index: index + 2
            };
        }

        return {
            label: quote(char),
            char: char,
            index: index + 1
        };
    }

    function quote(char) {
        if (char === ' ') return 'ช่องว่าง';
        if (char === '\t') return 'แท็บ';
        if (char === '\n') return 'ขึ้นบรรทัดใหม่';

        return '"' + char + '"';
    }

    function rangeLabel(start, end) {
        const from = start.char;
        const to = end.char;

        if (from === '0' && to === '9') return 'ตัวเลข 0-9';
        if (from === 'a' && to === 'z') return 'ตัวอักษร a-z';
        if (from === 'A' && to === 'Z') return 'ตัวอักษร A-Z';
        if (from === 'ก' && to === 'ฮ') return 'พยัญชนะไทย ก-ฮ';
        if (from === '๐' && to === '๙') return 'เลขไทย ๐-๙';

        return 'อักขระ ' +
            (from === null ? start.label : '"' + from + '"') +
            ' ถึง ' +
            (to === null ? end.label : '"' + to + '"');
    }

    // อธิบายเนื้อในวงเล็บเหลี่ยม เช่น [^\n] / [\d,] / [a-z]
    function describeClassBody(body, negated) {
        const items = [];

        let i = 0;

        while (i < body.length) {
            const start = readClassChar(body, i);

            if (start.error) return start;

            i = start.index;

            // ช่วงอักขระ (a-z) — ต้องมีอักขระอีกตัวหลัง -
            if (body.charAt(i) === '-' && i + 1 < body.length) {
                const end = readClassChar(body, i + 1);

                if (end.error) return end;

                items.push(rangeLabel(start, end));
                i = end.index;
                continue;
            }

            items.push(start.label);
        }

        const bodyText = items.length > 0
            ? items.join(' หรือ ')
            : 'อักขระใดก็ได้';

        return {
            text: negated
                ? 'อักขระใดก็ได้ ยกเว้น ' + bodyText
                : bodyText
        };
    }

    function readClass(source, index) {
        let i = index + 1;
        let body = '';
        let negated = false;

        if (source.charAt(i) === '^') {
            negated = true;
            i += 1;
        }

        while (i < source.length) {
            const char = source.charAt(i);

            if (char === ']' && body !== '') {
                const described = describeClassBody(body, negated);

                if (described.error) return described;

                return {
                    text: described.text,
                    kind: 'class',
                    index: i + 1
                };
            }

            if (char === '\\') {
                body += char + source.charAt(i + 1);
                i += 2;
                continue;
            }

            body += char;
            i += 1;
        }

        return { error: 'วงเล็บเหลี่ยมไม่ครบ (ขาด ] )' };
    }

    // อักขระ escape นอกวงเล็บเหลี่ยม
    function readEscape(source, index) {
        const next = source.charAt(index + 1);

        if (next === '') {
            return { error: 'มี \\ ท้าย regex โดยไม่มีอักขระตามหลัง' };
        }

        if (ESCAPES[next]) {
            return {
                text: ESCAPES[next],
                kind: next === 'b' || next === 'B' ? 'anchor' : 'class',
                index: index + 2
            };
        }

        // \1 .. \9 = ข้อความเดียวกับกลุ่มก่อนหน้า
        if (/[1-9]/.test(next)) {
            return {
                text: 'ข้อความเดียวกับกลุ่มที่ ' + next,
                kind: 'group',
                index: index + 2
            };
        }

        // \k<name> = ข้อความเดียวกับกลุ่มที่ตั้งชื่อไว้
        if (next === 'k' && source.charAt(index + 2) === '<') {
            const end = source.indexOf('>', index + 3);

            if (end === -1) {
                return { error: 'ชื่อกลุ่มหลัง \\k< ไม่ครบ (ต้องมี >)' };
            }

            return {
                text: 'ข้อความเดียวกับกลุ่มชื่อ "' +
                    source.slice(index + 3, end) + '"',
                kind: 'group',
                index: end + 1
            };
        }

        // \p{L} / \P{L} = หมวดอักขระ Unicode
        if ((next === 'p' || next === 'P') && source.charAt(index + 2) === '{') {
            const end = source.indexOf('}', index + 3);

            if (end === -1) {
                return { error: 'หมวด Unicode ไม่ครบ (ต้องมี })' };
            }

            const category = source.slice(index + 3, end);

            return {
                text: (next === 'P' ? 'ตัวที่ไม่ใช่' : 'ตัวอักษร') +
                    'หมวด Unicode ' + category,
                kind: 'class',
                index: end + 1
            };
        }

        const labels = { x: 'อักขระรหัส hex', u: 'อักขระรหัส Unicode' };

        if (labels[next]) {
            return {
                text: labels[next],
                kind: 'literal',
                index: index + 2
            };
        }

        // \. \( \\ ฯลฯ = ตัวอักษรนั้นตรง ๆ
        return {
            text: quote(next),
            kind: 'literal',
            index: index + 2
        };
    }

    // อ่าน "กลุ่ม" ( … ) พร้อมคำอธิบายข้างใน
    function readGroup(source, index, context) {
        let i = index + 1;
        let capture = true;
        let name = '';
        let prefix = '';

        if (source.startsWith('?:', i)) {
            capture = false;
            prefix = 'กลุ่ม (ไม่จับค่า): ';
            i += 2;
        } else if (source.startsWith('?=', i)) {
            capture = false;
            prefix = 'ตรวจว่าข้างหน้าคือ: ';
            i += 2;
        } else if (source.startsWith('?!', i)) {
            capture = false;
            prefix = 'ตรวจว่าข้างหน้าไม่ใช่: ';
            i += 2;
        } else if (source.startsWith('?<=', i)) {
            capture = false;
            prefix = 'ตรวจว่าข้างหลังคือ: ';
            i += 3;
        } else if (source.startsWith('?<!', i)) {
            capture = false;
            prefix = 'ตรวจว่าข้างหลังไม่ใช่: ';
            i += 3;
        } else if (source.startsWith('?<', i)) {
            const end = source.indexOf('>', i + 2);

            if (end === -1) {
                return { error: 'ชื่อกลุ่มไม่ครบ (ต้องมี >)' };
            }

            name = source.slice(i + 2, end);
            i = end + 1;
        } else if (source.charAt(i) === '?') {
            return { error: 'รูปแบบกลุ่ม (?...) นี้ยังไม่รองรับ' };
        }

        if (capture) context.groups += 1;

        const inner = readSequence(source, i, context, true);

        if (inner.error) return inner;

        if (!inner.closed) {
            return { error: 'วงเล็บไม่ครบ (ขาด ) )' };
        }

        const innerText = inner.parts.length > 0
            ? inner.parts.map(function (part) {
                return part.text;
            }).join(' → ')
            : 'กลุ่มว่าง';

        let text;

        if (capture && name !== '') {
            text = 'จับกลุ่มชื่อ "' + name + '": ' + innerText;
        } else if (capture) {
            text = 'จับกลุ่มที่ ' + context.groups + ': ' + innerText;
        } else {
            text = prefix + innerText;
        }

        return { text: text, index: inner.index };
    }

    // อ่าน regex ตั้งแต่ตำแหน่งหนึ่ง — คืนรายการส่วนที่อธิบายแล้ว
    function readSequence(source, start, context, inGroup) {
        const parts = [];

        let i = start;

        while (i < source.length) {
            const char = source.charAt(i);

            if (char === ')') {
                if (!inGroup) {
                    return { error: 'พบ ) เกินมา (ไม่มีวงเล็บเปิด)' };
                }

                return { parts: parts, index: i + 1, closed: true };
            }

            if (char === '(') {
                const group = readGroup(source, i, context);

                if (group.error) return group;

                i = group.index;

                const quantifier = readQuantifier(source, i);
                i = quantifier.index;

                parts.push(withQuantifier(
                    { kind: 'group', text: group.text },
                    quantifier.text
                ));

                continue;
            }

            if (char === '[') {
                const klass = readClass(source, i);

                if (klass.error) return klass;

                i = klass.index;

                const quantifier = readQuantifier(source, i);
                i = quantifier.index;

                parts.push(withQuantifier(
                    { kind: klass.kind, text: klass.text },
                    quantifier.text
                ));

                continue;
            }

            if (char === '\\') {
                const escaped = readEscape(source, i);

                if (escaped.error) return escaped;

                i = escaped.index;

                const quantifier = readQuantifier(source, i);
                i = quantifier.index;

                parts.push(withQuantifier(
                    { kind: escaped.kind, text: escaped.text },
                    quantifier.text
                ));

                continue;
            }

            if (char === '{') {
                // {2} = ตัวคูณของส่วนก่อนหน้า / ไม่งั้นถือเป็นตัวอักษรธรรมดา
                const quantifier = readQuantifier(source, i);

                if (quantifier.text !== '' && parts.length > 0) {
                    parts[parts.length - 1] = withQuantifier(
                        parts[parts.length - 1],
                        quantifier.text
                    );

                    i = quantifier.index;
                    continue;
                }
            }

            if (char === '^') {
                parts.push({
                    kind: 'anchor',
                    text: context.multiline ? 'เริ่มต้นบรรทัด' : 'เริ่มต้นข้อความ'
                });

                i += 1;
                continue;
            }

            if (char === '$') {
                parts.push({
                    kind: 'anchor',
                    text: context.multiline ? 'จบบรรทัด' : 'จบข้อความ'
                });

                i += 1;
                continue;
            }

            if (char === '.') {
                parts.push({
                    kind: 'class',
                    text: context.dotAll
                        ? 'อักขระใดก็ได้ 1 ตัว'
                        : 'อักขระใดก็ได้ 1 ตัว (ยกเว้นขึ้นบรรทัดใหม่)'
                });

                i += 1;

                const quantifier = readQuantifier(source, i);
                i = quantifier.index;
                parts[parts.length - 1] = withQuantifier(
                    parts[parts.length - 1],
                    quantifier.text
                );

                continue;
            }

            if (char === '|') {
                parts.push({ kind: 'alternation', text: 'หรือ' });
                i += 1;
                continue;
            }

            // ข้อความธรรมดาติดกันหลายตัว = รวมเป็นส่วนเดียว
            let run = '';

            while (i < source.length && SPECIAL.indexOf(source.charAt(i)) === -1) {
                run += source.charAt(i);
                i += 1;
            }

            if (run === '') {
                // { } หลุดมาเดี่ยว ๆ = ตัวอักษรธรรมดา
                run = char;
                i += 1;
            }

            const part = { kind: 'literal', text: 'ข้อความ ' + quote(run) };

            const quantifier = readQuantifier(source, i);
            i = quantifier.index;

            parts.push(withQuantifier(part, quantifier.text));
        }

        if (inGroup) {
            return { parts: parts, index: i, closed: false };
        }

        return { parts: parts, index: i };
    }

    function describeFlags(flags) {
        return text(flags).split('').map(function (flag) {
            return FLAG_TEXT[flag] || '';
        }).filter(Boolean);
    }

    function describe(expression) {
        const split = splitExpression(expression);

        if (!split.ok) return split;

        try {
            // ตรวจ syntax ก่อน — จะได้ไม่ต้องอธิบาย regex ที่ใช้ไม่ได้
            new RegExp(split.pattern, split.flags.replace(/[gy]/g, ''));
        } catch (error) {
            return {
                ok: false,
                error: 'regex ไม่ถูกต้อง: ' + error.message
            };
        }

        const context = {
            groups: 0,
            multiline: split.flags.indexOf('m') !== -1,
            dotAll: split.flags.indexOf('s') !== -1
        };

        const parsed = readSequence(split.pattern, 0, context, false);

        if (parsed.error) return { ok: false, error: parsed.error };

        if (parsed.index < split.pattern.length) {
            return { ok: false, error: 'อ่าน regex ไม่ครบ — ตรวจวงเล็บอีกครั้ง' };
        }

        if (parsed.parts.length === 0) {
            return { ok: false, error: 'regex ว่างเปล่า' };
        }

        return {
            ok: true,
            pattern: split.pattern,
            flags: split.flags,
            parts: parsed.parts,
            steps: parsed.parts.map(function (part) {
                return part.text;
            }),
            flagsText: describeFlags(split.flags)
        };
    }

    // ──────────────────────────────────────────────────────────────
    // ทดสอบกับข้อความ
    // ──────────────────────────────────────────────────────────────

    function lineOf(input, index) {
        let line = 1;

        for (let i = 0; i < index && i < input.length; i += 1) {
            if (input.charAt(i) === '\n') line += 1;
        }

        return line;
    }

    const MAX_MATCHES = 200;

    function findMatches(expression, content) {
        const split = splitExpression(expression);

        if (!split.ok) return split;

        const flags = split.flags.indexOf('g') === -1
            ? split.flags + 'g'
            : split.flags;

        let expressionObject;

        try {
            expressionObject = new RegExp(split.pattern, flags);
        } catch (error) {
            return {
                ok: false,
                error: 'regex ไม่ถูกต้อง: ' + error.message
            };
        }

        const input = text(content);
        const matches = [];

        let found;
        let truncated = false;

        while ((found = expressionObject.exec(input)) !== null) {
            matches.push({
                value: found[0],
                index: found.index,
                line: lineOf(input, found.index),
                groups: found.slice(1).map(function (value) {
                    return value == null ? '' : value;
                })
            });

            // กัน loop ไม่จบเมื่อ regex จับข้อความว่าง
            if (found[0] === '') expressionObject.lastIndex += 1;

            if (matches.length >= MAX_MATCHES) {
                truncated = true;
                break;
            }
        }

        return {
            ok: true,
            matches: matches,
            truncated: truncated
        };
    }

    scope.RegexBuilder = {
        build: build,
        describe: describe,
        findMatches: findMatches,
        describeFlags: describeFlags,
        splitExpression: splitExpression,
        escapeLiteral: escapeLiteral,
        MAX_MATCHES: MAX_MATCHES
    };
})(window);
