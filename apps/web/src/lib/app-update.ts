import { toast } from "sonner";
import i18next from "@/i18n";

/**
 * deploy ใหม่แล้ว chunk ของ build เก่าหาย (api ตอบ 404 · assets มี hash) — แท็บที่เปิดค้างไว้โหลดหน้าใหม่ไม่ได้
 * เจอตอนเปลี่ยนหน้า → reload ให้เองหนึ่งครั้ง · เจออีก/เจอตอน preload → ถามผู้ใช้ด้วยปุ่ม "รีเฟรช"
 */

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** กัน reload วน: reload เองได้ครั้งเดียวในช่วงนี้ต่อแท็บ */
const RELOAD_GUARD_MS = 10 * 60_000;
const RELOAD_KEY = "ong.update-reload-at";

/** reload ผ่านตัวนี้เท่านั้น — เทสต์แทนได้ (jsdom ห้ามแก้ location.reload) */
export const page = { reload: () => window.location.reload() };

/** error จาก import() ของ chunk ที่ไม่มีแล้ว (ข้อความของ Chrome · Firefox · Safari · Vite) */
export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_ERROR.test(error.message);
}

/** reload เองถ้ายังไม่ได้ทำใน 10 นาทีที่ผ่านมา — คืน true ถ้ากำลัง reload */
export function reloadOnceForUpdate(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (now - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // sessionStorage ใช้ไม่ได้ = ไม่รู้ว่าเคย reload หรือยัง → ไม่ reload เอง ให้ผู้ใช้กด
    return false;
  }
  page.reload();
  return true;
}

/** แจ้งแบบไม่บังคับ — ทำงานต่อได้ กด "รีเฟรช" เมื่อพร้อม */
export function showUpdateToast(): void {
  const t = i18next.getFixedT(null, "shell");
  toast(t("update.message"), {
    id: "app-update",
    duration: Number.POSITIVE_INFINITY,
    action: { label: t("update.reload"), onClick: () => page.reload() },
  });
}

/** Vite ยิง `vite:preloadError` เมื่อโหลด chunk ไม่ได้ (รวมตอน preload ลิงก์ที่ชี้อยู่) */
export function listenForAppUpdates(): () => void {
  const onPreloadError = () => showUpdateToast();
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => window.removeEventListener("vite:preloadError", onPreloadError);
}
