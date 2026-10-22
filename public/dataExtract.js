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
    // ผู้ใช้แก้ได้ในหน้า "ฝึก OCR" หรือกล่อง "ข้อมูล" แล้วระบบจะแทนให้อัตโนมัติ
    //
    // แหล่งจริงของรายการคือตาราง ocr_fixes ในฐานข้อมูล (สำรอง/ย้ายเครื่องได้)
    // แต่ UI ต้องอ่านแบบ synchronous จึงเก็บสำเนาไว้ในหน่วยความจำ
    // localStorage ใช้เฉพาะเมื่อไม่มีฐานข้อมูล (เช่นเปิดในเบราว์เซอร์ระหว่างพัฒนา)
    // และใช้เป็นข้อมูลตั้งต้นให้ migrate ครั้งแรก
    const TEXT_FIX_KEY = 'wordTemplateFiller:textFixes';
    const TEXT_FIX_MIGRATION_KEY = 'wordTemplateFiller:textFixesMigrated';
    const TEXT_FIX_LIMIT = 2000;

    let textFixCache = null;
    let textFixRefreshPromise = null;

    function toCount(value) {
        const number = Math.floor(Number(value));

        return Number.isFinite(number) && number > 0 ? number : 0;
    }

    function normalizeTextFix(entry) {
        const from = String((entry && entry.from) || '').trim();
        const to = String((entry && entry.to) || '').trim();

        if (from === '') return null;

        return {
            from: from,
            to: to,
            hits: toCount(entry && entry.hits),
            accepted: toCount(entry && entry.accepted),
            rejected: toCount(entry && entry.rejected),
            lastConfidence: Number.isFinite(Number(entry && entry.lastConfidence))
                ? Number(entry.lastConfidence)
                : null
        };
    }

    function dbFixesAvailable() {
        return Boolean(
            window.electronAPI &&
            scope.Db &&
            typeof scope.Db.ocrFixList === 'function'
        );
    }

    function readMigrationFlag() {
        try {
            return window.localStorage.getItem(TEXT_FIX_MIGRATION_KEY) === '1';
        } catch (error) {
            return false;
        }
    }

    function writeMigrationFlag() {
        try {
            window.localStorage.setItem(TEXT_FIX_MIGRATION_KEY, '1');
        } catch (error) {
            // เขียนไม่ได้ก็ migrate ซ้ำได้ (ฐานข้อมูลกันคำซ้ำด้วย UNIQUE อยู่แล้ว)
        }
    }

    function readLocalTextFixes() {
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

    function writeLocalTextFixes(list) {
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

    // รายการในหน่วยความจำ — เรียกได้แบบ synchronous ทุกที่ที่เคยใช้
    function loadTextFixes() {
        if (!textFixCache) {
            textFixCache = readLocalTextFixes();
        }

        return textFixCache;
    }

    // เขียนทับทั้งชุด (ใช้เมื่อไม่มีฐานข้อมูล)
    function saveTextFixes(list) {
        textFixCache = (list || [])
            .map(normalizeTextFix)
            .filter(Boolean)
            .slice(0, TEXT_FIX_LIMIT);

        if (!dbFixesAvailable()) {
            writeLocalTextFixes(textFixCache);
        }

        return textFixCache;
    }

    function rowToTextFix(row) {
        return normalizeTextFix({
            from: row && row.wrong,
            to: row && row.right,
            hits: row && row.hits,
            accepted: row && row.accepted,
            rejected: row && row.rejected,
            lastConfidence: row && row.last_confidence
        });
    }

    // โหลดรายการจากฐานข้อมูล (ครั้งแรกจะนำเข้ารายการเดิมจาก localStorage ให้)
    function refreshTextFixes() {
        if (textFixRefreshPromise) return textFixRefreshPromise;

        textFixRefreshPromise = Promise.resolve()
            .then(function () {
                const local = readLocalTextFixes();

                if (!dbFixesAvailable()) {
                    textFixCache = textFixCache || local;
                    return null;
                }

                return scope.Db.ocrFixList()
                    .then(function (rows) {
                        if (!Array.isArray(rows)) rows = [];

                        const migrated = readMigrationFlag();

                        // มีรายการเดิมใน localStorage = ย้ายครั้งแรก
                        // (ย้ายเฉพาะคำที่ยังไม่มีในฐานข้อมูล — ไม่ทับคำที่แก้ใหม่กว่า)
                        if (!migrated && local.length > 0) {
                            const existing = new Set(rows.map(function (row) {
                                return row.wrong;
                            }));

                            const missing = local.filter(function (fix) {
                                return !existing.has(fix.from);
                            });

                            let failed = 0;

                            return missing
                                .reduce(function (chain, fix) {
                                    return chain.then(function () {
                                        return scope.Db.ocrFixSave({
                                            wrong: fix.from,
                                            right: fix.to
                                        }).catch(function (error) {
                                            failed += 1;
                                            console.error(
                                                'นำเข้าคำที่แก้ไม่สำเร็จ:',
                                                error
                                            );
                                        });
                                    });
                                }, Promise.resolve())
                                .then(function () {
                                    // มีรายการที่ย้ายไม่สำเร็จ = ลองใหม่ครั้งถัดไป
                                    if (failed === 0) writeMigrationFlag();

                                    return scope.Db.ocrFixList();
                                });
                        }

                        if (!migrated) writeMigrationFlag();

                        return rows;
                    })
                    .then(function (rows) {
                        if (Array.isArray(rows)) {
                            textFixCache = rows
                                .map(rowToTextFix)
                                .filter(Boolean);
                        }
                    })
                    .catch(function (error) {
                        console.error(
                            'อ่านคลังคำที่แก้จากฐานข้อมูลไม่สำเร็จ:',
                            error
                        );

                        // ใช้รายการในหน่วยความจำต่อ (ถ้ามี) ไม่ให้งานที่ทำอยู่หาย
                        textFixCache = textFixCache || local;
                    });
            })
            .then(function () {
                return loadTextFixes();
            })
            .finally(function () {
                textFixRefreshPromise = null;
            });

        return textFixRefreshPromise;
    }

    function persistFixToDb(fix, confidence) {
        if (!dbFixesAvailable()) return Promise.resolve(false);

        return scope.Db.ocrFixSave({
            wrong: fix.from,
            right: fix.to,
            confidence: confidence
        }).then(function () {
            return true;
        });
    }

    // ──────────────────────────────────────────────────────────────
    // กลุ่มคำที่ถูกตัดข้ามบรรทัด (เช่น "เลข" + "ที่")
    // ──────────────────────────────────────────────────────────────

    let wordGroupCache = null;
    let wordGroupRefreshPromise = null;

    function dbGroupsAvailable() {
        return Boolean(
            window.electronAPI &&
            scope.Db &&
            typeof scope.Db.ocrGroupList === 'function'
        );
    }

    function normalizeGroupTokens(tokens) {
        if (!Array.isArray(tokens)) return [];

        return tokens
            .map(function (token) {
                return String(token == null ? '' : token).trim();
            })
            .filter(Boolean);
    }

    function groupKey(tokens) {
        return normalizeGroupTokens(tokens).join('\u001f');
    }

    function rowToWordGroup(row) {
        const tokens = normalizeGroupTokens(row && row.tokens);

        if (tokens.length < 2) return null;

        return {
            id: row.id,
            tokens: tokens,
            merged: String((row && row.merged) || '').trim(),
            hits: toCount(row && row.hits),
            accepted: toCount(row && row.accepted),
            rejected: toCount(row && row.rejected)
        };
    }

    function loadWordGroups() {
        if (!wordGroupCache) wordGroupCache = [];

        return wordGroupCache;
    }

    // โหลดกลุ่มคำจากฐานข้อมูล (เก็บในหน่วยความจำเพื่อใช้แบบ synchronous)
    function refreshWordGroups() {
        if (wordGroupRefreshPromise) return wordGroupRefreshPromise;

        wordGroupRefreshPromise = Promise.resolve()
            .then(function () {
                if (!dbGroupsAvailable()) {
                    wordGroupCache = [];
                    return;
                }

                return scope.Db.ocrGroupList()
                    .then(function (rows) {
                        wordGroupCache = (Array.isArray(rows) ? rows : [])
                            .map(rowToWordGroup)
                            .filter(Boolean);
                    })
                    .catch(function (error) {
                        console.error(
                            'อ่านกลุ่มคำจากฐานข้อมูลไม่สำเร็จ:',
                            error
                        );

                        wordGroupCache = wordGroupCache || [];
                    });
            })
            .then(function () {
                return loadWordGroups();
            })
            .finally(function () {
                wordGroupRefreshPromise = null;
            });

        return wordGroupRefreshPromise;
    }

    function persistWordGroup(tokens, merged) {
        if (!dbGroupsAvailable()) {
            return Promise.reject(
                new Error('บันทึกกลุ่มคำได้เฉพาะในแอป (Electron)')
            );
        }

        return scope.Db.ocrGroupSave({
            tokens: tokens,
            merged: merged
        });
    }

    // เพิ่ม/แก้กลุ่มคำ — คืน true เมื่อบันทึกสำเร็จ
    async function saveWordGroupAsync(tokens, merged) {
        const list = normalizeGroupTokens(tokens);
        const text = String(merged == null ? '' : merged).trim();

        if (list.length < 2) return false;
        if (text === '') return false;

        await persistWordGroup(list, text);

        const key = groupKey(list);
        const groups = loadWordGroups();
        const existing = groups.find(function (group) {
            return groupKey(group.tokens) === key;
        });

        if (existing) {
            existing.merged = text;
        } else {
            groups.push({
                id: 0,
                tokens: list,
                merged: text,
                hits: 0,
                accepted: 0,
                rejected: 0
            });
        }

        return true;
    }

    async function deleteWordGroupAsync(tokens) {
        const list = normalizeGroupTokens(tokens);

        if (list.length < 2) return false;

        if (dbGroupsAvailable()) {
            await scope.Db.ocrGroupDelete(list);
        }

        const key = groupKey(list);
        wordGroupCache = loadWordGroups().filter(function (group) {
            return groupKey(group.tokens) !== key;
        });

        return true;
    }

    function trackWordGroupHits(list) {
        const counts = {};
        const tokensByKey = {};

        (list || []).forEach(function (tokens) {
            const normalized = normalizeGroupTokens(tokens);

            if (normalized.length < 2) return;

            const key = groupKey(normalized);
            counts[key] = (counts[key] || 0) + 1;
            tokensByKey[key] = normalized;
        });

        if (Object.keys(counts).length === 0) return;

        loadWordGroups().forEach(function (group) {
            const count = counts[groupKey(group.tokens)];

            if (count) group.hits += count;
        });

        if (!dbGroupsAvailable()) return;

        const updates = Object.keys(counts).map(function (key) {
            return {
                tokens: tokensByKey[key],
                hits: counts[key]
            };
        });

        scope.Db.ocrGroupStat({ updates: updates }).catch(function (error) {
            console.error('อัปเดตสถิติกลุ่มคำไม่สำเร็จ:', error);
        });
    }

    // รวมคำที่ถูกตัดข้ามบรรทัดตามกลุ่มที่เรียนรู้ไว้
    // ต้องมีขึ้นบรรทัดใหม่คั่นระหว่างคำเท่านั้น (คำที่อยู่บรรทัดเดียวกันไม่ถูกแตะ)
    function applyWordGroupMerges(text, options) {
        const source = String(text == null ? '' : text);
        const groups = loadWordGroups()
            .slice()
            .sort(function (a, b) {
                return b.tokens.length - a.tokens.length ||
                    b.merged.length - a.merged.length;
            });

        const applied = [];
        let result = source;

        groups.forEach(function (group) {
            if (group.tokens.length < 2 || group.merged === '') return;

            const pattern = new RegExp(
                group.tokens
                    .map(escapeRegExp)
                    .join('[ \\t]*\\r?\\n[ \\t]*'),
                'g'
            );

            result = result.replace(pattern, function () {
                applied.push(group.tokens);
                return group.merged;
            });
        });

        if (options && options.track && applied.length > 0) {
            trackWordGroupHits(applied);
        }

        return {
            text: result,
            changed: result !== source,
            applied: applied.length
        };
    }

    // ──────────────────────────────────────────────────────────────
    // คำที่ OCR เก็บเกิน (สระ/วรรณยุกต์ที่แยกเป็นคำ) — ตัดทิ้งเมื่ออ่านไฟล์
    // ──────────────────────────────────────────────────────────────

    let dropWordCache = null;
    let dropWordRefreshPromise = null;

    function dbDropsAvailable() {
        return Boolean(
            window.electronAPI &&
            scope.Db &&
            typeof scope.Db.ocrDropList === 'function'
        );
    }

    function loadDropWords() {
        if (!dropWordCache) dropWordCache = [];

        return dropWordCache;
    }

    // โหลดรายการคำที่ไม่ใช้จากฐานข้อมูล (เก็บในหน่วยความจำเพื่อใช้แบบ synchronous)
    function refreshDropWords() {
        if (dropWordRefreshPromise) return dropWordRefreshPromise;

        dropWordRefreshPromise = Promise.resolve()
            .then(function () {
                if (!dbDropsAvailable()) {
                    dropWordCache = [];
                    return;
                }

                return scope.Db.ocrDropList()
                    .then(function (rows) {
                        dropWordCache = (Array.isArray(rows) ? rows : [])
                            .map(function (row) {
                                return {
                                    id: row && row.id,
                                    word: String((row && row.word) || '').trim()
                                };
                            })
                            .filter(function (entry) {
                                return entry.word !== '';
                            });
                    })
                    .catch(function (error) {
                        console.error(
                            'อ่านรายการคำที่ไม่ใช้จากฐานข้อมูลไม่สำเร็จ:',
                            error
                        );

                        dropWordCache = dropWordCache || [];
                    });
            })
            .then(function () {
                return loadDropWords();
            })
            .finally(function () {
                dropWordRefreshPromise = null;
            });

        return dropWordRefreshPromise;
    }

    function findDropWord(word) {
        const key = String(word == null ? '' : word).trim();

        if (key === '') return null;

        return loadDropWords().find(function (entry) {
            return entry.word === key;
        }) || null;
    }

    // เพิ่มคำที่ไม่ใช้ — คืน true เมื่อบันทึกสำเร็จ
    async function saveDropWordAsync(word) {
        const value = String(word == null ? '' : word).trim();

        if (value === '') return false;

        if (!dbDropsAvailable()) {
            throw new Error('บันทึกคำที่ไม่ใช้ได้เฉพาะในแอป (Electron)');
        }

        await scope.Db.ocrDropSave({ word: value });

        if (!findDropWord(value)) {
            loadDropWords().push({ id: 0, word: value });
        }

        return true;
    }

    async function deleteDropWordAsync(word) {
        const value = String(word == null ? '' : word).trim();

        if (value === '') return false;

        if (dbDropsAvailable()) {
            await scope.Db.ocrDropDelete(value);
        }

        dropWordCache = loadDropWords().filter(function (entry) {
            return entry.word !== value;
        });

        return true;
    }

    // ตัดคำที่ไม่ใช้ออกจากข้อความ (เฉพาะคำที่แยกเป็น token ของตัวเอง)
    // ไม่แตะคำที่ถูกต่ออยู่กับคำอื่น — กรณีนั้นใช้คลังคำที่แก้แทน
    function removeDropWords(text) {
        const source = String(text == null ? '' : text);
        const words = loadDropWords();

        if (words.length === 0) {
            return { text: source, changed: false, applied: 0 };
        }

        const drops = {};

        words.forEach(function (entry) {
            drops[entry.word] = true;
        });

        let applied = 0;
        const keptLines = [];

        source.split('\n').forEach(function (line) {
            if (line === '') {
                keptLines.push(line);
                return;
            }

            // คงช่องว่างให้เหมือนเดิม ยกเว้นช่องว่างที่ติดกับคำที่ถูกตัด
            const parts = line.split(/([ \t]+)/);
            const kept = [];
            let removed = false;

            for (let index = 0; index < parts.length; index++) {
                const part = parts[index];

                if (index % 2 === 1) {
                    kept.push(part);
                    continue;
                }

                if (!drops[part]) {
                    kept.push(part);
                    continue;
                }

                removed = true;
                applied += 1;
                index += 1;

                // คำท้ายบรรทัด = ไม่มีช่องว่างตามหลัง — เอาช่องว่างหน้ามันทิ้งด้วย
                if (parts[index] === undefined) kept.pop();
            }

            // บรรทัดที่มีแต่คำที่ถูกตัด → เอาทั้งบรรทัดออก (ไม่ทิ้งบรรทัดว่างคั่นกลาง)
            if (removed && kept.join('').trim() === '') return;

            keptLines.push(kept.join(''));
        });

        const result = keptLines.join('\n');

        return {
            text: result,
            changed: result !== source,
            applied: applied
        };
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
    // options.track = true → นับ hits ให้คำที่ถูกแทนจริง (ใช้ตอนอ่านไฟล์)
    function applyTextFixes(text, options) {
        const source = String(text == null ? '' : text);
        const fixes = loadTextFixes().slice().sort(function (a, b) {
            return b.from.length - a.from.length;
        });

        const applied = [];
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
                applied.push(fix.from);
                return fix.to;
            });
        });

        if (options && options.track && applied.length > 0) {
            trackTextFixHits(applied);
        }

        return {
            text: result,
            changed: result !== source,
            applied: applied.length
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

    // คืน { text, ocrPages, pages, joined }
    //   ocrPages = เลขหน้าที่ไม่มีชั้นข้อความ จึงต้องอ่านด้วย OCR (ไฟล์สแกน)
    //   joined   = จำนวนจุดที่เย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่
    //   options.joinLines = false เพื่อไม่เย็บ
    async function textFromPdf(data, options) {
        const opts = options || {};
        if (!window.electronAPI || !window.electronAPI.extractPdfText) {
            throw new Error(
                'อ่านไฟล์ PDF ได้เฉพาะในแอป (Electron) — ' +
                'หรือใช้การวางข้อความแทน'
            );
        }

        const result = await window.electronAPI.extractPdfText({
            data: data,
            joinLines: opts.joinLines !== false
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
            pages: Array.isArray(result.pages) ? result.pages : [],
            joined: Number(result.joined) || 0
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

    // คืน { text, ocrPages, pages, fixed, joined }
    //   pages  = หน้า OCR พร้อมภาพ+ตำแหน่งคำ (สำหรับหน้าจอตรวจคำ)
    //   fixed  = มีการแทนคำตามรายการ "คำที่แก้เอง" หรือไม่
    //   joined = จำนวนจุดที่เย็บบรรทัดที่ถูกตัด (PDF)
    //   options.joinLines = false เพื่อไม่เย็บ
    async function extractFile(file, options) {
        const name = String((file && file.name) || '').toLowerCase();

        if (!file) {
            throw new Error('ไม่พบไฟล์');
        }

        let result;

        if (name.endsWith('.pdf')) {
            result = await textFromPdf(await file.arrayBuffer(), options);
        } else if (name.endsWith('.docx')) {
            // .docx มีการขึ้นย่อหน้าจริงในไฟล์ — ไม่ต้องเดา/เย็บบรรทัด
            result = {
                text: await textFromDocx(await file.arrayBuffer()),
                ocrPages: [],
                pages: [],
                joined: 0
            };
        } else {
            const error = new Error('รองรับเฉพาะไฟล์ .docx และ .pdf');
            error.expected = true;
            throw error;
        }

        // คำที่แก้ไว้ / กลุ่มคำ / คำที่ OCR เก็บเกิน ใช้กับข้อความที่อ่านจากไฟล์ทุกชนิด
        // (โหลดรายการล่าสุดจากฐานข้อมูลก่อน แล้วนับว่าแทนคำไหนไปบ้าง)
        await refreshTextFixes();
        await refreshWordGroups();
        await refreshDropWords();

        // ตัดคำที่ OCR เก็บเกินก่อน (คำสระที่คั่นกลางจะได้ไม่ขวางการรวมกลุ่ม)
        // แล้วค่อยรวมกลุ่ม และค่อยแก้คำ เพราะคำที่รวมแล้วอาจตรงกับคำที่แก้ไว้
        const dropped = removeDropWords(result.text);

        const grouped = applyWordGroupMerges(dropped.text, {
            track: !(options && options.trackFixes === false)
        });

        const fixed = applyTextFixes(grouped.text, {
            // หน้า "ฝึก OCR" อ่านไฟล์เพื่อเก็บตัวอย่าง ไม่ต้องนับสถิติการแทนคำ
            track: !(options && options.trackFixes === false)
        });

        return {
            text: fixed.text,
            ocrPages: result.ocrPages,
            pages: result.pages || [],
            fixed: fixed.changed,
            grouped: grouped.applied,
            dropped: dropped.applied,
            joined: Number(result.joined) || 0
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

    // ──────────────────────────────────────────────────────────────
    // คลังคำที่แก้ — เขียน/ลบ/นับสถิติ
    // ──────────────────────────────────────────────────────────────

    // อัปเดตตัวนับในหน่วยความจำ + ฐานข้อมูล (ฐานข้อมูลล้มเหลวไม่ทำให้ UI พัง)
    function applyStatUpdates(updates) {
        if (!Array.isArray(updates) || updates.length === 0) return;

        const byKey = {};

        updates.forEach(function (item) {
            const key = String((item && item.wrong) || '').trim();

            if (key === '') return;

            if (!byKey[key]) byKey[key] = { hits: 0, accepted: 0, rejected: 0 };

            byKey[key].hits += toCount(item.hits);
            byKey[key].accepted += toCount(item.accepted);
            byKey[key].rejected += toCount(item.rejected);
        });

        if (Object.keys(byKey).length === 0) return;

        loadTextFixes().forEach(function (fix) {
            const delta = byKey[fix.from];

            if (!delta) return;

            fix.hits += delta.hits;
            fix.accepted += delta.accepted;
            fix.rejected += delta.rejected;
        });

        if (dbFixesAvailable()) {
            scope.Db.ocrFixStat({ updates: updates }).catch(function (error) {
                console.error('อัปเดตสถิติคำที่แก้ไม่สำเร็จ:', error);
            });
        }
    }

    // นับว่าคำนี้ถูกแทนให้จริงกี่ครั้งในการอ่านไฟล์หนึ่งครั้ง
    function trackTextFixHits(list) {
        const counts = {};

        (list || []).forEach(function (from) {
            const key = String(from || '').trim();

            if (key !== '') counts[key] = (counts[key] || 0) + 1;
        });

        applyStatUpdates(Object.keys(counts).map(function (wrong) {
            return { wrong: wrong, hits: counts[wrong] };
        }));
    }

    // ผู้ใช้ยอมรับ/ปฏิเสธคำแนะนำ → ใช้จัดอันดับคำใกล้เคียงครั้งถัดไป
    function trackTextFixFeedback(wrong, accepted) {
        const key = String(wrong == null ? '' : wrong).trim();

        if (key === '') return;

        applyStatUpdates([{
            wrong: key,
            accepted: accepted ? 1 : 0,
            rejected: accepted ? 0 : 1
        }]);
    }

    function removeTextFixValue(from) {
        const key = String(from == null ? '' : from).trim();

        if (key === '') return null;

        const fixes = loadTextFixes();
        const rest = fixes.filter(function (fix) {
            return fix.from !== key;
        });

        if (rest.length === fixes.length) return null;

        textFixCache = rest;
        return key;
    }

    // ตรวจค่าและคืนรายการที่จะบันทึก (ไม่บันทึกเอง)
    function applyTextFixValue(from, to) {
        const key = String(from == null ? '' : from).trim();
        const value = String(to == null ? '' : to).trim();

        if (key === '' || value === '' || key === value) {
            return { changed: false, fix: null };
        }

        const fixes = loadTextFixes();
        const existing = fixes.find(function (fix) {
            return fix.from === key;
        });

        if (existing) {
            if (existing.to === value) return { changed: false, fix: existing };

            existing.to = value;

            // เปลี่ยนคำตอบ = หลักฐานเดิม (ยอมรับ/ปฏิเสธ) ใช้ไม่ได้แล้ว
            existing.accepted = 0;
            existing.rejected = 0;

            return { changed: true, fix: existing };
        }

        const fix = {
            from: key,
            to: value,
            hits: 0,
            accepted: 0,
            rejected: 0,
            lastConfidence: null
        };

        fixes.push(fix);

        return { changed: true, fix: fix };
    }

    // เพิ่ม/แก้คำที่อ่านผิด (คีย์คือคำที่อ่านผิด — มีได้ครั้งเดียว)
    function setTextFix(from, to, options) {
        const result = applyTextFixValue(from, to);

        if (!result.changed) return false;

        if (Number.isFinite(Number(options && options.confidence))) {
            result.fix.lastConfidence = Number(options.confidence);
        }

        if (!dbFixesAvailable()) {
            writeLocalTextFixes(loadTextFixes());
        }

        persistFixToDb(result.fix, options && options.confidence).catch(function (error) {
            console.error('บันทึกคำที่แก้ลงฐานข้อมูลไม่สำเร็จ:', error);
        });

        return true;
    }

    // เหมือน setTextFix แต่รอผลการบันทึก (หน้า "ฝึก OCR" ใช้แสดงสถานะ)
    async function saveTextFixAsync(from, to, options) {
        const result = applyTextFixValue(from, to);

        if (!result.changed) return false;

        if (Number.isFinite(Number(options && options.confidence))) {
            result.fix.lastConfidence = Number(options.confidence);
        }

        if (!dbFixesAvailable()) {
            writeLocalTextFixes(loadTextFixes());
            return true;
        }

        await persistFixToDb(result.fix, options && options.confidence);
        return true;
    }

    // ลบคำที่แก้ — คืน true เมื่อมีรายการให้ลบจริง
    function deleteTextFix(from) {
        const key = removeTextFixValue(from);

        if (!key) return false;

        if (!dbFixesAvailable()) {
            writeLocalTextFixes(loadTextFixes());
        } else {
            scope.Db.ocrFixDelete(key).catch(function (error) {
                console.error('ลบคำที่แก้ในฐานข้อมูลไม่สำเร็จ:', error);
            });
        }

        return true;
    }

    async function deleteTextFixAsync(from) {
        const key = removeTextFixValue(from);

        if (!key) return false;

        if (!dbFixesAvailable()) {
            writeLocalTextFixes(loadTextFixes());
            return true;
        }

        await scope.Db.ocrFixDelete(key);
        return true;
    }

    // คำที่แก้ของคำนี้ (ถ้ามี)
    function findTextFix(from) {
        const key = String(from == null ? '' : from).trim();

        return loadTextFixes().find(function (fix) {
            return fix.from === key;
        }) || null;
    }

    // ──────────────────────────────────────────────────────────────
    // คำใกล้เคียง (Levenshtein) — ใช้แนะนำในหน้า "ฝึก OCR"
    // ──────────────────────────────────────────────────────────────

    function levenshteinDistance(first, second) {
        const a = String(first == null ? '' : first);
        const b = String(second == null ? '' : second);

        if (a === b) return 0;
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        let previous = new Array(b.length + 1);

        for (let index = 0; index <= b.length; index++) {
            previous[index] = index;
        }

        for (let row = 1; row <= a.length; row++) {
            const current = [row];

            for (let column = 1; column <= b.length; column++) {
                const cost = a[row - 1] === b[column - 1] ? 0 : 1;

                current[column] = Math.min(
                    current[column - 1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + cost
                );
            }

            previous = current;
        }

        return previous[b.length];
    }

    // หาคำที่เคยแก้ไว้ซึ่งใกล้กับคำที่ OCR อ่านได้ (แนะนำเท่านั้น ไม่แทนเอง)
    function findFuzzyFixes(token, options) {
        const key = String(token == null ? '' : token).trim();
        const limit = Math.max(1, Math.floor(Number(options && options.limit) || 3));

        if (key.length < 2) return [];

        // คำสั้นผิดได้ไม่เกิน 1 ตัว — คำยาวอนุโลม 2 ตัว
        const maxDistance = key.length <= 4 ? 1 : 2;

        return loadTextFixes()
            .filter(function (fix) {
                return fix.from !== key && fix.to !== key && fix.to !== '';
            })
            .map(function (fix) {
                return {
                    fix: fix,
                    distance: levenshteinDistance(key, fix.from)
                };
            })
            .filter(function (item) {
                if (item.distance > maxDistance) return false;

                return item.distance /
                    Math.max(key.length, item.fix.from.length) <= 0.34;
            })
            .map(function (item) {
                const total = item.fix.accepted + item.fix.rejected;
                const accuracy = (item.fix.accepted + 1) / (total + 2);

                return {
                    from: item.fix.from,
                    to: item.fix.to,
                    distance: item.distance,
                    accepted: item.fix.accepted,
                    rejected: item.fix.rejected,
                    hits: item.fix.hits,
                    score:
                        accuracy -
                        item.distance * 0.3 +
                        Math.min(0.25, item.fix.hits * 0.03)
                };
            })
            .sort(function (a, b) {
                return b.score - a.score || a.distance - b.distance;
            })
            .slice(0, limit);
    }

    scope.DataExtract = {
        TEXT_FIX_KEY: TEXT_FIX_KEY,
        loadTextFixes: loadTextFixes,
        saveTextFixes: saveTextFixes,
        refreshTextFixes: refreshTextFixes,
        refreshWordGroups: refreshWordGroups,
        loadWordGroups: loadWordGroups,
        saveWordGroupAsync: saveWordGroupAsync,
        deleteWordGroupAsync: deleteWordGroupAsync,
        applyWordGroupMerges: applyWordGroupMerges,
        refreshDropWords: refreshDropWords,
        loadDropWords: loadDropWords,
        findDropWord: findDropWord,
        saveDropWordAsync: saveDropWordAsync,
        deleteDropWordAsync: deleteDropWordAsync,
        removeDropWords: removeDropWords,
        setTextFix: setTextFix,
        saveTextFixAsync: saveTextFixAsync,
        deleteTextFix: deleteTextFix,
        deleteTextFixAsync: deleteTextFixAsync,
        findTextFix: findTextFix,
        trackTextFixFeedback: trackTextFixFeedback,
        findFuzzyFixes: findFuzzyFixes,
        levenshteinDistance: levenshteinDistance,
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
