import { type NavigateOptions, useNavigate } from "@tanstack/react-router";
import { useCallback, useSyncExternalStore } from "react";
import i18next from "@/i18n";
import { page } from "@/lib/app-update";
import { notifyError } from "@/lib/notify";

/**
 * ชั้นบังหน้าจอ "กำลังทำงาน…" (U6) — แสดงเมื่อแอปพาไปหน้าอื่น/โหลดใหม่ **หลังการกระทำ**
 * (บันทึกแล้วไปใบรับซื้อ · login แล้วเข้าหน้าหลัก · สลับสาขาแล้ว reload) ไม่ใช่ทุกครั้งที่กดเมนู
 * ระหว่างนั้นกดอะไรไม่ได้ (เมาส์ + คีย์บอร์ด) — กันกดซ้ำ/พิมพ์ลงหน้าที่กำลังจะหายไป
 * ตัวแสดงผลคือ `<BlockingOverlay />` ใน routes/__root.tsx
 *
 * ไม่มีทางค้างตลอดไป: บังนานเกิน `BLOCKING_WATCHDOG_MS` (loader ค้าง — apiFetch ไม่มี timeout · navigation
 * ถูกยกเลิกแล้ว promise ไม่ resolve) → เลิกบังเอง + toast error · reload ที่ถูกยกเลิก (ยืนยันออกจากหน้าแล้วกด
 * "อยู่ต่อ") → เลิกบังหลัง `UNLOAD_GRACE_MS` ถ้าหน้ายังอยู่
 */

/** บังได้นานสุดก่อนถือว่าค้าง */
export const BLOCKING_WATCHDOG_MS = 25_000;
/** รอ browser ออกจากหน้า (reload / ไปเว็บอื่น) — เกินนี้แล้วหน้ายังอยู่ = ถูกยกเลิก */
export const UNLOAD_GRACE_MS = 5_000;

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

/** ตัวจับเวลาของการบังที่ยังไม่จบ — ล้างทิ้งตอน reset (เทสต์) */
const timers = new Set<ReturnType<typeof setTimeout>>();

/**
 * เริ่มบังหน้าจอ — คืนฟังก์ชันเลิกบัง (เรียกซ้ำได้ ไม่นับซ้อน)
 * `timeoutMs` เกินแล้วยังไม่เลิก = เลิกเอง · `onTimeout` เรียกตอนนั้น (ค่าเริ่มต้น toast error)
 */
export function beginBlocking({
  timeoutMs = BLOCKING_WATCHDOG_MS,
  onTimeout = notifyTimeout,
}: { timeoutMs?: number; onTimeout?: () => void } = {}): () => void {
  setDepth(depth + 1);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    timers.delete(timer);
    setDepth(depth - 1);
  };
  const timer = setTimeout(() => {
    if (ended) return;
    end();
    onTimeout();
  }, timeoutMs);
  timers.add(timer);
  return end;
}

function notifyTimeout() {
  notifyError(i18next.t("blockingTimeout", { ns: "common" }), { id: "blocking-timeout" });
}

/** บังหน้าจอระหว่างรอ `fn` (สำเร็จหรือพังก็เลิกบัง · ค้างเกิน watchdog ก็เลิกบัง) */
export async function runBlocking<T>(fn: () => Promise<T> | T): Promise<T> {
  const end = beginBlocking();
  try {
    return await fn();
  } finally {
    end();
  }
}

/**
 * บังหน้าจอจน browser ออกจากหน้านี้ (reload · ไปเว็บอื่น) — ออกจริงแล้วหน้าหายไปเอง
 * ยังอยู่หลัง `UNLOAD_GRACE_MS` = ถูกยกเลิก (beforeunload "อยู่ต่อ") → เลิกบังเงียบ ๆ ให้ทำงานต่อได้
 */
function blockUntilUnload(): void {
  beginBlocking({ timeoutMs: UNLOAD_GRACE_MS, onTimeout: () => undefined });
}

/** บังหน้าจอแล้ว reload ทั้งหน้า (เช่น หลังสลับสาขา) */
export function reloadBlocking(): void {
  blockUntilUnload();
  page.reload();
}

export function useIsBlocking(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => depth > 0,
    () => false,
  );
}

/** นำทางแบบโหลดทั้งหน้า (`reloadDocument`) หรือไป origin อื่น — promise จบก่อนหน้าหายจริง */
function leavesDocument(options: NavigateOptions): boolean {
  if (options.reloadDocument) return true;
  const { href } = options;
  if (typeof href !== "string") return false;
  try {
    return new URL(href, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * นำทางด้วย `navigate` ที่ให้มา พร้อมบังหน้าจอจนหน้าปลายทางโหลดเสร็จ (loader ครบ) — ตัวจริงของ
 * `useBlockingNavigate` (แยกออกมาให้เทสต์ส่ง navigate ปลอมได้)
 * โหลดทั้งหน้า/ไปเว็บอื่น = บังต่อจนหน้าหาย (ไม่เลิกบังตอน promise จบ)
 */
export function blockingNavigate(
  navigate: (options: NavigateOptions) => Promise<void>,
  options: NavigateOptions,
): Promise<void> {
  if (!leavesDocument(options)) return runBlocking(() => navigate(options));
  blockUntilUnload();
  return navigate(options);
}

/**
 * `navigate()` ของ TanStack Router ที่บังหน้าจอจนหน้าปลายทางโหลดเสร็จ
 * ใช้หลังการกระทำเท่านั้น (บันทึก · login) — ลิงก์เมนูธรรมดาใช้ `<Link>` ตามเดิม
 */
export function useBlockingNavigate(): (options: NavigateOptions) => Promise<void> {
  const navigate = useNavigate();
  return useCallback((options: NavigateOptions) => blockingNavigate(navigate, options), [navigate]);
}

/** เทสต์เท่านั้น — ล้างสถานะที่ค้างจากเทสต์ก่อน (เรียกใน src/test/setup.ts) */
export function resetBlocking(): void {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  setDepth(0);
}
