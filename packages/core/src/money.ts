import Decimal from "decimal.js";
import { ReceiptDataError } from "./errors";

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

/**
 * Strict parse ของตัวเลขที่ต้องไม่มีจุลภาคเลย (น้ำหนัก) — ตัวเลขล้วน มีทศนิยมได้ · null เมื่อไม่ใช่รูปแบบนี้
 * น้ำหนักไม่รับการคั่นหลักพัน: "5,860" ที่ตั้งใจพิมพ์ 5.860 เคยถูกอ่านเป็น 5,860 กรัม
 */
export function parsePlainDecimal(v: unknown): Decimal | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return PLAIN_NUMBER.test(s) ? new Decimal(s) : null;
}

export const halfUp = (v: Decimal, dp: number): Decimal => v.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
export const floorTo = (v: Decimal, dp: number): Decimal => v.toDecimalPlaces(dp, Decimal.ROUND_FLOOR);

export const fmtMoney = (v: Decimal): string => v.toFixed(2);
export const fmtWeight = (v: Decimal): string => v.toFixed(3);
export const fmtInt = (v: Decimal): string => v.toFixed(0);

/** คั่นหลักพันด้วยคอมมาบนสตริงที่ fix ทศนิยมแล้ว ("20030.00" → "20,030.00") — ไม่ผ่าน float */
function groupThousands(fixed: string): string {
  const negative = fixed.startsWith("-") && /[1-9]/.test(fixed);
  const body = fixed.replace(/^-/, "");
  const dot = body.indexOf(".");
  const int = dot === -1 ? body : body.slice(0, dot);
  const frac = dot === -1 ? "" : body.slice(dot);
  return `${negative ? "-" : ""}${int.replace(/\B(?=(\d{3})+$)/g, ",")}${frac}`;
}

/**
 * ตัวเลขที่ต้องมีจริงบนเอกสาร — ว่าง / ไม่ใช่ตัวเลข / Infinity = ReceiptDataError
 * (ต่างจาก parseDecimal ที่คืน null ให้ฟอร์มจัดการเอง · ใบพิมพ์ต้องไม่เดาและไม่พิมพ์ช่องว่าง)
 * รูปแบบเข้มเดียวกับ parseDecimal แต่ติดลบได้ ("-1234.5") — ข้อมูลเอกสารมาจาก DB/โค้ด ไม่ใช่ช่องที่ผู้ใช้พิมพ์
 */
export function requireDecimal(v: string | Decimal, what = "ตัวเลข"): Decimal {
  const s = typeof v === "string" ? v.trim() : null;
  const d = s?.startsWith("-") && /^-\d/.test(s) ? (parseDecimal(s.slice(1))?.negated() ?? null) : parseDecimal(v);
  if (!d) throw new ReceiptDataError(`${what}ไม่ใช่ตัวเลข: "${String(v)}"`);
  return d;
}

/** เงินสำหรับแสดง/พิมพ์ (ใบรับซื้อ): HALF_UP 2 ตำแหน่ง + คอมมา — "20030" → "20,030.00" */
export const formatMoney = (v: string | Decimal): string =>
  groupThousands(halfUp(requireDecimal(v, "จำนวนเงิน"), 2).toFixed(2));

/** น้ำหนักสำหรับแสดง/พิมพ์: 3 ตำแหน่ง + คอมมา (แบบ currencyFormat6 ของระบบเดิม) — "1250.5" → "1,250.500" */
export const formatWeight = (v: string | Decimal): string =>
  groupThousands(halfUp(requireDecimal(v, "น้ำหนัก"), 3).toFixed(3));
