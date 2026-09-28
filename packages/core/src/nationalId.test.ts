import { describe, expect, it } from "vitest";
import { isValidNationalId, maskNationalId, normalizeNationalId } from "./nationalId";

describe("เลขประจำตัวประชาชน", () => {
  it.each(["1670101304032", "1 6701 01304 03 2", "1-6701-01304-03-2", "1111111111119"])("ถูกต้อง: %s", (id) => {
    expect(isValidNationalId(id)).toBe(true);
  });

  it.each([
    ["1234567890123", "checksum ผิด (ข้อมูลทดสอบของ Django)"],
    ["1670101304033", "หลักสุดท้ายผิด"],
    ["167010130403", "12 หลัก"],
    ["16701013040321", "14 หลัก"],
    ["167010130403a", "มีตัวอักษร"],
    ["", "ว่าง"],
  ])("ไม่ถูกต้อง: %s (%s)", (id) => {
    expect(isValidNationalId(id)).toBe(false);
  });

  it("ตัดช่องว่าง/ขีดออก", () => {
    expect(normalizeNationalId(" 1 6701-01304 03 2 ")).toBe("1670101304032");
  });

  it("มาสก์: เห็นเฉพาะหลักแรกและ 3 หลักท้าย จัดกลุ่มแบบหน้าบัตร", () => {
    expect(maskNationalId("1670101304032")).toBe("1 XXXX XXXXX 03 2");
    expect(maskNationalId("1 6701 01304 03 2")).toBe("1 XXXX XXXXX 03 2");
  });

  it("ค่าที่ไม่ใช่เลขบัตรถูกปิดทั้งหมด ไม่หลุดตัวเลขใด", () => {
    expect(maskNationalId("12345")).toBe("XXXXX");
    expect(maskNationalId("")).toBe("X");
  });
});
