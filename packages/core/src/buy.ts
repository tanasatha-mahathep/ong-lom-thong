import type Decimal from "decimal.js";
import {
  DEDUCT_PERCENT_MAX,
  METAL_PRICING,
  PURITY_MAX,
  PURITY_MIN,
  PURITY_SCALE,
  assessBuyLine,
  parseDeductPercent,
  parsePurity,
} from "./assess";
import { CARD_STATUS_MESSAGE, type CardStatus } from "./card";
import { D, type Numeric, ZERO, fmtInt, fmtMoney, fmtWeight, halfUp, parseDecimal, parsePlainDecimal } from "./money";

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

/**
 * แถวที่พนักงานกรอก — ราคาไม่ได้พิมพ์เองแล้ว ระบบคิดจากราคาของวัน × น้ำหนัก × ค่าบริสุทธิ์ แล้วหัก % (UAT 30 ก.ย. 2569)
 */
export interface BuyLineInput {
  metalId: string;
  /** กรัม ทศนิยม ≤ 3 */
  weightG: string;
  /** ค่าบริสุทธิ์ของชิ้นนั้น (%) 1–100 ทศนิยม ≤ 2 */
  purityPercent: string;
  /** หัก % เลขเต็ม 0–10 · ไม่ส่ง/ว่าง = 0 */
  deductPercent?: string | null;
}

