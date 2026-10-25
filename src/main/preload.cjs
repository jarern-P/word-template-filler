const {
    contextBridge,
    ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld(
    "electronAPI",
    {
        // App
        getAppInfo: () =>
            ipcRenderer.invoke("app:get-info"),

        // Database API
        dbInit: () =>
            ipcRenderer.invoke("db:init"),

        dbSave: (payload) =>
            ipcRenderer.invoke("db:save", payload),

        dbList: () =>
            ipcRenderer.invoke("db:list"),

        dbGet: (id) =>
            ipcRenderer.invoke("db:get", id),

        dbRemove: (id) =>
            ipcRenderer.invoke("db:remove", id),

        // หน้า Query — รัน SQL ตรงกับฐานข้อมูล (CRUD)
        dbQuery: (payload) =>
            ipcRenderer.invoke("db:query", payload),

        // โครงสร้างตาราง/วิว (แถบด้านซ้ายของหน้า Query)
        dbSchema: () =>
            ipcRenderer.invoke("db:schema"),

        dbMasterSave: (payload) =>
            ipcRenderer.invoke("db:master-save", payload),

        dbMasterList: () =>
            ipcRenderer.invoke("db:master-list"),

        dbMasterGet: (id) =>
            ipcRenderer.invoke("db:master-get", id),

        dbMasterDelete: (id) =>
            ipcRenderer.invoke("db:master-delete", id),

        // นำเข้าข้อมูล master หลายรายการพร้อมกัน (จากไฟล์ Excel)
        dbMasterImport: (payload) =>
            ipcRenderer.invoke("db:master-import", payload),

        // กลุ่ม / กลุ่มย่อย ของ Master Data (กำหนดไว้ล่วงหน้า)
        dbGroupList: () =>
            ipcRenderer.invoke("db:group-list"),

        dbGroupSave: (payload) =>
            ipcRenderer.invoke("db:group-save", payload),

        dbGroupDelete: (id) =>
            ipcRenderer.invoke("db:group-delete", id),

        dbSubgroupSave: (payload) =>
            ipcRenderer.invoke("db:subgroup-save", payload),

        dbSubgroupDelete: (id) =>
            ipcRenderer.invoke("db:subgroup-delete", id),

        // คำที่เพิ่มเองสำหรับการแนะนำคำ
        dbWordSave: (payload) =>
            ipcRenderer.invoke("db:word-save", payload),

        dbWordList: () =>
            ipcRenderer.invoke("db:word-list"),

        dbWordDelete: (id) =>
            ipcRenderer.invoke("db:word-delete", id),

        // ประวัติการกรอก (ใช้กดใช้ซ้ำในหน้ารายงาน)
        dbHistoryAdd: (payload) =>
            ipcRenderer.invoke("db:history-add", payload),

        // payload = { retentionDays } — ลบรายการที่เก่ากว่ากำหนดไปด้วยตอนอ่าน
        dbHistoryList: (payload) =>
            ipcRenderer.invoke("db:history-list", payload),

        dbHistoryPrune: (payload) =>
            ipcRenderer.invoke("db:history-prune", payload),

        dbHistoryDelete: (id) =>
            ipcRenderer.invoke("db:history-delete", id),

        dbHistoryClear: () =>
            ipcRenderer.invoke("db:history-clear"),

        // ── ไฟล์ฐานข้อมูล (สำรอง / ย้ายเครื่อง) ──

        // ตำแหน่ง/ขนาด/จำนวนข้อมูลของฐานข้อมูลปัจจุบัน
        dbInfo: () =>
            ipcRenderer.invoke("db:info"),

        // ดาวน์โหลดสำเนาฐานข้อมูลไปเก็บไว้ (ได้ไฟล์ในโฟลเดอร์ Downloads)
        dbExport: () =>
            ipcRenderer.invoke("db:export"),

        // ตรวจไฟล์ฐานข้อมูลที่จะนำเข้า — payload = { data }
        dbImportPrepare: (payload) =>
            ipcRenderer.invoke("db:import-prepare", payload),

        // แทนที่ฐานข้อมูลเดิมด้วยไฟล์ที่ตรวจไว้
        dbImportApply: () =>
            ipcRenderer.invoke("db:import-apply"),

        // ทิ้งไฟล์ที่ตรวจไว้ (ผู้ใช้ยกเลิก)
        dbImportDiscard: () =>
            ipcRenderer.invoke("db:import-discard"),

        // ─────────────────────────────
        // File
        // ─────────────────────────────

        saveFile: (payload) =>
            ipcRenderer.invoke(
                "file:save",
                payload
            ),

        // ดึงข้อความจากไฟล์ PDF (ใช้กับปุ่ม "ข้อมูล")
        // payload = { data, joinLines } — คืน { ok, text, joined, ocrPages, ocrError }
        // หน้าที่เป็นรูป (ไฟล์สแกน) ถูก OCR ด้วย PaddleOCR ตามค่าที่ตั้งไว้
        extractPdfText: (payload) =>
            ipcRenderer.invoke(
                "file:extract-pdf",
                payload
            ),

        // ─────────────────────────────
        // Document Layout / Reading Order
        // ─────────────────────────────

        // วิเคราะห์โครงสร้าง PDF (PP-DocLayoutV2 ในเครื่อง)
        // payload = { data } — คืน { ok, pageCount, pages, text }
        // pages[].regions[] เรียงตามลำดับการอ่านแล้ว พร้อมข้อความของแต่ละบล็อก
        analyzePdfLayout: (payload) =>
            ipcRenderer.invoke(
                "pdf:layout",
                payload
            ),

        // ความคืบหน้า { stage: 'download'|'init'|'layout'|'ocr', page, pageCount, ... }
        onPdfLayoutProgress: (callback) => {
            if (typeof callback !== "function") return;

            ipcRenderer.on(
                "pdf:layout-progress",
                (event, progress) => callback(progress)
            );
        },

        offPdfLayoutProgress: () => {
            ipcRenderer.removeAllListeners(
                "pdf:layout-progress"
            );
        },

        // ─────────────────────────────
        // OCR
        // ─────────────────────────────

        // ค่าตั้งผู้ให้บริการ OCR ของเครื่องนี้ (data/ocr-config.json)
        ocrGetConfig: () =>
            ipcRenderer.invoke("ocr:config-get"),

        ocrSaveConfig: (payload) =>
            ipcRenderer.invoke("ocr:config-save", payload),

        // ไลบรารี/โมเดลพร้อมใช้หรือยัง (ไม่โหลดโมเดล)
        ocrStatus: () =>
            ipcRenderer.invoke("ocr:status"),

        // เริ่ม OCR ล่วงหน้า — ครั้งแรกจะดาวน์โหลดโมเดล (~15 MB)
        ocrPrepare: () =>
            ipcRenderer.invoke("ocr:prepare"),

        // PaddleOCR-VL (Local AI) — engine llama.cpp + โมเดลในเครื่อง
        ocrVlStatus: () =>
            ipcRenderer.invoke("ocr:vl-status"),

        // ดาวน์โหลด engine/โมเดลครั้งแรก (~1.8 GB) แล้วเริ่มเซิร์ฟเวอร์
        ocrVlPrepare: () =>
            ipcRenderer.invoke("ocr:vl-prepare"),

        // ถอนการติดตั้ง — หยุดเซิร์ฟเวอร์แล้วลบ engine/โมเดลออกจากเครื่อง
        ocrVlRemove: () =>
            ipcRenderer.invoke("ocr:vl-remove"),

        // ความคืบหน้าการดาวน์โหลด PaddleOCR-VL
        // callback ได้ { stage, label, received, total, percent }
        onOcrVlProgress: (callback) => {
            if (typeof callback !== "function") return;

            ipcRenderer.on(
                "ocr:vl-progress",
                (event, progress) => callback(progress)
            );
        },

        offOcrVlProgress: () => {
            ipcRenderer.removeAllListeners(
                "ocr:vl-progress"
            );
        },

        // ─────────────────────────────
        // Post-OCR (ปรับข้อความหลัง OCR)
        // ─────────────────────────────

        // สถานะโมเดล Qwen2.5-3B ในเครื่อง
        // ({ ready, runtimeReady, modelReady, modelBytes, running, modelPath })
        postOcrStatus: () =>
            ipcRenderer.invoke("post-ocr:status"),

        // ดาวน์โหลดโมเดลครั้งแรก (~2 GB)
        postOcrPrepare: () =>
            ipcRenderer.invoke("post-ocr:prepare"),

        postOcrRemove: () =>
            ipcRenderer.invoke("post-ocr:remove"),

        // payload = { text, engine? } — engine ไม่ส่ง = ใช้ค่าที่บันทึกไว้
        // คืน { ok, text, engine, chunks, sentences, warnings }
        postOcrProcess: (payload) =>
            ipcRenderer.invoke(
                "post-ocr:process",
                payload
            ),

        // ความคืบหน้า { stage: 'download'|'chunk'|'done', percent, ... }
        onPostOcrProgress: (callback) => {
            if (typeof callback !== "function") return;

            ipcRenderer.on(
                "post-ocr:progress",
                (event, progress) => callback(progress)
            );
        },

        offPostOcrProgress: () => {
            ipcRenderer.removeAllListeners(
                "post-ocr:progress"
            );
        },

        // ความคืบหน้าระหว่างอ่าน PDF
        // callback ได้ { page, pageCount, status: 'reading' | 'ocr' | 'ocr-prepare', progress }
        onPdfExtractProgress: (callback) => {
            if (typeof callback !== "function") return;

            ipcRenderer.on(
                "file:extract-pdf-progress",
                (event, progress) => callback(progress)
            );
        },

        // เลิกฟังความคืบหน้าทั้งหมด (เรียกตอนปิดกล่อง)
        offPdfExtractProgress: () => {
            ipcRenderer.removeAllListeners(
                "file:extract-pdf-progress"
            );
        }
    }
);