import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);


// ============================================================
// Vendored JSZip
// ============================================================

// renderer โหลด jszip ด้วย <script> ธรรมดา (ไม่ผ่าน bundler)
// จึงต้องมีไฟล์จริงให้ทั้ง dev server และ dist
const JSZIP_URL = "/vendor/jszip.min.js";

let jszipSource = null;

function getJszipSource() {

    if (!jszipSource) {

        jszipSource = require.resolve(
            "jszip/dist/jszip.min.js"
        );
    }

    return jszipSource;
}


function vendoredJszipPlugin() {

    return {

        name: "vendored-jszip",

        // dev: เสิร์ฟไฟล์จาก node_modules
        configureServer(server) {

            server.middlewares.use(
                (req, res, next) => {

                    const url =
                        (req.url || "")
                            .split("?")[0];

                    if (url !== JSZIP_URL) {
                        return next();
                    }

                    res.setHeader(
                        "Content-Type",
                        "text/javascript; charset=utf-8"
                    );

                    fs.createReadStream(
                        getJszipSource()
                    ).pipe(res);
                }
            );
        },

        // build: คัดลอกเข้า dist/vendor
        closeBundle() {

            const target = path.resolve(
                __dirname,
                "dist/vendor/jszip.min.js"
            );

            fs.mkdirSync(
                path.dirname(target),
                {
                    recursive: true
                }
            );

            fs.copyFileSync(
                getJszipSource(),
                target
            );

            console.log(
                "Copied jszip -> dist/vendor/jszip.min.js"
            );
        }
    };
}


// ============================================================
// Thai Dictionary
// ============================================================

// พจนานุกรม .dic/.aff เก็บที่ <project>/dictionary (ไม่ใช่ public/)
// เพราะเป็นไฟล์ต้นทาง ไม่ต้องคัดลอกดิบ ๆ ทั้งสองไฟล์เข้า dist
//
// ตอน dev/build จะถูกแปลงเป็น JS ที่กำหนด window.ThaiDictionary แล้วโหลดด้วย
// <script> ธรรมดา — จำเป็นเพราะ .exe เปิดหน้าด้วย file:// ซึ่ง fetch/XHR
// อ่านไฟล์ในเครื่องจะถูก Chromium บล็อก
const DICT_DIR = path.resolve(
    __dirname,
    "dictionary"
);

const DICT_DIC = path.join(DICT_DIR, "th_TH.dic");
const DICT_AFF = path.join(DICT_DIR, "th_TH.aff");

const DICT_URL = "/dictionary/th_TH.js";
const DICT_TARGET = "dist/dictionary/th_TH.js";


// อ่าน .aff เฉพาะส่วนที่ใช้จริงตอนแนะนำคำ
// (ไม่ใช้กฎ affix PFX/SFX เพราะไฟล์นี้เป็นรายการคำล้วน)
function parseAff(text) {

    const aff = {
        try: "",
        rep: [],
        key: [],
        iconv: [],
        break: []
    };

    for (const rawLine of String(text).split(/\r?\n/)) {

        const line = rawLine.trim();

        if (!line || line.startsWith("#")) continue;

        const space = line.indexOf(" ");

        if (space === -1) continue;

        const name = line.slice(0, space).toUpperCase();
        const rest = line.slice(space + 1).trim();

        // บรรทัดจำนวน (เช่น "REP 9") ไม่มีข้อมูล จึงถูกข้ามด้วยเงื่อนไขด้านล่าง
        if (name === "TRY") {
            aff.try += rest;
        } else if (name === "REP") {
            const parts = rest.split(/\s+/);
            if (parts.length >= 2) {
                aff.rep.push([
                    parts[0],
                    parts[1].replace(/_/g, " ")
                ]);
            }
        } else if (name === "KEY") {
            // รูปแบบ: "ก/หด|ข/จช" (- = ตัวอักษรที่อยู่ข้างกันในคีย์บอร์ด)
            for (const group of rest.split("|")) {
                const slash = group.indexOf("/");
                if (slash <= 0) continue;

                const from = group.slice(0, slash);
                const to = group.slice(slash + 1).replace(/_/g, " ");

                if (from && to) aff.key.push([from, to]);
            }
        } else if (name === "ICONV") {
            const parts = rest.split(/\s+/);
            if (parts.length >= 2) {
                aff.iconv.push([parts[0], parts[1]]);
            }
        } else if (name === "BREAK") {
            for (const char of rest) aff.break.push(char);
        }
    }

    return aff;
}


