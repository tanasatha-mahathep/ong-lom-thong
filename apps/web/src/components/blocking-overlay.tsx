import { LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useIsBlocking } from "@/lib/blocking";

/**
 * ชั้นบังทั้งจอ (U6) — วางครั้งเดียวใน routes/__root.tsx · เปิด/ปิดด้วย `runBlocking` / `useBlockingNavigate`
 * / `reloadBlocking` จาก lib/blocking.ts
 */
export function BlockingOverlay() {
  const active = useIsBlocking();
  if (!active || typeof document === "undefined") return null;
  return createPortal(<BlockingLayer />, document.body);
}

/** ปุ่มที่ยังให้ผ่านได้: รีโหลดหน้า (F5 · Ctrl/⌘+R) — ทางออกถ้าค้างนานผิดปกติ */
const isReloadKey = (event: KeyboardEvent) =>
  event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");

function BlockingLayer() {
  const { t } = useTranslation("common");
  const labelId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // ทุกอย่างนอกชั้นนี้ inert = คลิก/โฟกัส/อ่านด้วย screen reader ไม่ได้ (browser จริง)
    // ยกเว้น toaster (portal ที่ body) — aria-live ต้องประกาศ toast "บันทึกแล้ว" ระหว่างพาไปหน้าถัดไป
    const outside = [...document.body.children].filter(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        !el.contains(layer) &&
        !el.hasAttribute("inert") &&
        !el.matches('[data-slot="toaster-host"]'),
    );
    for (const el of outside) el.setAttribute("inert", "");
    layer.focus();

    // กันคีย์บอร์ดทุกปุ่ม (Tab · Enter · Ctrl+Enter · Esc) ไม่ให้ถึงหน้าข้างใต้ — โฟกัสอยู่ที่ชั้นนี้
    const onKeyDown = (event: KeyboardEvent) => {
      if (isReloadKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      layer.focus();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !layer.contains(event.target)) layer.focus();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn, true);
      for (const el of outside) el.removeAttribute("inert");
      // ไม่ได้ไปหน้าอื่น (เช่น นำทางไม่สำเร็จ) → คืนโฟกัสที่เดิม · ไปหน้าใหม่แล้ว หน้าใหม่จัดโฟกัสเอง
      if (previous?.isConnected && (document.activeElement === layer || document.activeElement === document.body)) {
        previous.focus();
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-busy="true"
      aria-labelledby={labelId}
      tabIndex={-1}
      data-slot="blocking-overlay"
      className="fixed inset-0 z-[100] flex cursor-wait items-center justify-center bg-background/70 outline-none motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200"
    >
      <div
        role="status"
        className="flex items-center gap-3 rounded-lg border bg-card px-6 py-4 text-card-foreground shadow-lg"
      >
        <LoaderCircle className="size-5 text-primary motion-safe:animate-spin" aria-hidden="true" />
        <span id={labelId} className="text-base font-medium">
          {t("blocking")}
        </span>
      </div>
    </div>
  );
}
