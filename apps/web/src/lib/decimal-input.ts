/** ".5" — ผู้ใช้หมายถึง 0.5 */
const LEADING_POINT = /^\.\d+$/;
/** "5." — ผู้ใช้หมายถึง 5 */
const TRAILING_POINT = /^\d+\.$/;

/**
 * ข้อความตัวเลขที่ผู้ใช้พิมพ์ → ข้อความที่ส่ง API — จัดการเป็น string ล้วน ไม่แปลงเป็น number (CLAUDE.md กฎ 1)
 * API รับเฉพาะ "67850" · "67850.50" · "67,850" (คั่นหลักพันถูกตำแหน่ง) และปฏิเสธ ".5" / "5."
 * ที่นี่เติม/ตัดให้เฉพาะสองรูปนั้น (ความหมายชัด) และตัดช่องว่างหัวท้าย
 * รูปอื่นส่งตามที่พิมพ์ ให้ API ตอบ error ใต้ช่อง — ไม่เดาแทนเซิร์ฟเวอร์
 */
export function normalizeDecimalInput(text: string): string {
  const value = text.trim();
  if (LEADING_POINT.test(value)) return `0${value}`;
  if (TRAILING_POINT.test(value)) return value.slice(0, -1);
  return value;
}
