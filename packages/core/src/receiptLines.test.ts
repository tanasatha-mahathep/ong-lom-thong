import { describe, expect, it } from "vitest";
import { groupLinesByMetal } from "./receiptLines";

describe("groupLinesByMetal — ใบจริงพิมพ์ 1 บรรทัดต่อโลหะ", () => {
  it("RC6909-0010: ทอง 3 %เนื้อ → 1 บรรทัด 5.860 ก. · 3,418.09/ก. · 20,030.00 (Django BuyReceiptGroupingTest)", () => {
    const rows = groupLinesByMetal([
      { metalName: "ทอง", weightG: "2.000", amount: "8000" },
      { metalName: "ทอง", weightG: "1.860", amount: "6000" },
      { metalName: "ทอง", weightG: "2.000", amount: "6030" },
    ]);
    expect(rows).toEqual([{ metalName: "ทอง", weightG: "5.860", unitPrice: "3418.09", amount: "20030.00" }]);
  });

  it("หลายโลหะ: เรียงตามลำดับที่ปรากฏครั้งแรก", () => {
    const rows = groupLinesByMetal([
      { metalName: "เงิน", weightG: "100.5", amount: "3000" },
      { metalName: "ทอง", weightG: "1", amount: "3400.50" },
      { metalName: "เงิน", weightG: "0.5", amount: "15" },
    ]);
    expect(rows.map((r) => r.metalName)).toEqual(["เงิน", "ทอง"]);
    expect(rows[0]).toEqual({ metalName: "เงิน", weightG: "101.000", unitPrice: "29.85", amount: "3015.00" });
    expect(rows[1]).toEqual({ metalName: "ทอง", weightG: "1.000", unitPrice: "3400.50", amount: "3400.50" });
  });

  it("ผลรวมและราคาต่อหน่วยเป็น decimal ไม่ใช่ float", () => {
    // 0.1 + 0.2 ใน float = 0.30000000000000004 · 10.05 ÷ 2 ใน float = 5.02499… → ปัดผิดเป็น 5.02
    const rows = groupLinesByMetal([
      { metalName: "ทอง", weightG: "0.1", amount: "5.02" },
      { metalName: "ทอง", weightG: "0.2", amount: "5.03" },
      { metalName: "นาก", weightG: "2.000", amount: "10.05" },
    ]);
    expect(rows[0]).toEqual({ metalName: "ทอง", weightG: "0.300", unitPrice: "33.50", amount: "10.05" });
    expect(rows[1]?.unitPrice).toBe("5.03");
  });

  it("ไม่มีแถว → ไม่มีบรรทัด", () => {
    expect(groupLinesByMetal([])).toEqual([]);
  });

  it("น้ำหนักรวมเป็นศูนย์หรือตัวเลขเสีย → throw (ไม่พิมพ์ราคาต่อหน่วยมั่ว)", () => {
    expect(() => groupLinesByMetal([{ metalName: "ทอง", weightG: "0", amount: "100" }])).toThrow();
    expect(() => groupLinesByMetal([{ metalName: "ทอง", weightG: "abc", amount: "100" }])).toThrow();
    expect(() => groupLinesByMetal([{ metalName: "ทอง", weightG: "1", amount: "Infinity" }])).toThrow();
  });
});
