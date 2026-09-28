import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { barSellErrorOf, typoWarningOf } from "./queries";

const WARNING = "ราคาห่างจากครั้งก่อน 4.4% (67,850 → 70,850) — ตรวจสอบก่อนบันทึก";
const conflict = (body: { error: string; field?: string; warning?: string }) =>
  new ApiError(409, body.error, body.field, body);

describe("typoWarningOf — 409 ของด่านกันพิมพ์ผิด (สัญญา #60)", () => {
  it("field confirm_typo + warning → ข้อความเตือน", () => {
    expect(typoWarningOf(conflict({ error: WARNING, field: "confirm_typo", warning: WARNING }))).toBe(WARNING);
  });

  it("field confirm_typo ไม่มี warning → ใช้ error (ข้อความเดียวกัน)", () => {
    expect(typoWarningOf(conflict({ error: WARNING, field: "confirm_typo" }))).toBe(WARNING);
  });

  it("409 อื่น / status อื่น ไม่ใช่ด่านกันพิมพ์ผิด", () => {
    expect(typoWarningOf(conflict({ error: "conflict" }))).toBeNull();
    expect(typoWarningOf(new ApiError(400, WARNING, "confirm_typo", { error: WARNING, warning: WARNING }))).toBeNull();
    expect(typoWarningOf(new Error(WARNING))).toBeNull();
  });

  it("400 ที่ชี้ bar_sell (เช่นเกิน 999,999.99) เป็น error ใต้ช่อง ไม่ใช่ด่านกันพิมพ์ผิด", () => {
    const tooHigh = new ApiError(400, "ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง", "bar_sell", {});
    expect(barSellErrorOf(tooHigh)).toBe("ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง");
    expect(typoWarningOf(tooHigh)).toBeNull();
  });
});
