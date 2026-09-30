import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useIsBlocking } from "@/lib/blocking";
import { hasOpenLayer, isSearchShortcut } from "@/lib/hotkeys";
import { notifyError } from "@/lib/notify";
import type { Me } from "@/lib/queries";
import { hasUnsavedChanges, isSavingInProgress } from "@/lib/unsaved-changes";

/** ปลายทางที่เลือกจากหน้าค้นหา — หน้าค้นหาสร้าง · hook นี้ตัดสินว่าไปได้ไหม */
export interface SearchDestination {
  /** pathname ปลายทาง — ตรงกับหน้าที่เปิดอยู่ (และไม่มีตัวกรอง) = แค่ปิดหน้าค้นหา */
  path: string;
  /** ชื่อปลายทางในกล่องยืนยัน "ข้อมูลยังไม่ได้บันทึก" */
  label: string;
  /** มีตัวกรองใน URL (ดูทั้งหมด) — ไปแม้เป็นหน้าเดียวกับที่เปิดอยู่ */
  withSearch?: boolean;
  go: () => Promise<void>;
}

/** เหตุที่ปิด — ตัดสินว่าโฟกัสไปไหนต่อ */
type CloseReason = "dismiss" | "navigate" | "confirm";

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path);

/** ที่เดิมหายไปแล้ว (ปุ่มค้นหาใน sheet มือถือที่ปิดไป · ช่องของหน้าที่ถูกแทน) — ปุ่มค้นหา · ปุ่มเมนูมือถือ · เนื้อหาหลัก */
const FALLBACK_FOCUS = ["[data-search-trigger]", '[data-sidebar="trigger"]', "#main"] as const;

function focusFallback(): void {
  for (const selector of FALLBACK_FOCUS) {
    const target = document.querySelector<HTMLElement>(selector);
    // ซ่อนอยู่ (display:none) โฟกัสไม่ได้ — ลองตัวถัดไป
    target?.focus({ preventScroll: true });
    if (target && document.activeElement === target) return;
  }
}

/**
 * หน้าค้นหา (Ctrl/⌘+K) — ใช้ที่ AppSidebar ครั้งเดียว (นอก sheet ของมือถือ ปุ่มลัดจึงทำงานตอน sheet ปิด)
 * - ปุ่มลัด: `event.code` KeyK + Ctrl/⌘ (แป้นไทยได้) · ทำงานแม้โฟกัสอยู่ในช่องกรอก (Ctrl/⌘+K ไม่มีความหมายในช่องของแอป)
 *   · กดซ้ำขณะเปิด = ปิด · ไม่เปิดทับชั้นอื่น (กล่องยืนยัน · เมนู · sheet · ชั้นบังหน้าจอ)
 * - **ไม่มีปุ่มลัด "/" แบบ GitHub/YouTube โดยตั้งใจ** — เครื่องอ่านบัตร Siam ID พิมพ์ข้อมูลเข้าเหมือนแป้นพิมพ์ รวม "/" ในวันที่
 *   (01/01/2565) ถ้าโฟกัสหลุดจากช่องตอนเสียบบัตร "/" ตัวแรกจะเปิดหน้าค้นหาแล้วกลืนข้อมูลบัตรที่เหลือเข้าช่องค้นแทน
 * - สาขาเปลี่ยนระหว่างเปิด = ปิดเอง (ผลของสาขาเดิมไม่ค้างบนจอ · key ของ query มี id สาขาอยู่แล้ว)
 * - เลือกผล: หน้าเดิม = ปิดเฉย ๆ · กำลังบันทึก = ไม่ไป + แจ้งให้รอ · ฟอร์มยังไม่บันทึก = ถามยืนยันก่อน
 * - ปิดแล้วคืนโฟกัสที่เดิม (เปิดด้วยปุ่มลัดไม่มีปุ่มเปิดให้ Radix คืนให้) · ไปหน้าใหม่ = ให้หน้าใหม่จัดโฟกัส ไม่มีก็ไปเนื้อหาหลัก
 */
