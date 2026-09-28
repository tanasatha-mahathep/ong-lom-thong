import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, vi } from "vitest";

// เทสต์ทั้งแอปรอ router + query หลายชั้น — เครื่องที่รัน make check ของหลายเอเจนต์พร้อมกัน (load 70+)
// ใช้เวลาเกิน 3 วินาทีได้ · เทสต์ที่พังจริงยังพังเหมือนเดิม แค่รอนานขึ้นก่อนรายงาน
configure({ asyncUtilTimeout: 10_000 });

// ไม่ได้เปิด globals ของ vitest — Testing Library จึงไม่ cleanup ให้เอง
afterEach(() => {
  cleanup();
  // toast ของ sonner อยู่ใน store กลางของ module — Toaster ของเทสต์ถัดไปจะเล่นซ้ำถ้าไม่ปิดทิ้ง
  toast.dismiss();
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
// router คืนตำแหน่ง scroll เอง — scrollTo ของ jsdom แค่พิมพ์ "not implemented"
window.scrollTo = () => undefined;
