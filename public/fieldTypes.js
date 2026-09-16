// Field Types - นิยาม type ของ field ที่หน้า Template Configuration และหน้ารายงานใช้ร่วมกัน
(function (scope) {
    'use strict';

    const DEFAULT_TYPE = 'text';

    const THAI_MONTHS = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];

    // input = ชนิดของ control ที่หน้ารายงานจะสร้างให้
    const TYPES = [
        { value: 'text', label: 'Text (ข้อความ)', input: 'text' },
        { value: 'number', label: 'Number (ตัวเลข)', input: 'number' },
        { value: 'currency', label: 'Currency (จำนวนเงิน)', input: 'currency' },
        { value: 'date', label: 'Date (วันที่)', input: 'date' },
        { value: 'checkbox', label: 'Checkbox (ติ๊ก/ไม่ติ๊ก)', input: 'checkbox' },
        { value: 'textarea', label: 'Long text (ข้อความยาว)', input: 'textarea' },
        { value: 'email', label: 'Email', input: 'email' }
    ];

    const byValue = {};
    TYPES.forEach(function (type) {
        byValue[type.value] = type;
    });

    function get(value) {
        return byValue[value] || byValue[DEFAULT_TYPE];
    }

    // ──────────────────────────────────────────────────────────────
    // Currency (จำนวนเงิน)
    //
    // ช่องกรอกเป็น "ตัวเลข" และ "ตัวหนังสือ" สลับกันด้วยปุ่ม toggle หน้าช่อง
    // - โหมดตัวเลข: ใส่ comma ทุก 3 หลัก แล้วเขียนลงเอกสารแบบนั้น (1,000)
    // - โหมดตัวหนังสือ: แปลงเป็นข้อความไทย (หนึ่งพันบาทถ้วน) ตามหลักสะกดจำนวนธนบัตร
    //
    // ค่าที่เก็บในฟอร์มเป็นตัวเลขล้วนเสมอ (เช่น 1000) รูปแบบตอนเขียนลงเอกสาร
    // และข้อความ preview มาจากโหมดของช่องนั้น จึงสลับโหมดแล้วค่ายังอยู่ครบ
    // ──────────────────────────────────────────────────────────────

    const CURRENCY_MODES = { NUMBER: 'number', TEXT: 'text' };

    // โหมดปัจจุบันของแต่ละ field (เก็บแยกจากค่า เพราะค่าเป็นตัวเลขล้วนเสมอ)
    const currencyModes = {};

    function setCurrencyMode(field, mode) {
        if (mode === CURRENCY_MODES.TEXT) {
            currencyModes[field] = CURRENCY_MODES.TEXT;
        } else {
            currencyModes[field] = CURRENCY_MODES.NUMBER;
        }
    }

    function getCurrencyMode(field) {
        return currencyModes[field] || CURRENCY_MODES.NUMBER;
    }

    function resetCurrencyModes() {
        Object.keys(currencyModes).forEach(function (field) {
            delete currencyModes[field];
        });
    }

    // 1000 -> "1,000" (ใส่ comma ทุก 3 หลักเฉพาะส่วนเต็ม ทศนิยมคงเดิม)
    function formatCurrencyComma(numericText) {
        const parts = String(numericText).split('.');

        if (!/^\d+$/.test(parts[0])) return String(numericText);

        const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');

        return parts.length > 1 ? grouped + '.' + parts[1] : grouped;
    }

    // ตัวเลขล้วน (รับตัวเลขไทยด้วย) -> ตัวเลขอารบิกล้วน + จุดทศนิยมตัวแรก, อย่างอื่นตัดทิ้ง
    function parseCurrencyInput(text) {
        const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

        let out = '';
        let sawDot = false;

        for (const char of String(text || '')) {
            const digitIndex = THAI_DIGITS.indexOf(char);

            if (digitIndex !== -1) {
                out += String(digitIndex);
            } else if (char >= '0' && char <= '9') {
                out += char;
            } else if (char === '.' && !sawDot) {
                out += char;          // ทศนิยมได้แค่จุดเดียว (จุดแรก = ตำแหน่งเคอร์เซอร์)
                sawDot = true;
            }
        }

        return out;
    }

    // ตัวเลขเป็นข้อความไทยตามหลักสะกดจำนวนธนบัตร (เลขน้อยกว่าล้านลงท้าย "เอ็ด",
    // เลข 1 ในหลักสิบ = "สิบ", หน่วยล้านต่อ ๆ ไป)
    const DIGIT_WORDS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
    const POSITION_WORDS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

    // หมายเหตุกฎ "เอ็ด": เลข 1 ในหลักหน่วยของกลุ่มล้านใด ๆ อ่านว่า "เอ็ด"
    // ถ้ามีหลักอื่นนำหน้าภายในกลุ่มนั้น เช่น 21,000,000 = ยี่สิบเอ็ดล้าน,
    // 1,000,001 = หนึ่งล้านเอ็ด — ส่วนเลข 1 ตัวเดียว (หน่วยล้านพอดี) อ่านว่า "หนึ่งล้าน"
    // digits ที่ส่งเข้ามาต้องคงความยาวบล็อกเดิม (ไม่ตัดเลข 0 นำหน้า) กฎนี้จึงถูกต้อง
    function readThaiNumber(digits) {
    let text = '';
    const length = digits.length;

    for (let i = 0; i < length; i++) {
        const digit = Number(digits[i]);
        const position = length - i - 1;

        if (digit === 0) continue;

        // ตรวจว่าก่อนหน้านี้มีตัวเลขที่ไม่ใช่ 0 หรือไม่
        let hasPreviousNonZero = false;

        for (let j = 0; j < i; j++) {
            if (Number(digits[j]) !== 0) {
                hasPreviousNonZero = true;
                break;
            }
        }

        if (position === 0 && digit === 1 && hasPreviousNonZero) {
            text += 'เอ็ด';
        } 
        else if (position === 1 && digit === 1) {
            text += 'สิบ';
        } 
        else if (position === 1 && digit === 2) {
            text += 'ยี่สิบ';
        } 
        else {
            text += DIGIT_WORDS[digit] + POSITION_WORDS[position];
        }
    }

    return text;
}

    // อ่านจำนวนเต็ม (ยาวเท่าไรก็ได้) โดยแบ่งเป็นกลุ่มละ 6 หลัก (หน่วยล้าน) จากขวาไปซ้าย
    // กลุ่มที่ไม่ใช่กลุ่มสุดท้ายต่อด้วย "ล้าน" เสมอ — แม้กลุ่มนั้นเป็น 0
    // เพราะต้องบอกตำแหน่งของกลุ่มถัดไป เช่น 1,000,000,000,000 = หนึ่งล้านล้าน
    function readMillionGroups(digits) {
        const groups = [];
        let rest = String(digits);

        // แบ่งจากขวาทีละ 6 หลัก — คงความยาวบล็อกเดิมไว้ (ไม่ตัด 0 นำหน้า)
        // เพราะกฎ "เอ็ด" ดูตำแหน่งภายในกลุ่ม
        while (rest.length > 6) {
            groups.unshift(rest.slice(-6));
            rest = rest.slice(0, -6);
        }
        groups.unshift(rest);

        let text = '';

        for (let i = 0; i < groups.length; i++) {
            const isLast = i === groups.length - 1;

            if (Number(groups[i]) > 0) {
                text += readThaiNumber(groups[i]);
            }

            if (!isLast) text += 'ล้าน';
        }

        return text;
    }

    function thaiBahtText(number) {
        const value = Number(number);

        if (!isFinite(value)) return '';

        if (value === 0) return 'ศูนย์บาทถ้วน';

        const sign = value < 0 ? 'ลบ' : '';
        const fixed = Math.abs(value).toFixed(2);
        const [whole, fraction] = fixed.split('.');

        const text = readMillionGroups(whole);

        // สตางค์: มีทั้งบาทและสตางค์ = อ่านต่อกัน, มีแต่สตางค์ = ไม่มีคำว่า "บาท" นำหน้า
        const satangText = Number(fraction) === 0
            ? ''
            : readThaiNumber(fraction) + 'สตางค์';

        if (text === '') {
            return sign + satangText;          // เช่น 0.25 = ยี่สิบห้าสตางค์
        }

        return sign + text + 'บาท' + (satangText || 'ถ้วน');
    }

    // ค่าที่เขียนลงเอกสาร: โหมดตัวเลข = comma, โหมดตัวหนังสือ = ข้อความไทย
    function formatCurrency(numericText, mode) {
        const text = String(numericText == null ? '' : numericText);

        if (text === '') return '';
        if (!/^\d+(\.\d+)?$/.test(text)) return text;

        return mode === CURRENCY_MODES.TEXT
            ? thaiBahtText(text)
            : formatCurrencyComma(text);
    }

    // ข้อความกำกับใต้ช่อง: แสดงรูปแบบ "อีกโหมด" เพื่อเทียบค่าได้
    // (ช่อง input แสดงรูปแบบของโหมดปัจจุบันอยู่แล้ว)
    function currencyPreviewText(numericText, mode) {
        const text = String(numericText == null ? '' : numericText);

        if (text === '') return '';
        if (!/^\d+(\.\d+)?$/.test(text)) return text;

        return mode === CURRENCY_MODES.TEXT
            ? formatCurrencyComma(text)
            : thaiBahtText(text);
    }

    // ตั้งค่าที่แสดงในช่อง currency ตามโหมดปัจจุบัน
    // - โหมดตัวเลข: แสดงเลขพร้อม comma แก้ไขได้ตามปกติ
    // - โหมดตัวหนังสือ: แสดงข้อความไทย (อ่านอย่างเดียว ต้องสลับกลับเป็นตัวเลขเพื่อแก้ไข)
    // ค่า canonical (ตัวเลขล้วน) เก็บไว้ที่ dataset.currencyValue ของช่อง จึงสลับโหมดกลับไปกลับมาได้
    function refreshCurrencyInputDisplay(input) {
        if (!input) return;

        const digits = input.dataset.currencyValue || '';
        const textMode = getCurrencyMode(input.dataset.field) === CURRENCY_MODES.TEXT;

        input.value = formatCurrency(digits, textMode ? CURRENCY_MODES.TEXT : CURRENCY_MODES.NUMBER);
        input.readOnly = textMode;
        input.title = textMode
            ? 'โหมดตัวหนังสือ (อ่านอย่างเดียว) — กดปุ่มด้านขวาเพื่อสลับกลับเป็นตัวเลขเพื่อแก้ไข'
            : '';
    }

    // '2013-08-11' -> '11 สิงหาคม 2556' (พ.ศ. = ค.ศ. + 543)
    function formatThaiDate(isoText) {
        const matches = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoText || '').trim());
        if (!matches) return isoText || '';

        const month = THAI_MONTHS[Number(matches[2]) - 1];
        if (!month) return isoText;

        return Number(matches[3]) + ' ' + month + ' ' + (Number(matches[1]) + 543);
    }

    // แปลงค่าที่จะเขียนลงเอกสารตาม type
    // - date: ISO -> วันที่ไทย
    // - currency: modes = { <field>: 'number'|'text' } กำหนดว่า field ไหนเขียนเป็นตัวเลข/comma หรือตัวหนังสือ
    function formatValue(type, value, modes, field) {
        if (type === 'date') return formatThaiDate(value);
        if (type === 'currency') {
            return formatCurrency(value, modes ? modes[field] : undefined);
        }
        return value;
    }

    // วันที่ต้องแสดงผลแบบไทยกำกับไว้ เพราะ <input type="date"> แสดงเป็น พ.ศ. ไม่ได้
    function wrapWithPreview(input, field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'field-control';

        const preview = document.createElement('span');
        preview.className = 'field-preview';
        preview.dataset.previewFor = field;

        wrapper.appendChild(input);
        wrapper.appendChild(preview);
        return wrapper;
    }

    // รูปแว่นขยายของปุ่มค้นหา (ใช้ inline SVG เพื่อไม่ต้องพึ่ง font/ไอคอนภายนอก)
    const MAGNIFIER_SVG = [
        '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">',
        '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"></circle>',
        '<line x1="15.4" y1="15.4" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>',
        '</svg>'
    ].join('');

    // ช่องข้อความ + ปุ่มแว่นขยาย เปิด popup เลือกข้อมูลจาก Master Data
    function wrapWithLookup(input, field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'field-control lookup-field';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'lookup-btn';
        button.dataset.lookupFor = field;
        button.title = 'ค้นหาจาก Master Data';
        button.setAttribute('aria-label', 'ค้นหาจาก Master Data');
        button.innerHTML = MAGNIFIER_SVG;

        wrapper.appendChild(input);
        wrapper.appendChild(button);
        return wrapper;
    }

    // ปุ่ม toggle สลับโหมด "ตัวเลข / ตัวหนังสือ" ของช่อง currency
    const TOGGLE_LABELS = {};
    TOGGLE_LABELS[CURRENCY_MODES.NUMBER] = 'เปลี่ยนเป็นตัวอักษร';
    TOGGLE_LABELS[CURRENCY_MODES.TEXT] = 'เปลี่ยนเป็นตัวเลข';

    // currency = ช่องตัวเลข + ปุ่ม toggle ตัวเลข/ตัวหนังสือ (ไม่มีปุ่ม lookup Master Data)
    function createCurrencyControl(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'field-control currency-field';

        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.dataset.field = field;
        input.dataset.currencyInput = '1';
        input.placeholder = 'กรอก ' + field + ' (ตัวเลข)';

        // ปุ่มสลับโหมด: label ตามโหมด "ที่จะสลับไป" (เหมือน preview ของ toggle)
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'currency-toggle-btn';
        toggleBtn.dataset.currencyToggle = field;
        toggleBtn.title = 'สลับระหว่างตัวเลข (1,000) กับตัวหนังสือ (หนึ่งพันบาทถ้วน)';
        toggleBtn.setAttribute('aria-label', toggleBtn.title);
        toggleBtn.textContent = TOGGLE_LABELS[getCurrencyMode(field)];

        // ข้อความกำกับใต้ช่อง แสดงรูปแบบอีกโหมดเพื่อเทียบค่าได้
        // const preview = document.createElement('span');
        // preview.className = 'field-preview';
        // preview.dataset.previewFor = field;

        wrapper.appendChild(input);
        wrapper.appendChild(toggleBtn);
        // wrapper.appendChild(preview);
        return wrapper;
    }

    // สร้าง control ของหน้ารายงานตาม type ที่ตั้งไว้
    // options.lookup = true → ช่องข้อความธรรมดาได้ปุ่มค้นหา Master Data
    function createFieldControl(value, field, options) {
        const type = get(value);
        const opts = options || {};

        if (type.value === 'currency') {
            return createCurrencyControl(field);
        }

        if (type.input === 'textarea') {
            const textarea = document.createElement('textarea');
            textarea.rows = 3;
            textarea.dataset.field = field;
            textarea.placeholder = 'กรอก ' + field;
            return textarea;
        }

        const input = document.createElement('input');
        input.type = type.input;
        input.dataset.field = field;
        if (type.input !== 'checkbox') {
            input.placeholder = 'กรอก ' + field;
        }

        if (type.input === 'date') {
            return wrapWithPreview(input, field);
        }

        if (type.input === 'text' && opts.lookup) {
            return wrapWithLookup(input, field);
        }

        return input;
    }

    scope.FieldTypes = {
        all: TYPES.map(function (type) { return type.value; }),
        options: TYPES,
        defaultValue: DEFAULT_TYPE,
        months: THAI_MONTHS,
        CURRENCY_MODES: CURRENCY_MODES,
        get: get,
        setCurrencyMode: setCurrencyMode,
        getCurrencyMode: getCurrencyMode,
        resetCurrencyModes: resetCurrencyModes,
        createFieldControl: createFieldControl,
        formatThaiDate: formatThaiDate,
        formatValue: formatValue,
        formatCurrency: formatCurrency,
        formatCurrencyComma: formatCurrencyComma,
        thaiBahtText: thaiBahtText,
        currencyPreviewText: currencyPreviewText,
        refreshCurrencyInputDisplay: refreshCurrencyInputDisplay,
        parseCurrencyInput: parseCurrencyInput
    };
})(window);
