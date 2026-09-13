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

    // '2013-08-11' -> '11 สิงหาคม 2556' (พ.ศ. = ค.ศ. + 543)
    function formatThaiDate(isoText) {
        const matches = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoText || '').trim());
        if (!matches) return isoText || '';

        const month = THAI_MONTHS[Number(matches[2]) - 1];
        if (!month) return isoText;

        return Number(matches[3]) + ' ' + month + ' ' + (Number(matches[1]) + 543);
    }

    // แปลงค่าที่จะเขียนลงเอกสารตาม type (ตอนนี้มีแค่วันที่ที่ต้องแปลง)
    function formatValue(type, value) {
        if (type === 'date') return formatThaiDate(value);
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

    // สร้าง control ของหน้ารายงานตาม type ที่ตั้งไว้
    function createFieldControl(value, field) {
        const type = get(value);

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
        return input;
    }

    scope.FieldTypes = {
        all: TYPES.map(function (type) { return type.value; }),
        options: TYPES,
        defaultValue: DEFAULT_TYPE,
        months: THAI_MONTHS,
        get: get,
        createFieldControl: createFieldControl,
        formatThaiDate: formatThaiDate,
        formatValue: formatValue
    };
})(window);
