import { z } from "zod";
import { MIN_INPUT_DATE, addDaysIso, parseDateField } from "@/lib/thai-date";
import { type BuyListParams } from "./api";
import { type BillsKey } from "./i18n";

/** API รับวันที่ตั้งแต่ ค.ศ. 2000 เท่านั้น (ListQuery ใน services/buy.ts) — ก่อนหน้านั้นถือว่าวันที่ไม่ถูกต้อง */
export const MIN_DATE = MIN_INPUT_DATE;

const filterDate = z.iso.date().refine((iso) => iso >= MIN_DATE);

/**
 * search params ของ /bills — วันที่ใน URL เป็น ISO ค.ศ. (ช่องกรอกแสดง พ.ศ.)
 * ค่าที่อ่านไม่ได้ (ลิงก์เก่า · พิมพ์ URL เอง) กลายเป็น "ไม่กรอง" แทนที่จะทำให้ทั้งหน้าพัง
 */
export const billsSearchSchema = z.object({
  from: filterDate.optional().catch(undefined),
  to: filterDate.optional().catch(undefined),
  /** code ของโลหะ */
  metal: z.string().trim().min(1).max(32).optional().catch(undefined),
  // router อ่าน ?q=6910 ที่พิมพ์เองใน URL เป็นตัวเลข — แปลงกลับเป็นข้อความ (เลขที่บิล/เลขบัตรค้นได้)
  q: z.coerce.string().trim().max(100).optional().catch(undefined),
  /** id สาขา */
  branch: z.string().min(1).max(64).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type BillsSearch = z.infer<typeof billsSearchSchema>;

/** คำค้นสั้นกว่านี้ไม่ส่ง — API ตอบ 400 · ช่องค้นแสดงคำแนะนำแทน */
export const MIN_QUERY_LENGTH = 2;
/** เท่ากับเพดานของ API (ยาวกว่านี้ = 400) */
export const MAX_QUERY_LENGTH = 100;

/**
 * อักขระควบคุม (\p{Cc}) และ surrogate ที่ไม่มีคู่ (\p{Cs} ใต้ flag u) — API ปฏิเสธคำค้นที่มี (400)
 * จึงตัดทิ้งก่อนส่ง
 */
const UNUSABLE_CHARS = /[\p{Cc}\p{Cs}]/gu;

/** คำค้นที่ส่งจริง: ตัดอักขระที่ใช้ไม่ได้ก่อน แล้วค่อย trim */
export function cleanQuery(text: string): string {
  return text.replace(UNUSABLE_CHARS, "").trim();
}

/** search ของหน้า → ตัวกรองของ API · หน้า 1 ไม่ใส่ page (key เดียวกับการ์ดบนหน้าแรก) */
export function toListParams(search: BillsSearch): BuyListParams {
  const params: BuyListParams = {};
  if (search.from) params.date_from = search.from;
  if (search.to) params.date_to = search.to;
  if (search.metal) params.metal = search.metal;
  const q = cleanQuery(search.q ?? "");
  if (q.length >= MIN_QUERY_LENGTH) params.q = q;
  if (search.branch) params.branch_id = search.branch;
  if (search.page && search.page > 1) params.page = search.page;
  return params;
}

/**
 * ข้อความในช่องวันที่ → ISO ค.ศ. ที่จะใส่ URL
 * ช่องว่าง = "" (ไม่กรอง) · อ่านไม่ได้ / ไม่มีวันนั้นจริง / ก่อน ค.ศ. 2000 = null
 */
export function parseDateFilter(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  const parsed = parseDateField(trimmed);
  return "iso" in parsed ? parsed.iso : null;
}

/** ช่วงวันที่ (ISO ค.ศ.) — ไม่มีค่า = ไม่จำกัดด้านนั้น */
export interface DateRange {
  from?: string;
  to?: string;
}

/** วันแรกของเดือน: "2026-09-28" → "2026-09-01" */
const monthStartIso = (iso: string) => `${iso.slice(0, 7)}-01`;

/**
 * ปุ่มช่วงวันที่สำเร็จรูป — คำนวณจาก today (ISO วันทำการตามเวลาไทย) ที่ส่งเข้ามา ไม่อ่านนาฬิกาเอง
 * ผู้เรียกหา today ด้วย todayIso() ตอนกดปุ่ม ไม่ใช่ตอน render · label = key ของข้อความ
 */
export const DATE_PRESETS: readonly {
  label: Extract<BillsKey, `presets.${string}`>;
  range: (today: string) => DateRange;
}[] = [
  { label: "presets.today", range: (today) => ({ from: today, to: today }) },
  {
    label: "presets.yesterday",
    range: (today) => {
      const yesterday = addDaysIso(today, -1);
      return { from: yesterday, to: yesterday };
    },
  },
  { label: "presets.last7Days", range: (today) => ({ from: addDaysIso(today, -6), to: today }) },
  { label: "presets.thisMonth", range: (today) => ({ from: monthStartIso(today), to: today }) },
  { label: "presets.allDates", range: () => ({}) },
];
