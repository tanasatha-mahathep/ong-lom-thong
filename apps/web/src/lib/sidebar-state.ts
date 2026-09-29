/**
 * sidebar ย่อ/ขยาย — `SidebarProvider` (components/ui/sidebar.tsx) เขียน cookie `sidebar_state` ทุกครั้งที่สลับ
 * แต่ไม่อ่านกลับ (ของ shadcn ให้ server อ่าน) · SPA อ่านเองตอนเปิดแอป ให้ย่อค้างไว้ข้ามการโหลดหน้า
 */
export const SIDEBAR_COOKIE_NAME = "sidebar_state";

export function readSidebarOpen(): boolean {
  try {
    const match = new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE_NAME}=([^;]*)`).exec(document.cookie);
    return match?.[1] !== "false";
  } catch {
    return true;
  }
}
