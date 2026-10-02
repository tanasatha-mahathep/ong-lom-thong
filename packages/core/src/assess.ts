import type Decimal from "decimal.js";
import { D, floorTo, parsePlainDecimal } from "./money";

/**
 * วิธีคิดราคารับซื้อต่อโลหะ — สูตรเดียวกับ Django engine.py ที่ลูกค้ายืนยันกับใบจริงแล้ว (METHOD_PER_BAHT / METHOD_PER_GRAM)
 * - gold_bar_buy: ราคาตั้งต้น = ราคาทองแท่งรับซื้อของวัน (บาทต่อบาททอง) × GOLD_GRAM_FACTOR แปลงเป็นต่อกรัม
 * - per_gram: ราคาตั้งต้น = ราคาต่อกรัมที่ร้านตั้งเองรายวัน
 */
export type MetalPricing = "gold_bar_buy" | "per_gram";

/** code ของโลหะ → วิธีคิดราคา (UAT 30 ก.ย. 2569: นากคิดแบบทอง · เงิน/แพลตตินั่มร้านตั้งราคาต่อกรัมเอง) */
export const METAL_PRICING: Readonly<Record<string, MetalPricing>> = {
  gold: "gold_bar_buy",
  nak: "gold_bar_buy",
  silver: "per_gram",
  platinum: "per_gram",
};

/** ≈ 1/15.244 แปลงราคาต่อบาททองเป็นต่อกรัม (ระบบเดิม price_unit · Django GOLD_FACTOR) */
export const GOLD_GRAM_FACTOR = "0.0656";

/** ค่าบริสุทธิ์ (%) ที่รับ — ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 96.5 · 92.5 · 75 */
export const PURITY_MIN = "1";
export const PURITY_MAX = "100";
export const PURITY_SCALE = 2;

/** หัก % — dropdown 0–10 เลขเต็ม · ไม่เลือก = 0 (ไม่หัก) */
export const DEDUCT_PERCENT_MAX = 10;
export const DEDUCT_PERCENT_CHOICES: readonly string[] = Array.from({ length: DEDUCT_PERCENT_MAX + 1 }, (_, i) =>
  String(i),
);

const WHOLE_NUMBER = /^\d{1,2}$/;

/** ค่าบริสุทธิ์ที่พิมพ์มา → Decimal ในช่วงที่รับ · null = ว่าง/ผิดรูป/นอกช่วง (ข้อความแยกดู purityProblem) */
export function parsePurity(v: unknown): Decimal | null {
  const p = parsePlainDecimal(v);
  if (!p || p.decimalPlaces() > PURITY_SCALE || p.lt(PURITY_MIN) || p.gt(PURITY_MAX)) return null;
  return p;
}

/** หัก % ที่ส่งมา → Decimal 0–10 · ว่าง/ไม่ส่ง = 0 · null = ไม่ใช่เลขเต็มในช่วง */
export function parseDeductPercent(v: unknown): Decimal | null {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return D(0);
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!WHOLE_NUMBER.test(s)) return null;
  const d = D(s);
  return d.gt(DEDUCT_PERCENT_MAX) ? null : d;
}

export interface AssessInput {
  pricing: MetalPricing;
  /** ทอง/นาก = ราคาทองแท่งรับซื้อ (บาทต่อบาททอง) · เงิน/แพลตตินั่ม = บาทต่อกรัม */
  basePrice: Decimal;
  /** 1–100 */
  purity: Decimal;
  /** 0–10 */
  deductPercent: Decimal;
  weight: Decimal;
}

export interface Assessment {
  /** ราคาต่อกรัมหลังคิดค่าบริสุทธิ์ ปัดลงเป็นบาทเต็ม — ก่อนหัก % */
  unitPrice: Decimal;
  /** ยอดก่อนหัก = ปัดลง(ราคาต่อกรัม × น้ำหนัก) */
  grossAmount: Decimal;
  /** เงินที่หัก = ยอดก่อนหัก − ยอดสุทธิ */
  deductAmount: Decimal;
  /** ยอดที่จ่ายจริงของแถว = ปัดลง(ยอดก่อนหัก × (100 − หัก%) ÷ 100) */
  amount: Decimal;
}

/**
 * สูตรราคารับซื้อต่อแถว — ที่เดียวของทั้งระบบ (CLAUDE.md กฎ 2) · quoteBuy() เรียกตัวนี้ทั้งตอน preview และบันทึก
 * ปัดลง (FLOOR) เป็นบาทเต็มทุกขั้นตาม Django engine.py ที่ลูกค้ายืนยัน (อนุมัติ 2 ต.ค. 2569):
 *   ราคา/กรัม = ⌊ฐาน × (0.0656 สำหรับทอง/นาก) × บริสุทธิ์ ÷ 100⌋ → ยอด = ⌊ราคา/กรัม × กรัม⌋ → สุทธิ = ⌊ยอด × (100 − หัก) ÷ 100⌋
 * ต่างจาก Django: หัก % ใช้กับทุกโลหะทุกค่าบริสุทธิ์ ไม่มีเกณฑ์ < 90% / VIP (ร้านตอบ UAT 30 ก.ย. 2569)
 */
export function assessBuyLine(input: AssessInput): Assessment {
  const perGramBase = input.pricing === "gold_bar_buy" ? input.basePrice.times(GOLD_GRAM_FACTOR) : input.basePrice;
  const unitPrice = floorTo(perGramBase.times(input.purity).div(100), 0);
  const grossAmount = floorTo(unitPrice.times(input.weight), 0);
  const amount = floorTo(grossAmount.times(D(100).minus(input.deductPercent)).div(100), 0);
  return { unitPrice, grossAmount, deductAmount: grossAmount.minus(amount), amount };
}

/** เปอร์เซ็นต์สำหรับแสดง/พิมพ์ — ตัดศูนย์ท้าย: "96.50" → "96.5" · "75.000" → "75" · "3" → "3" */
export function formatPercent(v: string | Decimal): string {
  return D(v).toFixed();
}
