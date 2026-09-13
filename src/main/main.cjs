const {
    app,
    BrowserWindow,
    ipcMain,
    dialog
} = require("electron");

const fs = require("fs");
const path = require("path");
const {
    Worker
} = require("worker_threads");

// ============================================================
// Data Path
// ============================================================

function getDataPath() {

    // Development
    if (!app.isPackaged) {
        return path.join(
            app.getAppPath(),
            "data"
        );
    }

    // Production
    // data อยู่ข้าง .exe
    return path.join(
        path.dirname(process.execPath),
        "data"
    );
}


// ============================================================
// DB Worker
// ============================================================

const dbWorkerPath = path.join(
    __dirname,
    "db",
    "db-worker.cjs"
);

const dbDataPath = getDataPath();

const dbWorker = new Worker(
    dbWorkerPath,
    {
        workerData: {
            dbDataPath: dbDataPath
        }
    }
);


// ============================================================
// DB Request Management
// ============================================================

let requestId = 0;

const pendingRequests = new Map();


// ============================================================
// DB Ready
// ============================================================

let dbReadyResolve;
let dbReadyReject;

const dbReadyPromise = new Promise(
    (resolve, reject) => {
        dbReadyResolve = resolve;
        dbReadyReject = reject;
    }
);


// ============================================================
// Worker Message
// ============================================================

dbWorker.on("message", (message) => {

    console.log(
        "DB Worker:",
        message
    );


    // --------------------------------------------------------
    // Worker Ready
    // --------------------------------------------------------

    if (message.type === "ready") {

        if (message.ok) {

            dbReadyResolve(message);

        } else {

            dbReadyReject(
                new Error(
                    message.error ||
                    "เปิดฐานข้อมูลไม่สำเร็จ"
                )
            );

        }

        return;
    }


    // --------------------------------------------------------
    // Request Response
    // --------------------------------------------------------

    if (
        message.id &&
        pendingRequests.has(message.id)
    ) {

        const request =
            pendingRequests.get(message.id);

        pendingRequests.delete(
            message.id
        );


        if (message.ok === false) {

            request.reject(
                new Error(
                    message.error ||
                    "คำสั่งฐานข้อมูลล้มเหลว"
                )
            );

            return;
        }


        request.resolve(message);
    }

});


// ============================================================
// Worker Error
// ============================================================

dbWorker.on("error", (error) => {

    console.error(
        "DB Worker error:",
        error
    );


    for (
        const request
        of pendingRequests.values()
    ) {

        request.reject(error);

    }


    pendingRequests.clear();


    dbReadyReject(error);
});


// ============================================================
// Worker Exit
// ============================================================

dbWorker.on("exit", (code) => {

    console.log(
        `DB Worker exited with code ${code}`
    );

});


// ============================================================
// Send Request To Worker
// ============================================================

function dbRequest(
    type,
    payload = {}
) {

    return new Promise(
        (resolve, reject) => {

            const id =
                ++requestId;


            pendingRequests.set(
                id,
                {
                    resolve,
                    reject
                }
            );


            dbWorker.postMessage({
                id,
                type,
                payload
            });

        }
    );
}


// ============================================================
// Create Window
// ============================================================

function createWindow() {

    const win =
        new BrowserWindow({

            width: 1200,
            height: 800,

            minWidth: 1000,
            minHeight: 700,


            webPreferences: {

                contextIsolation: true,

                nodeIntegration: false,

                preload:
                    path.join(
                        __dirname,
                        "preload.cjs"
                    )

            }

        });


    win.loadURL(
        "http://localhost:5173"
    );


    win.webContents.openDevTools();

}


// ============================================================
// App Info
// ============================================================

ipcMain.handle(
    "app:get-info",
    () => {

        return {

            name:
                "Word Template Filler",

            version:
                "1.0.0",

            message:
                "Hello from Electron Main"

        };

    }
);


// ============================================================
// DB Init
// ============================================================

ipcMain.handle(
    "db:init",
    async () => {

        try {

            const result =
                await dbReadyPromise;


            return {

                ok: true,

                persistent:
                    result.persistent,

                dbPath:
                    result.dbPath

            };

        } catch (error) {

            return {

                ok: false,

                error:
                    error?.message ||
                    String(error)

            };

        }

    }
);


// ============================================================
// DB Save
// ============================================================

ipcMain.handle(
    "db:save",
    async (
        event,
        payload
    ) => {

        try {

            await dbReadyPromise;


            const result =
                await dbRequest(
                    "save",
                    payload
                );


            return result;

        } catch (error) {

            return {

                ok: false,

                error:
                    error?.message ||
                    String(error)

            };

        }

    }
);


// ============================================================
// DB List
// ============================================================

ipcMain.handle(
    "db:list",
    async () => {

        try {

            await dbReadyPromise;


            const result =
                await dbRequest(
                    "list",
                    {}
                );


            return result;

        } catch (error) {

            return {

                ok: false,

                error:
                    error?.message ||
                    String(error)

            };

        }

    }
);


// ============================================================
// DB Get
// ============================================================

ipcMain.handle(
    "db:get",
    async (
        event,
        id
    ) => {

        try {

            await dbReadyPromise;


            const result =
                await dbRequest(
                    "get",
                    {
                        id
                    }
                );


            return result;

        } catch (error) {

            return {

                ok: false,

                error:
                    error?.message ||
                    String(error)

            };

        }

    }
);


// ============================================================
// DB Remove
// ============================================================

ipcMain.handle(
    "db:remove",
    async (
        event,
        id
    ) => {

        try {

            await dbReadyPromise;


            const result =
                await dbRequest(
                    "delete",
                    {
                        id
                    }
                );


            return result;

        } catch (error) {

            return {

                ok: false,

                error:
                    error?.message ||
                    String(error)

            };

        }

    }
);
// ============================================================
// File
// ============================================================

ipcMain.handle(
    "file:save",
    async function (_event, payload) {

        try {

            if (!payload) {
                throw new Error(
                    "ไม่ได้รับข้อมูลไฟล์"
                );
            }

            const fileName =
                String(
                    payload.fileName ||
                    "document.docx"
                );

            const data =
                payload.data;

            if (!data) {
                throw new Error(
                    "ไม่ได้รับข้อมูลไฟล์"
                );
            }

            const result =
                await dialog.showSaveDialog({
                    title: "บันทึกเอกสาร",
                    defaultPath: fileName,
                    filters: [
                        {
                            name: "Word Document",
                            extensions: ["docx"]
                        }
                    ]
                });

            // ผู้ใช้กด Cancel
            if (result.canceled) {
                return {
                    ok: true,
                    canceled: true
                };
            }

            if (!result.filePath) {
                return {
                    ok: true,
                    canceled: true
                };
            }

            const buffer =
                Buffer.from(
                    data
                );

            await fs.promises.writeFile(
                result.filePath,
                buffer
            );

            return {
                ok: true,
                canceled: false,
                filePath:
                    result.filePath
            };

        } catch (error) {

            console.error(
                "file:save error:",
                error
            );

            return {
                ok: false,
                error:
                    error.message ||
                    "บันทึกไฟล์ไม่สำเร็จ"
            };
        }
    }
);


// ============================================================
// App Lifecycle
// ============================================================

app.whenReady().then(() => {

    createWindow();


    app.on(
        "activate",
        () => {

            if (
                BrowserWindow
                    .getAllWindows()
                    .length === 0
            ) {

                createWindow();

            }

        }
    );

});


app.on(
    "window-all-closed",
    () => {

        if (
            process.platform !== "darwin"
        ) {

            app.quit();

        }

    }
);