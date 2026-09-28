import { describe, expect, it } from "vitest";
import {
  BUY_MSG,
  quoteBuy,
  type BuyLineInput,
  type PaymentInput,
  type QuoteBuyInput,
  type QuoteBuyResult,
  type QuoteError,
} from "./buy";
import type { CardStatus } from "./card";

// ออกแบบตาม ISO/IEC/IEEE 29119-4: ตารางตัดสินใจ (ด่านก่อนเปิดบิล · ช่องต่อแถว · วิธีชำระซ้ำ) · แบ่งกลุ่มสมมูล +
// ค่าขอบ (น้ำหนัก · ราคา · ยอดชำระ · ยอดคงเหลือ · หลักที่ถูกปัด …4/…5/…6) · เดาข้อผิดพลาด (ว่าง · เว้นวรรค · ตัวอักษร ·
// เลขไทย · NaN/Infinity · กับดัก float) — ค่าคาดหวังทุกตัวคิดมือจากสเปก R1–R7 · §8 หรือใบจริง ไม่ได้คัดจากผลรันโค้ด

const GOLD = "11111111-1111-1111-1111-111111111111";
const SILVER = "22222222-2222-2222-2222-222222222222";

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

const line = (weightG: string, amount: string, metalId = GOLD): BuyLineInput => ({ metalId, weightG, amount });
const cash = (amount: string): PaymentInput => ({ method: "cash", amount });
const transfer = (bank: string, amount: string): PaymentInput => ({ method: "transfer", bank, amount });
const card = (cardStatus: CardStatus) => ({ id: "c1", cardStatus });
const err = (field: string, message: string): QuoteError => ({ field, message });

// แถวใบจริงหลังคำนวณ: 20,030 ÷ 5.860 = 3,418.0887… → HALF_UP 2 → 3,418.09
const REAL_LINE = { metalId: GOLD, weightG: "5.860", amount: "20030.00", pricePerG: "3418.09" };
// ผลของ base(): บิลใบจริงชำระเงินสดครบ
const REAL_OK: QuoteBuyResult = {
  ok: true,
  errors: [],
  lines: [REAL_LINE],
  totalWeight: "5.860",
  totalAmount: "20030.00",
  paid: "20030.00",
  balance: "0.00",
};
// ไม่มีแถวที่ใช้ได้และไม่มีการชำระ — ตัวเลขทุกช่องยังออกสเกลคงที่ (น้ำหนัก 3 · เงิน 2)
const NOTHING_COUNTED = { lines: [], totalWeight: "0.000", totalAmount: "0.00", paid: "0.00", balance: "0.00" };

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
    // ทั้งก้อน: ไม่มีฟิลด์เกิน/ขาด · amount ของแถวคือราคาที่พิมพ์ ไม่ได้คูณกลับจากราคา/กรัม
    expect(r).toStrictEqual(REAL_OK);
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
    // 3,000.50 ÷ 1 = 3,000.50 · ชำระ 23,030.50 พอดี
    expect(r.lines).toStrictEqual([
      REAL_LINE,
      { metalId: GOLD, weightG: "1.000", amount: "3000.50", pricePerG: "3000.50" },
    ]);
    expect(r.paid).toBe("23030.50");
    expect(r.balance).toBe("0.00");
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
    // 20,030 − 20,000 = 30.00 · เป็นข้อผิดข้อเดียวของบิลนี้
    expect(r.errors).toStrictEqual([err("payments", BUY_MSG.unbalanced("30.00"))]);
    expect(r.paid).toBe("20000.00");
  });
  it("ชำระเกิน → overpaid", () => {
    const r = quoteBuy(base({ payments: [{ method: "cash", amount: "21000" }] }));
    expect(messages(r)).toContain(BUY_MSG.overpaid);
    // 20,030 − 21,000 = −970.00 · เกินยอดแล้วไม่ขึ้น "ยอดไม่ตรง" ซ้ำอีกข้อ
    expect(r.errors).toStrictEqual([err("payments", BUY_MSG.overpaid)]);
    expect(r.ok).toBe(false);
    expect(r.balance).toBe("-970.00");
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
    // แถวที่ซ้ำไม่ถูกนับ: ชำระ 10,000 → คงเหลือ 20,030 − 10,000 = 10,030.00
    expect(r.errors).toStrictEqual([
      err("payments.1.method", BUY_MSG.paymentDup),
      err("payments", BUY_MSG.unbalanced("10030.00")),
    ]);
    expect(r.paid).toBe("10000.00");
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
    expect(r.errors).toStrictEqual([]);
    expect(r.paid).toBe("20030.00");
  });
  it("จำนวนเงินว่าง/ศูนย์ → กรุณากรอกจำนวนเงิน", () => {
    const r = quoteBuy(base({ payments: [{ method: "cash", amount: "0" }] }));
    expect(messages(r)).toContain(BUY_MSG.paymentAmount);
    // แถวที่ผิดไม่ถูกนับ → ยังค้าง 20,030.00 ทั้งบิล
    expect(r.errors).toStrictEqual([
      err("payments.0.amount", BUY_MSG.paymentAmount),
      err("payments", BUY_MSG.unbalanced("20030.00")),
    ]);
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
    expect(r.errors).toContainEqual(err("lines.0.weight_g", msg));
  });
  it.each([
    ["0", BUY_MSG.amountPositive],
    ["100.123", BUY_MSG.amountScale],
    ["x", BUY_MSG.badNumber],
  ])("ราคา %j → %s", (a, msg) => {
    const r = quoteBuy(base({ lines: [{ metalId: GOLD, weightG: "1", amount: a }] }));
    expect(messages(r)).toContain(msg);
    expect(r.errors).toContainEqual(err("lines.0.amount", msg));
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
    // ยอดบิล 100 (ไม่รวม 999 ของแถวที่ผิด) = ชำระ 100 → เหลือข้อผิดของแถว 1 ข้อเดียว
    expect(r.errors).toStrictEqual([err("lines.1.weight_g", BUY_MSG.weightPositive)]);
    expect(r.totalWeight).toBe("1.000");
    expect(r.balance).toBe("0.00");
  });
});

