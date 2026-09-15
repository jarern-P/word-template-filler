const { parentPort, workerData } = require("worker_threads");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// ============================================================
// Database Path
// ============================================================

// ตำแหน่ง data มาจาก main process เท่านั้น
// (dev = <project>/data, .exe = <โฟลเดอร์ของ exe>/data)
// เพราะ path ใน app.asar นั้นเขียนไฟล์ไม่ได้
const dbDir =
    (workerData && workerData.dbDataPath) ||
    path.resolve(
        __dirname,
        "../../../data"
    );

console.log("DB data path:", dbDir);

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, {
        recursive: true
    });
}

const dbPath = path.join(dbDir, "templates.db");


// ============================================================
// Database Schema
// ============================================================

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS templates (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        file_name  TEXT NOT NULL DEFAULT '',
        docx       BLOB NOT NULL,
        fields     TEXT NOT NULL DEFAULT '[]',
        types      TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS master (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code_group TEXT NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
`;


// ============================================================
// Database
// ============================================================

let db = null;


// ============================================================
// Migration: ตัดคอลัมน์ code ออกจากตาราง master
// ============================================================

// ฐานข้อมูลรุ่นก่อนเก็บ code แยกจาก name
// ตอนนี้เหลือ name อย่างเดียว จึงสร้างตารางใหม่และย้ายข้อมูลเดิม
function migrateMasterTable() {

    const columns =
        db.prepare(`
            PRAGMA table_info(master)
        `).all();

    // ยังไม่มีตาราง master (ฐานข้อมูลใหม่) ไม่ต้องย้ายอะไร
    if (columns.length === 0) {
        return;
    }

    const hasCode =
        columns.some(
            column => column.name === "code"
        );

    if (!hasCode) {
        return;
    }

    db.exec(`
        BEGIN;

        CREATE TABLE master_new (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            code_group TEXT NOT NULL,
            name       TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        INSERT INTO master_new (
            id,
            code_group,
            name,
            created_at,
            updated_at
        )
        SELECT
            id,
            code_group,
            name,
            created_at,
            updated_at
        FROM master;

        DROP TABLE master;

        ALTER TABLE master_new RENAME TO master;

        COMMIT;
    `);

    console.log(
        "Migrated master table: removed 'code' column"
    );
}


// ============================================================
// Open Database
// ============================================================

function openDatabase() {

    db = new Database(dbPath);

    // ต้องย้ายข้อมูลก่อน exec(SCHEMA) เพราะ SCHEMA เป็น IF NOT EXISTS
    migrateMasterTable();

    db.exec(SCHEMA);

    console.log("SQLite database opened:");
    console.log(dbPath);

    return {
        persistent: true,
        dbPath
    };
}


// ============================================================
// Message Helper
// ============================================================

function send(message) {
    parentPort.postMessage(message);
}


// ============================================================
// Save
// ============================================================

function handleSave(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload = message.payload;

        const {
            id,
            name,
            fileName,
            docx,
            fields,
            types
        } = payload;


        if (!name) {
            throw new Error("กรุณาระบุชื่อ Template");
        }


        if (!docx) {
            throw new Error("ไม่พบไฟล์ DOCX");
        }


        const fieldsJson =
            JSON.stringify(fields || []);

        const typesJson =
            JSON.stringify(types || {});


        const docxBuffer =
            Buffer.from(docx);


        let resultId;


        // ----------------------------------------------------
        // Update
        // ----------------------------------------------------

        if (id && Number(id) > 0) {

            const result =
                db.prepare(`
                    UPDATE templates
                    SET
                        name = @name,
                        file_name = @file_name,
                        docx = @docx,
                        fields = @fields,
                        types = @types,
                        updated_at = @updated_at
                    WHERE id = @id
                `)
                .run({
                    id: Number(id),
                    name,
                    file_name: fileName || "",
                    docx: docxBuffer,
                    fields: fieldsJson,
                    types: typesJson,
                    updated_at: new Date().toISOString()
                });


            if (result.changes === 0) {
                throw new Error(
                    `ไม่พบ Template id=${id}`
                );
            }


            resultId = Number(id);

        }

        // ----------------------------------------------------
        // Insert
        // ----------------------------------------------------

        else {

            const now =
                new Date().toISOString();

            const result =
                db.prepare(`
                    INSERT INTO templates (
                        name,
                        file_name,
                        docx,
                        fields,
                        types,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        @name,
                        @file_name,
                        @docx,
                        @fields,
                        @types,
                        @created_at,
                        @updated_at
                    )
                `)
                .run({
                    name,
                    file_name: fileName || "",
                    docx: docxBuffer,
                    fields: fieldsJson,
                    types: typesJson,
                    created_at: now,
                    updated_at: now
                });


            resultId =
                Number(result.lastInsertRowid);
        }


        // สำคัญ: ใช้ message.id
        send({
            id: message.id,
            ok: true,
            result: {
                id: resultId
            }
        });


    } catch (error) {

        console.error(
            "handleSave error:",
            error
        );


        send({
            id: message.id,
            ok: false,
            error:
                error?.message ||
                String(error)
        });

    }
}


// ============================================================
// List
// ============================================================

function handleList(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const rows =
            db.prepare(`
                SELECT
                    id,
                    name,
                    file_name,
                    fields,
                    types,
                    created_at,
                    updated_at
                FROM templates
                ORDER BY updated_at DESC
            `)
            .all();


        const records =
            rows.map(row => ({
                id: row.id,
                name: row.name,
                file_name: row.file_name,
                fields: JSON.parse(row.fields),
                types: JSON.parse(row.types),
                created_at: row.created_at,
                updated_at: row.updated_at
            }));


        send({
            id: message.id,
            ok: true,
            result: records
        });


    } catch (error) {

        send({
            id: message.id,
            ok: false,
            error:
                error?.message ||
                String(error)
        });

    }
}


// ============================================================
// Get
// ============================================================

function handleGet(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const id =
            Number(message.payload.id);


        const row =
            db.prepare(`
                SELECT
                    id,
                    name,
                    file_name,
                    docx,
                    fields,
                    types,
                    created_at,
                    updated_at
                FROM templates
                WHERE id = ?
            `)
            .get(id);


        if (!row) {

            send({
                id: message.id,
                ok: true,
                result: null
            });

            return;
        }


        const record = {

            id: row.id,

            name: row.name,

            file_name:
                row.file_name,

            docx:
                row.docx,

            fields:
                JSON.parse(row.fields),

            types:
                JSON.parse(row.types),

            created_at:
                row.created_at,

            updated_at:
                row.updated_at

        };


        send({
            id: message.id,
            ok: true,
            result: record
        });


    } catch (error) {

        send({
            id: message.id,
            ok: false,
            error:
                error?.message ||
                String(error)
        });

    }
}


// ============================================================
// Delete
// ============================================================

function handleDelete(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const id =
            Number(message.payload.id);


        const result =
            db.prepare(`
                DELETE FROM templates
                WHERE id = ?
            `)
            .run(id);


        send({
            id: message.id,
            ok: true,
            result: {
                deleted:
                    result.changes > 0
            }
        });


    } catch (error) {

        send({
            id: message.id,
            ok: false,
            error:
                error?.message ||
                String(error)
        });

    }
}


// ============================================================
// Master Save
// ============================================================

function handleMasterSave(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload = message.payload || {};

        // id > 0 = แก้ไขรายการเดิม, id = 0 = เพิ่มรายการใหม่
        const id =
            Number(payload.id) || 0;

        // ตัดช่องว่างหัวท้าย เพื่อไม่ให้ "ลูกค้า" กับ "ลูกค้า " กลายเป็นคนละรายการ
        const codeGroup =
            String(payload.codeGroup || "").trim();

        const name =
            String(payload.name || "").trim();

        if (!codeGroup) {
            throw new Error("กรุณาระบุ Code Group");
        }

        if (!name) {
            throw new Error("กรุณาระบุ Name");
        }

        // name ต้องไม่ซ้ำภายใน code_group เดียวกัน
        const duplicate =
            db.prepare(`
                SELECT id
                FROM master
                WHERE code_group = ?
                  AND name = ?
                  AND id <> ?
            `).get(
                codeGroup,
                name,
                id
            );

        if (duplicate) {
            throw new Error(
                `ชื่อ "${name}" มีอยู่แล้วในกลุ่ม "${codeGroup}"`
            );
        }

        const now = new Date().toISOString();

        let resultId;

        // ----------------------------------------------------
        // Update
        // ----------------------------------------------------

        if (id > 0) {

            const result =
                db.prepare(`
                    UPDATE master
                    SET
                        code_group = @code_group,
                        name = @name,
                        updated_at = @updated_at
                    WHERE id = @id
                `)
                .run({
                    id: id,
                    code_group: codeGroup,
                    name: name,
                    updated_at: now
                });

            if (result.changes === 0) {
                throw new Error(`ไม่พบข้อมูล master id=${id}`);
            }

            resultId = id;
        }

        // ----------------------------------------------------
        // Insert
        // ----------------------------------------------------

        else {

            const result =
                db.prepare(`
                    INSERT INTO master (
                        code_group,
                        name,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        @code_group,
                        @name,
                        @created_at,
                        @updated_at
                    )
                `)
                .run({
                    code_group: codeGroup,
                    name: name,
                    created_at: now,
                    updated_at: now
                });

            resultId =
                Number(result.lastInsertRowid);
        }

        send({
            id: message.id,
            ok: true,
            result: {
                id: resultId
            }
        });

    } catch (error) {

        console.error(
            "handleMasterSave error:",
            error
        );

        send({
            id: message.id,
            ok: false,
            error: error?.message || String(error)
        });

    }
}

// ============================================================
// Master List
// ============================================================

function handleMasterList(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const rows =
            db.prepare(`
                SELECT
                    id,
                    code_group,
                    name,
                    created_at,
                    updated_at
                FROM master
                ORDER BY code_group ASC, name ASC
            `)
            .all();

        const records =
            rows.map(row => ({
                id: row.id,
                code_group: row.code_group,
                name: row.name,
                created_at: row.created_at,
                updated_at: row.updated_at
            }));

        send({
            id: message.id,
            ok: true,
            result: records
        });

    } catch (error) {

        send({
            id: message.id,
            ok: false,
            error: error?.message || String(error)
        });

    }
}


// ============================================================
// Master Get
// ============================================================

function handleMasterGet(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const id =
            Number(message.payload.id);

        const row =
            db.prepare(`
                SELECT
                    id,
                    code_group,
                    name,
                    created_at,
                    updated_at
                FROM master
                WHERE id = ?
            `)
            .get(id);

        if (!row) {

            send({
                id: message.id,
                ok: true,
                result: null
            });

            return;
        }

        const record = {

            id: row.id,

            code_group: row.code_group,

            name: row.name,

            created_at: row.created_at,

            updated_at: row.updated_at

        };

        send({
            id: message.id,
            ok: true,
            result: record
        });

    } catch (error) {

        send({
            id: message.id,
            ok: false,
            error: error?.message || String(error)
        });

    }
}


// ============================================================
// Master Delete
// ============================================================

function handleMasterDelete(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const id =
            Number(message.payload.id);

        const result =
            db.prepare(`
                DELETE FROM master
                WHERE id = ?
            `)
            .run(id);

        send({
            id: message.id,
            ok: true,
            result: {
                deleted:
                    result.changes > 0
            }
        });

    } catch (error) {

        send({
            id: message.id,
            ok: false,
            error: error?.message || String(error)
        });

    }
}

// ============================================================
// Check Schema
// ============================================================

function handleCheckSchema(payload) {

    try {

        const tables = db
            .prepare(`
                SELECT name
                FROM sqlite_master
                WHERE type = 'table'
                ORDER BY name
            `)
            .all();


        const columns = db
            .prepare(`
                PRAGMA table_info(templates)
            `)
            .all();


        send({
            id: payload?.id,
            type: "check-schema",
            ok: true,
            tables,
            columns
        });

    } catch (error) {

        send({
            id: payload?.id,
            type: "check-schema",
            ok: false,
            error: error?.message || String(error)
        });
    }
}


// ============================================================
// Message Loop
// ============================================================

parentPort.on("message", (message) => {

    if (!message || !message.type) {
        return;
    }


    try {

        switch (message.type) {

            // ------------------------------------------------
            // Ping
            // ------------------------------------------------

            case "ping":

                send({
                    type: "pong",
                    message: "DB Worker is ready"
                });

                break;


            // ------------------------------------------------
            // SQLite Version
            // ------------------------------------------------

            case "sqlite-version": {

                const result = db
                    .prepare(`
                        SELECT sqlite_version() AS version
                    `)
                    .get();


                send({
                    type: "sqlite-version",
                    version: result.version
                });

                break;
            }


            // ------------------------------------------------
            // Schema
            // ------------------------------------------------

            case "check-schema":

                handleCheckSchema(message);

                break;


            // ------------------------------------------------
            // Save
            // ------------------------------------------------

            case "save":

                handleSave(message);

                break;


            // ------------------------------------------------
            // List
            // ------------------------------------------------

            case "list":

                handleList(message);

                break;


            // ------------------------------------------------
            // Get
            // ------------------------------------------------

            case "get":

                handleGet(message);

                break;


            // ------------------------------------------------
            // Delete
            // ------------------------------------------------

            case "delete":

                handleDelete(message);

                break;
                
            // ------------------------------------------------
            // Master Save
            // ------------------------------------------------
            
            case "master-save":

                handleMasterSave(message);
                
                break;

            // ------------------------------------------------
            // Master List
            // ------------------------------------------------
            
            case "master-list":
                
                handleMasterList(message);
                
                break;
                
            // ------------------------------------------------
            // Master Get
            // ------------------------------------------------
            
            case "master-get":
                
                handleMasterGet(message);
                
                break;
                
            // ------------------------------------------------
            // Master Delete
            // ------------------------------------------------
            
            case "master-delete":
                
                handleMasterDelete(message);
                
                break;


            // ------------------------------------------------
            // Unknown
            // ------------------------------------------------

            default:

                send({
                    id: message.id,
                    ok: false,
                    error: `Unknown command: ${message.type}`
                });

                break;
        }

    } catch (error) {

        console.error(
            "DB Worker error:",
            error
        );

        send({
            id: message.id,
            ok: false,
            error: error?.message || String(error)
        });
    }
});


// ============================================================
// Initialize
// ============================================================

try {

    const info = openDatabase();


    send({
        type: "ready",
        ok: true,
        persistent: info.persistent,
        dbPath: info.dbPath
    });

} catch (error) {

    console.error(
        "เปิดฐานข้อมูลไม่สำเร็จ:",
        error
    );


    send({
        type: "ready",
        ok: false,
        error: error?.message || String(error)
    });
}