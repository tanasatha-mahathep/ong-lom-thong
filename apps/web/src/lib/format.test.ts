import { describe, expect, it } from "vitest";
import { EMPTY, formatInteger, formatMoney, formatThaiDate, formatThaiDateTime, formatWeight } from "./format";

describe("formatMoney — ข้อความทศนิยมจาก API ไม่ผ่าน float", () => {
  it("ใส่คั่นหลักพันและทศนิยม 2 ตำแหน่ง", () => {
    expect(formatMoney("20030")).toBe("20,030.00");
    expect(formatMoney("3418.09")).toBe("3,418.09");
    expect(formatMoney("0")).toBe("0.00");
  });

  it("เลขใหญ่เกินความละเอียดของ float ยังตรงทุกหลัก", () => {
    // Number("99999999999999.99") = 99999999999999.98 — ถ้าแปลงเป็น number จะผิดไป 1 สตางค์
    expect(formatMoney("99999999999999.99")).toBe("99,999,999,999,999.99");
    expect(formatMoney("12345678901234567.89")).toBe("12,345,678,901,234,567.89");
  });

  it("ปัดครึ่งขึ้น (HALF_UP) จากค่าทศนิยมจริง ไม่ใช่ค่าที่ float ปัดมาแล้ว", () => {
    expect(formatMoney("0.005")).toBe("0.01");
    expect(formatMoney("1.005")).toBe("1.01");
    expect(formatMoney("2.675")).toBe("2.68");
    // ต่ำกว่าครึ่งเพียงนิดเดียว — float ปัดเป็น 0.005 แล้วได้ 0.01 ซึ่งผิด
    expect(formatMoney("0.00499999999999999999")).toBe("0.00");
    expect(formatMoney("1.00499999999999999999")).toBe("1.00");
  });

  it("ค่าติดลบปัดออกจากศูนย์เหมือน decimal.js และไม่มี -0.00", () => {
    expect(formatMoney("-1234.5")).toBe("-1,234.50");
    expect(formatMoney("-0.005")).toBe("-0.01");
    expect(formatMoney("-1.005")).toBe("-1.01");
    expect(formatMoney("-0.00")).toBe("0.00");
    expect(formatMoney("-0.004")).toBe("0.00");
  });

  it("ค่าว่างแสดงขีด · ค่าที่ไม่ใช่ทศนิยมคืนตามเดิม (ไม่เดาเป็นตัวเลข)", () => {
    expect(formatMoney(null)).toBe(EMPTY);
    expect(formatMoney(undefined)).toBe(EMPTY);
    expect(formatMoney("")).toBe(EMPTY);
    for (const raw of ["abc", " 1.5", "1e3", "0x10", "1,000", "Infinity"]) {
      expect(formatMoney(raw)).toBe(raw);
    }
  });
});

describe("formatWeight — กรัม 3 ตำแหน่ง", () => {
  it("เติมศูนย์และคั่นหลักพัน", () => {
    expect(formatWeight("5.86")).toBe("5.860");
    expect(formatWeight("123456.789")).toBe("123,456.789");
  });

  it("ค่าที่ละเอียดกว่า 3 ตำแหน่งปัดจากค่าจริง", () => {
    expect(formatWeight("1.0005")).toBe("1.001");
    expect(formatWeight("1.00049999999999999999")).toBe("1.000");
    expect(formatWeight("-0.0005")).toBe("-0.001");
  });
});

describe("formatInteger — ราคาทองรูปพรรณ (0 ตำแหน่ง)", () => {
  it("จำนวนเต็มคั่นหลักพัน", () => {
    expect(formatInteger("64268")).toBe("64,268");
    expect(formatInteger("99999999999999999")).toBe("99,999,999,999,999,999");
  });

  it("เศษครึ่งปัดขึ้น", () => {
    expect(formatInteger("64268.5")).toBe("64,269");
    expect(formatInteger("-0.5")).toBe("-1");
  });
});

describe("วันที่ไทย พ.ศ.", () => {
  it("วันที่ล้วนจาก ISO ไม่เลื่อนตามเขตเวลาเครื่อง", () => {
    expect(formatThaiDate("2026-09-28")).toBe("28 ก.ย. 2569");
    expect(formatThaiDate("2026-09-28", "long")).toBe("28 กันยายน 2569");
    expect(formatThaiDate("2027-01-01")).toBe("1 ม.ค. 2570");
  });

  it("วันเวลาแสดงตามเวลาไทย", () => {
    // 18:30 UTC = 01:30 ของวันถัดไปที่กรุงเทพ
    expect(formatThaiDateTime("2026-09-27T18:30:00Z")).toBe("28 ก.ย. 2569 01:30");
  });

  it("ค่าว่าง/ผิดรูป/วันที่ไม่มีจริง ไม่ถูกแปลงเป็นวันอื่น", () => {
    expect(formatThaiDate(null)).toBe(EMPTY);
    expect(formatThaiDate("28/09/2569")).toBe("28/09/2569");
    expect(formatThaiDate("2026-02-30")).toBe("2026-02-30");
    expect(formatThaiDateTime("not a date")).toBe("not a date");
  });
});
