
// Main App - state, navigation และการประสานงานระหว่าง module
(function (scope) {
    'use strict';

    const DEFAULT_PAGE = 'report';
    const CONFIG_PAGE = 'template-config';
    const MASTER_PAGE = 'master-data';

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

            // อัปเดตข้อความกำกับ
            // เช่น วันที่แบบไทย
            const component =
                getComponent(currentPage);

            if (component.refreshPreviews) {
                component.refreshPreviews();
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

        const component =
            getComponent(currentPage);

        if (component.refreshPreviews) {
            component.refreshPreviews();
        }
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

        scope.Sidebar.closeMasterSubmenu();
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

    async function onSaveTemplate() {

        if (
            !state.loaded ||
            !state.docxBytes
        ) {

            alert(
                'ยังไม่ได้เลือกไฟล์ template'
            );

            return;
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

