// Template Settings - แลกเปลี่ยน "ค่าตั้งของแม่แบบ" ผ่านไฟล์ JSON
//
// ใช้ตอนอยากยกค่าตั้งจากแม่แบบหนึ่งไปอีกแม่แบบหนึ่ง (เช่น แม่แบบที่ตั้ง type /
// placeholder / regex / ตาราง ไว้ครบแล้ว แต่อยากใช้กับเอกสารอีกฉบับที่มี
// ชื่อ field บางตัวเหมือนกัน)
//
// หลักการสำคัญ: ใช้เฉพาะ field ที่ "ชื่อตรงกัน" เท่านั้น
//   - field ในไฟล์ที่ไม่มีในแม่แบบปลายทาง = ข้าม (ไม่สร้าง field ใหม่)
//   - field ในแม่แบบปลายทางที่ไม่มีในไฟล์ = คงค่าที่ตั้งไว้เดิม
//
// รูปแบบไฟล์ (version 1):
//   {
//     "app": "word-template-filler",
//     "kind": "template-settings",           // หรือ "template-patterns" (เฉพาะ regex)
//     "version": 1,
//     "exportedAt": "2026-10-20T...",
//     "template": { "name": "สัญญาจ้าง", "fields": ["ชื่อเรื่อง", ...] },
//     "settings": {
//       "types": {...}, "locks": {...}, "placeholders": {...},
//       "patterns": {...}, "tables": {...},
//       "listGroups": {...}, "listLimits": {...}
//     }
//   }
//
// ไฟล์ kind = "template-patterns" (ส่งออกจากกล่อง "ข้อมูล") มี "patterns" ตรง ๆ
// แทน "settings" — ตอนนำเข้าจึงเติมได้แค่ช่อง regex
//
// ตอนนำเข้า: คีย์ไหนไม่มีในไฟล์ (เช่น ไฟล์ regex-only) = ไม่แตะค่านั้น
(function (scope) {
    'use strict';

    const APP_ID = 'word-template-filler';
    const KIND = 'template-settings';
    const PATTERN_KIND = 'template-patterns';
    const VERSION = 1;

    // ลำดับคีย์คงที่ — ทำให้ไฟล์ที่ส่งออกอ่าน/เทียบกันได้ง่าย
    const SETTING_KEYS = [
        'types',
        'locks',
        'placeholders',
        'patterns',
        'tables',
        'listGroups',
        'listLimits'
    ];

    // ไอคอนของปุ่มส่งออก/นำเข้า (ใช้ร่วมกันทั้งหน้าแก้ไขและกล่อง "ข้อมูล")
    const ICONS = {
        export:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"' +
            ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M12 4v10"></path><path d="M8 10l4 4 4-4"></path>' +
            '<path d="M5 18v1.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V18"></path>' +
            '</svg>',
        import:
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"' +
            ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M12 20V10"></path><path d="M8 14l4-4 4 4"></path>' +
            '<path d="M5 6V4.5A1.5 1.5 0 0 1 6.5 3h11A1.5 1.5 0 0 1 19 4.5V6"></path>' +
            '</svg>'
    };

    function text(value) {
        return String(value == null ? '' : value);
    }

    // object ธรรมดา (ไม่ใช่ array/null) เท่านั้น — กันไฟล์ผิดรูปแบบทำพัง
    function plainObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
    }

    function keysOf(value) {
        return Object.keys(plainObject(value));
    }

    // ──────────────────────────────────────────────────────────────
    // ทำความสะอาดค่าที่อ่านจากไฟล์ (ตัดค่าที่ใช้ไม่ได้ทิ้ง)
    // ──────────────────────────────────────────────────────────────

    function normalizeTextMap(value) {
        const map = {};

        keysOf(value).forEach(function (field) {
            const name = text(field);

            if (name === '') return;

            const item = text(value[field]).trim();

            if (item !== '') map[name] = text(value[field]);
        });

        return map;
    }

    function normalizeTypeMap(value) {
        const map = {};

        keysOf(value).forEach(function (field) {
            const name = text(field);
            const type = text(value[field]).trim();

            if (name !== '' && type !== '') map[name] = type;
        });

        return map;
    }

    function normalizeLockMap(value) {
        const map = {};

        keysOf(value).forEach(function (field) {
            const name = text(field);
            const locked = value[field];

            if (name === '') return;

            if (locked === true || locked === 'true' || locked === 1) {
                map[name] = true;
            }
        });

        return map;
    }

    function normalizeLimitMap(value) {
        const map = {};

        keysOf(value).forEach(function (field) {
            const name = text(field);
            const limit = Math.floor(Number(value[field]));

            if (name !== '' && isFinite(limit) && limit > 0) {
                map[name] = limit;
            }
        });

        return map;
    }

    function normalizeTableMap(value) {
        const map = {};

        keysOf(value).forEach(function (field) {
            const name = text(field);
            const schema = plainObject(value[field]);
            const columns = Array.isArray(schema.columns) ? schema.columns.slice() : [];

            if (name === '' || columns.length === 0) return;

            map[name] = {
                columns: columns.map(text),
                widths: Array.isArray(schema.widths) ? schema.widths.slice() : [],
                headerStyles: Array.isArray(schema.headerStyles)
                    ? schema.headerStyles.slice()
                    : []
            };
        });

        return map;
    }

    const NORMALIZERS = {
        types: normalizeTypeMap,
        locks: normalizeLockMap,
        placeholders: normalizeTextMap,
        patterns: normalizeTextMap,
        tables: normalizeTableMap,
        listGroups: normalizeTextMap,
        listLimits: normalizeLimitMap
    };

    // คีย์ที่ไม่มีในไฟล์จะไม่ถูกใส่ในผลลัพธ์ (ตอนนำเข้า = ไม่แตะค่านั้น)
    function normalizeSettings(raw) {
        const source = plainObject(raw);
        const settings = {};

        SETTING_KEYS.forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(source, key)) return;

            settings[key] = NORMALIZERS[key](source[key]);
        });

        return settings;
    }

    // field ทุกชื่อที่ปรากฏในค่าตั้ง (ไม่ซ้ำ)
    function fieldNamesIn(settings) {
        const seen = {};
        const names = [];

        SETTING_KEYS.forEach(function (key) {
            keysOf(settings && settings[key]).forEach(function (field) {
                if (seen[field]) return;

                seen[field] = true;
                names.push(field);
            });
        });

        return names;
    }

    // ──────────────────────────────────────────────────────────────
    // สร้าง / อ่านไฟล์
    // ──────────────────────────────────────────────────────────────

    function buildExport(options) {
        const config = options || {};

        return {
            app: APP_ID,
            kind: KIND,
            version: VERSION,
            exportedAt: new Date().toISOString(),
            template: {
                name: text(config.templateName).trim(),
                fields: (config.fields || []).map(text)
            },
            settings: normalizeSettings(config.settings)
        };
    }

    // ไฟล์เฉพาะ regex (ส่งออกจากกล่อง "ข้อมูล")
    function buildPatternExport(options) {
        const config = options || {};

        return {
            app: APP_ID,
            kind: PATTERN_KIND,
            version: VERSION,
            exportedAt: new Date().toISOString(),
            template: {
                name: text(config.templateName).trim(),
                fields: (config.fields || []).map(text)
            },
            patterns: normalizeSettings({ patterns: config.patterns }).patterns
        };
    }

    // คืน { ok:true, kind, settings, template } หรือ { ok:false, error }
    function parse(content) {
        let data;

        try {
            data = JSON.parse(text(content));
        } catch (error) {
            return { ok: false, error: 'ไฟล์ไม่ใช่ JSON ที่ถูกต้อง' };
        }

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return { ok: false, error: 'ไฟล์ JSON นี้ไม่ใช่ไฟล์ค่าตั้งของแม่แบบ' };
        }

        if (data.app && data.app !== APP_ID) {
            return {
                ok: false,
                error: 'ไฟล์นี้ไม่ได้ส่งออกจากแอปนี้'
            };
        }

        const version = Number(data.version);

        if (isFinite(version) && version > VERSION) {
            return {
                ok: false,
                error: 'ไฟล์นี้มาจากแอปเวอร์ชันใหม่กว่า — อัปเดตแอปแล้วลองอีกครั้ง'
            };
        }

        const kind =
            data.kind ||
            (data.settings ? KIND : (data.patterns ? PATTERN_KIND : ''));

        if (kind !== KIND && kind !== PATTERN_KIND) {
            return {
                ok: false,
                error: 'ไฟล์นี้ไม่ใช่ไฟล์ค่าตั้งของแม่แบบ'
            };
        }

        const settings = kind === KIND
            ? normalizeSettings(data.settings)
            : normalizeSettings({ patterns: data.patterns });

        if (fieldNamesIn(settings).length === 0) {
            return {
                ok: false,
                error: 'ไฟล์นี้ไม่มีค่าตั้งของ field ใดเลย'
            };
        }

        const template = plainObject(data.template);

        return {
            ok: true,
            kind: kind,
            settings: settings,
            template: {
                name: text(template.name).trim(),
                fields: Array.isArray(template.fields)
                    ? template.fields.map(text)
                    : []
            }
        };
    }

    // ──────────────────────────────────────────────────────────────
    // เลือกเฉพาะ field ที่ชื่อตรงกับแม่แบบปลายทาง
    //
    // คืน {
    //   settings: ค่าตั้งที่เหลือเฉพาะ field ที่ตรงกัน (คีย์เดิม)
    //   matched:  ชื่อ field ที่จะได้ค่าตั้ง
    //   skipped:  ชื่อ field ในไฟล์ที่ไม่มีในแม่แบบปลายทาง
    //   counts:   จำนวนค่าตั้งแต่ละคีย์ที่ตรงกัน
    // }
    // ──────────────────────────────────────────────────────────────

    function matchFields(settings, fields) {
        const source = settings || {};
        const target = {};

        (fields || []).forEach(function (field) {
            target[text(field)] = true;
        });

        const picked = {};

        SETTING_KEYS.forEach(function (key) {
            if (!source[key]) return;

            const map = {};

            keysOf(source[key]).forEach(function (field) {
                if (target[field]) map[field] = source[key][field];
            });

            picked[key] = map;
        });

        const counts = {};

        SETTING_KEYS.forEach(function (key) {
            counts[key] = keysOf(picked[key]).length;
        });

        return {
            settings: picked,
            matched: fieldNamesIn(picked),
            skipped: fieldNamesIn(source).filter(function (field) {
                return !target[field];
            }),
            counts: counts
        };
    }

    // ──────────────────────────────────────────────────────────────
    // ไฟล์: ชื่อไฟล์ + บันทึก + อ่าน
    // ──────────────────────────────────────────────────────────────

    // ตัดอักขระที่ตั้งเป็นชื่อไฟล์บน Windows ไม่ได้ออก (เหมือน sanitizeFileName)
    function fileNameFor(templateName, suffix) {
        const base = text(templateName)
            .replace(/[\\/:*?"<>|]+/g, '-')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
            .replace(/[. ]+$/g, '');

        return (base || 'template') + (suffix || '-settings') + '.json';
    }

    // เซฟลงโฟลเดอร์ Downloads (Electron) หรือดาวน์โหลดผ่านเบราว์เซอร์
    async function save(content, fileName) {
        const name = fileName || 'template-settings.json';
        const blob = new Blob([content], { type: 'application/json' });

        if (window.electronAPI && window.electronAPI.saveFile) {
            const buffer = await blob.arrayBuffer();
            return window.electronAPI.saveFile({
                data: buffer,
                fileName: name
            });
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        return { ok: true, fileName: name };
    }

    function readFile(file) {
        if (!file) return Promise.resolve('');

        if (file.text) return file.text();

        return new Promise(function (resolve, reject) {
            const reader = new FileReader();

            reader.onload = function () {
                resolve(String(reader.result || ''));
            };

            reader.onerror = function () {
                reject(reader.error || new Error('อ่านไฟล์ไม่สำเร็จ'));
            };

            reader.readAsText(file);
        });
    }

    scope.TemplateSettings = {
        APP_ID: APP_ID,
        KIND: KIND,
        PATTERN_KIND: PATTERN_KIND,
        VERSION: VERSION,
        SETTING_KEYS: SETTING_KEYS,
        ICONS: ICONS,

        buildExport: buildExport,
        buildPatternExport: buildPatternExport,
        parse: parse,
        normalizeSettings: normalizeSettings,
        matchFields: matchFields,
        fieldNamesIn: fieldNamesIn,

        fileNameFor: fileNameFor,
        save: save,
        readFile: readFile
    };
})(window);
