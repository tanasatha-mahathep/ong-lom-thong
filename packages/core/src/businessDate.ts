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
  return `${get("year")}-${get("month")}-${get("day")}`;
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
  return `${get("hour")}:${get("minute")}`;
}
