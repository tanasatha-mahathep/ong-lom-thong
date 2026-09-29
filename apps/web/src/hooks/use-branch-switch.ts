import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSidebar } from "@/components/ui/sidebar";
import { errorMessage } from "@/lib/api";
import { reloadBlocking, runBlocking, useIsBlocking } from "@/lib/blocking";
import { notifyError, notifySuccess } from "@/lib/notify";
import { type Branch, type Me, canSwitchBranch, meQueryOptions } from "@/lib/queries";
import { switchBranch } from "@/lib/session";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";

const ME_KEY = meQueryOptions.queryKey;

/** ช่องที่กำลังพิมพ์ — ปุ่มลัดไม่ทำงาน (Alt+ตัวเลขอาจเป็นการพิมพ์อักขระพิเศษของบางแป้นพิมพ์) */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select, [role='combobox'], [role='textbox']");
}

/** Alt+1…9 (แถวตัวเลขหรือ numpad) → 1…9 · ปุ่มอื่น = null */
export function branchShortcutIndex(event: KeyboardEvent): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) {
    return null;
  }
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
  return match ? Number(match[1]) : null;
}

/**
 * หน้าที่ผูกกับเอกสารของสาขา (มี path param เช่น /buy/$id · /customers/$id) → ปลายทางที่ปลอดภัยหลังสลับสาขา
 * (breadcrumb ก่อนหน้าที่เป็นลิงก์ หรือหน้าแรก) · หน้ารายการ/หน้าทั่วไป = อยู่หน้าเดิม (undefined)
 */
function safeDestination(router: ReturnType<typeof useRouter>) {
  const leaf = router.state.matches.at(-1);
  if (!leaf || Object.keys(leaf.params).length === 0) return undefined;
  const crumbs = leaf.staticData.crumbs ?? [];
  return crumbs.findLast((crumb) => crumb.to)?.to ?? "/";
}

/**
 * การสลับสาขา (fail-closed) — ใช้ที่ AppSidebar ครั้งเดียว (อยู่นอก sheet ของมือถือ ปุ่มลัดจึงทำงานตอนปิด sheet)
 * 1. ฟอร์มยังไม่บันทึก → ถามยืนยันก่อน (dialog ในหน้า)
 * 2. บังหน้าจอ → POST /api/me/branch · ล้มเหลว = toast error อยู่สาขาเดิม
 * 3. สำเร็จ: ทิ้ง cache ที่ไม่มีใครใช้ → ออกจากหน้าเอกสารของสาขาเดิม → ตั้งสาขาใหม่ใน me → reset ทุก query
 *    (ข้อมูลสาขาเดิมหายทันที) · หน้าใน <Outlet> mount ใหม่ตามสาขา (_app.tsx) ฟอร์มที่ค้างถูกล้าง
 */
export function useBranchSwitch(me: Me) {
  const { t } = useTranslation("shell");
  const queryClient = useQueryClient();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [confirming, setConfirming] = useState<Branch | null>(null);
  const busy = useRef(false);
  const mutation = useMutation({ mutationFn: switchBranch });

  async function perform(target: Branch) {
    if (busy.current) return;
    busy.current = true;
    try {
      await runBlocking(async () => {
        let next: Branch;
        try {
          next = await mutation.mutateAsync(target.id);
        } catch (error) {
          notifyError(t("branchSwitcher.failed", { reason: errorMessage(error) }), { id: "branch-switch" });
          return;
        }
        try {
          const notMe = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== ME_KEY[0] };
          // cache ของหน้าอื่นทิ้งเลย — หน้าปลายทางต้องโหลดจากสาขาใหม่ ไม่หยิบของสาขาเดิมมาแสดง
          queryClient.removeQueries({ ...notMe, type: "inactive" });
          const destination = safeDestination(router);
          if (destination) await router.navigate({ to: destination, replace: true });
          queryClient.setQueryData(ME_KEY, (old) => (old ? { ...old, branch: next, branch_closed: null } : old));
          await queryClient.resetQueries(notMe);
          void queryClient.invalidateQueries({ queryKey: ME_KEY });
        } catch {
          // สลับที่เซิร์ฟเวอร์แล้วแต่ล้างหน้าไม่ครบ — โหลดทั้งหน้าใหม่ ดีกว่าค้างข้อมูลสาขาเดิม
          reloadBlocking();
          return;
        }
        setOpenMobile(false);
        notifySuccess(t("branchSwitcher.switched", { name: next.name }), { id: "branch-switch" });
      });
    } finally {
      busy.current = false;
    }
  }

  /** เลือกสาขา (จากเมนูหรือปุ่มลัด) — สาขาเดิม = ไม่ทำอะไร */
  function request(branch: Branch) {
    if (busy.current || branch.id === me.branch?.id) return;
    if (hasUnsavedChanges()) setConfirming(branch);
    else void perform(branch);
  }

  function confirm() {
    const branch = confirming;
    setConfirming(null);
    if (branch) void perform(branch);
  }

  return { request, confirming, confirm, cancel: () => setConfirming(null) };
}

/**
 * Alt+1…9 = สลับไปสาขาที่ 1…9 ในรายการ — ลงทะเบียนเฉพาะผู้ที่สลับสาขาได้
 * ไม่ทำงานขณะพิมพ์ในช่อง · ขณะบังหน้าจอ · ขณะมี dialog เปิดอยู่
 */
export function useBranchHotkeys(me: Me, onSelect: (branch: Branch) => void) {
  const enabled = canSwitchBranch(me);
  const blocking = useIsBlocking();
  const select = useEffectEvent((index: number) => {
    const branch = me.branches[index - 1];
    if (branch) onSelect(branch);
  });

  useEffect(() => {
    if (!enabled || blocking) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const index = branchShortcutIndex(event);
      if (index === null || event.defaultPrevented || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="alertdialog"], [data-slot="blocking-overlay"]')) return;
      event.preventDefault();
      select(index);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, blocking]);
}