// บรรทัดของ .dic = คำ (อาจมี /flags ต่อท้าย) — ข้ามบรรทัดจำนวน/คอมเมนต์
function parseDicWords(text) {

    return String(text)
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map(line => {

            const trimmed = line.trim();

            // flags ใช้กับกฎ affix ซึ่งไฟล์นี้ไม่มี จึงตัดทิ้งได้
            const slash = trimmed.indexOf("/");

            return (slash === -1 ? trimmed : trimmed.slice(0, slash)).trim();
        })
        .filter(word => word && !word.startsWith("#") && !/^\d+$/.test(word));
}


let dictCache = null;

function getDictionaryJs() {

    const mtime = Math.max(
        fs.statSync(DICT_DIC).mtimeMs,
        fs.statSync(DICT_AFF).mtimeMs
    );

    // แก้ไฟล์ .dic/.aff แล้วไม่ต้องรีสตาร์ท dev server
    if (dictCache && dictCache.mtime === mtime) {
        return dictCache.js;
    }

    const words = parseDicWords(
        fs.readFileSync(DICT_DIC, "utf8")
    );

    const aff = parseAff(
        fs.readFileSync(DICT_AFF, "utf8")
    );

    // คำเก็บเป็นสตริงคั่นด้วย \n (ไฟล์เล็กลงกว่าอาเรย์ literal มาก)
    const js =
        "window.ThaiDictionary = " +
        JSON.stringify({
            words: words.join("\n"),
            aff
        }) +
        ";\n";

    dictCache = { mtime, js };

    return js;
}


function dictionaryPlugin() {

    return {

        name: "thai-dictionary",

        // dev: เสิร์ฟ JS ที่แปลงเสร็จแล้ว
        configureServer(server) {

            server.middlewares.use(
                (req, res, next) => {

                    const url =
                        (req.url || "")
                            .split("?")[0];

                    if (url !== DICT_URL) {
                        return next();
                    }

                    try {

                        res.setHeader(
                            "Content-Type",
                            "text/javascript; charset=utf-8"
                        );

                        res.end(
                            getDictionaryJs()
                        );

                    } catch (error) {

                        next(error);
                    }
                }
            );
        },

        // build: เขียนไฟล์จริงลง dist
        closeBundle() {

            const target = path.resolve(
                __dirname,
                DICT_TARGET
            );

            fs.mkdirSync(
                path.dirname(target),
                {
                    recursive: true
                }
            );

            fs.writeFileSync(
                target,
                getDictionaryJs()
            );

            console.log(
                "Copied dictionary -> " + DICT_TARGET
            );
        }
    };
}


// ============================================================
// Public Dir Reload
// ============================================================

// ไฟล์ใน public/ ถูกเสิร์ฟตรง ๆ ไม่ผ่าน module graph
// Vite จึงไม่ reload ให้เวลาแก้ไฟล์ใน public/ ระหว่าง dev
// plugin นี้ทำให้บันทึกแล้วหน้าต่าง Electron รีเฟรชเอง
function publicDirReloadPlugin(dir) {

    const normalizedDir =
        path.resolve(dir).replace(/\\/g, "/");

    function isPublicFile(file) {

        return String(file)
            .replace(/\\/g, "/")
            .startsWith(normalizedDir);
    }

    return {

        name: "public-dir-reload",

        apply: "serve",

        configureServer(server) {

            const reload = (file) => {

                if (!isPublicFile(file)) {
                    return;
                }

                server.config.logger.info(
                    `[public] reload ${path.basename(file)}`,
                    {
                        timestamp: true
                    }
                );

                server.ws.send({
                    type: "full-reload",
                    path: "*"
                });
            };

            server.watcher.on("change", reload);
            server.watcher.on("add", reload);
            server.watcher.on("unlink", reload);
        }
    };
}


export default defineConfig(({ command }) => ({

    root: path.resolve(
        __dirname,
        "src/renderer"
    ),

    // ให้ Vite ใช้ public ที่ root project
    publicDir: path.resolve(
        __dirname,
        "public"
    ),

    // ตอน build ไฟล์ถูกเปิดด้วย file:// (Electron .exe)
    // path แบบ absolute (/assets/...) จะหาไฟล์ไม่เจอ
    base: command === "build" ? "./" : "/",

    server: {
        port: 5173,
        strictPort: true
    },

    build: {
        outDir: path.resolve(
            __dirname,
            "dist"
        ),

        emptyOutDir: true,

        rollupOptions: {
            input: path.resolve(
                __dirname,
                "src/renderer/index.html"
            )
        }
    },

    plugins: [
        vendoredJszipPlugin(),
        dictionaryPlugin(),
        publicDirReloadPlugin(
            path.resolve(
                __dirname,
                "public"
            )
        )
    ]

}));