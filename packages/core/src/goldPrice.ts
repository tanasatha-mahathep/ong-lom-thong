import type Decimal from "decimal.js";
import { D, fmtInt, fmtMoney, halfUp, parseDecimal, type Numeric } from "./money";

export interface GoldPriceSetting {
  /** ส่วนต่างทองแท่ง ขายออก → รับซื้อ (ระบบเดิม gold_setting.php = 200) */
  diff: Numeric;
  /** ทองรูปพรรณรับซื้อ = รับซื้อ × ส่วนลด (ระบบเดิม 0.95) */
  jewelryDiscount: Numeric;
  /** เตือนเมื่อราคาใหม่ห่างจากราคาก่อนหน้าเกิน % นี้ */
  typoGuardPercent: Numeric;
}

export const DEFAULT_GOLD_SETTING: GoldPriceSetting = {
  diff: "200",
  jewelryDiscount: "0.95",
  typoGuardPercent: "3",
};

export interface GoldPriceQuote {
  barSell: Decimal;
  barBuy: Decimal;
  jewelryBuy: Decimal;
}

/**
 * ร้านกรอกค่าเดียวทุกเช้า (ทองแท่งขายออก) แล้ว derive อีก 2 ค่า
 * ยืนยันกับกระดานราคาจริง 27 ก.ย. 2569: 67,850 → 67,650 → 64,268
 * ทองรูปพรรณต้องปัดครึ่งขึ้น (HALF_UP) ไม่ใช่ปัดเลขคู่ — 64,267.50 → 64,268
 */
export function deriveGoldPrice(barSell: Numeric, setting: GoldPriceSetting = DEFAULT_GOLD_SETTING): GoldPriceQuote {
  const sell = parseDecimal(barSell);
  if (!sell || sell.lte(0)) throw new RangeError("ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0");
  const diff = D(setting.diff);
  const discount = D(setting.jewelryDiscount);
  // ค่าตั้งมาจาก DB (numeric รับ 'NaN'/'Infinity' ได้) — ค่าผิดต้องหยุด ไม่ใช่ได้ราคาเพี้ยน
  if (!diff.isFinite() || diff.lt(0) || !discount.isFinite() || discount.lte(0) || discount.gt(1)) {
    throw new RangeError("ค่าตั้งราคาทองไม่ถูกต้อง (ส่วนต่าง / ส่วนลดทองรูปพรรณ)");
  }
  const barBuy = sell.minus(diff);
  const jewelryBuy = halfUp(barBuy.times(discount), 0);
  return { barSell: sell, barBuy, jewelryBuy };
}

/** ราคาในข้อความเตือน: เต็มบาทพิมพ์ไม่มีทศนิยม (ราคาทอง) · มีสตางค์พิมพ์ 2 ตำแหน่ง (ราคาเงินต่อกรัม เช่น 45.50) */
const showPrice = (v: Decimal) => (v.isInteger() ? fmtInt(v) : fmtMoney(v));

/**
 * ด่านกันพิมพ์ผิด — คืนข้อความเตือน หรือ null เมื่อราคาอยู่ในเกณฑ์ / ไม่มีราคาก่อนหน้า
 * label = คำนำหน้าข้อความ ("ราคา" สำหรับทอง · "ราคาเงิน" / "ราคาแพลตตินั่ม" สำหรับราคาต่อกรัม)
 */
export function typoWarning(
  previousBarSell: Numeric | null | undefined,
  nextBarSell: Numeric,
  guardPercent: Numeric = DEFAULT_GOLD_SETTING.typoGuardPercent,
  label = "ราคา",
): string | null {
  if (previousBarSell === null || previousBarSell === undefined) return null;
  const prev = D(previousBarSell);
  const next = D(nextBarSell);
  if (prev.lte(0)) return null;
  const pct = next.minus(prev).abs().div(prev).times(100);
  if (pct.lte(D(guardPercent))) return null;
  return `${label}ห่างจากครั้งก่อน ${pct.toFixed(1)}% (${showPrice(prev)} → ${showPrice(next)}) — ตรวจสอบก่อนบันทึก`;
}
