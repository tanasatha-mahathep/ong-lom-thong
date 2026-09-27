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
