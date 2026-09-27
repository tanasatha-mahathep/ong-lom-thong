import { describe, expect, it } from "vitest";
import { docPeriod, formatDocNo } from "./docNo";

describe("formatDocNo — RC<ปีพ.ศ.2หลัก><เดือน>-<running 4 หลัก>", () => {
  it("1 ต.ค. 2569 ใบแรก → RC6910-0001", () => {
    expect(formatDocNo("RC", "2026-10-01", 1)).toBe("RC6910-0001");
  });
  it("ก.ย. 2569 ใบที่ 85 → RC6909-0085 (เดือนที่สำรวจมี RC 85 ใบ)", () => {
    expect(formatDocNo("RC", "2026-09-27", 85)).toBe("RC6909-0085");
  });
  it("ข้ามปี พ.ศ. 2570 → 7001", () => {
    expect(docPeriod("2027-01-15")).toBe("7001");
  });
  it("เกิน 9999 ใบ/เดือน ยังไม่ชน (5 หลัก)", () => {
    expect(formatDocNo("RC", "2026-10-01", 10000)).toBe("RC6910-10000");
  });
  it.each([0, -1, 1.5])("running %j ไม่ถูกต้อง", (n) => {
    expect(() => formatDocNo("RC", "2026-10-01", n)).toThrow(RangeError);
  });
  it.each(["2026-1-1", "01/10/2026", ""])("วันที่ %j ไม่ใช่ ISO", (d) => {
    expect(() => docPeriod(d)).toThrow(RangeError);
  });
});
