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
// Locale
// ============================================================

// บังคับให้ Chromium ใช้ locale ไทย
//
// <input type="date"> (ช่อง "วันที่" ในหน้าเลือกวันที่ + รูปแบบ) แสดง วัน/เดือน/ปี
// ตาม locale ของโปรเซส ไม่ใช่ตามที่แอปกำหนด — เครื่องที่ตั้ง Windows เป็น en-US
// จึงเห็นเป็น เดือน/วัน/ปี (10/16/2026) ซึ่งกลับลำดับกับที่เอกสารใช้
// สั่ง locale ไทยแล้วช่องนั้นจะแสดง 16/10/2026 (ปียังเป็น ค.ศ. ตามค่าของช่อง)
//
// ไม่มี attribute หรือ CSS ใดกำหนดรูปแบบนี้ได้ และต้องสั่งก่อน app.whenReady()
app.commandLine.appendSwitch(
    "lang",
    "th-TH"
);


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


// Development             -> <project>/data
// Portable .exe           -> <โฟลเดอร์ของ .exe>/data
// ติดตั้งด้วย Setup .exe  -> userData/data
//
// ทำไมติดตั้งแล้วไม่เก็บไว้ข้าง .exe:
//   ตอนกดรัน Setup .exe ซ้ำ ตัวติดตั้งจะเรียก uninstaller ของเวอร์ชันเดิม
//   ซึ่งย้ายและลบทั้งโฟลเดอร์ติดตั้ง
//   (app-builder-lib/templates/nsis/uninstaller.nsh: isUpdated -> atomicRMDir + RMDir /r $INSTDIR)
//   ไฟล์ที่แอปสร้างเองในโฟลเดอร์นั้น (data/templates.db) จึงถูกลบไปด้วย
//   เก็บใน userData แทน -> รัน Setup ซ้ำ = อัปเดตตัวแอป ไม่แตะข้อมูลเดิม
function getDataPath() {

    // Development
    if (!app.isPackaged) {

        return path.join(
            app.getAppPath(),
            "data"
        );
    }


    // Portable: ตั้งใจให้พกข้อมูลไปกับ .exe
    const portableDir =
        process.env.PORTABLE_EXECUTABLE_DIR;

    if (portableDir) {

        const portableData =
            path.join(
                portableDir,
                "data"
            );

        if (isWritableDir(portableData)) {
            return portableData;
        }
    }


    // ติดตั้งด้วย Setup .exe
    return path.join(
        app.getPath("userData"),
        "data"
    );
}


// ============================================================
// ย้ายฐานข้อมูลจากตำแหน่งเดิม
// ============================================================

const DB_FILE = "templates.db";


