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

        // ─────────────────────────────
        // File
        // ─────────────────────────────

        saveFile: (payload) =>
            ipcRenderer.invoke(
                "file:save",
                payload
            )
    }
);