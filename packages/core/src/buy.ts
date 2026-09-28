import type Decimal from "decimal.js";
import { CARD_STATUS_MESSAGE, type CardStatus } from "./card";
import { D, type Numeric, ZERO, fmtMoney, fmtWeight, halfUp, parseDecimal, parsePlainDecimal } from "./money";

/** วิธีชำระที่รับได้ — ระบบเดิมตั้งไว้แค่เงินสด · โอนเงินเผื่อไว้ (spec §12 ข้อ 6) · key เก็บลง payment.method */
export const PAYMENT_METHODS = { cash: "เงินสด", transfer: "โอนเงิน" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const isPaymentMethod = (v: unknown): v is PaymentMethod =>
  typeof v === "string" && Object.hasOwn(PAYMENT_METHODS, v);

/**
 * ราคา/กรัม = ราคา ÷ น้ำหนัก ปัดครึ่งขึ้น 2 ตำแหน่ง (R3) — แสดงเท่านั้น ไม่ใช้คำนวณต่อ
 * สูตรเดียวของทั้งระบบ: quoteBuy() ใช้ต่อแถว · ใบรับซื้อใช้ต่อกลุ่มโลหะ (groupLinesByMetal)
 */
export function pricePerGram(amount: Decimal, weight: Decimal): Decimal {
  return halfUp(amount.div(weight), 2);
}

export interface BuyLineInput {
  metalId: string;
  /** กรัม ทศนิยม ≤ 3 */
  weightG: string;
  /** ราคาที่รับซื้อจริง (บาท) ทศนิยม ≤ 2 — พนักงานพิมพ์เอง ตามที่ร้านใช้จริง */
  amount: string;
}

export interface PaymentInput {
  method: string;
  bank?: string | null;
  amount: string;
}

export interface QuoteBuyInput {
  lines: BuyLineInput[];
  payments: PaymentInput[];
  customer?: { id: string; cardStatus: CardStatus } | null;
  /** ราคาทองของวันนี้ถูกตั้งแล้ว (R7) */
  goldPriceSet: boolean;
}

export interface QuoteError {
  field: string;
  message: string;
}

export interface QuotedLine {
  /** ตำแหน่งของแถวใน input — แถวที่ผิดถูกข้าม จอจึงต้องใช้ตัวนี้จับคู่กับแถวที่กรอก */
  index: number;
  metalId: string;
  weightG: string;
  amount: string;
  /** ราคา/กรัม = amount ÷ weight ปัดครึ่งขึ้น 2 ตำแหน่ง — แสดงเท่านั้น ไม่ใช้คำนวณต่อ */
  pricePerG: string;
}

export interface QuotedPayment {
  /** ตำแหน่งของแถวใน input */
  index: number;
  method: PaymentMethod;
  bank: string | null;
  /** จำนวนเงินรูปมาตรฐาน 2 ตำแหน่ง — ค่าที่บันทึกลง payment */
  amount: string;
}

export interface QuoteBuyResult {
  ok: boolean;
  errors: QuoteError[];
  lines: QuotedLine[];
  /** แถวชำระที่ถูกต้อง (แถวที่ผิดถูกข้าม) */
  payments: QuotedPayment[];
  totalWeight: string;
  totalAmount: string;
  /** ราคาเฉลี่ย/กรัม — แสดงเท่านั้น (ดู avgPricePerG) */
  avgPricePerG: string;
  paid: string;
  balance: string;
}

export const BUY_MSG = {
  noCustomer: "ต้องระบุลูกค้าก่อนบันทึก",
  noGoldPrice: "ยังไม่ได้ตั้งราคาทองของวันนี้",
  noLines: "ยังไม่มีรายการสินค้า",
  badNumber: "ตัวเลขไม่ถูกต้อง",
  weightPositive: "น้ำหนักต้องมากกว่า 0",
  weightScale: "น้ำหนักทศนิยมไม่เกิน 3 ตำแหน่ง",
  weightComma: "น้ำหนักห้ามใส่จุลภาค — เช่น 5.860 หรือ 1250.500",
  weightMax: "น้ำหนักเกิน 999,999.999 กรัม — ตรวจตัวเลขอีกครั้ง",
  amountPositive: "ราคาต้องมากกว่า 0",
  amountScale: "จำนวนเงินทศนิยมไม่เกิน 2 ตำแหน่ง",
  amountMax: "ราคาเกิน 99,999,999.99 บาท — ตรวจตัวเลขอีกครั้ง",
  paymentMethod: "กรุณาเลือกประเภทเงินที่ชำระ",
  bankRequired: "กรุณาเลือกธนาคาร",
  cashNoBank: "เงินสดไม่ต้องระบุธนาคาร",
  paymentAmount: "กรุณากรอกจำนวนเงิน",
  paymentDup: "มีวิธีการชำระนี้อยู่แล้ว",
  overpaid: "เกินยอดที่ต้องชำระ",
  unbalanced: (balance: string) => `ยอดชำระไม่ตรงกับยอดบิล — คงเหลือ ${balance} บาท (ต้องเป็น 0.00)`,
} as const;

/**
 * เพดานต่อแถว — กันเลขที่พิมพ์/สแกนหลุดช่อง (เช่น Siam ID พิมพ์เลขบัตร 13 หลักลงช่องราคา) ไม่ให้ล้น numeric ใน DB
 * 50 แถว × เพดาน ยังพอดี numeric(14,2) / numeric(12,3) · ราคา/กรัม สูงสุด 99,999,999.99 ÷ 0.001 ก็ยังพอดี
 */
export const MAX_LINE_WEIGHT_G = "999999.999";
export const MAX_LINE_AMOUNT = "99999999.99";

/**
 * ราคาเฉลี่ย/กรัม (ระบบเดิม "ราคาเฉลี่ย/กรัม" = ยอดรวม ÷ น้ำหนักรวม) ปัดครึ่งขึ้น 2 ตำแหน่ง — แสดงเท่านั้น
 * น้ำหนักรวม 0 = "0.00" · ใช้ทั้งใน quoteBuy และตอนแสดงบิลที่บันทึกแล้ว
 * สูตรคือ pricePerGram() ตัวเดียวกับราคา/กรัมต่อแถวและราคาต่อหน่วยบนใบรับซื้อ — ห้ามเขียนการหารซ้ำที่นี่
 */
export function avgPricePerG(totalAmount: Numeric, totalWeight: Numeric): string {
  const w = D(totalWeight);
  if (w.lte(0)) return fmtMoney(ZERO);
  return fmtMoney(pricePerGram(D(totalAmount), w));
}

/**
 * ฟังก์ชันเดียวที่ใช้ทั้ง live preview (POST /buy/quote) และตอนบันทึก (POST /buy)
 * ห้ามมีสูตรที่สองที่ไหนอีก — ยอดบนจอกับยอดที่บันทึกต้องออกจากที่เดียวกัน
 */
export function quoteBuy(input: QuoteBuyInput): QuoteBuyResult {
  const errors: QuoteError[] = [];
  const lines: QuotedLine[] = [];
  let totalWeight = ZERO;
  let totalAmount = ZERO;

  if (!input.goldPriceSet) errors.push({ field: "gold_price", message: BUY_MSG.noGoldPrice });
  if (!input.customer) {
    errors.push({ field: "customer_id", message: BUY_MSG.noCustomer });
  } else if (input.customer.cardStatus !== "ok") {
    errors.push({ field: "customer_id", message: CARD_STATUS_MESSAGE[input.customer.cardStatus] });
  }

  if (input.lines.length === 0) errors.push({ field: "lines", message: BUY_MSG.noLines });
  input.lines.forEach((line, i) => {
    // น้ำหนักเป็นตัวเลขล้วนเท่านั้น (ไม่คั่นหลักพัน) · เงินคั่นหลักพันได้ "20,030"
    const w = parsePlainDecimal(line.weightG);
    const a = parseDecimal(line.amount);
    let bad = false;
    if (!w) {
      const comma = typeof line.weightG === "string" && line.weightG.includes(",");
      errors.push({ field: `lines.${i}.weight_g`, message: comma ? BUY_MSG.weightComma : BUY_MSG.badNumber });
      bad = true;
    } else if (w.lte(0)) {
      errors.push({ field: `lines.${i}.weight_g`, message: BUY_MSG.weightPositive });
      bad = true;
    } else if (w.decimalPlaces() > 3) {
      errors.push({ field: `lines.${i}.weight_g`, message: BUY_MSG.weightScale });
      bad = true;
    } else if (w.gt(MAX_LINE_WEIGHT_G)) {
      errors.push({ field: `lines.${i}.weight_g`, message: BUY_MSG.weightMax });
      bad = true;
    }
    if (!a) {
      errors.push({ field: `lines.${i}.amount`, message: BUY_MSG.badNumber });
      bad = true;
    } else if (a.lte(0)) {
      errors.push({ field: `lines.${i}.amount`, message: BUY_MSG.amountPositive });
      bad = true;
    } else if (a.decimalPlaces() > 2) {
      errors.push({ field: `lines.${i}.amount`, message: BUY_MSG.amountScale });
      bad = true;
    } else if (a.gt(MAX_LINE_AMOUNT)) {
      errors.push({ field: `lines.${i}.amount`, message: BUY_MSG.amountMax });
      bad = true;
    }
    if (bad || !w || !a) return;
    totalWeight = totalWeight.plus(w);
    totalAmount = totalAmount.plus(a);
    lines.push({
      index: i,
      metalId: line.metalId,
      weightG: fmtWeight(w),
      amount: fmtMoney(a),
      pricePerG: fmtMoney(pricePerGram(a, w)),
    });
  });

  let paid = ZERO;
  const payments: QuotedPayment[] = [];
  const seen = new Set<string>();
  input.payments.forEach((p, i) => {
    let bad = false;
    const method = isPaymentMethod(p.method) ? p.method : null;
    const bank = p.bank?.trim() || null;
    if (!method) {
      errors.push({ field: `payments.${i}.method`, message: BUY_MSG.paymentMethod });
      bad = true;
    } else if (method === "transfer" && !bank) {
      // เจ้าของกำหนด 28 ก.ย.: โอนต้องระบุธนาคาร · เงินสดไม่มีธนาคาร (วิธี+ธนาคาร ใช้ตรวจแถวซ้ำ)
      errors.push({ field: `payments.${i}.bank`, message: BUY_MSG.bankRequired });
      bad = true;
    } else if (method === "cash" && bank) {
      errors.push({ field: `payments.${i}.bank`, message: BUY_MSG.cashNoBank });
      bad = true;
    }
    const a = parseDecimal(p.amount);
    if (!a || a.lte(0)) {
      errors.push({ field: `payments.${i}.amount`, message: BUY_MSG.paymentAmount });
      bad = true;
    } else if (a.decimalPlaces() > 2) {
      errors.push({ field: `payments.${i}.amount`, message: BUY_MSG.amountScale });
      bad = true;
    }
    if (bad || !method || !a) return;
    const key = `${method}|${bank ?? ""}`;
    if (seen.has(key)) {
      errors.push({ field: `payments.${i}.method`, message: BUY_MSG.paymentDup });
      return;
    }
    seen.add(key);
    paid = paid.plus(a);
    payments.push({ index: i, method, bank, amount: fmtMoney(a) });
  });

  const balance = totalAmount.minus(paid);
  if (paid.gt(totalAmount)) {
    errors.push({ field: "payments", message: BUY_MSG.overpaid });
  } else if (lines.length > 0 && !balance.isZero()) {
    errors.push({ field: "payments", message: BUY_MSG.unbalanced(fmtMoney(balance)) });
  }

  return {
    ok: errors.length === 0,
    errors,
    lines,
    payments,
    totalWeight: fmtWeight(totalWeight),
    totalAmount: fmtMoney(totalAmount),
    avgPricePerG: avgPricePerG(totalAmount, totalWeight),
    paid: fmtMoney(paid),
    balance: fmtMoney(balance),
  };
}
