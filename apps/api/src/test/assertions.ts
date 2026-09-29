import { expect } from "vitest";

/**
 * ร่องรอยภายในที่ห้ามหลุดไปกับ response (OWASP ASVS 4.0.3 V7.4.1 · API8:2023)
 * stack trace · path ไฟล์ + บรรทัด · ชื่อ error class · ข้อความ error ของ Postgres/drizzle ที่บอกโครง DB
 */
const INTERNALS: readonly RegExp[] = [
  /\bat\s+(?:async\s+)?[\w$.<>[\]]+\s+\(/, // "at fn (file:1:2)"
  /\bat\s+(?:file:\/\/|\/)\S+:\d+/, // "at /app/dist/index.js:1:2"
  /\.[cm]?[jt]sx?:\d+(?::\d+)?\b/, // "index.ts:12:5"
  /node_modules/,
  /"stack"\s*:/,
  /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|PostgresError|DrizzleQueryError|ZodError)\b/,
  /Failed query|invalid input syntax|violates [\w\s-]*constraint|duplicate key value|syntax error at or near/i,
  /\b(?:relation|column) \\?"/, // ข้อความ Postgres — ใน JSON เครื่องหมายคำพูดถูก escape เป็น \"
];

/** รูปแบบที่เข้าข่ายร่องรอยภายใน — ว่าง = ไม่มีอะไรหลุด */
export function leakedInternals(text: string): string[] {
  return INTERNALS.filter((re) => re.test(text)).map(String);
}

/** body ต้องไม่มีร่องรอยภายใน — `where` บอกว่ามาจาก request ไหน */
export function expectNoInternals(text: string, where: string): void {
  expect(leakedInternals(text), `${where}: response มีร่องรอยภายใน — ${text.slice(0, 300)}`).toEqual([]);
}

export interface ApiErrorBody {
  error: string;
  field?: string;
  [extra: string]: unknown;
}

/**
 * error ของ API ต้องเป็นรูป spec §5: JSON `{error, field?}` · ไม่มีร่องรอยภายใน
 * ตรวจ status ด้วยเมื่อส่งมา · คืน body ให้ตรวจต่อ (เช่น field)
 */
export async function expectApiError(res: Response, status: number, where = ""): Promise<ApiErrorBody> {
  const text = await res.text();
  const label = `${where} → ${res.status}`;
  expect(res.status, `${label}: ${text.slice(0, 200)}`).toBe(status);
  expect(res.headers.get("content-type"), `${label}: ต้องเป็น JSON`).toMatch(/^application\/json\b/);
  expectNoInternals(text, label);
  const body = JSON.parse(text) as ApiErrorBody;
  expect(typeof body.error, `${label}: ต้องมี error เป็นข้อความ`).toBe("string");
  if (body.field !== undefined) expect(typeof body.field, `${label}: field ต้องเป็นข้อความ`).toBe("string");
  return body;
}

/**
 * คีย์เงิน/น้ำหนักตามคำศัพท์ของ spec §5 (bar_sell · jewelry_buy · diff · total_amount · weight_g · price_per_g …)
 * ค่าต้องเป็น string หรือ null เสมอ — ห้าม JSON number (CLAUDE.md กฎ 1)
 */
export const MONEY_KEY = /(?:^|_)(?:price|amount|total|sell|buy|diff|paid|balance|cost|weight|grams)(?:_|$)|_g$/;

/**
 * เดิน JSON ทั้งก้อน คืน path ที่ผิดกติกาเงิน:
 * - คีย์เงิน/น้ำหนักที่ค่าเป็น number
 * - number ที่มีทศนิยมที่ใดก็ตาม (float ไม่ควรอยู่ใน response ของร้านทองเลย)
 */
export function moneyShapeViolations(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyShapeViolations(v, `${path}[${i}]`));
  if (typeof value === "number") return Number.isInteger(value) ? [] : [`${path} = ${value} (float)`];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => {
    const at = `${path}.${key}`;
    if (MONEY_KEY.test(key) && typeof v === "number") return [`${at} = ${v} (เงิน/น้ำหนักเป็น number)`];
    return moneyShapeViolations(v, at);
  });
}

/** เงิน/น้ำหนักใน JSON ต้องเป็น string ทั้งก้อน */
export function expectMoneyAsStrings(body: unknown, where: string): void {
  expect(moneyShapeViolations(body), `${where}: เงิน/น้ำหนักต้องเป็น string`).toEqual([]);
}
