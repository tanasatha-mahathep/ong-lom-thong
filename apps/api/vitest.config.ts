import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "api",
    include: ["src/**/*.test.ts"],
    // แต่ละไฟล์สร้าง database ของตัวเอง (migrate + seed) — เผื่อเวลาให้ Postgres
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
