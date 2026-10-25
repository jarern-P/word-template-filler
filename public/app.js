
// Main App - state, navigation และการประสานงานระหว่าง module
(function (scope) {
    'use strict';

    const DEFAULT_PAGE = 'report';
    const CONFIG_PAGE = 'template-config';
    const OCR_PAGE = 'ocr-config';
    const MASTER_PAGE = 'master-data';
    const WORDS_PAGE = 'word-suggest';
    const HISTORY_PAGE = 'history';
    const DATABASE_PAGE = 'database';

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
    const MASTER_SUBGROUP_HEADERS = ['subgroup', 'กลุ่มย่อย', 'รหัสกลุ่มย่อย'];
    const MASTER_NAME_HEADERS = ['name', 'ชื่อ', 'ชื่อข้อมูล'];

    // ชื่อหน้า -> ชื่อ component บน window (ลำดับโหลดอยู่ใน index.html)
    const PAGE_COMPONENTS = {
        'report': 'ReportPage',
        'template-config': 'TemplateConfigPage',
        'ocr-config': 'OcrConfigPage',
        'ocr-training': 'OcrTrainingPage',
        'master-data': 'MasterDataPage',
        'word-suggest': 'WordSuggestPage',
        'history': 'HistoryPage',
        'regex': 'RegexPage',
        'query': 'QueryPage',
        'database': 'DatabasePage'
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
    let masterGroups = null;      // cache กลุ่ม/กลุ่มย่อยของ master data ล่าสุด
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

        // ล้าง regex ที่ใช้ดึงข้อมูล (ปุ่ม "ข้อมูล")
        if (config && config.setPatterns) {
            config.setPatterns(null);
        }

        // ล้างโครงตารางที่ตั้งไว้ (type = Table)
        if (
            config &&
            config.setTableSchemas
        ) {
            config.setTableSchemas(null);
        }

        // ล้างชื่อกลุ่มและความยาวสูงสุดของ type List
        if (config && config.setListGroups) {
            config.setListGroups(null);
        }

        if (config && config.setListLimits) {
            config.setListLimits(null);
        }

        // ล้างแถวของตารางที่กรอกไว้ในหน้ารายงาน
        if (
            scope.ReportPage &&
            scope.ReportPage.resetTables
        ) {
            scope.ReportPage.resetTables();
        }

        // ล้างแถวของ type list ที่กรอกไว้ในหน้ารายงาน
        if (
            scope.ReportPage &&
            scope.ReportPage.resetLists
        ) {
            scope.ReportPage.resetLists();
        }

        // ล้างชุดข้อมูลที่นำเข้าจาก Excel (ผูกกับ template ที่โหลดอยู่)
        if (
            scope.ReportPage &&
            scope.ReportPage.clearImportedRows
        ) {
            scope.ReportPage.clearImportedRows();
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

    // ตัดอักขระที่ตั้งเป็นชื่อไฟล์บน Windows ไม่ได้ออก
    // พร้อมตัดช่องว่าง/จุดหัวท้าย และจำกัดความยาวไม่ให้เกินขีดจำกัดของ Windows
    function sanitizeFileName(name) {

        return String(name || '')
            // อักขระต้องห้ามบน Windows
            .replace(/[\\/:*?"<>|]+/g, '-')
            // ขึ้นบรรทัดใหม่ที่ผู้ใช้อาจพิมพ์ในช่องกรอก
            .replace(/[\r\n\t]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            // กันชื่อยาวเกินขีดจำกัดของ Windows (ชื่อไฟล์ + โฟลเดอร์)
            .slice(0, 120)
            .trim()
            // Windows ไม่ให้ชื่อไฟล์ลงท้ายด้วยจุดหรือช่องว่าง
            .replace(/[. ]+$/g, '');
    }

    // ชื่อแม่แบบที่ตั้ง/บันทึกไว้ ถ้ายังไม่มีจึงใช้ชื่อไฟล์ .docx ต้นฉบับ
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

        return sanitizeFileName(name) || 'document';
    }

    // ชื่อไฟล์ .docx ที่จะได้จากการดาวน์โหลด
    //   1. ชื่อเรื่อง (ค่าของ field "ชื่อเรื่อง" ที่กรอกในหน้ารายงาน)
    //   2. ชื่อแม่แบบที่ตั้ง/บันทึกไว้
    //   3. ชื่อไฟล์ .docx ต้นฉบับของแม่แบบ
    // เลข (1), (2) เมื่อชื่อซ้ำ เติมที่ฝั่ง main process ตอนเขียนไฟล์ (ดู file:save)
    function outputFileName(values) {

        const subject =
            sanitizeFileName(
                (values && values['ชื่อเรื่อง']) || ''
            );

        return (
            subject ||
            templateOutputName()
        ) + '.docx';
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

    // แจ้งผลการบันทึกไฟล์บนหน้ารายงาน (บรรทัดใต้ฟอร์ม)
    // element นี้มีเฉพาะหน้ารายงาน — หน้าอื่นใช้ setDbStatus ของตัวเอง
    function showDownloadStatus(text, kind) {

        const el =
            document.getElementById(
                'downloadStatus'
            );

        if (!el) {
            return;
        }

        el.textContent = text || '';

        el.className =
            'db-status' +
            (kind ? ' ' + kind : '');

        el.style.display =
            text ? '' : 'none';
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

    // ช่องกรอกที่เก็บค่าลง pageMeta ของหน้าปัจจุบัน ([data-persist])
    //
    // ต้องรวมช่องที่อยู่ในโมดัลของหน้าด้วย — PageModal.mount ย้าย .page-modal
    // ไปเกาะ <body> (หนี backdrop-filter ของ .main) ช่อง "ชื่อ แม่แบบ"
    // จึงไม่ใช่ลูกของ .mainContent อีก ค้นจาก mainEl อย่างเดียวจะไม่เจอ
    // แล้วชื่อแม่แบบที่โหลดมาแก้ไขไม่ถูกเติมกลับเข้าช่อง
    function persistFields() {

        const fields = [];

        if (mainEl) {

            mainEl
                .querySelectorAll('[data-persist]')
                .forEach(function (el) {

                    fields.push(el);
                });
        }

        document
            .querySelectorAll('.page-modal [data-persist]')
            .forEach(function (el) {

                fields.push(el);
            });

        return fields;
    }

    // เติมค่าใน [data-persist] ของหน้าปัจจุบันกลับจาก pageMeta
    function applyMeta(page) {

        const meta =
            getPageMeta(page);

        persistFields()
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

            if (component.showExcelButtons) {
                component.showExcelButtons(false);
            }

            if (component.showDataButton) {
                component.showDataButton(false);
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

        // ปุ่มนำเข้า/ส่งออก Excel ก็มีเฉพาะหน้ารายงาน
        if (component.showExcelButtons) {
            component.showExcelButtons(state.fields.length > 0);
        }

        // ปุ่ม "ใส่ข้อมูล" (regex) มีเฉพาะหน้ารายงาน
        if (component.showDataButton) {
            component.showDataButton(state.fields.length > 0);
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
            scope.PreviewDialog,
            scope.DataExtractDialog
        ].forEach(function (popup) {

            if (popup && popup.close) {
                popup.close();
            }
        });
    }

    function renderPage(page) {

        // โมดัลของหน้าเดิมถูกย้ายไปเกาะ <body> ไว้ (ดู PageModal.mount)
        // ต้องลบก่อนวาดหน้าใหม่ ไม่งั้น id ของโมดัลจะซ้ำกัน
        scope.PageModal.unmount();

        mainEl.innerHTML =
            getPageHTML(page);

        // โมดัลย้ายออกจาก .main เพราะ backdrop-filter ของ .main ทำให้
        // position: fixed ไปยึดกับกล่องของ .main (โมดัลไปโผล่ผิดที่)
        scope.PageModal.mount(mainEl);

        applyMeta(page);

        fillForm(page);

        // เปิดหน้าใหม่ = ล้างสถานะ disabled/readOnly ที่ค้างจากหน้าเดิมออก
        clearDisabledFields();

        // หน้าที่มี onShow (เช่น หน้าเครื่องมือ Regex) เตรียม UI หลังวาดหน้าเสร็จ
        const component = getComponent(page);

        if (component && component.onShow) {
            component.onShow();
        }
    }

    // เคลียร์ disabled/readOnly ของช่องกรอกทุกช่องในหน้าปัจจุบัน
    // (ไม่แตะปุ่ม — ปุ่มถูกเปิด/ปิดตามสถานะไฟล์ด้วย fillForm อยู่แล้ว)
    //
    // ช่องที่ component ตั้งใจปิดไว้จะติด data-keep-disabled / data-keep-readonly
    // จึงไม่ถูกล้างทิ้ง เช่น เลือกกลุ่มย่อยเมื่อยังไม่เลือกกลุ่ม,
    // ช่องเงินโหมดตัวหนังสือ (อ่านอย่างเดียวโดยตั้งใจ)
    function clearDisabledFields() {

        if (!mainEl) {
            return;
        }

        mainEl
            .querySelectorAll('input, select, textarea')
            .forEach(function (control) {

                if (control.dataset && control.dataset.keepDisabled === '1') {
                    return;
                }

                control.disabled = false;

                if (
                    control.readOnly &&
                    !(control.dataset && control.dataset.keepReadonly === '1')
                ) {
                    control.readOnly = false;
                }
            });
    }

    // ล้างสถานะ "ค้าง" ทั้งหมดที่ทับหรือปิดการพิมพ์ของฟอร์ม
    //
    //   - ปิด popup ที่ค้าง  (overlay เต็มจอจะบังช่องกรอก ทำให้กด/พิมพ์ไม่ได้)
    //   - ปลด disabled/readOnly ที่ค้างจากหน้า/การทำงานก่อนหน้า
    //
    // เรียกหลังทุกงานกับฐานข้อมูล (ลบ / นำเข้า / แทนที่ไฟล์ / บันทึก ฯลฯ)
    // เพื่อไม่ให้ handler ที่ไม่ผ่าน renderPage ทิ้งสถานะค้างไว้
    function resetInteractionState() {

        closeOpenPopups();
        clearDisabledFields();
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

    // เทียบชื่อแม่แบบแบบพจนานุกรม (ก-ฮ, A-Z)
    // ทำไมไม่เรียงใน SQL (`ORDER BY name`): SQLite เทียบทีละไบต์ของ UTF-8
    // พยัญชนะไทยจึงเรียงถูก แต่สระนำหน้า (เ แ โ ใ ไ) ซึ่งอยู่หลังพยัญชนะในรหัส
    // Unicode จะไปต่อท้ายทั้งหมด และตัวเลขเรียงแบบ 1, 10, 2
    // ตัวเทียบของ ICU (localeCompare 'th') เรียงให้ตรงตามที่คนอ่านคาดหวัง
    const templateNameCollator =
        new Intl.Collator(
            'th',
            { numeric: true, sensitivity: 'base' }
        );

    function byTemplateName(a, b) {

        return templateNameCollator.compare(
            String((a && a.name) || '').trim(),
            String((b && b.name) || '').trim()
        );
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

            // เรียงตามชื่อ (ตัวอักษร) ไม่ใช่เวลาสร้าง/อัปเดต
            // ตัวฐานข้อมูลยังส่งมาล่าสุดก่อน -> ชื่อซ้ำกัน (เช่น (สำเนา)) ล่าสุดอยู่บน
            templateRecords.sort(
                byTemplateName
            );

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

        // ── ช่องกรอกใน list ของหน้ารายงาน (type = List) ──
        // เก็บค่าของ field นั้น (list ที่อยู่กลุ่มเดียวกันแชร์เฉพาะจำนวนแถว)
        if (target.dataset.listInput !== undefined) {

            const report =
                getComponent(DEFAULT_PAGE);

            if (report.syncListInput) {

                report.syncListInput(
                    target.dataset.listInput,
                    Number(target.dataset.listRow),
                    target.value
                );
            }

            return;
        }

        // ── ความยาวสูงสุดของ type List (หน้า Template Configuration) ──
        if (target.dataset.listLimit !== undefined) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.setListLimit) {

                config.setListLimit(
                    target.dataset.listLimit,
                    target.value
                );
            }

            return;
        }

        // ── ชื่อกลุ่ม (Group) ของ type List (หน้า Template Configuration) ──
        if (target.dataset.listGroup !== undefined) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.setListGroup) {

                config.setListGroup(
                    target.dataset.listGroup,
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

    // ผูก event แบบ delegate ของ "พื้นที่ทำงาน" — ฟอร์มของหน้า + โมดัลฟอร์ม
    //
    // โมดัลฟอร์ม (.page-modal) ถูกย้ายไปเกาะ <body> ตอนวาดหน้า (PageModal.mount)
    // เพราะ .main มี backdrop-filter ทำให้ position: fixed ไปยึดกับกล่องของ .main
    // event จากช่อง/ปุ่มในโมดัลจึงไม่ bubble มาถึง mainEl อีก
    // จึงผูกที่ document แล้วกรองเฉพาะ event ที่มาจากใน mainEl หรือในโมดัลฟอร์ม
    // (ปุ่ม/ช่องของ sidebar และ popup ตัวอื่น เช่น app dialog / date picker /
    //  ลิสต์แนะนำคำ ไม่ถูกจับ)
    function bindDelegatedEvent(type, handler) {

        document.addEventListener(
            type,
            function (event) {

                const target =
                    event.target;

                if (
                    !target ||
                    !target.closest
                ) {
                    return;
                }

                if (
                    !mainEl.contains(target) &&
                    !target.closest('.page-modal')
                ) {
                    return;
                }

                handler(event);
            }
        );
    }

    function bindMainEvents() {

        // ช่องจำนวนเงินโหมดตัวหนังสือ: คลิก/โฟกัสแล้วกลับมาแก้ไขเป็นตัวเลขทันที
        bindDelegatedEvent(
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

        bindDelegatedEvent(
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

                // นำเข้าค่าตั้งของแม่แบบจากไฟล์ JSON (หน้า Template Configuration)
                if (
                    target &&
                    target.id === 'templateSettingsImportInput'
                ) {

                    onTemplateSettingsFileChosen(event);
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

                // นำเข้าข้อมูลหลายแถวของหน้ารายงาน (ไฟล์เดียว = หลายชุดค่า)
                if (
                    target &&
                    target.id === 'reportImportInput'
                ) {

                    onImportReportExcel(event);
                    return;
                }

                // นำเข้าไฟล์ฐานข้อมูลแทนที่ของเดิม (หน้าฐานข้อมูล)
                if (
                    target &&
                    target.id === 'databaseImportInput'
                ) {

                    const databasePage =
                        getComponent(DATABASE_PAGE);

                    if (
                        databasePage &&
                        databasePage.onImportFileChosen
                    ) {

                        databasePage.onImportFileChosen(
                            event
                        );
                    }

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

                // เปลี่ยนกลุ่มในฟอร์ม Master Data → เติมกลุ่มย่อยของกลุ่มใหม่
                if (
                    target &&
                    target.id === 'masterCodeGroup'
                ) {

                    getComponent(
                        MASTER_PAGE
                    ).setFormCodeGroup(
                        target.value
                    );

                    return;
                }

                // ตัวกรองกลุ่มในแถบค้นหาของหน้า Master Data → กรองรายการทันที
                if (
                    target &&
                    target.id === 'masterFilterGroup'
                ) {

                    getComponent(
                        MASTER_PAGE
                    ).setGroupFilter(
                        target.value
                    );

                    return;
                }

                // ตัวกรองกลุ่มย่อยในแถบค้นหาของหน้า Master Data → กรองรายการทันที
                if (
                    target &&
                    target.id === 'masterFilterSubgroup'
                ) {

                    getComponent(
                        MASTER_PAGE
                    ).setSubgroupFilter(
                        target.value
                    );

                    return;
                }

                captureValue(target);
            }
        );

        bindDelegatedEvent(
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

                // ช่องค้นหาของหน้า Word Suggest กรองรายการทันที
                if (
                    target &&
                    target.id === 'wordSearch'
                ) {

                    getComponent(
                        WORDS_PAGE
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

        bindDelegatedEvent(
            'click',
            function (event) {

                // ปิดโมดัลฟอร์ม (backdrop / ปุ่มปิด / ยกเลิก)
                const closeTrigger =
                    event.target.closest
                        ? event.target.closest('[data-modal-close]')
                        : null;

                if (closeTrigger) {

                    scope.PageModal.close(
                        closeTrigger.dataset.modalClose
                    );

                    return;
                }

                // เปิดโมดัลฟอร์ม (ปุ่ม "+ เพิ่ม..." ของแต่ละหน้า)
                const openTrigger =
                    event.target.closest
                        ? event.target.closest('[data-modal-open]')
                        : null;

                if (openTrigger) {

                    const modalComponent =
                        getComponent(currentPage);

                    // ให้หน้าเตรียมฟอร์มก่อนเปิด (เช่น ล้างค่าเดิม)
                    if (modalComponent && modalComponent.onModalOpen) {

                        modalComponent.onModalOpen(
                            openTrigger.dataset.modalOpen
                        );
                    }

                    scope.PageModal.open(
                        openTrigger.dataset.modalOpen
                    );

                    return;
                }

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

                // ปุ่มเพิ่มแถวของ type list (หน้ารายงาน)
                const addListRowBtn =
                    event.target.closest
                        ? event.target.closest('[data-list-add]')
                        : null;

                if (addListRowBtn) {

                    const report =
                        getComponent(DEFAULT_PAGE);

                    if (report.addListRow) {
                        report.addListRow(addListRowBtn.dataset.listAdd);
                    }

                    return;
                }

                // ปุ่มลบแถวของ type list (หน้ารายงาน)
                const removeListRowBtn =
                    event.target.closest
                        ? event.target.closest('[data-list-remove]')
                        : null;

                if (removeListRowBtn) {

                    const report =
                        getComponent(DEFAULT_PAGE);

                    if (report.removeListRow) {

                        report.removeListRow(
                            removeListRowBtn.dataset.listRemove,
                            Number(removeListRowBtn.dataset.listRow)
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

                // ปุ่มจัดรูปแบบหัวคอลัมน์ (หน้า Template Configuration)
                const headerFormatBtn =
                    event.target.closest
                        ? event.target.closest('[data-table-header-format]')
                        : null;

                if (headerFormatBtn) {

                    const config =
                        getComponent(CONFIG_PAGE);

                    if (config.applyTableHeaderFormat) {

                        config.applyTableHeaderFormat(
                            headerFormatBtn.dataset.tableHeaderField,
                            headerFormatBtn.dataset.tableHeaderFormat
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

                // ใส่ข้อมูลจากข้อความ/ไฟล์ด้วย regex (หน้ารายงาน)
                if (id === 'reportDataBtn') {

                    onOpenReportData();
                    return;
                }

                // แหล่งข้อมูล — กล่องวางข้อความ/อัปโหลด .docx/.pdf แล้วเติมลงฟอร์ม
                if (id === 'reportDataSourceBtn') {

                    onOpenReportData(true);
                    return;
                }

                // นำเข้า / ส่งออก Excel ของหน้ารายงาน
                if (id === 'reportExportBtn') {

                    onExportReportExcel();
                    return;
                }

                if (id === 'reportImportBtn') {

                    const reportImportInput =
                        document.getElementById('reportImportInput');

                    if (reportImportInput) {
                        reportImportInput.click();
                    }

                    return;
                }

                // เลื่อนดูชุดข้อมูลที่นำเข้าจาก Excel ทีละแถว
                if (id === 'reportRowPrevBtn') {

                    onReportRowStep(-1);
                    return;
                }

                if (id === 'reportRowNextBtn') {

                    onReportRowStep(1);
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

                // ส่งออกค่าตั้งของแม่แบบเป็น JSON (ไอคอนมุมบนขวาของหน้าแก้ไข)
                if (id === 'templateSettingsExportBtn') {

                    onExportTemplateSettings();
                    return;
                }

                // เปิดกล่องเลือกไฟล์ JSON เพื่อนำเข้าค่าตั้ง
                if (id === 'templateSettingsImportBtn') {

                    const settingsInput =
                        document.getElementById(
                            'templateSettingsImportInput'
                        );

                    if (settingsInput) {
                        settingsInput.click();
                    }

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

                // ดาวน์โหลดสำเนาไฟล์ฐานข้อมูล (หน้าฐานข้อมูล)
                if (id === 'databaseExportBtn') {

                    const databasePage =
                        getComponent(DATABASE_PAGE);

                    if (
                        databasePage &&
                        databasePage.exportDatabase
                    ) {

                        databasePage.exportDatabase();
                    }

                    return;
                }

                // เปิดกล่องเลือกไฟล์ฐานข้อมูลเพื่อนำเข้า (หน้าฐานข้อมูล)
                if (id === 'databaseImportBtn') {

                    const databasePage =
                        getComponent(DATABASE_PAGE);

                    if (
                        databasePage &&
                        databasePage.pickImportFile
                    ) {

                        databasePage.pickImportFile();
                    }

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

                // สลับไปโหมดตาราง (หน้า Master Data)
                if (id === 'masterTableViewBtn') {

                    const master =
                        getComponent(MASTER_PAGE);

                    if (master && master.setViewMode) {
                        master.setViewMode('table');
                    }
                    return;
                }

                // กลับไปดูรายการ (จากโหมดตาราง)
                if (id === 'masterListViewBtn') {

                    const master =
                        getComponent(MASTER_PAGE);

                    if (master && master.setViewMode) {
                        master.setViewMode('list');
                    }
                    return;
                }

                // เพิ่มแถวใหม่ในตาราง (โหมดตาราง)
                if (id === 'masterAddRowBtn') {

                    const master =
                        getComponent(MASTER_PAGE);

                    if (master && master.addPendingRow) {
                        master.addPendingRow();
                    }
                    return;
                }

                // บันทึกการเปลี่ยนแปลงจากตาราง (โหมดตาราง)
                if (id === 'masterTableSaveBtn') {

                    onSaveMasterTable();
                    return;
                }

                const action =
                    target.dataset &&
                    target.dataset.action;

                const recordId =
                    Number(
                        target.dataset &&
                        (target.dataset.id || target.dataset.rowId)
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

                } else if (
                    action === 'table-delete'
                ) {

                    // ลบแถวจากตาราง + ฐานข้อมูล
                    onDeleteMasterTableRow(
                        recordId
                    );

                } else if (
                    action === 'table-delete-pending'
                ) {

                    // ลบแถว pending (แถวใหม่ที่ยังไม่บันทึก)
                    const master =
                        getComponent(MASTER_PAGE);

                    if (master && master.deletePendingRow) {
                        master.deletePendingRow(recordId);
                    }

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

                } else if (action === 'group-add') {

                    onAddMasterGroup();

                } else if (action === 'group-rename') {

                    onRenameMasterGroup(
                        recordId,
                        target.dataset.name
                    );

                } else if (action === 'group-delete') {

                    onDeleteMasterGroup(
                        recordId
                    );

                } else if (action === 'subgroup-add') {

                    onAddMasterSubgroup(
                        recordId
                    );

                } else if (action === 'subgroup-rename') {

                    onRenameMasterSubgroup(
                        Number(target.dataset.groupId),
                        recordId,
                        target.dataset.name
                    );

                } else if (action === 'subgroup-delete') {

                    onDeleteMasterSubgroup(
                        recordId
                    );

                } else if (action === 'load') {

                    onLoadTemplate(
                        recordId
                    );

                } else if (action === 'layout') {

                    onOpenLayout(
                        recordId
                    );

                } else if (action === 'data') {

                    onOpenTemplateData(
                        recordId
                    );

                } else if (action === 'copy') {

                    onCopyTemplate(
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
        bindDelegatedEvent(
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

        // โฟกัสช่องชื่อหัวคอลัมน์ = เลือกคอลัมน์นั้นให้กล่องเครื่องมือทำงาน (หน้า Configuration)
        bindDelegatedEvent(
            'focusin',
            function (event) {

                const target =
                    event.target;

                if (
                    !target ||
                    !target.dataset ||
                    target.dataset.tableColumn === undefined
                ) {
                    return;
                }

                const config =
                    getComponent(CONFIG_PAGE);

                if (config.setActiveTableColumn) {

                    config.setActiveTableColumn(
                        target.dataset.tableColumn,
                        Number(target.dataset.tableColumnIndex)
                    );
                }
            }
        );

        // ลัดคีย์จัดรูปแบบช่องในตาราง: Ctrl+B = ตัวหนา, Ctrl+I = ตัวเอียง
        bindDelegatedEvent(
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

        // กด Enter ในช่องเพิ่มกลุ่ม/กลุ่มย่อย = เพิ่มเลย
        bindDelegatedEvent(
            'keydown',
            function (event) {

                if (event.key !== 'Enter') {
                    return;
                }

                const target =
                    event.target;

                if (!target || !target.dataset) {
                    return;
                }

                if (target.id === 'masterNewGroup') {

                    event.preventDefault();
                    onAddMasterGroup();
                    return;
                }

                if (target.dataset.subgroupInput !== undefined) {

                    event.preventDefault();

                    onAddMasterSubgroup(
                        Number(target.dataset.subgroupInput)
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
        refreshMasterGroups();
        refreshMasterList();
        refreshWordList();
        refreshHistory();
        refreshDatabaseInfo();
    }

    // หน้าฐานข้อมูล: แสดงตำแหน่ง/ขนาด/จำนวนข้อมูลของไฟล์ฐานข้อมูลจริง
    function refreshDatabaseInfo() {

        const component =
            getComponent(DATABASE_PAGE);

        if (
            component &&
            component.refresh
        ) {

            component.refresh();
        }
    }

    // ──────────────────────────────────────────────────────────────
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

            // อัปโหลดไฟล์ = ฟอร์มถูกวาดใหม่ ล้าง popup/สถานะค้างที่อาจบังช่องกรอก
            resetInteractionState();

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
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

    // รายการของหน้ารายงาน (type = List) — หลายข้อในตัวแปรเดียว
    // (list ที่ใช้ชื่อกลุ่มเดียวกันจะได้แถวชุดเดียวกันจากหน้า)
    function collectLists() {

        const component =
            getComponent(currentPage);

        return (
            component &&
            component.getListValues
        )
            ? component.getListValues()
            : {};
    }

    // ดูตัวอย่างข้อความในเอกสารก่อนดาวน์โหลด
    //
    // ตัวอย่างสร้างจาก xml ต้นฉบับ (แทน {{field}} เองในหน้าตัวอย่าง) จึงรู้ว่าค่าไหน
    // "ยังไม่ได้กรอก" ซึ่งเป็นสิ่งสำคัญที่สุดที่ต้องเห็นก่อนดาวน์โหลด
    // แต่ยังประมวลผล Replace จริงหนึ่งรอบ เพื่อรายงานผล "ล็อกตำแหน่ง" ให้เห็นก่อนด้วย
    // สวิตช์ "ไฮไลต์ตัวแปรเป็นสีเหลือง" บนหน้ารายงาน
    // = ใส่ w:highlight สีเหลืองที่ข้อความที่ถูกแทนที่ค่า ในไฟล์ .docx ผลลัพธ์
    function fieldHighlightOn() {

        const component = getComponent(currentPage);

        return !!(
            component &&
            component.getFieldHighlight &&
            component.getFieldHighlight()
        );
    }

    // ──────────────────────────────────────────────────────────────
    // ใส่ข้อมูลด้วย regex (หน้ารายงาน → ปุ่ม "ใส่ข้อมูล")
    //
    // เปิดกล่องให้วางข้อความ หรืออัปโหลด .docx / .pdf แล้วจับค่าของแต่ละ field
    // ด้วย regex ที่บันทึกไว้กับแม่แบบ (ตั้งค่าได้ที่หน้า "ตั้งค่าแม่แบบ"
    // → ปุ่ม "ข้อมูล" ของรายการแม่แบบ)
    // ──────────────────────────────────────────────────────────────
    async function onOpenReportData(sourceOnly) {

        if (
            !state.loaded ||
            state.fields.length === 0
        ) {

            await scope.AppDialog.alert(
                'ยังไม่มี template ให้ใส่ข้อมูล'
            );

            return;
        }

        scope.DataExtractDialog.open({

            // 'source' = กล่อง "แหล่งข้อมูล" (เฉพาะช่องวางข้อความ/อัปโหลดไฟล์
            // แล้วกดตกลงเพื่อเติมลงฟอร์มทันที)
            mode: sourceOnly ? 'source' : 'report',

            title: sourceOnly ? 'แหล่งข้อมูล' : 'ใส่ข้อมูลลงฟอร์ม',

            templateName:
                getPageMeta(CONFIG_PAGE).templateName ||
                state.fileName,

            fields: state.fields,

            // type ของ field เก็บไว้ใน state ของหน้า config
            // (ตอนอยู่หน้ารายงาน #form เป็นฟอร์มของหน้ารายงาน อ่านจาก DOM ไม่ได้)
            types: scope.App.getFieldTypes(),

            patterns: scope.App.getFieldPatterns(),

            // list ที่อยู่กลุ่มเดียวกัน = แถวเดียวหลายคอลัมน์
            // regex ของแต่ละ field ใช้วงเล็บตามลำดับคอลัมน์
            listGroups: scope.App.getListGroups(),

            onFill: function (values, result) {

                const report =
                    getComponent(DEFAULT_PAGE);

                // ค่าธรรมดาเก็บลง pageValues ด้วย เพื่ออยู่ต่อเมื่อสลับหน้า
                const plain = {};

                Object.keys(values).forEach(function (field) {
                    if (typeof values[field] === 'string') {
                        plain[field] = values[field];
                    }
                });

                Object.assign(
                    getPageValues(DEFAULT_PAGE),
                    plain
                );

                if (report.applyExtractedValues) {
                    report.applyExtractedValues(values);
                }

                clearReplaceWarnings();

                showDownloadStatus(
                    'เติมข้อมูลจาก regex แล้ว: ' +
                    result.matched.length +
                    ' field' +
                    (result.unmatched.length > 0
                        ? ' (ไม่พบ ' + result.unmatched.length + ' field)'
                        : '')
                );
            }
        });
    }

    async function onPreview() {

        if (
            !state.loaded ||
            !state.xml
        ) {

            await scope.AppDialog.alert(
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

        // รายการ (type List) — แสดงเป็นหลายบรรทัดในตัวอย่าง โดยคั่นด้วยขึ้นบรรทัดใหม่
        const lists =
            collectLists();

        const previewValues =
            Object.assign({}, values);

        Object.keys(lists).forEach(function (field) {

            const items =
                (lists[field] && lists[field].items) || [];

            // ตัวอย่างต้องตัดบรรทัดด้วยกฎเดียวกับตอนสร้าง docx
            previewValues[field] = scope.Replace.wrapListItems
                ? scope.Replace.wrapListItems(items, lists[field].maxChars).join('\n')
                : items.join('\n');
        });

        // รันจริงหนึ่งรอบ เพื่อให้ getWarnings/getApplied เป็นของค่าที่กรอกอยู่ตอนนี้
        scope.Replace.replaceFields(
            state.xml,
            values,
            locks,
            tables,
            fieldHighlightOn(),
            lists
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
            // ชื่อเดียวกับไฟล์ที่จะได้ตอนกดดาวน์โหลด
            // (เลข (1) เมื่อชื่อซ้ำ จะรู้ตอนเขียนไฟล์จริง จึงไม่แสดงที่นี่)
            title:
                'ตัวอย่างเอกสาร — ' +
                outputFileName(values),
            xml:
                state.xml,
            values:
                previewValues,
            tables:
                tables,
            notes:
                notes
        });
    }

    // ──────────────────────────────────────────────────────────────
    // หน้ารายงาน: นำเข้า / ส่งออก Excel
    //
    // ไฟล์ Excel ใช้ 1 คอลัมน์ = 1 field ใน template (แถวแรกเป็นชื่อ field)
    // ผู้ใช้กรอกนอกแอปได้หลายแถว แต่ละแถว = หนึ่งชุดค่า → กด Download ทีเดียวได้แถวละไฟล์
    // field ชนิดตาราง (Table) ไม่อยู่ในไฟล์ เพราะค่าของตารางไม่ใช่ข้อความ
    // (ค่าตารางที่กรอกในฟอร์มถูกใช้เหมือนกันทุกชุด)
    // ──────────────────────────────────────────────────────────────

    // field ที่ใส่ในไฟล์ Excel ได้ = ทุก field ที่ไม่ใช่ตาราง
    function reportExcelFields() {

        const types =
            scope.App.getFieldTypes();

        const placeholders =
            scope.App.getFieldPlaceholders();

        // header ของ checkbox ใน Excel ใช้ชื่อฟิลด์ + placeholder
        // (อัปโหลดกลับแล้วแมปคอลัมน์ได้จากชื่อฟิลด์)
        return state.fields.filter(function (field) {
            return types[field] !== 'table' && types[field] !== 'list';
        }).map(function (field) {

            // checkbox: ใช้ "ชื่อฟิลด์ + placeholder" เป็นหัวคอลัมน์ในไฟล์ส่งออก
            if (types[field] === 'checkbox') {

                const ph =
                    placeholders && placeholders[field] != null
                        ? String(placeholders[field]).trim()
                        : '';

                return ph ? (field + ' (' + ph + ')') : field;
            }

            return field;
        });
    }

    // แถวทั้งหมดของไฟล์ Excel ที่จะส่งออก
    // แถวแรก = ชื่อ field | แถวถัดไป = ค่าดิบ (เติมกลับเข้าฟอร์มได้ตรง ๆ)
    function reportExcelRows(report) {

        const fields =
            reportExcelFields();

        const rows = [fields.slice()];

        // มีชุดข้อมูลที่นำเข้าอยู่ = ส่งออกทุกแถว (แก้ต่อใน Excel แล้วอัปโหลดกลับได้เลย)
        if (
            report.getImportedRows &&
            report.getImportedRows().length > 1
        ) {

            if (report.syncImportedRow) {
                report.syncImportedRow();
            }

            report.getImportedRows().forEach(function (row) {

                rows.push(
                    fields.map(function (field) {
                        return row[field] == null ? '' : String(row[field]);
                    })
                );
            });

            return rows;
        }

        // ไม่มี = ส่งออกค่าที่กรอกอยู่ในฟอร์มเป็นแถวเดียว
        const raw =
            report.getRawValues();

        rows.push(
            fields.map(function (field) {
                return raw[field] == null ? '' : String(raw[field]);
            })
        );

        return rows;
    }

    // อ่านแถวจากไฟล์ Excel ของหน้ารายงาน    // แถวแรก (หรือแถวแรกที่เจอชื่อ field) = คอลัมน์ | คอลัมน์ที่ไม่ตรงกับ field ใดถูกข้าม
    function parseReportRows(rows, fields) {

        const list =
            Array.isArray(rows) ? rows : [];

        const types =
            scope.App.getFieldTypes();

        const byHeader = {};

        fields.forEach(function (field) {
            byHeader[normalizeHeaderCell(field)] = field;
        });

        let headerIndex = 0;

        let columns = null;

        let unknown = 0;

        for (let i = 0; i < Math.min(list.length, 5); i++) {

            const labels =
                (list[i] || []).map(normalizeHeaderCell);

            let matched = 0;
            let skipped = 0;

            const mapped =
                labels.map(function (label) {

                    if (
                        label !== '' &&
                        Object.prototype.hasOwnProperty.call(byHeader, label)
                    ) {
                        matched++;
                        return byHeader[label];
                    }

                    if (label !== '') skipped++;
                    return '';
                });

            if (matched === 0) continue;

            headerIndex = i;
            columns = mapped;
            unknown = skipped;
            break;
        }

        if (!columns) {
            return { values: [], unknown: 0 };
        }

        const values = [];

        for (let i = headerIndex + 1; i < list.length; i++) {

            const row = list[i] || [];
            const value = {};
            let filled = false;

            columns.forEach(function (field, col) {

                if (!field) return;

                let text =
                    row[col] == null ? '' : String(row[col]);

                // checkbox: หัวคอลัมน์ในไฟล์ Excel ใช้ชื่อฟิลด์ + placeholder
                // จึงต้องตัด placeholder ออกก่อนตรวจว่าเป็นคอลัมน์ของ checkbox หรือไม่
                // อ่านค่าเป็นตัวเลข/ข้อความโดยไม่ตัดอะไรก่อน (ค่าจะถูกส่งให้ฟอร์มเป็น true/false ทีหลัง)
                const baseField = field.replace(/\s*\([^)]*\)\s*/g, '').trim();
                if (
                    types[baseField] === 'checkbox' &&
                    (text.trim().toLowerCase() === 'x' || text.trim().toUpperCase() === 'X')
                ) {
                    text = 'true';
                }

                value[baseField] = text;

                if (text.trim() !== '') filled = true;
            });

            // แถวว่างทั้งแถวข้าม (Excel มักมีแถวเปล่าต่อท้าย)
            if (!filled) continue;

            values.push(value);
        }

        return { values: values, unknown: unknown };
    }

    // สรุปผลนำเข้าข้อมูลหลายแถวของหน้ารายงาน
    function describeReportImport(parsed) {

        const parts = [
            'นำเข้าสำเร็จ ' + parsed.values.length + ' แถว'
        ];

        if (parsed.values.length > 1) {
            parts.push(
                'กด Download DOCX ครั้งเดียวจะได้ ' + parsed.values.length + ' ไฟล์'
            );
        }

        if (parsed.unknown > 0) {
            parts.push('ข้ามคอลัมน์ที่ไม่ตรงกับ field ' + parsed.unknown + ' คอลัมน์');
        }

        return parts.join(' · ');
    }

    // ดาวน์โหลดไฟล์ Excel ของหน้ารายงาน (field เป็นคอลัมน์)
    // ตั้งใจให้ไฟล์ที่ได้เติมหลายแถวแล้วอัปโหลดกลับได้เลย
    async function onExportReportExcel() {

        if (!state.loaded) {

            await scope.AppDialog.alert(
                'ยังไม่มี template — เลือก template ก่อนดาวน์โหลด Excel'
            );

            return;
        }

        const report =
            getComponent(DEFAULT_PAGE);

        const excelRows =
            reportExcelRows(report);

        if (excelRows[0].length === 0) {

            await scope.AppDialog.alert(
                'template นี้ไม่มี field ที่ใส่ใน Excel ได้'
            );

            return;
        }

        showDownloadStatus('กำลังสร้างไฟล์ Excel...');

        try {

            const blob =
                await scope.Xlsx.createBlob(excelRows, 'Report');

            const fileName =
                templateOutputName() + '-' + dateStamp() + '.xlsx';

            const result =
                await downloadBlob(blob, fileName);

            if (result && result.ok === false) {

                throw new Error(
                    result.error ||
                    'บันทึกไฟล์ไม่สำเร็จ'
                );
            }

            if (result && result.canceled) {

                showDownloadStatus('ยกเลิกการดาวน์โหลด');
                return;
            }

            showDownloadStatus(
                'ดาวน์โหลด Excel แล้ว: ' +
                (result && result.fileName ? result.fileName : fileName) +
                '  (' + (excelRows.length - 1) + ' แถว)',
                'ok'
            );

        } catch (error) {

            console.error(error);

            showDownloadStatus(
                'ดาวน์โหลด Excel ไม่สำเร็จ: ' + error.message,
                'error'
            );
        }
    }

    // นำเข้าข้อมูลหลายแถวจากไฟล์ .xlsx ของหน้ารายงาน
    // แถวแรกจะถูกเติมเข้าฟอร์มให้ตรวจ และกด Download ครั้งเดียวได้ทุกแถว
    async function onImportReportExcel(event) {

        const input =
            event.target;

        const file =
            input.files && input.files[0];

        // ล้างค่า input ทันที เพื่อให้เลือกไฟล์เดิมซ้ำได้
        input.value = '';

        if (!file) {
            return;
        }

        if (!state.loaded) {

            await scope.AppDialog.alert(
                'ยังไม่มี template — เลือก template ก่อนอัปโหลด Excel'
            );

            return;
        }

        const report =
            getComponent(DEFAULT_PAGE);

        showDownloadStatus(
            'กำลังอ่านไฟล์ ' + (file.name || '') + '...'
        );

        try {

            const bytes =
                new Uint8Array(
                    await file.arrayBuffer()
                );

            const rows =
                await scope.Xlsx.readRows(bytes);

            const parsed =
                parseReportRows(rows, reportExcelFields());
            if (parsed.values.length === 0) {

                showDownloadStatus(
                    'ไม่พบข้อมูลในไฟล์ — แถวแรกต้องเป็นชื่อ field ' +
                    'ให้ตรงกับ template',
                    'error'
                );

                return;
            }

            // ฟอร์มมีค่าอยู่ = ถามก่อน กันอัปโหลดผิดไฟล์แล้วค่าที่กรอกหาย
            const current =
                report.getRawValues();

            const hasData =
                Object.keys(current).some(function (field) {

                    const text =
                        current[field] == null
                            ? ''
                            : String(current[field]);

                    return text.trim() !== '';
                });

            if (hasData) {

                const ok =
                    await scope.AppDialog.confirm(
                        'พบ ' + parsed.values.length + ' แถวในไฟล์ "' +
                        (file.name || '') + '"\n\n' +
                        'ค่าที่กรอกอยู่ในฟอร์มจะถูกแทนด้วยแถวแรกของไฟล์\n' +
                        'ต้องการนำเข้าหรือไม่?',
                        { title: 'ยืนยันการนำเข้า Excel', okText: 'นำเข้า' }
                    );

                if (!ok) {
                    showDownloadStatus('ยกเลิกการนำเข้า');
                    return;
                }
            }

            report.setImportedRows(parsed.values);

            showDownloadStatus(
                describeReportImport(parsed),
                'ok'
            );

        } catch (error) {

            console.error(error);

            showDownloadStatus(
                'นำเข้าไม่สำเร็จ: ' + error.message,
                'error'
            );
        }
    }

    // เลื่อนดูชุดข้อมูลที่นำเข้าจาก Excel ทีละแถว
    // (ค่าที่แก้ในฟอร์มถูกเก็บกลับเข้าแถวเดิมก่อนเปลี่ยนทุกครั้ง)
    function onReportRowStep(step) {

        const report =
            getComponent(DEFAULT_PAGE);

        if (!report || !report.goToImportedRow) {
            return;
        }

        report.goToImportedRow(
            report.getImportedIndex() + step
        );
    }

    // ชุดค่าที่จะสร้างไฟล์ .docx
    // ปกติ 1 ชุด (ค่าที่กรอกในฟอร์ม) — ถ้ามีชุดข้อมูลที่นำเข้าตั้งแต่ 2 แถวขึ้นไป
    // จะได้ทุกแถว (แถวละไฟล์) ตอนกด Download ครั้งเดียว
    function collectDownloadBatches(component) {

        if (
            component &&
            component.getImportedRows &&
            component.getImportedRows().length > 1 &&
            component.formatImportedRow
        ) {

            // เก็บค่าที่แก้ในฟอร์มของแถวที่แสดงอยู่กลับก่อน (ผู้ใช้อาจแก้หลังอัปโหลด)
            if (component.syncImportedRow) {
                component.syncImportedRow();
            }

            return component.getImportedRows().map(function (_, index) {
                return component.formatImportedRow(index);
            });
        }

        return [
            component.getValues()
        ];
    }

    // ข้อความสรุปผลการดาวน์โหลด (1 ไฟล์ หรือหลายไฟล์จากการนำเข้า Excel)
    function describeDownload(names) {

        if (names.length <= 1) {

            return (
                'ดาวน์โหลดแล้ว: ' + (names[0] || '') +
                '  (โฟลเดอร์ Downloads)'
            );
        }

        const shown =
            names.slice(0, 3);

        const more =
            names.length - shown.length;

        return (
            'ดาวน์โหลดแล้ว ' + names.length + ' ไฟล์: ' +
            shown.join(', ') +
            (more > 0 ? ' และอีก ' + more + ' ไฟล์' : '') +
            '  (โฟลเดอร์ Downloads)'
        );
    }

    async function onDownload() {

        if (
            !state.loaded ||
            !state.docxBytes
        ) {

            await scope.AppDialog.alert(
                'ไม่มีเอกสารให้ดาวน์โหลด'
            );

            return;
        }

        const component =
            getComponent(currentPage);

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

        // 1 ชุด = 1 ไฟล์ (นำเข้าหลายแถวจาก Excel แล้วกดครั้งเดียว = ได้ทุกแถว)
        const batches =
            collectDownloadBatches(component);

        try {

            const zip =
                await JSZip.loadAsync(
                    state.docxBytes
                );

            const saved = [];

            for (
                let index = 0;
                index < batches.length;
                index++
            ) {

                const values =
                    batches[index];

                // แทนค่าจาก xml ต้นฉบับ แล้วเขียนทับใน zip เดียวกัน (generate ใหม่ต่อแถว)
                // → กดดาวน์โหลดซ้ำได้ค่าที่ถูกต้องเสมอ
                const xml =
                    scope.Replace.replaceFields(
                        state.xml,
                        values,
                        locks,
                        collectTables(),
                        fieldHighlightOn(),
                        collectLists()
                    );

                // ล็อกตำแหน่งได้ครบหรือไม่ + ปรับช่องว่างไปเท่าไร แจ้งบนหน้ารายงาน
                // (รายงานจากแถวแรกที่สร้าง — พอเห็นว่าล็อกได้ครบไหม)
                if (index === 0) {

                    showReplaceResult(
                        scope.Replace.getWarnings
                            ? scope.Replace.getWarnings()
                            : [],
                        scope.Replace.getApplied
                            ? scope.Replace.getApplied()
                            : [],
                        !!(textMeasurer && textMeasurer.approximate)
                    );
                }

                zip.file(
                    'word/document.xml',
                    xml
                );

                const blob =
                    await zip.generateAsync({
                        type: 'blob'
                    });

                const fileName =
                    outputFileName(values);

                const result =
                    await downloadBlob(
                        blob,
                        fileName
                    );

                // Electron เท่านั้น: แจ้ง error จากฝั่ง main (เช่น เขียนโฟลเดอร์ไม่ได้)
                if (result && result.ok === false) {

                    throw new Error(
                        result.error ||
                        'บันทึกไฟล์ไม่สำเร็จ'
                    );
                }

                if (result && result.canceled) {

                    showDownloadStatus(
                        saved.length > 0
                            ? 'ยกเลิกการดาวน์โหลด (ได้ไปแล้ว ' +
                                saved.length + ' ไฟล์)'
                            : 'ยกเลิกการดาวน์โหลด'
                    );

                    return;
                }

                // ฝั่ง main คืนชื่อจริงที่ได้ (อาจมีเลข (1) ต่อท้ายถ้าชื่อซ้ำ)
                saved.push(
                    result && result.fileName
                        ? result.fileName
                        : fileName
                );
            }

            showDownloadStatus(
                describeDownload(saved),
                'ok'
            );

            // เก็บชุดค่าที่เพิ่งสร้างเอกสารไว้ให้กดใช้ซ้ำ (หน้า "ประวัติ")
            recordHistory();

        } catch (error) {

            console.error(error);

            showDownloadStatus(
                'ดาวน์โหลดไม่สำเร็จ: ' + error.message,
                'error'
            );

            await scope.AppDialog.alert(
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

            await scope.AppDialog.alert(
                'ยังไม่มีไฟล์ template ให้ดาวน์โหลด'
            );

            return;
        }

        // ชื่อแม่แบบที่ตั้งไว้ ถ้ายังไม่มีจึงใช้ชื่อไฟล์ .docx ต้นฉบับ
        const fileName =
            templateOutputName() + '.docx';

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

            setDbStatus(
                'ดาวน์โหลดไฟล์ต้นฉบับแล้ว: ' +
                (
                    result && result.fileName
                        ? result.fileName
                        : fileName
                ),
                'ok'
            );

        } catch (error) {

            console.error(error);

            setDbStatus(
                'ดาวน์โหลดไม่สำเร็จ: ' + error.message,
                'error'
            );

            await scope.AppDialog.alert(
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

        if (!(await scope.AppDialog.confirm(
            'ยืนยันการแทนที่ไฟล์?\n\n' +
            'ไฟล์ต้นฉบับของ ' + target + ' จะถูกทับด้วย "' +
            (file.name || 'ไฟล์ใหม่') + '" ทันที\n' +
            'ค่า type และ "ล็อกตำแหน่ง" ของ field ที่มีอยู่ทั้งสองไฟล์จะถูกเก็บไว้\n' +
            'ต้องการดำเนินการต่อหรือไม่?',
            { title: 'ยืนยันการแทนที่ไฟล์', okText: 'แทนที่ไฟล์', danger: true }
        ))) {
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

            state.docxBytes = bytes;
            state.xml = xml;
            state.fileName =
                file.name ||
                state.fileName ||
                'document.docx';
            state.fields = fields;
            state.loaded = true;

            // ทิ้ง type / ล็อกตำแหน่ง / placeholder / โครงตาราง
            // ของ field ที่ไม่มีอยู่ในไฟล์ใหม่แล้ว
            keepConfigForFields(
                fields,
                getComponent(CONFIG_PAGE)
            );

            fillForm(CONFIG_PAGE);

            // แทนที่ไฟล์ = ฟอร์มถูกวาดใหม่ ล้าง popup/สถานะค้าง
            resetInteractionState();

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

            await scope.AppDialog.alert(
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

            await scope.AppDialog.alert(
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

                    // regex ที่ใช้ดึงข้อมูลของแต่ละ field (ปุ่ม "ข้อมูล")
                    patterns:
                        config.getPatterns
                            ? config.getPatterns()
                            : {},

                    // โครงตาราง (จำนวนคอลัมน์ / ชื่อหัวคอลัมน์)
                    // ของ field ที่เป็น type Table
                    tables:
                        config.getTableSchemas
                            ? config.getTableSchemas(types)
                            : {},

                    // ชื่อกลุ่ม (Group) ของ field ที่เป็น type List
                    listGroups:
                        config.getListGroups
                            ? config.getListGroups(types)
                            : {},

                    // จำนวนตัวอักษรสูงสุดต่อบรรทัดของ field ที่เป็น type List
                    listLimits:
                        config.getListLimits
                            ? config.getListLimits(types)
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

            resetInteractionState();

            scope.PageModal.close('templateModal');

            return true;

        } catch (error) {

            console.error(error);

            setDbStatus(
                'บันทึกไม่สำเร็จ: ' +
                error.message,
                'error'
            );

            await scope.AppDialog.alert(
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

    // ──────────────────────────────────────────────────────────────
    // ค่าตั้งของแม่แบบ → ไฟล์ JSON (หน้าแก้ไข → ไอคอนมุมบนขวา)
    //
    // ใช้ยกค่าตั้ง (type / ล็อกตำแหน่ง / placeholder / regex / ตาราง /
    // กลุ่มของ list / ความยาวต่อบรรทัด) จากแม่แบบหนึ่งไปอีกแม่แบบหนึ่ง
    // โดยนำเข้าเฉพาะ field ที่ "ชื่อตรงกัน" เท่านั้น
    // ──────────────────────────────────────────────────────────────

    // ค่าตั้งทั้งหมดของแม่แบบที่เปิดอยู่ในหน้าแก้ไข (ตอนนี้)
    function templateSettingsSnapshot(config) {

        const types =
            config.getValues();

        return {

            types:
                types,

            locks:
                config.getLocks
                    ? config.getLocks()
                    : {},

            placeholders:
                config.getPlaceholders
                    ? config.getPlaceholders()
                    : {},

            patterns:
                config.getPatterns
                    ? config.getPatterns()
                    : {},

            tables:
                config.getTableSchemas
                    ? config.getTableSchemas(types)
                    : {},

            listGroups:
                config.getListGroups
                    ? config.getListGroups(types)
                    : {},

            listLimits:
                config.getListLimits
                    ? config.getListLimits(types)
                    : {}
        };
    }

    // ชื่อแม่แบบที่ใช้ตั้งชื่อไฟล์ที่ส่งออก
    function currentTemplateName() {

        return (
            String(
                getPageMeta(CONFIG_PAGE).templateName || ''
            ).trim() ||
            defaultTemplateName(state.fileName)
        );
    }

    // field เหล่านี้มีค่าตั้งที่ต่างจากค่าเริ่มต้นอยู่แล้วหรือไม่
    // (ถ้ามี = ถามยืนยันก่อนทับ เพราะนำเข้าจะเขียนทับค่าที่ตั้งไว้)
    function hasExistingSettings(config, fields) {

        const types =
            config.getValues();

        const locks =
            config.getLocks ? config.getLocks() : {};

        const placeholders =
            config.getPlaceholders ? config.getPlaceholders() : {};

        const patterns =
            config.getPatterns ? config.getPatterns() : {};

        const tables =
            config.getTableSchemas ? config.getTableSchemas(types) : {};

        const listGroups =
            config.getListGroups ? config.getListGroups(types) : {};

        const listLimits =
            config.getListLimits ? config.getListLimits(types) : {};

        return fields.some(function (field) {

            return !!(
                (types[field] && types[field] !== scope.FieldTypes.defaultValue) ||
                locks[field] ||
                placeholders[field] ||
                patterns[field] ||
                tables[field] ||
                listGroups[field] ||
                listLimits[field]
            );
        });
    }

    // ชื่อ field ไม่เกิน 3 ชื่อ ไว้บอกในข้อความสรุป
    function shortFieldList(fields) {

        const names = (fields || []).slice(0, 3);

        return names.join(', ') +
            ((fields || []).length > names.length ? ' …' : '');
    }

    async function onExportTemplateSettings() {

        if (!state.loaded) {

            await scope.AppDialog.alert(
                'ยังไม่มีแม่แบบให้ส่งออก'
            );

            return;
        }

        const config =
            getComponent(CONFIG_PAGE);

        if (!config || !config.getValues) {
            return;
        }

        const name =
            currentTemplateName();

        const payload =
            scope.TemplateSettings.buildExport({

                templateName:
                    name,

                fields:
                    state.fields,

                settings:
                    templateSettingsSnapshot(config)
            });

        const fileName =
            scope.TemplateSettings.fileNameFor(name);

        setDbStatus(
            'กำลังส่งออกค่าตั้ง...'
        );

        try {

            const result =
                await scope.TemplateSettings.save(
                    JSON.stringify(payload, null, 2),
                    fileName
                );

            if (result && result.ok === false) {
                throw new Error(
                    result.error ||
                    'บันทึกไฟล์ไม่สำเร็จ'
                );
            }

            setDbStatus(
                'ส่งออกค่าตั้งแล้ว: ' +
                ((result && result.fileName) || fileName) +
                ' (โฟลเดอร์ Downloads)'
            );

        } catch (error) {

            console.error(error);

            setDbStatus(
                'ส่งออกค่าตั้งไม่สำเร็จ: ' +
                ((error && error.message) || ''),
                'error'
            );

            await scope.AppDialog.alert(
                'ส่งออกค่าตั้งไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ')
            );
        }
    }

    // อ่านไฟล์ JSON ที่เลือกจาก input แล้วนำเข้าค่าตั้ง
    async function onTemplateSettingsFileChosen(event) {

        const input =
            event && event.target;

        const file =
            input && input.files && input.files[0];

        // ล้างค่า input เพื่อให้เลือกไฟล์เดิมซ้ำได้
        if (input) input.value = '';

        if (!file) return;

        try {

            await importTemplateSettingsText(
                await scope.TemplateSettings.readFile(file)
            );

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'อ่านไฟล์ไม่สำเร็จ: ' +
                ((error && error.message) || 'ไม่ทราบสาเหตุ')
            );
        }
    }

    // นำเข้าค่าตั้งจากข้อความ JSON (คืน true = นำเข้าสำเร็จ)
    async function importTemplateSettingsText(content) {

        if (!state.loaded) {

            await scope.AppDialog.alert(
                'ยังไม่มีแม่แบบให้ใส่ค่าตั้ง'
            );

            return false;
        }

        const parsed =
            scope.TemplateSettings.parse(content);

        if (!parsed.ok) {

            await scope.AppDialog.alert(
                parsed.error
            );

            return false;
        }

        const config =
            getComponent(CONFIG_PAGE);

        const fields =
            state.fields || [];

        const matched =
            scope.TemplateSettings.matchFields(
                parsed.settings,
                fields
            );

        if (matched.matched.length === 0) {

            await scope.AppDialog.alert(
                'ไม่มีชื่อ field ที่ตรงกับแม่แบบนี้เลย\n\n' +
                'ไฟล์นี้มี field: ' +
                (shortFieldList(
                    scope.TemplateSettings.fieldNamesIn(parsed.settings)
                ) || '-') +
                '\nแม่แบบนี้มี field: ' +
                (shortFieldList(fields) || '-')
            );

            return false;
        }

        // มีค่าตั้งอยู่แล้ว = ถามก่อน กันเผลอทับของเดิม
        if (hasExistingSettings(config, matched.matched)) {

            const ok =
                await scope.AppDialog.confirm(
                    'นำเข้าค่าตั้งจาก' +
                    (parsed.template.name
                        ? ' "' + parsed.template.name + '"'
                        : 'ไฟล์ JSON') +
                    '\n\nจะเขียนทับค่าตั้งของ ' +
                    matched.matched.length +
                    ' field ที่ชื่อตรงกัน' +
                    (matched.skipped.length > 0
                        ? ' (ข้าม ' + matched.skipped.length +
                            ' field ที่ไม่มีในแม่แบบนี้)'
                        : '') +
                    '\n\nดำเนินการต่อหรือไม่?'
                );

            if (!ok) return false;
        }

        applyTemplateSettings(parsed.settings, matched.matched, config);

        setDbStatus(
            'นำเข้าค่าตั้งแล้ว: ' +
            matched.matched.length +
            ' field' +
            (matched.skipped.length > 0
                ? ' · ข้าม ' + matched.skipped.length +
                    ' field ที่ไม่มีในแม่แบบนี้ (' +
                    shortFieldList(matched.skipped) + ')'
                : '') +
            ' — กด Save Template เพื่อบันทึก'
        );

        return true;
    }

    // เขียนค่าที่นำเข้าลง editor — เฉพาะ field ที่ชื่อตรงกัน
    // ค่าที่ไม่มีในไฟล์ (เช่น ไฟล์ regex-only) จะไม่ถูกแตะ
    function applyTemplateSettings(settings, fields, config) {

        // 1) type — ต้องรู้ก่อนเพื่อรู้ว่า field ไหนเป็นตาราง/list
        const types =
            Object.assign({}, config.getValues());

        fields.forEach(function (field) {

            const type =
                settings.types && settings.types[field];

            if (typeof type === 'string' && type.trim() !== '') {

                types[field] =
                    scope.FieldTypes.get(type).value;
            }
        });

        // เขียน type กลับลงค่าของหน้า — fillForm จะได้วาด dropdown ให้ตรง
        const pageValues =
            getPageValues(CONFIG_PAGE);

        fields.forEach(function (field) {
            pageValues[field] = types[field];
        });

        // 2) ค่าตั้งอื่น — เริ่มจากของเดิม แล้วทับเฉพาะ field ที่ตรงกัน
        const locks =
            config.getLocks ? config.getLocks() : {};

        const placeholders =
            config.getPlaceholders ? config.getPlaceholders() : {};

        const patterns =
            config.getPatterns ? config.getPatterns() : {};

        const tables =
            config.getTableSchemas ? config.getTableSchemas(types) : {};

        const listGroups =
            config.getListGroups ? config.getListGroups(types) : {};

        const listLimits =
            config.getListLimits ? config.getListLimits(types) : {};

        fields.forEach(function (field) {

            // ล็อกตำแหน่ง: ไม่มีในไฟล์ = ปลดล็อก
            if (settings.locks) {

                if (settings.locks[field]) locks[field] = true;
                else delete locks[field];
            }

            // placeholder: ไม่มีในไฟล์ = ล้าง (กลับไปใช้ค่าเริ่มต้น)
            if (settings.placeholders) {

                if (settings.placeholders[field]) {
                    placeholders[field] = settings.placeholders[field];
                } else {
                    delete placeholders[field];
                }
            }

            // regex: ไม่มีในไฟล์ = ล้าง
            if (settings.patterns) {

                if (settings.patterns[field]) {
                    patterns[field] = settings.patterns[field];
                } else {
                    delete patterns[field];
                }
            }

            // โครงตาราง: ใช้เฉพาะเมื่อ field นี้เป็นตาราง
            if (settings.tables) {

                if (types[field] === 'table' && settings.tables[field]) {
                    tables[field] = settings.tables[field];
                } else if (types[field] !== 'table') {
                    delete tables[field];
                }
            }

            // กลุ่มของ list: ใช้เฉพาะเมื่อ field นี้เป็น list
            if (settings.listGroups) {

                if (types[field] === 'list' && settings.listGroups[field]) {
                    listGroups[field] = settings.listGroups[field];
                } else {
                    delete listGroups[field];
                }
            }

            // ความยาวสูงสุดต่อบรรทัด: ใช้เฉพาะเมื่อ field นี้เป็น list
            if (settings.listLimits) {

                if (types[field] === 'list' && settings.listLimits[field]) {
                    listLimits[field] = settings.listLimits[field];
                } else {
                    delete listLimits[field];
                }
            }
        });

        if (config.setLocks) config.setLocks(locks);
        if (config.setPlaceholders) config.setPlaceholders(placeholders);
        if (config.setPatterns) config.setPatterns(patterns);
        if (config.setTableSchemas) config.setTableSchemas(tables);
        if (config.setListGroups) config.setListGroups(listGroups);
        if (config.setListLimits) config.setListLimits(listLimits);

        // วาดฟอร์มใหม่ให้ตรงกับค่าที่เพิ่งนำเข้า (อยู่หน้าเดิม ไม่ปิดโมดัล)
        fillForm(CONFIG_PAGE);
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

                await scope.AppDialog.alert(
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

            // คืน regex ที่บันทึกไว้ใน template (ใช้กับปุ่ม "ข้อมูล")
            if (config.setPatterns) {
                config.setPatterns(
                    record.patterns
                );
            }

            // คืนโครงตารางที่บันทึกไว้ใน template
            if (config.setTableSchemas) {
                config.setTableSchemas(
                    record.tables
                );
            }

            // คืนชื่อกลุ่ม (Group) ของ type List ที่บันทึกไว้ใน template
            if (config.setListGroups) {
                config.setListGroups(
                    record.list_groups
                );
            }

            // คืนค่าความยาวสูงสุดของ type List ที่บันทึกไว้ใน template
            if (config.setListLimits) {
                config.setListLimits(
                    record.list_limits
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

            resetInteractionState();

            // กด "แก้ไข" จากรายการของหน้า Template Configuration = เปิด editor ในโมดัล
            if (currentPage === CONFIG_PAGE) {

                // แม่แบบที่โหลดมามีไฟล์ต้นฉบับอยู่แล้ว จึงซ่อนช่องเลือกไฟล์ .docx
                // ด้านบนของ editor — เปลี่ยนไฟล์ใช้ปุ่ม "อัปโหลดไฟล์ใหม่ทับไฟล์เดิม"
                if (config.setFilePickerVisible) {

                    config.setFilePickerVisible(false);
                }

                scope.PageModal.open('templateModal');
            }

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'โหลด template ไม่สำเร็จ'
            );
        }
    }

    async function onDeleteTemplate(recordId) {

        if (!recordId) {
            return;
        }

        if (
            !(await scope.AppDialog.confirm(
                'ต้องการลบ template นี้ใช่ไหม?',
                { title: 'ยืนยันการลบ', okText: 'ลบ', danger: true }
            ))
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

            resetInteractionState();

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'ลบไม่สำเร็จ: ' +
                error.message
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // คัดลอกแม่แบบ (หน้ารายการแม่แบบ → ปุ่ม "คัดลอก")
    //
    // สร้างรายการใหม่จากของเดิมทั้งชุด (ไฟล์ .docx + type + ล็อกตำแหน่ง +
    // placeholder + โครงตาราง) โดยไม่แตะแม่แบบต้นฉบับ
    //
    // ก่อนสร้างจะเปิดกล่องให้ตั้งชื่อสำเนาเอง (ค่าเริ่มต้น = "ชื่อเดิม (สำเนา)")
    // ยกเลิกกล่อง = ไม่คัดลอก
    // ──────────────────────────────────────────────────────────────

    // ชื่อสำเนาที่ยังไม่ซ้ำกับแม่แบบที่มีอยู่ (กันชื่อซ้ำจนแยกรายการไม่ออก)
    function copyTemplateName(baseName) {

        const base =
            String(baseName || '').trim() || 'แม่แบบ';

        const used = {};

        (templateRecords || []).forEach(function (item) {
            used[String(item.name || '')] = true;
        });

        let name = base + ' (สำเนา)';
        let index = 2;

        while (used[name]) {
            name = base + ' (สำเนา ' + index + ')';
            index++;
        }

        return name;
    }

    // ชื่อนี้มีแม่แบบอื่นใช้อยู่แล้วหรือยัง (ใช้ก่อนสร้างสำเนาที่ตั้งชื่อเอง)
    //
    // ฐานข้อมูลบังคับชื่อแม่แบบไม่ให้ซ้ำ (templates.name UNIQUE) จึงต้องเช็คก่อนบันทึก
    // ไม่งั้นผู้ใช้จะเจอ error "UNIQUE constraint failed"
    function templateNameTaken(name) {

        const wanted =
            String(name || '').trim();

        if (!wanted) {
            return false;
        }

        return (templateRecords || []).some(function (item) {

            return String(item.name || '').trim() === wanted;
        });
    }

    // ชื่อที่ยังว่าง — เติมเลขในวงเล็บต่อท้ายให้เอง (เช่น "ใบลา (2)")
    function freeTemplateName(baseName) {

        const base =
            String(baseName || '').trim() || 'แม่แบบ';

        if (!templateNameTaken(base)) {
            return base;
        }

        let index = 2;

        while (templateNameTaken(base + ' (' + index + ')')) {
            index++;
        }

        return base + ' (' + index + ')';
    }

    async function onCopyTemplate(recordId) {

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

                await scope.AppDialog.alert(
                    'ไม่พบ template นี้ (อาจถูกลบไปแล้ว)'
                );

                await refreshTemplateList();

                return;
            }

            // ให้ตั้งชื่อสำเนาเองได้ — เติมชื่อเดิม + " (สำเนา)" ให้ก่อน
            // (ถ้าชื่อนั้นซ้ำอยู่แล้วจะเติมเลขต่อท้ายให้เป็น "(สำเนา 2)" ตามเดิม)
            const suggested =
                copyTemplateName(record.name);

            const typed =
                await scope.AppDialog.prompt(
                    'ตั้งชื่อแม่แบบใหม่\n\n' +
                    'ไฟล์ .docx และค่าตั้งทั้งหมดของ "' + record.name + '" ' +
                    'จะถูกคัดลอกมาที่แม่แบบใหม่นี้',
                    suggested,
                    { title: 'คัดลอกแม่แบบ', okText: 'คัดลอก' }
                );

            // ปิด/ยกเลิกกล่อง = ไม่ต้องคัดลอก
            if (typed === null) {
                return;
            }

            // เว้นว่าง = ใช้ชื่อที่ระบบแนะนำ (ชื่อเดิม + " (สำเนา)")
            let name =
                String(typed).trim() ||
                suggested;

            // ชื่อซ้ำกับแม่แบบที่มีอยู่ = ให้ตั้งใหม่ในกล่องเดิม
            // (พร้อมเติมชื่อที่ยังว่างให้) — ฐานข้อมูลไม่ยอมให้ชื่อซ้ำ
            while (templateNameTaken(name)) {

                const retyped =
                    await scope.AppDialog.prompt(
                        'ชื่อ "' + name + '" ถูกใช้อยู่แล้ว\n' +
                        'ตั้งชื่ออื่นสำหรับสำเนา',
                        freeTemplateName(name),
                        { title: 'ชื่อซ้ำ', okText: 'คัดลอก' }
                    );

                // ปิด/ยกเลิกกล่อง = ไม่ต้องคัดลอก
                if (retyped === null) {
                    return;
                }

                name =
                    String(retyped).trim() ||
                    freeTemplateName(name);
            }

            const bytes =
                record.docx instanceof Uint8Array
                    ? record.docx
                    : new Uint8Array(
                        record.docx
                    );

            await scope.Db.save({

                // id = 0 → สร้างรายการใหม่ (ดู db-worker.cjs)
                id:
                    0,

                name:
                    name,

                fileName:
                    record.file_name || '',

                docx:
                    bytes,

                fields:
                    record.fields || [],

                types:
                    record.types || {},

                locks:
                    record.locks || {},

                placeholders:
                    record.placeholders || {},

                patterns:
                    record.patterns || {},

                tables:
                    record.tables || {},

                listGroups:
                    record.list_groups || {},

                listLimits:
                    record.list_limits || {}
            });

            setDbStatus(
                'คัดลอกแม่แบบแล้ว: ' + name
            );

            await refreshTemplateList();

            resetInteractionState();

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'คัดลอกไม่สำเร็จ: ' +
                error.message
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ข้อมูล (หน้ารายการแม่แบบ → ปุ่ม "ข้อมูล")
    //
    // เปิดกล่องตั้ง regex ของแต่ละ field + ทดสอบอัปโหลด/วางข้อความ
    // การทดสอบไม่ถูกบันทึก — บันทึกเฉพาะ regex กลับลงแม่แบบ
    // ──────────────────────────────────────────────────────────────

    // บันทึก regex ลงแม่แบบ (ไม่แตะค่าตั้งอื่น)
    async function saveTemplatePatterns(record, patterns) {

        await ensureDb();

        await scope.Db.save({

            id:
                record.id,

            name:
                record.name,

            fileName:
                record.file_name,

            docx:
                record.docx,

            fields:
                record.fields,

            types:
                record.types,

            locks:
                record.locks,

            placeholders:
                record.placeholders,

            patterns:
                patterns || {},

            tables:
                record.tables,

            listGroups:
                record.list_groups,

            listLimits:
                record.list_limits
        });

        // record ในหน่วยความจำต้องตรงกับสิ่งที่เพิ่งบันทึก
        record.patterns = patterns || {};

        // รายการที่แคชไว้ใช้แสดงจำนวน/เปิดกล่องครั้งถัดไป
        (templateRecords || []).forEach(function (item) {
            if (item.id === record.id) {
                item.patterns = record.patterns;
            }
        });

        // ถ้าแม่แบบนี้เป็นตัวที่โหลดอยู่ในหน้าแก้ไข/หน้ารายงาน
        // (state.templateId ใช้ร่วมกันทั้งสองหน้า) ต้องอัปเดตค่าในหน่วยความจำด้วย
        if (state.templateId === record.id) {

            const config =
                getComponent(CONFIG_PAGE);

            if (config.setPatterns) {
                config.setPatterns(record.patterns);
            }
        }

        setDbStatus(
            'บันทึก regex แล้ว: ' + record.name
        );

        await refreshTemplateList();
    }

    async function onOpenTemplateData(recordId) {

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

                await scope.AppDialog.alert(
                    'ไม่พบ template นี้ (อาจถูกลบไปแล้ว)'
                );

                await refreshTemplateList();

                return;
            }

            scope.DataExtractDialog.open({

                mode: 'config',

                title: 'ข้อมูล — ' + record.name,

                templateName: record.name,

                fields: record.fields || [],

                types: record.types || {},

                patterns: record.patterns || {},

                listGroups: record.list_groups || {},

                onSavePatterns: function (patterns) {
                    return saveTemplatePatterns(record, patterns);
                }
            });

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'เปิดหน้าข้อมูลไม่สำเร็จ: ' + error.message
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // จัดตำแหน่งเอกสาร (หน้ารายการแม่แบบ → ปุ่ม "จัดตำแหน่ง")
    //
    // เปิดเอกสารจริงด้วย docx-preview ให้เห็นฟอนต์/ขนาดกระดาษ/การตัดขึ้นหน้าใหม่
    // เหมือนเปิดใน Word แล้วแก้ข้อความได้ตรงหน้า
    // (การแสดงผล/การแก้ข้อความอยู่ใน TemplateLayoutDialog)
    // ที่นี่แค่เตรียมไฟล์ + บันทึกกลับฐานข้อมูล + ดาวน์โหลด
    // ──────────────────────────────────────────────────────────────

    // คืนชุดค่าเฉพาะ field ที่ยังมีอยู่ในเอกสาร (field อื่นถูกตัดทิ้ง)
    function keepFieldsInConfig(values, fields) {

        const present = {};

        (fields || []).forEach(function (field) {
            present[field] = true;
        });

        const kept = {};

        Object.keys(values || {}).forEach(function (field) {
            if (present[field]) {
                kept[field] = values[field];
            }
        });

        return kept;
    }

    // ทิ้งค่า config ของ field ที่ไม่มีในเอกสารแล้ว (ใช้เมื่อไฟล์เปลี่ยน)
    // - ค่า type: แก้ในค่าของหน้า Template Configuration โดยตรง
    // - ล็อกตำแหน่ง / placeholder / โครงตาราง: เก็บใน component
    function keepConfigForFields(fields, config) {

        if (!config) {
            return;
        }

        const configValues =
            getPageValues(CONFIG_PAGE);

        const kept =
            keepFieldsInConfig(configValues, fields);

        // getPageValues คืน object ตัวจริงของหน้า → ตัดคีย์ทิ้งในที่เดิม
        Object.keys(configValues).forEach(function (field) {

            if (!Object.prototype.hasOwnProperty.call(kept, field)) {
                delete configValues[field];
            }
        });

        if (config.getLocks && config.setLocks) {

            config.setLocks(
                keepFieldsInConfig(
                    config.getLocks(),
                    fields
                )
            );
        }

        if (config.getPlaceholders && config.setPlaceholders) {

            config.setPlaceholders(
                keepFieldsInConfig(
                    config.getPlaceholders(),
                    fields
                )
            );
        }

        if (config.getPatterns && config.setPatterns) {

            config.setPatterns(
                keepFieldsInConfig(
                    config.getPatterns(),
                    fields
                )
            );
        }

        // ส่ง type ที่เก็บไว้ใน state ไปด้วย — ตอนนี้ #form อาจเป็นฟอร์มของหน้า
        // รายงาน (ไม่ใช่ dropdown type ของหน้า config) ถ้าไม่ส่งจะอ่าน type ผิดหน้า
        if (config.getTableSchemas && config.setTableSchemas) {

            config.setTableSchemas(
                keepFieldsInConfig(
                    config.getTableSchemas(kept),
                    fields
                )
            );
        }

        if (config.getListGroups && config.setListGroups) {

            config.setListGroups(
                keepFieldsInConfig(
                    config.getListGroups(kept),
                    fields
                )
            );
        }

        if (config.getListLimits && config.setListLimits) {

            config.setListLimits(
                keepFieldsInConfig(
                    config.getListLimits(kept),
                    fields
                )
            );
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ค่าตั้งของ field (type / ล็อกตำแหน่ง / placeholder / กลุ่ม) — เมนูคลิกขวา
    // ในหน้าจัดตำแหน่ง
    //
    // แก้ค่าเดียวกันกับที่หน้า "ตั้งค่าแม่แบบ" แก้ (record.types / locks /
    // placeholders) จึงบันทึกลงฐานข้อมูลทันที และอัปเดต editor ของหน้านั้นด้วย
    // ถ้ากำลังเปิดแม่แบบนี้อยู่
    // ──────────────────────────────────────────────────────────────

    function fieldConfigOf(record, field) {

        const type =
            (record.types && record.types[field]) ||
            scope.FieldTypes.defaultValue;

        return {

            type:
                type,

            lock:
                !!(record.locks && record.locks[field]),

            placeholder:
                (record.placeholders && record.placeholders[field]) || '',

            // ชื่อกลุ่ม (Group) ใช้กับ type List เท่านั้น — ว่าง = ไม่ใช้กลุ่ม
            listGroup:
                type === 'list'
                    ? ((record.list_groups && record.list_groups[field]) || '')
                    : '',

            // จำนวนตัวอักษรสูงสุดต่อบรรทัดของ type List (0 = ไม่จำกัด)
            maxChars:
                type === 'list'
                    ? (Number(record.list_limits && record.list_limits[field]) || 0)
                    : 0
        };
    }

    async function saveLayoutFieldConfig(record, field, values) {

        if (!field) {
            return;
        }

        const types =
            Object.assign({}, record.types);

        const locks =
            Object.assign({}, record.locks);

        const placeholders =
            Object.assign({}, record.placeholders);

        // regex ของ field ไม่ได้แก้ในเมนูนี้ — คงค่าเดิมไว้
        // (ถ้าไม่ส่งไปด้วย การบันทึกจะล้าง regex ทั้งหมด)
        const patterns =
            Object.assign({}, record.patterns);

        const tables =
            Object.assign({}, record.tables);

        const listGroups =
            Object.assign({}, record.list_groups);

        const listLimits =
            Object.assign({}, record.list_limits);

        // ค่า type ที่ไม่รู้จักกลับไปเป็นค่าเริ่มต้น (เหมือน dropdown ของหน้าแก้ไข)
        const type =
            scope.FieldTypes.get(
                values && values.type
            ).value;

        types[field] = type;

        if (values && values.lock) {
            locks[field] = true;
        } else {
            delete locks[field];
        }

        const placeholder =
            String((values && values.placeholder) || '');

        // เว้นว่าง = ลบออก (กลับไปใช้ค่าเริ่มต้นของหน้ารายงาน)
        if (placeholder.trim() === '') {
            delete placeholders[field];
        } else {
            placeholders[field] = placeholder;
        }

        if (type === 'table') {

            // เปลี่ยนเป็นตาราง = ต้องมีโครงตารางให้หน้าแก้ไขใช้ต่อ
            // (ยังไม่มี = ค่าเริ่มต้น 3 คอลัมน์ ตาม FieldTypes)
            tables[field] =
                scope.FieldTypes.getTableSchema(
                    field
                );

        } else {

            // เหมือนตอนบันทึกจากหน้าแก้ไข: เก็บเฉพาะ field ที่เป็นตาราง
            delete tables[field];
        }

        // ชื่อกลุ่ม (Group) เก็บเฉพาะ field ที่ยังเป็น List
        // (แก้ที่หน้า "ตั้งค่าแม่แบบ" หรือเมนูคลิกขวาในหน้าจัดตำแหน่งก็ได้)
        const listGroup =
            String((values && values.listGroup) || '').trim();

        if (type === 'list' && listGroup !== '') {
            listGroups[field] = listGroup;
        } else {
            delete listGroups[field];
        }

        // ความยาวสูงสุดต่อบรรทัด เก็บเฉพาะ field ที่ยังเป็น List และมากกว่า 0
        const maxChars =
            Math.floor(Number(values && values.maxChars));

        if (type === 'list' && isFinite(maxChars) && maxChars > 0) {
            listLimits[field] = maxChars;
        } else {
            delete listLimits[field];
        }

        await ensureDb();

        await scope.Db.save({

            id:
                record.id,

            name:
                record.name,

            fileName:
                record.file_name,

            docx:
                record.docx,

            fields:
                record.fields,

            types:
                types,

            locks:
                locks,

            placeholders:
                placeholders,

            patterns:
                patterns,

            tables:
                tables,

            listGroups:
                listGroups,

            listLimits:
                listLimits
        });

        // record ในหน่วยความจำต้องตรงกับสิ่งที่เพิ่งบันทึก
        record.types = types;
        record.locks = locks;
        record.placeholders = placeholders;
        record.patterns = patterns;
        record.tables = tables;
        record.list_groups = listGroups;
        record.list_limits = listLimits;

        // หน้า "ตั้งค่าแม่แบบ" ที่เปิดแม่แบบนี้อยู่ต้องตรงกันด้วย
        if (
            state.templateId === record.id &&
            currentPage === CONFIG_PAGE
        ) {

            const config =
                getComponent(CONFIG_PAGE);

            getPageValues(
                CONFIG_PAGE
            )[field] = type;

            if (config.setLocks) {
                config.setLocks(locks);
            }

            if (config.setPlaceholders) {
                config.setPlaceholders(placeholders);
            }

            if (config.setTableSchemas) {
                config.setTableSchemas(tables);
            }

            if (config.setListGroups) {
                config.setListGroups(listGroups);
            }

            if (config.setListLimits) {
                config.setListLimits(listLimits);
            }

            fillForm(CONFIG_PAGE);
        }

        await refreshTemplateList();
    }

    // เปิดหน้า "แก้ไข" (ตั้งค่าแม่แบบ) ที่ field นั้น — สำหรับค่าที่ตั้งได้
    // ละเอียดกว่าหน้าจัดตำแหน่ง (โครงตาราง / ลากสัดส่วน / รูปแบบหัวคอลัมน์)
    async function openFieldInConfigPage(record, field) {

        if (currentPage !== CONFIG_PAGE) {

            await scope.AppDialog.alert(
                'เปิดหน้าแก้ไขได้จากหน้า "ตั้งค่าแม่แบบ" เท่านั้น'
            );

            return false;
        }

        await onLoadTemplate(
            record.id
        );

        flashConfigField(field);

        return true;
    }

    // เลื่อน editor ไปที่ field ที่ต้องการ แล้วกะพริบกรอบให้เห็นว่าแถวไหน
    function flashConfigField(field) {

        const form =
            document.getElementById('form');

        if (!form) {
            return;
        }

        let control = null;

        form.querySelectorAll('[data-field]').forEach(function (node) {

            if (node.dataset.field === field) {
                control = node;
            }
        });

        const row =
            control && control.closest
                ? control.closest('.field')
                : null;

        if (!row) {
            return;
        }

        // รอให้โมดัลของ editor แสดงก่อน แล้วค่อยเลื่อน/กะพริบ
        window.requestAnimationFrame(function () {

            if (!document.contains(row)) {
                return;
            }

            row.scrollIntoView({
                block: 'center'
            });

            row.classList.add('field-flash');

            window.setTimeout(function () {
                row.classList.remove('field-flash');
            }, 1600);
        });
    }

    async function onOpenLayout(recordId) {

        if (!recordId) {
            return;
        }

        if (!scope.TemplateLayoutDialog) {

            await scope.AppDialog.alert(
                'ไม่พบหน้าจัดตำแหน่ง (ไฟล์ components/templateLayoutDialog.js)'
            );

            return;
        }

        try {

            await ensureDb();

            const record =
                await scope.Db.get(
                    recordId
                );

            if (!record) {

                await scope.AppDialog.alert(
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

            scope.TemplateLayoutDialog.open({

                name:
                    record.name || '',

                bytes:
                    bytes,

                xml:
                    xml,

                // เก็บในฐานข้อมูล แล้วคืน byte ของไฟล์ใหม่ไปเรนเดอร์ต่อ
                save:
                    async function (newXml) {

                        return await saveLayoutEdits(
                            record,
                            newXml
                        );
                    },

                // ดาวน์โหลดไฟล์ที่แก้แล้วไปตรวจก่อน (ไม่แตะฐานข้อมูล)
                download:
                    async function (newXml) {

                        await downloadLayoutEdits(
                            record,
                            newXml
                        );
                    },

                // อัปโหลดไฟล์ใหม่ทับไฟล์เดิม (ปุ่มในหน้าจัดตำแหน่ง)
                // คืน { bytes, xml } ของไฟล์ใหม่ไปเรนเดอร์ต่อ
                replaceFile:
                    async function (bytes, fileName) {

                        return await replaceLayoutFile(
                            record,
                            bytes,
                            fileName
                        );
                    },

                // ค่าตั้งของ field สำหรับเมนูคลิกขวา (type / ล็อกตำแหน่ง / placeholder)
                getFieldConfig:
                    function (field) {

                        return fieldConfigOf(
                            record,
                            field
                        );
                    },

                saveFieldConfig:
                    async function (field, values) {

                        await saveLayoutFieldConfig(
                            record,
                            field,
                            values
                        );
                    },

                // เปิดหน้า "แก้ไข" ที่ field นั้น (ค่าที่ลึกกว่า เช่น โครงตาราง)
                editField:
                    async function (field) {

                        return await openFieldInConfigPage(
                            record,
                            field
                        );
                    }
            });

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'เปิดหน้าจัดตำแหน่งไม่สำเร็จ: ' +
                (error && error.message
                    ? error.message
                    : error)
            );
        }
    }

    // แทน word/document.xml ด้วย xml ที่แก้จากหน้าจัดตำแหน่ง
    // แล้วได้ byte ของ .docx ใหม่ (ไฟล์อื่นใน zip เดิมถูกเก็บครบ)
    async function zipDocumentXml(bytes, xml) {

        const zip =
            await JSZip.loadAsync(
                bytes
            );

        zip.file(
            'word/document.xml',
            xml
        );

        return await zip.generateAsync({
            type: 'uint8array'
        });
    }

    // แทนที่ไฟล์ต้นฉบับของแม่แบบด้วยไฟล์ใหม่ทั้งไฟล์ (ปุ่มในหน้าจัดตำแหน่ง)
    //
    // ต่างจาก saveLayoutEdits ที่เขียนกลับเฉพาะ word/document.xml — ตัวนี้รับไฟล์
    // .docx ใหม่มาทั้งไฟล์ (เหมือนปุ่ม "อัปโหลดไฟล์ใหม่ทับไฟล์เดิม" ของหน้าแก้ไข)
    // ค่า type / ล็อกตำแหน่ง / placeholder / ตาราง ของ field ที่มีอยู่ทั้งสองไฟล์
    // ถูกเก็บไว้ — field ที่หายไปพร้อมไฟล์เดิมถูกตัดทิ้ง
    async function replaceLayoutFile(record, bytes, fileName) {

        const xml =
            await readDocumentXml(
                bytes
            );

        const fields =
            scope.Extract.extractFields(
                xml
            );

        const types =
            keepFieldsInConfig(record.types, fields);

        const locks =
            keepFieldsInConfig(record.locks, fields);

        const placeholders =
            keepFieldsInConfig(record.placeholders, fields);

        const patterns =
            keepFieldsInConfig(record.patterns, fields);

        const tables =
            keepFieldsInConfig(record.tables, fields);

        const listGroups =
            keepFieldsInConfig(record.list_groups, fields);

        const listLimits =
            keepFieldsInConfig(record.list_limits, fields);

        await ensureDb();

        await scope.Db.save({

            id:
                record.id,

            name:
                record.name,

            fileName:
                fileName || record.file_name,

            docx:
                bytes,

            fields:
                fields,

            types:
                types,

            locks:
                locks,

            placeholders:
                placeholders,

            patterns:
                patterns,

            tables:
                tables,

            listGroups:
                listGroups,

            listLimits:
                listLimits
        });

        // record ในหน่วยความจำต้องตรงกับไฟล์ใหม่
        // (บันทึก/ดาวน์โหลดครั้งถัดไปในหน้าจัดตำแหน่งจะต่อจากไฟล์ใหม่)
        record.docx = bytes;
        record.file_name = fileName || record.file_name;
        record.fields = fields;
        record.types = types;
        record.locks = locks;
        record.placeholders = placeholders;
        record.patterns = patterns;
        record.tables = tables;
        record.list_groups = listGroups;
        record.list_limits = listLimits;

        // ถ้าแม่แบบนี้กำลังเปิดแก้ไขอยู่ในหน้า "ตั้งค่าแม่แบบ"
        // state ในหน่วยความจำต้องตรงกับไฟล์ใหม่ด้วย
        if (
            state.templateId === record.id &&
            currentPage === CONFIG_PAGE
        ) {

            state.docxBytes = bytes;
            state.xml = xml;
            state.fileName = record.file_name;
            state.fields = fields;

            keepConfigForFields(
                fields,
                getComponent(CONFIG_PAGE)
            );

            fillForm(CONFIG_PAGE);
            resetInteractionState();
        }

        setDbStatus(
            'แทนที่ไฟล์ต้นฉบับแล้ว: ' +
            record.name
        );

        await refreshTemplateList();

        return {
            bytes: bytes,
            xml: xml
        };
    }

    // บันทึกผลจากหน้าจัดตำแหน่งลงฐานข้อมูล
    //
    // ค่า type / ล็อกตำแหน่ง / placeholder / ตาราง ของ field ที่ยังมีอยู่ถูกเก็บไว้
    // (เหมือนตอนอัปโหลดไฟล์ทับ) — field ที่หายไปจากการแก้ข้อความถูกตัดทิ้ง
    async function saveLayoutEdits(record, newXml) {

        const bytes =
            await zipDocumentXml(
                record.docx,
                newXml
            );

        const fields =
            scope.Extract.extractFields(
                newXml
            );

        const types =
            keepFieldsInConfig(record.types, fields);

        const locks =
            keepFieldsInConfig(record.locks, fields);

        const placeholders =
            keepFieldsInConfig(record.placeholders, fields);

        const patterns =
            keepFieldsInConfig(record.patterns, fields);

        const tables =
            keepFieldsInConfig(record.tables, fields);

        const listGroups =
            keepFieldsInConfig(record.list_groups, fields);

        const listLimits =
            keepFieldsInConfig(record.list_limits, fields);

        await ensureDb();

        await scope.Db.save({

            id:
                record.id,

            name:
                record.name,

            fileName:
                record.file_name,

            docx:
                bytes,

            fields:
                fields,

            types:
                types,

            locks:
                locks,

            placeholders:
                placeholders,

            patterns:
                patterns,

            tables:
                tables,

            listGroups:
                listGroups,

            listLimits:
                listLimits
        });

        // record ในหน่วยความจำต้องตรงกับสิ่งที่เพิ่งบันทึก
        // (กดบันทึกซ้ำ/ดาวน์โหลดในหน้าจัดตำแหน่งครั้งถัดไปจะต่อจากไฟล์ล่าสุด)
        record.docx = bytes;
        record.fields = fields;
        record.types = types;
        record.locks = locks;
        record.placeholders = placeholders;
        record.patterns = patterns;
        record.tables = tables;
        record.list_groups = listGroups;
        record.list_limits = listLimits;

        // ถ้าแม่แบบนี้กำลังเปิดแก้ไขอยู่ในหน้า "ตั้งค่าแม่แบบ"
        // state ในหน่วยความจำต้องตรงกับไฟล์ใหม่ด้วย
        if (
            state.templateId === record.id &&
            currentPage === CONFIG_PAGE
        ) {

            state.docxBytes = bytes;
            state.xml = newXml;
            state.fields = fields;

            keepConfigForFields(
                fields,
                getComponent(CONFIG_PAGE)
            );

            fillForm(CONFIG_PAGE);
            resetInteractionState();
        }

        setDbStatus(
            'แก้ข้อความจากหน้าจัดตำแหน่งแล้ว: ' +
            record.name
        );

        await refreshTemplateList();

        return bytes;
    }

    // ดาวน์โหลดไฟล์ .docx ที่แก้จากหน้าจัดตำแหน่ง (ไม่บันทึกในฐานข้อมูล)
    async function downloadLayoutEdits(record, newXml) {

        const bytes =
            await zipDocumentXml(
                record.docx,
                newXml
            );

        const base =
            sanitizeFileName(
                String(
                    record.file_name ||
                    record.name ||
                    'document.docx'
                ).replace(/\.docx$/i, '')
            ) || 'document';

        downloadBlob(
            new Blob(
                [bytes],
                {
                    type:
                        'application/vnd.openxmlformats-officedocument' +
                        '.wordprocessingml.document'
                }
            ),
            base + '.docx'
        );
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

            // ถ้ากำลังอยู่ในโหมดตาราง ให้พร้อมและ render แถว
            if (master.readyTable) {
                master.readyTable();
            }

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
    // Master Groups / Sub Groups (กลุ่มที่กำหนดไว้ล่วงหน้า)
    // ──────────────────────────────────────────────────────────────

    // โหลดกลุ่ม/กลุ่มย่อยมาเติมในฟอร์มและส่วนจัดการ
    async function refreshMasterGroups() {

        // ข้ามถ้าหน้าปัจจุบันไม่มีส่วนจัดการกลุ่ม
        if (!document.getElementById('masterGroupList')) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        try {

            await ensureDb();

            masterGroups =
                await scope.Db.groupList();

            master.setGroups(
                masterGroups
            );

        } catch (error) {

            console.error(error);

            master.setGroups([]);

            master.setGroupStatus(
                'โหลดกลุ่มไม่สำเร็จ: ' +
                error.message,
                'error'
            );
        }
    }

    async function onAddMasterGroup() {

        const master =
            getComponent(MASTER_PAGE);

        const name =
            master.readNewGroupName();

        if (!name) {

            master.setGroupStatus(
                'กรุณาระบุชื่อกลุ่ม',
                'error'
            );

            return;
        }

        try {

            await ensureDb();

            await scope.Db.groupSave({
                id: 0,
                name: name
            });

            master.clearNewGroupInput();
            master.setGroupStatus('เพิ่มกลุ่มแล้ว', 'ok');

            await refreshMasterGroups();

            resetInteractionState();

        } catch (error) {

            console.error(error);

            master.setGroupStatus(
                'เพิ่มกลุ่มไม่สำเร็จ: ' +
                error.message,
                'error'
            );
        }
    }

    async function onRenameMasterGroup(groupId, currentName) {

        const value =
            await scope.AppDialog.prompt(
                'ระบุชื่อกลุ่มใหม่',
                currentName || '',
                { title: 'เปลี่ยนชื่อกลุ่ม' }
            );

        if (value === null) {
            return;
        }

        const name =
            value.trim();

        if (!name || name === currentName) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        try {

            await ensureDb();

            await scope.Db.groupSave({
                id: Number(groupId),
                name: name
            });

            master.setGroupStatus('เปลี่ยนชื่อกลุ่มแล้ว', 'ok');

            await refreshMasterGroups();

            // code_group ของรายการ master ถูกเปลี่ยนตาม — โหลดรายการใหม่
            await refreshMasterList();

            resetInteractionState();

        } catch (error) {

            console.error(error);

            master.setGroupStatus(
                'เปลี่ยนชื่อกลุ่มไม่สำเร็จ: ' +
                error.message,
                'error'
            );
        }
    }

    async function onDeleteMasterGroup(groupId) {

        if (!(await scope.AppDialog.confirm(
            'ต้องการลบกลุ่มนี้ใช่ไหม?\n\n' +
            'ลบได้เฉพาะกลุ่มที่ไม่มีข้อมูลหลักใช้อยู่',
            { title: 'ยืนยันการลบ', okText: 'ลบ', danger: true }
        ))) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        try {

            await ensureDb();

            await scope.Db.groupDelete(
                Number(groupId)
            );

            master.setGroupStatus('ลบกลุ่มแล้ว', 'ok');

            await refreshMasterGroups();

            resetInteractionState();

        } catch (error) {

            console.error(error);

            master.setGroupStatus(
                'ลบกลุ่มไม่สำเร็จ: ' +
                error.message,
                'error'
            );
        }
    }

    async function onAddMasterSubgroup(groupId) {

        const master =
            getComponent(MASTER_PAGE);

        const name =
            master.readNewSubgroupName(groupId);

        if (!name) {

            master.setGroupStatus(
                'กรุณาระบุชื่อกลุ่มย่อย',
                'error'
            );

            return;
        }

        try {

            await ensureDb();

            await scope.Db.subgroupSave({
                id: 0,
                groupId: Number(groupId),
                name: name
            });

            master.clearNewSubgroupInput(groupId);
            master.setGroupStatus('เพิ่มกลุ่มย่อยแล้ว', 'ok');

            await refreshMasterGroups();

            resetInteractionState();

        } catch (error) {

            console.error(error);

            master.setGroupStatus(
                'เพิ่มกลุ่มย่อยไม่สำเร็จ: ' +
                error.message,
                'error'
            );
        }
    }

    async function onRenameMasterSubgroup(groupId, subgroupId, currentName) {

        const value =
            await scope.AppDialog.prompt(
                'ระบุชื่อกลุ่มย่อยใหม่',
                currentName || '',
                { title: 'เปลี่ยนชื่อกลุ่มย่อย' }
            );

        if (value === null) {
            return;
        }

        const name =
            value.trim();

        if (!name || name === currentName) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        try {

            await ensureDb();

            await scope.Db.subgroupSave({
                id: Number(subgroupId),
                groupId: Number(groupId),
                name: name
            });

            master.setGroupStatus('เปลี่ยนชื่อกลุ่มย่อยแล้ว', 'ok');

            await refreshMasterGroups();
            await refreshMasterList();

            resetInteractionState();

        } catch (error) {

            console.error(error);

            master.setGroupStatus(
                'เปลี่ยนชื่อกลุ่มย่อยไม่สำเร็จ: ' +
                error.message,
                'error'
            );
        }
    }

    async function onDeleteMasterSubgroup(subgroupId) {

        if (!(await scope.AppDialog.confirm(
            'ต้องการลบกลุ่มย่อยนี้ใช่ไหม?\n\n' +
            'ลบได้เฉพาะกลุ่มย่อยที่ไม่มีข้อมูลหลักใช้อยู่',
            { title: 'ยืนยันการลบ', okText: 'ลบ', danger: true }
        ))) {
            return;
        }

        const master =
            getComponent(MASTER_PAGE);

        try {

            await ensureDb();

            await scope.Db.subgroupDelete(
                Number(subgroupId)
            );

            master.setGroupStatus('ลบกลุ่มย่อยแล้ว', 'ok');

            await refreshMasterGroups();

            resetInteractionState();

        } catch (error) {

            console.error(error);

            master.setGroupStatus(
                'ลบกลุ่มย่อยไม่สำเร็จ: ' +
                error.message,
                'error'
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

            resetInteractionState();

            scope.PageModal.close('wordModal');

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

        // เปิดฟอร์มแก้ไขในโมดัล
        scope.PageModal.open('wordModal');
    }

    function onCancelWordEdit() {

        const page =
            getComponent(WORDS_PAGE);

        page.resetForm();
        page.setFormStatus('');

        scope.PageModal.close('wordModal');
    }

    async function onDeleteWord(recordId) {

        if (!recordId) {
            return;
        }

        if (
            !(await scope.AppDialog.confirm(
                'ต้องการลบคำนี้ใช่ไหม?',
                { title: 'ยืนยันการลบ', okText: 'ลบ', danger: true }
            ))
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

            resetInteractionState();

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

            resetInteractionState();

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

        // รายการ (List) เก็บเป็น { items: [...] } เพื่อกดใช้ซ้ำแล้วได้ทุกข้อ
        if (report.getListValues) {

            const lists =
                report.getListValues();

            Object.keys(lists).forEach(function (field) {

                const items = (lists[field] && lists[field].items) || [];

                const filled = items.some(function (item) {
                    return String(item == null ? '' : item).trim() !== '';
                });

                if (filled) {
                    values[field] = lists[field];
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
            !(await scope.AppDialog.confirm(
                'ต้องการลบรายการนี้ใช่ไหม?',
                { title: 'ยืนยันการลบ', okText: 'ลบ', danger: true }
            ))
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

            resetInteractionState();

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

            resetInteractionState();

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
            !(await scope.AppDialog.confirm(
                'ต้องการล้างประวัติการกรอกทั้งหมดใช่ไหม?',
                { title: 'ยืนยันการล้างประวัติ', okText: 'ล้างทั้งหมด', danger: true }
            ))
        ) {
            return;
        }

        page.setBusy(true);

        try {

            await ensureDb();

            const result =
                await scope.Db.historyClear();

            await refreshHistory();

            resetInteractionState();

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
        let subIndex = -1;
        let nameIndex = 1;
        let start = 0;
        let hasHeader = false;

        for (
            let i = 0;
            i < Math.min(list.length, 5);
            i++
        ) {

            const labels =
                (list[i] || []).map(normalizeHeaderCell);

            const codeAt =
                indexOfLabel(labels, MASTER_CODE_HEADERS);

            const subAt =
                indexOfLabel(labels, MASTER_SUBGROUP_HEADERS);

            const nameAt =
                indexOfLabel(labels, MASTER_NAME_HEADERS);

            // เจออย่างน้อยหนึ่งคอลัมน์ที่รู้จัก = ถือว่าแถวนี้เป็นหัวตาราง
            if (codeAt === -1 && subAt === -1 && nameAt === -1) continue;

            if (codeAt !== -1) codeIndex = codeAt;
            if (subAt !== -1) subIndex = subAt;
            if (nameAt !== -1) nameIndex = nameAt;

            start = i + 1;
            hasHeader = true;
            break;
        }

        // ไม่มีหัวตาราง: เดาคอลัมน์จากจำนวนช่องของแถวแรก
        //   2 ช่อง = Code Group, Name | 3 ช่องขึ้นไป = Code Group, Sub Group, Name
        if (!hasHeader) {

            const first =
                list.find(function (row) {

                    return Array.isArray(row) && row.some(function (cell) {

                        return String(
                            cell === undefined || cell === null ? '' : cell
                        ).trim() !== '';
                    });
                });

            if (first && first.length >= 3) {
                subIndex = 1;
                nameIndex = 2;
            }
        }

        const records = [];

        for (let i = start; i < list.length; i++) {

            const row = list[i] || [];

            const codeGroup =
                String(row[codeIndex] === undefined ? '' : row[codeIndex]).trim();

            const subGroup = subIndex === -1
                ? ''
                : String(row[subIndex] === undefined ? '' : row[subIndex]).trim();

            const name =
                String(row[nameIndex] === undefined ? '' : row[nameIndex]).trim();

            // แถวว่างข้ามเงียบ ๆ ไม่ต้องนับเป็นรายการที่ผิดพลาด
            if (!codeGroup && !subGroup && !name) continue;

            records.push({
                codeGroup: codeGroup,
                subGroup: subGroup,
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

        if (result.updated > 0) {
            parts.push('อัปเดต ' + result.updated + ' รายการ');
        }

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
                ['Code Group', 'Sub Group', 'Name']
            ];

            list.forEach(function (record) {
                rows.push([
                    record.code_group || '',
                    record.sub_group || '',
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
                    'ไม่พบข้อมูลในไฟล์ — ต้องมีคอลัมน์ Code Group และ Name ' +
                    '(Sub Group เว้นว่างได้)',
                    'error'
                );

                return;
            }

            if (!(await scope.AppDialog.confirm(
                'พบ ' + list.length + ' แถวในไฟล์ "' +
                (file.name || '') + '"\n\n' +
                'ระบบจะอัปเดตกลุ่มย่อยของรายการเดิม ' +
                '(จับคู่ด้วย Code Group + Name) ' +
                'ส่วนรายการใหม่จะถูกเพิ่ม ' +
                'และข้ามรายการที่ซ้ำกันในไฟล์\n' +
                'ต้องการนำเข้าหรือไม่?',
                { title: 'ยืนยันการนำเข้า Excel', okText: 'นำเข้า' }
            ))) {

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

            // กลุ่ม/กลุ่มย่อยที่เจอในไฟล์ถูกเพิ่มเข้าฐานข้อมูลแล้ว — โหลดมาแสดงด้วย
            await refreshMasterGroups();

            master.setExcelStatus(
                describeImportResult(result),
                result.inserted > 0 ? 'ok' : 'warn'
            );

            // นำเข้า Excel = ล้าง popup/สถานะค้าง กันช่องกรอกถูกบัง
            resetInteractionState();

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

        scope.PageModal.close('masterModal');
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

        // เปิดฟอร์มแก้ไขในโมดัล
        scope.PageModal.open('masterModal');
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

            resetInteractionState();

            scope.PageModal.close('masterModal');

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
            !(await scope.AppDialog.confirm(
                'ต้องการลบข้อมูล Master นี้ใช่ไหม?',
                { title: 'ยืนยันการลบ', okText: 'ลบ', danger: true }
            ))
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

            resetInteractionState();

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'ลบไม่สำเร็จ: ' +
                error.message
            );
        }
    }

    // ลบแถวจากตาราง (แถวจริง) + ฐานข้อมูล
    async function onDeleteMasterTableRow(recordId) {

        if (!recordId) {
            return;
        }

        if (
            !(await scope.AppDialog.confirm(
                'ต้องการลบแถวข้อมูลนี้ใช่ไหม?',
                { title: 'ยืนยันการลบ', okText: 'ลบ', danger: true }
            ))
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

            master.setTableStatus(
                'ลบแถวแล้ว',
                'ok'
            );

            await refreshMasterList();

            resetInteractionState();

        } catch (error) {

            console.error(error);

            await scope.AppDialog.alert(
                'ลบไม่สำเร็จ: ' +
                (error && error.message ? error.message : error)
            );

            if (master) {
                master.setTableStatus(
                    'ลบไม่สำเร็จ',
                    'error'
                );
            }
        }
    }

    // บันทึกการเปลี่ยนแปลงทั้งหมดจากตาราง (รวมแถวใหม่ + แก้ไขแถวเดิม)
    async function onSaveMasterTable() {

        const master =
            getComponent(MASTER_PAGE);

        if (!master) {
            await scope.AppDialog.alert('ไม่พบหน้า Master Data');
            return;
        }

        const rows =
            master.readTableRows 
                ? master.readTableRows()
                : [];

        if (rows.length === 0) {
            master.setTableStatus(
                'ไม่มีแถวให้บันทึก',
                'error'
            );
            return;
        }

        // ตรวจสอบความถูกต้อง: ทุกแถวต้องมี Code Group และ Name
        const invalidRows = rows.filter(function (row) {
            return !row.codeGroup || !row.name;
        });

        if (invalidRows.length > 0) {
            master.setTableStatus(
                'มีแถวที่กรอกไม่ครบ — ต้องการ Code Group และ Name (พบ ' +
                invalidRows.length + ' แถว)',
                'error'
            );
            return;
        }

        master.setExcelBusy(true);
        master.setTableStatus('กำลังบันทึก...');

        try {

            await ensureDb();

            // แบ่งเป็นกลุ่ม: แก้ไขแถวเดิม (id > 0) และเพิ่มแถวใหม่ (id = 0)
            const toUpdate = rows.filter(function (row) { return row.id > 0; });
            const toInsert = rows.filter(function (row) { return row.id === 0; });

            // บันทึกแบบ batch: อัปเดตแถวเดิมทีละรายการ, เพิ่มแถวใหม่ทีละรายการ
            for (const row of toUpdate) {
                await scope.Db.masterSave({
                    id: row.id,
                    codeGroup: row.codeGroup,
                    subGroup: row.subGroup,
                    name: row.name
                });
            }

            for (const row of toInsert) {
                await scope.Db.masterSave({
                    id: 0,
                    codeGroup: row.codeGroup,
                    subGroup: row.subGroup,
                    name: row.name
                });
            }

            // ล้าง pending rows หลังบันทึกสำเร็จ
            if (master.resetForm) {
                master.resetForm();
            }

            // รีโหลดรายการจากฐานข้อมูล
            await refreshMasterList();

            // ถ้ากำลังอยู่ในโหมดตาราง ให้ render แถวใหม่จาก records ที่อัปเดตแล้ว
            if (master.setViewMode && master.isTableMode && master.isTableMode()) {
                master.renderTableRows(master.records || []);
            }

            master.setExcelBusy(false);
            master.setTableStatus(
                'บันทึกเรียบร้อย (' + rows.length + ' แถว)',
                'ok'
            );

            resetInteractionState();

        } catch (error) {

            console.error(error);

            master.setExcelBusy(false);
            master.setTableStatus(
                'บันทึกไม่สำเร็จ: ' +
                (error && error.message ? error.message : error),
                'error'
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

        // ล้างการเลือก template ใน dropdown (เฉพาะหน้ารายงาน)
        const templateSelect =
            document.getElementById('templateSelect');

        if (templateSelect) {
            templateSelect.value = '';
        }

        const component =
            getComponent(
                currentPage
            );

        // หน้าที่จัดการ UI เอง (standalone เช่น หน้าฐานข้อมูล) ไม่มีช่องไฟล์ .docx
        if (component.resetFileInput) {

            component.resetFileInput();
        }

        // ล้างค่าแล้วเริ่มแม่แบบใหม่ = ยังไม่มีไฟล์ในมือ
        // หน้า Template Configuration จึงต้องมีช่องเลือกไฟล์ .docx กลับมา
        if (component.setFilePickerVisible) {

            component.setFilePickerVisible(true);
        }

        applyMeta(
            currentPage
        );

        fillForm(
            currentPage
        );
    }

    // หลังนำเข้าฐานข้อมูลใหม่ (หน้าฐานข้อมูล): ข้อมูลในหน่วยความจำเป็นของฐานข้อมูลเก่า
    // ทั้งแม่แบบที่โหลดอยู่ ค่าที่กรอกไว้ และรายการที่อ่านมาแล้ว จึงล้างทิ้งแล้วอ่านใหม่
    function reloadAllData() {

        resetAll();

        refreshTemplateList();
        refreshMasterGroups();
        refreshMasterList();
        refreshWordList();
        refreshHistory();
        refreshDatabaseInfo();
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

        // เริ่มฟอร์ม template ใหม่ (ล้าง state + ไฟล์)
        // ใช้โดยหน้า Template Configuration ตอนกด "+ สร้างแม่แบบใหม่"
        resetAll:
            resetAll,

        // ส่งออกค่าตั้งของแม่แบบที่เปิดอยู่เป็น JSON
        // (ไอคอนมุมบนขวาของหน้าแก้ไข)
        exportTemplateSettings:
            onExportTemplateSettings,

        // นำเข้าค่าตั้งจากข้อความ JSON — ใช้เฉพาะ field ที่ชื่อตรงกัน
        // content = เนื้อหาไฟล์ (คืน true เมื่อนำเข้าสำเร็จ)
        importTemplateSettings:
            importTemplateSettingsText,

        // อ่านข้อมูลทุกหน้าจากฐานข้อมูลใหม่
        // ใช้โดยหน้าฐานข้อมูลหลังนำเข้าไฟล์ฐานข้อมูลทับของเดิม
        reloadAllData:
            reloadAllData,

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

        // regex ที่ใช้ดึงข้อมูลของแต่ละ field
        // (ตั้งค่าในหน้า "ตั้งค่าแม่แบบ" → ปุ่ม "ข้อมูล")
        getFieldPatterns:
            function () {

                const config =
                    getComponent(
                        CONFIG_PAGE
                    );

                return (
                    config &&
                    config.getPatterns
                )
                    ? config.getPatterns()
                    : {};
            },

        // จำนวนตัวอักษรสูงสุดต่อบรรทัดของ type List
        // หน้ารายงานใช้ตัดข้อความตอนสร้างเอกสาร
        getListLimits:
            function () {

                const config =
                    getComponent(
                        CONFIG_PAGE
                    );

                return (
                    config &&
                    config.getListLimits
                )
                    ? config.getListLimits(
                        getPageValues(CONFIG_PAGE)
                    )
                    : {};
            },

        // ชื่อกลุ่ม (Group) ของ type List
        // list ที่ใช้ชื่อกลุ่มเดียวกันจะแสดงเป็นแถวเดียวกันที่หน้ารายงาน
        getListGroups:
            function () {

                const config =
                    getComponent(
                        CONFIG_PAGE
                    );

                return (
                    config &&
                    config.getListGroups
                )
                    // ต้องส่ง type จาก state ของหน้า config ไปด้วย
                    // (ตอนอยู่หน้ารายงาน #form เป็นฟอร์มของหน้ารายงาน
                    //  อ่าน type จาก DOM จึงได้ค่าว่าง)
                    ? config.getListGroups(
                        getPageValues(CONFIG_PAGE)
                    )
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

