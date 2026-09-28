import { describe, expect, it } from "vitest";
import { normalizeDecimalInput } from "./decimal-input";

describe("normalizeDecimalInput — ข้อความที่พิมพ์ → ข้อความที่ส่ง API (ไม่ผ่าน number)", () => {
  it('เติม 0 หน้า ".5" และตัดจุดท้าย "5."', () => {
    expect(normalizeDecimalInput(".5")).toBe("0.5");
    expect(normalizeDecimalInput("5.")).toBe("5");
    expect(normalizeDecimalInput("67850.")).toBe("67850");
  });

  it("ตัดช่องว่างหัวท้าย", () => {
    expect(normalizeDecimalInput("  67850 ")).toBe("67850");
    expect(normalizeDecimalInput("   ")).toBe("");
  });

  it("รูปที่ API รับอยู่แล้วส่งตามที่พิมพ์ทุกหลัก", () => {
    for (const raw of ["67850", "67850.00", "67,850", "12345678901234567.89"]) {
      expect(normalizeDecimalInput(raw)).toBe(raw);
    }
  });

  it("รูปอื่นไม่เดา — ส่งตามที่พิมพ์ให้ API ตอบ error", () => {
    for (const raw of ["67,85", "1e3", "+5", "0x10", "-.5", "..5", "5..", "abc"]) {
      expect(normalizeDecimalInput(raw)).toBe(raw);
    }
  });
});
