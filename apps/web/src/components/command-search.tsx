import { Search } from "lucide-react";
import { Component, type KeyboardEvent, type ReactNode, Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Kbd } from "@/components/ui/kbd";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import type { CommandSearchState } from "@/hooks/use-command-search";
import { isChunkLoadError, showUpdateToast } from "@/lib/app-update";
import { isApplePlatform } from "@/lib/hotkeys";
import { notifyError } from "@/lib/notify";
import type { Me } from "@/lib/queries";

/** ตัวหน้าค้นหา (cmdk + ผลค้น) แยก chunk — โหลดเมื่อจะใช้: ชี้/โฟกัสปุ่มค้นหา · เครื่องว่าง · กดเปิด */
const loadPalette = () => import("@/components/command-palette");
const CommandPalette = lazy(async () => ({ default: (await loadPalette()).CommandPalette }));

/** โหลดไว้ก่อนกด — ล้มไม่เป็นไร (ตอนเปิดจริงค่อยแจ้ง) */
function prefetchPalette() {
  loadPalette().catch(() => undefined);
}

/** เครื่องว่างหลังเปิดแอปแล้วค่อยโหลด — Safari ไม่มี requestIdleCallback ใช้ตัวจับเวลาแทน */
const IDLE_TIMEOUT_MS = 10_000;
const IDLE_FALLBACK_MS = 3_000;

/**
 * ปุ่มค้นหาใต้ตัวเลือกสาขา (แบบช่องค้นของ sidebar-01 แต่เป็นปุ่มเปิดหน้าค้นหา ไม่ใช่ช่องกรอกจริง)
 * ป้ายปุ่มลัดตามเครื่อง (⌘K / Ctrl K) · แถบไอคอนตอนย่อเหลือไอคอน + tooltip · มือถือ: ปิด sheet เมนูก่อนเปิดหน้าค้นหา
 */
export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation("shell");
  const { isMobile, setOpenMobile } = useSidebar();
  const [apple] = useState(isApplePlatform);
  const shortcut = t(apple ? "search.shortcutApple" : "search.shortcutOther");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          variant="outline"
          data-search-trigger=""
          tooltip={t("search.tooltip", { shortcut })}
          aria-haspopup="dialog"
          aria-keyshortcuts="Control+K Meta+K"
          className="text-muted-foreground"
          onPointerEnter={prefetchPalette}
          onFocus={prefetchPalette}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
            onOpen();
          }}
        >
          <Search aria-hidden="true" />
          <span className="truncate">{t("search.trigger")}</span>
          {/* มือถือ (sheet) ไม่มีแป้นพิมพ์ — ไม่แสดงป้ายปุ่มลัด · ตัวอักษรเข้มกว่าค่าเริ่มต้นของ Kbd (muted-foreground บน muted
              ได้ 4.3:1 ในธีมสว่าง ต่ำกว่า AA) */}
          {!isMobile && (
            <Kbd aria-hidden="true" className="ml-auto text-foreground/80 group-data-[collapsible=icon]:hidden">
              {shortcut}
            </Kbd>
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/** chunk ของหน้าค้นหาโหลดไม่ได้ (deploy ใหม่ระหว่างเปิดแท็บ · เน็ตหลุด) — แจ้งแล้วปิด ไม่ให้ทั้งหน้าพังไปด้วย */
class PaletteBoundary extends Component<
  { children: ReactNode; onError: (error: unknown) => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    this.props.onError(error);
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * หน้าค้นหา + กล่องยืนยันก่อนออกจากฟอร์มที่ยังไม่บันทึก — วางนอก <Sidebar> (sheet มือถือ unmount ตอนปิด)
 * ตัวหน้าค้นหาโหลดแบบ lazy ครั้งแรกที่เปิด แล้วค้างไว้ (Radix เล่นท่าปิดและคืนโฟกัสได้)
 */
export function CommandSearch({ state, me }: { state: CommandSearchState; me: Me }) {
  const { t } = useTranslation("shell");
  const [used, setUsed] = useState(false);
  if (state.open && !used) setUsed(true);

  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(prefetchPalette, { timeout: IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(prefetchPalette, IDLE_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);

  const onLoadError = (error: unknown) => {
    // เปิดใหม่ครั้งหน้าได้ boundary ใหม่ (ลองโหลดอีกครั้ง)
    setUsed(false);
    state.close();
    if (isChunkLoadError(error)) showUpdateToast();
    else notifyError(t("search.loadFailed"), { id: "command-search" });
  };

  return (
    <>
      {used && (
        <PaletteBoundary onError={onLoadError}>
          <Suspense fallback={null}>
            <CommandPalette state={state} me={me} />
          </Suspense>
        </PaletteBoundary>
      )}
      <SearchLeaveConfirm state={state} />
    </>
  );
}

/** Enter ในกล่องยืนยันเป็นของกล่องเท่านั้น — Ctrl+Enter ต้องไม่ถึงปุ่มลัดบันทึกของฟอร์มข้างหลัง */
const keepEnterInside = (event: KeyboardEvent) => {
  if (event.key === "Enter") event.stopPropagation();
};

/** เลือกผลค้นทั้งที่ฟอร์มยังไม่บันทึก — ปุ่มแรกที่ได้โฟกัสคือ "อยู่ต่อ" (Enter พลาดไม่ทิ้งข้อมูล) */
function SearchLeaveConfirm({ state }: { state: CommandSearchState }) {
  const { t } = useTranslation("shell");
  const target = state.confirming;
  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && state.dismissLeave()}>
      <AlertDialogContent onCloseAutoFocus={state.restoreFocus} onKeyDown={keepEnterInside}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("search.leaveTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("search.leaveBody", { name: target?.label ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("search.leaveStay")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={state.confirmLeave}>
            {t("search.leaveConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
