/**
 * แสดงเงิน / น้ำหนัก / วันที่ จากค่าที่ API ส่งมา — **ห้ามแปลงเป็น number** (CLAUDE.md กฎ 1)
 * Intl.NumberFormat.format() รับข้อความทศนิยมได้ตรงตัว (ES2023) จึงไม่มี float ระหว่างทาง
 * ปัดแบบ halfExpand = HALF_UP ของ decimal.js — แต่ค่าจาก API ปัดมาแล้ว ปกติจึงไม่มีอะไรให้ปัด
 * ใช้คู่กับ class `tabular-nums` เสมอ
 */

/** ค่าว่าง (null / undefined / "") */
export const EMPTY = "–";

/** รูปที่ API ส่ง: "-1234.50" — ไม่รับ "", " 1", "1e3", "0x10" ที่ Intl ยอมแปลงเอง */
const DECIMAL = /^-?\d+(\.\d+)?$/;

const isDecimal = (value: string): value is `${number}` => DECIMAL.test(value);

const numberFormat = (fractionDigits: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    roundingMode: "halfExpand",
    // "-0.00" แสดงเป็น "0.00"
    signDisplay: "negative",
  });

const MONEY = numberFormat(2);
const WEIGHT = numberFormat(3);
const INTEGER = numberFormat(0);

/** ค่าที่ไม่ใช่ข้อความทศนิยมคืนตามเดิม — เห็นบั๊กบนจอดีกว่าแสดงตัวเลขผิด */
function formatDecimal(format: Intl.NumberFormat, value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  return isDecimal(value) ? format.format(value) : value;
}

/** เงิน 2 ตำแหน่ง: "20030" → "20,030.00" */
export const formatMoney = (value: string | null | undefined) => formatDecimal(MONEY, value);

/** น้ำหนัก (กรัม) 3 ตำแหน่ง: "5.86" → "5.860" */
export const formatWeight = (value: string | null | undefined) => formatDecimal(WEIGHT, value);

/** จำนวนเต็ม เช่น ราคาทองรูปพรรณ: "64268" → "64,268" */
export const formatInteger = (value: string | null | undefined) => formatDecimal(INTEGER, value);

/** เขตเวลาของร้าน — ตรงกับ SHOP_TIME_ZONE ใน @ong/core */
const SHOP_TIME_ZONE = "Asia/Bangkok";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const dateFormat = (month: "short" | "long") =>
  new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { day: "numeric", month, year: "numeric", timeZone: "UTC" });

const DATE = { short: dateFormat("short"), long: dateFormat("long") };
const DATE_TIME = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: SHOP_TIME_ZONE,
});

/**
 * วันที่ล้วน (ISO "YYYY-MM-DD") เป็น พ.ศ.: "2026-09-28" → "28 ก.ย. 2569" · month="long" → "28 กันยายน 2569"
 * ไม่ขึ้นกับเขตเวลาของเครื่อง — วันที่ของบิล/ราคาทองเป็นวันตามเวลาไทยอยู่แล้ว
 */
export function formatThaiDate(iso: string | null | undefined, month: "short" | "long" = "short"): string {
  if (!iso) return EMPTY;
  if (!ISO_DATE.test(iso)) return iso;
  const date = new Date(`${iso}T00:00:00Z`);
  // วันที่ที่ไม่มีจริง (เช่น 2026-02-30) ต้องไม่ถูกเลื่อนไปวันอื่น
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return iso;
  return DATE[month].format(date);
}

/** เวลาเต็ม (ISO timestamp) เป็นวันเวลาไทย พ.ศ.: "2026-09-27T18:30:00Z" → "28 ก.ย. 2569 01:30" */
export function formatThaiDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return DATE_TIME.format(date);
}
