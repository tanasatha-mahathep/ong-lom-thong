// zod แบบไม่ใช้ eval เหมือนในแอป (main.tsx import เป็นบรรทัดแรก)
import "@/lib/zod-config";
import "@testing-library/jest-dom/vitest";
// i18n ตัวเดียวกับแอป (ภาษาไทย) — component ที่ใช้ useTranslation ได้ข้อความจริงแม้ render เดี่ยว ๆ
import "@/i18n";
import { cleanup, configure } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, vi } from "vitest";
import { resetBlocking } from "@/lib/blocking";
import { resetUnsavedChanges } from "@/lib/unsaved-changes";

// เทสต์ทั้งแอปรอ router + query หลายชั้น — เครื่องที่รัน make check ของหลายเอเจนต์พร้อมกัน (load 70+)
// ใช้เวลาเกิน 3 วินาทีได้ · เทสต์ที่พังจริงยังพังเหมือนเดิม แค่รอนานขึ้นก่อนรายงาน
configure({ asyncUtilTimeout: 10_000 });

// ไม่ได้เปิด globals ของ vitest — Testing Library จึงไม่ cleanup ให้เอง
afterEach(() => {
  cleanup();
  // sonner เก็บ toast ไว้ใน store ระดับโมดูลและ replay ให้ Toaster ที่ mount ใหม่ — ปิดทิ้งไม่ให้ค้างไปเทสต์ถัดไป
  toast.dismiss();
  // ชั้นบังหน้าจอ (lib/blocking.ts) เป็น store ระดับโมดูล — ไม่ให้ค้างไปเทสต์ถัดไป
  resetBlocking();
  resetUnsavedChanges();
  // ธีม/ภาษาที่เทสต์ก่อนหน้าตั้งไว้ไม่ค้างมาเทสต์ถัดไป
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.classList.remove("dark");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// API ของ browser ที่ jsdom ไม่มี แต่ Radix / sidebar ใช้
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) satisfies MediaQueryList,
  });
}
if (typeof window.ResizeObserver !== "function") {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
}
function stubMissing(target: object, key: string, value: unknown) {
  if (!(key in target)) Object.defineProperty(target, key, { configurable: true, writable: true, value });
}
stubMissing(Element.prototype, "scrollIntoView", () => undefined);
stubMissing(Element.prototype, "hasPointerCapture", () => false);
stubMissing(Element.prototype, "releasePointerCapture", () => undefined);
stubMissing(Element.prototype, "setPointerCapture", () => undefined);
// router คืนตำแหน่ง scroll เอง — scrollTo ของ jsdom แค่พิมพ์ "not implemented"
window.scrollTo = () => undefined;