// ── ตารางตัดสินใจ: ด่านก่อนเปิดบิล ─────────────────────────────────────────────────────────────────────
// ข้อความสถานะบัตรพิมพ์ตรงตัว (ไม่อ้าง CARD_STATUS_MESSAGE) ให้ oracle อิสระจากโค้ด — ระบบเดิม status 1/2/3 (R2)
const NO_GOLD = err("gold_price", BUY_MSG.noGoldPrice);
const NO_CUSTOMER = err("customer_id", BUY_MSG.noCustomer);
const CARD_EXPIRED = err("customer_id", "บัตรประชาชนหมดอายุแล้ว");
const CARD_MISSING = err("customer_id", "ยังไม่ได้กรอกวันที่บัตรหมดอายุ");
const CARD_INVALID = err("customer_id", "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง");

const OMIT = "ไม่ส่งฟิลด์";
type CustomerArg = QuoteBuyInput["customer"] | typeof OMIT;

function withCustomer(goldPriceSet: boolean, customer: CustomerArg): QuoteBuyInput {
  const { customer: _dropped, ...rest } = base({ goldPriceSet });
  return customer === OMIT ? rest : { ...rest, customer };
}

// 2 (ราคาทอง) × 7 (ลูกค้า: ไม่มี 3 แบบ + สถานะบัตร 4 ค่า) = 14 กฎ · ลำดับข้อผิดตามหน้า /buy §3.1: หัวบิล/ราคาทอง → ลูกค้า
const PRECONDITIONS: { goldPriceSet: boolean; label: string; customer: CustomerArg; errors: QuoteError[] }[] = [
  { goldPriceSet: true, label: "ไม่ส่งฟิลด์ customer", customer: OMIT, errors: [NO_CUSTOMER] },
  { goldPriceSet: true, label: "customer: undefined", customer: undefined, errors: [NO_CUSTOMER] },
  { goldPriceSet: true, label: "customer: null", customer: null, errors: [NO_CUSTOMER] },
  { goldPriceSet: true, label: "บัตร ok", customer: card("ok"), errors: [] },
  { goldPriceSet: true, label: "บัตรหมดอายุ (status 1)", customer: card("expired"), errors: [CARD_EXPIRED] },
  { goldPriceSet: true, label: "ไม่มีวันหมดอายุ (status 2)", customer: card("missing"), errors: [CARD_MISSING] },
  { goldPriceSet: true, label: "วันที่ผิดรูป (status 3)", customer: card("invalid"), errors: [CARD_INVALID] },
  { goldPriceSet: false, label: "ไม่ส่งฟิลด์ customer", customer: OMIT, errors: [NO_GOLD, NO_CUSTOMER] },
  { goldPriceSet: false, label: "customer: undefined", customer: undefined, errors: [NO_GOLD, NO_CUSTOMER] },
  { goldPriceSet: false, label: "customer: null", customer: null, errors: [NO_GOLD, NO_CUSTOMER] },
  { goldPriceSet: false, label: "บัตร ok", customer: card("ok"), errors: [NO_GOLD] },
  { goldPriceSet: false, label: "บัตรหมดอายุ (status 1)", customer: card("expired"), errors: [NO_GOLD, CARD_EXPIRED] },
  {
    goldPriceSet: false,
    label: "ไม่มีวันหมดอายุ (status 2)",
    customer: card("missing"),
    errors: [NO_GOLD, CARD_MISSING],
  },
  { goldPriceSet: false, label: "วันที่ผิดรูป (status 3)", customer: card("invalid"), errors: [NO_GOLD, CARD_INVALID] },
];

