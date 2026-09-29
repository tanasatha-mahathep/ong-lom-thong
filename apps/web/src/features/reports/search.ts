import { z } from "zod";
import { MIN_INPUT_DATE } from "@/lib/thai-date";

/** API รับวันที่ตั้งแต่ ค.ศ. 2000 (reports.ts isoDate) — ปีก่อนหน้านั้นไม่มีข้อมูลของร้าน */
export const MIN_REPORT_DATE = MIN_INPUT_DATE;

/** "YYYY-MM-DD" ที่มีจริงและไม่ก่อน MIN_REPORT_DATE — รูปเดียวกับที่ API ตรวจ */
const isoDate = z.iso.date().refine((date) => date >= MIN_REPORT_DATE);
const code = z.string().trim().min(1).max(32);
const id = z.string().min(1).max(64);

/**
 * ตัวกรองใน URL (วันที่เป็น ISO) — ค่าผิดรูป (พิมพ์ URL เอง · ลิงก์เก่า) ถูกทิ้งเป็น "ไม่กรอง" แทนที่จะทำให้หน้าพัง
 * ชื่อเดียวกับ query ของ API: URL → API ตรงตัว
 */
export const PurchaseSearchSchema = z.object({
  date_from: isoDate.optional().catch(undefined),
  date_to: isoDate.optional().catch(undefined),
  metal: code.optional().catch(undefined),
  branch_id: id.optional().catch(undefined),
});
export type PurchaseSearch = z.infer<typeof PurchaseSearchSchema>;

export const StockSearchSchema = z.object({
  as_of: isoDate.optional().catch(undefined),
  branch_id: id.optional().catch(undefined),
});
export type StockSearch = z.infer<typeof StockSearchSchema>;

/** วันที่ 1 ของเดือนเดียวกัน — ค่าเริ่มต้นของรายงานยอดซื้อ (ระบบเดิมเปิดที่เดือนปัจจุบัน · เหมือน API) */
export const monthStart = (iso: string) => `${iso.slice(0, 8)}01`;

const pad = (n: number) => String(n).padStart(2, "0");

/** ช่วงวันที่ของเดือนก่อนหน้าเดือนของ `today` (1 ถึงวันสุดท้ายของเดือน) */
export function lastMonth(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const y = month === 1 ? year - 1 : year;
  const m = month === 1 ? 12 : month - 1;
  // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือน m (Date.UTC รับเดือนแบบ 0-based)
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay)}` };
}

export type DatePreset = "thisMonth" | "lastMonth" | "today";

/** ปุ่มลัดช่วงวันที่ — คิดจาก "วันนี้" ตามเวลาไทย (useBusinessDate) */
export function presetRange(preset: DatePreset, today: string): { from: string; to: string } {
  if (preset === "today") return { from: today, to: today };
  if (preset === "thisMonth") return { from: monthStart(today), to: today };
  return lastMonth(today);
}

export { isoToThaiInput, parseDateField as parseDateInput } from "@/lib/thai-date";
export type { DateInputError } from "@/lib/thai-date";
