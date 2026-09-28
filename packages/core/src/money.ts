import Decimal from "decimal.js";

export type Numeric = string | number | Decimal;

export const ZERO = new Decimal(0);

/** Strict parse: throws on garbage. Accepts "67,850" (commas stripped). */
export function D(v: Numeric): Decimal {
  if (v instanceof Decimal) return v;
  if (typeof v === "number") return new Decimal(v);
  return new Decimal(v.replace(/,/g, "").trim());
}

export function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

// ตัวเลขที่ผู้ใช้พิมพ์: ตัวเลขล้วน (มีทศนิยมได้) หรือคั่นหลักพันถูกต้อง "67,850" · "1,234,567.50"
// กลุ่มแรกห้ามขึ้นต้นด้วย 0 ("0,123" ไม่ใช่การคั่นหลักพัน — น่าจะหมายถึง 0.123)
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
const GROUPED_NUMBER = /^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/;

/**
 * Strict parse ของตัวเลขที่ผู้ใช้กรอก — null เมื่อว่างหรือไม่ใช่รูปแบบข้างบน · ไม่ throw
 * ไม่รับ: เครื่องหมาย +/− · hex · exponent · คอมมาผิดตำแหน่ง ("20,03" · "1,2345") · ช่องว่างกลางตัวเลข
 * (Decimal/number ที่ finite มาจากโค้ด ไม่ใช่จากผู้ใช้ — ผ่านตามเดิม)
 */
export function parseDecimal(v: unknown): Decimal | null {
  if (v instanceof Decimal) return v.isFinite() ? v : null;
  if (typeof v === "number") return Number.isFinite(v) ? new Decimal(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!PLAIN_NUMBER.test(s) && !GROUPED_NUMBER.test(s)) return null;
  return new Decimal(s.replace(/,/g, ""));
}

export const halfUp = (v: Decimal, dp: number): Decimal => v.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
export const floorTo = (v: Decimal, dp: number): Decimal => v.toDecimalPlaces(dp, Decimal.ROUND_FLOOR);

export const fmtMoney = (v: Decimal): string => v.toFixed(2);
export const fmtWeight = (v: Decimal): string => v.toFixed(3);
export const fmtInt = (v: Decimal): string => v.toFixed(0);
