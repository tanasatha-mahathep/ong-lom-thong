/**
 * รูปลูกค้า (ช่องที่ 9) — เกณฑ์เดียวกับ API (`apps/api/src/lib/image.ts`): JPEG · PNG · WebP ไม่เกิน 5 MB
 * API ตรวจจาก byte จริงอีกชั้น · ฝั่งนี้ตรวจก่อนส่งเพื่อบอกพนักงานทันทีด้วยข้อความเดียวกัน
 */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export const PHOTO_TYPE_MESSAGE = "รับเฉพาะรูป JPEG · PNG · WebP";
export const PHOTO_SIZE_MESSAGE = "รูปใหญ่เกิน 5 MB";
export const PHOTO_EMPTY_MESSAGE = "ไฟล์รูปว่างเปล่า — คัดลอกหรือเลือกรูปใหม่";

const isPhotoType = (type: string) => (PHOTO_TYPES as readonly string[]).includes(type);

/**
 * ปัญหาของไฟล์ที่จะใช้เป็นรูปลูกค้า (null = ใช้ได้)
 * ไฟล์ที่ browser ไม่รู้ชนิด (type ว่าง) ปล่อยให้ API ตัดสินจาก byte จริง
 */
export function photoProblem(file: File): string | null {
  if (file.type !== "" && !isPhotoType(file.type)) return PHOTO_TYPE_MESSAGE;
  if (file.size === 0) return PHOTO_EMPTY_MESSAGE;
  if (file.size > PHOTO_MAX_BYTES) return PHOTO_SIZE_MESSAGE;
  return null;
}

/**
 * ไฟล์จากการวาง (clipboardData) หรือการลากวาง (dataTransfer) — เลือกรูปก่อนเสมอ
 * Chrome ให้รูปจากคลิปบอร์ดเป็นไฟล์ image/png ทั้งใน `files` และ `items`
 * ไม่มีรูปแต่มีไฟล์อื่น (เช่น PDF) = คืนไฟล์นั้นให้ `photoProblem` บอกเหตุผล · ไม่มีไฟล์เลย = null
 */
export function imageFromDataTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;
  const fromItems = Array.from(data.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  const files = [...Array.from(data.files), ...fromItems];
  return files.find((file) => file.type.startsWith("image/")) ?? files[0] ?? null;
}

/** browser อ่านรูปจากคลิปบอร์ดผ่านปุ่มได้ (Chrome/Edge บน https หรือ localhost) */
export const canReadClipboard = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.clipboard?.read === "function";

/**
 * รูปแรกในคลิปบอร์ด (ปุ่ม "วางรูปจากคลิปบอร์ด" — สำหรับคนที่วางด้วยคลิกขวา ซึ่งกรอบรูปไม่มีเมนูให้)
 * ไม่มีรูป = null · ไม่ได้รับอนุญาตให้อ่านคลิปบอร์ด = throw (ผู้เรียกแจ้งให้ใช้ Ctrl+V แทน)
 */
export async function readClipboardImage(): Promise<File | null> {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return new File([await item.getType(type)], `clipboard.${type.slice("image/".length)}`, { type });
  }
  return null;
}
