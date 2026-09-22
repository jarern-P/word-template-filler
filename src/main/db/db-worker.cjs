const { parentPort, workerData } = require("worker_threads");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

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
    -- ประวัติการกรอก ใช้กดใช้ซ้ำในหน้ารายงาน
    CREATE TABLE IF NOT EXISTS history (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id   INTEGER NOT NULL DEFAULT 0,
        template_name TEXT NOT NULL DEFAULT '',
        field_values  TEXT NOT NULL DEFAULT '{}',
        modes         TEXT NOT NULL DEFAULT '{}',
        signature     TEXT NOT NULL UNIQUE,
        hits          INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_history_updated
        ON history(updated_at DESC);

    CREATE TABLE IF NOT EXISTS templates (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        file_name  TEXT NOT NULL DEFAULT '',
        docx       BLOB NOT NULL,
        fields     TEXT NOT NULL DEFAULT '[]',
        types      TEXT NOT NULL DEFAULT '{}',
        locks      TEXT NOT NULL DEFAULT '{}',
        placeholders TEXT NOT NULL DEFAULT '{}',
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

    -- คำที่ผู้ใช้เพิ่มเอง ใช้รวมกับพจนานุกรมกลางตอนแนะนำคำ
    CREATE TABLE IF NOT EXISTS words (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        word       TEXT NOT NULL UNIQUE,
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
// Migration: เพิ่มคอลัมน์ locks ให้ตาราง templates
// ============================================================

// เก็บ field ที่ติ๊ก "ล็อกตำแหน่ง" ไว้ในหน้า Template Configuration
function migrateTemplateLocks() {

    const columns =
        db.prepare(`
            PRAGMA table_info(templates)
        `).all();

    // ยังไม่มีตาราง templates (ฐานข้อมูลใหม่) SCHEMA จะสร้างให้พร้อมคอลัมน์อยู่แล้ว
    if (columns.length === 0) {
        return;
    }

    if (columns.some(column => column.name === "locks")) {
        return;
    }

    db.exec(`
        ALTER TABLE templates
        ADD COLUMN locks TEXT NOT NULL DEFAULT '{}'
    `);

    console.log(
        "Migrated templates table: added 'locks' column"
    );
}


// ============================================================
// Migration: เพิ่มคอลัมน์ placeholders ให้ตาราง templates
// ============================================================

// เก็บ placeholder (ข้อความตัวอย่าง) ของแต่ละ field
// ที่ตั้งไว้ในหน้า Template Configuration
function migrateTemplatePlaceholders() {

    const columns =
        db.prepare(`
            PRAGMA table_info(templates)
        `).all();

    // ยังไม่มีตาราง templates (ฐานข้อมูลใหม่) SCHEMA จะสร้างให้พร้อมคอลัมน์อยู่แล้ว
    if (columns.length === 0) {
        return;
    }

    if (columns.some(column => column.name === "placeholders")) {
        return;
    }

    db.exec(`
        ALTER TABLE templates
        ADD COLUMN placeholders TEXT NOT NULL DEFAULT '{}'
    `);

    console.log(
        "Migrated templates table: added 'placeholders' column"
    );
}


// ============================================================
// Open Database
// ============================================================

function openDatabase() {

    db = new Database(dbPath);

    // ต้องย้ายข้อมูลก่อน exec(SCHEMA) เพราะ SCHEMA เป็น IF NOT EXISTS
    migrateMasterTable();
    migrateTemplateLocks();
    migrateTemplatePlaceholders();

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
            types,
            locks,
            placeholders
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

        const locksJson =
            JSON.stringify(locks || {});

        const placeholdersJson =
            JSON.stringify(placeholders || {});


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
                        locks = @locks,
                        placeholders = @placeholders,
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
                    locks: locksJson,
                    placeholders: placeholdersJson,
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
                        locks,
                        placeholders,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        @name,
                        @file_name,
                        @docx,
                        @fields,
                        @types,
                        @locks,
                        @placeholders,
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
                    locks: locksJson,
                    placeholders: placeholdersJson,
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
                    locks,
                    placeholders,
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
                locks: JSON.parse(row.locks || "{}"),
                placeholders: JSON.parse(row.placeholders || "{}"),
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
                    locks,
                    placeholders,
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

            locks:
                JSON.parse(row.locks || "{}"),

            placeholders:
                JSON.parse(row.placeholders || "{}"),

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


        // ประวัติของ template นี้กดใช้ซ้ำไม่ได้อีก (เปิด template เดิมกลับมาไม่ได้)
        db.prepare(`
            DELETE FROM history
            WHERE template_id = ?
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
// Master Import (จากไฟล์ Excel)
// ============================================================

// ใช้เป็น key เดี่ยวของรายการ master โดยไม่ต้องพึ่งคอลัมน์ใหม่
// \u0000 เป็นอักขระที่ไม่มีทางเกิดใน code_group/name ที่ผู้ใช้กรอก
function masterKey(codeGroup, name) {
    return String(codeGroup) + "\u0000" + String(name);
}


// เพิ่มข้อมูล master ทีละหลายรายการ (นำเข้าจาก Excel)
// กติกา:
//   - รายการที่มีอยู่แล้วในฐานข้อมูล (code_group + name ตรงกัน) = ข้าม
//   - รายการที่ซ้ำกันเองในไฟล์ = ใส่ตัวแรกไว้ ตัวหลังข้าม
//   - รายการที่ไม่ครบทั้ง code_group และ name = ข้าม
function handleMasterImport(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload = message.payload || {};

        const rows =
            Array.isArray(payload.rows)
                ? payload.rows
                : [];


        // key ของรายการที่มีอยู่แล้ว (อ่านครั้งเดียวก่อนเริ่ม)
        const existing = new Set();

        db.prepare(`
            SELECT
                code_group,
                name
            FROM master
        `).all().forEach(row => {
            existing.add(
                masterKey(row.code_group, row.name)
            );
        });


        const insert =
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
            `);


        const now =
            new Date().toISOString();


        let inserted = 0;
        let skippedExisting = 0;
        let skippedDuplicate = 0;
        let skippedInvalid = 0;


        // key ที่"เพิ่มไปแล้ว"ระหว่างรอบนี้ ใช้ตัดตัวซ้ำในไฟล์เดียวกัน
        const imported = new Set();


        // ทำทั้งหมดใน transaction เดียว: ไฟล์หลักร้อยแถวเร็วขึ้นมาก
        // และถ้าพังกลางทางจะไม่เหลือข้อมูลค้างครึ่ง ๆ กลาง ๆ
        const run =
            db.transaction(() => {

                rows.forEach(raw => {

                    // ตัดช่องว่างหัวท้ายเหมือนตอนเพิ่มทีละรายการ
                    const codeGroup = String(
                        (raw && raw.codeGroup) || ""
                    ).trim();

                    const name = String(
                        (raw && raw.name) || ""
                    ).trim();


                    if (!codeGroup || !name) {
                        skippedInvalid++;
                        return;
                    }


                    const key =
                        masterKey(codeGroup, name);


                    if (existing.has(key)) {
                        skippedExisting++;
                        return;
                    }


                    if (imported.has(key)) {
                        skippedDuplicate++;
                        return;
                    }


                    imported.add(key);


                    insert.run({
                        code_group: codeGroup,
                        name: name,
                        created_at: now,
                        updated_at: now
                    });


                    inserted++;
                });
            });


        run();


        send({
            id: message.id,
            ok: true,
            result: {
                inserted: inserted,
                skippedExisting: skippedExisting,
                skippedDuplicate: skippedDuplicate,
                skippedInvalid: skippedInvalid,
                total: rows.length
            }
        });


    } catch (error) {

        console.error(
            "handleMasterImport error:",
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
// Word Save
// ============================================================

// คำที่ผู้ใช้เพิ่มเองสำหรับการแนะนำคำ
//   - id > 0 = แก้คำเดิม
//   - id = 0 = เพิ่มคำใหม่
// คำห้ามซ้ำกับรายการที่มีอยู่
function handleWordSave(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload = message.payload || {};

        const id =
            Number(payload.id) || 0;

        const word =
            String(payload.word || "").trim();


        if (!word) {
            throw new Error("กรุณาระบุคำ");
        }


        const duplicate =
            db.prepare(`
                SELECT
                    id
                FROM words
                WHERE word = ?
                AND id <> ?
            `)
            .get(word, id);


        if (duplicate) {
            throw new Error(`คำ "${word}" มีอยู่แล้ว`);
        }


        const now =
            new Date().toISOString();


        let resultId;


        if (id > 0) {

            const result =
                db.prepare(`
                    UPDATE words
                    SET
                        word = @word,
                        updated_at = @updated_at
                    WHERE id = @id
                `)
                .run({
                    id: id,
                    word: word,
                    updated_at: now
                });


            if (result.changes === 0) {
                throw new Error(`ไม่พบคำ id=${id}`);
            }


            resultId = id;

        } else {

            const result =
                db.prepare(`
                    INSERT INTO words (
                        word,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        @word,
                        @created_at,
                        @updated_at
                    )
                `)
                .run({
                    word: word,
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
            "handleWordSave error:",
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
// Word List
// ============================================================

function handleWordList(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const rows =
            db.prepare(`
                SELECT
                    id,
                    word,
                    created_at,
                    updated_at
                FROM words
                ORDER BY word ASC
            `)
            .all();


        send({
            id: message.id,
            ok: true,
            result: rows
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
// Word Delete
// ============================================================

function handleWordDelete(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const id =
            Number(message.payload.id);


        const result =
            db.prepare(`
                DELETE FROM words
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
// Check Schema
// ============================================================

// ============================================================
// History (ประวัติการกรอก)
// ============================================================

// เก็บชุดค่าที่เคยกรอกและกด Download ไว้ให้กดใช้ซ้ำในครั้งถัดไป
//   - ชุดค่าเดิม (template + ค่า + โหมด) ไม่เพิ่มแถวใหม่ แต่นับจำนวนครั้งและเลื่อนขึ้นบนสุด
//   - ลบรายการที่เก่ากว่าจำนวนวันที่กำหนด (retentionDays) ทุกครั้งที่บันทึก/อ่านรายการ
//   - กันฐานข้อมูลโตเกินด้วยการเก็บแถวล่าสุดไว้ไม่เกิน HISTORY_MAX_ROWS แถว

const HISTORY_MAX_ROWS = 300;
const HISTORY_DAY_MS = 24 * 60 * 60 * 1000;


// เรียงคีย์ก่อนทำ signature ชุดค่าเดียวกันจึงได้รหัสเดิมเสมอ
function sortObjectKeys(object) {

    const source =
        object && typeof object === "object" ? object : {};

    const sorted = {};

    Object.keys(source).sort().forEach(key => {
        sorted[key] = source[key];
    });

    return sorted;
}


function historySignature(templateId, values, modes) {

    const canonical =
        JSON.stringify({
            template: Number(templateId) || 0,
            values: sortObjectKeys(values),
            modes: sortObjectKeys(modes)
        });

    return crypto
        .createHash("sha1")
        .update(canonical)
        .digest("hex");
}


// 0 = ไม่จำกัดอายุ
function retentionDaysOf(payload) {

    const days =
        Number(payload && payload.retentionDays);

    if (!Number.isFinite(days) || days <= 0) {
        return 0;
    }

    return Math.floor(days);
}


function pruneHistory(days) {

    let deleted = 0;


    if (days > 0) {

        const cutoff =
            new Date(
                Date.now() - days * HISTORY_DAY_MS
            ).toISOString();

        deleted =
            db.prepare(`
                DELETE FROM history
                WHERE updated_at < ?
            `)
            .run(cutoff)
            .changes;
    }


    // เผื่อไว้: ถ้ามีชุดค่าที่ไม่ซ้ำกันเยอะมาก ให้เหลือเฉพาะแถวล่าสุด
    db.prepare(`
        DELETE FROM history
        WHERE id NOT IN (
            SELECT
                id
            FROM history
            ORDER BY updated_at DESC
            LIMIT ?
        )
    `)
    .run(HISTORY_MAX_ROWS);


    return deleted;
}


function historyRowToRecord(row) {

    return {
        id: row.id,
        template_id: row.template_id,
        template_name: row.template_name,
        values: JSON.parse(row.field_values || "{}"),
        modes: JSON.parse(row.modes || "{}"),
        hits: row.hits,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}


// ============================================================
// History Add
// ============================================================

function handleHistoryAdd(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload =
            message.payload || {};

        const templateId =
            Number(payload.templateId) || 0;


        // template ที่ยังไม่ถูกบันทึก = เปิดกลับมาเติมค่าให้ไม่ได้ จึงไม่เก็บ
        if (!templateId) {
            throw new Error(
                "ไม่พบ template ของรายการนี้ จึงเก็บประวัติไม่ได้"
            );
        }


        const values =
            sortObjectKeys(payload.values);

        const modes =
            sortObjectKeys(payload.modes);

        const templateName =
            String(payload.templateName || "").trim();

        const now =
            new Date().toISOString();

        const signature =
            historySignature(
                templateId,
                values,
                modes
            );


        db.prepare(`
            INSERT INTO history (
                template_id,
                template_name,
                field_values,
                modes,
                signature,
                hits,
                created_at,
                updated_at
            )
            VALUES (
                @template_id,
                @template_name,
                @field_values,
                @modes,
                @signature,
                1,
                @created_at,
                @updated_at
            )
            ON CONFLICT(signature) DO UPDATE SET
                template_name = excluded.template_name,
                hits = history.hits + 1,
                updated_at = excluded.updated_at
        `)
        .run({
            template_id: templateId,
            template_name: templateName,
            field_values: JSON.stringify(values),
            modes: JSON.stringify(modes),
            signature: signature,
            created_at: now,
            updated_at: now
        });


        pruneHistory(
            retentionDaysOf(payload)
        );


        const row =
            db.prepare(`
                SELECT
                    id,
                    hits
                FROM history
                WHERE signature = ?
            `)
            .get(signature);


        send({
            id: message.id,
            ok: true,
            result: {
                id: row ? row.id : 0,
                hits: row ? row.hits : 0
            }
        });

    } catch (error) {

        console.error(
            "handleHistoryAdd error:",
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
// History List
// ============================================================

function handleHistoryList(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        // อ่านรายการ = โอกาสลบของเก่าที่หมดอายุด้วย
        pruneHistory(
            retentionDaysOf(message.payload)
        );


        const rows =
            db.prepare(`
                SELECT
                    id,
                    template_id,
                    template_name,
                    field_values,
                    modes,
                    hits,
                    created_at,
                    updated_at
                FROM history
                ORDER BY updated_at DESC
            `)
            .all();


        send({
            id: message.id,
            ok: true,
            result: rows.map(historyRowToRecord)
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
// History Prune
// ============================================================

function handleHistoryPrune(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const deleted =
            pruneHistory(
                retentionDaysOf(message.payload)
            );


        send({
            id: message.id,
            ok: true,
            result: {
                deleted
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
// History Delete
// ============================================================

function handleHistoryDelete(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const id =
            Number(message.payload.id);


        const result =
            db.prepare(`
                DELETE FROM history
                WHERE id = ?
            `)
            .run(id);


        send({
            id: message.id,
            ok: true,
            result: {
                deleted: result.changes > 0
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
// History Clear
// ============================================================

function handleHistoryClear(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const result =
            db.prepare(`
                DELETE FROM history
            `)
            .run();


        send({
            id: message.id,
            ok: true,
            result: {
                deleted: result.changes
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
            // Master Import (Excel)            // ------------------------------------------------
            case "master-import":

                handleMasterImport(message);

                break;

            // ------------------------------------------------
            // Words (คำแนะนำ)
            // ------------------------------------------------

            case "word-save":

                handleWordSave(message);

                break;

            // ------------------------------------------------

            case "word-list":

                handleWordList(message);

                break;

            // ------------------------------------------------

            case "word-delete":

                handleWordDelete(message);

                break;


            // ------------------------------------------------
            // History (ประวัติการกรอก)
            // ------------------------------------------------

            case "history-add":

                handleHistoryAdd(message);

                break;

            // ------------------------------------------------

            case "history-list":

                handleHistoryList(message);

                break;

            // ------------------------------------------------

            case "history-prune":

                handleHistoryPrune(message);

                break;

            // ------------------------------------------------

            case "history-delete":

                handleHistoryDelete(message);

                break;

            // ------------------------------------------------

            case "history-clear":

                handleHistoryClear(message);

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