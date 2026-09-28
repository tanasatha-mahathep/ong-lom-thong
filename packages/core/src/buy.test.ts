import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  BUY_MSG,
  MAX_LINE_AMOUNT,
  MAX_LINE_WEIGHT_G,
  PAYMENT_METHODS,
  avgPricePerG,
  isPaymentMethod,
  pricePerGram,
  quoteBuy,
  type BuyLineInput,
  type PaymentInput,
  type PaymentMethod,
  type QuoteBuyInput,
  type QuoteBuyResult,
  type QuoteError,
  type QuotedPayment,
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
// แถวชำระที่ quoteBuy คืนใน result.payments: index = ตำแหน่งใน input · ไม่มีธนาคาร = null · เงินรูป 2 ตำแหน่ง
const payRow = (index: number, method: PaymentMethod, amount: string, bank: string | null = null): QuotedPayment => ({
  index,
  method,
  bank,
  amount,
});

// แถวใบจริงหลังคำนวณ (แถวแรกของ input → index 0): 20,030 ÷ 5.860 = 3,418.0887… → HALF_UP 2 → 3,418.09
const REAL_LINE = { index: 0, metalId: GOLD, weightG: "5.860", amount: "20030.00", pricePerG: "3418.09" };
// ผลของ base(): บิลใบจริงชำระเงินสดครบ
// ราคาเฉลี่ย/กรัม = ยอดรวม ÷ น้ำหนักรวม = 20,030 ÷ 5.860 = 3,418.0887… → 3,418.09 (แถวเดียว = ราคา/กรัมของแถว)
const REAL_OK: QuoteBuyResult = {
  ok: true,
  errors: [],
  lines: [REAL_LINE],
  payments: [payRow(0, "cash", "20030.00")],
  totalWeight: "5.860",
  totalAmount: "20030.00",
  avgPricePerG: "3418.09",
  paid: "20030.00",
  balance: "0.00",
};
// ไม่มีแถวที่ใช้ได้และไม่มีการชำระ — ตัวเลขทุกช่องยังออกสเกลคงที่ (น้ำหนัก 3 · เงิน 2)
// น้ำหนักรวม 0 → ราคาเฉลี่ย/กรัม 0.00 (ไม่หารด้วยศูนย์)
const NOTHING_COUNTED = {
  lines: [],
  payments: [],
  totalWeight: "0.000",
  totalAmount: "0.00",
  avgPricePerG: "0.00",
  paid: "0.00",
  balance: "0.00",
};

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
      { index: 1, metalId: GOLD, weightG: "1.000", amount: "3000.50", pricePerG: "3000.50" },
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
      lines: [{ index: 0, metalId: GOLD, weightG, amount: "100.00", pricePerG }],
      payments: [payRow(0, "cash", "100.00")],
      totalWeight: weightG,
      totalAmount: "100.00",
      // แถวเดียว: ยอดรวม ÷ น้ำหนักรวม = 100 ÷ น้ำหนักแถว = ค่าในคอลัมน์ราคา/กรัมที่คิดไว้ข้างบน
      avgPricePerG: pricePerG,
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
      lines: [{ index: 0, metalId: GOLD, weightG: "1.000", amount, pricePerG: amount }],
      payments: [payRow(0, "cash", amount)],
      totalWeight: "1.000",
      totalAmount: amount,
      avgPricePerG: amount, // ยอดรวม ÷ 1.000 กรัม = ราคา
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
      lines: [{ index: 0, metalId: GOLD, weightG: "1.000", amount: "100.00", pricePerG: "100.00" }],
      payments: [payRow(0, "cash", "100.00")],
      totalWeight: "1.000",
      totalAmount: "100.00",
      avgPricePerG: "100.00", // 100 ÷ 1.000 — แถวที่ผิดไม่ถูกนับทั้งยอดและน้ำหนัก
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
        { index: 0, metalId: GOLD, weightG: "1.000", amount: "100.00", pricePerG: "100.00" },
        { index: 1, metalId: SILVER, weightG: "2.000", amount: "300.00", pricePerG: "150.00" }, // 300 ÷ 2
      ],
      payments: [payRow(0, "cash", "400.00")],
      totalWeight: "3.000",
      totalAmount: "400.00",
      // ถ่วงด้วยน้ำหนัก: 400 ÷ 3.000 = 133.333… → 133.33 (ไม่ใช่ค่าเฉลี่ยตรง ๆ ของ 100 กับ 150 = 125.00)
      avgPricePerG: "133.33",
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
      lines: [{ index: 0, metalId: GOLD, weightG: "3.000", amount: "1.00", pricePerG: "0.33" }],
      payments: [payRow(0, "cash", "1.00")],
      totalWeight: "3.000",
      totalAmount: "1.00",
      avgPricePerG: "0.33", // 1 ÷ 3.000 = 0.333… → 0.33
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
        { index: 0, metalId: GOLD, weightG: "0.100", amount: "0.10", pricePerG: "1.00" },
        { index: 1, metalId: GOLD, weightG: "0.200", amount: "0.20", pricePerG: "1.00" },
      ],
      payments: [payRow(0, "cash", "0.30")],
      totalWeight: "0.300",
      totalAmount: "0.30",
      avgPricePerG: "1.00", // 0.30 ÷ 0.300 = 1
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
      payments: [], // แถวที่ผิดไม่ออกใน result.payments
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
      payments: [payRow(1, "transfer", "20030.00", "KBANK")],
    });
  });
});

