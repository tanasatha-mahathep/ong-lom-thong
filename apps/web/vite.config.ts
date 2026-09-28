import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// รันหลายชุดพร้อมกันได้ (เช่น worktree ของเอเจนต์แต่ละตัว): WEB_PORT=5181 API_PORT=8791 make dev
const webPort = Number(process.env.WEB_PORT ?? 5173);
const apiPort = Number(process.env.API_PORT ?? 8787);

export default defineConfig({
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