describe("quoteBuy — ตารางตัดสินใจ: ราคาทองวันนี้ × ลูกค้า/สถานะบัตร (R1 · R2 · R7)", () => {
  it.each(PRECONDITIONS)("ตั้งราคาทองแล้ว=$goldPriceSet · $label", ({ goldPriceSet, customer, errors }) => {
    const input = withCustomer(goldPriceSet, customer);
    // กลุ่ม "ไม่ส่งฟิลด์" ต้องไม่มี key จริง ๆ ไม่ใช่ key ที่เป็น undefined
    expect(Object.hasOwn(input, "customer")).toBe(customer !== OMIT);
    // ด่านนี้บล็อกการบันทึกเท่านั้น — ยอดของบิลยังคำนวณให้เห็นบนจอครบเหมือนบิลปกติ
    expect(quoteBuy(input)).toStrictEqual({ ...REAL_OK, ok: errors.length === 0, errors });
  });

  it("R7 ใช้ข้อความเดียวกับ Django ที่พนักงานคุ้น", () => {
    expect(BUY_MSG.noGoldPrice).toBe("ยังไม่ได้ตั้งราคาทองของวันนี้");
  });
});

describe("quoteBuy — น้ำหนักต่อแถว (R3: > 0 · ทศนิยมไม่เกิน 3): กลุ่มสมมูล + ค่าขอบ", () => {
  // ไม่มีการชำระ → ข้อผิดที่เหลือมีแค่ช่องที่ทดสอบ · แถวที่ผิดไม่ถูกนับ ยอดทุกช่องจึงเป็นศูนย์
  it.each([
    ["0", BUY_MSG.weightPositive], // บนขอบล่างพอดี (ต้องมากกว่า 0)
    ["0.000", BUY_MSG.weightPositive], // ศูนย์ที่พิมพ์ทศนิยมครบ 3 ตำแหน่ง
    ["-0", BUY_MSG.weightPositive], // ลบศูนย์
    ["-0.001", BUY_MSG.weightPositive], // ต่ำกว่าขอบล่าง 1 หน่วยที่เล็กที่สุด (0.001 กรัม)
    ["-0.0001", BUY_MSG.weightPositive], // ติดลบและทศนิยมเกิน → บอกข้อแรกที่ผิดข้อเดียว (ค่าบวกก่อนสเกล)
    ["0.0001", BUY_MSG.weightScale], // มากกว่า 0 แต่ 4 ตำแหน่ง → ผิดที่สเกล ไม่ใช่ "ต้องมากกว่า 0"
    ["1.2345", BUY_MSG.weightScale], // เกินขอบบนของสเกล 1 ตำแหน่ง
    ["", BUY_MSG.badNumber],
    ["   ", BUY_MSG.badNumber],
    ["abc", BUY_MSG.badNumber],
    ["5.86g", BUY_MSG.badNumber],
    ["5.8.6", BUY_MSG.badNumber],
    ["๕.๘๖๐", BUY_MSG.badNumber], // เลขไทย
    ["NaN", BUY_MSG.badNumber],
    ["Infinity", BUY_MSG.badNumber],
  ])("น้ำหนัก %j → %s ที่ lines.0.weight_g ข้อเดียว และไม่นับรวมยอด", (w, msg) => {
    expect(quoteBuy(base({ lines: [line(w, "100")], payments: [] }))).toStrictEqual({
      ok: false,
      errors: [err("lines.0.weight_g", msg)],
      ...NOTHING_COUNTED,
    });
  });

  it.each([
    // [ที่พิมพ์, weightG ที่ได้, ราคา/กรัม = 100 ÷ น้ำหนัก HALF_UP 2]
    ["0.001", "0.001", "100000.00"], // ขอบล่างที่ใช้ได้: 100 ÷ 0.001 = 100,000
    ["1.234", "1.234", "81.04"], // ขอบบนของสเกล: 100 ÷ 1.234 = 81.0372… → 81.04
    ["5.8600", "5.860", "17.06"], // สเกลตรวจที่ค่า ศูนย์ท้ายไม่นับ: 100 ÷ 5.86 = 17.0648… → 17.06
    [" 5.860 ", "5.860", "17.06"], // เว้นวรรคหัวท้ายถูกตัดทิ้ง
  ])("น้ำหนัก %j → ใช้ได้ เป็น %s · ราคา/กรัม %s", (typed, weightG, pricePerG) => {
    expect(quoteBuy(base({ lines: [line(typed, "100")], payments: [cash("100")] }))).toStrictEqual({
      ok: true,
      errors: [],
      lines: [{ metalId: GOLD, weightG, amount: "100.00", pricePerG }],
      totalWeight: weightG,
      totalAmount: "100.00",
      paid: "100.00",
      balance: "0.00",
    });
  });
});

