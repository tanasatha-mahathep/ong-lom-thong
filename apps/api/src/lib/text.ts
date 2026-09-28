/**
 * อักขระควบคุม C0 (U+0000–U+001F) ยกเว้น tab · newline · CR — ไม่มีที่ใช้ในข้อความที่คนพิมพ์
 * และ \u0000 ทำให้ Postgres ปฏิเสธทั้ง text และ jsonb (กลายเป็น 500)
 */
export function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  }
  return false;
}

/** surrogate ที่ไม่มีคู่ (UTF-16 ไม่สมบูรณ์ เช่น "\uD800") — เทียบเท่า !s.isWellFormed() (ES2024) · jsonb ปฏิเสธ (500) */
const LONE_SURROGATE = /\p{Cs}/u;

/** ข้อความที่เก็บลง DB ได้: ไม่มีอักขระควบคุม และเป็น UTF-16 สมบูรณ์ — ใช้กับทุกช่องข้อความอิสระ (400 ชี้ช่อง) */
export const isCleanText = (s: string) => !hasControlChars(s) && !LONE_SURROGATE.test(s);
export const UNUSABLE_CHARS_MSG = "มีอักขระที่ใช้ไม่ได้";
