import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// รันหลายชุดพร้อมกันได้ (เช่น worktree ของเอเจนต์แต่ละตัว): WEB_PORT=5181 API_PORT=8791 make dev
const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? 8787);

/**
 * เวอร์ชันที่แสดงใต้เมนูผู้ใช้ (`__APP_VERSION__` · `__APP_COMMIT__` — ประกาศชนิดใน src/build-info.d.ts)
 * - เวอร์ชัน = release ล่าสุดใน CHANGELOG.md (semantic-release เขียนเอง · package.json เป็น 0.0.0-development ตลอด
 *   และ image ไม่มี .git ให้อ่าน tag) · ไม่เจอ = "dev"
 * - commit = RAILWAY_GIT_COMMIT_SHA (ถึง docker build ต่อเมื่อ apps/api/Dockerfile ประกาศ `ARG` — ยังไม่ได้ทำ) · GITHUB_SHA (CI) ·
 *   `git rev-parse` (เครื่อง dev) · ไม่มี = ว่าง
 */
function releaseVersion(): string {
  try {
    const changelog = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
    return /^##\s+\[?v?(\d+\.\d+\.\d+[^\]\s]*)/m.exec(changelog)?.[1] ?? "dev";
  } catch {
    return "dev";
  }
}

function commitSha(): string {
  const fromEnv = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.APP_COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(releaseVersion()),
    __APP_COMMIT__: JSON.stringify(commitSha()),
  },
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: webPort,
    strictPort: true,
    proxy: { "/api": `http://localhost:${apiPort}` },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // เบราว์เซอร์ขั้นต่ำ: Tailwind 4 ต้องการ Chrome/Edge 111 · Firefox 128 · Safari 16.4
    // ซึ่งรองรับ Intl.NumberFormat ที่รับข้อความทศนิยม (format เงินไม่ผ่าน float) ด้วย
    target: ["chrome111", "edge111", "firefox128", "safari16.4"],
    rollupOptions: {
      output: {
        // แยก library ออกจากโค้ดแอป — deploy ใหม่แล้ว browser ยังใช้ cache ของ library เดิมได้
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react";
          if (id.includes("/node_modules/@tanstack/")) return "tanstack";
          return "vendor";
        },
      },
    },
  },
});
