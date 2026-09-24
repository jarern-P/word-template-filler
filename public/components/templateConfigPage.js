// Template Config Page Component - ตั้งค่า type ของแต่ละ {{field}} และบันทึกเป็น template
(function (scope) {
    'use strict';

    const META_HTML = [
        '<div class="template-meta">',
        '    <label for="templateName">ชื่อ แม่แบบ</label>',
        '    <input type="text" id="templateName" data-persist="templateName"' +
            ' placeholder="เว้นว่าง = ใช้ชื่อไฟล์ .docx">',
        '</div>'
    ].join('\n');

    // ปุ่มจัดการไฟล์ .docx ของ template
    // - ดาวน์โหลด: ได้ไฟล์ต้นฉบับที่เก็บไว้ (ยังไม่ถูกแทนค่า)
    // - อัปโหลดทับ: เอาไฟล์ที่แก้ไขนอกแอปมาทับไฟล์เดิม (มี confirm ก่อนทับใน app.js)
    // - input file ถูกซ่อน เพราะเปิดผ่านปุ่มเพื่อให้เข้าชุดกับปุ่มอื่น
    // ปุ่มทั้งหมด (รวม Save Template และ Clear) ถูกรวมเป็นแถวเดียวโดย FormPage
    // (ดู actionsRow ใน FormPage.create) จึงไม่ต้องมี div.form-actions ของตัวเอง
    const ACTIONS_HTML = [
        '<button id="downloadTemplateBtn" type="button" class="plain" disabled>' +
            'ดาวน์โหลด แม่แบบ ต้นฉบับ</button>',
        '<button id="replaceTemplateBtn" type="button" class="danger" disabled>' +
            'อัปโหลดไฟล์ใหม่ทับไฟล์เดิม</button>',
        '<input type="file" id="replaceFileInput" accept=".docx" hidden>',
        '<button id="saveBtn" type="button" disabled>Save Template</button>'
    ].join('\n');

    const FOOTER_HTML = [
        '<section class="saved-templates">',
        '    <h2>แม่แบบ ที่บันทึกไว้</h2>',
        '    <p id="dbStatus" class="db-status"></p>',
        '    <ul id="savedList" class="saved-list"></ul>',
        '</section>'
    ].join('\n');

    // ช่องใส่ placeholder (ข้อความตัวอย่าง) ของ field นั้น
    // ข้อความนี้ถูกนำไปแสดงในช่องกรอกของหน้ารายงานเป็น "กรอก <field> เช่น <placeholder>"
    function createPlaceholderInput(field) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'field-placeholder';
        // ใช้ data-placeholder-field (ไม่ใช่ data-field) เพื่อไม่ให้ปนกับค่าของ type
        input.dataset.placeholderField = field;
        input.autocomplete = 'off';
        input.placeholder =
            'Placeholder เช่น หนึ่งร้อยบาทถ้วน — เว้นว่าง = ใช้ค่าเริ่มต้น';
        input.title =
            'ข้อความตัวอย่างของช่องนี้ในหน้ารายงาน ' +
            '(แสดงเป็น "กรอก ' + field + ' เช่น …")';
        return input;
    }

    // ──────────────────────────────────────────────────────────────
    // ช่องตั้งค่าตาราง (แสดงเมื่อเลือก type = Table)
    //
    // - จำนวนคอลัมน์
    // - ชื่อหัวคอลัมน์ (1 ช่องต่อ 1 คอลัมน์)
    // - สัดส่วนความกว้าง (1 ช่องต่อ 1 คอลัมน์ — เช่น 2 กับ 1 = กว้างเป็นสองเท่า)
    // (แถวรวมยอดให้ผสานช่องในหน้ารายงานแทน — เขียนเป็น w:gridSpan ในเอกสาร)
    //
    // โครงตารางเก็บไว้ที่ FieldTypes เพราะหน้ารายงานและตอนสร้างเอกสารใช้ด้วย
    // ──────────────────────────────────────────────────────────────
    function createTableConfig(field) {
        const box = document.createElement('div');
        box.className = 'table-config';
        box.dataset.tableConfig = field;
        box.hidden = true;

        const countRow = document.createElement('div');
        countRow.className = 'table-config-row';

        const countLabel = document.createElement('label');
        countLabel.textContent = 'จำนวนคอลัมน์';

        const countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.min = '1';
        countInput.max = String(scope.FieldTypes.tableMaxColumns);
        countInput.step = '1';
        countInput.className = 'table-count';
        countInput.dataset.tableCount = field;

        countRow.appendChild(countLabel);
        countRow.appendChild(countInput);

        // ชื่อหัวคอลัมน์ + ความกว้างอยู่ในแถบเดียวกัน (ช่องกรอกเลขสัดส่วนแยกออกไปแล้ว
        // — ปรับความกว้างด้วยการลากขอบระหว่างคอลัมน์ในแถบนี้แทน)
        const previewLabel = document.createElement('span');
        previewLabel.className = 'table-config-label';
        previewLabel.textContent =
            'ชื่อหัวคอลัมน์ + ความกว้างของคอลัมน์ — พิมพ์ชื่อในช่อง ' +
            '(เว้นว่าง = ใช้ชื่อเริ่มต้น) และลากขอบระหว่างคอลัมน์ ' +
            '(หรือโฟกัสขอบแล้วกด ← / →) เพื่อปรับความกว้าง';

        // แถบชื่อคอลัมน์/สัดส่วน — ลากขอบระหว่างคอลัมน์เพื่อปรับความกว้างได้เลย
        const preview = document.createElement('div');
        preview.className = 'table-ratio-preview';
        preview.dataset.tablePreview = field;

        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent =
            'วาง {{' + field + '}} ไว้บรรทัดเดียวของมันเอง — ' +
            'ตอนสร้างเอกสารจะแทนที่ทั้งย่อหน้านั้นด้วยตาราง ' +
            '(เพิ่ม/ลบแถว และผสานช่องเพื่อทำแถวรวมยอด ได้ที่หน้ารายงาน)';

        // เตือนเมื่อ {{field}} ถูกวางไว้หลายที่ในเอกสาร
        // (ตารางจะถูกใส่ในเอกสารเท่าจำนวนที่วางไว้ — มักไม่ใช่สิ่งที่ผู้ใช้ต้องการ)
        const usage = document.createElement('p');
        usage.className = 'hint table-usage';
        usage.dataset.tableUsage = field;
        usage.hidden = true;

        box.appendChild(countRow);
        box.appendChild(previewLabel);
        box.appendChild(preview);
        box.appendChild(hint);
        box.appendChild(usage);

        return box;
    }

    // select เลือก type + ช่อง placeholder + checkbox "ล็อกตำแหน่ง" ของ field นั้น
    function createTypeSelect(field) {
        const wrapper = document.createElement('div');
        wrapper.className = 'field-config';

        const row = document.createElement('div');
        row.className = 'field-type-row';

        const select = document.createElement('select');
        select.dataset.field = field;
        select.className = 'field-type';

        for (const type of scope.FieldTypes.options) {
            const option = document.createElement('option');
            option.value = type.value;
            option.textContent = type.label;
            select.appendChild(option);
        }

        select.value = scope.FieldTypes.defaultValue;

        const lockBox = document.createElement('input');
        lockBox.type = 'checkbox';
        // ใช้ data-lock-field (ไม่ใช่ data-field) เพื่อไม่ให้ปนกับค่าของ type
        lockBox.dataset.lockField = field;
        lockBox.className = 'lock-box';

        const lockLabel = document.createElement('label');
        lockLabel.className = 'lock-toggle';
        // ล็อก = ตำแหน่งเริ่มต้นของข้อความนี้ต้องตรงกับ template ตามไม้บรรทัด
        // ระบบชดเชยด้วยการเพิ่ม/ลบช่องว่างทั้งด้านหน้าและด้านหลัง ตามความกว้างจริง
        lockLabel.title =
            'ล็อกตำแหน่งเริ่มต้นของข้อความนี้ให้ตรงกับที่อยู่ใน template (แนวไม้บรรทัด) ' +
            'ถ้าค่าของ field ด้านหน้ายาวกว่าเดิม ระบบจะลบช่องว่างด้านหน้าให้ ' +
            'ถ้าสั้นกว่าเดิมจะเติมช่องว่างให้ และช่องของ field นี้ (กว้างเท่า ' +
            '{{field}} เดิม รวมปีกกา) ถูกรักษาไว้ให้ข้อความด้านหลังอยู่ที่เดิม ' +
            'ระบบไม่ตัดข้อความที่กรอก ถ้าช่องว่างไม่พอก็จะเตือนตอนสร้างเอกสาร';

        const lockText = document.createElement('span');
        lockText.textContent = 'ล็อกตำแหน่ง';

        lockLabel.appendChild(lockBox);
        lockLabel.appendChild(lockText);

        row.appendChild(select);
        row.appendChild(lockLabel);

        wrapper.appendChild(row);
        wrapper.appendChild(createPlaceholderInput(field));
        wrapper.appendChild(createTableConfig(field));
        return wrapper;
    }

    function parseJson(text, fallback) {
        try {
            const parsed = JSON.parse(text);
            return (parsed === null || parsed === undefined) ? fallback : parsed;
        } catch (error) {
            return fallback;
        }
    }

    function formatDate(isoText) {
        const date = new Date(isoText);
        if (isNaN(date.getTime())) return isoText || '';
        return date.toLocaleString('th-TH');
    }

    function createSavedItem(record) {
        const item = document.createElement('li');
        item.className = 'saved-item';

        const info = document.createElement('div');
        info.className = 'info';

        const name = document.createElement('strong');
        name.textContent = record.name;

        const fields = parseJson(record.fields, []);
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = [
            record.file_name || '(ไม่มีชื่อไฟล์)',
            fields.length + ' fields',
            'อัปเดต ' + formatDate(record.updated_at)
        ].join(' · ');

        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'actions';

        // ใช้ textContent ทุกจุด เพราะชื่อ template มาจากผู้ใช้ (กัน XSS)
        const loadBtn = document.createElement('button');
        loadBtn.type = 'button';
        loadBtn.textContent = 'โหลด';
        loadBtn.dataset.action = 'load';
        loadBtn.dataset.id = String(record.id);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'danger';
        deleteBtn.textContent = 'ลบ';
        deleteBtn.dataset.action = 'delete';
        deleteBtn.dataset.id = String(record.id);

        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);

        item.appendChild(info);
        item.appendChild(actions);
        return item;
    }

    const page = scope.FormPage.create({
        title: 'ตั้งค่าแม่แบบ',
        formTitle: 'ตั้งค่า Type ของแต่ละ Field',
        showDownload: false,   // หน้านี้มีแต่ค่า type ไม่ใช่ค่าที่จะใส่เอกสาร
        // รวมปุ่มจัดการไฟล์ / Save Template / Clear ไว้แถวเดียวกัน (แบบหน้ารายงาน)
        actionsRow: true,
        renderControl: createTypeSelect,
        metaHTML: META_HTML,
        actionsHTML: ACTIONS_HTML,
        footerHTML: FOOTER_HTML,
        emptyMessage: 'เลือกไฟล์ .docx ด้านบน หรือกด "โหลด" จากรายการด้านล่างเพื่อเริ่มตั้งค่า'
    });

    // ── ส่วนที่ใช้เฉพาะหน้านี้ ──

    // ── โครงตาราง (type = table) ──

    // หา node ของช่องตั้งค่าตารางของ field หนึ่ง (หาไม่ได้ = ฟอร์มถูกล้างไปแล้ว)
    function tableNodes(field) {
        const form = document.getElementById('form');
        const found = {};

        if (!form) return found;

        form.querySelectorAll(
            '[data-table-config], [data-table-count], [data-table-preview]'
        ).forEach(function (node) {
            const data = node.dataset;

            if (data.tableConfig === field) found.box = node;
            else if (data.tableCount === field) found.count = node;
            else if (data.tablePreview === field) found.preview = node;
        });

        return found;
    }

    // ── ชื่อคอลัมน์ + ตัวอย่างสัดส่วน (ลากขอบปรับความกว้างได้) ──
    //
    // แต่ละช่องของแถบเป็น "ช่องพิมพ์ชื่อคอลัมน์" และระหว่างคอลัมน์มี "ที่จับ" ให้ลาก
    // การลากย้ายเฉพาะขอบเส้นนั้น (คอลัมน์ซ้าย + ขวาสลับความกว้างกัน)
    // ผลรวมสัดส่วนทั้งแถวจึงคงเดิมเสมอ — เห็นผลทันทีทั้งตัวอย่างและโครงตาราง
    // (ตัวเลขสัดส่วนของแต่ละคอลัมน์แสดงกำกับใต้ช่องชื่อ — ไม่มีช่องกรอกเลขแยกแล้ว)
    //
    // ทำงานด้วยปุ่มลูกศรได้ด้วย (โฟกัสที่จับแล้วกด ← / → ทีละ 0.1)

    const RATIO_STEP = 0.1;      // หน่วยเล็กสุดของการลาก/กดลูกศร
    const RATIO_MIN_TENTHS = 1;  // สัดส่วนต่ำสุด = 0.1 (เก็บเป็นจำนวน 0.1)

    // แสดงเลขสัดส่วนสั้น ๆ เช่น 1, 1.5, 2
    function formatRatio(value) {
        return String(Math.round(Number(value) * 10) / 10);
    }

    // ย้ายขอบที่ moveIndex (ระหว่างคอลัมน์ moveIndex กับ moveIndex + 1)
    // เป็นจำนวน tenths หน่วย 0.1 — คอลัมน์ซ้าย+ขวาสลับกัน ผลรวมคงเดิม
    // ย้ายไม่ได้ (คอลัมน์ใดจะติดลบ) = คืน null
    function moveRatios(ratios, moveIndex, tenths) {
        if (!(moveIndex >= 0 && moveIndex + 1 < ratios.length)) return null;

        const left = Math.round(Number(ratios[moveIndex]) / RATIO_STEP);
        const right = Math.round(Number(ratios[moveIndex + 1]) / RATIO_STEP);

        let newLeft = left + tenths;
        let newRight = right - tenths;

        if (newLeft < RATIO_MIN_TENTHS) {
            newRight += newLeft - RATIO_MIN_TENTHS;
            newLeft = RATIO_MIN_TENTHS;
        }

        if (newRight < RATIO_MIN_TENTHS) {
            newLeft += newRight - RATIO_MIN_TENTHS;
            newRight = RATIO_MIN_TENTHS;
        }

        if (newLeft < RATIO_MIN_TENTHS || newRight < RATIO_MIN_TENTHS) return null;

        const next = ratios.slice();

        // ปัดเป็นทศนิยม 1 ตำแหน่ง กันเศษ floating point (เช่น 21 * 0.1 = 2.1000...05)
        next[moveIndex] = Math.round(newLeft * RATIO_STEP * 10) / 10;
        next[moveIndex + 1] = Math.round(newRight * RATIO_STEP * 10) / 10;

        return next;
    }

    // เขียนสัดส่วนชุดใหม่ลงโครงตาราง (ผ่าน FieldTypes เหมือนการพิมพ์ในช่อง)
    function setTableWidths(field, ratios) {
        const schema = scope.FieldTypes.getTableSchema(field);

        schema.widths = ratios;
        scope.FieldTypes.setTableSchema(field, schema);
    }

    // สร้างแถบใหม่ทั้งอัน (เรียกเมื่อจำนวนคอลัมน์เปลี่ยน)
    // แต่ละช่องมี "ช่องพิมพ์ชื่อคอลัมน์" + ตัวเลขสัดส่วนกำกับ และมีที่จับคั่นระหว่างคอลัมน์
    function renderRatioPreview(field, columns, widths) {
        const nodes = tableNodes(field);
        if (!nodes.preview) return;

        nodes.preview.innerHTML = '';

        columns.forEach(function (name, index) {
            const cell = document.createElement('div');
            cell.className = 'table-ratio-cell';
            cell.style.flexGrow = String(widths[index] || 1);

            // ชื่อหัวคอลัมน์อยู่ในแถบเดียวกับที่ลากปรับความกว้าง — ไม่มีช่องกรอกแยกอีก
            // ใช้ data-table-column (ไม่ใช่ data-field) เพื่อไม่ให้ปนกับค่าของ type
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'table-col-name';
            input.dataset.tableColumn = field;
            input.dataset.tableColumnIndex = String(index);
            input.autocomplete = 'off';
            input.value = name || '';
            input.placeholder = 'ชื่อคอลัมน์ ' + (index + 1);
            input.setAttribute('aria-label', 'ชื่อคอลัมน์ ' + (index + 1) + ' ของ ' + field);

            const ratio = document.createElement('span');
            ratio.className = 'table-ratio-label';
            ratio.textContent = formatRatio(widths[index]);
            ratio.setAttribute('aria-hidden', 'true');

            cell.appendChild(input);
            cell.appendChild(ratio);
            nodes.preview.appendChild(cell);

            // ที่จับอยู่ระหว่างคอลัมน์ (คอลัมน์สุดท้ายไม่มี)
            if (index < columns.length - 1) {
                nodes.preview.appendChild(
                    createRatioHandle(field, index, widths)
                );
            }
        });
    }

    // ที่จับ 1 อัน = ขอบระหว่างคอลัมน์ index กับ index + 1 (ลาก/กดลูกศรได้)
    function createRatioHandle(field, index, widths) {
        const handle = document.createElement('div');
        handle.className = 'table-ratio-handle';
        handle.tabIndex = 0;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute(
            'aria-label',
            'ขอบระหว่างคอลัมน์ ' + (index + 1) + ' และ ' + (index + 2) + ' ของ ' + field +
            ' — ลากหรือกดลูกศรซ้าย/ขวาเพื่อปรับความกว้าง'
        );
        updateRatioHandleAria(handle, widths, index);
        updateRatioHandleLabel(handle, widths, index);

        handle.addEventListener('mousedown', function (event) {
            startRatioDrag(field, index, handle, event);
        });

        handle.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

            event.preventDefault();

            nudgeRatio(field, index, event.key === 'ArrowLeft' ? -1 : 1);
        });

        return handle;
    }

    // ค่า aria-valuenow = % ความกว้างของคอลัมน์ซ้าย (อ่านด้วย screen reader ได้)
    function updateRatioHandleAria(handle, widths, index) {
        const total = widths.reduce(function (all, value) {
            return all + Number(value);
        }, 0);

        handle.setAttribute(
            'aria-valuemin', '0'
        );
        handle.setAttribute(
            'aria-valuemax', '100'
        );
        handle.setAttribute(
            'aria-valuenow',
            String(Math.round(Number(widths[index]) / (total || 1) * 100))
        );
    }

    // แสดงสัดส่วนจริงเป็น tooltip ของที่จับ (ไม่มีช่องกรอกเลขให้ดูค่าอีกแล้ว)
    function updateRatioHandleLabel(handle, widths, index) {
        const right = widths[index + 1];

        if (right == null) {
            handle.title = '';
            return;
        }

        handle.title =
            'สัดส่วนคอลัมน์ ' + (index + 1) + ' : ' + (index + 2) + ' = ' +
            formatRatio(widths[index]) + ' : ' + formatRatio(right) +
            ' — ลาก หรือโฟกัสแล้วกด ← / → เพื่อปรับ';
    }

    // เริ่มลากขอบ — เก็บตำแหน่งเมาส์/สัดส่วนต้นไว้ แล้วอัปเดตตามระยะที่ลาก
    // (อัปเดตเป็นสเต็ป 0.1 เท่านั้น จึงเขียน schema ไม่บ่อยเกินจำเป็น)
    function startRatioDrag(field, moveIndex, handle, event) {
        const track = handle.parentNode;

        if (!track) return;

        const startX = event.clientX;
        const startRatios = scope.FieldTypes.getColumnWidths(
            scope.FieldTypes.getTableSchema(field)
        );
        const totalStart = startRatios.reduce(function (all, value) {
            return all + value;
        }, 0) || startRatios.length;

        // กว้าง 1 หน่วย (0.1 สัดส่วน) เท่ากับกี่พิกเซล ณ ตอนเริ่มลาก
        const pxPerTenth = track.getBoundingClientRect().width * RATIO_STEP / totalStart;

        if (!(pxPerTenth > 0)) return;

        let appliedTenths = 0;

        function onMove(moveEvent) {
            const tenths = Math.round((moveEvent.clientX - startX) / pxPerTenth);

            if (tenths === appliedTenths) return;

            const next = moveRatios(startRatios, moveIndex, tenths);

            if (!next) return;

            appliedTenths = tenths;

            setTableWidths(field, next);
            syncRatioPreview(field, next);
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.classList.remove('table-ratio-dragging');
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);

        // กันไฮไลต์ข้อความขณะลาก + เปลี่ยนเคอร์เซอร์ทั้งหน้าเป็น col-resize
        event.preventDefault();
        document.body.classList.add('table-ratio-dragging');
    }

    // กดลูกศรบนที่จับ = ย้ายขอบทีละ 0.1 (← ซ้ายเล็กลง, → ซ้ายกว้างขึ้น)
    function nudgeRatio(field, moveIndex, tenths) {
        const next = moveRatios(
            scope.FieldTypes.getColumnWidths(scope.FieldTypes.getTableSchema(field)),
            moveIndex,
            tenths
        );

        if (!next) return;

        setTableWidths(field, next);
        syncRatioPreview(field, next);
    }

    // อัปเดตชื่อคอลัมน์/เลขสัดส่วน/ตำแหน่งที่จับให้ตรงกับค่าใหม่ โดยไม่สร้าง element ใหม่
    // (การลากเรียกบ่อย จึงแค่แก้ flex/ข้อความ — ช่องที่กำลังโฟกัสไม่ถูกแทนที่)
    function syncRatioPreview(field, widths) {
        const nodes = tableNodes(field);

        if (!nodes.preview) return;

        const schema = scope.FieldTypes.getTableSchema(field);
        const columns = schema.columns;
        const ratios = widths || scope.FieldTypes.getColumnWidths(schema);

        let cellIndex = 0;

        nodes.preview.childNodes.forEach(function (node) {
            if (!node.classList) return;

            if (node.classList.contains('table-ratio-cell')) {
                const ratio = ratios[cellIndex];

                node.style.flexGrow = String(ratio);

                // ช่องชื่อเดินตามโครงตาราง — เว้นช่องที่กำลังพิมพ์อยู่กลางคำ
                const input = node.querySelector('.table-col-name');

                if (input && input !== document.activeElement) {
                    input.value =
                        columns[cellIndex] == null
                            ? ''
                            : String(columns[cellIndex]);
                }

                const label = node.querySelector('.table-ratio-label');

                if (label) label.textContent = formatRatio(ratio);

                cellIndex++;
            } else if (node.classList.contains('table-ratio-handle')) {
                const index = Math.max(cellIndex - 1, 0);

                updateRatioHandleAria(node, ratios, index);
                updateRatioHandleLabel(node, ratios, index);
            }
        });
    }

    // เตรียมแถบชื่อคอลัมน์/สัดส่วนของ field — มีแถบอยู่แล้ว = อัปเดตเฉย ๆ ไม่สร้างใหม่
    // (ไม่สร้างใหม่ = ช่องที่กำลังพิมพ์อยู่ไม่เสียโฟกัส)
    function scheduleRatioPreview(field, columns) {
        const nodes = tableNodes(field);
        if (!nodes.preview) return;

        const schema = scope.FieldTypes.getTableSchema(field);
        const widths = scope.FieldTypes.getColumnWidths(schema);

        // จำนวนช่องเดิม (ช่องกรอก + ที่จับ) ยังตรงกับจำนวนคอลัมน์ = แค่อัปเดตค่า
        if (nodes.preview.childNodes.length === columns.length * 2 - 1) {
            syncRatioPreview(field, widths);
            return;
        }

        renderRatioPreview(field, columns, widths);
    }

    // จำนวนที่ {{field}} ถูกวางไว้ในเอกสาร (นับเป็นย่อหน้า)
    // ว่างไว้ถ้านับไม่ได้ (ยังไม่โหลดไฟล์) หรือวางไว้ที่เดียว
    function renderTableUsage(field) {
        const form = document.getElementById('form');
        if (!form) return;

        let note = null;

        form.querySelectorAll('[data-table-usage]').forEach(function (node) {
            if (node.dataset.tableUsage === field) note = node;
        });

        if (!note) return;

        const usage =
            scope.App &&
            scope.App.getFieldUsage
                ? scope.App.getFieldUsage()
                : {};

        const copies = usage[field] || 0;

        note.hidden = copies <= 1;
        note.textContent = copies > 1
            ? '⚠ วาง {{' + field + '}} ไว้ ' + copies + ' ที่ในเอกสาร ' +
                '→ ตอนสร้างเอกสารจะได้ตาราง ' + copies + ' อัน ' +
                'ถ้าต้องการที่เดียว ให้เหลือไว้ที่เดียวใน template แล้ววางไฟล์ใหม่'
            : '';
    }

    // ซิงก์ช่องตั้งค่าตารางของ field ให้ตรงกับ type ที่เลือกและโครงที่เก็บไว้
    function renderTableConfig(field) {
        const nodes = tableNodes(field);
        if (!nodes.box) return;

        const control = scope.FormPage.findControl(field);
        const isTable = !!control && control.value === 'table';

        nodes.box.hidden = !isTable;

        // ช่อง placeholder ไม่ใช้กับตาราง (ชื่อคอลัมน์บอกความหมายอยู่แล้ว)
        const form = document.getElementById('form');

        if (form) {
            form.querySelectorAll('[data-placeholder-field]').forEach(function (input) {
                if (input.dataset.placeholderField === field) {
                    input.hidden = isTable;
                }
            });
        }

        if (!isTable) return;

        const schema = scope.FieldTypes.getTableSchema(field);

        if (nodes.count) nodes.count.value = String(schema.columns.length);

        scheduleRatioPreview(field, schema.columns);
        renderTableUsage(field);
    }

    function renderAllTableConfigs() {
        const form = document.getElementById('form');
        if (!form) return;

        form.querySelectorAll('[data-table-config]').forEach(function (node) {
            renderTableConfig(node.dataset.tableConfig);
        });
    }

    // field ที่ถูกล็อกตำแหน่ง (เก็บแยกจากค่าของ type)
    let lockState = {};

    // placeholder (ข้อความตัวอย่าง) ของแต่ละ field (เก็บแยกจากค่าของ type)
    let placeholderState = {};

    // เติมสถานะติ๊กกลับเข้า checkbox หลังฟอร์มถูกวาดใหม่
    function renderLockState() {
        const form = document.getElementById('form');
        if (!form) return;

        form.querySelectorAll('[data-lock-field]').forEach(function (box) {
            box.checked = lockState[box.dataset.lockField] === true;
        });
    }

    // เติม placeholder ที่ตั้งไว้กลับเข้าช่อง หลังฟอร์มถูกวาดใหม่
    function renderPlaceholderState() {
        const form = document.getElementById('form');
        if (!form) return;

        form.querySelectorAll('[data-placeholder-field]').forEach(function (input) {
            const field = input.dataset.placeholderField;

            input.value =
                Object.prototype.hasOwnProperty.call(placeholderState, field)
                    ? placeholderState[field]
                    : '';
        });
    }

    const baseRenderForm = page.renderForm;

    page.renderForm = function (fields) {
        baseRenderForm.call(page, fields);
        renderLockState();
        renderPlaceholderState();
        renderAllTableConfigs();
    };

    const baseApplyValues = page.applyValues;

    // ค่า type ถูกเติมกลับหลังฟอร์มถูกวาด จึงต้องอัปเดตช่องตั้งค่าตารางอีกครั้ง
    // ไม่งั้น field ที่บันทึกไว้ว่าเป็น Table จะยังซ่อนช่องตั้งค่าอยู่
    page.applyValues = function (values) {
        baseApplyValues.call(page, values);
        renderAllTableConfigs();
    };

    // ── โครงตาราง: ให้ app.js เรียกเมื่อผู้ใช้แก้ค่าที่หน้า Template Configuration ──

    // อัปเดตช่องตั้งค่าตารางของ field นี้ (เรียกเมื่อเปลี่ยน type)
    page.refreshTableConfig = renderTableConfig;

    // จำนวนคอลัมน์: ตัด/ต่อชื่อหัวคอลัมน์ให้ครบตามจำนวนใหม่
    // (สัดส่วนความกว้างเดิมต้องคงอยู่ — คอลัมน์ใหม่ได้สัดส่วน 1)
    page.setTableCount = function (field, value) {
        const raw = String(value == null ? '' : value).trim();

        // ระหว่างพิมพ์ (ลบเลขจนว่าง) ยังไม่ต้องแก้อะไร
        if (raw === '') return;

        const count = Math.min(
            Math.max(Math.round(Number(raw)) || 1, 1),
            scope.FieldTypes.tableMaxColumns
        );

        const schema = scope.FieldTypes.getTableSchema(field);
        const columns = schema.columns.slice(0, count);
        const widths = schema.widths.slice(0, count);

        while (columns.length < count) {
            columns.push('คอลัมน์ ' + (columns.length + 1));
            widths.push(scope.FieldTypes.normalizeColumnRatio(null));
        }

        scope.FieldTypes.setTableSchema(field, { columns: columns, widths: widths });

        renderTableConfig(field);
    };

    page.setTableColumn = function (field, index, value) {
        const schema = scope.FieldTypes.getTableSchema(field);

        if (!(index >= 0 && index < schema.columns.length)) return;

        schema.columns[index] = String(value == null ? '' : value);
        scope.FieldTypes.setTableSchema(field, schema);
    };

    // โครงตารางของทุก field ที่เป็น type table (บันทึกพร้อม template)
    page.getTableSchemas = function (types) {
        const byType = types || page.getValues();
        const schemas = {};

        Object.keys(byType).forEach(function (field) {
            if (byType[field] === 'table') {
                schemas[field] = scope.FieldTypes.getTableSchema(field);
            }
        });

        return schemas;
    };

    // คืนโครงตารางที่บันทึกไว้กลับมา (ตอนโหลด template) — null/{} = ไม่มีตาราง
    page.setTableSchemas = function (schemas) {
        scope.FieldTypes.setTableSchemas(schemas);
        renderAllTableConfigs();
    };

    page.setLock = function (field, locked) {
        if (locked) {
            lockState[field] = true;
        } else {
            delete lockState[field];
        }
    };

    page.getLocks = function () {
        return Object.assign({}, lockState);
    };

    // คืนค่าที่บันทึกไว้กลับมา (ตอนโหลด template) — null/{} = ไม่มี field ที่ล็อก
    page.setLocks = function (locks) {
        lockState = {};

        if (locks && typeof locks === 'object') {
            Object.keys(locks).forEach(function (field) {
                if (locks[field]) lockState[field] = true;
            });
        }

        renderLockState();
    };

    // เก็บ placeholder ของ field — ว่าง = ลบออก (กลับไปใช้ค่าเริ่มต้นในหน้ารายงาน)
    page.setPlaceholder = function (field, value) {
        const text = String(value == null ? '' : value);

        if (text.trim() === '') {
            delete placeholderState[field];
        } else {
            placeholderState[field] = text;
        }
    };

    page.getPlaceholders = function () {
        return Object.assign({}, placeholderState);
    };

    // คืนค่าที่บันทึกไว้กลับมา (ตอนโหลด template) — null/{} = ไม่มี placeholder
    page.setPlaceholders = function (placeholders) {
        placeholderState = {};

        if (placeholders && typeof placeholders === 'object') {
            Object.keys(placeholders).forEach(function (field) {
                const value = String(placeholders[field] == null ? '' : placeholders[field]);

                if (value.trim() !== '') placeholderState[field] = value;
            });
        }

        renderPlaceholderState();
    };

    page.setSaveEnabled = function (enabled) {
        const btn = document.getElementById('saveBtn');
        if (btn) btn.disabled = !enabled;

        // ปุ่มที่ต้องมีไฟล์ template อยู่ในมือก่อน (ดาวน์โหลดต้นฉบับ / อัปโหลดทับ)
        ['downloadTemplateBtn', 'replaceTemplateBtn'].forEach(function (id) {
            const actionBtn = document.getElementById(id);
            if (actionBtn) actionBtn.disabled = !enabled;
        });
    };

    page.setDbStatus = function (text, kind) {
        const el = document.getElementById('dbStatus');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'db-status' + (kind ? ' ' + kind : '');
    };

    page.renderTemplateList = function (records, errorMessage) {
        const list = document.getElementById('savedList');
        if (!list) return;

        list.innerHTML = '';

        const message = errorMessage
            ? errorMessage
            : (records && records.length === 0 ? 'ยังไม่มี template ที่บันทึกไว้' : '');

        if (message) {
            const empty = document.createElement('li');
            empty.className = 'empty';
            empty.textContent = message;
            list.appendChild(empty);
            return;
        }

        for (const record of records) {
            list.appendChild(createSavedItem(record));
        }
    };

    scope.TemplateConfigPage = page;
})(window);
