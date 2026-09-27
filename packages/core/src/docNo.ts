const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** งวดของเลขที่เอกสาร = ปี พ.ศ. 2 หลัก + เดือน 2 หลัก: "2026-10-01" → "6910" */
export function docPeriod(isoDate: string): string {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new RangeError(`วันที่ต้องเป็น YYYY-MM-DD: ${isoDate}`);
  const beYear = Number(m[1]) + 543;
  return `${String(beYear % 100).padStart(2, "0")}${m[2]}`;
}

/**
 * รูปแบบเดียวกับ Django: RC6910-0001 — นับแยกสาขาต่องวด
 * (ตัว running ออกโดย next_doc_no() ใน Postgres เพื่อกันเลขชน — ฟังก์ชันนี้แค่จัดรูปแบบ)
 */
export function formatDocNo(prefix: string, isoDate: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError("running number ต้องเป็นจำนวนเต็ม ≥ 1");
  return `${prefix}${docPeriod(isoDate)}-${String(seq).padStart(4, "0")}`;
}