describe("quoteBuy — ราคาต่อแถว (R3: > 0 · ทศนิยมไม่เกิน 2): กลุ่มสมมูล + ค่าขอบ", () => {
  it.each([
    ["0", BUY_MSG.amountPositive], // บนขอบล่างพอดี
    ["0.00", BUY_MSG.amountPositive],
    ["-0.01", BUY_MSG.amountPositive], // ต่ำกว่าขอบล่าง 1 สตางค์
    ["-0.001", BUY_MSG.amountPositive], // ติดลบและทศนิยมเกิน → บอกข้อแรกที่ผิดข้อเดียว
    ["0.001", BUY_MSG.amountScale], // มากกว่า 0 แต่ 3 ตำแหน่ง
    ["100.123", BUY_MSG.amountScale], // เกินขอบบนของสเกล 1 ตำแหน่ง
    ["", BUY_MSG.badNumber],
    ["  ", BUY_MSG.badNumber],
    ["x", BUY_MSG.badNumber],
    ["1 000", BUY_MSG.badNumber], // เว้นวรรคแทนคอมมาหลักพัน
    ["๑๐๐", BUY_MSG.badNumber], // เลขไทย
  ])("ราคา %j → %s ที่ lines.0.amount ข้อเดียว และไม่นับรวมยอด", (a, msg) => {
    expect(quoteBuy(base({ lines: [line("1", a)], payments: [] }))).toStrictEqual({
      ok: false,
      errors: [err("lines.0.amount", msg)],
      ...NOTHING_COUNTED,
    });
  });

  it.each([
    // [ที่พิมพ์, amount ที่ได้] · น้ำหนัก 1 กรัม → ราคา/กรัม = ราคา · ชำระเท่ายอด
    ["0.01", "0.01"], // ขอบล่างที่ใช้ได้ (1 สตางค์)
    ["100.12", "100.12"], // ขอบบนของสเกล
    ["100.120", "100.12"], // สเกลตรวจที่ค่า ศูนย์ท้ายไม่นับ
    ["20,030", "20030.00"], // คอมมาหลักพันแบบที่ร้านพิมพ์ (ระบบเดิม currencyFormat3 ถอดคอมมา)
    ["20,030.50", "20030.50"],
  ])("ราคา %j → ใช้ได้ เป็น %s", (typed, amount) => {
    expect(quoteBuy(base({ lines: [line("1", typed)], payments: [cash(amount)] }))).toStrictEqual({
      ok: true,
      errors: [],
      lines: [{ metalId: GOLD, weightG: "1.000", amount, pricePerG: amount }],
      totalWeight: "1.000",
      totalAmount: amount,
      paid: amount,
      balance: "0.00",
    });
  });
});

describe("quoteBuy — ช่องต่อแถว: ตารางตัดสินใจ · ดัชนีแถว · โลหะ (R3)", () => {
  // น้ำหนักใช้ได้? × ราคาใช้ได้? → ข้อผิดของแถว + แถวนับรวมยอดไหม · ชำระ 100 ทุกกฎ:
  // แถวที่ไม่ถูกนับทำให้ยอดบิล 0.00 → ชำระ 100 กลายเป็นเกินยอด คงเหลือ −100.00
  const LINE_RULES: { label: string; w: string; a: string; errors: QuoteError[]; totals: string[] }[] = [
    { label: "ใช้ได้ทั้งสองช่อง → นับ", w: "1", a: "100", errors: [], totals: ["1.000", "100.00", "0.00"] },
    {
      label: "น้ำหนักผิด → ไม่นับ",
      w: "0",
      a: "100",
      errors: [err("lines.0.weight_g", BUY_MSG.weightPositive), err("payments", BUY_MSG.overpaid)],
      totals: ["0.000", "0.00", "-100.00"],
    },
    {
      label: "ราคาผิด → ไม่นับ",
      w: "1",
      a: "x",
      errors: [err("lines.0.amount", BUY_MSG.badNumber), err("payments", BUY_MSG.overpaid)],
      totals: ["0.000", "0.00", "-100.00"],
    },
    {
      label: "ผิดทั้งสองช่อง → ครบสองข้อ ไม่นับ", // น้ำหนักก่อนราคา
      w: "0",
      a: "x",
      errors: [
        err("lines.0.weight_g", BUY_MSG.weightPositive),
        err("lines.0.amount", BUY_MSG.badNumber),
        err("payments", BUY_MSG.overpaid),
      ],
      totals: ["0.000", "0.00", "-100.00"],
    },
  ];
  it.each(LINE_RULES)("$label", ({ w, a, errors, totals }) => {
    const r = quoteBuy(base({ lines: [line(w, a)], payments: [cash("100")] }));
    expect(r.errors).toStrictEqual(errors);
    expect(r.ok).toBe(errors.length === 0);
    expect([r.totalWeight, r.totalAmount, r.balance]).toStrictEqual(totals);
    expect(r.paid).toBe("100.00");
  });

  it("แถวที่สองผิด → ข้อผิดชี้ lines.1.* · แถวแรกยังนับ", () => {
    expect(
      quoteBuy(base({ lines: [line("1", "100"), line("1.2345", "100.123")], payments: [cash("100")] })),
    ).toStrictEqual({
      ok: false,
      errors: [err("lines.1.weight_g", BUY_MSG.weightScale), err("lines.1.amount", BUY_MSG.amountScale)],
      lines: [{ metalId: GOLD, weightG: "1.000", amount: "100.00", pricePerG: "100.00" }],
      totalWeight: "1.000",
      totalAmount: "100.00",
      paid: "100.00",
      balance: "0.00",
    });
  });

  it("แถวแรกผิด แถวที่สองถูก → ข้อผิดชี้ lines.0.* · ยอดมาจากแถวที่สองเท่านั้น", () => {
    const r = quoteBuy(base({ lines: [line("", "100"), line("2", "50")], payments: [cash("50")] }));
    expect(r.errors).toStrictEqual([err("lines.0.weight_g", BUY_MSG.badNumber)]);
    expect([r.totalWeight, r.totalAmount, r.paid, r.balance]).toStrictEqual(["2.000", "50.00", "50.00", "0.00"]);
  });

  it("metalId ส่งผ่านตรงตัว และแถวเรียงตามลำดับที่กรอก", () => {
    expect(
      quoteBuy(base({ lines: [line("1", "100", GOLD), line("2", "300", SILVER)], payments: [cash("400")] })),
    ).toStrictEqual({
      ok: true,
      errors: [],
      lines: [
        { metalId: GOLD, weightG: "1.000", amount: "100.00", pricePerG: "100.00" },
        { metalId: SILVER, weightG: "2.000", amount: "300.00", pricePerG: "150.00" }, // 300 ÷ 2
      ],
      totalWeight: "3.000",
      totalAmount: "400.00",
      paid: "400.00",
      balance: "0.00",
    });
  });
});

