import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // แต่ละแพ็กเกจมี vitest.config.ts ของตัวเอง — `pnpm test` ที่ root รันทุกตัวในรอบเดียว
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts", "services/*/vitest.config.ts"],
  },
});
