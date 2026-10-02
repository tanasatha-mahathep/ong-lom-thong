import { describe, expect, it } from "vitest";
import { caretAfterDigits, deleteAcrossSeparator, digitsBefore, formatNationalIdInput } from "./national-id-input";

describe("formatNationalIdInput — จัดกลุ่ม 1-4-5-2-1 ขณะพิมพ์", () => {
  it.each([
    ["", ""],
    ["1", "1"],
    ["11", "1 1"],
    ["11037", "1 1037"],
    ["110370", "1 1037 0"],
    ["1103700123", "1 1037 00123"],
    ["11037001234", "1 1037 00123 4"],
    ["110370012345", "1 1037 00123 45"],
    ["1103700123458", "1 1037 00123 45 8"],
  ])("%j → %j (ไม่มีช่องว่างค้างท้าย)", (typed, shown) => {
    expect(formatNationalIdInput(typed)).toBe(shown);
  });

  it.each([
    ["วางแบบหน้าบัตรมีขีด", "1-1037-00123-45-8", "1 1037 00123 45 8"],
    ["จัดกลุ่มแล้วพิมพ์ต่อ", "1 1037 00123 45 8", "1 1037 00123 45 8"],
    ["ช่องว่างผิดที่", "11 03 7", "1 1037"],
    ["ตัวอักษรถูกตัดทิ้ง", "1a1b0", "1 10"],
    ["เกิน 13 หลักตัดส่วนเกิน", "11037001234589", "1 1037 00123 45 8"],
    ["ไม่มีตัวเลขเลย", "นาย", ""],
  ])("%s: %j → %j", (_label, typed, shown) => {
    expect(formatNationalIdInput(typed)).toBe(shown);
  });
});

describe("digitsBefore / caretAfterDigits — เคอร์เซอร์อยู่หลังตัวเลขตัวเดิมหลังจัดกลุ่มใหม่", () => {
  it("นับเฉพาะตัวเลขทางซ้าย", () => {
    expect(digitsBefore("1 1037 00", 0)).toBe(0);
    expect(digitsBefore("1 1037 00", 2)).toBe(1);
    expect(digitsBefore("1 1037 00", 6)).toBe(5);
    expect(digitsBefore("1 1037 00", 99)).toBe(7);
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 3],
    [5, 6],
    [6, 8],
    [7, 9],
    [99, 9],
  ])("หลังตัวเลขตัวที่ %i ใน '1 1037 00' = ตำแหน่ง %i", (n, pos) => {
    expect(caretAfterDigits("1 1037 00", n)).toBe(pos);
  });

  it("แทรกตัวเลขกลางกลุ่ม: เคอร์เซอร์ตามตัวที่เพิ่งพิมพ์ ไม่กระโดดไปท้ายช่อง", () => {
    // "1 1037 00" พิมพ์ 9 หลังหลักที่ 3 → ข้อความดิบ "1 109|37 00" (เคอร์เซอร์ตำแหน่ง 5)
    const raw = "1 10937 00";
    const n = digitsBefore(raw, 5);
    const shown = formatNationalIdInput(raw);
    expect(shown).toBe("1 1093 700");
    expect(caretAfterDigits(shown, n)).toBe(5);
  });
});

describe("deleteAcrossSeparator — Backspace/Delete ที่ติดช่องว่างลบตัวเลขข้าง ๆ", () => {
  it("Backspace หลังช่องว่าง → ลบตัวเลขก่อนช่องว่าง", () => {
    // "1 1037 0|0" ไม่ใช่กรณีนี้ · "1 1037 |00" (ตำแหน่ง 7) → ลบ 7 → "1 1030 0"
    expect(deleteAcrossSeparator("1 1037 00", 7, "Backspace")).toEqual({ text: "1 1030 0", digitsBeforeCaret: 4 });
    // "1 |1037" → ลบหลักแรก
    expect(deleteAcrossSeparator("1 1037", 2, "Backspace")).toEqual({ text: "1 037", digitsBeforeCaret: 0 });
  });

  it("Delete ก่อนช่องว่าง → ลบตัวเลขหลังช่องว่าง", () => {
    // "1 1037| 00" (ตำแหน่ง 6) → ลบ 0 ตัวแรกของกลุ่มที่สาม
    expect(deleteAcrossSeparator("1 1037 00", 6, "Delete")).toEqual({ text: "1 1037 0", digitsBeforeCaret: 5 });
  });

  it("ไม่ติดช่องว่าง → null (เบราว์เซอร์ลบเอง)", () => {
    expect(deleteAcrossSeparator("1 1037 00", 9, "Backspace")).toBeNull();
    expect(deleteAcrossSeparator("1 1037 00", 4, "Delete")).toBeNull();
    expect(deleteAcrossSeparator("", 0, "Backspace")).toBeNull();
    expect(deleteAcrossSeparator("1 1037", 0, "Delete")).toBeNull();
  });
});