export function useCommandSearch(me: Me) {
  const { t } = useTranslation("shell");
  const router = useRouter();
  const queryClient = useQueryClient();
  const blocking = useIsBlocking();
  const branchId = me.branch?.id ?? null;

  /** สาขาตอนเปิด — undefined = ปิดอยู่ */
  const [openedFor, setOpenedFor] = useState<string | null | undefined>(undefined);
  if (openedFor !== undefined && openedFor !== branchId) setOpenedFor(undefined);
  const open = openedFor !== undefined && openedFor === branchId;
  /**
   * นับการเปิด — หน้าค้นหาใช้เป็น key: เปิดใหม่ระหว่างท่าปิด (~200 ms หลังเลือกผล) ได้หน้าใหม่ช่องว่าง
   * ไม่ใช่ตัวเดิมที่กำลังปิดซึ่งยังมีคำค้นเก่า (อาจเป็นเลขบัตร) ค้างอยู่
   */
  const [session, setSession] = useState(0);
  const [confirming, setConfirming] = useState<SearchDestination | null>(null);

  /** element ที่โฟกัสอยู่ก่อนเปิด */
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeReason = useRef<CloseReason>("dismiss");
  /** แจ้งเตือนที่รอหน้าค้นหาปิดสนิทก่อน — ระหว่างเปิด Radix ซ่อนส่วนอื่น (รวม toast) จาก screen reader */
  const pendingNotice = useRef<(() => void) | null>(null);

  function show() {
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    closeReason.current = "dismiss";
    setSession((count) => count + 1);
    setOpenedFor(branchId);
  }

  function close(reason: CloseReason = "dismiss") {
    closeReason.current = reason;
    setOpenedFor(undefined);
  }

  const onShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (!isSearchShortcut(event) || event.defaultPrevented) return;
    if (open) {
      event.preventDefault();
      close();
      return;
    }
    if (blocking || hasOpenLayer()) return;
    // ไม่ให้ browser เอาไปใช้ (Ctrl+K = ช่องค้นหาของ browser)
    event.preventDefault();
    show();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onShortcut(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  function select(destination: SearchDestination) {
    const here = trimSlash(router.state.location.pathname);
    if (!destination.withSearch && here === trimSlash(destination.path)) {
      close();
      return;
    }
    // บันทึกค้างอยู่ (รวมช่วงลองซ้ำ) — ออกไปตอนนี้ไม่รู้ผลการบันทึก และหน้าบันทึกอาจพาย้อนกลับมาเองเมื่อเสร็จ
    if (queryClient.isMutating() > 0 || isSavingInProgress()) {
      pendingNotice.current = () => notifyError(t("search.savingWait"), { id: "command-search" });
      close();
      return;
    }
    if (hasUnsavedChanges()) {
      close("confirm");
      setConfirming(destination);
      return;
    }
    close("navigate");
    void destination.go();
  }

  function confirmLeave() {
    const destination = confirming;
    closeReason.current = "navigate";
    setConfirming(null);
    if (destination) void destination.go();
  }

  /** "อยู่ต่อ" / Esc — Radix เรียกซ้ำหลังปุ่ม "ไปต่อ" ด้วย จึงไม่ทับเหตุ navigate */
  function dismissLeave() {
    if (closeReason.current !== "navigate") closeReason.current = "dismiss";
    setConfirming(null);
  }

  /** onCloseAutoFocus ของหน้าค้นหาและกล่องยืนยัน — Radix เรียกหลังชั้นนั้นหายจาก DOM แล้ว */
  function restoreFocus(event: Event) {
    event.preventDefault();
    const notice = pendingNotice.current;
    pendingNotice.current = null;
    // กล่องยืนยันกำลังเปิดต่อ — มันจัดโฟกัสเอง ("อยู่ต่อ")
    if (closeReason.current === "confirm") return;
    const active = document.activeElement;
    // ที่อื่นรับโฟกัสไปแล้ว (หน้าปลายทาง autoFocus · ชั้นใหม่) — ไม่แย่ง
    if (!active || active === document.body) {
      if (closeReason.current === "navigate") {
        document.getElementById("main")?.focus({ preventScroll: true });
      } else {
        const previous = returnFocus.current;
        if (previous?.isConnected) previous.focus();
        if (!previous || document.activeElement !== previous) focusFallback();
      }
    }
    notice?.();
  }

  return { open, session, show, close, select, confirming, confirmLeave, dismissLeave, restoreFocus };
}

export type CommandSearchState = ReturnType<typeof useCommandSearch>;
