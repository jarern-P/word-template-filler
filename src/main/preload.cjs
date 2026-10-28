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

        // ── คำเฉพาะ (ปกปิดก่อนส่ง AI) ──

        // รายการคำ/pattern ที่ตั้งไว้ในหน้า "คำเฉพาะ"
        privacyList: () =>
            ipcRenderer.invoke("privacy:list"),

        // payload = { id, name, kind, pattern, enabled, require_known }
        // id = 0 คือเพิ่มใหม่ — ส่งมาเฉพาะฟิลด์ที่เปลี่ยนก็ได้ ที่เหลือใช้ค่าเดิม
        privacySave: (payload) =>
            ipcRenderer.invoke("privacy:save", payload),

        privacyDelete: (id) =>
            ipcRenderer.invoke("privacy:delete", id),

        // ค่าตั้งที่ใช้ร่วมกัน: % ความคล้ายขั้นต่ำ · สวิตช์ส่ง pattern · จำนวนคำในระบบ
        // คืน { ok, minSimilarity, defaultMinSimilarity, sendPatterns, knownWords }
        privacySettingsGet: () =>
            ipcRenderer.invoke("privacy:settings-get"),

        // payload = { minSimilarity?, sendPatterns? } — ส่งเฉพาะฟิลด์ที่เปลี่ยน
        // คืน { ok, minSimilarity, sendPatterns }
        privacySettingsSave: (payload) =>
            ipcRenderer.invoke("privacy:settings-save", payload),

        // ทดสอบการปกปิดกับข้อความตัวอย่าง — payload = { text, terms, minSimilarity }
        // คืน { ok, result: { text, count, placeholders, errors, minSimilarity, knownWords } }
        privacyPreview: (payload) =>
            ipcRenderer.invoke("privacy:preview", payload),

        // ตรวจว่าจะถูกปกปิดอะไรบ้างก่อนกด "ปรับปรุง" — payload = { text }
        // สแกนข้อความ + ข้อมูลอ้างอิงจากฐานข้อมูล ไม่เรียก AI
        // คืน { ok, result: { text, context, count, contextCount, placeholders,
        //                     items: [{ placeholder, value }], unmatched, errors } }
        privacyInspect: (payload) =>
            ipcRenderer.invoke("privacy:inspect", payload),

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
        // Improve Text (ปรับปรุงข้อความ — ตรวจคำผิด + จัดเป็น Key-Value)
        // ─────────────────────────────

        // payload = { text, fields } — ใช้ API key + โมเดลของ Gemini ที่บันทึกไว้ในหน้า ตั้งค่า OCR
        // fields = ฟิลด์ของแม่แบบ [{ name, type, placeholder }]
        //          (แนบเป็น key พร้อมชนิด/ตัวอย่างใน prompt ตามสวิตช์ในหน้า ตั้งค่าแม่แบบ)
        // คืน { ok, text, model, chunks }
        //
        // นอกจากนี้ยังส่ง context raw text จากฐานข้อมูล (ข้อมูลหลัก + คลังคำ)
        // ไปพร้อมกับ prompt อัตโนมัติ (ไม่ต้องทำอะไรที่ฝั่ง renderer)
        //
        // คำเฉพาะที่เปิดใช้ในหน้า "คำเฉพาะ" ถูกแทนด้วยตัวแปรก่อนส่ง
        // และถูกแทนคืนในคำตอบ — จำนวนจุดที่ปกปิดมาที่ response.masked
        ocrImproveText: (payload) =>
            ipcRenderer.invoke("ocr:improve", payload),

        // สวิตช์ "ส่งชื่อฟีลด์ของแม่แบบไปใน prompt" (หน้า ตั้งค่าแม่แบบ)
        // คืน { ok, sendFields }
        improveSettingsGet: () =>
            ipcRenderer.invoke("improve:settings-get"),

        // payload = { sendFields } — คืน { ok, sendFields }
        improveSettingsSave: (payload) =>
            ipcRenderer.invoke("improve:settings-save", payload),

        // ความคืบหน้าเมื่อข้อความยาวและถูกแบ่งเป็นก้อน { stage, index, total }
        onImproveProgress: (callback) => {
            if (typeof callback !== "function") return;

            ipcRenderer.on(
                "ocr:improve-progress",
                (event, progress) => callback(progress)
            );
        },

        offImproveProgress: () => {
            ipcRenderer.removeAllListeners(
                "ocr:improve-progress"
            );
        },

        // ─────────────────────────────
        // OCR Training (หน้า ฝึก OCR)
        // ─────────────────────────────

        // payload = { status, search, limit } — คืน { lines, shown, matched, stats }
        ocrTrainingList: (payload) =>
            ipcRenderer.invoke(
                "ocr-training:list",
                payload
            ),

        // เก็บบรรทัดจากไฟล์ที่อัปโหลด — payload = { source, lines }
        ocrTrainingAdd: (payload) =>
            ipcRenderer.invoke(
                "ocr-training:add",
                payload
            ),

        // บันทึกข้อความที่แก้แล้ว — payload = { id, output }
        ocrTrainingSave: (payload) =>
            ipcRenderer.invoke(
                "ocr-training:save",
                payload
            ),

        // เพิ่มบรรทัดใหม่ด้วยตนเอง (หน้าฝึก OCR — ปุ่ม "เพิ่มเอง")
        // payload = { source, input, output }
        //   input  = บรรทัดที่ OCR อ่านผิด (target)
        //   output = คำที่ต้องการ — ใส่แล้วจะเป็นคู่ฝึกที่ใช้ได้ทันที
        //   source ถ้าไม่ใส่จะใช้ "เพิ่มเอง"
        ocrTrainingAddManual: (payload) =>
            ipcRenderer.invoke(
                "ocr-training:add-manual",
                payload
            ),

        ocrTrainingSkip: (id) =>
            ipcRenderer.invoke(
                "ocr-training:skip",
                id
            ),

        // นำบรรทัดที่ข้ามไว้กลับมารอตรวจ
        ocrTrainingRestore: (id) =>
            ipcRenderer.invoke(
                "ocr-training:restore",
                id
            ),

        ocrTrainingRemove: (id) =>
            ipcRenderer.invoke(
                "ocr-training:remove",
                id
            ),

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