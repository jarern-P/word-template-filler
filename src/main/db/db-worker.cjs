const { parentPort, workerData } = require("worker_threads");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const privacyMask = require("../privacy-mask.cjs");

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
        patterns   TEXT NOT NULL DEFAULT '{}',
        tables     TEXT NOT NULL DEFAULT '{}',
        list_groups TEXT NOT NULL DEFAULT '{}',
        list_limits TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS master (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        code_group TEXT NOT NULL,
        sub_group  TEXT NOT NULL DEFAULT '',
        name       TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    -- กลุ่ม (Code Group) ที่กำหนดไว้ล่วงหน้า — รายการ master เลือกกลุ่มจากที่นี่
    CREATE TABLE IF NOT EXISTS master_groups (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    -- กลุ่มย่อย (Sub Group) ของแต่ละกลุ่ม — เลือกได้เฉพาะกลุ่มย่อยที่กำหนดไว้
    CREATE TABLE IF NOT EXISTS master_subgroups (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id   INTEGER NOT NULL,
        name       TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(group_id, name)
    );

    CREATE INDEX IF NOT EXISTS idx_subgroups_group
        ON master_subgroups(group_id);

    -- คำที่ผู้ใช้เพิ่มเอง ใช้รวมกับพจนานุกรมกลางตอนแนะนำคำ
    CREATE TABLE IF NOT EXISTS words (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        word       TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    -- คำ/pattern ที่ต้องปกปิดก่อนส่งข้อความให้ AI (หน้า "คำเฉพาะ")
    -- kind = text (คำธรรมดา) | regex (pattern ที่เขียนเอง)
    -- require_known = 1 คือปกปิดเฉพาะค่าที่ตรง/ใกล้เคียงคำในระบบ (คลังคำ + ข้อมูลหลัก)
    CREATE TABLE IF NOT EXISTS sensitive_terms (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL DEFAULT '',
        kind          TEXT NOT NULL DEFAULT 'text',
        pattern       TEXT NOT NULL,
        enabled       INTEGER NOT NULL DEFAULT 0,
        require_known INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        UNIQUE(kind, pattern)
    );

    -- ค่าตั้งที่ใช้ร่วมกันทั้งแอป (เช่น % ขั้นต่ำของการเทียบคำในระบบ)
    CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL DEFAULT '',
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
// Migration: เพิ่มคอลัมน์ sub_group ให้ตาราง master
// ============================================================

// รายการ master แยกเป็น กลุ่ม (code_group) และ กลุ่มย่อย (sub_group)
// ฐานข้อมูลรุ่นก่อนมีแต่ code_group จึงเติมคอลัมน์ใหม่ด้วยค่าว่าง
function migrateMasterSubGroup() {

    const columns =
        db.prepare(`
            PRAGMA table_info(master)
        `).all();

    // ยังไม่มีตาราง master (ฐานข้อมูลใหม่) SCHEMA จะสร้างให้พร้อมคอลัมน์อยู่แล้ว
    if (columns.length === 0) {
        return;
    }

    if (columns.some(column => column.name === "sub_group")) {
        return;
    }

    db.exec(`
        ALTER TABLE master
        ADD COLUMN sub_group TEXT NOT NULL DEFAULT ''
    `);

    console.log(
        "Migrated master table: added 'sub_group' column"
    );
}


// ============================================================
// Seed: กลุ่มเริ่มต้นจาก code_group ที่มีอยู่แล้ว
// ============================================================

// ต้องเรียกหลัง exec(SCHEMA) เพราะตาราง master_groups เพิ่งถูกสร้าง
// กลุ่มที่ผู้ใช้เคยใช้จะได้เลือกได้ทันทีโดยไม่ต้องพิมพ์ใหม่
function seedMasterGroups() {

    const rows =
        db.prepare(`
            SELECT DISTINCT
                code_group
            FROM master
            WHERE code_group <> ''
        `).all();

    if (rows.length === 0) {
        return;
    }

    const insert =
        db.prepare(`
            INSERT OR IGNORE INTO master_groups (
                name,
                created_at,
                updated_at
            )
            VALUES (
                @name,
                @created_at,
                @updated_at
            )
        `);

    const now =
        new Date().toISOString();

    db.transaction(() => {

        rows.forEach(row => {

            insert.run({
                name: row.code_group,
                created_at: now,
                updated_at: now
            });
        });

    })();
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
// Migration: เพิ่มคอลัมน์ patterns ให้ตาราง templates
// ============================================================

// เก็บ regex ที่ใช้ดึงค่าของแต่ละ field จากข้อความ/ไฟล์
// (ตั้งค่าในหน้าตั้งค่าแม่แบบ → ปุ่ม "ข้อมูล")
function migrateTemplatePatterns() {

    const columns =
        db.prepare(`
            PRAGMA table_info(templates)
        `).all();

    // ยังไม่มีตาราง templates (ฐานข้อมูลใหม่) SCHEMA จะสร้างให้พร้อมคอลัมน์อยู่แล้ว
    if (columns.length === 0) {
        return;
    }

    if (columns.some(column => column.name === "patterns")) {
        return;
    }

    db.exec(`
        ALTER TABLE templates
        ADD COLUMN patterns TEXT NOT NULL DEFAULT '{}'
    `);

    console.log(
        "Migrated templates table: added 'patterns' column"
    );
}


// ============================================================
// Migration: เพิ่มคอลัมน์ tables ให้ตาราง templates
// ============================================================

// เก็บโครงตาราง (จำนวนคอลัมน์ / ชื่อหัวคอลัมน์) ของ field ที่เป็น type Table
// ที่ตั้งไว้ในหน้า Template Configuration
function migrateTemplateTables() {

    const columns =
        db.prepare(`
            PRAGMA table_info(templates)
        `).all();

    // ยังไม่มีตาราง templates (ฐานข้อมูลใหม่) SCHEMA จะสร้างให้พร้อมคอลัมน์อยู่แล้ว
    if (columns.length === 0) {
        return;
    }

    if (columns.some(column => column.name === "tables")) {
        return;
    }

    db.exec(`
        ALTER TABLE templates
        ADD COLUMN tables TEXT NOT NULL DEFAULT '{}'
    `);

    console.log(
        "Migrated templates table: added 'tables' column"
    );
}


// ============================================================
// Migration: เพิ่มคอลัมน์ list_groups ให้ตาราง templates
// ============================================================

// เก็บชื่อกลุ่ม (group) ของ field ที่เป็น type List
// list ที่ใช้ชื่อกลุ่มเดียวกันจะแสดงเป็นแถวเดียวกันที่หน้ารายงาน
function migrateTemplateListGroups() {

    const columns =
        db.prepare(`
            PRAGMA table_info(templates)
        `).all();

    // ยังไม่มีตาราง templates (ฐานข้อมูลใหม่) SCHEMA จะสร้างให้พร้อมคอลัมน์อยู่แล้ว
    if (columns.length === 0) {
        return;
    }

    if (columns.some(column => column.name === "list_groups")) {
        return;
    }

    db.exec(`
        ALTER TABLE templates
        ADD COLUMN list_groups TEXT NOT NULL DEFAULT '{}'
    `);

    console.log(
        "Migrated templates table: added 'list_groups' column"
    );
}


// ============================================================
// Migration: เพิ่มคอลัมน์ require_known ให้ตาราง sensitive_terms
// ============================================================

// "ต้องมีคำในระบบเท่านั้น" ของแต่ละ pattern ในหน้า "คำเฉพาะ"
// ฐานข้อมูลรุ่นก่อนไม่มีคอลัมน์นี้ — ถือว่าปิดไว้ (0)
function migrateSensitiveTermsRequireKnown() {

    const columns =
        db.prepare(`
            PRAGMA table_info(sensitive_terms)
        `).all();

    // ยังไม่มีตาราง (ฐานข้อมูลใหม่) SCHEMA จะสร้างให้พร้อมคอลัมน์อยู่แล้ว
    if (columns.length === 0) {
        return;
    }

    if (columns.some(column => column.name === "require_known")) {
        return;
    }

    db.exec(`
        ALTER TABLE sensitive_terms
        ADD COLUMN require_known INTEGER NOT NULL DEFAULT 0
    `);

    console.log(
        "Migrated sensitive_terms table: added 'require_known' column"
    );
}


// ============================================================
// Migration: เพิ่มคอลัมน์ list_limits ให้ตาราง templates
// ============================================================

// เก็บจำนวนตัวอักษรสูงสุดต่อบรรทัดของ field ที่เป็น type List
function migrateTemplateListLimits() {

    const columns =
        db.prepare(`
            PRAGMA table_info(templates)
        `).all();

    // ยังไม่มีตาราง templates (ฐานข้อมูลใหม่) SCHEMA จะสร้างให้พร้อมคอลัมน์อยู่แล้ว
    if (columns.length === 0) {
        return;
    }

    if (columns.some(column => column.name === "list_limits")) {
        return;
    }

    db.exec(`
        ALTER TABLE templates
        ADD COLUMN list_limits TEXT NOT NULL DEFAULT '{}'
    `);

    console.log(
        "Migrated templates table: added 'list_limits' column"
    );
}


// ============================================================
// Seed: คำเฉพาะที่แถมมาให้
// ============================================================

// เพิ่ม preset (จำนวนเงิน / ตัวเลข / ชื่อ-นามสกุล) ให้ครั้งเดียวตอนสร้างตาราง
// ทั้งหมดยัง "ปิด" อยู่ — เปิดใช้เองในหน้า "คำเฉพาะ"
// ถ้าตารางมีข้อมูลอยู่แล้ว (ผู้ใช้แก้/ลบเอง) จะไม่เติมกลับ
function seedSensitiveTerms() {

    const total = db.prepare(`
        SELECT COUNT(*) AS total
        FROM sensitive_terms
    `).get().total;

    if (total > 0) {
        return;
    }

    const insert = db.prepare(`
        INSERT OR IGNORE INTO sensitive_terms (
            name,
            kind,
            pattern,
            enabled,
            created_at,
            updated_at
        )
        VALUES (
            @name,
            @kind,
            @pattern,
            @enabled,
            @created_at,
            @updated_at
        )
    `);

    const now = new Date().toISOString();

    db.transaction(() => {

        privacyMask.DEFAULT_TERMS.forEach(term => {

            insert.run({
                name: term.name,
                kind: term.kind,
                pattern: term.pattern,
                enabled: term.enabled ? 1 : 0,
                created_at: now,
                updated_at: now
            });
        });

    })();

    console.log(
        "Seeded sensitive terms: " + privacyMask.DEFAULT_TERMS.length
    );
}


// ============================================================
// Open Database
// ============================================================

function openDatabase() {

    db = new Database(dbPath);

    // ต้องย้ายข้อมูลก่อน exec(SCHEMA) เพราะ SCHEMA เป็น IF NOT EXISTS
    migrateMasterTable();
    migrateMasterSubGroup();
    migrateTemplateLocks();
    migrateTemplatePlaceholders();
    migrateTemplateTables();
    migrateTemplateListGroups();
    migrateTemplateListLimits();
    migrateTemplatePatterns();
    migrateSensitiveTermsRequireKnown();
    db.exec(SCHEMA);

    // เติม preset คำเฉพาะให้ฐานข้อมูลใหม่ (ตารางว่างเท่านั้น)
    seedSensitiveTerms();

    // ระบบ OCR ถูกถอดออก — ลบตาราง OCR เดิมทิ้ง (ข้อมูลฝึกเก่าไม่ใช้แล้ว)
    db.exec(`
        DROP TABLE IF EXISTS ocr_fixes;
        DROP TABLE IF EXISTS ocr_titles;
        DROP TABLE IF EXISTS ocr_word_groups;
        DROP TABLE IF EXISTS ocr_drop_words;
        DROP TABLE IF EXISTS ocr_page_layouts;
        DROP TABLE IF EXISTS ocr_blueprints;
    `);

    // หลังสร้างตารางแล้ว ค่อยเติมกลุ่มเริ่มต้นจากข้อมูลที่มีอยู่
    seedMasterGroups();

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
            placeholders,
            patterns,
            tables,
            listGroups,
            listLimits
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

        const patternsJson =
            JSON.stringify(patterns || {});

        const tablesJson =
            JSON.stringify(tables || {});

        const listGroupsJson =
            JSON.stringify(listGroups || {});

        const listLimitsJson =
            JSON.stringify(listLimits || {});


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
                        patterns = @patterns,
                        tables = @tables,
                        list_groups = @list_groups,
                        list_limits = @list_limits,
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
                    patterns: patternsJson,
                    tables: tablesJson,
                    list_groups: listGroupsJson,
                    list_limits: listLimitsJson,
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
                        patterns,
                        tables,
                        list_groups,
                        list_limits,
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
                        @patterns,
                        @tables,
                        @list_groups,
                        @list_limits,
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
                    patterns: patternsJson,
                    tables: tablesJson,
                    list_groups: listGroupsJson,
                    list_limits: listLimitsJson,
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
                    patterns,
                    tables,
                    list_groups,
                    list_limits,
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
                patterns: JSON.parse(row.patterns || "{}"),
                tables: JSON.parse(row.tables || "{}"),
                list_groups: JSON.parse(row.list_groups || "{}"),
                list_limits: JSON.parse(row.list_limits || "{}"),
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
                    patterns,
                    tables,
                    list_groups,
                    list_limits,
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

            patterns:
                JSON.parse(row.patterns || "{}"),

            tables:
                JSON.parse(row.tables || "{}"),

            list_groups:
                JSON.parse(row.list_groups || "{}"),

            list_limits:
                JSON.parse(row.list_limits || "{}"),

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

        // กลุ่มย่อยเว้นว่างได้ (= รายการอยู่ที่ระดับกลุ่มโดยตรง)
        const subGroup =
            String(payload.subGroup || "").trim();

        const name =
            String(payload.name || "").trim();

        if (!codeGroup) {
            throw new Error("กรุณาระบุ Code Group");
        }

        if (!name) {
            throw new Error("กรุณาระบุ Name");
        }

        // name ต้องไม่ซ้ำภายใน (code_group + sub_group) เดียวกัน
        const duplicate =
            db.prepare(`
                SELECT id
                FROM master
                WHERE code_group = ?
                  AND sub_group = ?
                  AND name = ?
                  AND id <> ?
            `).get(
                codeGroup,
                subGroup,
                name,
                id
            );

        if (duplicate) {
            throw new Error(
                `ชื่อ "${name}" มีอยู่แล้วในกลุ่ม "${codeGroup}"` +
                (subGroup ? ` / "${subGroup}"` : "")
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
                        sub_group = @sub_group,
                        name = @name,
                        updated_at = @updated_at
                    WHERE id = @id
                `)
                .run({
                    id: id,
                    code_group: codeGroup,
                    sub_group: subGroup,
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
                        sub_group,
                        name,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        @code_group,
                        @sub_group,
                        @name,
                        @created_at,
                        @updated_at
                    )
                `)
                .run({
                    code_group: codeGroup,
                    sub_group: subGroup,
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
                    sub_group,
                    name,
                    created_at,
                    updated_at
                FROM master
                ORDER BY code_group ASC, sub_group ASC, name ASC
            `)
            .all();

        const records =
            rows.map(row => ({
                id: row.id,
                code_group: row.code_group,
                sub_group: row.sub_group || "",
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
                    sub_group,
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

            sub_group: row.sub_group || "",

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
function masterKey(codeGroup, subGroup, name) {
    return String(codeGroup) + "\u0000" + String(subGroup) + "\u0000" + String(name);
}


// ตัวระบุรายการเดิมจากไฟล์ Excel (ไม่มีคอลัมน์ ID) = Code Group + Name
function nameKey(codeGroup, name) {
    return String(codeGroup) + "\u0000" + String(name);
}


// เพิ่ม/อัปเดตข้อมูล master ทีละหลายรายการ (นำเข้าจาก Excel)
// กติกา:
//   - จับคู่รายการเดิมด้วย (Code Group + Name) = อัปเดตกลุ่มย่อยตามไฟล์
//   - ไม่พบรายการเดิม = เพิ่มใหม่ (ยกเว้นซ้ำกับที่มีอยู่แล้ว/ซ้ำกันเองในไฟล์ = ข้าม)
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


        // ดัชนีของรายการที่มีอยู่แล้ว (อ่านครั้งเดียวก่อนเริ่ม)
        //   existing = key เต็ม (กลุ่ม + กลุ่มย่อย + ชื่อ) ใช้กันการเพิ่มซ้ำ
        //   byName   = (กลุ่ม + ชื่อ) -> id ใช้หาการวัดรายการเดิมเพื่ออัปเดตกลุ่มย่อย
        //   byId     = id -> ค่าปัจจุบัน (เทียบว่าเปลี่ยนจริงหรือไม่)
        const existing = new Set();
        const byName = new Map();
        const byId = new Map();

        db.prepare(`
            SELECT
                id,
                code_group,
                sub_group,
                name
            FROM master
        `).all().forEach(row => {

            existing.add(
                masterKey(row.code_group, row.sub_group || "", row.name)
            );

            byId.set(row.id, {
                code_group: row.code_group,
                sub_group: row.sub_group || "",
                name: row.name
            });

            const key =
                nameKey(row.code_group, row.name);

            if (!byName.has(key)) {
                byName.set(key, row.id);
            }
        });


        const insert =
            db.prepare(`
                INSERT INTO master (
                    code_group,
                    sub_group,
                    name,
                    created_at,
                    updated_at
                )
                VALUES (
                    @code_group,
                    @sub_group,
                    @name,
                    @created_at,
                    @updated_at
                )
            `);


        // กลุ่ม/กลุ่มย่อยที่เจอในไฟล์ถูกเพิ่มเข้าระบบอัตโนมัติ
        // (ผู้ใช้จะได้เห็นเป็นตัวเลือกในหน้า Master Data / popup ค้นหา)
        const insertGroup =
            db.prepare(`
                INSERT OR IGNORE INTO master_groups (
                    name,
                    created_at,
                    updated_at
                )
                VALUES (
                    @name,
                    @created_at,
                    @updated_at
                )
            `);

        const findGroup =
            db.prepare(`
                SELECT id
                FROM master_groups
                WHERE name = ?
            `);

        const insertSubgroup =
            db.prepare(`
                INSERT OR IGNORE INTO master_subgroups (
                    group_id,
                    name,
                    created_at,
                    updated_at
                )
                VALUES (
                    @group_id,
                    @name,
                    @created_at,
                    @updated_at
                )
            `);


        // อัปเดตรายการเดิมตาม ID (ใช้ตอนอัปโหลดไฟล์ที่ดาวน์โหลดไปแล้วแก้)
        const updateById =
            db.prepare(`
                UPDATE master
                SET
                    code_group = @code_group,
                    sub_group = @sub_group,
                    name = @name,
                    updated_at = @updated_at
                WHERE id = @id
            `);


        const now =
            new Date().toISOString();


        // ลงทะเบียนกลุ่ม/กลุ่มย่อยที่เจอในไฟล์ไว้ให้เลือกภายหลัง
        function registerGroup(codeGroup, subGroup) {

            insertGroup.run({
                name: codeGroup,
                created_at: now,
                updated_at: now
            });

            if (!subGroup) {
                return;
            }

            const group =
                findGroup.get(codeGroup);

            if (group) {

                insertSubgroup.run({
                    group_id: group.id,
                    name: subGroup,
                    created_at: now,
                    updated_at: now
                });
            }
        }


        let inserted = 0;
        let updated = 0;
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

                    const subGroup = String(
                        (raw && raw.subGroup) || ""
                    ).trim();

                    const name = String(
                        (raw && raw.name) || ""
                    ).trim();


                    if (!codeGroup || !name) {
                        skippedInvalid++;
                        return;
                    }


                    // จับคู่รายการเดิมด้วย (Code Group + Name) แล้วอัปเดตกลุ่มย่อย
                    // (ไฟล์ Excel ไม่มีคอลัมน์ ID — ใช้ชื่อรายการเป็นตัวระบุ)
                    const matchId =
                        byName.get(nameKey(codeGroup, name));

                    if (matchId) {

                        const current =
                            byId.get(matchId);

                        const changed =
                            !current ||
                            current.code_group !== codeGroup ||
                            current.sub_group !== subGroup ||
                            current.name !== name;

                        if (changed) {

                            updateById.run({
                                id: matchId,
                                code_group: codeGroup,
                                sub_group: subGroup,
                                name: name,
                                updated_at: now
                            });

                            byId.set(matchId, {
                                code_group: codeGroup,
                                sub_group: subGroup,
                                name: name
                            });

                            updated++;

                        } else {

                            skippedExisting++;
                        }

                        registerGroup(codeGroup, subGroup);
                        return;
                    }


                    const key =
                        masterKey(codeGroup, subGroup, name);


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
                        sub_group: subGroup,
                        name: name,
                        created_at: now,
                        updated_at: now
                    });


                    registerGroup(codeGroup, subGroup);


                    inserted++;
                });
            });


        run();


        send({
            id: message.id,
            ok: true,
            result: {
                inserted: inserted,
                updated: updated,
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
// Master Groups / Sub Groups (กลุ่มที่กำหนดไว้ล่วงหน้า)
// ============================================================

// จำนวนรายการ master ที่ใช้กลุ่ม/กลุ่มย่อยนี้อยู่
// (ใช้กันการลบกลุ่มที่ยังมีข้อมูลผูกอยู่)
function countMasterUsage(codeGroup, subGroup) {

    if (subGroup === null || subGroup === undefined) {

        return db.prepare(`
            SELECT
                COUNT(*) AS total
            FROM master
            WHERE code_group = ?
        `).get(codeGroup).total;
    }

    return db.prepare(`
        SELECT
            COUNT(*) AS total
        FROM master
        WHERE code_group = ?
          AND sub_group = ?
    `).get(codeGroup, subGroup).total;
}


// กลุ่มทั้งหมดพร้อมกลุ่มย่อยของแต่ละกลุ่ม
function handleGroupList(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const groups =
            db.prepare(`
                SELECT
                    id,
                    name,
                    created_at,
                    updated_at
                FROM master_groups
                ORDER BY name ASC
            `).all();

        const subgroups =
            db.prepare(`
                SELECT
                    id,
                    group_id,
                    name,
                    created_at,
                    updated_at
                FROM master_subgroups
                ORDER BY name ASC
            `).all();

        const byGroup = {};

        subgroups.forEach(row => {

            if (!byGroup[row.group_id]) {
                byGroup[row.group_id] = [];
            }

            byGroup[row.group_id].push({
                id: row.id,
                group_id: row.group_id,
                name: row.name,
                created_at: row.created_at,
                updated_at: row.updated_at
            });
        });

        send({
            id: message.id,
            ok: true,
            result: groups.map(group => ({
                id: group.id,
                name: group.name,
                subgroups: byGroup[group.id] || [],
                created_at: group.created_at,
                updated_at: group.updated_at
            }))
        });

    } catch (error) {

        send({
            id: message.id,
            ok: false,
            error: error?.message || String(error)
        });

    }
}


// เพิ่ม/แก้ไขกลุ่ม — id > 0 = แก้ไข, id = 0 = เพิ่มใหม่
// แก้ชื่อกลุ่มแล้วอัปเดต code_group ของรายการ master ที่ใช้กลุ่มนั้นด้วย
function handleGroupSave(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload =
            message.payload || {};

        const id =
            Number(payload.id) || 0;

        const name =
            String(payload.name || "").trim();

        if (!name) {
            throw new Error("กรุณาระบุชื่อกลุ่ม");
        }

        const duplicate =
            db.prepare(`
                SELECT id
                FROM master_groups
                WHERE name = ?
                  AND id <> ?
            `).get(name, id);

        if (duplicate) {
            throw new Error(`กลุ่ม "${name}" มีอยู่แล้ว`);
        }

        const now =
            new Date().toISOString();

        let resultId;

        if (id > 0) {

            const previous =
                db.prepare(`
                    SELECT name
                    FROM master_groups
                    WHERE id = ?
                `).get(id);

            const result =
                db.prepare(`
                    UPDATE master_groups
                    SET
                        name = @name,
                        updated_at = @updated_at
                    WHERE id = @id
                `)
                .run({
                    id: id,
                    name: name,
                    updated_at: now
                });

            if (result.changes === 0) {
                throw new Error(`ไม่พบกลุ่ม id=${id}`);
            }

            // ชื่อกลุ่มในรายการ master ต้องตรงกับกลุ่มที่กำหนดไว้
            if (previous && previous.name !== name) {

                db.prepare(`
                    UPDATE master
                    SET
                        code_group = @name,
                        updated_at = @updated_at
                    WHERE code_group = @old_name
                `)
                .run({
                    name: name,
                    old_name: previous.name,
                    updated_at: now
                });
            }

            resultId = id;

        } else {

            const result =
                db.prepare(`
                    INSERT INTO master_groups (
                        name,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        @name,
                        @created_at,
                        @updated_at
                    )
                `)
                .run({
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
            "handleGroupSave error:",
            error
        );

        send({
            id: message.id,
            ok: false,
            error: error?.message || String(error)
        });

    }
}


// ลบกลุ่ม — ลบได้เฉพาะกลุ่มที่ไม่มีรายการ master ใช้อยู่
function handleGroupDelete(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const id =
            Number(message.payload.id);

        const group =
            db.prepare(`
                SELECT id, name
                FROM master_groups
                WHERE id = ?
            `).get(id);

        if (!group) {
            throw new Error(`ไม่พบกลุ่ม id=${id}`);
        }

        const used =
            countMasterUsage(group.name, null);

        if (used > 0) {
            throw new Error(
                `ลบไม่ได้ — กลุ่ม "${group.name}" ถูกใช้โดยข้อมูล ${used} รายการ`
            );
        }

        db.transaction(() => {

            db.prepare(`
                DELETE FROM master_subgroups
                WHERE group_id = ?
            `).run(id);

            db.prepare(`
                DELETE FROM master_groups
                WHERE id = ?
            `).run(id);

        })();

        send({
            id: message.id,
            ok: true,
            result: {
                deleted: true
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


// เพิ่ม/แก้ไขกลุ่มย่อย — id > 0 = แก้ไข, id = 0 = เพิ่มใหม่
function handleSubgroupSave(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload =
            message.payload || {};

        const id =
            Number(payload.id) || 0;

        const groupId =
            Number(payload.groupId) || 0;

        const name =
            String(payload.name || "").trim();

        if (!groupId) {
            throw new Error("ไม่พบกลุ่มของกลุ่มย่อยนี้");
        }

        if (!name) {
            throw new Error("กรุณาระบุชื่อกลุ่มย่อย");
        }

        const group =
            db.prepare(`
                SELECT id, name
                FROM master_groups
                WHERE id = ?
            `).get(groupId);

        if (!group) {
            throw new Error(`ไม่พบกลุ่ม id=${groupId}`);
        }

        const duplicate =
            db.prepare(`
                SELECT id
                FROM master_subgroups
                WHERE group_id = ?
                  AND name = ?
                  AND id <> ?
            `).get(groupId, name, id);

        if (duplicate) {
            throw new Error(`กลุ่มย่อย "${name}" มีอยู่แล้วในกลุ่ม "${group.name}"`);
        }

        const now =
            new Date().toISOString();

        let resultId;

        if (id > 0) {

            const previous =
                db.prepare(`
                    SELECT name, group_id
                    FROM master_subgroups
                    WHERE id = ?
                `).get(id);

            const result =
                db.prepare(`
                    UPDATE master_subgroups
                    SET
                        group_id = @group_id,
                        name = @name,
                        updated_at = @updated_at
                    WHERE id = @id
                `)
                .run({
                    id: id,
                    group_id: groupId,
                    name: name,
                    updated_at: now
                });

            if (result.changes === 0) {
                throw new Error(`ไม่พบกลุ่มย่อย id=${id}`);
            }

            if (previous && previous.name !== name) {

                db.prepare(`
                    UPDATE master
                    SET
                        sub_group = @name,
                        updated_at = @updated_at
                    WHERE code_group = @code_group
                      AND sub_group = @old_name
                `)
                .run({
                    name: name,
                    old_name: previous.name,
                    code_group: group.name,
                    updated_at: now
                });
            }

            resultId = id;

        } else {

            const result =
                db.prepare(`
                    INSERT INTO master_subgroups (
                        group_id,
                        name,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        @group_id,
                        @name,
                        @created_at,
                        @updated_at
                    )
                `)
                .run({
                    group_id: groupId,
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
            "handleSubgroupSave error:",
            error
        );

        send({
            id: message.id,
            ok: false,
            error: error?.message || String(error)
        });

    }
}


// ลบกลุ่มย่อย — ลบได้เฉพาะกลุ่มย่อยที่ไม่มีรายการ master ใช้อยู่
function handleSubgroupDelete(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const id =
            Number(message.payload.id);

        const subgroup =
            db.prepare(`
                SELECT
                    master_subgroups.id,
                    master_subgroups.name,
                    master_groups.name AS group_name
                FROM master_subgroups
                JOIN master_groups
                  ON master_groups.id = master_subgroups.group_id
                WHERE master_subgroups.id = ?
            `).get(id);

        if (!subgroup) {
            throw new Error(`ไม่พบกลุ่มย่อย id=${id}`);
        }

        const used =
            countMasterUsage(subgroup.group_name, subgroup.name);

        if (used > 0) {
            throw new Error(
                `ลบไม่ได้ — กลุ่มย่อย "${subgroup.name}" ถูกใช้โดยข้อมูล ${used} รายการ`
            );
        }

        db.prepare(`
            DELETE FROM master_subgroups
            WHERE id = ?
        `).run(id);

        send({
            id: message.id,
            ok: true,
            result: {
                deleted: true
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
// Export / Import ไฟล์ฐานข้อมูล (สำรอง / ย้ายเครื่อง)
// ============================================================

// หัวไฟล์ของ SQLite ใช้เช็คเร็ว ๆ ก่อนเขียนไฟล์ลงดิสก์
const SQLITE_MAGIC = "SQLite format 3\0";

// ตารางของแอปนี้ — ต้องมีตาราง templates จึงถือว่าเป็นฐานข้อมูลของแอป
const APP_TABLE = "templates";

// ตารางที่นับจำนวนไว้แสดงให้ผู้ใช้เห็น (ตารางที่ยังไม่มีในไฟล์รุ่นเก่านับเป็น 0)
const COUNTED_TABLES = [
    "templates",
    "master",
    "words",
    "sensitive_terms",
    "history"
];

// ไฟล์ชั่วคราวสำหรับสำรอง/นำเข้า
// ต้องอยู่ในโฟลเดอร์ data เดียวกันเสมอ เพราะ rename ข้ามไดรฟ์/พาร์ทิชันไม่ได้
function tempDbPath(tag) {

    return path.join(
        dbDir,
        "templates." + tag + ".db"
    );
}

function removeIfExists(filePath) {

    try {

        fs.rmSync(
            filePath,
            {
                force: true
            }
        );

    } catch (error) {

        // ลบไม่ได้ (ถูกล็อก/ไม่มีสิทธิ์) — ให้ขั้นตอนถัดไปรายงานเอง
        console.error(
            "ลบไฟล์ไม่สำเร็จ:",
            filePath,
            error
        );
    }
}

// ข้อความสำหรับใส่ใน SQL (path ของ Windows อาจมี ' เช่น C:\Users\O'Brien)
function sqlString(text) {

    return "'" + String(text).replace(/'/g, "''") + "'";
}

// จำนวนข้อมูลในแต่ละตารางของฐานข้อมูลที่เปิดอยู่
// ใช้ได้ทั้งกับ db หลัก และกับไฟล์ที่เปิดตรวจชั่วคราว
function tableCounts(handle) {

    const counts = {};

    COUNTED_TABLES.forEach(name => {

        try {

            counts[name] = handle
                .prepare(
                    "SELECT COUNT(*) AS total FROM " + name
                )
                .get()
                .total;

        } catch (error) {

            // ไฟล์รุ่นเก่าอาจยังไม่มีตารางนี้
            counts[name] = 0;
        }
    });

    return counts;
}

// อ่านจำนวนข้อมูล/ตรวจความสมบูรณ์ของไฟล์ฐานข้อมูลหนึ่งไฟล์
// โยน error ภาษาไทยเมื่อไฟล์ไม่ใช่ฐานข้อมูลของแอปนี้
function inspectDatabaseFile(filePath, byteLength) {

    let probe = null;

    try {

        probe = new Database(
            filePath,
            {
                readonly: true,
                fileMustExist: true
            }
        );


        const integrity =
            probe.pragma(
                "integrity_check",
                {
                    simple: true
                }
            );


        if (String(integrity).toLowerCase() !== "ok") {

            throw new Error(
                "ไฟล์ฐานข้อมูลเสียหาย (integrity_check: " +
                integrity +
                ")"
            );
        }


        const tables =
            probe
                .prepare(`
                    SELECT name
                    FROM sqlite_master
                    WHERE type = 'table'
                `)
                .all()
                .map(row => row.name);


        if (tables.indexOf(APP_TABLE) === -1) {

            throw new Error(
                "ไฟล์นี้ไม่ใช่ฐานข้อมูลของแอปนี้ (ไม่พบตาราง " +
                APP_TABLE +
                ")"
            );
        }


        return {
            byteLength,
            counts: tableCounts(probe)
        };

    } finally {

        if (probe) {
            probe.close();
        }
    }
}


// ------------------------------------------------
// Info: ตำแหน่ง/ขนาด/จำนวนข้อมูลของฐานข้อมูลปัจจุบัน
// ------------------------------------------------

function handleDatabaseInfo(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        send({
            id: message.id,
            ok: true,
            result: {
                dbPath,
                byteLength: fs.statSync(dbPath).size,
                counts: tableCounts(db)
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


// ------------------------------------------------
// Export: คืน byte ของฐานข้อมูลทั้งไฟล์
// ------------------------------------------------

// ใช้ VACUUM INTO จึงได้สำเนาที่สมบูรณ์ในไฟล์เดียว
// (ข้อมูลที่ค้างใน journal/wal ถูกเขียนรวมให้แล้ว — ต่างจากการคัดลอกไฟล์ตรง ๆ)
// ไฟล์ปลายทาง (Downloads) เป็นหน้าที่ของ main process ตั้งชื่อ
async function handleExportDatabase(message) {

    const tmpPath =
        tempDbPath("export");

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        // VACUUM INTO ไม่ยอมเขียนทับไฟล์ที่มีอยู่
        removeIfExists(tmpPath);

        db.exec(
            "VACUUM INTO " + sqlString(tmpPath)
        );


        const bytes =
            await fs.promises.readFile(tmpPath);


        send({
            id: message.id,
            ok: true,
            result: {
                data: bytes,
                byteLength: bytes.length,
                dbPath
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

    } finally {

        removeIfExists(tmpPath);
    }
}


// ------------------------------------------------
// Prepare Import: ตรวจไฟล์ที่ผู้ใช้เลือก ก่อนแตะฐานข้อมูลเดิม
// ------------------------------------------------

// เขียนไฟล์ลงโฟลเดอร์ data (ยังไม่แทนที่อะไร) แล้วตรวจว่าใช้ได้จริง
// ไฟล์ที่ตรวจแล้วจะถูกเก็บไว้ให้ handleApplyImport ใช้ต่อ / ยกเลิกแล้วลบทิ้ง
async function handlePrepareImport(message) {

    const payload =
        message.payload || {};

    const tmpPath =
        tempDbPath("import");

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const bytes =
            payload.data;

        if (!bytes || !bytes.length) {
            throw new Error("ไม่ได้รับไฟล์ฐานข้อมูล");
        }


        const buffer =
            Buffer.from(bytes);


        // เช็คจากหัวไฟล์ก่อน เพื่อให้ไฟล์ผิดประเภท (.docx/.xlsx) ถูกปฏิเสธทันที
        if (
            buffer
                .subarray(0, SQLITE_MAGIC.length)
                .toString("latin1") !== SQLITE_MAGIC
        ) {

            throw new Error(
                "ไฟล์นี้ไม่ใช่ฐานข้อมูล SQLite — กรุณาเลือกไฟล์ที่ได้จาก " +
                "ปุ่ม \"ดาวน์โหลดฐานข้อมูล\" ของแอปนี้"
            );
        }


        removeIfExists(tmpPath);

        await fs.promises.writeFile(
            tmpPath,
            buffer
        );


        const info =
            inspectDatabaseFile(
                tmpPath,
                buffer.length
            );


        send({
            id: message.id,
            ok: true,
            result: info
        });

    } catch (error) {

        // ตรวจไม่ผ่าน = ไม่เก็บไฟล์ที่ใช้ไม่ได้ไว้ในโฟลเดอร์ข้อมูล
        removeIfExists(tmpPath);


        send({
            id: message.id,
            ok: false,
            error:
                error?.message ||
                String(error)
        });
    }
}


// ------------------------------------------------
// Apply Import: สลับไฟล์ที่ตรวจแล้วเข้าแทนฐานข้อมูลเดิม
// ------------------------------------------------

// ชื่อไฟล์ปลายทางต้องเป็น templates.db เสมอ (แอปอ้างชื่อนี้ตายตัว)
// ไฟล์ที่ผู้ใช้เลือกจะชื่ออะไรก็ได้ — ที่นี่เปลี่ยนชื่อให้เอง
function handleApplyImport(message) {

    const tmpPath =
        tempDbPath("import");

    // ไฟล์เดิมถูกย้ายมาพักไว้ที่นี่จนกว่าจะเปิดไฟล์ใหม่สำเร็จ
    const backupPath =
        path.join(
            dbDir,
            "templates.before-import.bak"
        );

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        if (!fs.existsSync(tmpPath)) {

            throw new Error(
                "ไม่พบไฟล์ที่ตรวจไว้ — กรุณาเลือกไฟล์ฐานข้อมูลใหม่"
            );
        }


        // ปิดฐานข้อมูลเดิมก่อนสลับไฟล์ (ยังเปิดอยู่ = ไฟล์ถูกล็อก เปลี่ยนทับไม่ได้)
        db.close();
        db = null;


        // -wal / -shm / -journal ของฐานข้อมูลเดิมเป็นของไฟล์เดิม
        // ห้ามค้างคู่กับไฟล์ใหม่ ไม่งั้น SQLite อาจเอา journal เก่ามาใช้กับไฟล์ใหม่
        removeIfExists(dbPath + "-wal");
        removeIfExists(dbPath + "-shm");
        removeIfExists(dbPath + "-journal");


        // เก็บไฟล์เดิมไว้ก่อนสลับ — เผื่อเปิดไฟล์ใหม่ไม่ได้จริง ๆ จะได้คืนกลับ
        removeIfExists(backupPath);
        fs.renameSync(dbPath, backupPath);

        fs.renameSync(tmpPath, dbPath);


        try {

            // เปิดไฟล์ใหม่ + เติม/อัปเดตโครงสร้างให้ตรงรุ่นนี้ (migration + SCHEMA)
            openDatabase();

        } catch (openError) {

            // ไฟล์ใหม่เปิดไม่ได้ = คืนไฟล์เดิมกลับให้ผู้ใช้ทำงานต่อได้
            removeIfExists(dbPath);
            fs.renameSync(backupPath, dbPath);
            openDatabase();

            throw openError;
        }


        // สำเร็จแล้ว จึงทิ้งไฟล์เดิมได้
        removeIfExists(backupPath);


        send({
            id: message.id,
            ok: true,
            result: {
                dbPath,
                byteLength: fs.statSync(dbPath).size,
                counts: tableCounts(db)
            }
        });

    } catch (error) {

        // ไม่ให้แอปเหลือสภาพที่ฐานข้อมูลถูกปิดค้างไว้
        if (!db) {

            try {
                openDatabase();

            } catch (reopenError) {

                console.error(
                    "เปิดฐานข้อมูลเดิมกลับไม่สำเร็จ:",
                    reopenError
                );
            }
        }


        send({
            id: message.id,
            ok: false,
            error:
                error?.message ||
                String(error)
        });
    }
}


// ------------------------------------------------
// Discard Import: ผู้ใช้ยกเลิก = ทิ้งไฟล์ที่ตรวจไว้
// ------------------------------------------------

function handleDiscardImport(message) {

    try {

        removeIfExists(
            tempDbPath("import")
        );


        send({
            id: message.id,
            ok: true,
            result: {
                removed: true
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
// Query / Schema (หน้า Query — รัน SQL กับฐานข้อมูลโดยตรง)
// ============================================================

// ชื่อตาราง/คอลัมน์เอามาวางใน SQL ตรง ๆ ไม่ได้ — ต้องครอบด้วย "..."
// และ escape " ที่อยู่ในชื่อซ้ำอีกชั้น
function sqlIdentifier(name) {

    return '"' +
        String(name == null ? "" : name).replace(/"/g, '""') +
        '"';
}


// รัน SQL 1 คำสั่ง
//
// - คำสั่งที่คืนแถว (SELECT / PRAGMA / ... RETURNING) → คืนคอลัมน์ + แถว
//   ใช้ raw(true) เพื่อได้แถวเป็น array: ชื่อคอลัมน์ซ้ำกัน (เช่น SELECT a.id, b.id)
//   จะไม่ถูกยุบเหลือค่าเดียว
// - คำสั่งที่แก้ข้อมูล (INSERT / UPDATE / DELETE / CREATE / ...) → คืนจำนวนแถวที่เปลี่ยน
function handleQuery(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const sql =
            String(
                (message.payload && message.payload.sql) || ""
            ).trim();


        if (sql === "") {
            throw new Error("ยังไม่มีคำสั่ง SQL");
        }


        const startedAt =
            Date.now();

        const statement =
            db.prepare(sql);


        if (statement.reader) {

            const columns =
                statement.columns().map(function (column) {
                    return column.name;
                });


            statement.raw(true);


            const rows =
                statement.all();


            send({
                id: message.id,
                ok: true,
                result: {
                    kind: "rows",
                    columns: columns,
                    rows: rows,
                    rowCount: rows.length,
                    durationMs:
                        Date.now() - startedAt
                }
            });

            return;
        }


        const info =
            statement.run();


        send({
            id: message.id,
            ok: true,
            result: {
                kind: "change",
                changes: info.changes,
                lastInsertRowid:
                    Number(info.lastInsertRowid),
                durationMs:
                    Date.now() - startedAt
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


// โครงสร้างฐานข้อมูล — รายชื่อตาราง/วิว พร้อมคอลัมน์และจำนวนแถว
// ใช้แสดงในแถบด้านซ้ายของหน้า Query
function handleSchema(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }


        const objects =
            db.prepare(`
                SELECT type, name, sql
                FROM sqlite_master
                WHERE type IN ('table', 'view')
                  AND name NOT LIKE 'sqlite_%'
                ORDER BY name COLLATE NOCASE
            `).all();


        const result =
            objects.map(function (object) {

                const columns =
                    db.prepare(
                        "PRAGMA table_info(" +
                        sqlIdentifier(object.name) +
                        ")"
                    ).all();


                let rowCount = 0;

                try {

                    rowCount =
                        db.prepare(
                            "SELECT COUNT(*) AS total FROM " +
                            sqlIdentifier(object.name)
                        ).get().total;

                } catch (error) {

                    // วิวที่พังหรือตารางเสมือนที่อ่านไม่ได้ — ไม่ให้ทั้งหน้าล้ม
                    rowCount = 0;
                }


                return {
                    type: object.type,
                    name: object.name,
                    sql: object.sql || "",
                    rowCount: rowCount,
                    columns:
                        columns.map(function (column) {
                            return {
                                name: column.name,
                                type: column.type || "",
                                notNull: !!column.notnull,
                                primaryKey: column.pk > 0
                            };
                        })
                };
            });


        // ตารางขึ้นก่อนวิว แล้วเรียงตามชื่อ
        result.sort(function (a, b) {

            if (a.type !== b.type) {
                return a.type === "table" ? -1 : 1;
            }

            return a.name.localeCompare(b.name);
        });


        send({
            id: message.id,
            ok: true,
            result: {
                objects: result
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
// Sensitive Terms (คำเฉพาะ — ปกปิดก่อนส่ง AI)
// ============================================================

// เพิ่ม/แก้ไขรายการคำหรือ pattern
//   - id > 0 = แก้ไขรายการเดิม (ฟิลด์ที่ไม่ส่งมาจะใช้ค่าเดิม)
//   - id = 0 = เพิ่มรายการใหม่
// kind: text = คำธรรมดา, regex = pattern ที่เขียนเอง
// enabled ที่เก็บเป็น 0/1 (หน้า "คำเฉพาะ" สลับสวิตช์แล้วส่งมาเฉพาะฟิลด์นี้)
function handlePrivacySave(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload = message.payload || {};

        const id =
            Number(payload.id) || 0;

        const current = id > 0
            ? db.prepare(`
                SELECT
                    id,
                    name,
                    kind,
                    pattern,
                    enabled,
                    require_known
                FROM sensitive_terms
                WHERE id = ?
            `).get(id)
            : null;

        if (id > 0 && !current) {
            throw new Error(`ไม่พบรายการคำเฉพาะ id=${id}`);
        }

        const kind =
            (payload.kind === undefined ? (current ? current.kind : "text") : payload.kind) === "regex"
                ? "regex"
                : "text";

        const rawPattern =
            payload.pattern === undefined
                ? (current ? current.pattern : "")
                : payload.pattern;

        const pattern =
            String(rawPattern == null ? "" : rawPattern).trim();

        if (!pattern) {
            throw new Error("กรุณาระบุคำหรือ pattern");
        }

        const checked =
            privacyMask.validatePattern(kind, pattern);

        if (!checked.ok) {
            throw new Error(checked.error);
        }

        // ชื่อตัวแปรที่ใช้ใน placeholder — อักขระที่ใช้ไม่ได้ถูกแทนด้วย _
        const rawName =
            payload.name === undefined
                ? (current ? current.name : "")
                : payload.name;

        const name =
            privacyMask.sanitizeName(rawName);

        const rawEnabled =
            payload.enabled === undefined
                ? (current ? current.enabled : 0)
                : payload.enabled;

        const enabled =
            (rawEnabled === true || Number(rawEnabled) === 1) ? 1 : 0;

        // "ต้องมีคำในระบบเท่านั้น" — ปกปิดเฉพาะค่าที่ตรง/ใกล้เคียงคำในระบบ
        const rawRequireKnown =
            payload.require_known === undefined
                ? (payload.requireKnown === undefined
                    ? (current ? current.require_known : 0)
                    : payload.requireKnown)
                : payload.require_known;

        const requireKnown =
            (rawRequireKnown === true || Number(rawRequireKnown) === 1) ? 1 : 0;

        // pattern ซ้ำ (ชนิดเดียวกัน) จะใช้ตัวแปรคนละชื่อไม่ได้ เพราะแทนค่าพร้อมกัน
        const duplicate =
            db.prepare(`
                SELECT
                    id
                FROM sensitive_terms
                WHERE kind = ?
                  AND pattern = ?
                  AND id <> ?
            `).get(kind, pattern, id);

        if (duplicate) {
            throw new Error("มีคำ/pattern นี้อยู่แล้ว");
        }

        const now =
            new Date().toISOString();

        let resultId;

        if (id > 0) {

            db.prepare(`
                UPDATE sensitive_terms
                SET
                    name = @name,
                    kind = @kind,
                    pattern = @pattern,
                    enabled = @enabled,
                    require_known = @require_known,
                    updated_at = @updated_at
                WHERE id = @id
            `).run({
                id: id,
                name: name,
                kind: kind,
                pattern: pattern,
                enabled: enabled,
                require_known: requireKnown,
                updated_at: now
            });

            resultId = id;

        } else {

            const result =
                db.prepare(`
                    INSERT INTO sensitive_terms (
                        name,
                        kind,
                        pattern,
                        enabled,
                        require_known,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        @name,
                        @kind,
                        @pattern,
                        @enabled,
                        @require_known,
                        @created_at,
                        @updated_at
                    )
                `).run({
                    name: name,
                    kind: kind,
                    pattern: pattern,
                    enabled: enabled,
                    require_known: requireKnown,
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
            "handlePrivacySave error:",
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
// Sensitive Terms List
// ============================================================

function handlePrivacyList(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const rows =
            db.prepare(`
                SELECT
                    id,
                    name,
                    kind,
                    pattern,
                    enabled,
                    require_known,
                    created_at,
                    updated_at
                FROM sensitive_terms
                ORDER BY id ASC
            `).all();

        send({
            id: message.id,
            ok: true,
            result: rows.map(row => ({
                id: row.id,
                name: row.name,
                kind: row.kind === "regex" ? "regex" : "text",
                pattern: row.pattern,
                enabled: Number(row.enabled) === 1 ? 1 : 0,
                require_known: Number(row.require_known) === 1 ? 1 : 0,
                created_at: row.created_at,
                updated_at: row.updated_at
            }))
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
// Sensitive Terms Delete
// ============================================================

function handlePrivacyDelete(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const id =
            Number(message.payload.id);

        const result =
            db.prepare(`
                DELETE FROM sensitive_terms
                WHERE id = ?
            `).run(id);

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
// Settings (ค่าตั้งที่ใช้ร่วมกัน)
// ============================================================

// อ่านค่าตั้งตาม key — ยังไม่เคยบันทึก = value เป็น null (ผู้เรียกใช้ค่าเริ่มต้น)
function handleSettingGet(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const key =
            String((message.payload && message.payload.key) || "").trim();

        if (!key) {
            throw new Error("ไม่ระบุ key ของค่าตั้ง");
        }

        const row =
            db.prepare(`
                SELECT value
                FROM app_settings
                WHERE key = ?
            `).get(key);

        send({
            id: message.id,
            ok: true,
            result: {
                key: key,
                value: row ? row.value : null
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


// บันทึกค่าตั้ง (มีอยู่แล้ว = ทับค่าเดิม)
function handleSettingSave(message) {

    try {

        if (!db) {
            throw new Error("ฐานข้อมูลยังไม่เปิด");
        }

        const payload = message.payload || {};

        const key =
            String(payload.key || "").trim();

        if (!key) {
            throw new Error("ไม่ระบุ key ของค่าตั้ง");
        }

        const value =
            String(payload.value == null ? "" : payload.value).trim();

        db.prepare(`
            INSERT INTO app_settings (
                key,
                value,
                updated_at
            )
            VALUES (
                @key,
                @value,
                @updated_at
            )
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `).run({
            key: key,
            value: value,
            updated_at: new Date().toISOString()
        });

        send({
            id: message.id,
            ok: true,
            result: {
                key: key,
                value: value
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
            // Master Groups / Sub Groups
            // ------------------------------------------------

            case "group-list":

                handleGroupList(message);

                break;

            // ------------------------------------------------

            case "group-save":

                handleGroupSave(message);

                break;

            // ------------------------------------------------

            case "group-delete":

                handleGroupDelete(message);

                break;

            // ------------------------------------------------

            case "subgroup-save":

                handleSubgroupSave(message);

                break;

            // ------------------------------------------------

            case "subgroup-delete":

                handleSubgroupDelete(message);

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
            // Sensitive Terms (คำเฉพาะ)
            // ------------------------------------------------

            case "privacy-save":

                handlePrivacySave(message);

                break;

            // ------------------------------------------------

            case "privacy-list":

                handlePrivacyList(message);

                break;

            // ------------------------------------------------

            case "privacy-delete":

                handlePrivacyDelete(message);

                break;


            // ------------------------------------------------
            // Settings (ค่าตั้งที่ใช้ร่วมกัน)
            // ------------------------------------------------

            case "setting-get":

                handleSettingGet(message);

                break;

            // ------------------------------------------------

            case "setting-save":

                handleSettingSave(message);

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
            // ไฟล์ฐานข้อมูล (สำรอง / ย้ายเครื่อง)
            // ------------------------------------------------

            case "database-info":

                handleDatabaseInfo(message);

                break;

            // ------------------------------------------------

            case "export-database":

                handleExportDatabase(message);

                break;

            // ------------------------------------------------

            case "prepare-import":

                handlePrepareImport(message);

                break;

            // ------------------------------------------------

            case "apply-import":

                handleApplyImport(message);

                break;

            // ------------------------------------------------

            case "discard-import":

                handleDiscardImport(message);

                break;


            // ------------------------------------------------
            // Query / Schema (หน้า Query)
            // ------------------------------------------------

            case "query":

                handleQuery(message);

                break;

            // ------------------------------------------------

            case "schema":

                handleSchema(message);

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