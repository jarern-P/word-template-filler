const { app, BrowserWindow, ipcMain } = require("electron");

const { Worker } = require("worker_threads");
const path = require("path");

const dbWorker = new Worker(
    path.join(__dirname, "db", "db-worker.cjs")
);

dbWorker.on("message", (message) => {
    console.log("DB Worker:", message);
});

dbWorker.on("error", (error) => {
    console.error("DB Worker error:", error);
});

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 1000,
        minHeight: 700,

        webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: require("path").join(__dirname, "preload.cjs")
    }
    });

    win.loadURL("http://localhost:5173");

    win.webContents.openDevTools();
}

// IPC
ipcMain.handle("app:get-info", () => {
    return {
        name: "Word Template Filler",
        version: "1.0.0",
        message: "Hello from Electron Main"
    };
});

ipcMain.handle("db:ping", () => {
    return new Promise((resolve, reject) => {
        const handleMessage = (message) => {
            if (message.type !== "pong") {
                return;
            }

            dbWorker.off("message", handleMessage);

            resolve(message);
        };

        dbWorker.on("message", handleMessage);

        dbWorker.postMessage({
            type: "ping"
        });
    });
});

ipcMain.handle("db:sqlite-version", () => {
    return new Promise((resolve, reject) => {
        const handleMessage = (message) => {
            if (message.type !== "sqlite-version") {
                return;
            }

            dbWorker.off("message", handleMessage);

            resolve(message);
        };

        dbWorker.on("message", handleMessage);

        dbWorker.postMessage({
            type: "sqlite-version"
        });
    });
});

app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});