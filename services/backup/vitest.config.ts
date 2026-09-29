import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "backup",
    // เทสต์เรียก bash จริง (lib.sh / backup.sh กับคำสั่งปลอมใน PATH) — ไม่ต้องมี Postgres/S3
    include: ["*.test.ts"],
  },
});
