/** เลขประจำตัวประชาชน 13 หลัก — รับได้ทั้งแบบติดกันและแบบเว้นวรรค/ขีดตามหน้าบัตร */
export function normalizeNationalId(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/**
 * ตรวจหลักสุดท้าย (checksum mod 11) — Siam ID อ่านจากชิปจึงถูกเสมอ ตัวนี้จับการพิมพ์ผิดตอนกรอกเอง
 * หลักที่ i (0–11) คูณ 13−i · check = (11 − ผลรวม mod 11) mod 10
 */
export function isValidNationalId(input: string): boolean {
  const id = normalizeNationalId(input);
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(id[12]);
}

/**
 * มาสก์สำหรับรายการ/รายงาน (R13 · CLAUDE.md กฎ 7) — เห็นเฉพาะหลักแรกและ 3 หลักท้าย
 * จัดกลุ่มแบบหน้าบัตร: 1670101304032 → "1 XXXX XXXXX 03 2"
 */
export function maskNationalId(input: string): string {
  const id = normalizeNationalId(input);
  if (!/^\d{13}$/.test(id)) return "X".repeat(Math.max(id.length, 1));
  return `${id[0]} XXXX XXXXX ${id.slice(10, 12)} ${id[12]}`;
}
