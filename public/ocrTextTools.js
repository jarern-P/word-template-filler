// OcrTextTools - ตรวจคำภาษาไทยที่น่าสงสัยในข้อความที่ได้จาก OCR / PDF
//
// ใช้พจนานุกรมกลาง (th_TH.dic / th_TH.aff ผ่าน WordSuggest) และคำที่ผู้ใช้
// เพิ่มเองในหน้า "คำแนะนำ" — ไม่มีการส่งข้อความออกนอกเครื่อง
//
// ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงตัดคำด้วย "คำที่ยาวที่สุดในพจนานุกรม"
// (longest match) จากชุดคำเดียวกับที่ใช้แนะนำคำในช่องกรอก
// — ใช้ Intl.Segmenter ไม่ได้เพราะพจนานุกรมคนละชุด จะได้คำแปลก ๆ
//   เช่น "จำนวนเงิน" ถูกตัดเป็น "จำ" + "นว" + "นเงิน"
//
// ส่วนที่ตัดไม่ได้ (ไม่ใช่คำในพจนานุกรม) = คำที่น่าสงสัย แล้วเสนอคำใกล้เคียง
// จากกฎใน .aff (สระ/วรรณยุกต์สลับ, ตัวอักษรใกล้กัน, พิมพ์เกิน/ขาด)
//
// ข้อจำกัด: คำวิสามัญ/ชื่อเฉพาะ/คำใหม่ที่ไม่มีในพจนานุกรมจะถูกมองว่า
// "น่าสงสัย" ได้ — หน้าจอจึงให้ผู้ใช้เลือกเองทีละคำ ไม่แก้ให้อัตโนมัติ
(function (scope) {
    'use strict';

    const THAI_RUN = /[\u0E00-\u0E7F]+/g;
    const THAI_ONLY = /^[\u0E00-\u0E7F]+$/;
    const MIN_LENGTH = 2;
    const MAX_WORD_LENGTH = 40;
    const MAX_UNKNOWN_RUN = 16;
    const MAX_ISSUES = 80;
    const MAX_SUGGESTIONS = 4;

    function suggest() {
        return scope.WordSuggest;
    }

    function known(word) {
        const dictionary = suggest();

        return Boolean(
            dictionary &&
            typeof dictionary.isKnown === 'function' &&
            dictionary.isKnown(word)
        );
    }

    // ความยาวของคำในพจนานุกรมที่ยาวที่สุดที่เริ่มต้น ณ ตำแหน่งนี้
    function knownPrefixLength(run, start) {
        const max = Math.min(MAX_WORD_LENGTH, run.length - start);

        for (let length = max; length >= MIN_LENGTH; length--) {
            if (known(run.slice(start, start + length))) {
                return length;
            }
        }

        return 0;
    }

    // ตัดข้อความเป็นคำจากพจนานุกรม (เฉพาะช่วงอักษรไทย)
    // คืน token ของทั้งคำที่รู้จักและก้อนที่ตัดไม่ได้
    function tokenize(text) {
        const source = String(text == null ? '' : text);
        const tokens = [];
        let match;

        THAI_RUN.lastIndex = 0;

        while ((match = THAI_RUN.exec(source)) !== null) {
            const run = match[0];
            const offset = match.index;

            let index = 0;

            while (index < run.length) {
                const length = knownPrefixLength(run, index);

                if (length > 0) {
                    tokens.push({
                        text: run.slice(index, index + length),
                        start: offset + index,
                        end: offset + index + length,
                        wordLike: true,
                        known: true
                    });

                    index += length;
                    continue;
                }

                // หา point เริ่มของคำที่รู้จักถัดไป (อย่างน้อย 2 ตัวอักษร)
                let next = index + 1;

                while (
                    next < run.length &&
                    knownPrefixLength(run, next) < MIN_LENGTH
                ) {
                    next += 1;
                }

                const end = Math.min(
                    run.length,
                    next,
                    index + MAX_UNKNOWN_RUN
                );

                const chunk = run.slice(index, end);

                tokens.push({
                    text: chunk,
                    start: offset + index,
                    end: offset + end,
                    wordLike: chunk.length >= MIN_LENGTH,
                    known: false
                });

                index = Math.max(end, index + 1);
            }
        }

        return tokens;
    }

    function contextOf(text, token) {
        const start = Math.max(0, token.start - 18);
        const end = Math.min(text.length, token.end + 18);

        return text
            .slice(start, end)
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * ตรวจข้อความ — คืนคำที่น่าสงสัยพร้อมคำแนะนำ
     *
     * @param {string} text
     * @returns {{issues: Array, checked: number}}
     *   issues[] = { word, count, context, suggestions: string[] }
     */
    function check(text) {
        const source = String(text == null ? '' : text);
        const dictionary = suggest();

        if (!dictionary || typeof dictionary.isKnown !== 'function') {
            return {
                issues: [],
                checked: 0,
                unavailable: true
            };
        }

        dictionary.init();

        const tokens = tokenize(source);
        const issues = new Map();
        let checked = 0;

        tokens.forEach(function (token) {
            const word = token.text;

            if (!token.wordLike) return;
            if (!THAI_ONLY.test(word)) return;
            if (word.length < MIN_LENGTH) return;

            checked += 1;

            if (token.known) return;

            if (!issues.has(word)) {
                issues.set(word, {
                    word: word,
                    count: 0,
                    context: contextOf(source, token),
                    suggestions: []
                });
            }

            issues.get(word).count += 1;
        });

        const list = [];

        issues.forEach(function (issue) {
            if (list.length >= MAX_ISSUES) return;

            const seen = Object.create(null);

            issue.suggestions = dictionary
                .corrections(issue.word, MAX_SUGGESTIONS * 2)
                .map(function (item) {
                    return String(item.word || '').trim();
                })
                .filter(function (candidate) {
                    if (candidate === '' || candidate === issue.word) return false;
                    if (!THAI_ONLY.test(candidate)) return false;
                    if (candidate.length < MIN_LENGTH) return false;
                    if (seen[candidate]) return false;

                    seen[candidate] = true;

                    return true;
                })
                .slice(0, MAX_SUGGESTIONS);

            list.push(issue);
        });

        return {
            issues: list,
            checked: checked
        };
    }

    // แทนที่เฉพาะ "คำเต็ม" ตามผลการตัดคำ (ไม่แทนที่บางส่วนของคำอื่น)
    function replaceWord(text, word, replacement) {
        const source = String(text == null ? '' : text);
        const tokens = tokenize(source);

        const ranges = tokens.filter(function (token) {
            return token.text === word;
        });

        if (ranges.length === 0) return source;

        let result = source;

        for (let index = ranges.length - 1; index >= 0; index--) {
            const range = ranges[index];

            result =
                result.slice(0, range.start) +
                replacement +
                result.slice(range.end);
        }

        return result;
    }

    scope.OcrTextTools = {
        check: check,
        replaceWord: replaceWord,
        tokenize: tokenize
    };
})(window);
