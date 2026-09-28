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

/** Lenient parse for user input: null when blank or not a finite number. Never throws. */
export function parseDecimal(v: unknown): Decimal | null {
  if (isBlank(v)) return null;
  if (typeof v !== "string" && typeof v !== "number" && !(v instanceof Decimal)) return null;
  try {
    const d = D(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
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

function finite(v: string | Decimal): Decimal {
  const d = D(v);
  if (!d.isFinite()) throw new RangeError(`ไม่ใช่ตัวเลข: ${String(v)}`);
  return d;
}

/** เงินสำหรับแสดง/พิมพ์ (ใบรับซื้อ): HALF_UP 2 ตำแหน่ง + คอมมา — "20030" → "20,030.00" */
export const formatMoney = (v: string | Decimal): string => groupThousands(halfUp(finite(v), 2).toFixed(2));

/** น้ำหนักสำหรับแสดง/พิมพ์: 3 ตำแหน่ง + คอมมา (แบบ currencyFormat6 ของระบบเดิม) — "1250.5" → "1,250.500" */
export const formatWeight = (v: string | Decimal): string => groupThousands(halfUp(finite(v), 3).toFixed(3));
