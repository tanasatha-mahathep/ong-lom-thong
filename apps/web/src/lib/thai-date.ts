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
