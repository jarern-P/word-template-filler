
// Main App - state, navigation และการประสานงานระหว่าง module
(function (scope) {
    'use strict';

    const DEFAULT_PAGE = 'report';
    const CONFIG_PAGE = 'template-config';

    // ชื่อหน้า -> ชื่อ component บน window (ลำดับโหลดอยู่ใน index.html)
    const PAGE_COMPONENTS = {
        'report': 'ReportPage',
        'template-config': 'TemplateConfigPage'
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
    let templateRecords = null;   // cache รายการ template ล่าสุดจากฐานข้อมูล

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

        if (
            config &&
            config.setDbStatus
        ) {

            config.setDbStatus(
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

        if (target.dataset.field) {

            // ใช้ตัวอ่านค่าร่วมกับ FormPage
            // เพื่อให้ checkbox/textarea ตรงกัน
            getPageValues(
                currentPage
            )[target.dataset.field] =
                scope.FormPage.readControlValue(
                    target
                );

            // อัปเดตข้อความกำกับ
            // เช่น วันที่แบบไทย
            const component =
                getComponent(currentPage);

            if (component.refreshPreviews) {
                component.refreshPreviews();
            }

        } else if (target.dataset.persist) {

            getPageMeta(
                currentPage
            )[target.dataset.persist] =
                target.value;
        }
    }

    function bindMainEvents() {

        mainEl.addEventListener(
            'change',
            function (event) {

                const target =
                    event.target;

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

                captureValue(
                    event.target
                );
            }
        );

        mainEl.addEventListener(
            'click',
            function (event) {

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

                const action =
                    target.dataset &&
                    target.dataset.action;

                const recordId =
                    Number(
                        target.dataset &&
                        target.dataset.id
                    );

                if (action === 'load') {

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
    }

    // ──────────────────────────────────────────────────────────────
    // File / Template handlers
    // ──────────────────────────────────────────────────────────────

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
        const xml =
            scope.Replace.replaceFields(
                state.xml,
                values
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
                        config.getValues()

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

