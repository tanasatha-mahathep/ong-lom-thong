import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { ReceiptDataError } from "./errors";
import { formatMoney, formatWeight, requireDecimal } from "./money";

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
