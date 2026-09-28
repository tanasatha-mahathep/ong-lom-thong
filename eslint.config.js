// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

// CLAUDE.md กฎ 1 — เงิน/น้ำหนักต้องผ่าน decimal.js เท่านั้น
const NO_FLOAT = "เงิน/น้ำหนักใช้ D() / parseDecimal() จาก @ong/core (decimal.js) — ห้าม parse เป็น float";

export default defineConfig(
  globalIgnores([
    "**/dist/",
    "coverage/",
    ".pnpm-store/",
    "apps/web/src/routeTree.gen.ts",
    "apps/web/.tanstack/",
    "packages/db/migrations/",
    // Playwright output: the HTML report bundles the trace viewer's JS
    "tests/e2e/test-results/",
    "tests/e2e/playwright-report/",
    "tests/e2e/blob-report/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // ไฟล์ config ที่ root ไม่อยู่ใน tsconfig ไหน
        projectService: { allowDefaultProject: ["*.js", "*.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-globals": ["error", { name: "parseFloat", message: NO_FLOAT }],
      "no-restricted-properties": ["error", { object: "Number", property: "parseFloat", message: NO_FLOAT }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
    languageOptions: { globals: globals.browser },
  },
  {
    // file route ของ TanStack Router: component อยู่คู่ `Route` โดยตั้งใจ — router plugin ทำ code-split + HMR เอง
    files: ["apps/web/src/routes/**/*.tsx"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    // @ong/core/receipt — component ที่ render ทั้งบนเว็บและใน API (PDF) · ไม่ใช่แอป vite จึงไม่ใช้ react-refresh
    files: ["packages/core/src/**/*.tsx"],
    extends: [reactHooks.configs.flat.recommended],
  },
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
);
