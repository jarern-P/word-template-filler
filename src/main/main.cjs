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

const ocrConfig =
    require("./ocr-config.cjs");

const ocrPaddle =
    require("./ocr-paddle.cjs");

const ocrPaddleVl =
    require("./ocr-paddle-vl.cjs");

const pdfLayout =
    require("./pdf-layout.cjs");

const ocrTraining =
    require("./ocr-training.cjs");

const ocrImprove =
    require("./ocr-improve.cjs");

const ocrImproveDifflib =
    require("./ocr-improve-difflib.cjs");

const privacyMask =
    require("./privacy-mask.cjs");


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
// OCR Config (หน้า "ตั้งค่า OCR")
// ============================================================
//
// ค่าตั้งเก็บที่ data/ocr-config.json (ไม่ปนกับฐานข้อมูล — ดู ocr-config.cjs)
//   ocr:config-get  -> อ่านค่าตั้งปัจจุบัน
//   ocr:config-save -> บันทึกค่าตั้ง
//   ocr:status      -> ตรวจว่าไลบรารี/โมเดลพร้อมใช้หรือยัง
//   ocr:prepare     -> เริ่ม OCR ล่วงหน้า (ดาวน์โหลดโมเดลครั้งแรก)
//   ocr:vl-status   -> สถานะ PaddleOCR-VL (engine + โมเดลในเครื่อง)
//   ocr:vl-prepare  -> ดาวน์โหลด engine/โมเดล PaddleOCR-VL แล้วเริ่มเซิร์ฟเวอร์
//   ocr:vl-remove   -> ถอนการติดตั้ง (หยุดเซิร์ฟเวอร์ + ลบ engine/โมเดลในเครื่อง)

