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

        // คำที่ OCR อ่านผิด -> คำที่ถูกต้อง (หน้า "ฝึก OCR" และการแทนคำอัตโนมัติ)
        dbOcrFixList: () =>
            ipcRenderer.invoke("db:ocr-fix-list"),

        dbOcrFixSave: (payload) =>
            ipcRenderer.invoke("db:ocr-fix-save", payload),

        dbOcrFixDelete: (wrong) =>
            ipcRenderer.invoke("db:ocr-fix-delete", wrong),

        // อัปเดตตัวนับ hits/accepted/rejected หลายรายการพร้อมกัน
        dbOcrFixStat: (payload) =>
            ipcRenderer.invoke("db:ocr-fix-stat", payload),

        // กลุ่มคำที่ถูกตัดข้ามบรรทัด (ใช้ก่อนจับ regex)
        dbOcrGroupList: () =>
            ipcRenderer.invoke("db:ocr-group-list"),

        dbOcrGroupSave: (payload) =>
            ipcRenderer.invoke("db:ocr-group-save", payload),

        dbOcrGroupDelete: (tokens) =>
            ipcRenderer.invoke("db:ocr-group-delete", tokens),

        dbOcrGroupStat: (payload) =>
            ipcRenderer.invoke("db:ocr-group-stat", payload),

        // คำที่ OCR เก็บเกิน (สระ/วรรณยุกต์ที่ถูกแยกเป็นคำ) — ตัดออกตอนอ่านไฟล์
        dbOcrDropList: () =>
            ipcRenderer.invoke("db:ocr-drop-list"),

        dbOcrDropSave: (payload) =>
            ipcRenderer.invoke("db:ocr-drop-save", payload),

        dbOcrDropDelete: (word) =>
            ipcRenderer.invoke("db:ocr-drop-delete", word),

        // ลำดับการอ่าน/คอลัมน์ที่ฝึกไว้ (ใช้กับหน้า OCR ที่มีหลายคอลัมน์)
        dbOcrLayoutList: () =>
            ipcRenderer.invoke("db:ocr-layout-list"),

        dbOcrLayoutSave: (payload) =>
            ipcRenderer.invoke("db:ocr-layout-save", payload),

        dbOcrLayoutDelete: (id) =>
            ipcRenderer.invoke("db:ocr-layout-delete", id),

        // ── AI ช่วยแก้ OCR (Gemini) ──

        // ค่าที่ใช้แสดงผล — ไม่มี API key ส่งกลับ (บอกแค่ว่ามีอยู่หรือไม่)
        ocrAiGetConfig: () =>
            ipcRenderer.invoke("ocr:ai-get-config"),

        // payload = { enabled, model, prompt, apiKey?, clearKey? }
        // ไม่ส่ง apiKey = คง key เดิม, clearKey = true = ลบ key
        ocrAiSaveConfig: (payload) =>
            ipcRenderer.invoke("ocr:ai-save-config", payload),

        // ลองเรียกโมเดลด้วยคำขอย่อย — คืน { ok, model, message } หรือ { ok:false, error }
        ocrAiTest: () =>
            ipcRenderer.invoke("ocr:ai-test"),

        // สถิติการเรียนรู้ (ผังหน้าที่เก็บไว้ / คำที่ AI ช่วยแก้ / คลังอื่น ๆ)
        dbOcrAiStats: () =>
            ipcRenderer.invoke("db:ocr-ai-stats"),

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
        // payload = { data, joinLines } — คืน { ok, text, ocrPages, ocrError, pages, joined }
        // หรือ { ok:false, error }
        // (หน้าไหนไม่มีชั้นข้อความ จะถูก OCR ให้อัตโนมัติ — pages มีภาพ+ตำแหน่งคำ)
        extractPdfText: (payload) =>
            ipcRenderer.invoke(
                "file:extract-pdf",
                payload
            ),

        // ความคืบหน้าระหว่างอ่าน PDF (รวมขั้นตอน OCR)
        // callback ได้ { page, pageCount, status: 'reading'|'ocr', progress }
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