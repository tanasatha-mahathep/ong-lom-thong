import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// ด่าน coverage ของโมดูลเงินและเอกสารภาษีใน packages/core (CLAUDE.md กฎ 1–3): ต่อไฟล์ 100% ทั้ง lines · branches ·
// functions · statements — ทุกแขนงของโค้ดที่ออกยอดเงิน น้ำหนัก ราคาทอง เลขที่เอกสาร และตรวจบัตร ต้องมีเทสต์ถึง
// ไฟล์ที่ถึง 100% ไม่ได้โดยไม่แก้โค้ดจริง: ใส่ค่าที่วัดได้จริงของไฟล์นั้น + ชี้บรรทัดที่ยังไม่ครอบ (ห้าม v8 ignore)
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };
const MONEY_AND_TAX_MODULES = {
  "packages/core/src/buy.ts": FULL, // quoteBuy — ยอดบิล · ราคา/กรัม HALF_UP 2 · การชำระ (R3–R5)
  "packages/core/src/goldPrice.ts": FULL, // รับซื้อ = ขายออก − ส่วนต่าง · ทองรูปพรรณ HALF_UP 0 · ด่านพิมพ์ผิด (R8)
  "packages/core/src/money.ts": FULL, // parse ทศนิยม · HALF_UP · FLOOR · รูปแบบเงิน/น้ำหนัก
  "packages/core/src/docNo.ts": FULL, // เลขที่เอกสาร RC<yy><mm>-NNNN (R9)
  "packages/core/src/card.ts": FULL, // วันหมดอายุบัตร → บล็อกบิล (R2)
  "packages/core/src/nationalId.ts": FULL, // checksum + มาสก์เลขบัตร (R13)
  "packages/core/src/businessDate.ts": FULL, // "วันนี้" ตามเวลาไทย → งวดของเลขที่เอกสาร
};

// glob ที่ไม่ตรงไฟล์ใดเลย Vitest ให้ผ่านเงียบ ๆ — ย้าย/เปลี่ยนชื่อไฟล์แล้วลืมแก้ตรงนี้ ด่านจะหายไปเอง จึงเช็กก่อน (fail-closed)
const missing = Object.keys(MONEY_AND_TAX_MODULES).filter((file) => !existsSync(new URL(file, import.meta.url)));
if (missing.length > 0) throw new Error(`vitest.config.ts: ไม่พบไฟล์ที่อยู่ในด่าน coverage — ${missing.join(", ")}`);

export default defineConfig({
  test: {
    // แต่ละแพ็กเกจมี vitest.config.ts ของตัวเอง — `pnpm test` ที่ root รันทุกตัวในรอบเดียว
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
    // coverage ตั้งได้ที่ config root เท่านั้น · ปิดไว้ให้ `pnpm test` เร็วเท่าเดิม · `pnpm test:coverage` เปิด
    coverage: {
      enabled: false,
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      // CI เก็บรายงานได้แม้มีเทสต์ fail
      reportOnFailure: true,
      thresholds: MONEY_AND_TAX_MODULES,
    },
  },
});
