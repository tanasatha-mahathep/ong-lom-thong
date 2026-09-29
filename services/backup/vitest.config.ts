import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "backup",
    // เทสต์เรียก bash จริง (lib.sh / backup.sh กับคำสั่งปลอมใน PATH) — ไม่ต้องมี S3
    // restore-doc-counters.test.ts รัน SQL กับ schema จริง: psql + Postgres (TEST_DATABASE_URL) — ไม่มีข้าม · CI ต้องมี
    include: ["*.test.ts"],
  },
});