describe("quoteBuy — วิธีชำระซ้ำ (R5): กุญแจคือ วิธี + ธนาคาร", () => {
  // บิล 20,030 ชำระสองแถว 10,000 + 10,030 — แถวหลังที่ซ้ำไม่ถูกนับ: ชำระ 10,000 คงเหลือ 10,030.00
  // คอลัมน์สุดท้าย = แถวแรกที่ถูกเก็บใน result.payments (แถวหลังที่ซ้ำไม่ถูกเก็บ)
  it.each<[string, PaymentInput, PaymentInput, QuotedPayment]>([
    ["เงินสดสองแถว", cash("10000"), cash("10030"), payRow(0, "cash", "10000.00")],
    [
      "โอนธนาคารเดียวกันสองแถว",
      transfer("KBANK", "10000"),
      transfer("KBANK", "10030"),
      payRow(0, "transfer", "10000.00", "KBANK"),
    ],
    [
      "bank: null กับไม่ส่ง bank",
      { method: "transfer", bank: null, amount: "10000" },
      { method: "transfer", amount: "10030" },
      payRow(0, "transfer", "10000.00"),
    ],
    [
      'bank: "" กับ bank: null',
      { method: "transfer", bank: "", amount: "10000" },
      { method: "transfer", bank: null, amount: "10030" },
      payRow(0, "transfer", "10000.00"), // "" = ไม่มีธนาคาร → null
    ],
  ])("%s → ซ้ำ · ข้อผิดอยู่ที่แถวหลัง payments.1.method", (_label, first, second, kept) => {
    expect(quoteBuy(base({ payments: [first, second] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments.1.method", BUY_MSG.paymentDup), err("payments", BUY_MSG.unbalanced("10030.00"))],
      payments: [kept],
      paid: "10000.00",
      balance: "10030.00",
    });
  });

  // คอลัมน์สุดท้าย = result.payments ที่คาด (เก็บทั้งสองแถว ตามลำดับ input)
  it.each<[string, PaymentInput, PaymentInput, QuotedPayment[]]>([
    [
      "วิธีเดียวกัน คนละธนาคาร",
      transfer("KBANK", "10000"),
      transfer("SCB", "10030"),
      [payRow(0, "transfer", "10000.00", "KBANK"), payRow(1, "transfer", "10030.00", "SCB")],
    ],
    [
      "วิธีเดียวกัน แถวหนึ่งมีธนาคาร อีกแถวไม่มี",
      transfer("KBANK", "10000"),
      { method: "transfer", amount: "10030" },
      [payRow(0, "transfer", "10000.00", "KBANK"), payRow(1, "transfer", "10030.00")],
    ],
    [
      "คนละวิธี ไม่มีธนาคารทั้งคู่",
      cash("10000"),
      { method: "transfer", amount: "10030" },
      [payRow(0, "cash", "10000.00"), payRow(1, "transfer", "10030.00")],
    ],
  ])("%s → ไม่ซ้ำ ชำระครบ ok", (_label, first, second, payments) => {
    expect(quoteBuy(base({ payments: [first, second] }))).toStrictEqual({ ...REAL_OK, payments });
  });

  // "คนละวิธี ธนาคารเดียวกัน" ต้องใช้เงินสด + ธนาคาร (วิธีที่รับได้มีแค่ cash/transfer) แต่ธนาคารบนแถวเงินสด
  // ยังเป็นคำถาม product (เก็บ/ทิ้ง/ปฏิเสธ) — จึงตรวจเฉพาะเจตนาของกุญแจ: วิธีต่างกัน → แถวหลังไม่ขึ้น "ซ้ำ"
  it("คนละวิธี ธนาคารเดียวกัน → ไม่ซ้ำ (ไม่ผูกผลของธนาคารบนแถวเงินสด)", () => {
    const r = quoteBuy(
      base({ payments: [transfer("KBANK", "10000"), { method: "cash", bank: "KBANK", amount: "10030" }] }),
    );
    expect(r.errors).not.toContainEqual(err("payments.1.method", BUY_MSG.paymentDup));
    expect(r.payments[0]).toStrictEqual(payRow(0, "transfer", "10000.00", "KBANK"));
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
      payments: [payRow(0, "cash", "10000.00")],
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
      payments: [payRow(1, "cash", "20030.00")],
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
      payments: [payRow(0, "cash", amount)],
      paid: amount,
      balance,
    });
  });

  it("มีรายการแต่ยังไม่ชำระ → คงเหลือเต็มยอด 20,030.00 (ค่าที่ปุ่ม 'เต็มจำนวน' ใช้)", () => {
    expect(quoteBuy(base({ payments: [] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments", BUY_MSG.unbalanced("20030.00"))],
      payments: [],
      paid: "0.00",
      balance: "20030.00",
    });
  });

  it("ไม่มีรายการเลยแต่มีการชำระ → noLines และเกินยอด", () => {
    expect(quoteBuy(base({ lines: [], payments: [cash("100")] }))).toStrictEqual({
      ok: false,
      errors: [err("lines", BUY_MSG.noLines), err("payments", BUY_MSG.overpaid)],
      lines: [],
      payments: [payRow(0, "cash", "100.00")],
      totalWeight: "0.000",
      totalAmount: "0.00",
      avgPricePerG: "0.00", // น้ำหนักรวม 0 → 0.00 (ไม่หารด้วยศูนย์)
      paid: "100.00",
      balance: "-100.00",
    });
  });

  it("มีแต่แถวที่ใช้ไม่ได้แต่มีการชำระ → เกินยอด (แถวที่ผิดไม่ถูกนับเป็นยอดบิล)", () => {
    expect(quoteBuy(base({ lines: [line("0", "100")], payments: [cash("100")] }))).toStrictEqual({
      ok: false,
      errors: [err("lines.0.weight_g", BUY_MSG.weightPositive), err("payments", BUY_MSG.overpaid)],
      lines: [],
      payments: [payRow(0, "cash", "100.00")],
      totalWeight: "0.000",
      totalAmount: "0.00",
      avgPricePerG: "0.00", // น้ำหนักรวม 0 → 0.00 (ไม่หารด้วยศูนย์)
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
      lines: [{ index: 2, metalId: GOLD, weightG: "2.000", amount: "100.00", pricePerG: "50.00" }],
      payments: [payRow(2, "transfer", "40.00", "KBANK")],
      totalWeight: "2.000",
      totalAmount: "100.00",
      avgPricePerG: "50.00", // 100.00 ÷ 2.000
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
    expect(preview).toStrictEqual({
      ...REAL_OK,
      payments: [payRow(0, "cash", "10000.00"), payRow(1, "transfer", "10030.00", "KBANK")],
    });
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

// ── เพดานต่อแถว ──────────────────────────────────────────────────────────────────────────────────────
// เพดานพิมพ์ตรงตัวในตาราง (ไม่อ้าง MAX_LINE_*) ให้ oracle อิสระ · ขั้นเล็กสุด: น้ำหนัก 0.001 g · เงิน 0.01 บาท
describe("quoteBuy — เพดานต่อแถว: ค่าขอบ น้ำหนัก 999,999.999 g · ราคา 99,999,999.99 บาท", () => {
  it("ค่าคงที่กับข้อความที่พนักงานเห็นบอกเพดานเดียวกัน", () => {
    expect(MAX_LINE_WEIGHT_G).toBe("999999.999");
    expect(MAX_LINE_AMOUNT).toBe("99999999.99");
    expect(BUY_MSG.weightMax).toContain("999,999.999");
    expect(BUY_MSG.amountMax).toContain("99,999,999.99");
  });

  it.each([
    ["1000000.000", BUY_MSG.weightMax], // เหนือเพดาน 1 ขั้น (0.001 g)
    ["1000000", BUY_MSG.weightMax], // ค่าเดียวกัน ไม่มีทศนิยม
    ["1,000,000", BUY_MSG.weightMax], // คอมมาหลักพันถูกตัดก่อนตรวจ
    ["1000000.0001", BUY_MSG.weightScale], // เกินทั้งเพดานและสเกล → ตรวจสเกลก่อน บอกข้อเดียว
    ["-1000000", BUY_MSG.weightPositive], // ติดลบ → ตรวจค่าบวกก่อน
  ])("น้ำหนัก %j → %s ที่ lines.0.weight_g ข้อเดียว และไม่นับรวมยอด", (w, msg) => {
    expect(quoteBuy(base({ lines: [line(w, "100")], payments: [] }))).toStrictEqual({
      ok: false,
      errors: [err("lines.0.weight_g", msg)],
      ...NOTHING_COUNTED,
    });
  });

  it.each([
    ["999999.998", "ต่ำกว่าเพดาน 1 ขั้น"],
    ["999999.999", "เท่าเพดานพอดี"],
  ])("น้ำหนัก %s (%s) → ใช้ได้", (weightG) => {
    // 100 ÷ 999,999.99x = 0.0001000… → HALF_UP 2 → 0.00 (ราคา/กรัมใช้แสดงเท่านั้น แถวยังใช้ได้)
    expect(quoteBuy(base({ lines: [line(weightG, "100")], payments: [cash("100")] }))).toStrictEqual({
      ok: true,
      errors: [],
      lines: [{ index: 0, metalId: GOLD, weightG, amount: "100.00", pricePerG: "0.00" }],
      payments: [payRow(0, "cash", "100.00")],
      totalWeight: weightG,
      totalAmount: "100.00",
      avgPricePerG: "0.00",
      paid: "100.00",
      balance: "0.00",
    });
  });

  it.each([
    ["100000000.00", BUY_MSG.amountMax], // เหนือเพดาน 1 ขั้น (0.01 บาท)
    ["100000000", BUY_MSG.amountMax],
    ["100,000,000", BUY_MSG.amountMax],
    ["100000000.001", BUY_MSG.amountScale], // เกินทั้งเพดานและสเกล → ตรวจสเกลก่อน
    ["-100000000", BUY_MSG.amountPositive],
  ])("ราคา %j → %s ที่ lines.0.amount ข้อเดียว และไม่นับรวมยอด", (a, msg) => {
    expect(quoteBuy(base({ lines: [line("1", a)], payments: [] }))).toStrictEqual({
      ok: false,
      errors: [err("lines.0.amount", msg)],
      ...NOTHING_COUNTED,
    });
  });

  it.each([
    ["99999999.98", "ต่ำกว่าเพดาน 1 ขั้น"],
    ["99999999.99", "เท่าเพดานพอดี"],
  ])("ราคา %s (%s) → ใช้ได้", (amount) => {
    // น้ำหนัก 1 กรัม → ราคา/กรัม = ราคาเฉลี่ย/กรัม = ราคา
    expect(quoteBuy(base({ lines: [line("1", amount)], payments: [cash(amount)] }))).toStrictEqual({
      ok: true,
      errors: [],
      lines: [{ index: 0, metalId: GOLD, weightG: "1.000", amount, pricePerG: amount }],
      payments: [payRow(0, "cash", amount)],
      totalWeight: "1.000",
      totalAmount: amount,
      avgPricePerG: amount,
      paid: amount,
      balance: "0.00",
    });
  });

  it("ราคา/กรัมสูงสุดที่เกิดได้: เพดานราคา ÷ น้ำหนักเล็กสุด = 99,999,999.99 ÷ 0.001 = 99,999,999,990.00", () => {
    expect(quoteBuy(base({ lines: [line("0.001", "99999999.99")], payments: [cash("99999999.99")] }))).toStrictEqual({
      ok: true,
      errors: [],
      lines: [{ index: 0, metalId: GOLD, weightG: "0.001", amount: "99999999.99", pricePerG: "99999999990.00" }],
      payments: [payRow(0, "cash", "99999999.99")],
      totalWeight: "0.001",
      totalAmount: "99999999.99",
      avgPricePerG: "99999999990.00",
      paid: "99999999.99",
      balance: "0.00",
    });
  });

  it("เพดานเป็นต่อแถว ไม่ใช่ต่อบิล: 50 แถว (สูงสุดที่ API รับ) ที่เพดานพอดี → ใช้ได้ ยอดรวมยังพอดี numeric ใน DB", () => {
    const r = quoteBuy(
      base({
        lines: Array.from({ length: 50 }, () => line("999999.999", "99999999.99")),
        payments: [cash("4999999999.50")],
      }),
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.index)).toStrictEqual(Array.from({ length: 50 }, (_, i) => i));
    // ต่อแถว: 99,999,999.99 ÷ 999,999.999 = 100.00000009 → 100.00
    expect(r.lines.map((l) => l.pricePerG)).toStrictEqual(Array.from({ length: 50 }, () => "100.00"));
    expect(r.payments).toStrictEqual([payRow(0, "cash", "4999999999.50")]);
    expect([r.totalWeight, r.totalAmount, r.avgPricePerG, r.paid, r.balance]).toStrictEqual([
      "49999999.950", // 50 × 999,999.999 — 8 หลักหน้าจุด ≤ 9 ของ numeric(12,3)
      "4999999999.50", // 50 × 99,999,999.99 — 10 หลักหน้าจุด ≤ 12 ของ numeric(14,2)
      "100.00", // 4,999,999,999.50 ÷ 49,999,999.95 = 100.00000009 → 100.00
      "4999999999.50",
      "0.00",
    ]);
  });
});

// ── วิธีชำระ ───────────────────────────────────────────────────────────────────────────────────────────
const UNPAID = err("payments", BUY_MSG.unbalanced("20030.00")); // แถวชำระไม่ถูกนับ → ค้างเต็มยอดบิลใบจริง
const NOT_COUNTED = { payments: [], paid: "0.00", balance: "20030.00" };

describe("quoteBuy — วิธีชำระ: กลุ่มสมมูลของค่า method (PAYMENT_METHODS · isPaymentMethod)", () => {
  it("ข้อความเดียวกับระบบเดิม (02 §3.4)", () => {
    expect(BUY_MSG.paymentMethod).toBe("กรุณาเลือกประเภทเงินที่ชำระ");
  });

  it.each<[PaymentMethod]>([["cash"], ["transfer"]])("%s → วิธีที่รับได้ ชำระครบ ok", (method) => {
    expect(isPaymentMethod(method)).toBe(true);
    expect(quoteBuy(base({ payments: [{ method, amount: "20030" }] }))).toStrictEqual({
      ...REAL_OK,
      payments: [payRow(0, method, "20030.00")],
    });
  });

  it.each<[string, unknown]>([
    ["สตริงว่าง", ""],
    ["วิธีที่ไม่รู้จัก", "cheque"],
    ["ตัวพิมพ์ต่าง", "Cash"],
    ["มีช่องว่างหัวท้าย — key ต้องตรงตัว ไม่ตัดให้", " cash "],
    ["key ของ prototype: toString", "toString"],
    ["key ของ prototype: __proto__", "__proto__"],
    ["key ของ prototype: constructor", "constructor"],
    ["key ของ prototype: hasOwnProperty", "hasOwnProperty"],
    ["null (cast)", null],
    ["undefined (cast)", undefined],
    ["ตัวเลข (cast)", 1],
    ["boolean (cast)", true],
    ['อาร์เรย์ ["cash"] (cast) — ถ้าไม่เช็กชนิด key จะถูกแปลงเป็น "cash"', ["cash"]],
    ['String object ของ "cash" (cast)', new String("cash")],
    ['object ที่ toString() ได้ "cash" (cast)', { toString: () => "cash" }],
  ])("%s → กรุณาเลือกประเภทเงินที่ชำระ · แถวไม่ถูกนับ", (_label, method) => {
    expect(isPaymentMethod(method)).toBe(false);
    expect(quoteBuy(base({ payments: [{ method: method as string, amount: "20030" }] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments.0.method", BUY_MSG.paymentMethod), UNPAID],
      ...NOT_COUNTED,
    });
  });

  it('แถวที่วิธีผิดไม่ถึงด่านวิธีซ้ำ: สองแถววิธีว่าง → แจ้ง "เลือกวิธี" ทั้งสองแถว ไม่ขึ้น "ซ้ำ"', () => {
    expect(
      quoteBuy(
        base({
          payments: [
            { method: "", amount: "10000" },
            { method: "", amount: "10030" },
          ],
        }),
      ),
    ).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [
        err("payments.0.method", BUY_MSG.paymentMethod),
        err("payments.1.method", BUY_MSG.paymentMethod),
        UNPAID,
      ],
      ...NOT_COUNTED,
    });
  });
});

describe("quoteBuy — แถวชำระ: ตารางตัดสินใจ วิธี × จำนวนเงิน (แจ้งครบทุกช่องของแถว ไม่หยุดที่ช่องแรก)", () => {
  it("วิธีถูก · เงินถูก → นับเป็นยอดชำระ", () => {
    expect(quoteBuy(base({ payments: [{ method: "cash", amount: "20030" }] }))).toStrictEqual(REAL_OK);
  });

  // ทุกกฎที่เหลือ: แถวไม่ถูกนับ · ข้อผิดของช่อง method มาก่อน amount เสมอ
  it.each<[string, string, string, QuoteError[]]>([
    ["วิธีผิด · เงินถูก", "", "20030", [err("payments.0.method", BUY_MSG.paymentMethod), UNPAID]],
    ["วิธีถูก · เงินว่าง", "cash", "", [err("payments.0.amount", BUY_MSG.paymentAmount), UNPAID]],
    ["วิธีถูก · เงินทศนิยมเกิน", "cash", "20030.001", [err("payments.0.amount", BUY_MSG.amountScale), UNPAID]],
    [
      "วิธีผิด · เงินว่าง",
      "",
      "",
      [err("payments.0.method", BUY_MSG.paymentMethod), err("payments.0.amount", BUY_MSG.paymentAmount), UNPAID],
    ],
    [
      "วิธีผิด · เงินติดลบ",
      "cheque",
      "-1",
      [err("payments.0.method", BUY_MSG.paymentMethod), err("payments.0.amount", BUY_MSG.paymentAmount), UNPAID],
    ],
    [
      "วิธีผิด · เงินทศนิยมเกิน",
      "cheque",
      "20030.001",
      [err("payments.0.method", BUY_MSG.paymentMethod), err("payments.0.amount", BUY_MSG.amountScale), UNPAID],
    ],
  ])("%s", (_label, method, amount, errors) => {
    expect(quoteBuy(base({ payments: [{ method, amount }] }))).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors,
      ...NOT_COUNTED,
    });
  });
});

// ── ธนาคาร ─────────────────────────────────────────────────────────────────────────────────────────────
// ธนาคารที่มีค่าใช้กับ "โอน" · ธนาคารว่างใช้กับ "เงินสด" — ไม่ผูกคู่ที่ยังเป็นคำถาม product (เงินสด+ธนาคาร · โอนไม่มีธนาคาร)
describe("quoteBuy — ธนาคาร: ตัดช่องว่างหัวท้ายทั้งในแถวที่บันทึกและในกุญแจวิธีซ้ำ · ว่าง = null", () => {
  it.each<[string, string, string]>([
    ["ช่องว่างหัวท้าย", "KBANK", " KBANK "],
    ["tab/ขึ้นบรรทัด", "KBANK", "\tKBANK\n"],
    ["NBSP จากการคัดลอกหน้าเว็บ", "KBANK", "\u00a0KBANK\u00a0"],
  ])("โอน · ธนาคาร%s → %j", (_label, kept, bank) => {
    expect(quoteBuy(base({ payments: [{ method: "transfer", bank, amount: "20030" }] }))).toStrictEqual({
      ...REAL_OK,
      payments: [payRow(0, "transfer", "20030.00", kept)],
    });
  });

  it.each<[string, string | null | undefined]>([
    ["มีแต่ช่องว่าง", "   "],
    ["มีแต่ tab/ขึ้นบรรทัด", "\t\n"],
    ["NBSP ล้วน", "\u00a0"],
    ["สตริงว่าง", ""],
    ["null", null],
    ["ไม่ส่ง (undefined)", undefined],
  ])("เงินสด · ธนาคาร%s → null", (_label, bank) => {
    expect(quoteBuy(base({ payments: [{ method: "cash", bank, amount: "20030" }] }))).toStrictEqual(REAL_OK);
  });

  // สองแถว 10,000 + 10,030 ที่ธนาคารต่างกันแค่ช่องว่างหัวท้าย = กุญแจเดียวกัน → แถวหลังซ้ำ ไม่นับ
  it.each<[string, PaymentMethod, string | null, string | null | undefined, string | null | undefined]>([
    ['โอน " KBANK " กับ "KBANK"', "transfer", "KBANK", " KBANK ", "KBANK"],
    ['โอน "KBANK" กับ "\\tKBANK\\n"', "transfer", "KBANK", "KBANK", "\tKBANK\n"],
    ['โอน NBSP+KBANK กับ "KBANK "', "transfer", "KBANK", "\u00a0KBANK", "KBANK "],
    ['เงินสด "   " กับ null', "cash", null, "   ", null],
    ['เงินสด "\\t" กับไม่ส่ง bank', "cash", null, "\t", undefined],
  ])("%s → ซ้ำ · เก็บแถวแรกเป็น %s ธนาคาร %j", (_label, method, kept, first, second) => {
    expect(
      quoteBuy(
        base({
          payments: [
            { method, bank: first, amount: "10000" },
            { method, bank: second, amount: "10030" },
          ],
        }),
      ),
    ).toStrictEqual({
      ...REAL_OK,
      ok: false,
      errors: [err("payments.1.method", BUY_MSG.paymentDup), err("payments", BUY_MSG.unbalanced("10030.00"))],
      payments: [payRow(0, method, "10000.00", kept)],
      paid: "10000.00",
      balance: "10030.00",
    });
  });

  it('ตัดช่องว่างแล้วยังคนละธนาคาร (" KBANK " กับ " SCB ") → ไม่ซ้ำ · เก็บชื่อที่ตัดแล้ว', () => {
    expect(
      quoteBuy(
        base({
          payments: [
            { method: "transfer", bank: " KBANK ", amount: "10000" },
            { method: "transfer", bank: " SCB ", amount: "10030" },
          ],
        }),
      ),
    ).toStrictEqual({
      ...REAL_OK,
      payments: [payRow(0, "transfer", "10000.00", "KBANK"), payRow(1, "transfer", "10030.00", "SCB")],
    });
  });
});

// ── pricePerGram / avgPricePerG ────────────────────────────────────────────────────────────────────────
describe("pricePerGram — ราคา ÷ น้ำหนัก HALF_UP 2 ตำแหน่ง (สูตรเดียว: ต่อแถว · ใบรับซื้อ · ราคาเฉลี่ย)", () => {
  // ผลเป็น Decimal — เทียบด้วย toString() ที่แสดงค่าจริงทุกหลัก ไม่ใช้ toFixed(2) ซึ่งปัดเองจนซ่อนขั้นปัดที่หายไป
  it.each([
    // [ราคา, น้ำหนัก, ผลหารจริง, ที่ต้องได้]
    ["12.44", "10", "1.244", "1.24"], // …4 → ลง (CEIL/UP จะได้ 1.25)
    ["12.45", "10", "1.245", "1.25"], // …5 → ขึ้น (HALF_EVEN/HALF_DOWN จะได้ 1.24)
    ["12.46", "10", "1.246", "1.25"], // …6 → ขึ้น (FLOOR/DOWN จะได้ 1.24)
    ["0.04", "10", "0.004", "0"], // ปัดเหลือศูนย์
    ["0.05", "10", "0.005", "0.01"], // HALF_EVEN/FLOOR → 0
    ["0.06", "10", "0.006", "0.01"],
    ["1", "8", "0.125", "0.13"],
    ["1", "3", "0.333…", "0.33"], // ผลหารไม่รู้จบ
    ["2", "3", "0.666…", "0.67"],
    ["20030", "5.86", "3418.0887…", "3418.09"], // ใบจริง
    ["99999999.99", "0.001", "99999999990", "99999999990"], // เพดานราคา ÷ น้ำหนักเล็กสุด
  ])("%s ÷ %s = %s → %s", (amount, weight, _exact, expected) => {
    expect(pricePerGram(new Decimal(amount), new Decimal(weight)).toString()).toBe(expected);
  });
});

describe("avgPricePerG — ยอดรวม ÷ น้ำหนักรวม HALF_UP 2 · น้ำหนักรวม ≤ 0 → 0.00 · รับคอมมา", () => {
  it.each([
    ["0", "บนขอบพอดี"],
    ["0.000", "ศูนย์ที่มีทศนิยม"],
    ["-0", "ลบศูนย์"],
    ["-0.001", "ต่ำกว่าศูนย์ 1 ขั้น"],
    ["-5", "ติดลบ"],
    ["-1,000", "ติดลบและมีคอมมา"],
  ])("น้ำหนักรวม %j (%s) → 0.00 ไม่หาร", (weight) => {
    expect(avgPricePerG("100", weight)).toBe("0.00");
  });

  it.each([
    // [ยอดรวม, น้ำหนักรวม, ที่ต้องได้]
    ["1", "0.001", "1000.00"], // เหนือศูนย์ 1 ขั้น: 1 ÷ 0.001 = 1,000
    ["12.44", "10", "1.24"], // …4
    ["12.45", "10", "1.25"], // …5 (HALF_EVEN → 1.24)
    ["12.46", "10", "1.25"], // …6
    ["0", "5.860", "0.00"], // ยอดศูนย์
    ["21,530.00", "105.860", "203.38"], // 21,530 ÷ 105.86 = 203.3818… → 203.38
    ["20,030", "5.860", "3418.09"], // 20,030 ÷ 5.86 = 3,418.0887… → 3,418.09
    ["1,000,000.00", "1,000", "1000.00"], // คอมมาทั้งสองช่อง: 1,000,000 ÷ 1,000
    [" 20030 ", " 5.860 ", "3418.09"], // ช่องว่างหัวท้าย
  ])("%j ÷ %j → %s", (amount, weight, expected) => {
    expect(avgPricePerG(amount, weight)).toBe(expected);
  });

  it("รับ Decimal ตรง ๆ (เส้นทางที่ quoteBuy ส่งเข้า)", () => {
    expect(avgPricePerG(new Decimal("20030"), new Decimal("5.86"))).toBe("3418.09");
    expect(avgPricePerG(new Decimal("100"), new Decimal("0"))).toBe("0.00");
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
});

describe("quoteBuy — วิธีชำระ", () => {
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
