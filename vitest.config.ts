import { readdirSync } from "node:fs";
import { sep } from "node:path";
import { defineConfig } from "vitest/config";

// ด่าน coverage ของ packages/core (CLAUDE.md กฎ 1–3): ทุกโมดูลที่รันจริงใน packages/core/src — เงิน น้ำหนัก ราคาทอง
// วันที่ เลขที่เอกสาร บัตร และใบรับซื้อ (รวมเทมเพลต .tsx ที่พิมพ์เป็นเอกสารภาษี) — ต้องมีเทสต์ถึง 100% ราย file
// ทั้ง lines · branches · functions · statements · หาไฟล์เองทุกครั้งที่โหลด config: โมดูลใหม่เข้าด่านทันที (fail-closed)
const CORE_SRC = "packages/core/src";
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };

// ข้อยกเว้น: ไฟล์ที่ถึง 100% ไม่ได้โดยไม่แก้โค้ดจริง — ใส่ค่าที่วัดได้จริง + บรรทัดที่ไม่ครอบและเหตุผล (ห้าม v8 ignore)
// ค่าติดลบ = จำนวนที่ไม่ครอบได้สูงสุด (Vitest) — แน่นกว่า % เพราะไฟล์โตขึ้นแล้วไม่เปิดช่องให้แขนงใหม่หลุด
// ทั้งหมดคือ fallback `?? ""` / `? :` ที่มีไว้ให้ TypeScript (noUncheckedIndexedAccess) แต่ไปถึงจริงไม่ได้
const MEASURED: Record<string, typeof FULL> = {
  // L78 `named[2] ?? ""` — กลุ่มที่ 2 ของ DAY_MONTH_YEAR ไม่ใช่ optional: regex match แล้วต้องมีค่าเสมอ
  "packages/core/src/card.ts": { ...FULL, branches: -1 },
  // L60–61 `dot === -1 ? …` — groupThousands เป็น private รับแต่ผล toFixed(2) / toFixed(3) ซึ่งมีจุดทศนิยมเสมอ
  "packages/core/src/money.ts": { ...FULL, branches: -2 },
  // L26 `DIGIT[d] ?? ""` · `PLACE[pos] ?? ""` · L110 `MONTH[m - 1] ?? ""` · L116 `MONTH_ABBR[m - 1] ?? ""` —
  // หลักมาจาก toFixed ของ Decimal ที่ตรวจแล้ว · กลุ่มละไม่เกิน 6 หลัก · เดือนผ่านการตรวจ 1–12 มาก่อน
  "packages/core/src/thai.ts": { ...FULL, branches: -4 },
};

const isRuntimeModule = (file: string) =>
  /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !/(^|\/)index\.ts$/.test(file);
const modules = readdirSync(new URL(`${CORE_SRC}/`, import.meta.url), { recursive: true, encoding: "utf8" })
  .map((file) => `${CORE_SRC}/${file.split(sep).join("/")}`)
  .filter(isRuntimeModule);
// ด่านต้องไม่ผ่านเงียบ ๆ (fail-closed) — Vitest ให้ glob ที่ไม่ตรงไฟล์ใดผ่านโดยไม่เตือน จึงหยุดตั้งแต่โหลด config เมื่อ:
// ตัวกรองหาโมดูลหลักไม่เจอ · path มีอักขระ glob (จะถูกอ่านเป็น pattern ไม่ใช่ชื่อไฟล์) · ข้อยกเว้นชี้ไฟล์ที่ไม่มีแล้ว
if (!modules.includes(`${CORE_SRC}/buy.ts`)) {
  throw new Error(
    `vitest.config.ts: ไม่พบ ${CORE_SRC}/buy.ts (quoteBuy) — ตรวจ CORE_SRC และตัวกรองไฟล์ของด่าน coverage`,
  );
}
const globLike = modules.filter((file) => /[*?[\]{}()!]/.test(file));
if (globLike.length > 0) throw new Error(`vitest.config.ts: ชื่อไฟล์มีอักขระ glob — ${globLike.join(", ")}`);
const stale = Object.keys(MEASURED).filter((file) => !modules.includes(file));
if (stale.length > 0) throw new Error(`vitest.config.ts: ข้อยกเว้น coverage ชี้ไฟล์ที่ไม่มีแล้ว — ${stale.join(", ")}`);

export default defineConfig({
  test: {
    // แต่ละแพ็กเกจมี vitest.config.ts ของตัวเอง — `pnpm test` ที่ root รันทุกตัวในรอบเดียว
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
    // coverage ตั้งได้ที่ config root เท่านั้น · ปิดไว้ให้ `pnpm test` เร็วเท่าเดิม · `pnpm test:coverage` เปิด
    coverage: {
      enabled: false,
      provider: "v8",
      include: [`${CORE_SRC}/**/*.{ts,tsx}`],
      exclude: ["**/*.test.{ts,tsx}", "**/index.ts"],
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      // CI เก็บรายงานได้แม้มีเทสต์ fail
      reportOnFailure: true,
      thresholds: Object.fromEntries(modules.map((file) => [file, MEASURED[file] ?? FULL])),
    },
  },
});