describe("quoteBuy — ราคา/กรัม = ราคา ÷ น้ำหนัก HALF_UP 2 ตำแหน่ง ใช้แสดงเท่านั้น (R3 · §8)", () => {
  // ค่าขอบของการปัด: หลักที่ถูกตัด …4/…5/…6 สองช่วง
  // …4 แยก HALF_UP ออกจาก CEIL/UP · …5 แยกออกจาก HALF_EVEN/HALF_DOWN/FLOOR · …6 แยกออกจาก FLOOR/DOWN
  it.each([
    // [ราคา, น้ำหนัก, ผลหารจริง, ที่ต้องได้]
    ["12.44", "10", "1.244", "1.24"],
    ["12.45", "10", "1.245", "1.25"], // HALF_EVEN → 1.24 · float: 12.45 / 10 = 1.2449999… → toFixed(2) = 1.24
    ["12.46", "10", "1.246", "1.25"],
    ["0.04", "10", "0.004", "0.00"], // ปัดเหลือ 0.00 ได้ — ใช้แสดงเท่านั้น แถวยังใช้ได้
    ["0.05", "10", "0.005", "0.01"], // HALF_EVEN/FLOOR → 0.00
    ["0.06", "10", "0.006", "0.01"],
    ["1", "3", "0.333…", "0.33"], // ผลหารไม่รู้จบ
    ["2", "3", "0.666…", "0.67"],
  ])("%s บาท ÷ %s กรัม = %s → %s", (amount, weightG, _exact, pricePerG) => {
    const r = quoteBuy(base({ lines: [line(weightG, amount)], payments: [cash(amount)] }));
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.pricePerG)).toStrictEqual([pricePerG]);
  });

  it("ยอดบิลคือผลรวมราคาที่พิมพ์ ไม่ได้คูณกลับจากราคา/กรัม: 1 บาท ÷ 3 กรัม แสดง 0.33 แต่ยอดยัง 1.00 (คูณกลับได้ 0.99)", () => {
    expect(quoteBuy(base({ lines: [line("3", "1")], payments: [cash("1")] }))).toStrictEqual({
      ok: true,
      errors: [],
      lines: [{ metalId: GOLD, weightG: "3.000", amount: "1.00", pricePerG: "0.33" }],
      totalWeight: "3.000",
      totalAmount: "1.00",
      paid: "1.00",
      balance: "0.00",
    });
  });
});

