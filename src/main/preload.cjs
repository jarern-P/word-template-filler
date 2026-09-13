const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    getAppInfo: () => ipcRenderer.invoke("app:get-info"),

    pingDatabase: () => ipcRenderer.invoke("db:ping"),
    
    getSqliteVersion: () =>
        ipcRenderer.invoke("db:sqlite-version"),

    checkDatabaseSchema: () =>
    ipcRenderer.invoke("db:check-schema")
});