ipcMain.handle(
    "ocr:config-get",
    async () => {

        try {

            return {
                ok: true,
                config: ocrConfig.read(getDataPath())
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


ipcMain.handle(
    "ocr:config-save",
    async (
        event,
        payload
    ) => {

        try {

            return {
                ok: true,
                config: ocrConfig.save(
                    getDataPath(),
                    payload
                )
            };

        } catch (error) {

            console.error(
                "ocr:config-save error:",
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


ipcMain.handle(
    "ocr:status",
    async () => {

        try {

            return {
                ok: true,
                ...ocrPaddle.status()
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


ipcMain.handle(
    "ocr:prepare",
    async () => {

        try {

            const result =
                await ocrPaddle.prepare();

            return {
                ok: true,
                ...result
            };

        } catch (error) {

            console.error(
                "ocr:prepare error:",
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


ipcMain.handle(
    "ocr:vl-status",
    async () => {

        try {

            return {
                ok: true,
                ...ocrPaddleVl.status(getDataPath())
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


ipcMain.handle(
    "ocr:vl-prepare",
    async (event) => {

        try {

            const result =
                await ocrPaddleVl.prepare(
                    getDataPath(),
                    function (progress) {

                        if (event.sender.isDestroyed()) {
                            return;
                        }

                        event.sender.send(
                            "ocr:vl-progress",
                            progress
                        );
                    }
                );

            return {
                ok: true,
                ...result
            };

        } catch (error) {

            console.error(
                "ocr:vl-prepare error:",
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


ipcMain.handle(
    "ocr:vl-remove",
    async () => {

        try {

            const result =
                await ocrPaddleVl.remove(
                    getDataPath()
                );

            return {
                ok: true,
                ...result
            };

        } catch (error) {

            console.error(
                "ocr:vl-remove error:",
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


// ============================================================
// Improve Text (ปรับปรุงข้อความ — ตรวจคำผิด + จัดเป็น Key-Value)
// ============================================================
//
// ปุ่ม "ปรับปรุง" ในกล่องใส่ข้อมูล: เลือกวิธีได้ในหน้า ตั้งค่า OCR
//   - ai      = ส่งให้ Gemini แก้คำที่ OCR อ่านผิด แล้วจัดใหม่เป็น "ชื่อฟิลด์: ค่า"
//   - difflib = เทียบคำกับข้อมูลหลัก/คลังคำ/พจนานุกรมในเครื่อง (ไม่ส่งออกนอกเครื่อง)
// ใช้ API key + โมเดลเดียวกับที่บันทึกไว้ในหน้า ตั้งค่า OCR (เฉพาะโหมด ai)
//
// นอกจากนี้ยังดึงข้อมูลจากฐานข้อมูล (ข้อมูลหลัก + คลังคำ) มาเป็น raw text
// ส่งไปพร้อมกับ prompt เพื่อให้ AI มีบริบทเพิ่มเติม

// key ในตาราง app_settings ของสวิตช์ในหน้า ตั้งค่าแม่แบบ (เก็บรวมทั้งแอป)
// - ชื่อฟิลด์ของแม่แบบ (ใช้เป็น key ของ key-value pair)
// - type + placeholder ของแต่ละฟิลด์ (ชนิด/ตัวอย่างข้อมูล)
const IMPROVE_SEND_FIELDS_KEY = "improveSendFields";
const IMPROVE_SEND_META_KEY = "improveSendFieldMeta";


// อ่านสวิตช์จาก app_settings — ยังไม่เคยตั้ง = เปิดไว้
async function loadImproveSetting(key) {

    try {

        await dbReady();

        const result =
            await dbRequest(
                "setting-get",
                { key: key }
            );

        const stored =
            result && result.result ? result.result.value : null;

        if (stored === null || stored === "") return true;

        return stored === "1" || stored === "true";

    } catch (error) {

        console.error(
            "โหลดค่าตั้งการส่งข้อมูลฟิลด์ไม่สำเร็จ (" + key + "):",
            error
        );

        return true;
    }
}


// สวิตช์ "ส่งชื่อฟิลด์ของแม่แบบไปใน prompt"
async function loadImproveSendFields() {
    return loadImproveSetting(IMPROVE_SEND_FIELDS_KEY);
}


// สวิตช์ "ส่ง type และ placeholder ของแม่แบบไปใน prompt"
async function loadImproveSendMeta() {
    return loadImproveSetting(IMPROVE_SEND_META_KEY);
}


// ค่าตั้งสวิตช์ส่งข้อมูลฟิลด์ — หน้า ตั้งค่าแม่แบบ ใช้อ่านสวิตช์
ipcMain.handle(
    "improve:settings-get",
    async function () {

        try {

            return {
                ok: true,
                sendFields: await loadImproveSendFields(),
                sendMeta: await loadImproveSendMeta()
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


// บันทึกสวิตช์ — payload = { sendFields?, sendMeta? }
// ส่งมาเฉพาะสวิตช์ที่เปลี่ยนก็ได้
ipcMain.handle(
    "improve:settings-save",
    async function (event, payload) {

        try {

            await dbReady();

            const input =
                payload && typeof payload === "object" ? payload : {};

            const hasFields =
                input.sendFields !== undefined;

            const hasMeta =
                input.sendMeta !== undefined;

            const sendFields = hasFields
                ? (input.sendFields === true || Number(input.sendFields) === 1)
                : await loadImproveSendFields();

            const sendMeta = hasMeta
                ? (input.sendMeta === true || Number(input.sendMeta) === 1)
                : await loadImproveSendMeta();

            const toSave = [];

            if (hasFields) {
                toSave.push({
                    key: IMPROVE_SEND_FIELDS_KEY,
                    value: sendFields ? "1" : "0",
                    label: "ชื่อฟิลด์"
                });
            }

            if (hasMeta) {
                toSave.push({
                    key: IMPROVE_SEND_META_KEY,
                    value: sendMeta ? "1" : "0",
                    label: "type/placeholder"
                });
            }

            for (const item of toSave) {

                const saved =
                    await dbRequest(
                        "setting-save",
                        {
                            key: item.key,
                            value: item.value
                        }
                    );

                if (!saved || saved.ok === false) {
                    throw new Error(
                        (saved && saved.error) ||
                        ("บันทึกค่าส่ง " + item.label + "ไม่สำเร็จ")
                    );
                }
            }

            return {
                ok: true,
                sendFields: sendFields,
                sendMeta: sendMeta
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


ipcMain.handle(
    "ocr:improve",
    async function (event, payload) {

        try {

            const text =
                payload && typeof payload.text === "string"
                    ? payload.text
                    : "";

            if (text.trim() === "") {
                throw new Error("ไม่มีข้อความให้ปรับปรุง");
            }

            // key จริงอยู่ใน main process เท่านั้น
            const saved = ocrConfig.readSecrets(getDataPath());

            // วิธีปรับปรุง: AI (Gemini) หรือ difflib (ในเครื่อง)
            // difflib ไม่ส่งข้อมูลออกนอกเครื่อง จึงไม่ต้องปกปิดคำเฉพาะ
            if (saved.improve?.engine === "difflib") {

                const sources = await loadImproveWordSources();

                const local =
                    ocrImproveDifflib.improveText(
                        text,
                        {
                            master: sources.master,
                            words: sources.words
                        }
                    );

                console.log(
                    "[ปรับปรุง] difflib.js แก้คำ " +
                    local.changed + " จุด" +
                    " · แทนจุดด้วยช่องว่าง " + local.dots + " จุด"
                );

                return {
                    ok: true,
                    engine: "difflib",
                    text: local.text,
                    model: "difflib.js",
                    chunks: 1,
                    usage: { input: 0, output: 0 },
                    keysUsed: 0,
                    // ไม่มีการปกปิดคำเฉพาะ (ไม่มีข้อมูลออกนอกเครื่อง)
                    masked: 0,
                    textMasked: local.text,
                    textCount: 0,
                    contextCount: 0,
                    items: [],
                    unmatched: [],
                    leftover: [],
                    enabled: 0,
                    total: 0,
                    changed: local.changed,
                    dots: local.dots,
                    phrases: local.phrases,
                    replacements: local.replacements
                };
            }

            // ดึง raw text จากฐานข้อมูล (ข้อมูลหลัก + คลังคำ)
            const contextRawText = await buildContextRawText();

            // ปกปิดคำเฉพาะ (หน้า "คำเฉพาะ") — แทนด้วยตัวแปร [[NAME_1]] เฉพาะ
            // "ข้อความต้นฉบับ" และแทนคืนตอนได้ผลลัพธ์
            //
            // ข้อมูลอ้างอิงจากฐานข้อมูล (ข้อมูลหลัก + คลังคำ) ส่งตามเดิม ไม่ถูกแทน
            // ด้วยตัวแปร — เป็นคำที่ผู้ใช้ตั้งไว้เองและ AI ต้องเห็นเพื่อเทียบคำ
            // ใช้ตัวสแกนตัวเดียวกับปุ่ม "ตรวจคำเฉพาะ" — ผลที่เห็นก่อนกดจึงตรงกัน
            const terms =
                await loadSensitiveTerms();

            const report =
                privacyMask.inspect(
                    terms,
                    [text],
                    await buildPrivacyMaskOptions(terms)
                );

            const maskedText =
                report.masked[0];

            // คำอธิบายว่าตัวแปรแต่ละตัวหมายถึงอะไร — แนบตามสวิตช์ในหน้า "คำเฉพาะ"
            // (ปิดสวิตช์ = ส่งแค่คำสั่งห้ามแก้ตัวแปร ไม่มี pattern ติดไป)
            let maskInstruction = "";

            if (report.count > 0) {
                maskInstruction = await loadPrivacySendPatterns()
                    ? privacyMask.buildMaskInstruction(report.definitions)
                    : privacyMask.MASK_INSTRUCTION;
            }

            // log ไว้ตรวจย้อนหลังได้ว่าตอนส่งจริงปกปิดอะไรไป (ค่าจริงไม่ถูก log)
            console.log(
                "[คำเฉพาะ] ส่งให้ Gemini — ปกปิด " + report.count +
                " จุด (" + report.placeholders + " ตัวแปร) จากรายการที่เปิดใช้ " +
                report.enabled + "/" + report.total +
                (report.unmatched.length > 0
                    ? " · เปิดใช้แต่ไม่พบในข้อความ: " + report.unmatched.join(", ")
                    : "")
            );

            if (report.count > 0) {
                console.log(
                    "[คำเฉพาะ] ตัวแปรที่ใช้แทน: " + report.items.map(function (item) {
                        return item.placeholder;
                    }).join(" ")
                );
            }

            console.log("[คำเฉพาะ] ข้อความที่ส่งให้ AI:\n" + maskedText);

            // ข้อมูลฟิลด์ของแม่แบบที่ส่งมาทาง payload — แนบไปใน prompt
            // ตามสวิตช์ 2 ตัวในหน้า ตั้งค่าแม่แบบ:
            // - ชื่อฟิลด์ = ใช้เป็น key ของ key-value pair
            // - type/placeholder = ชนิดและตัวอย่างข้อมูลของแต่ละฟิลด์
            const sendFieldNames =
                await loadImproveSendFields();

            const sendFieldMeta =
                await loadImproveSendMeta();

            let fieldNames = [];

            if (sendFieldNames && payload && Array.isArray(payload.fields)) {

                // ปิดสวิตช์ type/placeholder = ส่งแค่ชื่อฟิลด์
                fieldNames = sendFieldMeta
                    ? payload.fields
                    : payload.fields.map(function (item) {
                        return item && typeof item === "object"
                            ? { name: item.name }
                            : item;
                    });
            }

            if (fieldNames.length > 0) {
                console.log(
                    "[ปรับปรุง] แนบข้อมูลฟิลด์ไปใน prompt " +
                    fieldNames.length + " ฟิลด์" +
                    (sendFieldMeta ? " (มี type/placeholder)" : " (ชื่อฟิลด์เท่านั้น)")
                );
            }

            // token ที่ใช้ในรอบนี้ — สรุปให้หน้าจอ และบันทึกลงสถิติของแต่ละ key
            const usageTotals = { input: 0, output: 0 };

            const result =
                await ocrImprove.improveText(
                    maskedText,
                    {
                        // key เดียว (โครงเก่า) + รายการ key (โครงใหม่ — ใช้เป็น fallback)
                        apiKey: saved.gemini?.apiKey || "",
                        apiKeys: saved.gemini?.apiKeys || [],
                        model: saved.gemini?.model,
                        // เรียกหลังได้ token ของแต่ละก้อน — สะสมแยกตาม key
                        onUsage: function (keyId, usage) {

                            const input =
                                Math.max(0, Math.floor(Number(usage && usage.input) || 0));

                            const output =
                                Math.max(0, Math.floor(Number(usage && usage.output) || 0));

                            usageTotals.input += input;
                            usageTotals.output += output;

                            try {
                                ocrConfig.addGeminiUsage(
                                    getDataPath(),
                                    keyId,
                                    { input: input, output: output }
                                );

                            } catch (error) {
                                console.error(
                                    "บันทึก token ของ Gemini ไม่สำเร็จ:",
                                    error
                                );
                            }
                        },
                        // prompt ที่แก้ไว้ในหน้า ตั้งค่า OCR (ว่าง = ค่าเริ่มต้น)
                        prompt: saved.improve?.prompt || "",
                        contextRawText: contextRawText,
                        // มีการปกปิดจริง = บอก AI ว่าตัวแปรในวงเล็บห้ามแตะ
                        // (มีคำอธิบาย pattern ต่อท้ายเมื่อเปิดสวิตช์ในหน้า "คำเฉพาะ")
                        maskInstruction: maskInstruction,
                        // ชื่อฟิลด์ของแม่แบบ (ว่าง = ใช้ prompt ชุดเดิม)
                        fieldNames: fieldNames,
                        onProgress: function (progress) {

                            if (event.sender.isDestroyed()) {
                                return;
                            }

                            event.sender.send(
                                "ocr:improve-progress",
                                progress
                            );
                        }
                    }
                );

            console.log(
                "[คำเฉพาะ] คำตอบจาก AI (ก่อนแทนค่าคืน):\n" + result.text
            );

            const restored =
                report.restore(result.text);

            // ตัวแปรที่ AI ไม่ได้คัดลอกกลับมาตรง ๆ = ค่านั้นกู้คืนไม่ได้
            const leftover =
                privacyMask.findPlaceholders(restored);

            if (leftover.length > 0) {
                console.warn(
                    "[คำเฉพาะ] แทนค่าคืนไม่ได้ " + leftover.length +
                    " ตัวแปร (AI อาจแก้หรือตัดตัวแปรทิ้ง): " +
                    leftover.join(" ")
                );
            }

            console.log("[คำเฉพาะ] ผลลัพธ์หลังแทนค่าคืน:\n" + restored);

            return {
                ok: true,
                engine: "ai",
                ...result,
                // token ที่ใช้ในรอบนี้ (input/output) และจำนวน key ที่ได้ใช้
                usage: usageTotals,
                keysUsed: Array.isArray(result.usageByKey)
                    ? result.usageByKey.length
                    : 0,
                // แทนค่าเดิมกลับให้ผู้ใช้เห็น (AI เห็นเฉพาะตัวแปร)
                text: restored,
                masked: report.count,
                // ข้อมูลสำหรับการ์ด "คำเฉพาะ" ในกล่องใส่ข้อมูล (ตรวจย้อนหลังได้)
                textMasked: maskedText,
                textCount: report.counts[0],
                // ข้อมูลอ้างอิงไม่ถูกปกปิด — ไม่มีจุดที่ถูกแทนในบริบท
                contextCount: 0,
                items: report.items,
                unmatched: report.unmatched,
                leftover: leftover,
                enabled: report.enabled,
                total: report.total
            };

        } catch (error) {

            console.error(
                "ocr:improve error:",
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


// ============================================================
// สร้าง raw text จากฐานข้อมูล (ข้อมูลหลัก + คลังคำ)
// ============================================================
//
// ใช้ดึงข้อมูลทั้งหมดจากตาราง master และ words
// แล้วรวมเป็น raw text เดียว เพื่อส่งให้ AI ใช้เป็นบริบท

// รายการคำสำหรับ difflib: ข้อมูลหลัก + คลังคำศัพท์
// (แยกเป็นรายการเพื่อให้โมดูล difflib จัดลำดับความสำคัญได้)
async function loadImproveWordSources() {

    const master = [];
    const words = [];

    try {

        await dbReady();

        const [masterList, wordList] = await Promise.all([
            dbRequest("master-list", {}),
            dbRequest("word-list", {})
        ]);

        if (masterList && Array.isArray(masterList.result)) {
            masterList.result.forEach(function (item) {
                if (!item) return;

                // ชื่อ + กลุ่ม/กลุ่มย่อย — ช่วยแก้ชื่อหน่วยงาน/ประเภทที่ OCR อ่านผิด
                [item.name, item.code_group, item.sub_group]
                    .forEach(function (value) {
                        const text = String(value == null ? "" : value).trim();

                        if (text !== "") master.push(text);
                    });
            });
        }

        if (wordList && Array.isArray(wordList.result)) {
            wordList.result.forEach(function (item) {
                const word = String(item && item.word ? item.word : "").trim();

                if (word !== "") words.push(word);
            });
        }

    } catch (error) {

        console.error("โหลดรายการคำสำหรับ difflib ไม่สำเร็จ:", error);
    }

    return { master: master, words: words };
}


async function buildContextRawText() {
    try {
        await dbReady();

        // ดึงข้อมูลหลัก (master)
        const masterList = await dbRequest(
            "master-list",
            {}
        );

        // ดึงคลังคำ (words)
        const wordList = await dbRequest(
            "word-list",
            {}
        );

        const parts = [];

        // รวมข้อมูลหลัก
        if (masterList && Array.isArray(masterList.result)) {
            const masters = masterList.result;
            if (masters.length > 0) {
                parts.push('--- ข้อมูลหลัก (Master Data) ---');
                for (const m of masters) {
                    const codeGroup = m.code_group || '';
                    const subGroup = m.sub_group || '';
                    const name = m.name || '';
                    parts.push(`${codeGroup}${subGroup ? ' / ' + subGroup : ''} | ${name}`);
                }
                parts.push('');
            }
        }

        // รวมคลังคำ
        if (wordList && Array.isArray(wordList.result)) {
            const words = wordList.result;
            if (words.length > 0) {
                parts.push('--- คลังคำ (Word Dictionary) ---');
                for (const w of words) {
                    const word = w.word || '';
                    parts.push(word);
                }
                parts.push('');
            }
        }
        
        return parts.join('\n').trim();

    } catch (error) {
        console.error('Error building context raw text:', error);
        return '';
    }
}


// ============================================================
// คำเฉพาะ (หน้า "คำเฉพาะ" — คำ/pattern ที่ปกปิดก่อนส่ง AI)
// ============================================================
//
// รายการที่ "เปิดใช้" อยู่ถูกนำไปแทนค่าด้วยตัวแปรในข้อความทุกครั้งที่
// ส่งให้ Gemini (ปุ่ม "ปรับปรุง") เพื่อไม่ให้ข้อมูลอ่อนไหวออกนอกเครื่อง

async function loadSensitiveTerms() {

    try {

        await dbReady();

        const result =
            await dbRequest(
                "privacy-list",
                {}
            );

        return result && Array.isArray(result.result)
            ? result.result
            : [];

    } catch (error) {

        // โหลดไม่ได้ = ส่งข้อความตามเดิม (ไม่ให้การปรับปรุงข้อความล้มเหลว)
        console.error(
            "โหลดคำเฉพาะไม่สำเร็จ:",
            error
        );

        return [];
    }
}


// key ในตาราง app_settings ของ % ความคล้ายขั้นต่ำ (ใช้ร่วมกันทุกรายการ)
const PRIVACY_MIN_SIMILARITY_KEY = "privacyMinSimilarity";

// key ของสวิตช์ "ส่ง pattern ของตัวแปรไปใน prompt"
const PRIVACY_SEND_PATTERNS_KEY = "privacySendPatterns";


// % ความคล้ายขั้นต่ำที่ใช้เทียบกับคำในระบบ (ยังไม่เคยตั้ง = ค่าเริ่มต้น)
async function loadPrivacyMinSimilarity() {

    try {

        await dbReady();

        const result =
            await dbRequest(
                "setting-get",
                { key: PRIVACY_MIN_SIMILARITY_KEY }
            );

        const stored =
            result && result.result ? result.result.value : null;

        return privacyMask.sanitizeMinSimilarity(
            stored === null || stored === ""
                ? privacyMask.DEFAULT_MIN_SIMILARITY
                : stored
        );

    } catch (error) {

        console.error(
            "โหลด % ขั้นต่ำของคำเฉพาะไม่สำเร็จ:",
            error
        );

        return privacyMask.DEFAULT_MIN_SIMILARITY;
    }
}


// สวิตช์ "ส่ง pattern ของตัวแปรไปใน prompt" (หน้า "คำเฉพาะ")
// ยังไม่เคยตั้ง = เปิดไว้ (ตรงกับพฤติกรรมก่อนมีสวิตช์)
async function loadPrivacySendPatterns() {

    try {

        await dbReady();

        const result =
            await dbRequest(
                "setting-get",
                { key: PRIVACY_SEND_PATTERNS_KEY }
            );

        const stored =
            result && result.result ? result.result.value : null;

        if (stored === null || stored === "") return true;

        return stored === "1" || stored === "true";

    } catch (error) {

        console.error(
            "โหลดค่าตั้งการส่ง pattern ไม่สำเร็จ:",
            error
        );

        return true;
    }
}


// คำในระบบที่ใช้เทียบ = คลังคำ (words) + ข้อมูลหลัก (master)
async function loadKnownWords() {

    try {

        await dbReady();

        const masterList =
            await dbRequest("master-list", {});

        const wordList =
            await dbRequest("word-list", {});

        const words = [];

        if (masterList && Array.isArray(masterList.result)) {
            masterList.result.forEach(function (item) {
                if (item && item.name) words.push(item.name);
            });
        }

        if (wordList && Array.isArray(wordList.result)) {
            wordList.result.forEach(function (item) {
                if (item && item.word) words.push(item.word);
            });
        }

        return words;

    } catch (error) {

        // โหลดไม่ได้ = ไม่มีคำให้เทียบ (รายการที่ต้องมีคำในระบบจะไม่ปกปิด)
        console.error(
            "โหลดคำในระบบไม่สำเร็จ:",
            error
        );

        return [];
    }
}


// จำนวนคำในระบบ (ไม่ซ้ำ) — หน้าจอใช้แสดงว่ามีคำให้เทียบกี่คำ
function countKnownWords(list) {

    const seen = new Set();

    (Array.isArray(list) ? list : []).forEach(function (item) {
        const value = privacyMask.normalizeForCompare(item);

        if (value !== "") seen.add(value);
    });

    return seen.size;
}


// ตัวเลือกของ privacyMask.inspect — โหลดคำในระบบเฉพาะเมื่อมีรายการที่ต้องใช้
// (รายการทั่วไปจึงไม่ต้องเสียเวลาโหลดข้อมูลหลัก/คลังคำทุกครั้ง)
async function buildPrivacyMaskOptions(terms) {

    const list = Array.isArray(terms) ? terms : [];

    const needsKnown =
        list.some(function (term) {
            return privacyMask.isEnabled(term) &&
                privacyMask.isRequireKnown(term);
        });

    return {
        knownWords: needsKnown ? await loadKnownWords() : [],
        minSimilarity: await loadPrivacyMinSimilarity()
    };
}


ipcMain.handle(
    "privacy:list",
    async () => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "privacy-list",
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


ipcMain.handle(
    "privacy:save",
    async (
        event,
        payload
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "privacy-save",
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


ipcMain.handle(
    "privacy:delete",
    async (
        event,
        id
    ) => {

        try {

            await dbReady();


            const result =
                await dbRequest(
                    "privacy-delete",
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


// ค่าตั้งของหน้า "คำเฉพาะ" — % ขั้นต่ำ · สวิตช์ส่ง pattern · จำนวนคำในระบบ
ipcMain.handle(
    "privacy:settings-get",
    async function () {

        try {

            const knownWords =
                await loadKnownWords();

            return {
                ok: true,
                minSimilarity:
                    await loadPrivacyMinSimilarity(),
                defaultMinSimilarity:
                    privacyMask.DEFAULT_MIN_SIMILARITY,
                // ส่ง pattern ของตัวแปรไปใน prompt หรือไม่
                sendPatterns:
                    await loadPrivacySendPatterns(),
                knownWords: countKnownWords(knownWords)
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


// บันทึกค่าตั้งของหน้า "คำเฉพาะ" — ส่งมาเฉพาะฟิลด์ที่เปลี่ยนก็ได้
// payload = { minSimilarity, sendPatterns }
ipcMain.handle(
    "privacy:settings-save",
    async function (event, payload) {

        try {

            await dbReady();

            const input =
                payload && typeof payload === "object" ? payload : {};

            const hasMinSimilarity =
                input.minSimilarity !== undefined;

            const hasSendPatterns =
                input.sendPatterns !== undefined;

            const minSimilarity = hasMinSimilarity
                ? privacyMask.sanitizeMinSimilarity(input.minSimilarity)
                : await loadPrivacyMinSimilarity();

            const sendPatterns = hasSendPatterns
                ? (input.sendPatterns === true || Number(input.sendPatterns) === 1)
                : await loadPrivacySendPatterns();

            if (hasMinSimilarity) {

                const saved =
                    await dbRequest(
                        "setting-save",
                        {
                            key: PRIVACY_MIN_SIMILARITY_KEY,
                            value: String(minSimilarity)
                        }
                    );

                if (!saved || saved.ok === false) {
                    throw new Error(
                        (saved && saved.error) || "บันทึก % ขั้นต่ำไม่สำเร็จ"
                    );
                }
            }

            if (hasSendPatterns) {

                const saved =
                    await dbRequest(
                        "setting-save",
                        {
                            key: PRIVACY_SEND_PATTERNS_KEY,
                            value: sendPatterns ? "1" : "0"
                        }
                    );

                if (!saved || saved.ok === false) {
                    throw new Error(
                        (saved && saved.error) || "บันทึกค่าส่ง pattern ไม่สำเร็จ"
                    );
                }
            }

            return {
                ok: true,
                minSimilarity: minSimilarity,
                sendPatterns: sendPatterns
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


// ทดสอบว่าข้อความตัวอย่างถูกปกปิดหน้าตาเป็นอย่างไร
// payload = { text, terms } — terms มาจากหน้าโดยตรง (ยังไม่บันทึกก็ทดสอบได้)
// ไม่ส่ง terms มา = ใช้รายการที่บันทึกไว้
ipcMain.handle(
    "privacy:preview",
    async function (event, payload) {

        try {

            const text =
                payload && typeof payload.text === "string"
                    ? payload.text
                    : "";

            const terms =
                payload && Array.isArray(payload.terms)
                    ? payload.terms
                    : await loadSensitiveTerms();

            // ค่าที่หน้า "คำเฉพาะ" กำลังแก้อยู่ (ยังไม่บันทึก) ใช้ทดสอบได้ทันที
            const options =
                await buildPrivacyMaskOptions(terms);

            if (payload && payload.minSimilarity !== undefined) {
                options.minSimilarity =
                    privacyMask.sanitizeMinSimilarity(payload.minSimilarity);
            }

            const masker =
                privacyMask.createMasker(terms, options);

            return {
                ok: true,
                result: {
                    text: masker.mask(text),
                    count: masker.count,
                    placeholders: masker.used,
                    errors: masker.errors,
                    minSimilarity: masker.minSimilarity,
                    knownWords: masker.knownWords
                }
            };

        } catch (error) {

            console.error(
                "privacy:preview error:",
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


// ตรวจว่าจะถูกปกปิดอะไรบ้างก่อนส่งจริง — ไม่เรียก AI และไม่ส่งข้อมูลออก
//
// ใช้กับปุ่ม "ตรวจคำเฉพาะ" ในกล่องใส่ข้อมูล: สแกน "ข้อความต้นฉบับ"
// ด้วยรายการเดียวกับตอนกด "ปรับปรุง" (ข้อมูลอ้างอิงจากฐานข้อมูลไม่ถูกปกปิด)
// แต่คืนเฉพาะผลการตรวจให้ดู — ยังไม่ส่งอะไรให้ Gemini
ipcMain.handle(
    "privacy:inspect",
    async function (event, payload) {

        try {

            const text =
                payload && typeof payload.text === "string"
                    ? payload.text
                    : "";

            if (text.trim() === "") {
                throw new Error("ไม่มีข้อความให้ตรวจ");
            }

            // บริบทชุดเดียวกับที่ส่งให้ AI ตอนกด "ปรับปรุง"
            const contextRawText =
                await buildContextRawText();

            // ตัวสแกนตัวเดียวกับที่ใช้ตอนส่งจริง (ocr:improve)
            const terms =
                await loadSensitiveTerms();

            const report =
                privacyMask.inspect(
                    terms,
                    [text],
                    await buildPrivacyMaskOptions(terms)
                );

            console.log(
                "[คำเฉพาะ] ตรวจก่อนส่ง — ปกปิด " + report.count + " จุด (" +
                report.placeholders + " ตัวแปร) จากรายการที่เปิดใช้ " +
                report.enabled + "/" + report.total +
                " · ข้อมูลอ้างอิงไม่ถูกปกปิด"
            );

            return {
                ok: true,
                result: {
                    text: report.masked[0],
                    // บริบทที่ AI เห็นตอนส่งจริง — ไม่ถูกปกปิด
                    context: contextRawText,
                    count: report.counts[0],
                    contextCount: 0,
                    placeholders: report.placeholders,
                    items: report.items,
                    unmatched: report.unmatched,
                    errors: report.errors,
                    enabled: report.enabled,
                    total: report.total
                }
            };

        } catch (error) {

            console.error(
                "privacy:inspect error:",
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


// ============================================================
// OCR Training (ฝึก OCR — เก็บบรรทัดจากไฟล์ + คู่ผิด → ถูก)
// ============================================================
//
// หน้าดึงข้อมูลส่งบรรทัดที่อ่านได้จากไฟล์ที่อัปโหลดมาเก็บไว้
// ผู้ใช้มาแก้ในหน้า ฝึก OCR แล้วเก็บคู่ "ผิด → ถูก" ไว้ในคลัง

ipcMain.handle(
    "ocr-training:list",
    async function (event, payload) {

        try {

            return {
                ok: true,
                ...ocrTraining.list(
                    getDataPath(),
                    payload
                )
            };

        } catch (error) {

            console.error(
                "ocr-training:list error:",
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


ipcMain.handle(
    "ocr-training:add",
    async function (event, payload) {

        try {

            const input =
                payload && typeof payload === "object"
                    ? payload
                    : {};

            return {
                ok: true,
                ...ocrTraining.addLines(
                    getDataPath(),
                    input.source,
                    input.lines
                )
            };

        } catch (error) {

            console.error(
                "ocr-training:add error:",
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


ipcMain.handle(
    "ocr-training:save",
    async function (event, payload) {

        try {

            const input =
                payload && typeof payload === "object"
                    ? payload
                    : {};

            return {
                ok: true,
                line: ocrTraining.saveCorrection(
                    getDataPath(),
                    input.id,
                    input.output
                )
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


ipcMain.handle(
    "ocr-training:skip",
    async function (event, id) {

        try {

            return {
                ok: true,
                line: ocrTraining.setStatus(
                    getDataPath(),
                    id,
                    "skipped"
                )
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


ipcMain.handle(
    "ocr-training:restore",
    async function (event, id) {

        try {

            return {
                ok: true,
                line: ocrTraining.setStatus(
                    getDataPath(),
                    id,
                    "new"
                )
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
);ipcMain.handle(
    "ocr-training:remove",
    async function (event, id) {

        try {

            return {
                ok: true,
                ...ocrTraining.remove(
                    getDataPath(),
                    id
                )
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


ipcMain.handle(
    "ocr-training:add-manual",
    async function (event, payload) {

        try {

            const input =
                payload && typeof payload === "object"
                    ? payload
                    : {};

            const result = ocrTraining.addManual(
                getDataPath(),
                input.source,
                input.input,
                input.output
            );

            return {
                ok: true,
                ...result
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


ipcMain.handle(
    "ocr-training:filter",
    async function (event, payload) {

        try {

            return {
                ok: true,
                ...ocrTraining.sourceCounts(
                    getDataPath(),
                    payload
                )
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
// Document Layout (วิเคราะห์โครงสร้าง + ลำดับการอ่าน)
// ============================================================
//
// pdf:layout -> รับเนื้อไฟล์ PDF คืนบล็อกของแต่ละหน้า (ตามลำดับการอ่าน)
// พร้อมข้อความของแต่ละบล็อก — หน้าที่ยังมีชั้นข้อความใช้พิกัดจากไฟล์ตรง ๆ
// หน้าที่เป็นรูปสแกนจะ OCR เฉพาะบล็อกด้วย PP-OCRv5 ในเครื่อง
// โมเดล PP-DocLayoutV2 (~213 MB) ดาวน์โหลดครั้งแรกที่ใช้

ipcMain.handle(
    "pdf:layout",
    async function (event, payload) {

        try {

            const data =
                payload && payload.data;

            if (!data) {
                throw new Error("ไม่ได้รับข้อมูลไฟล์");
            }

            const result =
                await pdfLayout.analyzePdf(
                    data,
                    {
                        dataPath: getDataPath(),
                        joinLines:
                            Boolean(payload && payload.joinLines),
                        onProgress: function (progress) {
                            if (event.sender.isDestroyed()) {
                                return;
                            }

                            event.sender.send(
                                "pdf:layout-progress",
                                progress
                            );
                        }
                    }
                );

            return {
                ok: true,
                ...result
            };

        } catch (error) {

            console.error(
                "pdf:layout error:",
                error
            );

            return {
                ok: false,
                error:
                    error?.message ||
                    "วิเคราะห์โครงสร้างเอกสารไม่สำเร็จ"
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
// อ่านชั้นข้อความที่ฝังอยู่ในไฟล์ก่อน — หน้าที่เป็นรูป (ไฟล์สแกน)
// จะถูก OCR ด้วย PaddleOCR ในเครื่องให้อัตโนมัติ (ตั้งค่าได้ที่หน้า "ตั้งค่า OCR")

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

            // ค่าตั้ง OCR ของเครื่องนี้ (พร้อม API key สำหรับผู้ให้บริการที่เลือก)
            const settings =
                ocrConfig.readSecrets(getDataPath());

            const useOcr =
                settings.enabled === true &&
                (!payload || payload.ocr !== false);

            const joinLines =
                !payload || payload.joinLines !== false;

            const sendProgress = function (progress) {

                if (event.sender.isDestroyed()) {
                    return;
                }

                event.sender.send(
                    "file:extract-pdf-progress",
                    progress
                );
            };

            // ── i love api: OCR ทั้งไฟล์ครั้งเดียว แล้วอ่านชั้นข้อความที่ได้ ──
            //
            // API นี้ทำ "PDF ที่สแกน" ให้เป็น "PDF ที่มีชั้นข้อความ"
            // จึงต้องส่งทั้งไฟล์ (ไม่ใช่ทีละหน้า) แล้วค่อยใช้ pdf.js อ่านผลลัพธ์
            if (useOcr && settings.provider === "iloveapi") {

                // รอบแรกอ่านชั้นข้อความเดิม เพื่อดูว่ามีหน้าไหนต้อง OCR ไหม
                const base = await extractPdfText(data, {
                    joinLines: joinLines,
                    onProgress: sendProgress
                });

                const needsOcr =
                    settings.mode === "always" ||
                    (base.emptyPages && base.emptyPages.length > 0);

                if (!needsOcr) {
                    return {
                        ok: true,
                        text: base.text,
                        joined: base.joined || 0,
                        pageCount: base.pageCount || 0,
                        ocrPages: [],
                        ocrError: null,
                        provider: "iloveapi"
                    };
                }

                sendProgress({
                    page: 0,
                    pageCount: base.pageCount || 0,
                    status: "ocr-api"
                });

                try {
                    const ocrIloveapi =
                        require("./ocr-iloveapi.cjs");

                    const ocrPdf =
                        await ocrIloveapi.ocrPdf(
                            Buffer.from(data),
                            {
                                apiKey: settings.iloveapi.apiKey
                            }
                        );

                    const converted =
                        await extractPdfText(ocrPdf, {
                            joinLines: joinLines
                        });

                    if (String(converted.text || "").trim() === "") {
                        throw new Error(
                            "i love api ทำ OCR แล้ว แต่ยังอ่านข้อความจากไฟล์ผลลัพธ์ไม่ได้"
                        );
                    }

                    const ocrPages = [];

                    for (let index = 1; index <= converted.pageCount; index++) {
                        ocrPages.push(index);
                    }

                    return {
                        ok: true,
                        text: converted.text,
                        joined: converted.joined || 0,
                        pageCount: converted.pageCount || 0,
                        ocrPages: ocrPages,
                        ocrError: null,
                        provider: "iloveapi"
                    };

                } catch (error) {

                    // OCR ล้มเหลว = ยังคืนข้อความเดิม (ถ้ามี) พร้อมสาเหตุ
                    console.error(
                        "file:extract-pdf i love api error:",
                        error
                    );

                    return {
                        ok: true,
                        text: base.text,
                        joined: base.joined || 0,
                        pageCount: base.pageCount || 0,
                        ocrPages: [],
                        ocrError:
                            (error && error.message) ||
                            "OCR ด้วย i love api ไม่สำเร็จ",
                        provider: "iloveapi"
                    };
                }
            }

            // ── PaddleOCR / Gemini: OCR ทีละหน้าตามที่ตั้งไว้ ──
            let ocrPage = null;

            // PaddleOCR + เปิด "Two-Stage Localized OCR" = หาตำแหน่งข้อความก่อน
            // แล้วครอปเฉพาะบริเวณมาอ่านด้วย PP-OCRv5 ที่ความละเอียดสูงขึ้น
            if (useOcr && settings.provider === "paddle" && settings.twoStage) {

                const ocrTwoStage =
                    require("./ocr-two-stage.cjs");

                ocrPage = function (page) {

                    return ocrTwoStage.ocrPage(page);
                };
            }

            if (useOcr && settings.provider === "paddleVL") {

                ocrPage = function (page) {

                    return ocrPaddleVl.ocrPage(page, {
                        dataPath: getDataPath()
                    });
                };
            }

            if (useOcr && settings.provider === "gemini") {

                const ocrGemini =
                    require("./ocr-gemini.cjs");

                ocrPage = async function (page) {

                    const result =
                        await ocrGemini.ocrPage(page, {
                            // key เดียว (โครงเก่า) + รายการ key (โครงใหม่ — fallback)
                            apiKey: settings.gemini.apiKey,
                            apiKeys: settings.gemini.apiKeys || [],
                            model: settings.gemini.model
                        });

                    // บันทึก token ของหน้านี้ — บันทึกไม่ได้ก็ไม่ให้ OCR ล้มเหลว
                    if (result && result.keyId) {

                        try {
                            ocrConfig.addGeminiUsage(
                                getDataPath(),
                                result.keyId,
                                result.usage
                            );

                        } catch (error) {

                            console.error(
                                "บันทึก token ของ Gemini OCR ไม่สำเร็จ:",
                                error
                            );
                        }
                    }

                    return result;
                };
            }

            const result =
                await extractPdfText(
                    data,
                    {
                        // เย็บบรรทัดที่ถูกตัดขึ้นบรรทัดใหม่ (ปิดได้จากหน้าจอ)
                        joinLines: joinLines,
                        // OCR เฉพาะหน้าที่ไม่มีชั้นข้อความ (หรือทุกหน้าถ้าตั้งไว้)
                        ocr: useOcr,
                        ocrAll: useOcr && settings.mode === "always",
                        ocrPage: ocrPage,
                        onProgress: sendProgress
                    }
                );

            return {
                ok: true,
                text: result.text,
                // จำนวนจุดที่เย็บบรรทัดที่ถูกตัดเข้าด้วยกัน
                joined: result.joined || 0,
                pageCount: result.pageCount || 0,
                // เลขหน้าที่ได้ข้อความจาก OCR
                ocrPages: result.ocrPages || [],
                // แจ้งเตือนเมื่อ OCR ล้มเหลว (ข้อความจากชั้นข้อความยังใช้ได้)
                ocrError: result.ocrError || null,
                provider: settings.provider
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
    "will-quit",
    () => {

        // คืนหน่วยความจำ/ปิดเซิร์ฟเวอร์ OCR ที่แอปเป็นคนเริ่ม
        ocrPaddleVl.stop();

    }
);


// ปิด llama-server ของ PaddleOCR-VL ก่อนจบโปรเซส
// (ถ้าไม่ปิด โปรเซสลูกจะค้างกินหน่วยความจำต่อหลังปิดหน้าต่าง)
app.on(
    "before-quit",
    () => {

        try {

            ocrPaddleVl.stop();

        } catch (error) {

            console.error(
                "ocrPaddleVl.stop error:",
                error
            );
        }

        try {

            pdfLayout.stop();

        } catch (error) {

            console.error(
                "pdfLayout.stop error:",
                error
            );
        }

    }
);


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