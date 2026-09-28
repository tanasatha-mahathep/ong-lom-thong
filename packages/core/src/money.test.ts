import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { ReceiptDataError } from "./errors";
import { formatMoney, formatWeight, parseDecimal, parsePlainDecimal, requireDecimal } from "./money";

describe("parseDecimal — รับเฉพาะตัวเลขธรรมดา หรือคั่นหลักพันถูกต้อง", () => {
  it.each([
    ["20030", "20030"],
    ["5.860", "5.86"],
    ["0", "0"],
    ["0.5", "0.5"],
    ["007", "7"],
    ["  67,850  ", "67850"], // ราคาทองที่ร้านพิมพ์แบบมีคอมมา
    ["67,850.50", "67850.5"],
    ["1,234,567.891", "1234567.891"],
    ["5,860", "5860"], // เงินคั่นหลักพันได้ — น้ำหนักใช้ parsePlainDecimal (ไม่รับจุลภาค)
  ])("%j → %s", (input, expected) => {
    expect(parseDecimal(input)?.toString()).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "abc",
    "12abc",
    "0x10", // hex
    "0b101",
    "1e3", // exponent
    "6.785E4",
    "-1", // เครื่องหมาย
    "+1",
    "20,03", // คอมมาผิดตำแหน่ง
    "1,2345",
    "12,34,567",
    ",123",
    "123,",
    "1,000.",
    "0,123", // กลุ่มแรกขึ้นต้นด้วย 0 — ไม่ใช่การคั่นหลักพัน
    "1.2.3",
    ".5",
    "5.",
    "1 000",
    "Infinity",
    "NaN",
    "๑๒๓", // เลขไทย
    "1\u00005",
  ])("ปฏิเสธ %j", (input) => {
    expect(parseDecimal(input)).toBeNull();
  });

  it.each([null, undefined, {}, [], true])("ไม่ใช่ข้อความ %j → null", (input) => {
    expect(parseDecimal(input)).toBeNull();
  });

  it("ค่า Decimal/number ที่มาจากโค้ดผ่านตามเดิม (finite เท่านั้น)", () => {
    expect(parseDecimal(new Decimal("67850"))?.toString()).toBe("67850");
    expect(parseDecimal(67850)?.toString()).toBe("67850");
    expect(parseDecimal(Number.NaN)).toBeNull();
    expect(parseDecimal(new Decimal(Infinity))).toBeNull();
  });
});

describe("formatMoney / formatWeight — ตัวเลขบนใบพิมพ์", () => {
  it.each([
    ["20030", "20,030.00"],
    ["3418.09", "3,418.09"],
    ["999", "999.00"],
    ["1000", "1,000.00"],
    ["0", "0.00"],
    ["0.5", "0.50"],
    ["999999999999.99", "999,999,999,999.99"],
    ["-1234.5", "-1,234.50"],
    ["-0.001", "0.00"],
    ["1.005", "1.01"],
    ["67,850", "67,850.00"],
  ])("เงิน %s → %s", (v, want) => {
    expect(formatMoney(v)).toBe(want);
  });

  it.each([
    ["5.86", "5.860"],
    ["5.860", "5.860"],
    ["0.1", "0.100"],
    ["1250.5", "1,250.500"],
    ["1234567.891", "1,234,567.891"],
  ])("น้ำหนัก %s → %s", (v, want) => {
    expect(formatWeight(v)).toBe(want);
  });

  it("รับ Decimal ได้", () => {
    expect(formatMoney(new Decimal("0.1").plus("0.2"))).toBe("0.30");
  });

  it.each(["", " ", "abc", "Infinity", "NaN"])("ไม่ใช่ตัวเลข (%s) → ReceiptDataError", (bad) => {
    expect(() => formatMoney(bad)).toThrow(ReceiptDataError);
    expect(() => formatWeight(bad)).toThrow(ReceiptDataError);
    expect(() => requireDecimal(bad, "ยอดบิล")).toThrow(/ยอดบิลไม่ใช่ตัวเลข/);
  });
});

describe("requireDecimal — ตัวเลขบนเอกสาร: รูปแบบเข้มเดียวกับ parseDecimal + ติดลบได้", () => {
  it.each([
    ["20030.00", "20030"],
    ["-1234.5", "-1234.5"],
    ["-67,850", "-67850"],
  ])("%j → %s", (v, want) => {
    expect(requireDecimal(v).toString()).toBe(want);
  });

  it.each(["0x10", "1e3", "- 5", "--5", "+5", "20,03"])("ไม่รับ %j → ReceiptDataError", (bad) => {
    expect(() => requireDecimal(bad)).toThrow(ReceiptDataError);
  });
});

describe("parsePlainDecimal — น้ำหนัก: ตัวเลขล้วน ไม่มีจุลภาค", () => {
  it.each([
    ["5.860", "5.86"],
    [" 1250.500 ", "1250.5"],
    ["0", "0"],
  ])("%j → %s", (v, want) => {
    expect(parsePlainDecimal(v)?.toString()).toBe(want);
  });

  it.each(["5,860", "1,250.500", "5,86", "", "-1", "1e3", "0x10", ".5", "abc"])("ปฏิเสธ %j", (v) => {
    expect(parsePlainDecimal(v)).toBeNull();
  });

  it.each([5.86, null, undefined])("ไม่ใช่ข้อความ %j → null", (v) => {
    expect(parsePlainDecimal(v)).toBeNull();
  });
});
