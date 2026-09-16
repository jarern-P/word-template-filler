// Text Measure Module - วัดความกว้างข้อความจริงด้วย canvas
// ใช้กับ "ล็อกตำแหน่ง" เพื่อเทียบตำแหน่งเป็นความกว้างจริง (cm บนไม้บรรทัด)
// ไม่ใช่นับจำนวนตัวอักษร ซึ่งทำให้อักษรไทย/ละตินที่กว้างไม่เท่ากันเพี้ยน
(function (scope) {
    'use strict';

    // Word เก็บขนาดฟอนต์เป็น half-point ส่วน CSS ใช้ px
    // 96 px = 1 นิ้ว, 1 pt = 1/72 นิ้ว และ 1 นิ้ว = 2.54 cm
    const PX_PER_POINT = 96 / 72;
    const CM_PER_PX = 2.54 / 96;
    const DEFAULT_HALF_POINTS = 32;   // 16pt
    const FALLBACK_FAMILY = 'serif';

    // ฟอนต์หนังสือราชการที่มักมีในเครื่อง แม้ชื่อในเอกสารจะไม่ตรงกัน
    // ใช้เป็นตัวเลือกถัดไปก่อนตกไปที่ serif เพื่อให้วัดความกว้างได้ใกล้เคียงจริง
    const SUBSTITUTE_FAMILIES = [
        'TH Sarabun New',
        'TH Sarabun PSK',
        'TH SarabunIT๙',
        'TH SarabunIT9',
        'Angsana New',
        'Cordia New'
    ];

    let context;

    function getContext() {
        if (context !== undefined) return context;

        if (typeof document === 'undefined' || !document.createElement) {
            context = null;
            return context;
        }

        const canvas = document.createElement('canvas');

        context = canvas.getContext ? canvas.getContext('2d') : null;
        return context;
    }

    function halfPoints(font) {
        return font && font.halfPoints > 0
            ? font.halfPoints
            : DEFAULT_HALF_POINTS;
    }

    function sizePx(font) {
        return (halfPoints(font) / 2) * PX_PER_POINT;
    }

    // ฟอนต์ของ run ใน Word แยกเป็นละติน (w:ascii) กับ complex script (w:cs)
    // จึงเรียงไว้ทั้งคู่ ให้ browser เลือกใช้ตามชนิดตัวอักษรเหมือน Word
    function families(font) {
        const list = [];

        const add = function (name) {
            if (!name) return;

            const quoted = '"' + name + '"';

            if (list.indexOf(quoted) === -1) list.push(quoted);
        };

        add(font && font.family);
        add(font && font.csFamily);

        SUBSTITUTE_FAMILIES.forEach(add);

        list.push(FALLBACK_FAMILY);
        return list.join(', ');
    }

    function toFontCss(font) {
        return sizePx(font).toFixed(2) + 'px ' + families(font);
    }

    function canCheckFont() {
        return (
            typeof document !== 'undefined' &&
            document.fonts &&
            typeof document.fonts.check === 'function'
        );
    }

    // ฟอนต์ที่เอกสารระบุมีจริงในเครื่องไหม (ตรวจเฉพาะฟอนต์แรก ไม่รวมตัวสำรอง)
    function hasFamily(family, font) {
        if (!family) return false;
        if (!canCheckFont()) return true;

        return document.fonts.check(
            sizePx(font).toFixed(2) + 'px "' + family + '"',
            'ก'
        );
    }

    // คืนตัววัด (text, font) -> ความกว้างเป็น cm
    // ถ้าวัดด้วย canvas ไม่ได้เลย (ไม่มี DOM) คืน null ให้ใช้ตัววัดสำรองของ replace.js
    //
    // measure.unit        = 'cm'  → ให้ replace.js รู้ว่าตัวเลขเป็น cm จริง
    // measure.approximate = true  → ฟอนต์ในเอกสารไม่มีในเครื่อง (วัดด้วยฟอนต์ใกล้เคียง)
    function createMeasurer() {
        const ctx = getContext();
        if (!ctx) return null;

        const widthCache = {};
        const fontCache = {};

        const measure = function (text, font) {
            if (!text) return 0;

            const css = toFontCss(font);
            const primary = (font && (font.family || font.csFamily)) || '';

            let state = fontCache[css];

            if (!state) {
                state = fontCache[css] = {
                    available: !primary || hasFamily(primary, font),
                    warned: false
                };

                if (!state.available) measure.approximate = true;
            }

            if (!state.available && !state.warned) {
                state.warned = true;

                console.warn(
                    'ล็อกตำแหน่ง: ไม่มีฟอนต์ "' + primary +
                    '" ในเครื่อง จึงวัดความกว้างด้วยฟอนต์ใกล้เคียง'
                );
            }

            const key = css + '\u0000' + text;

            if (key in widthCache) return widthCache[key];

            ctx.font = css;

            widthCache[key] = ctx.measureText(text).width * CM_PER_PX;
            return widthCache[key];
        };

        measure.unit = 'cm';
        measure.approximate = false;

        return measure;
    }

    scope.TextMeasure = {
        createMeasurer: createMeasurer,
        toFontCss: toFontCss
    };
})(window);
