const { parentPort } = require("worker_threads");
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbDir = path.join(__dirname, "data");

if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, "templates.db");

const db = new Database(dbPath);

parentPort.on("message", (message) => {
    if (message.type === "ping") {
        parentPort.postMessage({
            type: "pong",
            message: "DB Worker is ready"
        });
    }

    if (message.type === "sqlite-version") {
        const row = db
            .prepare("SELECT sqlite_version() AS version")
            .get();

        parentPort.postMessage({
            type: "sqlite-version",
            version: row.version
        });
    }
});