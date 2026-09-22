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

function isWritableDir(dir) {

    try {

        fs.mkdirSync(
            dir,
            {
                recursive: true
            }
        );

        fs.accessSync(
            dir,
            fs.constants.W_OK
        );

        return true;

    } catch (error) {

        return false;
    }
}


// Development            -> <project>/data
// Portable .exe          -> <โฟลเดอร์ของ .exe>/data
// เขียนไม่ได้ (ติดตั้ง)  -> userData/data
function getDataPath() {

    const candidates =
        app.isPackaged
            ? [
                path.join(
                    process.env.PORTABLE_EXECUTABLE_DIR ||
                    path.dirname(process.execPath),
                    "data"
                ),
                path.join(
                    app.getPath("userData"),
                    "data"
                )
            ]
            : [
                path.join(
                    app.getAppPath(),
                    "data"
                )
            ];


    for (const dir of candidates) {

        if (isWritableDir(dir)) {
            return dir;
        }
    }


    return candidates[candidates.length - 1];
}


// ============================================================
// DB Worker
// ============================================================

// worker เป็นไฟล์ .cjs ที่อ่านจาก asar ตรง ๆ ไม่ได้
// จึงอ้าง path จาก app.asar.unpacked (ดู asarUnpack ใน package.json)
function getDbWorkerPath() {

    if (app.isPackaged) {

        return path.join(
            process.resourcesPath,
            "app.asar.unpacked",
            "src",
            "main",
            "db",
            "db-worker.cjs"
        );
    }

    return path.join(
        __dirname,
        "db",
        "db-worker.cjs"
    );
}


let dbWorker = null;
let dbReadyPromise = null;
let dbReadyResolve = null;
let dbReadyReject = null;
let dbDataPath = "";


function dbReady() {

    if (!dbReadyPromise) {

        return Promise.reject(
            new Error("DB Worker ยังไม่เริ่มทำงาน")
        );
    }

    return dbReadyPromise;
}


function startDbWorker() {

    dbDataPath = getDataPath();

    console.log(
        "Data path:",
        dbDataPath
    );


    dbReadyPromise = new Promise(
        (resolve, reject) => {
            dbReadyResolve = resolve;
            dbReadyReject = reject;
        }
    );


    // แจ้งให้ผู้ใช้เห็นว่าเปิดฐานข้อมูลไม่ได้เพราะอะไร
    // แทนที่จะเงียบ ๆ แล้วเหลือ UI ที่ใช้งานไม่ได้
    dbReadyPromise.catch((error) => {

        console.error(
            "เปิดฐานข้อมูลไม่สำเร็จ:",
            error
        );

        dialog.showErrorBox(
            "เปิดฐานข้อมูลไม่สำเร็จ",
            `ตำแหน่งไฟล์: ${dbDataPath}\n\n${error?.message || String(error)}`
        );
    });


    dbWorker = new Worker(
        getDbWorkerPath(),
        {
            workerData: {
                dbDataPath: dbDataPath
            }
        }
    );


    dbWorker.on(
        "message",
        onDbWorkerMessage
    );

    dbWorker.on(
        "error",
        onDbWorkerError
    );

    dbWorker.on(
        "exit",
        onDbWorkerExit
    );


    return dbReadyPromise;
}

// ============================================================
// DB Request Management
// ============================================================

let requestId = 0;

const pendingRequests = new Map();


// ============================================================
// Worker Message
// ============================================================

function onDbWorkerMessage(message) {

    console.log(
        "DB Worker:",
        message.type || message.id
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
}


// ============================================================
// Worker Error
// ============================================================

function onDbWorkerError(error) {

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
}


// ============================================================
// Worker Exit
// ============================================================

function onDbWorkerExit(code) {

    console.log(
        `DB Worker exited with code ${code}`
    );

}


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

    const win = new BrowserWindow({
        width: 1400,
        height: 900,

        webPreferences: {
            preload: path.join(
                __dirname,
                "preload.cjs"
            ),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    if (app.isPackaged) {

        win.loadFile(
            path.join(
                app.getAppPath(),
                "dist",
                "index.html"
            )
        );

    } else {

        win.loadURL(
            "http://localhost:5173"
        );
    }

    return win;
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
                await dbReady();


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

            await dbReady();


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

            await dbReady();


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

            await dbReady();


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

            await dbReady();


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
// DB Master Save
// ============================================================

ipcMain.handle(
    "db:master-save",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "master-save",
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
// DB Master List
// ============================================================

ipcMain.handle(
    "db:master-list",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "master-list",
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
// DB Master Get
// ============================================================

ipcMain.handle(
    "db:master-get",
    async (
        event,
        id
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "master-get",
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
// DB Master Remove
// ============================================================

ipcMain.handle(
    "db:master-delete",
    async (
        event,
        id
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "master-delete",
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
// DB Master Import
// ============================================================

ipcMain.handle(
    "db:master-import",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "master-import",
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

    startDbWorker();

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