describe("quoteBuy — ยอดรวมเป็นผลบวกทศนิยมตรงตัว ไม่มีเศษ float (R4 ต้องเท่ากันพอดี)", () => {
  it("น้ำหนัก 0.1 + 0.2 = 0.300 · ราคา 0.10 + 0.20 = 0.30 ชำระ 0.30 → พอดี (float: 0.1 + 0.2 = 0.30000000000000004)", () => {
    expect(
      quoteBuy(base({ lines: [line("0.1", "0.10"), line("0.2", "0.20")], payments: [cash("0.30")] })),
    ).toStrictEqual({
      ok: true,
      errors: [],
      lines: [
        { metalId: GOLD, weightG: "0.100", amount: "0.10", pricePerG: "1.00" },
        { metalId: GOLD, weightG: "0.200", amount: "0.20", pricePerG: "1.00" },
      ],
      totalWeight: "0.300",
      totalAmount: "0.30",
      paid: "0.30",
      balance: "0.00",
    });
  });

  it("บิล 0.30 ชำระแยก 0.10 + 0.20 → พอดี ไม่ใช่เกินยอด (float: 0.30000000000000004 > 0.3)", () => {
    const r = quoteBuy(base({ lines: [line("0.1", "0.30")], payments: [cash("0.10"), transfer("KBANK", "0.20")] }));
    expect(r.errors).toStrictEqual([]);
    expect([r.totalAmount, r.paid, r.balance]).toStrictEqual(["0.30", "0.30", "0.00"]);
  });

  it("สิบแถว แถวละ 0.10 = 1.00 ชำระ 1.00 → พอดี (float: Σ = 0.9999999999999999)", () => {
    const r = quoteBuy(
      base({ lines: Array.from({ length: 10 }, () => line("0.001", "0.10")), payments: [cash("1.00")] }),
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(10);
    expect([r.totalWeight, r.totalAmount, r.paid, r.balance]).toStrictEqual(["0.010", "1.00", "1.00", "0.00"]);
  });

  it("ไม่มีรายการและไม่มีการชำระ → noLines ข้อเดียว (ไม่ขึ้นยอดไม่ตรง) · ตัวเลขยังสเกลคงที่", () => {
    expect(quoteBuy(base({ lines: [], payments: [] }))).toStrictEqual({
      ok: false,
      errors: [err("lines", BUY_MSG.noLines)],
      ...NOTHING_COUNTED,
    });
  });
});

describe("quoteBuy — จำนวนเงินต่อแถวชำระ (R4): กลุ่มสมมูล + ค่าขอบ", () => {
  // บิลใบจริง 20,030 ชำระแถวเดียว — แถวที่ใช้ไม่ได้ไม่ถูกนับเป็นยอดชำระ → คงเหลือ 20,030.00 ทั้งก้อน
  it.each([
    ["", BUY_MSG.paymentAmount],
    ["   ", BUY_MSG.paymentAmount],
    ["abc", BUY_MSG.paymentAmount],
    ["๒๐๐๓๐", BUY_MSG.paymentAmount], // เลขไทย
    ["0", BUY_MSG.paymentAmount], // บนขอบล่างพอดี
    ["0.00", BUY_MSG.paymentAmount],
    ["-0.01", BUY_MSG.paymentAmount], // ต่ำกว่าขอบล่าง 1 สตางค์
    ["-0.001", BUY_MSG.paymentAmount], // ติดลบและทศนิยมเกิน → ตรวจค่าบวกก่อน
    ["0.001", BUY_MSG.amountScale], // มากกว่า 0 แต่ 3 ตำแหน่ง
    ["20029.999", BUY_MSG.amountScale],
    ["20030.001", BUY_MSG.amountScale], // ถ้าหลุดไปนับ จะกลายเป็นเกินยอด 0.001
  ])("ชำระ %j → %s ที่ payments.0.amount และไม่นับเป็นยอดชำระ", (amount, msg) => {
    expect(quoteBuy(base({ payments: [cash(amount)] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments.0.amount", msg), err("payments", BUY_MSG.unbalanced("20030.00"))],
      paid: "0.00",
      balance: "20030.00",
    });
  });

  it.each([
    ["20030", "ไม่มีทศนิยม"],
    ["20030.00", "2 ตำแหน่งพอดี = ขอบบนของสเกล"],
    ["20030.000", "ศูนย์ท้ายไม่นับ สเกลตรวจที่ค่า"],
    ["20,030", "คอมมาหลักพัน"],
    [" 20030 ", "เว้นวรรคหัวท้าย"],
  ])("ชำระ %j (%s) → ครบพอดี ok", (amount) => {
    expect(quoteBuy(base({ payments: [cash(amount)] }))).toStrictEqual(REAL_OK);
  });

  it("แถวชำระที่ผิดทำให้ไม่ ok แม้คงเหลือ 0.00 — ปุ่มบันทึกต้องดู ok ไม่ใช่ balance", () => {
    expect(quoteBuy(base({ payments: [cash("0"), transfer("KBANK", "20030")] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments.0.amount", BUY_MSG.paymentAmount)],
    });
  });
});

describe("quoteBuy — วิธีชำระซ้ำ (R5): กุญแจคือ วิธี + ธนาคาร", () => {
  // บิล 20,030 ชำระสองแถว 10,000 + 10,030 — แถวหลังที่ซ้ำไม่ถูกนับ: ชำระ 10,000 คงเหลือ 10,030.00
  it.each<[string, PaymentInput, PaymentInput]>([
    ["เงินสดสองแถว", cash("10000"), cash("10030")],
    ["โอนธนาคารเดียวกันสองแถว", transfer("KBANK", "10000"), transfer("KBANK", "10030")],
    [
      "bank: null กับไม่ส่ง bank",
      { method: "transfer", bank: null, amount: "10000" },
      { method: "transfer", amount: "10030" },
    ],
    [
      'bank: "" กับ bank: null',
      { method: "transfer", bank: "", amount: "10000" },
      { method: "transfer", bank: null, amount: "10030" },
    ],
  ])("%s → ซ้ำ · ข้อผิดอยู่ที่แถวหลัง payments.1.method", (_label, first, second) => {
    expect(quoteBuy(base({ payments: [first, second] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments.1.method", BUY_MSG.paymentDup), err("payments", BUY_MSG.unbalanced("10030.00"))],
      paid: "10000.00",
      balance: "10030.00",
    });
  });

  it.each<[string, PaymentInput, PaymentInput]>([
    ["วิธีเดียวกัน คนละธนาคาร", transfer("KBANK", "10000"), transfer("SCB", "10030")],
    ["วิธีเดียวกัน แถวหนึ่งมีธนาคาร อีกแถวไม่มี", transfer("KBANK", "10000"), { method: "transfer", amount: "10030" }],
    ["คนละวิธี ธนาคารเดียวกัน", transfer("KBANK", "10000"), { method: "cheque", bank: "KBANK", amount: "10030" }],
    ["คนละวิธี ไม่มีธนาคารทั้งคู่", cash("10000"), { method: "transfer", amount: "10030" }],
  ])("%s → ไม่ซ้ำ ชำระครบ ok", (_label, first, second) => {
    expect(quoteBuy(base({ payments: [first, second] }))).toStrictEqual(REAL_OK);
  });

  it("ซ้ำสามแถว → ข้อผิดที่แถว 1 และ 2 · นับเฉพาะแถวแรก", () => {
    expect(quoteBuy(base({ payments: [cash("10000"), cash("5000"), cash("5030")] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [
        err("payments.1.method", BUY_MSG.paymentDup),
        err("payments.2.method", BUY_MSG.paymentDup),
        err("payments", BUY_MSG.unbalanced("10030.00")),
      ],
      paid: "10000.00",
      balance: "10030.00",
    });
  });

  // ทั้งสองแขนงของจำนวนเงินที่ผิด (ว่าง/ไม่บวก · ทศนิยมเกิน) ต้องไม่จองวิธีชำระ
  it.each([
    ["0", BUY_MSG.paymentAmount],
    ["0.001", BUY_MSG.amountScale],
  ])("แถวที่จำนวนเงินผิด (%j) ไม่จองวิธีชำระ — แถวถัดไปวิธีเดียวกันไม่นับว่าซ้ำ", (amount, msg) => {
    expect(quoteBuy(base({ payments: [cash(amount), cash("20030")] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments.0.amount", msg)],
    });
  });

  it("R5 ใช้ข้อความเดียวกับระบบเดิม", () => {
    expect(BUY_MSG.paymentDup).toBe("มีวิธีการชำระนี้อยู่แล้ว");
  });
});

describe("quoteBuy — คงเหลือ = ยอดบิล − ยอดชำระ ต้องเป็น 0.00 พอดี (R4): ค่าขอบรอบศูนย์", () => {
  it.each<[string, string, QuoteError[]]>([
    ["20029.99", "0.01", [err("payments", BUY_MSG.unbalanced("0.01"))]], // ขาด 1 สตางค์
    ["20030.00", "0.00", []], // พอดี
    ["20030.01", "-0.01", [err("payments", BUY_MSG.overpaid)]], // เกิน 1 สตางค์
  ])("ชำระ %s → คงเหลือ %s", (amount, balance, errors) => {
    expect(quoteBuy(base({ payments: [cash(amount)] }))).toStrictEqual({
      ...REAL_OK,
      ok: errors.length === 0,
      errors,
      paid: amount,
      balance,
    });
  });

  it("มีรายการแต่ยังไม่ชำระ → คงเหลือเต็มยอด 20,030.00 (ค่าที่ปุ่ม 'เต็มจำนวน' ใช้)", () => {
    expect(quoteBuy(base({ payments: [] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments", BUY_MSG.unbalanced("20030.00"))],
      paid: "0.00",
      balance: "20030.00",
    });
  });

  it("ไม่มีรายการเลยแต่มีการชำระ → noLines และเกินยอด", () => {
    expect(quoteBuy(base({ lines: [], payments: [cash("100")] }))).toStrictEqual({
      ok: false,
      errors: [err("lines", BUY_MSG.noLines), err("payments", BUY_MSG.overpaid)],
      lines: [],
      totalWeight: "0.000",
      totalAmount: "0.00",
      paid: "100.00",
      balance: "-100.00",
    });
  });

  it("มีแต่แถวที่ใช้ไม่ได้แต่มีการชำระ → เกินยอด (แถวที่ผิดไม่ถูกนับเป็นยอดบิล)", () => {
    expect(quoteBuy(base({ lines: [line("0", "100")], payments: [cash("100")] }))).toStrictEqual({
      ok: false,
      errors: [err("lines.0.weight_g", BUY_MSG.weightPositive), err("payments", BUY_MSG.overpaid)],
      lines: [],
      totalWeight: "0.000",
      totalAmount: "0.00",
      paid: "100.00",
      balance: "-100.00",
    });
  });

  it("ข้อความยอดไม่ตรงบอกยอดคงเหลือที่ส่งเข้าไปตรงตัว", () => {
    expect(BUY_MSG.unbalanced("12345.67")).toContain("12345.67");
  });
});

describe("quoteBuy — รายงานทุกข้อผิดในครั้งเดียว (ไม่หยุดที่ข้อแรก) · ok เป็น true เฉพาะเมื่อ errors ว่าง", () => {
  it("บิลที่ผิดทุกด่าน → errors ครบทุกข้อ เรียงตามหน้าจอ: ราคาทอง → ลูกค้า → รายการ → ชำระ → คงเหลือ", () => {
    const r = quoteBuy({
      goldPriceSet: false,
      customer: card("invalid"),
      lines: [
        line("abc", "-5"), // 0: น้ำหนักไม่ใช่ตัวเลข · ราคาติดลบ
        line("1.2345", "100.123"), // 1: ทศนิยมเกินทั้งสองช่อง
        line("2", "100"), // 2: ใช้ได้ → ยอด 100.00 · 100 ÷ 2 = 50.00/กรัม
      ],
      payments: [
        cash(""), // 0: ว่าง
        cash("0.001"), // 1: ทศนิยมเกิน (แถวที่ผิดไม่จองวิธี จึงไม่ซ้ำกับแถว 0)
        transfer("KBANK", "40"), // 2: ใช้ได้ → ชำระ 40.00
        transfer("KBANK", "60"), // 3: ซ้ำกับแถว 2 → ไม่นับ
      ],
    });
    expect(r).toStrictEqual({
      ok: false,
      errors: [
        err("gold_price", BUY_MSG.noGoldPrice),
        err("customer_id", "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง"),
        err("lines.0.weight_g", BUY_MSG.badNumber),
        err("lines.0.amount", BUY_MSG.amountPositive),
        err("lines.1.weight_g", BUY_MSG.weightScale),
        err("lines.1.amount", BUY_MSG.amountScale),
        err("payments.0.amount", BUY_MSG.paymentAmount),
        err("payments.1.amount", BUY_MSG.amountScale),
        err("payments.3.method", BUY_MSG.paymentDup),
        err("payments", BUY_MSG.unbalanced("60.00")), // 100.00 − 40.00
      ],
      lines: [{ metalId: GOLD, weightG: "2.000", amount: "100.00", pricePerG: "50.00" }],
      totalWeight: "2.000",
      totalAmount: "100.00",
      paid: "40.00",
      balance: "60.00",
    });
  });

  it.each<[string, boolean, QuoteBuyInput]>([
    ["บิลถูกต้องครบ", true, base()],
    ["ยังไม่ตั้งราคาทอง", false, base({ goldPriceSet: false })],
    ["บัตรหมดอายุ", false, base({ customer: card("expired") })],
    ["ไม่มีรายการ", false, base({ lines: [], payments: [] })],
    ["น้ำหนักผิด", false, base({ lines: [line("0", "20030")] })],
    ["ชำระขาด", false, base({ payments: [] })],
    ["ชำระเกิน", false, base({ payments: [cash("20030.01")] })],
    ["วิธีชำระซ้ำ", false, base({ payments: [cash("10000"), cash("10030")] })],
    ["แถวชำระผิดแต่คงเหลือ 0.00", false, base({ payments: [cash("0"), transfer("KBANK", "20030")] })],
  ])("%s → ok=%s และตรงกับ errors ว่าง", (_label, ok, input) => {
    const r = quoteBuy(input);
    expect(r.ok).toBe(ok);
    expect(r.errors.length === 0).toBe(ok);
  });
});

// freeze ทั้งก้อนแบบลึก — ถ้า quoteBuy เขียนทับอินพุต (push/assign) โมดูล ESM เป็น strict mode จะ throw ทันที
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value) as unknown[]) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("quoteBuy — ฟังก์ชันบริสุทธิ์: preview กับ save ได้ผลเดียวกัน (CLAUDE.md กฎ 2 · R14)", () => {
  it("อินพุตเดียวกันเรียกซ้ำได้ผลเท่ากันทุกช่อง — ไม่มีสถานะค้างข้ามการเรียก", () => {
    const input = base({ payments: [cash("10000"), transfer("KBANK", "10030")] });
    const preview = quoteBuy(input);
    const save = quoteBuy(input);
    expect(save).toStrictEqual(preview);
    // ถ้าจำวิธีชำระข้ามการเรียก รอบที่สองจะขึ้น "ซ้ำ" และยอดชำระจะหาย
    expect(preview).toStrictEqual(REAL_OK);
  });

  it("ไม่แก้อินพุต: อินพุตที่ freeze ทั้งก้อนยังคำนวณได้ และค่าเดิมไม่เปลี่ยน", () => {
    const input = base({
      lines: [line("5.860", "20030"), line("0", "1")],
      payments: [cash("20030"), cash("1")],
    });
    const before = structuredClone(input);
    const r = quoteBuy(deepFreeze(input));
    expect(input).toStrictEqual(before);
    expect(r).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("lines.1.weight_g", BUY_MSG.weightPositive), err("payments.1.method", BUY_MSG.paymentDup)],
    });
  });
});
