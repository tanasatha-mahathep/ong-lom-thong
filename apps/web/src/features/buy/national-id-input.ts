/** กลุ่มตัวเลขแบบหน้าบัตรประชาชน 1-4-5-2-1 */
const GROUPS = [1, 4, 5, 2, 1] as const;
export const NATIONAL_ID_DIGITS = 13;

const onlyDigits = (text: string) => text.replace(/\D/g, "");

/**
 * ข้อความในช่องเลขบัตรขณะพิมพ์ → ตัวเลขล้วนไม่เกิน 13 หลัก จัดกลุ่มแบบหน้าบัตรทีละกลุ่ม
 * "1103700" → "1 1037 00" · "1-1037-00123-45-8" → "1 1037 00123 45 8" · ไม่มีช่องว่างค้างท้าย (Backspace ท้ายช่องลบตัวเลขเสมอ)
 * เจ้าของขอ 3 ต.ค. 2569 — ตัวรับ Siam ID (use-siam-id-capture) นับเฉพาะตัวเลข จึงไม่กระทบการเสียบบัตร
 */
export function formatNationalIdInput(text: string): string {
  const digits = onlyDigits(text).slice(0, NATIONAL_ID_DIGITS);
  const parts: string[] = [];
  let at = 0;
  for (const size of GROUPS) {
    if (at >= digits.length) break;
    parts.push(digits.slice(at, at + size));
    at += size;
  }
  return parts.join(" ");
}

/** จำนวนตัวเลขทางซ้ายของตำแหน่ง pos — จำตำแหน่งเคอร์เซอร์ข้ามการจัดกลุ่มใหม่ */
export const digitsBefore = (text: string, pos: number) => onlyDigits(text.slice(0, pos)).length;

/** ตำแหน่งเคอร์เซอร์ในข้อความที่จัดกลุ่มแล้ว: หลังตัวเลขตัวที่ n (0 = ต้นช่อง · เกินจำนวนตัวเลข = ท้ายช่อง) */
export function caretAfterDigits(formatted: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted.charAt(i)) && ++seen === n) return i + 1;
  }
  return formatted.length;
}

/**
 * Backspace/Delete ที่ติดช่องว่างคั่นกลุ่ม — ลบตัวเลขข้างช่องว่างแทน (ไม่งั้นลบแล้วจัดกลุ่มกลับเป็นเหมือนเดิม ดูเหมือนปุ่มไม่ทำงาน)
 * คืนข้อความใหม่ + จำนวนตัวเลขก่อนเคอร์เซอร์ หรือ null เมื่อไม่ใช่กรณีนี้ (ให้เบราว์เซอร์ลบตามปกติ)
 */
export function deleteAcrossSeparator(
  text: string,
  caret: number,
  key: "Backspace" | "Delete",
): { text: string; digitsBeforeCaret: number } | null {
  const separator = key === "Backspace" ? text.charAt(caret - 1) : text.charAt(caret);
  if (separator !== " ") return null;
  const digits = onlyDigits(text);
  const before = digitsBefore(text, caret);
  const removeAt = key === "Backspace" ? before - 1 : before;
  if (removeAt < 0 || removeAt >= digits.length) return null;
  return {
    text: formatNationalIdInput(digits.slice(0, removeAt) + digits.slice(removeAt + 1)),
    digitsBeforeCaret: removeAt,
  };
}
