import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    root: path.resolve(__dirname, "src/renderer"),

    server: {
        port: 5173,
        strictPort: true
    },

    build: {
        outDir: path.resolve(__dirname, "dist"),
        emptyOutDir: true
    }
});