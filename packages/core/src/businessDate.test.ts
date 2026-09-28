import { afterEach, describe, expect, it, vi } from "vitest";
import { businessDate, businessTime } from "./businessDate";

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

describe("businessTime — เวลาไทย HH:MM (24 ชม.)", () => {
  it.each([
    ["2026-09-28T03:05:00Z", "10:05"],
    ["2026-09-27T16:59:59Z", "23:59"], // วินาทีตัดทิ้ง ไม่ปัดขึ้น
    ["2026-09-27T17:00:00Z", "00:00"], // เที่ยงคืนไทย = 00 ไม่ใช่ 24
    ["2026-09-27T17:30:00Z", "00:30"],
  ])("%s → %s", (iso, expected) => {
    expect(businessTime(new Date(iso))).toBe(expected);
  });

  it("เปลี่ยนเขตเวลาได้", () => {
    expect(businessTime(new Date("2026-09-27T18:30:00Z"), "UTC")).toBe("18:30");
  });
});

describe("Intl ที่คืนส่วนไม่ครบ — หยุด ไม่คืนค่าผิดรูปเงียบ ๆ", () => {
  const partsWithout = (missing: string) =>
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function () {
      return {
        formatToParts: () =>
          [
            { type: "year", value: "2026" },
            { type: "month", value: "09" },
            { type: "day", value: "28" },
            { type: "hour", value: "10" },
            { type: "minute", value: "05" },
          ].filter((p) => p.type !== missing),
      } as unknown as Intl.DateTimeFormat;
    });

  afterEach(() => vi.restoreAllMocks());

  it.each(["year", "month", "day"])("businessDate ไม่มี %s = throw", (missing) => {
    partsWithout(missing);
    expect(() => businessDate(new Date())).toThrow(/businessDate/);
  });

  it.each(["hour", "minute"])("businessTime ไม่มี %s = throw", (missing) => {
    partsWithout(missing);
    expect(() => businessTime(new Date())).toThrow(/businessTime/);
  });
});
