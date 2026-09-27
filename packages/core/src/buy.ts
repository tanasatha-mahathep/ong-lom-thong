import { CARD_STATUS_MESSAGE, type CardStatus } from "./card";
import { ZERO, fmtMoney, fmtWeight, halfUp, parseDecimal } from "./money";

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
  metalId: string;
  weightG: string;
  amount: string;
  /** ราคา/กรัม = amount ÷ weight ปัดครึ่งขึ้น 2 ตำแหน่ง — แสดงเท่านั้น ไม่ใช้คำนวณต่อ */
  pricePerG: string;
}

export interface QuoteBuyResult {
  ok: boolean;
  errors: QuoteError[];
  lines: QuotedLine[];
  totalWeight: string;
  totalAmount: string;
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
  amountPositive: "ราคาต้องมากกว่า 0",
  amountScale: "จำนวนเงินทศนิยมไม่เกิน 2 ตำแหน่ง",
  paymentAmount: "กรุณากรอกจำนวนเงิน",
  paymentDup: "มีวิธีการชำระนี้อยู่แล้ว",
  overpaid: "เกินยอดที่ต้องชำระ",
  unbalanced: (balance: string) => `ยอดชำระไม่ตรงกับยอดบิล — คงเหลือ ${balance} บาท (ต้องเป็น 0.00)`,
} as const;

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
    const w = parseDecimal(line.weightG);
    const a = parseDecimal(line.amount);
    let bad = false;
    if (!w) {
      errors.push({ field: `lines.${i}.weight_g`, message: BUY_MSG.badNumber });
      bad = true;
    } else if (w.lte(0)) {
      errors.push({ field: `lines.${i}.weight_g`, message: BUY_MSG.weightPositive });
      bad = true;
    } else if (w.decimalPlaces() > 3) {
      errors.push({ field: `lines.${i}.weight_g`, message: BUY_MSG.weightScale });
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
    }
    if (bad || !w || !a) return;
    totalWeight = totalWeight.plus(w);
    totalAmount = totalAmount.plus(a);
    lines.push({
      metalId: line.metalId,
      weightG: fmtWeight(w),
      amount: fmtMoney(a),
      pricePerG: fmtMoney(halfUp(a.div(w), 2)),
    });
  });

  let paid = ZERO;
  const seen = new Set<string>();
  input.payments.forEach((p, i) => {
    const a = parseDecimal(p.amount);
    if (!a || a.lte(0)) {
      errors.push({ field: `payments.${i}.amount`, message: BUY_MSG.paymentAmount });
      return;
    }
    if (a.decimalPlaces() > 2) {
      errors.push({ field: `payments.${i}.amount`, message: BUY_MSG.amountScale });
      return;
    }
    const key = `${p.method}|${p.bank ?? ""}`;
    if (seen.has(key)) {
      errors.push({ field: `payments.${i}.method`, message: BUY_MSG.paymentDup });
      return;
    }
    seen.add(key);
    paid = paid.plus(a);
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
    totalWeight: fmtWeight(totalWeight),
    totalAmount: fmtMoney(totalAmount),
    paid: fmtMoney(paid),
    balance: fmtMoney(balance),
  };
}
