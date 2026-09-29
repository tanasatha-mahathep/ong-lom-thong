import { describe, expect, it } from "vitest";
import { avgPricePerG, pricePerGram, quoteBuy } from "./buy";
import { ReceiptDataError } from "./errors";
import { D, fmtMoney } from "./money";
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

  it("น้ำหนักรวมเป็นศูนย์หรือตัวเลขเสีย → ReceiptDataError (ไม่พิมพ์ราคาต่อหน่วยมั่ว)", () => {
    for (const bad of [
      { metalName: "ทอง", weightG: "0", amount: "100" },
      { metalName: "ทอง", weightG: "abc", amount: "100" },
      { metalName: "ทอง", weightG: "1", amount: "Infinity" },
      { metalName: "ทอง", weightG: "", amount: "100" },
    ]) {
      expect(() => groupLinesByMetal([bad])).toThrow(ReceiptDataError);
    }
  });
});

describe("ราคา/กรัม สูตรเดียว (CLAUDE.md กฎ 2) — ทุกทางให้ค่าเดียวกัน", () => {
  // [ราคา, น้ำหนัก, ที่ควรได้] — มีจุดปัดครึ่งขึ้นที่ float ปัดผิด (10.05 ÷ 2 · 1 ÷ 8)
  it.each([
    ["20030.00", "5.860", "3418.09"],
    ["10.05", "2.000", "5.03"],
    ["1", "8", "0.13"],
    ["21530.00", "105.860", "203.38"],
    ["3015.00", "101.000", "29.85"],
    ["0.01", "3.000", "0.00"],
    ["99999999.99", "0.001", "99999999990.00"],
  ])("%s ÷ %s = %s: pricePerGram · quoteBuy (แถว/เฉลี่ย) · avgPricePerG · ใบรับซื้อ", (amount, weight, want) => {
    const q = quoteBuy({
      lines: [{ metalId: "gold", weightG: weight, amount }],
      payments: [],
      customer: null,
      goldPriceSet: true,
    });
    expect(fmtMoney(pricePerGram(D(amount), D(weight)))).toBe(want);
    expect(q.lines[0]?.pricePerG).toBe(want);
    expect(q.avgPricePerG).toBe(want);
    expect(avgPricePerG(amount, weight)).toBe(want);
    expect(groupLinesByMetal([{ metalName: "ทอง", weightG: weight, amount }])[0]?.unitPrice).toBe(want);
  });

  it("หลายแถวโลหะเดียว: ราคาเฉลี่ยบนจอ = ราคาต่อหน่วยบนใบรับซื้อ", () => {
    const lines = [
      { weightG: "2.000", amount: "8000" },
      { weightG: "1.860", amount: "6000" },
      { weightG: "2.000", amount: "6030" },
    ];
    const q = quoteBuy({
      lines: lines.map((l) => ({ metalId: "gold", ...l })),
      payments: [],
      customer: null,
      goldPriceSet: true,
    });
    const printed = groupLinesByMetal(lines.map((l) => ({ metalName: "ทอง", ...l })));
    expect(q.avgPricePerG).toBe("3418.09");
    expect(printed[0]?.unitPrice).toBe(q.avgPricePerG);
  });

  it("น้ำหนักรวม 0: จอแสดง 0.00 (avgPricePerG) · ใบรับซื้อไม่พิมพ์ราคามั่ว (throw)", () => {
    expect(avgPricePerG("100", "0")).toBe("0.00");
    expect(() => groupLinesByMetal([{ metalName: "ทอง", weightG: "0", amount: "100" }])).toThrow(ReceiptDataError);
  });
});

// ── ด่าน coverage: ค่าขอบราคาต่อหน่วย · น้ำหนักรวมรอบศูนย์ · โลหะเดียวเสียทั้งใบ · ข้อความ error ตรงตัว ───────────────
const expectReceiptDataError = (run: () => unknown, message: string) => {
  expect(run).toThrow(ReceiptDataError);
  expect(run).toThrow(new ReceiptDataError(message));
};

describe("groupLinesByMetal — ราคาต่อหน่วย HALF_UP 2 ที่หลักที่ถูกตัด …4/…5/…6 (BVA)", () => {
  it.each([
    ["12.44", "1.24"], // 12.44 ÷ 10 = 1.244 → ลง
    ["12.45", "1.25"], // 1.245 เสมอ → ขึ้น (HALF_EVEN ได้ 1.24)
    ["12.46", "1.25"], // 1.246 → ขึ้น
  ])("ทอง 10.000 ก. %s บาท → ราคาต่อหน่วย %s", (amount, unitPrice) => {
    expect(groupLinesByMetal([{ metalName: "ทอง", weightG: "10.000", amount }])).toStrictEqual([
      { metalName: "ทอง", weightG: "10.000", unitPrice, amount },
    ]);
  });
});

describe("groupLinesByMetal — น้ำหนักรวมต่อโลหะต้องมากกว่า 0 (BVA −0.001 | 0 | 0.001) · fail-closed ทั้งใบ", () => {
  it("น้ำหนักรวมเล็กสุดที่รับ 0.001 ก. → พิมพ์ได้: 1 บาท ÷ 0.001 = 1,000.00 ต่อกรัม", () => {
    expect(groupLinesByMetal([{ metalName: "ทอง", weightG: "0.001", amount: "1" }])).toStrictEqual([
      { metalName: "ทอง", weightG: "0.001", unitPrice: "1000.00", amount: "1.00" },
    ]);
  });

  it.each([
    ["0", "บนขอบพอดี"],
    ["0.000", "ศูนย์แบบที่ DB ส่ง"],
    ["-0.001", "ต่ำกว่าศูนย์ 1 ขั้น"],
  ])("น้ำหนักรวม %s (%s) → ReceiptDataError ข้อความตรงตัว", (weightG) => {
    expectReceiptDataError(
      () => groupLinesByMetal([{ metalName: "ทอง", weightG, amount: "100" }]),
      "น้ำหนักรวมของทองต้องมากกว่า 0",
    );
  });

  it("โลหะหนึ่งเสีย ทั้งใบพิมพ์ไม่ได้ — ไม่ออกใบที่ขาดบรรทัด", () => {
    const lines = [
      { metalName: "ทอง", weightG: "5.860", amount: "20030" },
      { metalName: "เงิน", weightG: "0", amount: "10" },
    ];
    expectReceiptDataError(() => groupLinesByMetal(lines), "น้ำหนักรวมของเงินต้องมากกว่า 0");
  });

  it.each([
    [{ weightG: "abc", amount: "100" }, 'น้ำหนักไม่ใช่ตัวเลข: "abc"'],
    [{ weightG: "1", amount: "" }, 'ราคาไม่ใช่ตัวเลข: ""'],
    [{ weightG: "1", amount: "Infinity" }, 'ราคาไม่ใช่ตัวเลข: "Infinity"'],
  ])("%j → ReceiptDataError บอกช่องที่เสีย", (row, message) => {
    expectReceiptDataError(() => groupLinesByMetal([{ metalName: "ทอง", ...row }]), message);
  });
});
