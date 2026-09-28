import { describe, expect, it } from "vitest";
import {
  BUY_MSG,
  MAX_LINE_AMOUNT,
  MAX_LINE_WEIGHT_G,
  PAYMENT_METHODS,
  avgPricePerG,
  isPaymentMethod,
  quoteBuy,
  type QuoteBuyInput,
} from "./buy";

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
    ["-1", BUY_MSG.badNumber], // ไม่รับเครื่องหมาย
    ["1.2345", BUY_MSG.weightScale],
    ["abc", BUY_MSG.badNumber],
    ["", BUY_MSG.badNumber],
    ["0x10", BUY_MSG.badNumber],
    ["1e3", BUY_MSG.badNumber],
    ["5,86", BUY_MSG.weightComma], // คอมมาแทนจุดทศนิยม — ไม่เดา
    ["5,860", BUY_MSG.weightComma], // เคยถูกอ่านเป็น 5,860 กรัม (ราคา/กรัม 3.42)
    ["1,250.500", BUY_MSG.weightComma], // น้ำหนักไม่คั่นหลักพัน
  ])("น้ำหนัก %j → %s", (w, msg) => {
    const r = quoteBuy(base({ lines: [{ metalId: GOLD, weightG: w, amount: "100" }] }));
    expect(messages(r)).toContain(msg);
    expect(r.lines).toHaveLength(0);
  });
  it.each([
    ["0", BUY_MSG.amountPositive],
    ["100.123", BUY_MSG.amountScale],
    ["x", BUY_MSG.badNumber],
    ["20,03", BUY_MSG.badNumber],
    ["-20030", BUY_MSG.badNumber],
  ])("ราคา %j → %s", (a, msg) => {
    const r = quoteBuy(base({ lines: [{ metalId: GOLD, weightG: "1", amount: a }] }));
    expect(messages(r)).toContain(msg);
  });
  it("เงินคั่นหลักพันได้ (ราคา 20,030 · ชำระ 20,030) · น้ำหนักเป็นตัวเลขล้วน 1250.500", () => {
    const r = quoteBuy(
      base({
        lines: [{ metalId: GOLD, weightG: "1250.500", amount: "20,030" }],
        payments: [{ method: "cash", amount: "20,030" }],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.lines[0]).toMatchObject({ weightG: "1250.500", amount: "20030.00" });
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

describe("quoteBuy — index · ราคาเฉลี่ย/กรัม · แถวชำระที่บันทึก", () => {
  it("index = ตำแหน่งใน input แม้แถวก่อนหน้าผิดและถูกข้าม", () => {
    const r = quoteBuy(
      base({
        lines: [
          { metalId: GOLD, weightG: "0", amount: "999" },
          { metalId: GOLD, weightG: "5.86", amount: "20030" },
        ],
      }),
    );
    expect(r.lines).toEqual([{ index: 1, metalId: GOLD, weightG: "5.860", amount: "20030.00", pricePerG: "3418.09" }]);
    expect(r.errors.map((e) => e.field)).toEqual(["lines.0.weight_g"]);
  });

  it("ราคาเฉลี่ย/กรัม = ยอดรวม ÷ น้ำหนักรวม ปัดครึ่งขึ้น 2 ตำแหน่ง (ระบบเดิม sum_price)", () => {
    const r = quoteBuy(
      base({
        lines: [
          { metalId: GOLD, weightG: "5.860", amount: "20030" },
          { metalId: GOLD, weightG: "100", amount: "1500" },
        ],
        payments: [{ method: "cash", amount: "21530" }],
      }),
    );
    // 21,530 ÷ 105.86 = 203.3818…
    expect(r.avgPricePerG).toBe("203.38");
    expect(quoteBuy(base()).avgPricePerG).toBe("3418.09");
  });

  it("ไม่มีแถวที่ถูกต้อง → ราคาเฉลี่ย 0.00 (ไม่หารด้วยศูนย์)", () => {
    expect(quoteBuy(base({ lines: [], payments: [] })).avgPricePerG).toBe("0.00");
  });

  it("avgPricePerG ใช้ซ้ำกับบิลที่บันทึกแล้วได้ — ค่าเดียวกับตอน quote", () => {
    expect(avgPricePerG("21530.00", "105.860")).toBe("203.38");
    expect(avgPricePerG("1", "8")).toBe("0.13"); // 0.125 → ปัดครึ่งขึ้น
    expect(avgPricePerG("100", "0")).toBe("0.00");
  });

  it("แถวชำระที่ถูกต้องออกมาในรูปมาตรฐาน — ตัดคอมมา · ธนาคารว่าง = null", () => {
    const r = quoteBuy(
      base({
        payments: [
          { method: "cash", bank: "  ", amount: "20,000" },
          { method: "transfer", bank: " KBANK ", amount: "30" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.payments).toEqual([
      { index: 0, method: "cash", bank: null, amount: "20000.00" },
      { index: 1, method: "transfer", bank: "KBANK", amount: "30.00" },
    ]);
  });

  it("payments: index = ตำแหน่งใน input แม้แถวก่อนหน้าผิดและถูกข้าม (เหมือน lines)", () => {
    const r = quoteBuy(
      base({
        payments: [
          { method: "cheque", amount: "999" }, // วิธีไม่รู้จัก — ถูกข้าม
          { method: "cash", amount: "20030" },
        ],
      }),
    );
    expect(r.payments).toEqual([{ index: 1, method: "cash", bank: null, amount: "20030.00" }]);
    expect(r.errors.map((e) => e.field)).toEqual(["payments.0.method"]);
  });
});

describe("quoteBuy — วิธีชำระ", () => {
  it.each([
    [{ method: "transfer", amount: "20030" }, BUY_MSG.bankRequired],
    [{ method: "transfer", bank: "   ", amount: "20030" }, BUY_MSG.bankRequired],
    [{ method: "cash", bank: "KBANK", amount: "20030" }, BUY_MSG.cashNoBank],
  ])("ธนาคารไม่เข้ากับวิธี %j → %s · ไม่นับยอด", (p, message) => {
    const r = quoteBuy(base({ payments: [p] }));
    expect(r.errors[0]).toEqual({ field: "payments.0.bank", message });
    expect(r.paid).toBe("0.00");
    expect(r.ok).toBe(false);
  });
  it("โอนระบุธนาคาร · เงินสดไม่ระบุ → ผ่าน", () => {
    const r = quoteBuy(
      base({
        payments: [
          { method: "transfer", bank: "SCB", amount: "20000" },
          { method: "cash", bank: null, amount: "30" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });
  it("วิธีที่ไม่รู้จัก → กรุณาเลือกประเภทเงินที่ชำระ (ข้อความระบบเดิม) ไม่นับยอด", () => {
    const r = quoteBuy(base({ payments: [{ method: "cheque", amount: "20030" }] }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual({ field: "payments.0.method", message: BUY_MSG.paymentMethod });
    expect(r.paid).toBe("0.00");
    expect(r.payments).toEqual([]);
  });
  it("ไม่เลือกวิธี + ไม่กรอกเงิน → แจ้งทั้งสองช่อง", () => {
    const r = quoteBuy(base({ payments: [{ method: "", amount: "" }] }));
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(["payments.0.method", "payments.0.amount"]));
  });
  it("PAYMENT_METHODS: เงินสด · โอนเงิน", () => {
    expect(PAYMENT_METHODS).toEqual({ cash: "เงินสด", transfer: "โอนเงิน" });
    expect(isPaymentMethod("cash")).toBe(true);
    expect(isPaymentMethod("toString")).toBe(false); // ไม่หลุดไปเจอ prototype
  });
});

describe("quoteBuy — เพดานต่อแถว (กันเลขหลุดช่อง ไม่ให้ล้น numeric)", () => {
  it("เลขบัตร 13 หลักหลุดลงช่องน้ำหนัก/ราคา → ปฏิเสธ ไม่ใช่ 500 ตอนบันทึก", () => {
    const r = quoteBuy(base({ lines: [{ metalId: GOLD, weightG: "1103700123458", amount: "1103700123458" }] }));
    expect(r.errors).toEqual(
      expect.arrayContaining([
        { field: "lines.0.weight_g", message: BUY_MSG.weightMax },
        { field: "lines.0.amount", message: BUY_MSG.amountMax },
      ]),
    );
    expect(r.lines).toHaveLength(0);
  });
  it("เท่ากับเพดานพอดี → ผ่าน", () => {
    const r = quoteBuy(
      base({
        lines: [{ metalId: GOLD, weightG: MAX_LINE_WEIGHT_G, amount: MAX_LINE_AMOUNT }],
        payments: [{ method: "cash", amount: MAX_LINE_AMOUNT }],
      }),
    );
    expect(r.ok).toBe(true);
  });
});
