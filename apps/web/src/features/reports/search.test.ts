import { describe, expect, it } from "vitest";
import { PurchaseSearchSchema, isoToThaiInput, lastMonth, parseDateInput, presetRange } from "./search";

describe("ตัวกรองใน URL", () => {
  it("ค่าที่ถูกผ่านตรงตัว", () => {
    expect(
      PurchaseSearchSchema.parse({ date_from: "2026-09-01", date_to: "2026-09-29", metal: "gold", branch_id: "b-1" }),
    ).toEqual({ date_from: "2026-09-01", date_to: "2026-09-29", metal: "gold", branch_id: "b-1" });
  });

  it("ค่าผิดรูปถูกทิ้งเป็นไม่กรอง — หน้าไม่พัง", () => {
    expect(
      PurchaseSearchSchema.parse({ date_from: "2026-02-30", date_to: "29/09/2569", metal: 123, branch_id: "" }),
    ).toEqual({});
  });
});

describe("ช่วงวันที่ด่วน", () => {
  it("เดือนนี้ · วันนี้", () => {
    expect(presetRange("thisMonth", "2026-09-29")).toEqual({ from: "2026-09-01", to: "2026-09-29" });
    expect(presetRange("today", "2026-09-29")).toEqual({ from: "2026-09-29", to: "2026-09-29" });
  });

  it("เดือนที่แล้ว — วันสุดท้ายถูกต้อง ข้ามปีได้ · กุมภาพันธ์ปีอธิกสุรทิน", () => {
    expect(presetRange("lastMonth", "2026-09-29")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(lastMonth("2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(lastMonth("2028-03-01")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(lastMonth("2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("ช่องวันที่ วว/ดด/ปปปป พ.ศ.", () => {
  it("ISO → ข้อความในช่อง", () => {
    expect(isoToThaiInput("2026-09-01")).toBe("01/09/2569");
  });

  it("รับรูปที่พนักงานพิมพ์จริง → ISO ค.ศ.", () => {
    expect(parseDateInput("01/09/2569")).toEqual({ iso: "2026-09-01" });
    expect(parseDateInput("1/9/2569")).toEqual({ iso: "2026-09-01" });
    expect(parseDateInput(" 1 ก.ย. 2569 ")).toEqual({ iso: "2026-09-01" });
  });

  it("ว่าง · ไม่ใช่วันจริง · ก่อนปี 2543 = error", () => {
    expect(parseDateInput("  ")).toEqual({ error: "required" });
    expect(parseDateInput("31/02/2569")).toEqual({ error: "invalid" });
    expect(parseDateInput("abc")).toEqual({ error: "invalid" });
    expect(parseDateInput("31/12/2542")).toEqual({ error: "tooEarly" });
  });
});
