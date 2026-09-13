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
        publicDirReloadPlugin(
            path.resolve(
                __dirname,
                "public"
            )
        )
    ]

}));