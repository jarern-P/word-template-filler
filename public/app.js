
// Main App - state, navigation และการประสานงานระหว่าง module
(function (scope) {
    'use strict';

    const DEFAULT_PAGE = 'report';
    const CONFIG_PAGE = 'template-config';
    const MASTER_PAGE = 'master-data';

    // หัวคอลัมน์ที่ยอมรับในไฟล์ Excel ของหน้า Master Data
    // เทียบหลังตัดช่องว่าง/ขีด/ขีดล่าง และแปลงเป็นตัวพิมพ์เล็กแล้ว
    const MASTER_CODE_HEADERS = ['codegroup', 'กลุ่ม', 'กลุ่มรหัส', 'รหัสกลุ่ม'];
    const MASTER_NAME_HEADERS = ['name', 'ชื่อ', 'ชื่อข้อมูล'];

    // ชื่อหน้า -> ชื่อ component บน window (ลำดับโหลดอยู่ใน index.html)
    const PAGE_COMPONENTS = {
        'report': 'ReportPage',
        'template-config': 'TemplateConfigPage',
        'master-data': 'MasterDataPage'
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

        // ล้างสถานะ "ล็อกตำแหน่ง" ที่ติ๊กไว้ในหน้า Template Configuration
        const config =
            getComponent(CONFIG_PAGE);

        if (
            config &&
            config.setLocks
        ) {
            config.setLocks(null);
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
    function fillForm(page) {

        // หน้าที่ไม่ผูกกับไฟล์ .docx (เช่น Master Data) วาด UI เองทั้งหมด
        if (getComponent(page).standalone) {
            return;
        }

        const component =
            getComponent(page);

        if (!state.loaded) {

            component.showEmptyState();
            component.hideButtons();

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

        if (component.setSaveEnabled) {
            component.setSaveEnabled(true);
        }
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

    function bindMainEvents() {

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

                const target =
                    event.target;

                if (!target) {
                    return;
                }

                const id =
                    target.id;

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

                if (id === 'masterSaveBtn') {

                    onSaveMaster();
                    return;
                }

                if (id === 'masterCancelBtn') {

                    onCancelMasterEdit();
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

        refreshTemplateList();
        refreshMasterList();
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
                locks
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
                defaultTemplateName(
                    state.fileName
                ) + '-filled.docx'
            );

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
                        config.getValues(),

                    locks:
                        config.getLocks()

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

        renderPage(
            DEFAULT_PAGE
        );

        refreshTemplateList();
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
            }
    };

})(window);

