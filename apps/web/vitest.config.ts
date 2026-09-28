import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// project "web" ของ vitest ที่ root (vitest.config.ts → apps/*/vitest.config.ts) — jsdom + Testing Library
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "web",
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    // เทสต์ทั้งแอปมี findBy หลายจุด (จุดละไม่เกิน 10 วินาที ดู src/test/setup.ts) — เผื่อเครื่องที่ load สูง
    testTimeout: 30_000,
  },
});