/** โลหะที่บิลใช้ได้ พร้อมราคาตั้งต้นของวันบิล — key ของ QuoteBuyInput.metals คือ metal id */
export interface BuyMetal {
  /** gold · nak · silver · platinum — เลือกวิธีคิดราคาจาก METAL_PRICING */
  code: string;
  nameTh: string;
  /**
   * ราคาตั้งต้นของวัน (string จาก numeric): ทอง/นาก = ราคาทองแท่งรับซื้อ (บาทต่อบาททอง) · เงิน/แพลตตินั่ม = บาทต่อกรัม
   * null = ยังไม่ได้ตั้งราคาของวันนั้น
   */
  basePrice: string | null;
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
  /** โลหะทั้งหมดที่รู้จัก (key = metal id) พร้อมราคาตั้งต้นของวันบิล */
  metals: Readonly<Record<string, BuyMetal>>;
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
  /** ค่าบริสุทธิ์รูปมาตรฐาน 2 ตำแหน่ง "96.50" */
  purityPercent: string;
  /** หัก % เลขเต็ม "0"–"10" */
  deductPercent: string;
  /** ราคาตั้งต้นที่ใช้คิด (ติดแถวไว้ตรวจย้อนหลังได้) — ทอง/นาก บาทต่อบาททอง · เงิน/แพลตตินั่ม บาทต่อกรัม */
  basePrice: string;
  /** ราคาต่อกรัมหลังคิดค่าบริสุทธิ์ ก่อนหัก % (บาทเต็ม) */
  unitPrice: string;
  /** ยอดก่อนหัก % */
  grossAmount: string;
  /** เงินที่หัก % */
  deductAmount: string;
  /** ยอดที่จ่ายจริงของแถว — ตัวเลขที่รวมเป็นยอดบิล */
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
  unknownMetal: "ไม่พบประเภทโลหะ",
  noPricing: (metal: string) => `ยังไม่ได้กำหนดวิธีคิดราคาของ${metal}`,
  noMetalPrice: (metal: string) => `ยังไม่ได้ตั้งราคา${metal}ของวันนี้`,
  purityRequired: "กรุณากรอกค่าบริสุทธิ์ (%)",
  purityInvalid: `ค่าบริสุทธิ์ต้องเป็นตัวเลข ${PURITY_MIN}–${PURITY_MAX} ทศนิยมไม่เกิน ${PURITY_SCALE} ตำแหน่ง เช่น 96.5`,
  deductInvalid: `หัก % ต้องเป็นเลขจำนวนเต็ม 0–${DEDUCT_PERCENT_MAX}`,
  amountZero: "ราคาที่คิดได้เป็น 0 บาท — ตรวจน้ำหนักและค่าบริสุทธิ์",
  amountScale: "จำนวนเงินทศนิยมไม่เกิน 2 ตำแหน่ง",
  amountMax: "ราคาที่คิดได้เกิน 99,999,999.99 บาท — ตรวจน้ำหนักอีกครั้ง",
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
 * น้ำหนักที่กรอก (R3: ตัวเลขล้วนไม่คั่นหลักพัน · > 0 · ทศนิยม ≤ 3 · ไม่เกินเพดาน) → ข้อความผิด หรือ null เมื่อใช้ได้
 * ตัวเดียวกันทั้ง quoteBuy และ normalizeBuyLine — แถวที่ quote ปฏิเสธต้องไม่ถูกปัดเป็นแถวที่ใช้ได้ตอนเทียบบิลซ้ำ
 */
function weightError(raw: unknown, w: Decimal | null): string | null {
  if (!w) return typeof raw === "string" && raw.includes(",") ? BUY_MSG.weightComma : BUY_MSG.badNumber;
  if (w.lte(0)) return BUY_MSG.weightPositive;
  if (w.decimalPlaces() > 3) return BUY_MSG.weightScale;
  if (w.gt(MAX_LINE_WEIGHT_G)) return BUY_MSG.weightMax;
  return null;
}

/** แถวที่กรอกในรูปมาตรฐาน — ตัวแยกเดียวกับ quoteBuy */
export interface NormalizedBuyLine {
  metalId: string;
  weightG: string;
  purityPercent: string;
  deductPercent: string;
}

/**
 * แถวที่กรอก → รูปมาตรฐาน (น้ำหนัก 3 ตำแหน่ง · บริสุทธิ์ 2 ตำแหน่ง · หัก % เลขเต็ม) ด้วยตัวแยกเดียวกับ quoteBuy
 * ใช้เทียบเนื้อบิลตอนกดซ้ำ (idempotency) โดยไม่ต้องรู้ราคาของวัน · null = ช่องใดช่องหนึ่งผิดรูป
 */
export function normalizeBuyLine(line: BuyLineInput): NormalizedBuyLine | null {
  const w = parsePlainDecimal(line.weightG);
  const purity = parsePurity(line.purityPercent);
  const deduct = parseDeductPercent(line.deductPercent);
  if (!w || weightError(line.weightG, w) || !purity || !deduct) return null;
  return {
    metalId: line.metalId,
    weightG: fmtWeight(w),
    purityPercent: purity.toFixed(PURITY_SCALE),
    deductPercent: fmtInt(deduct),
  };
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
    const errorsBefore = errors.length;
    const at = (field: string, message: string) => errors.push({ field: `lines.${i}.${field}`, message });

    // โลหะ + ราคาตั้งต้นของวัน · ทอง/นากที่ไม่มีราคาทองวันนี้ แจ้งครั้งเดียวที่ gold_price (R7) ไม่ซ้ำทุกแถว
    const metal = Object.hasOwn(input.metals, line.metalId) ? input.metals[line.metalId] : undefined;
    const pricing = metal && Object.hasOwn(METAL_PRICING, metal.code) ? METAL_PRICING[metal.code] : undefined;
    const basePrice = metal?.basePrice == null ? null : parseDecimal(metal.basePrice);
    const priced = basePrice !== null && basePrice.isFinite() && basePrice.gt(0);
    if (!metal) at("metal_id", BUY_MSG.unknownMetal);
    else if (!pricing) at("metal_id", BUY_MSG.noPricing(metal.nameTh));
    else if (!priced && !(pricing === "gold_bar_buy" && !input.goldPriceSet)) {
      at("metal_id", BUY_MSG.noMetalPrice(metal.nameTh));
    }

    // น้ำหนักเป็นตัวเลขล้วนเท่านั้น (ไม่คั่นหลักพัน)
    const w = parsePlainDecimal(line.weightG);
    const badWeight = weightError(line.weightG, w);
    if (badWeight) at("weight_g", badWeight);

    const purity = parsePurity(line.purityPercent);
    if (!purity) {
      const blank = typeof line.purityPercent !== "string" || line.purityPercent.trim() === "";
      at("purity_percent", blank ? BUY_MSG.purityRequired : BUY_MSG.purityInvalid);
    }
    const deduct = parseDeductPercent(line.deductPercent);
    if (!deduct) at("deduct_percent", BUY_MSG.deductInvalid);

    if (errors.length > errorsBefore || !metal || !pricing || !basePrice || !priced || !w || !purity || !deduct) {
      return;
    }
    const a = assessBuyLine({ pricing, basePrice, purity, deductPercent: deduct, weight: w });
    if (a.amount.lte(0)) {
      at("weight_g", BUY_MSG.amountZero);
      return;
    }
    if (a.amount.gt(MAX_LINE_AMOUNT)) {
      at("weight_g", BUY_MSG.amountMax);
      return;
    }

    totalWeight = totalWeight.plus(w);
    totalAmount = totalAmount.plus(a.amount);
    lines.push({
      index: i,
      metalId: line.metalId,
      weightG: fmtWeight(w),
      purityPercent: purity.toFixed(PURITY_SCALE),
      deductPercent: fmtInt(deduct),
      basePrice: fmtMoney(basePrice),
      unitPrice: fmtMoney(a.unitPrice),
      grossAmount: fmtMoney(a.grossAmount),
      deductAmount: fmtMoney(a.deductAmount),
      amount: fmtMoney(a.amount),
      pricePerG: fmtMoney(pricePerGram(a.amount, w)),
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
