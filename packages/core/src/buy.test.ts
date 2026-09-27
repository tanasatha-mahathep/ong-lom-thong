import { describe, expect, it } from "vitest";
import { BUY_MSG, quoteBuy, type QuoteBuyInput } from "./buy";

const GOLD = "11111111-1111-1111-1111-111111111111";

function base(over: Partial<QuoteBuyInput> = {}): QuoteBuyInput {
  return {
    lines: [{ metalId: GOLD, weightG: "5.860", amount: "20030" }],
    payments: [{ method: "cash", amount: "20030" }],
    customer: { id: "c1", cardStatus: "ok" },
    goldPriceSet: true,
    ...over,
  };
}

const messages = (r: ReturnType<typeof quoteBuy>) => r.errors.map((e) => e.message);

describe("quoteBuy — ใบจริง: 5.860 กรัม รับซื้อ 20,030 บาท", () => {
  it("ราคา/กรัม 3,418.09 · ยอด 20,030.00 · ชำระครบ → ok", () => {
    const r = quoteBuy(base());
    expect(r.ok).toBe(true);
    expect(r.lines[0]?.pricePerG).toBe("3418.09");
    expect(r.lines[0]?.weightG).toBe("5.860");
    expect(r.totalWeight).toBe("5.860");
    expect(r.totalAmount).toBe("20030.00");
    expect(r.paid).toBe("20030.00");
    expect(r.balance).toBe("0.00");
  });

  it("หลายแถวรวมถูก: 5.860 + 1.000 กรัม · 20,030 + 3,000 บาท", () => {
    const r = quoteBuy(
      base({
        lines: [
          { metalId: GOLD, weightG: "5.860", amount: "20030" },
          { metalId: GOLD, weightG: "1", amount: "3000.50" },
        ],
        payments: [{ method: "cash", amount: "23030.50" }],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.totalWeight).toBe("6.860");
    expect(r.totalAmount).toBe("23030.50");
  });

  it("ราคา/กรัม ปัดครึ่งขึ้น: 1 ÷ 8 = 0.125 → 0.13 (banker's จะให้ 0.12)", () => {
    const r = quoteBuy(
      base({ lines: [{ metalId: GOLD, weightG: "8", amount: "1" }], payments: [{ method: "cash", amount: "1" }] }),
    );
    expect(r.lines[0]?.pricePerG).toBe("0.13");
  });
});

describe("quoteBuy — กฎการชำระเงิน (R4, R5)", () => {
  it("ชำระไม่ครบ → ไม่ ok บอกยอดคงเหลือ", () => {
    const r = quoteBuy(base({ payments: [{ method: "cash", amount: "20000" }] }));
    expect(r.ok).toBe(false);
    expect(r.balance).toBe("30.00");
    expect(messages(r)).toContain(BUY_MSG.unbalanced("30.00"));
  });
  it("ชำระเกิน → overpaid", () => {
    const r = quoteBuy(base({ payments: [{ method: "cash", amount: "21000" }] }));
    expect(messages(r)).toContain(BUY_MSG.overpaid);
  });
  it("วิธีชำระซ้ำ (วิธี+ธนาคารเดิม) → ปฏิเสธ เหมือนระบบเดิม", () => {
    const r = quoteBuy(
      base({
        payments: [
          { method: "cash", amount: "10000" },
          { method: "cash", amount: "10030" },
        ],
      }),
    );
    expect(messages(r)).toContain(BUY_MSG.paymentDup);
  });
  it("วิธีเดียวกันแต่คนละธนาคาร → ไม่ซ้ำ", () => {
    const r = quoteBuy(
      base({
        payments: [
          { method: "transfer", bank: "KBANK", amount: "10000" },
          { method: "transfer", bank: "SCB", amount: "10030" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });
  it("จำนวนเงินว่าง/ศูนย์ → กรุณากรอกจำนวนเงิน", () => {
    const r = quoteBuy(base({ payments: [{ method: "cash", amount: "0" }] }));
    expect(messages(r)).toContain(BUY_MSG.paymentAmount);
  });
});

describe("quoteBuy — ลูกค้าและราคาทอง (R1, R2, R7)", () => {
  it("ไม่มีลูกค้า → บล็อก", () => {
    expect(messages(quoteBuy(base({ customer: null })))).toContain(BUY_MSG.noCustomer);
  });
  it("บัตรหมดอายุ → บล็อก (ระบบเดิม status 1)", () => {
    const r = quoteBuy(base({ customer: { id: "c1", cardStatus: "expired" } }));
    expect(r.ok).toBe(false);
    expect(messages(r)).toContain("บัตรประชาชนหมดอายุแล้ว");
  });
  it("ยังไม่ตั้งราคาทองวันนี้ → บล็อก", () => {
    expect(messages(quoteBuy(base({ goldPriceSet: false })))).toContain(BUY_MSG.noGoldPrice);
  });
});

describe("quoteBuy — ตรวจตัวเลขต่อแถว (R3)", () => {
  it("ไม่มีรายการ → noLines", () => {
    expect(messages(quoteBuy(base({ lines: [], payments: [] })))).toContain(BUY_MSG.noLines);
  });
  it.each([
    ["0", BUY_MSG.weightPositive],
    ["-1", BUY_MSG.weightPositive],
    ["1.2345", BUY_MSG.weightScale],
    ["abc", BUY_MSG.badNumber],
    ["", BUY_MSG.badNumber],
  ])("น้ำหนัก %j → %s", (w, msg) => {
    const r = quoteBuy(base({ lines: [{ metalId: GOLD, weightG: w, amount: "100" }] }));
    expect(messages(r)).toContain(msg);
    expect(r.lines).toHaveLength(0);
  });
  it.each([
    ["0", BUY_MSG.amountPositive],
    ["100.123", BUY_MSG.amountScale],
    ["x", BUY_MSG.badNumber],
  ])("ราคา %j → %s", (a, msg) => {
    const r = quoteBuy(base({ lines: [{ metalId: GOLD, weightG: "1", amount: a }] }));
    expect(messages(r)).toContain(msg);
  });
  it("แถวที่ผิดไม่ถูกนับรวมยอด แต่แถวที่ถูกยังนับ", () => {
    const r = quoteBuy(
      base({
        lines: [
          { metalId: GOLD, weightG: "1", amount: "100" },
          { metalId: GOLD, weightG: "0", amount: "999" },
        ],
        payments: [{ method: "cash", amount: "100" }],
      }),
    );
    expect(r.totalAmount).toBe("100.00");
    expect(r.ok).toBe(false);
  });
});
