/**
 * อักขระควบคุม C0 (U+0000–U+001F) ยกเว้น tab · newline · CR — ไม่มีที่ใช้ในข้อความที่คนพิมพ์
 * และ \u0000 ทำให้ Postgres ปฏิเสธทั้ง text และ jsonb (กลายเป็น 500) → ปฏิเสธตั้งแต่ตรวจ input (400 ชี้ช่อง)
 */
export function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  }
  return false;
}

export const noControlChars = (s: string) => !hasControlChars(s);
export const CONTROL_CHARS_MSG = "มีอักขระที่ใช้ไม่ได้ (อักขระควบคุม)";
