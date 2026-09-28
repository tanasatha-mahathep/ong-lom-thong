/** เขตเวลาของร้าน — เซิร์ฟเวอร์รัน UTC แต่ "วันนี้" ของบิลและราคาทองคือวันตามเวลาไทย */
export const SHOP_TIME_ZONE = "Asia/Bangkok";

/**
 * วันที่ทำการ (ISO "YYYY-MM-DD") ตามเขตเวลาของร้าน
 * ตัวอย่าง: 2026-09-27T18:30:00Z = 01:30 วันที่ 28 เวลาไทย → "2026-09-28"
 */
export function businessDate(now: Date = new Date(), timeZone: string = SHOP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: "year" | "month" | "day") => parts.find((p) => p.type === type)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  // Intl ที่ขาดส่วนใดส่วนหนึ่งจะได้ "-09-28" ซึ่งเทียบ string กับวันหมดอายุบัตรแล้วผิดเงียบ ๆ — หยุดเลย
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`businessDate: unexpected Intl output "${iso}"`);
  return iso;
}

/**
 * เวลาปัจจุบันตามเขตเวลาของร้าน "HH:MM" (24 ชม.) — ค่าเริ่มต้นของช่องเวลาในบิล (ระบบเดิมเติมเวลาปัจจุบัน)
 * ตัวอย่าง: 2026-09-27T17:05:00Z = 00:05 น. วันที่ 28 เวลาไทย → "00:05"
 */
export function businessTime(now: Date = new Date(), timeZone: string = SHOP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: "hour" | "minute") => parts.find((p) => p.type === type)?.value ?? "";
  const hhmm = `${get("hour")}:${get("minute")}`;
  // "10:" จะถูก Postgres อ่านเป็น 10:00 เงียบ ๆ — หยุดเลย
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) throw new Error(`businessTime: unexpected Intl output "${hhmm}"`);
  return hhmm;
}