// เวอร์ชันก่อนเก็บ data ไว้ข้าง .exe (ในโฟลเดอร์ติดตั้ง) ซึ่งถูกลบตอนติดตั้งทับ
// จึงคัดลอกฐานข้อมูลเดิมมาไว้ที่ใหม่ให้ก่อน
// ทำงานครั้งเดียว: ถ้าปลายทางมี templates.db อยู่แล้วจะไม่แตะอะไรเลย
function migrateLegacyDatabase(targetDir) {

    if (!app.isPackaged) {
        return;
    }


    if (
        fs.existsSync(
            path.join(targetDir, DB_FILE)
        )
    ) {
        return;
    }


    const legacyDir =
        path.join(
            path.dirname(process.execPath),
            "data"
        );


    // Portable ใช้โฟลเดอร์เดียวกับปลายทางอยู่แล้ว จึงไม่มีอะไรต้องย้าย
    if (
        path.resolve(legacyDir) ===
        path.resolve(targetDir)
    ) {
        return;
    }


    if (
        !fs.existsSync(
            path.join(legacyDir, DB_FILE)
        )
    ) {
        return;
    }


    try {

        fs.mkdirSync(
            targetDir,
            {
                recursive: true
            }
        );


        // -wal / -shm ถ้ามีต้องย้ายมาคู่กัน ไม่งั้นข้อมูลที่ค้างใน wal หาย
        [
            "",
            "-wal",
            "-shm"
        ].forEach(suffix => {

            const from =
                path.join(
                    legacyDir,
                    DB_FILE + suffix
                );

            if (fs.existsSync(from)) {

                fs.copyFileSync(
                    from,
                    path.join(
                        targetDir,
                        DB_FILE + suffix
                    )
                );
            }
        });


        console.log(
            "Migrated database:",
            legacyDir,
            "->",
            targetDir
        );

    } catch (error) {

        // ย้ายไม่ได้ก็ยังเปิดฐานข้อมูลใหม่ได้ (ข้อมูลเดิมยังอยู่ที่เดิม)
        console.error(
            "ย้ายฐานข้อมูลเดิมไม่สำเร็จ:",
            error
        );
    }
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


    migrateLegacyDatabase(dbDataPath);


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
// DB Query (หน้า Query — รัน SQL ตรงกับ SQLite)
// ============================================================

ipcMain.handle(
    "db:query",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "query",
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
// DB Schema (โครงสร้างตาราง/วิว ของหน้า Query)
// ============================================================

ipcMain.handle(
    "db:schema",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "schema",
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
// DB Group List
// ============================================================

ipcMain.handle(
    "db:group-list",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "group-list",
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
// DB Group Save
// ============================================================

ipcMain.handle(
    "db:group-save",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "group-save",
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
// DB Group Delete
// ============================================================

ipcMain.handle(
    "db:group-delete",
    async (
        event,
        id
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "group-delete",
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
// DB Sub Group Save
// ============================================================

ipcMain.handle(
    "db:subgroup-save",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "subgroup-save",
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
// DB Sub Group Delete
// ============================================================

ipcMain.handle(
    "db:subgroup-delete",
    async (
        event,
        id
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "subgroup-delete",
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
// DB Word Save
// ============================================================

ipcMain.handle(
    "db:word-save",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "word-save",
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
// DB Word List
// ============================================================

ipcMain.handle(
    "db:word-list",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "word-list",
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
// DB Word Delete
// ============================================================

ipcMain.handle(
    "db:word-delete",
    async (
        event,
        id
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "word-delete",
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
// DB OCR Fixes (คำที่ OCR อ่านผิด)
// ============================================================

ipcMain.handle(
    "db:ocr-fix-list",
    async () => {

        try {

            await dbReady();

            return await dbRequest(
                "ocr-fix-list",
                {}
            );

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


ipcMain.handle(
    "db:ocr-fix-save",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();

            return await dbRequest(
                "ocr-fix-save",
                payload
            );

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


ipcMain.handle(
    "db:ocr-fix-delete",
    async (
        event,
        wrong
    ) => {

        try {

            await dbReady();

            return await dbRequest(
                "ocr-fix-delete",
                { wrong }
            );

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


ipcMain.handle(
    "db:ocr-fix-stat",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();

            return await dbRequest(
                "ocr-fix-stat",
                payload
            );

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

// จำนวนเลขท้ายชื่อไฟล์สูงสุดที่ลองหา "ชื่อว่าง" ก่อนยอมแพ้
const MAX_DOWNLOAD_NAME_TRIES = 1000;


// เขียนไฟล์ลงโฟลเดอร์ที่กำหนด โดยไม่ทับไฟล์เดิม
//   report.docx -> report (1).docx -> report (2).docx
// ใช้ flag "wx" (สร้างไฟล์ใหม่เท่านั้น) จึงเช็คกับเขียนเป็นจังหวะเดียวกัน
// ชื่อที่ซ้ำจริงจะได้ EEXIST แล้วลองเลขถัดไป — พฤติกรรมเดียวกับ browser download
async function writeDownloadFile(dir, fileName, buffer) {

    const ext =
        path.extname(fileName);

    const base =
        path.basename(fileName, ext) ||
        "document";


    for (
        let index = 0;
        index < MAX_DOWNLOAD_NAME_TRIES;
        index++
    ) {

        const name =
            index === 0
                ? base + ext
                : base + " (" + index + ")" + ext;

        const filePath =
            path.join(dir, name);


        try {

            await fs.promises.writeFile(
                filePath,
                buffer,
                {
                    flag: "wx"
                }
            );

            return filePath;

        } catch (error) {

            // ชื่อซ้ำ = ลองเลขถัดไป
            if (
                error &&
                error.code === "EEXIST"
            ) {
                continue;
            }

            throw error;
        }
    }


    throw new Error(
        "ตั้งชื่อไฟล์ไม่สำเร็จ (ชื่อซ้ำ " +
        MAX_DOWNLOAD_NAME_TRIES +
        " ชื่อ)"
    );
}


ipcMain.handle(
    "file:save",
    async function (event, payload) {

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


            // เซฟลงโฟลเดอร์ Downloads ของผู้ใช้ตรง ๆ (ไม่เปิดกล่องบันทึกของ Windows)
            // ชื่อไฟล์มาจาก renderer แล้ว (ชื่อเรื่อง -> ชื่อแม่แบบ -> ชื่อไฟล์ต้นฉบับ)
            // ถ้าชื่อซ้ำจะเติมเลข (1), (2) ให้เอง
            const dir =
                app.getPath("downloads");

            await fs.promises.mkdir(
                dir,
                {
                    recursive: true
                }
            );


            const filePath =
                await writeDownloadFile(
                    dir,
                    fileName,
                    Buffer.from(data)
                );


            console.log(
                "Saved file:",
                filePath
            );


            return {
                ok: true,
                canceled: false,
                filePath,
                // ชื่อจริงที่ได้ (อาจมีเลข (1) ต่อท้าย) ไว้ให้ renderer แจ้งผู้ใช้
                fileName:
                    path.basename(filePath)
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
// File Text (ดึงข้อความจาก PDF)
// ============================================================
//
// ปุ่ม "ข้อมูล" ของหน้ารายงาน/ตั้งค่าแม่แบบให้ผู้ใช้อัปโหลด PDF
// แล้วเอา regex ของแต่ละ field ไปจับค่าจากข้อความที่ได้
// (ไฟล์ .docx อ่านใน renderer ด้วย JSZip — ดู public/dataExtract.js)
//
// PDF ที่เกิดจากการสแกนไม่มีชั้นข้อความ pdf-text.cjs จึงเรนเดอร์หน้าเป็นรูป
// แล้ว OCR ให้ (tesseract.js) — ผู้ใช้ไม่ต้องทำอะไรเพิ่ม

// ใช้ปิด OCR worker ตอนปิดแอป (worker เป็น thread ที่ค้างอยู่ได้)
let pdfOcrUsed = false;

ipcMain.handle(
    "file:extract-pdf",
    async function (event, payload) {

        try {

            const data =
                payload && payload.data;

            if (!data) {
                throw new Error(
                    "ไม่ได้รับข้อมูลไฟล์"
                );
            }

            // โหลด pdf.js ตอนใช้ครั้งแรก — ถ้าไลบรารีมีปัญหา
            // แอปส่วนอื่นยังเปิดได้ปกติ (เฉพาะการอ่าน PDF ที่ล้มเหลว)
            const { extractPdfText } =
                require("./pdf-text.cjs");

            pdfOcrUsed = true;

            // หน้าไหนไม่มีชั้นข้อความ (ไฟล์สแกน) จะถูก OCR ให้อัตโนมัติ
            // ระหว่างนั้นส่งความคืบหน้ากลับไปให้หน้าจอด้วย
            const result =
                await extractPdfText(
                    data,
                    {
                        // เย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่ (ปิดได้จากหน้าจอ)
                        joinLines: !payload || payload.joinLines !== false,
                        onProgress: function (progress) {

                            if (event.sender.isDestroyed()) {
                                return;
                            }

                            event.sender.send(
                                "file:extract-pdf-progress",
                                progress
                            );
                        }
                    }
                );


            return {
                ok: true,
                text: result.text,
                // เลขหน้าที่ต้องใช้ OCR (ว่าง = ไฟล์มีชั้นข้อความครบ)
                ocrPages: result.ocrPages,
                // ภาพหน้า + กล่องคำสำหรับหน้าจอ "ตรวจคำบน PDF"
                // (ว่าง = ไม่มีหน้าไหนต้อง OCR)
                pages: result.pages || [],
                // เหตุผลที่ OCR ไม่สำเร็จ (ถ้ามี) — ข้อความที่เหลือยังใช้ได้
                ocrError: result.ocrError,
                // จำนวนจุดที่เย็บบรรทัดที่ถูกตัดเข้าด้วยกัน
                joined: result.joined || 0
            };

        } catch (error) {

            console.error(
                "file:extract-pdf error:",
                error
            );

            return {
                ok: false,
                error:
                    error?.message ||
                    "อ่านข้อความจาก PDF ไม่สำเร็จ"
            };
        }
    }
);


// ============================================================
// Database File (สำรอง / ย้ายเครื่อง)
// ============================================================
//
// ไฟล์ฐานข้อมูลจริงชื่อ templates.db ที่โฟลเดอร์ data ของแอป (แอปเป็นคนกำหนดที่และชื่อ)
// หน้าที่ของฝั่งนี้:
//   db:info           -> ตำแหน่ง/ขนาด/จำนวนข้อมูลของฐานข้อมูลปัจจุบัน
//   db:export         -> คัดลอกฐานข้อมูลออกมาเป็นไฟล์ใน Downloads
//   db:import-prepare -> ตรวจไฟล์ที่ผู้ใช้เลือก (ยังไม่แทนที่)
//   db:import-apply   -> สลับไฟล์ที่ตรวจแล้วเข้าแทนที่ฐานข้อมูลเดิม
//   db:import-discard -> ทิ้งไฟล์ที่ตรวจไว้ (ผู้ใช้ยกเลิก)

// ชื่อไฟล์สำรอง: templates-2026-10-16.db (วันที่ของเครื่องผู้ใช้)
function databaseBackupFileName() {

    const now =
        new Date();

    const pad =
        value => String(value).padStart(2, "0");


    return (
        DB_FILE.replace(/\.db$/i, "") +
        "-" +
        now.getFullYear() +
        "-" +
        pad(now.getMonth() + 1) +
        "-" +
        pad(now.getDate()) +
        ".db"
    );
}


// ------------------------------------------------------------
// ตำแหน่ง/ขนาด/จำนวนข้อมูลของฐานข้อมูลปัจจุบัน
// ------------------------------------------------------------

ipcMain.handle(
    "db:info",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "database-info",
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


// ------------------------------------------------------------
// ดาวน์โหลดฐานข้อมูล (สำรองข้อมูล / ย้ายไปเครื่องอื่น)
// ------------------------------------------------------------

ipcMain.handle(
    "db:export",
    async () => {

        try {

            await dbReady();


            const exported =
                await dbRequest(
                    "export-database",
                    {}
                );


            // เซฟลงโฟลเดอร์ Downloads เหมือนไฟล์ .docx ของหน้ารายงาน
            // (ชื่อซ้ำในวันเดียวกันจะเติมเลข (1), (2) ให้เอง)
            const dir =
                app.getPath("downloads");

            await fs.promises.mkdir(
                dir,
                {
                    recursive: true
                }
            );


            const filePath =
                await writeDownloadFile(
                    dir,
                    databaseBackupFileName(),
                    Buffer.from(
                        exported.result.data
                    )
                );


            console.log(
                "Exported database:",
                filePath
            );


            return {

                ok: true,

                result: {

                    filePath,

                    // ชื่อจริงที่ได้ (อาจมีเลข (1) ต่อท้าย)
                    fileName:
                        path.basename(filePath),

                    byteLength:
                        exported.result.byteLength
                }
            };

        } catch (error) {

            console.error(
                "db:export error:",
                error
            );

            return {

                ok: false,

                error:
                    error?.message ||
                    String(error)

            };

        }

    }
);


// ------------------------------------------------------------
// ตรวจไฟล์ฐานข้อมูลที่จะนำเข้า (ยังไม่แตะฐานข้อมูลเดิม)
// ------------------------------------------------------------

ipcMain.handle(
    "db:import-prepare",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const prepared =
                await dbRequest(
                    "prepare-import",
                    {
                        data:
                            payload &&
                            payload.data
                    }
                );


            return prepared;

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


// ------------------------------------------------------------
// แทนที่ฐานข้อมูลเดิมด้วยไฟล์ที่ตรวจไว้
// ------------------------------------------------------------

ipcMain.handle(
    "db:import-apply",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "apply-import",
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


// ------------------------------------------------------------
// ทิ้งไฟล์ที่ตรวจไว้ (ผู้ใช้ยกเลิกการนำเข้า)
// ------------------------------------------------------------

ipcMain.handle(
    "db:import-discard",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "discard-import",
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
// DB History Add
// ============================================================

ipcMain.handle(
    "db:history-add",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "history-add",
                    payload || {}
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
// DB History List
// ============================================================

ipcMain.handle(
    "db:history-list",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "history-list",
                    payload || {}
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
// DB History Prune (ลบรายการที่เก่ากว่ากำหนด)
// ============================================================

ipcMain.handle(
    "db:history-prune",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "history-prune",
                    payload || {}
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
// DB History Delete
// ============================================================

ipcMain.handle(
    "db:history-delete",
    async (
        event,
        id
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "history-delete",
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
// DB History Clear (ล้างประวัติทั้งหมด)
// ============================================================

ipcMain.handle(
    "db:history-clear",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "history-clear",
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
// App Lifecycle
// ============================================================

// ปิด tesseract worker ก่อนจบโปรเซส (ถ้าเคย OCR)
// ไม่ให้มี thread/หน่วยความจำค้างหลังปิดหน้าต่างสุดท้าย
app.on(
    "before-quit",
    () => {

        if (!pdfOcrUsed) {
            return;
        }

        try {
            require("./pdf-ocr.cjs")
                .disposeOcr();
        } catch (error) {
            // ปิดไม่ทันก็ไม่เป็นไร โปรเซสจะจบอยู่แล้ว
        }
    }
);


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