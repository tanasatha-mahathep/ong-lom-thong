import { businessDate, parseThaiDate } from "@ong/core";

/**
 * วันที่ในช่องกรอก: พิมพ์เป็น พ.ศ. แบบที่ร้านใช้ (วว/ดด/ปปปป) · เก็บ/ส่ง API เป็น ISO ค.ศ.
 * ห้ามใช้ date picker (CLAUDE.md กฎ 6) — ช่องวันที่เป็น `<input type="text">` แล้วแปลงด้วยตัวนี้
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO ค.ศ. → ข้อความในช่อง: "2026-09-28" → "28/09/2569" · ไม่ใช่ ISO = คืนตามเดิม */
export function isoToThaiInput(iso: string): string {
  const m = ISO_DATE.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${Number(m[1]) + 543}`;
}

/**
 * ข้อความที่พิมพ์ → ISO ค.ศ. หรือ null ถ้าอ่านไม่ได้/ไม่มีวันนั้นจริง
 * รับ วว/ดด/ปปปป ทั้ง พ.ศ. และ ค.ศ. · ปปปป-ดด-วว · "1 ต.ค. 2569" (ตัวเดียวกับที่อ่านวันหมดอายุบัตร)
 */
export function thaiInputToIso(text: string): string | null {
  return parseThaiDate(text);
}

/** วันทำการวันนี้ตามเวลาไทย — เรียกใน event handler/queryFn เท่านั้น (ไม่เรียกตอน render) */
export function todayIso(): string {
  return businessDate(new Date());
}

/** เลื่อนวันที่ ISO ตามปฏิทิน: addDaysIso("2026-09-28", -7) → "2026-09-21" */
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ปีแรกที่ API รับ (ListQuery · reports isoDate: ตั้งแต่ ค.ศ. 2000) — ก่อนนั้นถือว่าวันที่ไม่ถูกต้อง */
export const MIN_INPUT_DATE = "2000-01-01";

export type DateInputError = "required" | "invalid" | "tooEarly";

/**
 * ช่องวันที่ที่พิมพ์เอง → ISO ค.ศ. หรือชนิดของ error (ข้อความอยู่ใน common.dateField.*)
 * ว่าง = required · ไม่ใช่วันจริง = invalid · ก่อน ค.ศ. 2000 = tooEarly
 */
export function parseDateField(text: string): { iso: string } | { error: DateInputError } {
  if (text.trim() === "") return { error: "required" };
  const iso = thaiInputToIso(text);
  if (!iso) return { error: "invalid" };
  if (iso < MIN_INPUT_DATE) return { error: "tooEarly" };
  return { iso };
}

/**
 * วันที่ + เวลาในตารางทั้งแอป — รูปเดียวกับตารางค้นบิล: "29/09/2569 17:56" (วว/ดด/ปปปป พ.ศ. + ชม:นน)
 * วันที่ในข้อความบรรยาย (หัวรายงาน · ช่วงวันที่) ก็ใช้ isoToThaiInput รูปเดียวกัน
 */
export function formatDocDateTime(isoDate: string, time: string): string {
  return `${isoToThaiInput(isoDate)} ${time}`;
}
