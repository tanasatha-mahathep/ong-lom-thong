import { isValidNationalId, normalizeNationalId } from "@ong/core";

/**
 * ข้อมูลสมมติสำหรับเทสต์ (CLAUDE.md กฎ 8 · สกิล test-suite) — ห้ามใช้ข้อมูลลูกค้าจริง
 *
 * เลขบัตรประชาชน: หลักตรวจ (หลักที่ 13) หาด้วย isValidNationalId ของ @ong/core เอง — ไม่มีสูตร checksum ที่สอง
 * หลัก 2–3 เป็น "99" เสมอ: รหัสสำนักทะเบียนขึ้นต้นด้วยรหัสจังหวัด (10–96) ซึ่งไม่มี 99 → ชนกับเลขของคนจริงไม่ได้
 */
const SYNTHETIC_OFFICE = "99";

/** ชื่อสมมติ — ขึ้นต้น "ทดสอบ" เสมอ */
export const testName = (label: string) => `ทดสอบ ${label}`;

/** เติมหลักตรวจให้ 12 หลักแรก — ลองทีละหลัก 0–9 ให้ @ong/core ตัดสิน (ผ่านได้หลักเดียวเท่านั้น) */
export function withCheckDigit(first12: string): string {
  if (!/^\d{12}$/.test(first12)) throw new Error(`ต้องเป็นตัวเลข 12 หลัก: ${first12}`);
  for (let d = 0; d <= 9; d++) {
    const id = `${first12}${d}`;
    if (isValidNationalId(id)) return id;
  }
  throw new Error(`หาหลักตรวจไม่ได้: ${first12}`);
}

let sequence = 0;

/**
 * เลขบัตรสมมติที่ checksum ถูก — ไม่ส่ง n = ลำดับถัดไป (ไม่ซ้ำกันภายในไฟล์เทสต์)
 * รูปแบบ 1 99nn nnnnn nn c · n อยู่ในช่วง 0–999,999,999
 */
export function syntheticNationalId(n: number = ++sequence): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new RangeError(`n นอกช่วง: ${n}`);
  return withCheckDigit(`1${SYNTHETIC_OFFICE}${String(n).padStart(9, "0")}`);
}

/**
 * เลขสมมติอีกเลขที่มาสก์ออกมาเหมือนเลขเดิม (หลักแรก + 3 หลักท้ายตรงกัน) — ใช้พิสูจน์ว่า audit ไม่พึ่งค่าที่มาสก์แล้ว
 * หลัก 4–10 ไล่ค่าไปเรื่อย ๆ จนหลักตรวจออกมาตรงกับของเดิม
 */
export function syntheticSameMask(nationalId: string): string {
  const id = normalizeNationalId(nationalId);
  if (!isValidNationalId(id)) throw new Error(`ไม่ใช่เลขบัตรที่ถูกต้อง: ${nationalId}`);
  for (let n = 0; n < 10_000_000; n++) {
    const candidate = withCheckDigit(`${id[0]}${SYNTHETIC_OFFICE}${String(n).padStart(7, "0")}${id.slice(10, 12)}`);
    if (candidate !== id && candidate[12] === id[12]) return candidate;
  }
  throw new Error(`หาเลขที่มาสก์ซ้ำไม่ได้: ${nationalId}`);
}

/** รูปแบบหน้าบัตร: "1 9900 00000 12 3" (sep = " ") หรือ "1-9900-00000-12-3" (sep = "-") */
export function cardFormat(nationalId: string, sep: " " | "-" = " "): string {
  const id = normalizeNationalId(nationalId);
  return [id.slice(0, 1), id.slice(1, 5), id.slice(5, 10), id.slice(10, 12), id.slice(12)].join(sep);
}
