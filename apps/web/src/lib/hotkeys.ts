/**
 * ปุ่มลัดระดับแอป (ใช้ร่วมกัน: สลับสาขา Alt+1…9 · ค้นหา Ctrl/⌘+K) — อ่าน `event.code` (ตำแหน่งปุ่ม) ไม่ใช่ `event.key`:
 * แป้นภาษาไทยกดปุ่ม K ได้ key "า" แต่ code ยังเป็น "KeyK"
 */

/**
 * ชั้นที่เปิดทับหน้าอยู่ (dialog แบบ aria-modal · alertdialog · เมนู · ชั้นบังหน้าจอ) — ปุ่มลัดสลับสาขาไม่ทำงาน
 * (สลับข้างหลังแล้ว remount จะทิ้งสิ่งที่แก้ในชั้นนั้น)
 */
export const OPEN_LAYER =
  '[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"], [data-slot="blocking-overlay"]';

/**
 * OPEN_LAYER + dialog ทุกตัว — Dialog/Sheet ของ Radix ไม่ใส่ aria-modal (ซ่อนส่วนอื่นด้วย aria-hidden แทน)
 * จึงต้องนับ role="dialog" เองสำหรับปุ่มลัดที่เปิดชั้นใหม่ทับ (เช่น หน้าค้นหา) — ไม่เปิดซ้อนบน sheet เมนูมือถือหรือ dialog อื่น
 */
const ANY_LAYER = `${OPEN_LAYER}, [role="dialog"]`;

/** ช่องที่กำลังพิมพ์ — ปุ่มลัดสลับสาขาไม่ทำงาน (Alt+ตัวเลขอาจเป็นการพิมพ์อักขระพิเศษของบางแป้นพิมพ์) */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select, [role='combobox'], [role='textbox']");
}

/**
 * มีชั้น (dialog · alertdialog · เมนู · ชั้นบังหน้าจอ) เปิดอยู่ไหม — ไม่นับชั้นที่กำลังเล่นท่าปิด (data-state="closed")
 * และชั้นที่อยู่ใน `except` (เช่น หน้าค้นหาเอง)
 */
export function hasOpenLayer(except?: Element | null): boolean {
  return Array.from(document.querySelectorAll(ANY_LAYER)).some(
    (layer) => layer.getAttribute("data-state") !== "closed" && !except?.contains(layer),
  );
}

/**
 * Ctrl+K (Windows/Linux) · ⌘K (Mac) = เปิด/ปิดหน้าค้นหา — ปุ่ม K ตามตำแหน่ง (แป้นไทยก็ได้)
 * ไม่นับ Alt/Shift ร่วม (เป็นปุ่มลัดอื่น) · กดค้าง (repeat) · ระหว่างเรียบเรียงอักษรของ IME
 */
export function isSearchShortcut(event: KeyboardEvent): boolean {
  return (
    event.code === "KeyK" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    !event.isComposing
  );
}

/** ส่วนของ navigator ที่ใช้ — userAgentData (User-Agent Client Hints) มีเฉพาะ Chromium และยังไม่อยู่ใน lib.dom */
type PlatformSource = Pick<Navigator, "platform"> & { userAgentData?: { platform?: string } };

/**
 * เครื่องของ Apple (macOS · iPadOS · iOS) — ป้ายปุ่มลัดแสดง ⌘ แทน Ctrl
 * อ่านจาก Client Hints ก่อน แล้วค่อย `navigator.platform` (เลิกใช้แล้วแต่ยังมีทุก browser) · อ่านไม่ได้ = ไม่ใช่ Apple
 */
export function isApplePlatform(nav: PlatformSource | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const platform = nav.userAgentData?.platform ?? nav.platform;
  return /mac|iphone|ipad|ipod/i.test(platform);
}
