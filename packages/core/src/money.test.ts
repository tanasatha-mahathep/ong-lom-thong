import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { parseDecimal } from "./money";

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
    ["5,860", "5860"], // คั่นหลักพันถูกต้อง = ห้าพันกว่า (เพดานน้ำหนักต่อแถวยังตรวจต่อใน quoteBuy)
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
