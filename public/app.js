
// Main App - state, navigation และการประสานงานระหว่าง module
(function (scope) {
    'use strict';

    const DEFAULT_PAGE = 'report';
    const CONFIG_PAGE = 'template-config';
    const MASTER_PAGE = 'master-data';
    const WORDS_PAGE = 'word-suggest';
    const HISTORY_PAGE = 'history';

    // สวิตช์เปิด/ปิดการแนะนำคำเป็นค่าติดตั้งของเครื่องนี้ ไม่ใช่ข้อมูลของ template
    // จึงเก็บใน localStorage ไม่ต้องเพิ่มตารางในฐานข้อมูล
    const SUGGEST_ENABLED_KEY = 'word-template-filler.suggest-enabled';

    // อายุการเก็บประวัติการกรอก (วัน) — ค่าติดตั้งของเครื่องนี้ เก็บใน localStorage
    // 0 = ไม่จำกัดอายุ (ตัวเลือกที่เลือกได้อยู่ใน historyPage.js)
    const HISTORY_RETENTION_KEY = 'word-template-filler.history-retention-days';
    const DEFAULT_HISTORY_RETENTION_DAYS = 15;

    // หัวคอลัมน์ที่ยอมรับในไฟล์ Excel ของหน้า Master Data
    // เทียบหลังตัดช่องว่าง/ขีด/ขีดล่าง และแปลงเป็นตัวพิมพ์เล็กแล้ว
    const MASTER_CODE_HEADERS = ['codegroup', 'กลุ่ม', 'กลุ่มรหัส', 'รหัสกลุ่ม'];
    const MASTER_NAME_HEADERS = ['name', 'ชื่อ', 'ชื่อข้อมูล'];

    // ชื่อหน้า -> ชื่อ component บน window (ลำดับโหลดอยู่ใน index.html)
    const PAGE_COMPONENTS = {
        'report': 'ReportPage',
        'template-config': 'TemplateConfigPage',
        'master-data': 'MasterDataPage',
        'word-suggest': 'WordSuggestPage',
        'history': 'HistoryPage'
    };

    // ──────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────
    const state = {
        docxBytes: null,   // ไฟล์ต้นฉบับเก็บเป็น byte ดิบ (ไม่ถูกแก้) ใช้ทั้งดาวน์โหลดและบันทึก
        xml: null,         // word/document.xml ต้นฉบับ
        fields: [],        // field ทั้งหมดที่พบใน template
        loaded: false,     // โหลดไฟล์สำเร็จแล้วหรือยัง
        fileName: '',
        templateId: null   // id ของ template ที่โหลดมาจากฐานข้อมูล
    };

    let currentPage = DEFAULT_PAGE;
    const pageValues = {};   // ค่าที่ผู้ใช้เลือก แยกตามหน้า (หน้ารายงาน = ข้อความ, config = type)
    const pageMeta = {};     // ค่าอื่นที่ไม่ใช่ field (เช่น ชื่อ template) แยกตามหน้า
    const pageCache = {};    // cache HTML ของแต่ละหน้า
    let mainEl = null;
    let dbPromise = null;
    let textMeasurer = null;   // ตัววัดความกว้างจริง ใช้ตอนล็อกตำแหน่ง
    let templateRecords = null;   // cache รายการ template ล่าสุดจากฐานข้อมูล
    let masterRecords = null;     // cache รายการ master data ล่าสุดจากฐานข้อมูล
    let wordRecords = null;       // cache คำที่เพิ่มเองล่าสุดจากฐานข้อมูล
    let historyRecords = null;    // cache ประวัติการกรอกล่าสุดจากฐานข้อมูล

    // ──────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────
    function getComponent(page) {
        const name =
            PAGE_COMPONENTS[page] ||
            PAGE_COMPONENTS[DEFAULT_PAGE];

        return scope[name];
    }

    function getPageValues(page) {
        if (!pageValues[page]) {
            pageValues[page] = {};
        }

        return pageValues[page];
    }

    function getPageMeta(page) {
        if (!pageMeta[page]) {
            pageMeta[page] = {};
        }

        return pageMeta[page];
    }

    function clearPageState() {

        Object.keys(pageValues).forEach(function (page) {
            delete pageValues[page];
        });

        Object.keys(pageMeta).forEach(function (page) {
            delete pageMeta[page];
        });

        // ล้างโหมด "ตัวเลข/ตัวหนังสือ" ของช่อง currency ที่เคยสลับไว้
        if (
            scope.FieldTypes &&
            scope.FieldTypes.resetCurrencyModes
        ) {
            scope.FieldTypes.resetCurrencyModes();
        }

        // ล้างรูปแบบวันที่ที่เคยเลือกไว้ของช่อง date
        if (
            scope.FieldTypes &&
            scope.FieldTypes.resetDateFormats
        ) {
            scope.FieldTypes.resetDateFormats();
        }

        // ล้างสถานะ "ล็อกตำแหน่ง" และ placeholder ที่ตั้งไว้ในหน้า Template Configuration
        const config =
            getComponent(CONFIG_PAGE);

        if (
            config &&
            config.setLocks
        ) {
            config.setLocks(null);
        }

        if (
            config &&
            config.setPlaceholders
        ) {
            config.setPlaceholders(null);
        }

        // ล้างโครงตารางที่ตั้งไว้ (type = Table)
        if (
            config &&
            config.setTableSchemas
        ) {
            config.setTableSchemas(null);
        }

        // ล้างแถวของตารางที่กรอกไว้ในหน้ารายงาน
        if (
            scope.ReportPage &&
            scope.ReportPage.resetTables
        ) {
            scope.ReportPage.resetTables();
        }
    }

    function getPageHTML(page) {

        if (!pageCache[page]) {
            pageCache[page] =
                getComponent(page).getHTML();
        }

        return pageCache[page];
    }

    function defaultTemplateName(fileName) {

        return String(
            fileName || 'document.docx'
        ).replace(
            /\.docx$/i,
            ''
        );
    }

    // ชื่อเอกสารที่กรอกเสร็จแล้ว (ใช้ตอน Download DOCX / ตัวอย่างเอกสาร)
    // ใช้ชื่อแม่แบบที่ตั้ง/บันทึกไว้ ถ้ายังไม่มีจึงใช้ชื่อไฟล์ .docx ต้นฉบับ
    // และตัดอักขระที่ตั้งเป็นชื่อไฟล์บน Windows ไม่ได้ออก
    function templateOutputName() {

        const name =
            String(
                getPageMeta(
                    CONFIG_PAGE
                ).templateName || ''
            ).trim() ||
            defaultTemplateName(
                state.fileName
            );

        return name.replace(
            /[\\/:*?"<>|]+/g,
            '-'
        );
    }

    async function readDocumentXml(bytes) {

        const zip =
            await JSZip.loadAsync(bytes);

        const entry =
            zip.file('word/document.xml');

        if (!entry) {

            const error =
                new Error(
                    'ไฟล์ DOCX ไม่ถูกต้อง (ไม่พบ word/document.xml)'
                );

            error.expected = true;

            throw error;
        }

        return entry.async('string');
    }

    async function downloadBlob(blob, fileName) {

        // ─────────────────────────────
        // Electron
        // ─────────────────────────────
        if (window.electronAPI) {

            const buffer =
                await blob.arrayBuffer();

            return window.electronAPI.saveFile({
                data: buffer,
                fileName: fileName
            });
        }

        // ─────────────────────────────
        // Browser fallback
        // ─────────────────────────────

        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement('a');

        link.href = url;
        link.download = fileName;

        document.body.appendChild(link);

        link.click();

        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    }

    // เติมค่าใน [data-persist] ของหน้าปัจจุบันกลับจาก pageMeta
    function applyMeta(page) {

        const meta =
            getPageMeta(page);

        mainEl
            .querySelectorAll('[data-persist]')
            .forEach(function (el) {

                const key =
                    el.dataset.persist;

                el.value =
                    Object.prototype.hasOwnProperty.call(
                        meta,
                        key
                    )
                        ? meta[key]
                        : '';
            });
    }

    // วาดฟอร์ม + ปุ่มของหน้าให้ตรงกับ state ปัจจุบัน
    //
    // เรียกทุกครั้งที่หน้า/ไฟล์เปลี่ยน (เปลี่ยนหน้า โหลด บันทึก ล้างค่า) จึงปิด popup
    // ที่ค้างอยู่ตรงนี้ด้วย — overlay ที่ค้างจะทับฟอร์มใหม่ ทำให้ช่องกรอกกด/พิมพ์ไม่ได้
    function fillForm(page) {

        closeOpenPopups();

        // หน้าที่ไม่ผูกกับไฟล์ .docx (เช่น Master Data) วาด UI เองทั้งหมด
        if (getComponent(page).standalone) {
            return;
        }

        const component =
            getComponent(page);

        if (!state.loaded) {

            component.showEmptyState();
            component.hideButtons();

            if (component.showPreviewButton) {
                component.showPreviewButton(false);
            }

            if (component.setSaveEnabled) {
                component.setSaveEnabled(false);
            }

            return;
        }

        component.renderForm(
            state.fields
        );

        component.applyValues(
            getPageValues(page)
        );

        component.showDownloadButton(
            state.fields.length > 0
        );

        component.showClearButton(true);

        // ปุ่มดูตัวอย่างมีเฉพาะหน้ารายงาน (declared ใน reportPage.js)
        if (component.showPreviewButton) {
            component.showPreviewButton(state.fields.length > 0);
        }

        if (component.setSaveEnabled) {
            component.setSaveEnabled(true);
        }
    }

    // ปิด popup ทุกตัวที่ค้างอยู่ (date picker / lookup / preview / ลิสต์เลือก / แนะนำคำ)
    // overlay ที่ค้างจะทับฟอร์มของหน้าใหม่ ทำให้ช่องกรอกดูเหมือนถูกปิดใช้งาน (กด/พิมพ์ไม่ได้)
    function closeOpenPopups() {

        [
            scope.SelectMenu,
            scope.SuggestMenu,
            scope.DatePicker,
            scope.MasterLookup,
            scope.PreviewDialog
        ].forEach(function (popup) {

            if (popup && popup.close) {
                popup.close();
            }
        });
    }

    function renderPage(page) {

        mainEl.innerHTML =
            getPageHTML(page);

        applyMeta(page);

        fillForm(page);
    }

    // ──────────────────────────────────────────────────────────────
    // Database
    // ──────────────────────────────────────────────────────────────
    //
    // Renderer
    //    ↓
    // db.js
    //    ↓
    // window.electronAPI
    //    ↓
    // Electron Main
    //    ↓
    // DB Worker
    //    ↓
    // better-sqlite3
    //    ↓
    // SQLite
    //
    // โหลด lazy: จะเปิด DB เมื่อจำเป็นต้องใช้เท่านั้น
    // ──────────────────────────────────────────────────────────────

    function ensureDb() {

        if (!dbPromise) {

            dbPromise =
                scope.Db.init()

                    .then(function (info) {

                        setDbStatus(
                            'ฐานข้อมูล: SQLite — บันทึกถาวร',
                            ''
                        );

                        return info;

                    })

                    .catch(function (error) {

                        // ให้สามารถลองเปิด DB ใหม่ได้
                        dbPromise = null;

                        setDbStatus(
                            'เปิดฐานข้อมูลไม่สำเร็จ: ' +
                            error.message,
                            'error'
                        );

                        throw error;
                    });
        }

        return dbPromise;
    }

    function setDbStatus(text, kind) {

        const config =
            getComponent(CONFIG_PAGE);
        const master =
            getComponent(MASTER_PAGE);

        if (
            config &&
            config.setDbStatus
        ) {

            config.setDbStatus(
                text,
                kind
            );
        }

        if (
            master &&
            master.setDbStatus
        ) {

            master.setDbStatus(
                text,
                kind
            );
        }
    }

    // แสดงรายการให้ทุกส่วนที่อยู่บนหน้าปัจจุบัน
    // การ์ดในหน้า config และ dropdown ในหน้ารายงาน
    function renderTemplateChoosers(
        records,
        errorMessage
    ) {

        const config =
            getComponent(CONFIG_PAGE);

        if (
            config.renderTemplateList &&
            document.getElementById('savedList')
        ) {

            config.renderTemplateList(
                records,
                errorMessage
            );
        }

        const report =
            getComponent(DEFAULT_PAGE);

        if (
            report.renderTemplateOptions &&
            document.getElementById('templateSelect')
        ) {

            const message =
                errorMessage
                    ? errorMessage
                    : (
                        records.length === 0
                            ? 'ยังไม่มี template ที่บันทึกไว้'
                            : '— เลือก template ที่บันทึกไว้ —'
                    );

            report.renderTemplateOptions(
                records,
                state.templateId,
                message
            );
        }
    }

    async function refreshTemplateList() {

        // ข้ามการโหลดฐานข้อมูลถ้าหน้าปัจจุบันไม่มีที่แสดงรายการ
        if (
            !document.getElementById('savedList') &&
            !document.getElementById('templateSelect')
        ) {
            return;
        }

        try {

            await ensureDb();

            templateRecords =
                await scope.Db.list();

            renderTemplateChoosers(
                templateRecords
            );

        } catch (error) {

            console.error(error);

            renderTemplateChoosers(
                [],
                'โหลดรายการไม่สำเร็จ: ' +
                error.message
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Event Binding
    // ใช้ event delegation ผูกครั้งเดียวที่ #mainContent
    // ──────────────────────────────────────────────────────────────
    function captureValue(target) {

        if (
            !target ||
            !target.dataset
        ) {
            return;
        }

        // checkbox ล็อกตำแหน่งของข้อความ (หน้า Template Configuration)
        if (target.dataset.lockField) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.setLock) {

                config.setLock(
                    target.dataset.lockField,
                    target.checked
                );
            }

            return;
        }

        // ช่อง placeholder ของ field (หน้า Template Configuration)
        if (target.dataset.placeholderField) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.setPlaceholder) {

                config.setPlaceholder(
                    target.dataset.placeholderField,
                    target.value
                );
            }

            return;
        }

        // ── ช่องตั้งค่าตาราง (หน้า Template Configuration) ──

        // จำนวนคอลัมน์
        if (target.dataset.tableCount !== undefined) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.setTableCount) {

                config.setTableCount(
                    target.dataset.tableCount,
                    target.value
                );
            }

            return;
        }

        // ชื่อหัวคอลัมน์ (มี index ของคอลัมน์มากับช่องด้วย)
        if (
            target.dataset.tableColumn !== undefined &&
            target.dataset.tableColumnIndex !== undefined
        ) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.setTableColumn) {

                config.setTableColumn(
                    target.dataset.tableColumn,
                    Number(target.dataset.tableColumnIndex),
                    target.value
                );
            }

            return;
        }

        // สัดส่วนความกว้างของคอลัมน์ (หน้า Template Configuration)
        if (
            target.dataset.tableWidth !== undefined &&
            target.dataset.tableWidthIndex !== undefined
        ) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.setTableWidth) {

                config.setTableWidth(
                    target.dataset.tableWidth,
                    Number(target.dataset.tableWidthIndex),
                    target.value
                );
            }

            return;
        }

        // ── ช่องกรอกในตารางของหน้ารายงาน (data-table-row = ลำดับแถว) ──
        if (target.dataset.tableInput !== undefined) {

            const report =
                getComponent(DEFAULT_PAGE);

            if (report.setTableCell) {

                report.setTableCell(
                    target.dataset.tableInput,
                    Number(target.dataset.tableRow),
                    Number(target.dataset.tableCol),
                    target.value
                );
            }

            return;
        }

        if (target.dataset.field) {

            // ช่อง currency แสดงรูปแบบตามโหมด (comma / ตัวหนังสือ)
            // แต่ค่าที่เก็บต้องเป็นตัวเลขล้วนเสมอ จึงอ่านจาก dataset
            if (target.dataset.currencyInput === '1') {

                getPageValues(
                    currentPage
                )[target.dataset.field] =
                    target.dataset.currencyValue || '';

            } else {

                // ใช้ตัวอ่านค่าร่วมกับ FormPage
                // เพื่อให้ checkbox/textarea ตรงกัน
                getPageValues(
                    currentPage
                )[target.dataset.field] =
                    scope.FormPage.readControlValue(
                        target
                    );
            }

            // ค่าเปลี่ยนแล้ว คำเตือนล็อกตำแหน่งเดิมอาจไม่จริงอีก
            clearReplaceWarnings();

        } else if (target.dataset.persist) {

            getPageMeta(
                currentPage
            )[target.dataset.persist] =
                target.value;
        }

        // เปลี่ยน type ของ field → อัปเดตช่องตั้งค่าตารางของ field นั้น
        // (แสดง/ซ่อน + สร้างช่องชื่อคอลัมน์ตามจำนวนที่ตั้งไว้)
        if (
            target.classList &&
            target.classList.contains('field-type')
        ) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.refreshTableConfig) {
                config.refreshTableConfig(target.dataset.field);
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Currency (จำนวนเงิน) — หน้ารายงาน
    //
    // ช่องเก็บค่าเป็นตัวเลขล้วนเสมอ (เช่น 1000) ส่วนรูปแบบตอนเขียนลงเอกสาร
    // (1,000 หรือ หนึ่งพันบาทถ้วน) กำหนดด้วยโหมดของช่องที่สลับด้วยปุ่ม toggle
    // ──────────────────────────────────────────────────────────────

    // พิมพ์ในช่อง currency: เก็บค่า canonical (ตัวเลขล้วน) ไว้ที่ dataset แล้วจัดรูปในช่องใหม่
    // โหมดตัวเลขช่องจะโชว์ comma ทันที (1,000) โหมดตัวหนังสือช่องเป็น read-only จึงไม่มาที่นี่
    function onCurrencyInput(input) {

        input.dataset.currencyValue =
            scope.FieldTypes.parseCurrencyInput(
                input.value
            );

        scope.FieldTypes.refreshCurrencyInputDisplay(
            input
        );

        captureValue(input);
    }

    // ออกจากช่อง (blur): เก็บกวาดจุดทศนิยมที่ค้างท้าย เช่น "1,000." -> "1,000"
    // (ตอนพิมพ์ต้องเก็บจุดไว้ก่อน ไม่งั้นพิมพ์ทศนิยมไม่ได้)
    function onCurrencyChange(input) {

        const digits =
            input.dataset.currencyValue || '';

        if (digits.endsWith('.')) {

            input.dataset.currencyValue =
                digits.slice(0, -1);

            scope.FieldTypes.refreshCurrencyInputDisplay(
                input
            );
        }

        captureValue(input);
    }

    // ปุ่ม toggle สลับโหมด "ตัวเลข / ตัวหนังสือ" ของช่อง currency ที่กด
    // กดแล้วเปลี่ยนค่าในช่อง input ทันที เช่น 1,000 <-> หนึ่งพันบาทถ้วน
    function onCurrencyToggle(button) {

        const field =
            button.dataset.currencyToggle;

        const modes =
            scope.FieldTypes.CURRENCY_MODES;

        const nextMode =
            scope.FieldTypes.getCurrencyMode(field) === modes.TEXT
                ? modes.NUMBER
                : modes.TEXT;

        scope.FieldTypes.setCurrencyMode(
            field,
            nextMode
        );

        // เปลี่ยนค่าในช่อง input ตามโหมดใหม่ทันที
        scope.FieldTypes.refreshCurrencyInputDisplay(
            findCurrencyInput(field)
        );

        // label ของปุ่มบอกโหมด "ที่จะสลับไป" เหมือน toggle ทั่วไป
        button.textContent =
            nextMode === modes.TEXT ? 'เปลี่ยนเป็นตัวเลข' : 'เปลี่ยนเป็นตัวอักษร';

        // ไฮไลต์เมื่ออยู่โหมดตัวหนังสือ (ต้องดูก่อนว่าเขียนลงเอกสารเป็นข้อความอยู่)
        button.classList.toggle(
            'active',
            nextMode === modes.TEXT
        );

        // โหมดเปลี่ยน = รูปที่จะเขียนลงเอกสารเปลี่ยน คำเตือนล็อกตำแหน่งเดิมอาจไม่จริงอีก
        clearReplaceWarnings();
    }

    // หาช่อง input ของ field currency ในฟอร์มปัจจุบัน
    function findCurrencyInput(field) {

        const form =
            document.getElementById('form');

        if (!form) {
            return null;
        }

        let found = null;

        form.querySelectorAll('[data-currency-input]').forEach(function (input) {
            if (input.dataset.field === field) {
                found = input;
            }
        });

        return found;
    }

    function findCurrencyToggle(field) {

        const form =
            document.getElementById('form');

        if (!form) {
            return null;
        }

        let found = null;

        form.querySelectorAll('[data-currency-toggle]').forEach(function (button) {
            if (button.dataset.currencyToggle === field) {
                found = button;
            }
        });

        return found;
    }

    // ช่อง currency ที่แสดงเป็นตัวหนังสือ (อ่านอย่างเดียวชั่วคราว):
    // โฟกัส/คลิกที่ช่อง = ผู้ใช้ต้องการแก้ไข จึงสลับกลับเป็นโหมดตัวเลขให้พิมพ์ต่อได้ทันที
    // ช่องจึงไม่ค้างอยู่ในสภาพ "กดไม่ได้" หลังโหลด/บันทึก/เปลี่ยนหน้า
    function onCurrencyEditRequest(input) {

        if (!input || !input.readOnly) {
            return;
        }

        const field =
            input.dataset.field;

        scope.FieldTypes.setCurrencyMode(
            field,
            scope.FieldTypes.CURRENCY_MODES.NUMBER
        );

        scope.FieldTypes.refreshCurrencyInputDisplay(
            input
        );

        // ปุ่ม toggle ต้องบอกโหมดใหม่ให้ตรงกัน
        const toggle =
            findCurrencyToggle(field);

        if (toggle) {

            toggle.textContent =
                'เปลี่ยนเป็นตัวอักษร';

            toggle.classList.remove('active');
        }

        // รูปที่จะเขียนลงเอกสารเปลี่ยน คำเตือนล็อกตำแหน่งเดิมอาจไม่จริงอีก
        clearReplaceWarnings();

        // ประทับเคอร์เซอร์ไว้ท้ายค่า เพื่อพิมพ์ต่อได้ทันที
        if (input.setSelectionRange) {

            const end =
                input.value.length;

            input.setSelectionRange(
                end,
                end
            );
        }
    }

    function bindMainEvents() {

        // ช่องจำนวนเงินโหมดตัวหนังสือ: คลิก/โฟกัสแล้วกลับมาแก้ไขเป็นตัวเลขทันที
        mainEl.addEventListener(
            'focusin',
            function (event) {

                const target =
                    event.target;

                if (
                    target &&
                    target.dataset &&
                    target.dataset.currencyInput === '1'
                ) {

                    onCurrencyEditRequest(
                        target
                    );
                }
            }
        );

        mainEl.addEventListener(
            'change',
            function (event) {

                const target =
                    event.target;

                // ช่อง currency: ตอนออกจากช่อง เก็บกวาดทศนิยมที่ค้างท้าย (เช่น "1,000.")
                if (
                    target &&
                    target.dataset &&
                    target.dataset.currencyInput === '1'
                ) {

                    onCurrencyChange(
                        target
                    );

                    return;
                }

                if (
                    target &&
                    target.id === 'fileInput'
                ) {

                    onFileChange(event);
                    return;
                }

                // อัปโหลดไฟล์ .docx ใหม่ทับไฟล์ template เดิม (หน้า Template Configuration)
                if (
                    target &&
                    target.id === 'replaceFileInput'
                ) {

                    onReplaceTemplateFile(event);
                    return;
                }

                // นำเข้า Excel ของหน้า Master Data
                if (
                    target &&
                    target.id === 'masterImportInput'
                ) {

                    onImportMasterExcel(event);
                    return;
                }

                // สวิตช์เปิด/ปิดการแนะนำคำ (หน้า "คำแนะนำ")
                if (
                    target &&
                    target.id === 'wordSuggestToggle'
                ) {

                    onToggleSuggest(
                        target.checked
                    );

                    return;
                }

                // อายุการเก็บประวัติการกรอก (หน้า "ประวัติ")
                if (
                    target &&
                    target.id === 'historyRetention'
                ) {

                    onRetentionChange(
                        target.value
                    );

                    return;
                }

                if (
                    target &&
                    target.id === 'templateSelect'
                ) {

                    onSelectTemplate(
                        target.value
                    );

                    return;
                }

                captureValue(target);
            }
        );

        mainEl.addEventListener(
            'input',
            function (event) {

                const target =
                    event.target;

                // ช่องค้นหาของหน้า "ประวัติ" กรองรายการทันที
                if (
                    target &&
                    target.id === 'historySearch'
                ) {

                    getComponent(
                        HISTORY_PAGE
                    ).setSearch(
                        target.value
                    );

                    return;
                }

                // ช่องค้นหาของหน้า Master Data กรองรายการทันที
                if (
                    target &&
                    target.id === 'masterSearch'
                ) {

                    getComponent(
                        MASTER_PAGE
                    ).setSearch(
                        target.value
                    );

                    return;
                }

                // ช่อง currency: คัดให้เหลือแต่ตัวเลข/จุดทศนิยม
                if (
                    target &&
                    target.dataset &&
                    target.dataset.currencyInput === '1'
                ) {

                    onCurrencyInput(
                        target
                    );

                    return;
                }

                captureValue(
                    event.target
                );
            }
        );

        mainEl.addEventListener(
            'click',
            function (event) {

                // ปุ่ม toggle "ตัวเลข/ตัวหนังสือ" ของช่อง currency (หน้ารายงาน)
                const currencyToggle =
                    event.target.closest
                        ? event.target.closest('[data-currency-toggle]')
                        : null;

                if (currencyToggle) {

                    onCurrencyToggle(
                        currencyToggle
                    );

                    return;
                }

                // ปุ่มเพิ่มแถวของตาราง (หน้ารายงาน)
                const addRowBtn =
                    event.target.closest
                        ? event.target.closest('[data-table-add]')
                        : null;

                if (addRowBtn) {

                    const report =
                        getComponent(DEFAULT_PAGE);

                    if (report.addTableRow) {
                        report.addTableRow(addRowBtn.dataset.tableAdd);
                    }

                    return;
                }

                // ปุ่มลบแถวของตาราง (หน้ารายงาน)
                const removeRowBtn =
                    event.target.closest
                        ? event.target.closest('[data-table-remove]')
                        : null;

                if (removeRowBtn) {

                    const report =
                        getComponent(DEFAULT_PAGE);

                    if (report.removeTableRow) {

                        report.removeTableRow(
                            removeRowBtn.dataset.tableRemove,
                            Number(removeRowBtn.dataset.tableRow)
                        );
                    }

                    return;
                }

                // ปุ่มผสานช่องกับช่องถัดไป (หน้ารายงาน)
                const mergeCellBtn =
                    event.target.closest
                        ? event.target.closest('[data-table-merge]')
                        : null;

                if (mergeCellBtn) {

                    const report =
                        getComponent(DEFAULT_PAGE);

                    if (report.mergeTableCells) {

                        report.mergeTableCells(
                            mergeCellBtn.dataset.tableMerge,
                            Number(mergeCellBtn.dataset.tableRow),
                            Number(mergeCellBtn.dataset.tableGroup)
                        );
                    }

                    return;
                }

                // ปุ่มแยกช่องที่ผสานอยู่ (หน้ารายงาน)
                const unmergeCellBtn =
                    event.target.closest
                        ? event.target.closest('[data-table-unmerge]')
                        : null;

                if (unmergeCellBtn) {

                    const report =
                        getComponent(DEFAULT_PAGE);

                    if (report.unmergeTableCells) {

                        report.unmergeTableCells(
                            unmergeCellBtn.dataset.tableUnmerge,
                            Number(unmergeCellBtn.dataset.tableRow),
                            Number(unmergeCellBtn.dataset.tableGroup)
                        );
                    }

                    return;
                }

                // ปุ่มจัดรูปแบบช่องของตาราง (หน้ารายงาน)
                const formatBtn =
                    event.target.closest
                        ? event.target.closest('[data-table-format]')
                        : null;

                if (formatBtn) {

                    const report =
                        getComponent(DEFAULT_PAGE);

                    if (report.applyTableFormat) {

                        report.applyTableFormat(
                            formatBtn.dataset.tableFormatField,
                            formatBtn.dataset.tableFormat
                        );
                    }

                    return;
                }

                const target =
                    event.target;

                if (!target) {
                    return;
                }

                const id =
                    target.id;

                // ดูตัวอย่างเอกสารก่อนดาวน์โหลด (หน้ารายงาน)
                if (id === 'previewBtn') {

                    onPreview();
                    return;
                }

                if (id === 'downloadBtn') {

                    onDownload();
                    return;
                }

                // ดาวน์โหลดไฟล์ .docx ต้นฉบับของ template (หน้า Template Configuration)
                if (id === 'downloadTemplateBtn') {

                    onDownloadTemplate();
                    return;
                }

                // เปิดกล่องเลือกไฟล์เพื่ออัปโหลดทับไฟล์เดิม
                if (id === 'replaceTemplateBtn') {

                    const replaceInput =
                        document.getElementById('replaceFileInput');

                    if (replaceInput) {
                        replaceInput.click();
                    }

                    return;
                }

                if (id === 'clearBtn') {

                    resetAll();
                    return;
                }

                if (id === 'saveBtn') {

                    onSaveTemplate();
                    return;
                }

                if (id === 'wordAddBtn') {

                    onSaveWord();
                    return;
                }

                if (id === 'wordCancelBtn') {

                    onCancelWordEdit();
                    return;
                }

                if (id === 'masterSaveBtn') {

                    onSaveMaster();
                    return;
                }

                if (id === 'masterCancelBtn') {

                    onCancelMasterEdit();
                    return;
                }

                if (id === 'historyPruneBtn') {

                    onPruneHistory();
                    return;
                }

                if (id === 'historyClearBtn') {

                    onClearHistory();
                    return;
                }

                // ดาวน์โหลดข้อมูล master เป็นไฟล์ Excel
                if (id === 'masterExportBtn') {

                    onExportMasterExcel();
                    return;
                }

                // เปิดกล่องเลือกไฟล์ Excel เพื่อนำเข้าข้อมูล master
                if (id === 'masterImportBtn') {

                    const importInput =
                        document.getElementById('masterImportInput');

                    if (importInput) {
                        importInput.click();
                    }

                    return;
                }

                const action =
                    target.dataset &&
                    target.dataset.action;

                const recordId =
                    Number(
                        target.dataset &&
                        target.dataset.id
                    );

                if (action === 'master-edit') {

                    onEditMaster(
                        recordId
                    );

                } else if (
                    action === 'master-delete'
                ) {

                    onDeleteMaster(
                        recordId
                    );

                } else if (action === 'word-edit') {

                    onEditWord(
                        recordId
                    );

                } else if (
                    action === 'word-delete'
                ) {

                    onDeleteWord(
                        recordId
                    );

                } else if (action === 'history-reuse') {

                    onReuseHistory(
                        recordId
                    );

                } else if (
                    action === 'history-delete'
                ) {

                    onDeleteHistory(
                        recordId
                    );

                } else if (action === 'load') {

                    onLoadTemplate(
                        recordId
                    );

                } else if (
                    action === 'delete'
                ) {

                    onDeleteTemplate(
                        recordId
                    );
                }
            }
        );

        // โฟกัสช่องในตาราง = เลือกช่องนั้นให้แถบจัดรูปแบบทำงานด้วย
        mainEl.addEventListener(
            'focusin',
            function (event) {

                const target =
                    event.target;

                if (
                    !target ||
                    !target.dataset ||
                    target.dataset.tableInput === undefined
                ) {
                    return;
                }

                const report =
                    getComponent(DEFAULT_PAGE);

                if (report.setActiveTableCell) {

                    report.setActiveTableCell(
                        target.dataset.tableInput,
                        Number(target.dataset.tableRow),
                        Number(target.dataset.tableCol)
                    );
                }
            }
        );

        // ลัดคีย์จัดรูปแบบช่องในตาราง: Ctrl+B = ตัวหนา, Ctrl+I = ตัวเอียง
        mainEl.addEventListener(
            'keydown',
            function (event) {

                const target =
                    event.target;

                if (
                    !target ||
                    !target.dataset ||
                    target.dataset.tableInput === undefined
                ) {
                    return;
                }

                const key =
                    String(
                        event.key || ''
                    ).toLowerCase();

                if (
                    !(event.ctrlKey || event.metaKey) ||
                    (key !== 'b' && key !== 'i')
                ) {
                    return;
                }

                event.preventDefault();

                const report =
                    getComponent(DEFAULT_PAGE);

                if (report.applyTableFormat) {

                    report.applyTableFormat(
                        target.dataset.tableInput,
                        key === 'b' ? 'bold' : 'italic'
                    );
                }
            }
        );
    }

    // ──────────────────────────────────────────────────────────────
    // Page Navigation
    // ──────────────────────────────────────────────────────────────
    function showPage(page) {

        // คลิก "Master" = เปิด/ปิด submenu เท่านั้น
        if (page === 'master') {

            scope.Sidebar.toggleMasterSubmenu();

            return;
        }

        if (!PAGE_COMPONENTS[page]) {
            return;
        }

        // คลิกเมนูย่อยแล้ว submenu ยังกางค้างไว้ (setActive จัดการให้เอง)
        scope.Sidebar.setActive(page);

        if (page === currentPage) {
            return;
        }

        currentPage = page;

        renderPage(page);

        applySuggestEnabled(
            readSuggestEnabled()
        );

        refreshTemplateList();
        refreshMasterList();
        refreshWordList();
        refreshHistory();
    }    // ──────────────────────────────────────────────────────────────
    // File / Template handlers
    // ──────────────────────────────────────────────────────────────

    // ระยะที่ชดเชยไป (cm ถ้าตัววัดวัดเป็น cm จริง, ไม่งั้นเป็นจำนวนช่อง)
    function describeDistance(distance) {

        if (!distance) {
            return '';
        }

        return distance.unit === 'cm'
            ? distance.value.toFixed(2) + ' ซม.'
            : distance.value + ' ช่อง';
    }

    function describeWarning(item) {

        return item.field + ' (' +
            (item.side === 'before' ? 'ช่องว่างด้านหน้า' : 'ช่องว่างด้านหลัง') +
            'ต้องลบ ' + item.needed + ' ช่อง แต่มี ' +
            item.available + ' ช่อง' +
            (item.missing ? ' คลาด ~' + describeDistance(item.missing) : '') +
            ')';
    }

    function describeApplied(item) {

        return item.field + ' (' +
            (item.side === 'before' ? 'ด้านหน้า' : 'ด้านหลัง') +
            (item.action === 'add' ? ' +' : ' -') +
            item.count + ' ช่อง' +
            (item.distance ? ' ≈ ' + describeDistance(item.distance) : '') +
            ')';
    }

    // แสดงผลการล็อกตำแหน่งหลังสร้างเอกสาร
    // - มีคำเตือน = ช่องว่างไม่พอให้ชดเชยตำแหน่ง (ระบบไม่ตัดข้อความผู้ใช้)
    // - มีรายการที่ชดเชยแล้ว = บอกว่าเพิ่ม/ลบช่องว่างไปเท่าไร (ผู้ใช้ตรวจสอบได้)
    function showReplaceResult(warnings, applied, approximate) {

        const el =
            document.getElementById(
                'replaceWarning'
            );

        if (!el) {
            return;
        }

        const failed =
            !!(warnings && warnings.length > 0);

        const parts = [];

        if (failed) {
            parts.push(
                'ล็อกตำแหน่งไม่สมบูรณ์: ' +
                warnings.map(describeWarning).join(' · ')
            );
        }

        if (applied && applied.length > 0) {
            parts.push(
                'ล็อกตำแหน่งแล้ว: ' +
                applied.map(describeApplied).join(' · ')
            );
        }

        if (approximate) {
            parts.push(
                'ไม่พบฟอนต์ของเอกสารในเครื่องนี้ ' +
                'จึงวัดตำแหน่งด้วยฟอนต์ใกล้เคียง'
            );
        }

        if (parts.length === 0) {

            el.textContent = '';
            el.style.display = 'none';
            return;
        }

        el.className =
            'replace-warning' +
            (failed ? '' : ' ok');

        el.textContent = parts.join(' ');
        el.style.display = 'block';
    }

    function clearReplaceWarnings() {

        const el =
            document.getElementById(
                'replaceWarning'
            );

        if (!el) {
            return;
        }

        el.className = 'replace-warning';
        el.textContent = '';
        el.style.display = 'none';
    }

    async function onFileChange(event) {

        // ใช้ <input type="file"> ทั้งใน browser และ Electron
        // (ห้ามเรียก API ที่ไม่มีใน preload เพราะจะทำให้โหลดไฟล์ไม่ได้)
        const file =
            event.target.files &&
            event.target.files[0];

        if (!file) {
            return;
        }

        try {

            const bytes =
                new Uint8Array(
                    await file.arrayBuffer()
                );

            const xml =
                await readDocumentXml(
                    bytes
                );

            state.docxBytes =
                bytes;

            state.xml =
                xml;

            state.fileName =
                file.name ||
                'document.docx';

            state.fields =
                scope.Extract.extractFields(
                    xml
                );

            state.loaded = true;

            state.templateId = null;

            clearPageState();

            getPageMeta(
                CONFIG_PAGE
            ).templateName =
                defaultTemplateName(
                    state.fileName
                );

            applyMeta(currentPage);

            fillForm(currentPage);

        } catch (error) {

            console.error(error);

            alert(
                error && error.expected
                    ? error.message
                    : 'ไม่สามารถอ่านไฟล์ DOCX ได้'
            );

            getComponent(
                currentPage
            ).resetFileInput();
        }
    }

    // ตารางของหน้ารายงาน (type = Table) — ไปคนละทางกับค่าปกติ
    // เพราะค่าของตารางไม่ใช่ข้อความ ต้องสร้างเป็นตาราง Word จริงใน replace.js
    function collectTables() {

        const component =
            getComponent(currentPage);

        return (
            component &&
            component.getTableValues
        )
            ? component.getTableValues()
            : {};
    }

    // ดูตัวอย่างข้อความในเอกสารก่อนดาวน์โหลด
    //
    // ตัวอย่างสร้างจาก xml ต้นฉบับ (แทน {{field}} เองในหน้าตัวอย่าง) จึงรู้ว่าค่าไหน
    // "ยังไม่ได้กรอก" ซึ่งเป็นสิ่งสำคัญที่สุดที่ต้องเห็นก่อนดาวน์โหลด
    // แต่ยังประมวลผล Replace จริงหนึ่งรอบ เพื่อรายงานผล "ล็อกตำแหน่ง" ให้เห็นก่อนด้วย
    function onPreview() {

        if (
            !state.loaded ||
            !state.xml
        ) {

            alert(
                'ยังไม่มีเอกสารให้ดูตัวอย่าง'
            );

            return;
        }

        const values =
            getComponent(
                currentPage
            ).getValues();

        const config =
            getComponent(
                CONFIG_PAGE
            );

        const locks =
            config &&
            config.getLocks
                ? config.getLocks()
                : null;

        const tables =
            collectTables();

        // รันจริงหนึ่งรอบ เพื่อให้ getWarnings/getApplied เป็นของค่าที่กรอกอยู่ตอนนี้
        scope.Replace.replaceFields(
            state.xml,
            values,
            locks,
            tables
        );

        const notes = [];

        const warnings =
            scope.Replace.getWarnings
                ? scope.Replace.getWarnings()
                : [];

        const applied =
            scope.Replace.getApplied
                ? scope.Replace.getApplied()
                : [];

        if (warnings.length > 0) {

            notes.push({
                kind: 'warn',
                text:
                    'ล็อกตำแหน่งไม่สมบูรณ์: ' +
                    warnings.map(describeWarning).join(' · ')
            });
        }

        if (applied.length > 0) {

            notes.push({
                kind: 'ok',
                text:
                    'ล็อกตำแหน่งแล้ว: ' +
                    applied.map(describeApplied).join(' · ')
            });
        }

        // ตารางของ field ที่ {{field}} ถูกวางไว้หลายย่อหน้า → เอกสารจะได้ตารางหลายอัน
        // (ผู้ใช้มักไม่รู้ตัวว่าวาง placeholder ซ้ำ จึงบอกจำนวนให้เห็นก่อนดาวน์โหลด)
        const fieldUsage =
            scope.Extract &&
            scope.Extract.countFields
                ? scope.Extract.countFields(state.xml)
                : {};

        Object.keys(tables).forEach(function (field) {

            const copies =
                fieldUsage[field] || 0;

            if (copies > 1) {

                notes.push({
                    kind: 'warn',
                    text:
                        'ตาราง "' + field + '" จะถูกใส่ในเอกสาร ' + copies + ' ที่ ' +
                        '({{' + field + '}} อยู่ใน ' + copies + ' ย่อหน้า) — ' +
                        'ถ้าต้องการที่เดียว ให้เหลือ {{' + field + '}} ไว้ที่เดียวใน template'
                });
            }
        });

        scope.PreviewDialog.open({
            // ใช้ชื่อไฟล์เต็ม (มี .docx) เพราะหัวเรื่องนี้คือ "ไฟล์ที่จะดาวน์โหลด"
            title:
                'ตัวอย่างเอกสาร — ' +
                templateOutputName() +
                '-filled.docx',
            xml:
                state.xml,
            values:
                values,
            tables:
                tables,
            notes:
                notes
        });
    }

    async function onDownload() {

        if (
            !state.loaded ||
            !state.docxBytes
        ) {

            alert(
                'ไม่มีเอกสารให้ดาวน์โหลด'
            );

            return;
        }

        const values =
            getComponent(
                currentPage
            ).getValues();

        // แทนค่าจาก xml ต้นฉบับ
        // และสร้าง zip ใหม่จาก byte ต้นฉบับ
        // → กดดาวน์โหลดซ้ำได้ค่าที่ถูกต้องเสมอ
        // field ที่ติ๊ก "ล็อกตำแหน่ง" ไว้ในหน้า Template Configuration
        const config =
            getComponent(
                CONFIG_PAGE
            );

        const locks =
            config &&
            config.getLocks
                ? config.getLocks()
                : null;

        const xml =
            scope.Replace.replaceFields(
                state.xml,
                values,
                locks,
                collectTables()
            );

        // ล็อกตำแหน่งได้ครบหรือไม่ + ปรับช่องว่างไปเท่าไร แจ้งบนหน้ารายงาน
        showReplaceResult(
            scope.Replace.getWarnings
                ? scope.Replace.getWarnings()
                : [],
            scope.Replace.getApplied
                ? scope.Replace.getApplied()
                : [],
            !!(textMeasurer && textMeasurer.approximate)
        );

        try {

            const zip =
                await JSZip.loadAsync(
                    state.docxBytes
                );

            zip.file(
                'word/document.xml',
                xml
            );

            const blob =
                await zip.generateAsync({
                    type: 'blob'
                });

            downloadBlob(
                blob,
                templateOutputName() +
                '-filled.docx'
            );

            // เก็บชุดค่าที่เพิ่งสร้างเอกสารไว้ให้กดใช้ซ้ำ (หน้า "ประวัติ")
            recordHistory();

        } catch (error) {

            console.error(error);

            alert(
                'ดาวน์โหลดไม่สำเร็จ'
            );
        }
    }

    // ดาวน์โหลดไฟล์ .docx ต้นฉบับของ template (ไฟล์ที่เก็บไว้ ยังไม่ถูกแทนค่า)
    async function onDownloadTemplate() {

        if (
            !state.loaded ||
            !state.docxBytes
        ) {

            alert(
                'ยังไม่มีไฟล์ template ให้ดาวน์โหลด'
            );

            return;
        }

        const fileName =
            state.fileName || 'template.docx';

        setDbStatus('กำลังดาวน์โหลด: ' + fileName);

        try {

            const blob =
                new Blob(
                    [state.docxBytes],
                    {
                        // MIME ของ Office Open XML (.docx)
                        type:
                            'application/vnd.openxmlformats-officedocument' +
                            '.wordprocessingml.document'
                    }
                );

            const result =
                await downloadBlob(blob, fileName);

            // Electron เท่านั้น: ผู้ใช้อาจกด Cancel ในกล่องบันทึกไฟล์
            if (result && result.ok === false) {

                throw new Error(
                    result.error ||
                    'บันทึกไฟล์ไม่สำเร็จ'
                );
            }

            if (result && result.canceled) {

                setDbStatus('ยกเลิกการดาวน์โหลด');
                return;
            }

            setDbStatus('ดาวน์โหลดไฟล์ต้นฉบับแล้ว: ' + fileName);

        } catch (error) {

            console.error(error);

            setDbStatus(
                'ดาวน์โหลดไม่สำเร็จ: ' + error.message,
                'error'
            );

            alert(
                'ดาวน์โหลดไม่สำเร็จ: ' + error.message
            );
        }
    }

    // อัปโหลดไฟล์ .docx ที่แก้ไขแล้วมาทับไฟล์ template เดิม
    // - ถ้าโหลด template จากฐานข้อมูลอยู่ = ทับไฟล์เดิมในฐานข้อมูลทันที
    // - ถ้ายังไม่เคยบันทึก = แค่เปลี่ยนไฟล์ในหน่วยความจำ แล้วให้กด Save Template
    // field ที่มีอยู่ทั้งไฟล์เดิมและไฟล์ใหม่จะเก็บค่า type / "ล็อกตำแหน่ง" ไว้
    async function onReplaceTemplateFile(event) {

        const input =
            event.target;

        const file =
            input.files &&
            input.files[0];

        // ล้างค่า input ทันที เพื่อให้เลือกไฟล์เดิมซ้ำได้ (และเมื่อกด Cancel ในกล่องยืนยัน)
        input.value = '';

        if (!file) {
            return;
        }

        const meta =
            getPageMeta(CONFIG_PAGE);

        const templateName =
            String(
                meta.templateName || ''
            ).trim() ||
            defaultTemplateName(
                state.fileName
            );

        const target =
            state.templateId
                ? 'template "' + templateName + '"'
                : 'ไฟล์ที่กำลังตั้งค่าอยู่';

        if (!window.confirm(
            'ยืนยันการแทนที่ไฟล์?\n\n' +
            'ไฟล์ต้นฉบับของ ' + target + ' จะถูกทับด้วย "' +
            (file.name || 'ไฟล์ใหม่') + '" ทันที\n' +
            'ค่า type และ "ล็อกตำแหน่ง" ของ field ที่มีอยู่ทั้งสองไฟล์จะถูกเก็บไว้\n' +
            'ต้องการดำเนินการต่อหรือไม่?'
        )) {
            return;
        }

        try {

            const bytes =
                new Uint8Array(
                    await file.arrayBuffer()
                );

            const xml =
                await readDocumentXml(
                    bytes
                );

            const fields =
                scope.Extract.extractFields(
                    xml
                );

            const present = {};

            fields.forEach(function (field) {
                present[field] = true;
            });

            state.docxBytes = bytes;
            state.xml = xml;
            state.fileName =
                file.name ||
                state.fileName ||
                'document.docx';
            state.fields = fields;
            state.loaded = true;

            // ทิ้งค่า type ของ field ที่ไม่มีอยู่ในไฟล์ใหม่แล้ว
            const configValues =
                getPageValues(CONFIG_PAGE);

            Object.keys(configValues).forEach(function (field) {
                if (!present[field]) {
                    delete configValues[field];
                }
            });

            // ทิ้งค่าล็อกตำแหน่งของ field ที่หายไปเช่นกัน
            const config =
                getComponent(CONFIG_PAGE);

            const locks =
                config.getLocks
                    ? config.getLocks()
                    : {};

            const keptLocks = {};

            Object.keys(locks).forEach(function (field) {
                if (present[field]) {
                    keptLocks[field] = true;
                }
            });

            config.setLocks(keptLocks);

            // ทิ้ง placeholder ของ field ที่หายไปเช่นกัน
            if (config.getPlaceholders && config.setPlaceholders) {

                const placeholders =
                    config.getPlaceholders();

                const keptPlaceholders = {};

                Object.keys(placeholders).forEach(function (field) {
                    if (present[field]) {
                        keptPlaceholders[field] = placeholders[field];
                    }
                });

                config.setPlaceholders(keptPlaceholders);
            }

            // ทิ้งโครงตารางของ field ที่หายไปจากไฟล์ใหม่ด้วย
            if (config.getTableSchemas && config.setTableSchemas) {

                const schemas =
                    config.getTableSchemas();

                const keptSchemas = {};

                Object.keys(schemas).forEach(function (field) {
                    if (present[field]) {
                        keptSchemas[field] = schemas[field];
                    }
                });

                config.setTableSchemas(keptSchemas);
            }

            fillForm(CONFIG_PAGE);

            if (state.templateId) {

                // บันทึกทับ record เดิม (onSaveTemplate อัปเดต state.templateId ให้)
                const saved =
                    await onSaveTemplate();

                // ถ้าบันทึกไม่สำเร็จ ไฟล์ในหน่วยความจำถูกแทนที่แล้ว
                // จึงบอกให้กด Save Template ซ้ำ (ไม่ทับข้อความ error ที่ onSaveTemplate แจ้งไว้)
                if (saved) {

                    setDbStatus(
                        'แทนที่ไฟล์ต้นฉบับแล้ว: ' + templateName
                    );
                }

            } else {

                setDbStatus(
                    'แทนที่ไฟล์ที่กำลังตั้งค่าแล้ว — กด Save Template เพื่อบันทึก'
                );
            }

        } catch (error) {

            console.error(error);

            alert(
                error && error.expected
                    ? error.message
                    : 'ไม่สามารถอ่านไฟล์ DOCX ได้'
            );
        }
    }

    async function onSaveTemplate() {

        if (
            !state.loaded ||
            !state.docxBytes
        ) {

            alert(
                'ยังไม่ได้เลือกไฟล์ template'
            );

            return false;
        }

        const config =
            getComponent(
                CONFIG_PAGE
            );

        const meta =
            getPageMeta(
                CONFIG_PAGE
            );

        // ว่างไว้ = ใช้ชื่อไฟล์ .docx แทน
        const name =
            String(
                meta.templateName || ''
            ).trim() ||
            defaultTemplateName(
                state.fileName
            );

        config.setSaveEnabled(false);

        setDbStatus(
            'กำลังบันทึก...'
        );

        try {

            await ensureDb();

            const types =
                config.getValues();

            const saved =
                await scope.Db.save({

                    id:
                        state.templateId,

                    name:
                        name,

                    fileName:
                        state.fileName,

                    docx:
                        state.docxBytes,

                    fields:
                        state.fields,

                    types:
                        types,

                    locks:
                        config.getLocks(),

                    placeholders:
                        config.getPlaceholders(),

                    // โครงตาราง (จำนวนคอลัมน์ / ชื่อหัวคอลัมน์)
                    // ของ field ที่เป็น type Table
                    tables:
                        config.getTableSchemas
                            ? config.getTableSchemas(types)
                            : {}

                });

            state.templateId =
                saved.id;

            meta.templateName =
                name;

            applyMeta(
                CONFIG_PAGE
            );

            setDbStatus(
                'บันทึกแล้ว: ' +
                name
            );

            await refreshTemplateList();

            return true;

        } catch (error) {

            console.error(error);

            setDbStatus(
                'บันทึกไม่สำเร็จ: ' +
                error.message,
                'error'
            );

            alert(
                'บันทึกไม่สำเร็จ: ' +
                error.message
            );

            return false;

        } finally {

            config.setSaveEnabled(
                state.loaded
            );
        }
    }

    // เลือก template จาก dropdown ในหน้ารายงาน
    function onSelectTemplate(value) {

        const recordId =
            Number(value);

        if (!recordId) {
            return;
        }

        onLoadTemplate(
            recordId
        );
    }

    async function onLoadTemplate(recordId) {

        if (!recordId) {
            return;
        }

        try {

            await ensureDb();

            const record =
                await scope.Db.get(
                    recordId
                );

            if (!record) {

                alert(
                    'ไม่พบ template นี้ (อาจถูกลบไปแล้ว)'
                );

                await refreshTemplateList();

                return;
            }

            const bytes =
                record.docx instanceof Uint8Array
                    ? record.docx
                    : new Uint8Array(
                        record.docx
                    );

            const xml =
                await readDocumentXml(
                    bytes
                );

            state.docxBytes =
                bytes;

            state.xml =
                xml;

            state.fileName =
                record.file_name ||
                'document.docx';

            state.fields =
                scope.Extract.extractFields(
                    xml
                );

            state.loaded = true;

            state.templateId =
                record.id;

            clearPageState();

            getPageMeta(
                CONFIG_PAGE
            ).templateName =
                record.name || '';

            // คืน type ที่บันทึกไว้กลับเข้า dropdown
            //
            // db-worker แปลง JSON เป็น object
            // ให้เรียบร้อยแล้ว
            const types =
                record.types || {};

            const configValues =
                getPageValues(
                    CONFIG_PAGE
                );

            Object.keys(types).forEach(
                function (field) {

                    configValues[field] =
                        types[field];
                }
            );

            // คืนสถานะ "ล็อกตำแหน่ง" ที่บันทึกไว้ใน template
            const config =
                getComponent(
                    CONFIG_PAGE
                );

            config.setLocks(
                record.locks
            );

            // คืน placeholder ที่บันทึกไว้ใน template
            if (config.setPlaceholders) {
                config.setPlaceholders(
                    record.placeholders
                );
            }

            // คืนโครงตารางที่บันทึกไว้ใน template
            if (config.setTableSchemas) {
                config.setTableSchemas(
                    record.tables
                );
            }

            applyMeta(
                currentPage
            );

            fillForm(
                currentPage
            );

            setDbStatus(
                'โหลด template แล้ว: ' +
                record.name
            );

            // ให้ dropdown ของหน้ารายงาน
            // แสดง template ที่เพิ่งโหลด
            if (templateRecords) {

                renderTemplateChoosers(
                    templateRecords
                );
            }

        } catch (error) {

            console.error(error);

            alert(
                'โหลด template ไม่สำเร็จ'
            );
        }
    }

    async function onDeleteTemplate(recordId) {

        if (!recordId) {
            return;
        }

        if (
            !window.confirm(
                'ต้องการลบ template นี้ใช่ไหม?'
            )
        ) {
            return;
        }

        try {

            await ensureDb();

            await scope.Db.remove(
                recordId
            );

            if (
                state.templateId === recordId
            ) {

                state.templateId =
                    null;
            }

            setDbStatus(
                'ลบ template แล้ว'
            );

            await refreshTemplateList();

        } catch (error) {

            console.error(error);

            alert(
                'ลบไม่สำเร็จ: ' +
                error.message
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Master Data handlers
    // ──────────────────────────────────────────────────────────────

    async function refreshMasterList() {

        // ข้ามการโหลดฐานข้อมูลถ้าหน้าปัจจุบันไม่มีที่แสดงรายการ master
        if (!document.getElementById('masterList')) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        try {

            const info =
                await ensureDb();

            masterRecords =
                await scope.Db.masterList();

            // สถานะของ ensureDb ถูกส่งตอนหน้าแรกเริ่มทำงาน จึงอาจไม่ถึงหน้านี้
            master.setDbStatus(
                'ฐานข้อมูล: SQLite — ' +
                (
                    info && info.dbPath
                        ? info.dbPath
                        : 'บันทึกถาวร'
                )
            );

            master.renderMasterList(
                masterRecords
            );

        } catch (error) {

            console.error(error);

            master.renderMasterList(
                [],
                'โหลดรายการไม่สำเร็จ: ' +
                error.message
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // คำแนะนำการเดาคำ (หน้า "คำแนะนำ" ในหมวด Master)
    // ──────────────────────────────────────────────────────────────

    // สวิตช์เปิด/ปิดการแนะนำคำ — ค่าติดตั้งของเครื่องนี้ (localStorage)
    function readSuggestEnabled() {

        try {

            const stored =
                window.localStorage.getItem(
                    SUGGEST_ENABLED_KEY
                );

            // ยังไม่เคยตั้งค่า = เปิดไว้ก่อน
            return stored === null ? true : stored === '1';

        } catch (error) {

            return true;
        }
    }

    function writeSuggestEnabled(enabled) {

        try {

            window.localStorage.setItem(
                SUGGEST_ENABLED_KEY,
                enabled ? '1' : '0'
            );

        } catch (error) {

            // เขียนไม่ได้ (เช่น โหมดส่วนตัว) ก็ใช้ค่าที่ตั้งไว้ในหน่วยความจำต่อ
        }
    }

    function applySuggestEnabled(enabled) {

        if (scope.WordSuggest) {
            scope.WordSuggest.setEnabled(enabled);
        }

        const page =
            getComponent(WORDS_PAGE);

        if (page && page.setSuggestEnabled) {
            page.setSuggestEnabled(enabled);
        }
    }

    function onToggleSuggest(enabled) {

        writeSuggestEnabled(enabled);
        applySuggestEnabled(enabled);
    }

    // โหลดคำที่เพิ่มเองจากฐานข้อมูล ให้ทั้งหน้า "คำแนะนำ" และ engine ที่แนะนำคำ
    // (เรียกตอนเริ่มแอปด้วย เพื่อให้หน้ารายงานใช้คำของเราได้ทันที)
    async function refreshWordList() {

        const page =
            getComponent(WORDS_PAGE);

        try {

            await ensureDb();

            wordRecords =
                await scope.Db.wordList();

            if (scope.WordSuggest) {

                scope.WordSuggest.setCustomWords(
                    wordRecords.map(function (record) {
                        return record.word;
                    })
                );
            }

            if (page.renderWordList) {
                page.renderWordList(wordRecords);
            }

            if (page.setStats && scope.WordSuggest) {

                page.setStats({
                    dictionary: scope.WordSuggest.dictionarySize(),
                    custom: wordRecords.length
                });
            }

        } catch (error) {

            console.error(error);

            if (page.renderWordList) {

                page.renderWordList(
                    [],
                    'โหลดรายการไม่สำเร็จ: ' + error.message
                );
            }
        }
    }

    async function onSaveWord() {

        const page =
            getComponent(WORDS_PAGE);

        const form =
            page.readForm();

        if (!form.word) {

            page.setFormStatus(
                'กรุณาระบุคำ',
                'error'
            );

            return;
        }

        page.setSaveEnabled(false);
        page.setFormStatus('กำลังบันทึก...');

        try {

            await ensureDb();

            await scope.Db.wordSave({
                id: form.id,
                word: form.word
            });

            page.resetForm();

            page.setFormStatus(
                (form.id ? 'แก้ไขคำแล้ว: ' : 'เพิ่มคำแล้ว: ') + form.word,
                'ok'
            );

            await refreshWordList();

        } catch (error) {

            console.error(error);

            page.setFormStatus(
                'บันทึกไม่สำเร็จ: ' + error.message,
                'error'
            );

        } finally {

            page.setSaveEnabled(true);
        }
    }

    function onEditWord(recordId) {

        const record =
            (wordRecords || []).find(function (item) {
                return item.id === recordId;
            });

        if (!record) {
            return;
        }

        getComponent(WORDS_PAGE).loadIntoForm(record);
    }

    function onCancelWordEdit() {

        const page =
            getComponent(WORDS_PAGE);

        page.resetForm();
        page.setFormStatus('');
    }

    async function onDeleteWord(recordId) {

        if (!recordId) {
            return;
        }

        if (
            !window.confirm(
                'ต้องการลบคำนี้ใช่ไหม?'
            )
        ) {
            return;
        }

        const page =
            getComponent(WORDS_PAGE);

        try {

            await ensureDb();

            await scope.Db.wordDelete(
                recordId
            );

            page.setFormStatus('ลบคำแล้ว', 'ok');

            await refreshWordList();

        } catch (error) {

            console.error(error);

            page.setFormStatus(
                'ลบไม่สำเร็จ: ' + error.message,
                'error'
            );
        }
    }

    // เพิ่มคำจาก popup แนะนำคำ (รายการ "เพิ่มคำนี้")
    // เรียกจาก suggestMenu.js — ไม่แก้ข้อความที่พิมพ์อยู่ จำนวนคำที่บันทึกต่างหาก
    async function addSuggestWord(word) {

        const text =
            String(word || '').trim();

        if (!text) {
            return;
        }

        const page =
            getComponent(WORDS_PAGE);

        try {

            await ensureDb();

            await scope.Db.wordSave({
                id: 0,
                word: text
            });

            page.setFormStatus(
                'เพิ่มคำแล้ว: ' + text,
                'ok'
            );

            await refreshWordList();

        } catch (error) {

            console.error(error);

            page.setFormStatus(
                'เพิ่มไม่สำเร็จ: ' + error.message,
                'error'
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ──────────────────────────────────────────────────────────────
    // ประวัติการกรอก (หน้า "ประวัติ" ในหมวด Master)
    //
    // ทุกครั้งที่กด Download ในหน้ารายงาน ชุดค่าที่กรอกจะถูกเก็บไว้ที่นี่
    // เพื่อกด "ใช้ซ้ำ" แล้วเติมทั้งฟอร์มกลับมา (แก้เฉพาะช่องที่เปลี่ยน)
    // เก็บในฐานข้อมูล SQLite เพราะเป็นข้อมูลที่ต้องอยู่ข้ามการเปิด/ปิดแอป
    // ──────────────────────────────────────────────────────────────

    // อายุการเก็บ (วัน) เป็นค่าติดตั้งของเครื่องนี้ จึงเก็บใน localStorage
    // 0 = ไม่จำกัดอายุ
    function readHistoryRetention() {

        try {

            const stored =
                window.localStorage.getItem(
                    HISTORY_RETENTION_KEY
                );

            if (stored === null) {
                return DEFAULT_HISTORY_RETENTION_DAYS;
            }

            const days = Number(stored);

            return Number.isFinite(days) && days >= 0
                ? days
                : DEFAULT_HISTORY_RETENTION_DAYS;

        } catch (error) {

            return DEFAULT_HISTORY_RETENTION_DAYS;
        }
    }

    function writeHistoryRetention(days) {

        try {

            window.localStorage.setItem(
                HISTORY_RETENTION_KEY,
                String(days)
            );

        } catch (error) {

            // เขียนไม่ได้ (เช่น โหมดส่วนตัว) ก็ใช้ค่าที่ตั้งไว้ในหน่วยความจำต่อ
        }
    }

    function describeRetention(days) {

        return days > 0
            ? 'เก็บไว้ ' + days + ' วัน'
            : 'ไม่จำกัดอายุ';
    }

    // โหลดประวัติมาแสดง — ให้ db-worker ลบรายการที่เก่ากว่ากำหนดไปด้วยในคำสั่งเดียว
    async function refreshHistory() {

        // ข้ามการโหลดฐานข้อมูลถ้าหน้าปัจจุบันไม่มีที่แสดงรายการ
        if (!document.getElementById('historyList')) {
            return;
        }

        const page =
            getComponent(HISTORY_PAGE);

        const days =
            readHistoryRetention();

        page.setRetention(days);

        try {

            await ensureDb();

            historyRecords =
                await scope.Db.historyList({
                    retentionDays: days
                });

            page.renderList(historyRecords);

            page.setStats(
                'เก็บประวัติ ' + describeRetention(days) +
                ' · ' + historyRecords.length + ' รายการ'
            );

            page.setDbStatus(
                'ฐานข้อมูล: SQLite — บันทึกถาวร'
            );

        } catch (error) {

            console.error(error);

            page.renderList(
                [],
                'โหลดประวัติไม่สำเร็จ: ' + error.message
            );
        }
    }

    // ล้างประวัติที่หมดอายุตั้งแต่เปิดแอป (ไม่ต้องรอให้ผู้ใช้เปิดหน้าประวัติ)
    async function pruneHistory() {

        const days =
            readHistoryRetention();

        if (!days) {
            return;
        }

        try {

            await ensureDb();

            await scope.Db.historyPrune({
                retentionDays: days
            });

        } catch (error) {

            console.error(error);
        }
    }

    // เก็บชุดค่าที่เพิ่งกด Download (เงียบ ๆ — ไม่รบกวนการดาวน์โหลด)
    // template ที่ยังไม่ถูกบันทึกไม่เก็บ เพราะเปิดกลับมาเติมค่าให้ไม่ได้
    async function recordHistory() {

        if (
            currentPage !== DEFAULT_PAGE ||
            !state.templateId
        ) {
            return;
        }

        const report =
            getComponent(DEFAULT_PAGE);

        if (!report || !report.getRawValues) {
            return;
        }

        // currency เก็บเป็นตัวเลขล้วน (getRawValues อ่านจาก dataset) จึงนำกลับมาเติมได้
        // ช่องที่เว้นว่างไม่ต้องเก็บ
        const raw =
            report.getRawValues();

        const values = {};

        Object.keys(raw).forEach(function (field) {

            const text =
                raw[field] === null ||
                raw[field] === undefined
                    ? ''
                    : String(raw[field]);

            if (text.trim() !== '') {
                values[field] = text;
            }
        });

        // ตารางเก็บทั้งโครงและแถวไว้ (ไม่ใช่ข้อความ) เพื่อกดใช้ซ้ำแล้วได้แถวเดิม
        if (report.getTableValues) {

            const tables =
                report.getTableValues();

            Object.keys(tables).forEach(function (field) {

                const rows = tables[field].rows || [];

                const filled = rows.some(function (row) {
                    return row.some(function (cell) {
                        return String(cell == null ? '' : cell).trim() !== '';
                    });
                });

                if (filled) {
                    values[field] = tables[field];
                }
            });
        }

        if (Object.keys(values).length === 0) {
            return;
        }

        try {

            await ensureDb();

            await scope.Db.historyAdd({

                templateId:
                    state.templateId,

                templateName:
                    getPageMeta(CONFIG_PAGE).templateName ||
                    state.fileName ||
                    '',

                values:
                    values,

                modes:
                    report.getCurrencyModes
                        ? report.getCurrencyModes()
                        : {},

                retentionDays:
                    readHistoryRetention()

            });

        } catch (error) {

            // เก็บประวัติไม่สำเร็จต้องไม่ทำให้การดาวน์โหลดล้มเหลว
            console.error(error);
        }
    }

    function onRetentionChange(value) {

        const days =
            Number(value) || 0;

        writeHistoryRetention(days);

        getComponent(HISTORY_PAGE).setRetention(days);

        refreshHistory();
    }

    // แจ้งผลบนหน้ารายงาน (ใช้พื้นที่เดียวกับคำเตือนล็อกตำแหน่ง)
    function showReportNotice(text) {

        const el =
            document.getElementById(
                'replaceWarning'
            );

        if (!el) {
            return;
        }

        el.className = 'replace-warning ok';
        el.textContent = text;
        el.style.display = 'block';
    }

    // เติมค่าจากประวัติกลับเข้าฟอร์มทั้งชุด
    // ลำดับสำคัญ: โหลด template (ได้ field + type ที่ถูกต้อง) → ตั้งโหมด currency
    // → ใส่ค่าลง pageValues ของหน้ารายงาน → สลับไปหน้ารายงานเพื่อวาดฟอร์ม
    async function onReuseHistory(recordId) {

        const record =
            (historyRecords || []).find(function (item) {
                return item.id === recordId;
            });

        if (!record) {
            return;
        }

        const page =
            getComponent(HISTORY_PAGE);

        if (!record.template_id) {

            page.setStatus(
                'รายการนี้ไม่ผูกกับ template ที่บันทึกไว้ จึงใช้ซ้ำไม่ได้',
                'error'
            );

            return;
        }

        page.setStatus('กำลังโหลด template...');

        try {

            await onLoadTemplate(
                record.template_id
            );

            // onLoadTemplate แจ้งเตือนเองแล้วถ้าโหลดไม่ได้
            if (
                Number(state.templateId) !==
                Number(record.template_id)
            ) {

                page.setStatus(
                    'โหลด template ของรายการนี้ไม่สำเร็จ',
                    'error'
                );

                return;
            }

            // ตั้งโหมดของช่อง currency ก่อน จะได้แสดงผลแบบเดียวกับตอนบันทึก
            const modes =
                record.modes || {};

            Object.keys(modes).forEach(function (field) {

                scope.FieldTypes.setCurrencyMode(
                    field,
                    modes[field]
                );
            });

            // เขียนทับค่าชุดเดิมของหน้ารายงาน (ไม่ใช่ต่อท้าย)
            const values =
                getPageValues(DEFAULT_PAGE);

            Object.keys(values).forEach(function (field) {
                delete values[field];
            });

            Object.assign(
                values,
                record.values || {}
            );

            showPage(DEFAULT_PAGE);

            // ให้ช่อง currency แสดงรูปแบบตามโหมดที่ตั้งไว้ (ค่าอยู่ใน dataset แล้ว)
            const report =
                getComponent(DEFAULT_PAGE);

            if (report.applyValues) {
                report.applyValues(values);
            }

            showReportNotice(
                'ใช้ซ้ำจากประวัติแล้ว: ' +
                (record.template_name || 'template') +
                ' — แก้ช่องที่เปลี่ยนแล้วกด Download ได้เลย'
            );

        } catch (error) {

            console.error(error);

            page.setStatus(
                'ใช้ซ้ำไม่สำเร็จ: ' + error.message,
                'error'
            );
        }
    }

    async function onDeleteHistory(recordId) {

        if (!recordId) {
            return;
        }

        if (
            !window.confirm(
                'ต้องการลบรายการนี้ใช่ไหม?'
            )
        ) {
            return;
        }

        const page =
            getComponent(HISTORY_PAGE);

        try {

            await ensureDb();

            await scope.Db.historyDelete(
                recordId
            );

            page.setStatus('ลบรายการแล้ว', 'ok');

            await refreshHistory();

        } catch (error) {

            console.error(error);

            page.setStatus(
                'ลบไม่สำเร็จ: ' + error.message,
                'error'
            );
        }
    }

    // ลบรายการที่เก่ากว่าอายุที่ตั้งไว้ด้วยมือ (นอกเหนือจากการลบอัตโนมัติ)
    async function onPruneHistory() {

        const page =
            getComponent(HISTORY_PAGE);

        const days =
            readHistoryRetention();

        page.setBusy(true);

        try {

            await ensureDb();

            const result =
                await scope.Db.historyPrune({
                    retentionDays: days
                });

            await refreshHistory();

            page.setStatus(
                days > 0
                    ? 'ลบรายการที่เก่ากว่า ' + days + ' วันแล้ว ' +
                        (result && result.deleted
                            ? result.deleted
                            : 0) + ' รายการ'
                    : 'ตั้งอายุการเก็บเป็น "ไม่จำกัดอายุ" อยู่ จึงไม่มีรายการที่หมดอายุ',
                'ok'
            );

        } catch (error) {

            console.error(error);

            page.setStatus(
                'ลบไม่สำเร็จ: ' + error.message,
                'error'
            );

        } finally {

            page.setBusy(false);
        }
    }

    async function onClearHistory() {

        const page =
            getComponent(HISTORY_PAGE);

        if (
            !window.confirm(
                'ต้องการล้างประวัติการกรอกทั้งหมดใช่ไหม?'
            )
        ) {
            return;
        }

        page.setBusy(true);

        try {

            await ensureDb();

            const result =
                await scope.Db.historyClear();

            await refreshHistory();

            page.setStatus(
                'ล้างประวัติแล้ว ' +
                (result && result.deleted
                    ? result.deleted
                    : 0) + ' รายการ',
                'ok'
            );

        } catch (error) {

            console.error(error);

            page.setStatus(
                'ล้างประวัติไม่สำเร็จ: ' + error.message,
                'error'
            );

        } finally {

            page.setBusy(false);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Master Data: นำเข้า / ส่งออก Excel
    // ──────────────────────────────────────────────────────────────

    function pad2(value) {
        return String(value).padStart(2, '0');
    }

    // ต่อท้ายชื่อไฟล์ด้วยวันที่ เพื่อไม่ให้ไฟล์ที่ดาวน์โหลดทับกันงง ๆ
    function dateStamp() {

        const now = new Date();

        return [
            now.getFullYear(),
            pad2(now.getMonth() + 1),
            pad2(now.getDate())
        ].join('-');
    }

    function normalizeHeaderCell(text) {

        return String(text === null || text === undefined ? '' : text)
            .trim()
            .toLowerCase()
            .replace(/[\s_\-]+/g, '');
    }

    function indexOfLabel(labels, accepted) {

        for (let i = 0; i < labels.length; i++) {
            if (accepted.indexOf(labels[i]) !== -1) return i;
        }

        return -1;
    }

    // แปลงแถวจากไฟล์ Excel เป็นรายการ master
    // - เจอหัวตารางใน 5 แถวแรก = ใช้ตำแหน่งคอลัมน์ตามหัวตารางนั้น
    // - ไม่เจอหัวตาราง = ใช้คอลัมน์ A = Code Group, B = Name
    function parseMasterRows(rows) {

        const list =
            Array.isArray(rows) ? rows : [];

        let codeIndex = 0;
        let nameIndex = 1;
        let start = 0;

        for (
            let i = 0;
            i < Math.min(list.length, 5);
            i++
        ) {

            const labels =
                (list[i] || []).map(normalizeHeaderCell);

            const codeAt =
                indexOfLabel(labels, MASTER_CODE_HEADERS);

            const nameAt =
                indexOfLabel(labels, MASTER_NAME_HEADERS);

            // เจออย่างน้อยหนึ่งคอลัมน์ที่รู้จัก = ถือว่าแถวนี้เป็นหัวตาราง
            if (codeAt === -1 && nameAt === -1) continue;

            if (codeAt !== -1) codeIndex = codeAt;
            if (nameAt !== -1) nameIndex = nameAt;

            start = i + 1;
            break;
        }

        const records = [];

        for (let i = start; i < list.length; i++) {

            const row = list[i] || [];

            const codeGroup =
                String(row[codeIndex] === undefined ? '' : row[codeIndex]).trim();

            const name =
                String(row[nameIndex] === undefined ? '' : row[nameIndex]).trim();

            // แถวว่างข้ามเงียบ ๆ ไม่ต้องนับเป็นรายการที่ผิดพลาด
            if (!codeGroup && !name) continue;

            records.push({
                codeGroup: codeGroup,
                name: name
            });
        }

        return records;
    }

    // สรุปผลนำเข้า: เพิ่มเท่าไร ข้ามเท่าไร เพราะอะไร
    function describeImportResult(result) {

        const parts = [
            'เพิ่ม ' + result.inserted + ' รายการ'
        ];

        if (result.skippedExisting > 0) {
            parts.push('มีอยู่ในระบบแล้ว ' + result.skippedExisting);
        }

        if (result.skippedDuplicate > 0) {
            parts.push('ซ้ำกันเองในไฟล์ ' + result.skippedDuplicate);
        }

        if (result.skippedInvalid > 0) {
            parts.push('ไม่ครบ Code Group/Name ' + result.skippedInvalid);
        }

        return 'นำเข้าสำเร็จ: ' + parts.join(' · ');
    }

    // ดาวน์โหลดข้อมูล master ทั้งหมดเป็น .xlsx
    // ตั้งใจให้ไฟล์ที่ได้นำกลับมาอัปโหลดได้เลย (มีหัวตาราง Code Group / Name)
    async function onExportMasterExcel() {

        const master =
            getComponent(MASTER_PAGE);

        master.setExcelBusy(true);
        master.setExcelStatus('กำลังสร้างไฟล์ Excel...');

        try {

            await ensureDb();

            // อ่านจากฐานข้อมูลตรง ๆ = ได้ข้อมูลทั้งหมด ล่าสุด
            // (ไม่ขึ้นกับคำค้นที่กรองอยู่ในรายการด้านล่าง)
            const list =
                await scope.Db.masterList();

            masterRecords = list;

            const rows = [
                ['Code Group', 'Name']
            ];

            list.forEach(function (record) {
                rows.push([
                    record.code_group || '',
                    record.name || ''
                ]);
            });

            const blob =
                await scope.Xlsx.createBlob(rows, 'Master Data');

            const fileName =
                'master-data-' + dateStamp() + '.xlsx';

            const result =
                await downloadBlob(blob, fileName);

            if (result && result.ok === false) {

                throw new Error(
                    result.error ||
                    'บันทึกไฟล์ไม่สำเร็จ'
                );
            }

            // Electron เท่านั้น: ผู้ใช้อาจกด Cancel ในกล่องบันทึกไฟล์
            if (result && result.canceled) {

                master.setExcelStatus('ยกเลิกการดาวน์โหลด');
                return;
            }

            master.setExcelStatus(
                'ดาวน์โหลด Excel แล้ว: ' + fileName +
                ' (' + list.length + ' รายการ)',
                'ok'
            );

        } catch (error) {

            console.error(error);

            master.setExcelStatus(
                'ดาวน์โหลดไม่สำเร็จ: ' + error.message,
                'error'
            );

        } finally {

            master.setExcelBusy(false);
        }
    }

    // นำเข้าข้อมูล master จากไฟล์ .xlsx
    // ระบบเพิ่มเฉพาะรายการที่ยังไม่มี ส่วนที่ซ้ำจะถูกข้าม (ดู handleMasterImport)
    async function onImportMasterExcel(event) {

        const input =
            event.target;

        const file =
            input.files &&
            input.files[0];

        // ล้างค่า input ทันที เพื่อให้เลือกไฟล์เดิมซ้ำได้
        input.value = '';

        if (!file) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        master.setExcelBusy(true);
        master.setExcelStatus(
            'กำลังอ่านไฟล์ ' + (file.name || '') + '...'
        );

        try {

            const bytes =
                new Uint8Array(
                    await file.arrayBuffer()
                );

            const rows =
                await scope.Xlsx.readRows(bytes);

            const list =
                parseMasterRows(rows);

            if (list.length === 0) {

                master.setExcelStatus(
                    'ไม่พบข้อมูลในไฟล์ — ต้องมีคอลัมน์ Code Group และ Name',
                    'error'
                );

                return;
            }

            if (!window.confirm(
                'พบ ' + list.length + ' แถวในไฟล์ "' +
                (file.name || '') + '"\n\n' +
                'ระบบจะเพิ่มเฉพาะรายการที่ยังไม่มี ' +
                'และข้ามรายการที่มีอยู่ในระบบแล้วหรือซ้ำกันในไฟล์\n' +
                'ต้องการนำเข้าหรือไม่?'
            )) {

                master.setExcelStatus('ยกเลิกการนำเข้า');
                return;
            }

            master.setExcelStatus('กำลังนำเข้า...');

            await ensureDb();

            const result =
                await scope.Db.masterImport({
                    rows: list
                });

            await refreshMasterList();

            master.setExcelStatus(
                describeImportResult(result),
                result.inserted > 0 ? 'ok' : 'warn'
            );

        } catch (error) {

            console.error(error);

            master.setExcelStatus(
                'นำเข้าไม่สำเร็จ: ' + error.message,
                'error'
            );

        } finally {

            master.setExcelBusy(false);
        }
    }

    function onCancelMasterEdit() {

        const master =
            getComponent(MASTER_PAGE);

        master.resetForm();
        master.setFormStatus('');
    }

    function onEditMaster(recordId) {

        const record =
            (masterRecords || []).find(
                function (item) {

                    return Number(item.id) ===
                        Number(recordId);
                }
            );

        if (!record) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        master.loadIntoForm(record);
        master.setFormStatus('');
    }

    async function onSaveMaster() {

        const master =
            getComponent(MASTER_PAGE);

        const payload =
            master.readForm();

        if (!payload.codeGroup) {

            master.setFormStatus(
                'กรุณาระบุ Code Group',
                'error'
            );

            return;
        }

        if (!payload.name) {

            master.setFormStatus(
                'กรุณาระบุ Name',
                'error'
            );

            return;
        }

        // id > 0 = แก้ไขรายการเดิม, id = 0 = เพิ่มรายการใหม่
        const editing =
            Number(payload.id) > 0;

        master.setSaveEnabled(false);
        master.setFormStatus('กำลังบันทึก...');

        try {

            await ensureDb();

            await scope.Db.masterSave(
                payload
            );

            master.resetForm();

            master.setFormStatus(
                editing
                    ? 'แก้ไขข้อมูลแล้ว'
                    : 'เพิ่มข้อมูลแล้ว',
                'ok'
            );

            await refreshMasterList();

        } catch (error) {

            console.error(error);

            master.setFormStatus(
                'บันทึกไม่สำเร็จ: ' +
                error.message,
                'error'
            );

        } finally {

            master.setSaveEnabled(true);
        }
    }

    async function onDeleteMaster(recordId) {

        if (!recordId) {
            return;
        }

        if (
            !window.confirm(
                'ต้องการลบข้อมูล Master นี้ใช่ไหม?'
            )
        ) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        try {

            await ensureDb();

            await scope.Db.masterDelete(
                recordId
            );

            // ถ้ารายการที่ถูกลบคือรายการที่กำลังแก้ไขอยู่ ให้ล้างฟอร์มทิ้ง
            const current =
                master.readForm();

            if (Number(current.id) === Number(recordId)) {

                master.resetForm();
            }

            master.setFormStatus(
                'ลบข้อมูลแล้ว',
                'ok'
            );

            await refreshMasterList();

        } catch (error) {

            console.error(error);

            alert(
                'ลบไม่สำเร็จ: ' +
                error.message
            );
        }
    }

    function resetAll() {

        state.docxBytes = null;
        state.xml = null;
        state.fields = [];
        state.loaded = false;
        state.fileName = '';
        state.templateId = null;

        clearPageState();

        getComponent(
            currentPage
        ).resetFileInput();

        applyMeta(
            currentPage
        );

        fillForm(
            currentPage
        );
    }

    // ──────────────────────────────────────────────────────────────
    // Boot
    // ──────────────────────────────────────────────────────────────
    function init() {

        mainEl =
            document.getElementById(
                'mainContent'
            );

        if (!mainEl) {

            console.error(
                'ไม่พบ element #mainContent'
            );

            return;
        }

        bindMainEvents();

        // ให้ replace.js วัดความกว้างข้อความจริง (ตามฟอนต์/ขนาดในเอกสาร)
        // ตำแหน่งที่ล็อกไว้จึงเทียบเป็นความกว้างจริง (cm) ไม่ใช่จำนวนตัวอักษร
        textMeasurer =
            scope.TextMeasure.createMeasurer();

        scope.Replace.setMeasurer(textMeasurer);

        scope.Sidebar.init();

        scope.Sidebar.setActive(
            DEFAULT_PAGE
        );

        // โหลดพจนานุกรมเข้าหน่วยความจำครั้งเดียว แล้วเปิด/ปิดตามค่าที่เคยตั้งไว้
        scope.WordSuggest.init();

        applySuggestEnabled(
            readSuggestEnabled()
        );

        renderPage(
            DEFAULT_PAGE
        );

        refreshTemplateList();

        // คำที่เพิ่มเองต้องพร้อมก่อนผู้ใช้เริ่มพิมพ์ในหน้ารายงาน
        refreshWordList();

        // ล้างประวัติที่เก่ากว่ากำหนดตั้งแต่เปิดแอป (ไม่ต้องรอเปิดหน้าประวัติ)
        pruneHistory();
    }

    if (
        document.readyState === 'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            init
        );

    } else {

        init();
    }

    // expose ให้ module อื่น
    // (sidebar) เรียกใช้
    scope.App = {

        showPage:
            showPage,

        // type ที่ตั้งค่าไว้ในหน้า
        // Template Configuration
        // (เก็บไว้ให้ส่วนอื่นใช้ต่อ)
        getFieldTypes:
            function () {

                return Object.assign(
                    {},
                    getPageValues(
                        CONFIG_PAGE
                    )
                );
            },

        // placeholder (ข้อความตัวอย่าง) ของแต่ละ field
        // ที่ตั้งไว้ในหน้า Template Configuration
        // หน้ารายงานนำไปใช้เป็นข้อความในช่องเปล่า
        getFieldPlaceholders:
            function () {

                const config =
                    getComponent(
                        CONFIG_PAGE
                    );

                return (
                    config &&
                    config.getPlaceholders
                )
                    ? config.getPlaceholders()
                    : {};
            },

        // จำนวนที่ {{field}} ถูกใช้ในเอกสาร (นับเป็นย่อหน้า)
        // หน้า Template Configuration ใช้เตือนเมื่อ placeholder ของตารางถูกวางไว้หลายที่
        // (ตารางจะถูกใส่ในเอกสารเท่าจำนวนที่วางไว้)
        getFieldUsage:
            function () {

                if (
                    !state.xml ||
                    !scope.Extract ||
                    !scope.Extract.countFields
                ) {

                    return {};
                }

                return scope.Extract.countFields(
                    state.xml
                );
            },

        // บันทึกคำที่ผู้ใช้เลือกจาก popup แนะนำคำ (รายการ "เพิ่มคำนี้")
        // suggestMenu.js เรียกเมื่อไม่มีคำในพจนานุกรมที่ตรงกับที่พิมพ์
        addSuggestWord:
            addSuggestWord
    };

})(window);

