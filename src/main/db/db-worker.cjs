const { parentPort } = require("worker_threads");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

// ============================================================
// Database Path
// ============================================================

const dbDir = path.join(__dirname, "data");

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
`;


// ============================================================
// Open Database
// ============================================================

let db = null;

function openDatabase() {

    db = new Database(dbPath);

    // สร้าง table ถ้ายังไม่มี
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
// Worker Messages
// ============================================================

parentPort.on("message", (message) => {

    if (!message || !message.type) {
        return;
    }

    try {

        // ----------------------------------------------------
        // Ping
        // ----------------------------------------------------

        if (message.type === "ping") {

            send({
                type: "pong",
                message: "DB Worker is ready"
            });

            return;
        }


        // ----------------------------------------------------
        // SQLite Version
        // ----------------------------------------------------

        if (message.type === "sqlite-version") {

            const result = db
                .prepare("SELECT sqlite_version() AS version")
                .get();

            send({
                type: "sqlite-version",
                version: result.version
            });

            return;
        }
        // ----------------------------------------------------
        // Check Database Schema
        // ----------------------------------------------------

        if (message.type === "check-schema") {

            const tables = db
                .prepare(`
                    SELECT
                        name
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
                type: "check-schema",
                tables,
                columns
            });

            return;
        }


        // ----------------------------------------------------
        // Unknown Command
        // ----------------------------------------------------

        send({
            id: message.id,
            ok: false,
            error: `ไม่รู้จักคำสั่ง: ${message.type}`
        });

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
// Initialize Database
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