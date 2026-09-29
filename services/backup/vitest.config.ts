import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "backup",
    // เทสต์เรียก bash จริง (lib.sh / backup.sh กับคำสั่งปลอมใน PATH) — ไม่ต้องมี S3
    // restore-doc-counters.test.ts รัน SQL กับ schema จริง: psql + Postgres (TEST_DATABASE_URL) — ไม่มีข้าม · CI ต้องมี
    include: ["*.test.ts"],
    // แต่ละเทสต์ spawn bash/psql จริง — ใต้โหลด (CI 2 core รันหลาย project พร้อมกัน) 5 วิ ตามค่าเริ่มต้นไม่พอ
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
