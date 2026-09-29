import { type NavigateOptions, useNavigate } from "@tanstack/react-router";
import { useCallback, useSyncExternalStore } from "react";
import { page } from "@/lib/app-update";

/**
 * ชั้นบังหน้าจอ "กำลังทำงาน…" (U6) — แสดงเมื่อแอปพาไปหน้าอื่น/โหลดใหม่ **หลังการกระทำ**
 * (บันทึกแล้วไปใบรับซื้อ · login แล้วเข้าหน้าแรก · สลับสาขาแล้ว reload) ไม่ใช่ทุกครั้งที่กดเมนู
 * ระหว่างนั้นกดอะไรไม่ได้ (เมาส์ + คีย์บอร์ด) — กันกดซ้ำ/พิมพ์ลงหน้าที่กำลังจะหายไป
 * ตัวแสดงผลคือ `<BlockingOverlay />` ใน routes/__root.tsx
 */

let depth = 0;
const listeners = new Set<() => void>();

function setDepth(next: number) {
  depth = Math.max(0, next);
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** เริ่มบังหน้าจอ — คืนฟังก์ชันเลิกบัง (เรียกซ้ำได้ ไม่นับซ้อน) */
export function beginBlocking(): () => void {
  setDepth(depth + 1);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    setDepth(depth - 1);
  };
}

/** บังหน้าจอระหว่างรอ `fn` (สำเร็จหรือพังก็เลิกบัง) */
export async function runBlocking<T>(fn: () => Promise<T> | T): Promise<T> {
  const end = beginBlocking();
  try {
    return await fn();
  } finally {
    end();
  }
}

/** บังหน้าจอแล้ว reload ทั้งหน้า (เช่น หลังสลับสาขา) — ไม่เลิกบัง เพราะหน้าจะโหลดใหม่ */
export function reloadBlocking(): void {
  beginBlocking();
  page.reload();
}

export function useIsBlocking(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => depth > 0,
    () => false,
  );
}

/**
 * `navigate()` ของ TanStack Router ที่บังหน้าจอจนหน้าปลายทางโหลดเสร็จ (loader ครบ)
 * ใช้หลังการกระทำเท่านั้น (บันทึก · login) — ลิงก์เมนูธรรมดาใช้ `<Link>` ตามเดิม
 */
export function useBlockingNavigate(): (options: NavigateOptions) => Promise<void> {
  const navigate = useNavigate();
  return useCallback((options: NavigateOptions) => runBlocking(() => navigate(options)), [navigate]);
}

/** เทสต์เท่านั้น — ล้างสถานะที่ค้างจากเทสต์ก่อน (เรียกใน src/test/setup.ts) */
export function resetBlocking(): void {
  setDepth(0);
}
