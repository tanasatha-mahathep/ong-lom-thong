import { describe, expect, it } from "vitest";
import { businessDate } from "./businessDate";

describe("businessDate — วันตามเวลาไทย ไม่ใช่ UTC", () => {
  it.each([
    ["2026-09-27T16:59:59Z", "2026-09-27"], // 23:59:59 ไทย
    ["2026-09-27T17:00:00Z", "2026-09-28"], // เที่ยงคืนไทย
    ["2026-09-27T18:30:00Z", "2026-09-28"], // 01:30 ไทย แต่ UTC ยังเป็นวันที่ 27
    ["2026-12-31T17:00:00Z", "2027-01-01"], // ข้ามปี
    ["2028-02-28T17:00:00Z", "2028-02-29"], // ปีอธิกสุรทิน
  ])("%s → %s", (iso, expected) => {
    expect(businessDate(new Date(iso))).toBe(expected);
  });

  it("เปลี่ยนเขตเวลาได้", () => {
    expect(businessDate(new Date("2026-09-27T18:30:00Z"), "UTC")).toBe("2026-09-27");
  });
});
