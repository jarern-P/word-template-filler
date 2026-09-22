// Word Suggest - แนะนำคำภาษาไทยจากพจนานุกรม th_TH.dic / th_TH.aff
//
// พจนานุกรมถูกแปลงเป็น JS แล้วโหลดด้วย <script> ที่ index.html
// (window.ThaiDictionary = { words, aff }) จึงไม่ต้อง fetch ตอนรันไทม์
//
// ความสามารถ 2 อย่าง
//   1. เดาคำต่อ — พิมพ์ "จำนวนเงิ" แล้วเสนอ "จำนวนเงิน"
//   2. แนะนำคำที่พิมพ์ผิด — ใช้ข้อมูลใน .aff (ICONV / REP / KEY / TRY)
//      เช่นพิมพ์วรรณยุกต์ก่อนสระ แก้ให้เองได้, สลับตัวอักษร, กดปุ่มข้างกัน
//
// ภาษาไทยไม่เว้นวรรคระหว่างคำ ข้อความที่พิมพ์จึงอาจติดกันหลายคำ
// suggest() จึงลองตัดตัวอักษรด้านหน้าออกทีละตัว (จำกัด MAX_DROP ตัว)
// เพื่อหาคำสุดท้ายที่ผู้ใช้กำลังพิมพ์อยู่ เช่น "นายสมชาย" -> มองที่ "สมชาย"
(function (scope) {
    'use strict';

    const MIN_FRAGMENT = 2;     // เริ่มแนะนำตั้งแต่ 2 ตัวอักษร
    const MAX_COMPLETE = 20;    // ดึงผู้สมัครมาก่อนแล้วค่อยจัดลำดับ/ตัดเหลือ MAX_ITEMS
    const MAX_ITEMS = 8;        // จำนวนคำที่แสดงใน popup
    const MAX_FIX = 3;          // จำนวน "คำที่พิมพ์ผิด" ที่เสนอ
    const MAX_DROP = 6;         // ตัดตัวอักษรหน้าออกได้กี่ตัวเพื่อหาคำสุดท้าย

    // ตัวอักษรที่เป็นส่วนหนึ่งของคำ (ไทยทั้งบล็อก + ละติน + ตัวเลข)
    const WORD_CHAR = /[\u0E01-\u0E5B0-9A-Za-z]/;

    // ข้อมูลจาก .aff (ค่าเริ่มต้น = ว่าง ถ้าโหลดพจนานุกรมไม่ได้ก็ยังทำงานได้)
    let aff = {
        try: '',
        rep: [],
        key: [],
        iconv: [],
        break: []
    };

    let dictWords = [];        // คำจากพจนานุกรมกลาง
    let customWords = [];      // คำที่ผู้ใช้เพิ่มเอง (หน้า "คำแนะนำ")
    let words = [];            // รวม + เรียงแล้ว (ใช้ค้นหาแบบ prefix)
    let wordSet = null;        // Set ของคำทั้งหมด (ตรวจว่าคำนี้รู้จักไหม)
    let customSet = null;      // Set ของคำที่เพิ่มเอง (จัดลำดับขึ้นก่อน)
    let enabled = true;
    let ready = false;

    // ──────────────────────────────────────────────────────────────
    // โหลด / รวมคำ
    // ──────────────────────────────────────────────────────────────

    function parseWords(text) {
        if (!text) return [];

        return String(text)
            .split('\n')
            .map(function (word) { return word.trim(); })
            .filter(function (word) {
                return word.length > 0 && !word.startsWith('#');
            });
    }

    // เรียงแบบเทียบรหัสตัวอักษร (ค่าเริ่มต้นของ sort) ซึ่งทำให้คำที่ขึ้นต้นด้วย
    // ข้อความเดียวกันอยู่ติดกัน จึงใช้หาแบบ binary search ได้
    function rebuild() {
        // Object.create(null) = ไม่มี property ของ Object ติดมา
        // (คำอย่าง "toString" จึงไม่ถูกมองว่ามีอยู่แล้ว)
        const seen = Object.create(null);
        const merged = [];

        customSet = Object.create(null);

        customWords.forEach(function (word) {
            if (!seen[word]) {
                seen[word] = true;
                customSet[word] = true;
                merged.push(word);
            }
        });

        dictWords.forEach(function (word) {
            if (!seen[word]) {
                seen[word] = true;
                merged.push(word);
            }
        });

        merged.sort();

        words = merged;
        wordSet = seen;
    }

    // เรียกได้หลายครั้ง (ตอนเริ่มแอป / โหลดจากฐานข้อมูล / เพิ่มคำ)
    function init() {
        if (ready) return;

        ready = true;

        const source = scope.ThaiDictionary;

        if (!source) {
            console.warn(
                'ไม่พบพจนานุกรม (window.ThaiDictionary) — ' +
                'การแนะนำคำจะใช้เฉพาะคำที่เพิ่มเอง'
            );

            rebuild();
            return;
        }

        aff = source.aff || aff;
        dictWords = parseWords(source.words);

        rebuild();
    }

    function setCustomWords(list) {
        init();

        customWords = (list || [])
            .map(function (word) { return String(word || '').trim(); })
            .filter(function (word) { return word.length > 0; });

        rebuild();
    }

    function setEnabled(value) {
        enabled = value !== false;
    }

    function isEnabled() {
        return enabled;
    }

    function isKnown(word) {
        init();

        return !!wordSet && Object.prototype.hasOwnProperty.call(wordSet, word);
    }

    function dictionarySize() {
        init();

        return dictWords.length;
    }

    function customSize() {
        return customWords.length;
    }

    // ──────────────────────────────────────────────────────────────
    // ค้นหาแบบ prefix
    // ──────────────────────────────────────────────────────────────

    // ตำแหน่งแรกของคำที่ >= prefix
    function lowerBound(prefix) {
        let low = 0;
        let high = words.length;

        while (low < high) {
            const middle = (low + high) >> 1;

            if (words[middle] < prefix) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }

        return low;
    }

    function isCustom(word) {
        return !!customSet && Object.prototype.hasOwnProperty.call(customSet, word);
    }

    // คำที่ขึ้นต้นด้วยข้อความที่พิมพ์ — คำที่เพิ่มเองมาก่อน แล้วจึงคำสั้นก่อน
    function completions(fragment, limit) {
        const found = [];
        const max = limit || MAX_ITEMS;

        if (!words.length || !fragment) return found;

        for (
            let index = lowerBound(fragment);
            index < words.length && found.length < MAX_COMPLETE;
            index++
        ) {
            const word = words[index];

            if (word.indexOf(fragment) !== 0) break;

            // พิมพ์ครบคำแล้ว ไม่ต้องเสนอคำเดิมซ้ำ
            if (word === fragment) continue;

            found.push({
                word: word,
                kind: 'complete',
                source: isCustom(word) ? 'custom' : 'dict'
            });
        }

        found.sort(compareItems);

        return found.slice(0, max);
    }

    function compareItems(a, b) {
        if (a.source !== b.source) {
            return a.source === 'custom' ? -1 : 1;
        }

        if (a.word.length !== b.word.length) {
            return a.word.length - b.word.length;
        }

        return a.word < b.word ? -1 : (a.word > b.word ? 1 : 0);
    }

    // ──────────────────────────────────────────────────────────────
    // คำที่พิมพ์ผิด
    // ──────────────────────────────────────────────────────────────

    // แก้ลำดับสระ/วรรณยุกต์ตาม ICONV ของพจนานุกรม (็่ -> ่็, ํา -> ำ)
    function applyIconv(word) {
        let text = word;

        for (const rule of aff.iconv) {
            if (text.indexOf(rule[0]) !== -1) {
                text = text.replace(rule[0], rule[1]);
            }
        }

        return text;
    }

    function swapAt(word, index) {
        return word.slice(0, index) +
            word.charAt(index + 1) +
            word.charAt(index) +
            word.slice(index + 2);
    }

    function replaceAt(word, index, length, text) {
        return word.slice(0, index) + text + word.slice(index + length);
    }

    // คำที่ใกล้เคียงที่สุด เรียงตาม "โอกาสที่จะใช่" มากไปน้อย
    function corrections(word, limit) {
        const max = limit || MAX_FIX;
        const found = [];
        const seen = Object.create(null);

        function push(candidate) {
            if (found.length >= max) return;
            if (!candidate || candidate === word) return;
            if (seen[candidate]) return;
            if (!isKnown(candidate)) return;

            seen[candidate] = true;

            found.push({
                word: candidate,
                kind: 'fix',
                source: isCustom(candidate) ? 'custom' : 'dict'
            });
        }

        if (!wordSet || word.length < 2) return found;

        // 1) ลำดับสระ/วรรณยุกต์สลับ (เคาะวรรณยุกต์ก่อนสระ)
        push(applyIconv(word));

        // 2) นิ้วสลับกัน — ตัวอักษรที่อยู่ติดกันถูกพิมพ์สลับที่
        for (let i = 0; found.length < max && i + 1 < word.length; i++) {
            push(swapAt(word, i));
        }

        // 3) ออกเสียง/รูปคล้ายกัน (REP) และปุ่มข้าง ๆ บนคีย์บอร์ด (KEY)
        if (found.length < max) {
            for (let i = 0; found.length < max && i < word.length; i++) {
                const char = word.charAt(i);

                for (const pair of aff.rep) {
                    if (char === pair[0]) push(replaceAt(word, i, 1, pair[1]));
                    if (char === pair[1]) push(replaceAt(word, i, 1, pair[0]));
                }

                for (const pair of aff.key) {
                    if (char !== pair[0]) continue;

                    for (const neighbor of pair[1]) {
                        push(replaceAt(word, i, 1, neighbor));
                        if (found.length >= max) break;
                    }
                }
            }
        }

        // 4) พิมพ์เกินมา 1 ตัว
        for (let i = 0; found.length < max && i < word.length; i++) {
            push(replaceAt(word, i, 1, ''));
        }

        // 5) พิมพ์ขาดไป 1 ตัว (ใช้ลำดับตัวอักษรที่พบบ่อยจาก TRY)
        if (found.length < max) {
            const chars = aff.try || '';

            for (let i = 0; found.length < max && i <= word.length; i++) {
                for (const char of chars) {
                    push(replaceAt(word, i, 0, char));
                    if (found.length >= max) break;
                }
            }
        }

        return found;
    }

    // ──────────────────────────────────────────────────────────────
    // ข้อความที่กำลังพิมพ์
    // ──────────────────────────────────────────────────────────────

    // ช่วงของ "คำ" ที่จบตรงตำแหน่งเคอร์เซอร์ (เว้นวรรค/เครื่องหมาย = ขอบเขต)
    function tokenRange(text, caret) {
        const end = Math.max(0, Math.min(caret, text.length));

        let start = end;

        while (start > 0 && WORD_CHAR.test(text.charAt(start - 1))) {
            start--;
        }

        return {
            start: start,
            end: end,
            text: text.slice(start, end)
        };
    }

    // คืน { start, end, fragment, items } ของสิ่งที่ควรเสนอ ณ ตำแหน่งเคอร์เซอร์
    // start/end = ช่วงข้อความที่จะถูกแทนที่เมื่อผู้ใช้เลือกคำ (ตัดคำหน้าออกแล้ว)
    function suggest(text, caret) {
        if (!enabled) return null;

        init();

        const token = tokenRange(String(text == null ? '' : text), caret);

        if (token.text.length < MIN_FRAGMENT) return null;

        // ลองจากทั้งก้อนก่อน แล้วค่อยตัดตัวหน้าออกเพื่อหาคำสุดท้าย
        // (ไทยไม่เว้นวรรค: "นายสมชาย" -> "สมชาย")
        for (
            let drop = 0;
            drop <= MAX_DROP && drop < token.text.length;
            drop++
        ) {
            const fragment = token.text.slice(drop);

            if (fragment.length < MIN_FRAGMENT) break;

            const items = completions(fragment, MAX_ITEMS);

            if (items.length > 0) {
                return {
                    start: token.start + drop,
                    end: token.end,
                    fragment: fragment,
                    items: items
                };
            }
        }

        // ไม่มีคำที่ขึ้นต้นด้วยข้อความนี้ — ที่รู้จักมีแต่คำที่พิมพ์ผิด
        return {
            start: token.start,
            end: token.end,
            fragment: token.text,
            items: corrections(token.text, MAX_FIX)
        };
    }

    scope.WordSuggest = {
        init: init,
        setCustomWords: setCustomWords,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        isKnown: isKnown,
        dictionarySize: dictionarySize,
        customSize: customSize,
        suggest: suggest,
        completions: completions,
        corrections: corrections,
        tokenRange: tokenRange
    };
})(window);
