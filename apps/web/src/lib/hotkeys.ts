/**
 * ปุ่มลัดระดับแอป (ใช้ร่วมกัน: สลับสาขา Alt+1…9) — อ่าน `event.code` (ตำแหน่งปุ่ม) ไม่ใช่ `event.key`:
 * แป้นภาษาไทยได้ key เป็นอักษรไทย แต่ code ยังเป็นตำแหน่งเดิม
 */

/**
 * ชั้นที่เปิดทับหน้าอยู่ (dialog แบบ aria-modal · alertdialog · เมนู · ชั้นบังหน้าจอ) — ปุ่มลัดสลับสาขาไม่ทำงาน
 * (สลับข้างหลังแล้ว remount จะทิ้งสิ่งที่แก้ในชั้นนั้น)
 */
export const OPEN_LAYER =
  '[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"], [data-slot="blocking-overlay"]';

/** ช่องที่กำลังพิมพ์ — ปุ่มลัดสลับสาขาไม่ทำงาน (Alt+ตัวเลขอาจเป็นการพิมพ์อักขระพิเศษของบางแป้นพิมพ์) */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select, [role='combobox'], [role='textbox']");
}
