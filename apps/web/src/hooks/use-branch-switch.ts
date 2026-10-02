import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSidebar } from "@/components/ui/sidebar";
import { ApiError, errorMessage } from "@/lib/api";
import { BLOCKING_WATCHDOG_MS, reloadBlocking, runBlocking, useIsBlocking } from "@/lib/blocking";
import { bumpContentEpoch } from "@/lib/branch-epoch";
import { OPEN_LAYER, isTypingTarget } from "@/lib/hotkeys";
import { notifyError, notifySuccess } from "@/lib/notify";
import { type Branch, type Me, canSwitchBranch, meQueryOptions } from "@/lib/queries";
import { switchBranch } from "@/lib/session";
import { hasUnsavedChanges, isSavingInProgress, releaseUnsavedChanges } from "@/lib/unsaved-changes";

const ME_KEY = meQueryOptions.queryKey;
const SWITCH_MUTATION_KEY = ["switch-branch"] as const;

/** รอคำตอบการสลับได้นานสุด — ต้องน้อยกว่า watchdog ของชั้นบัง (ไม่งั้นชั้นบังหายก่อน แล้วคำตอบมาล้างหน้าทีหลัง) */
export const SWITCH_TIMEOUT_MS = Math.min(20_000, BLOCKING_WATCHDOG_MS - 5_000);

/** Alt+1…9 (แถวตัวเลขเท่านั้น — Alt+numpad คือ Alt code ของ Windows) → 1…9 · ปุ่มอื่น = null */
export function branchShortcutIndex(event: KeyboardEvent): number | null {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) {
    return null;
  }
  const match = /^Digit([1-9])$/.exec(event.code);
  return match ? Number(match[1]) : null;
}

/**
 * หน้าที่ผูกกับเอกสารของสาขา (มี path param เช่น /buy/$id · /customers/$id) → ปลายทางที่ปลอดภัยหลังสลับสาขา
 * (breadcrumb ก่อนหน้าที่เป็นลิงก์ หรือหน้าหลัก) · หน้ารายการ/หน้าทั่วไป = อยู่หน้าเดิม (undefined)
 */
function safeDestination(router: ReturnType<typeof useRouter>) {
  const leaf = router.state.matches.at(-1);
  if (!leaf || Object.keys(leaf.params).length === 0) return undefined;
  const crumbs = leaf.staticData.crumbs ?? [];
  return crumbs.findLast((crumb) => crumb.to)?.to ?? "/";
}

class SwitchTimeout extends Error {}

/** ปฏิเสธชัดเจนจากเซิร์ฟเวอร์ (4xx) = ไม่ได้สลับแน่นอน · อย่างอื่น (เน็ตหลุด 5xx หมดเวลา อ่านคำตอบไม่ได้) = ไม่รู้ผล */
const isDefiniteRefusal = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500;

const notMe = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey[0] !== ME_KEY[0] };

/**
 * การสลับสาขา (fail-closed) — ใช้ที่ AppSidebar ครั้งเดียว (อยู่นอก sheet ของมือถือ ปุ่มลัดจึงทำงานตอนปิด sheet)
 * 1. กำลังบันทึกอยู่ (รวมช่วงลองซ้ำ) → ไม่สลับ · ฟอร์มยังไม่บันทึก → ถามยืนยันก่อน (dialog ในหน้า)
 * 2. บังหน้าจอ → POST /api/me/branch (หมดเวลา SWITCH_TIMEOUT_MS) · 4xx = toast error อยู่สาขาเดิม ·
 *    ไม่รู้ผล (0/5xx/หมดเวลา) = โหลดทั้งหน้าใหม่ให้เห็นสาขาจริงจากเซิร์ฟเวอร์
 * 3. สำเร็จ: ทิ้ง cache ที่ไม่มีใครใช้ → ออกจากหน้าเอกสารของสาขาเดิม → ตั้งสาขาใหม่ใน me → หน้าใน <Outlet>
 *    mount ใหม่ → reset ทุก query (ข้อมูลสาขาเดิมหายทันที)
 * 4. สาขาเปลี่ยนจากที่อื่น (แท็บอื่น) → reset ข้อมูล + แจ้ง · มีฟอร์มค้าง = กันบันทึกด้วย dialog ให้โหลดหน้าใหม่
 */
export function useBranchSwitch(me: Me) {
  const { t } = useTranslation("shell");
  const queryClient = useQueryClient();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [confirming, setConfirming] = useState<Branch | null>(null);
  /** สาขาเปลี่ยนจากที่อื่นขณะมีฟอร์มค้าง — undefined = ไม่มี */
  const [changedElsewhere, setChangedElsewhere] = useState<Branch | null | undefined>(undefined);
  const busy = useRef(false);
  /** สาขาที่หน้าจอแสดงอยู่ — me เปลี่ยนเป็นค่าอื่นที่เราไม่ได้ตั้งเอง = เปลี่ยนจากที่อื่น */
  const shownBranch = useRef(me.branch?.id ?? null);
  const mutation = useMutation({
    mutationKey: SWITCH_MUTATION_KEY,
    mutationFn: ({ id, signal }: { id: string; signal: AbortSignal }) => switchBranch(id, { signal }),
  });

  /** มีการบันทึกค้าง (mutation ใดก็ได้ที่ไม่ใช่การสลับสาขา — บันทึกบิลลองซ้ำเองได้ · ฟอร์มที่ประกาศตัว) */
  function savingNow(): boolean {
    const pending = queryClient.isMutating({
      predicate: (m) => m.options.mutationKey?.[0] !== SWITCH_MUTATION_KEY[0],
    });
    return pending > 0 || isSavingInProgress();
  }

  function refuseWhileSaving(): boolean {
    if (!savingNow()) return false;
    notifyError(t("branchSwitcher.savingWait"), { id: "branch-switch" });
    return true;
  }

  function unknownOutcome() {
    // ผู้ใช้ตกลงเปลี่ยนสาขาแล้ว — ไม่ต้องให้ beforeunload ถามซ้ำ
    releaseUnsavedChanges();
    reloadBlocking();
  }

  async function perform(target: Branch) {
    if (busy.current || refuseWhileSaving()) return;
    busy.current = true;
    const controller = new AbortController();
    try {
      await runBlocking(async () => {
        let next: Branch;
        try {
          next = await new Promise<Branch>((resolve, reject) => {
            const timer = setTimeout(() => {
              controller.abort();
              reject(new SwitchTimeout());
            }, SWITCH_TIMEOUT_MS);
            mutation.mutateAsync({ id: target.id, signal: controller.signal }).then(
              (value) => {
                clearTimeout(timer);
                resolve(value);
              },
              (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
              },
            );
          });
        } catch (error) {
          if (isDefiniteRefusal(error)) {
            notifyError(t("branchSwitcher.failed", { reason: errorMessage(error) }), { id: "branch-switch" });
          } else {
            unknownOutcome();
          }
          return;
        }
        try {
          // cache ของหน้าอื่นทิ้งเลย — หน้าปลายทางต้องโหลดจากสาขาใหม่ ไม่หยิบของสาขาเดิมมาแสดง
          queryClient.removeQueries({ ...notMe, type: "inactive" });
          const destination = safeDestination(router);
          if (destination) await router.navigate({ to: destination, replace: true });
          shownBranch.current = next.id;
          queryClient.setQueryData(ME_KEY, (old) => (old ? { ...old, branch: next, branch_closed: null } : old));
          bumpContentEpoch();
          await queryClient.resetQueries(notMe);
          void queryClient.invalidateQueries({ queryKey: ME_KEY });
        } catch {
          // สลับที่เซิร์ฟเวอร์แล้วแต่ล้างหน้าไม่ครบ — โหลดทั้งหน้าใหม่ ดีกว่าค้างข้อมูลสาขาเดิม
          unknownOutcome();
          return;
        }
        setOpenMobile(false);
        notifySuccess(t("branchSwitcher.switched", { name: next.name }), { id: "branch-switch" });
      });
    } finally {
      busy.current = false;
    }
  }

  /** me บอกสาขาอื่นที่เราไม่ได้ตั้ง (สลับจากแท็บอื่น · session เปลี่ยน) — ไม่ปล่อยข้อมูลสาขาเดิมค้างบนจอ */
  const onChangedElsewhere = useEffectEvent(async (branch: Branch | null) => {
    const name = branch?.name ?? t("noBranch", { ns: "common" });
    if (hasUnsavedChanges() || savingNow()) {
      // ไม่ล้างฟอร์มเงียบ ๆ และไม่ปล่อยให้บันทึกลงสาขาที่ผู้ใช้ไม่เห็น — dialog กันทั้งหน้าจนกว่าจะโหลดใหม่
      setChangedElsewhere(branch);
      await queryClient.resetQueries(notMe);
      return;
    }
    await runBlocking(async () => {
      queryClient.removeQueries({ ...notMe, type: "inactive" });
      const destination = safeDestination(router);
      if (destination) await router.navigate({ to: destination, replace: true });
      bumpContentEpoch();
      await queryClient.resetQueries(notMe);
    });
    // ไม่ใช่ความผิดพลาด แต่ผู้ใช้ต้องเห็น — ค้างจนปิดเหมือน error
    toast.warning(t("branchSwitcher.changedElsewhere", { name }), {
      id: "branch-switch",
      duration: Number.POSITIVE_INFINITY,
      closeButton: true,
    });
  });

  const branchId = me.branch?.id ?? null;
  useEffect(() => {
    if (branchId === shownBranch.current) return;
    shownBranch.current = branchId;
    void onChangedElsewhere(me.branch);
    // เฉพาะตอน id เปลี่ยน — me.branch ตัวใหม่ที่ id เดิม (refetch) ไม่ใช่การเปลี่ยนสาขา
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // dialog "สาขาถูกเปลี่ยน" เปิดอยู่ — กัน Ctrl+Enter (บันทึก) และทุกปุ่มที่ไม่ได้อยู่ใน dialog
  useEffect(() => {
    if (changedElsewhere === undefined) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const inDialog = event.target instanceof Element && event.target.closest('[role="alertdialog"]');
      if (inDialog && !(event.key === "Enter" && (event.ctrlKey || event.metaKey))) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [changedElsewhere]);

  /** เลือกสาขา (จากเมนูหรือปุ่มลัด) — สาขาเดิม = ไม่ทำอะไร */
  function request(branch: Branch) {
    if (busy.current || branch.id === me.branch?.id || refuseWhileSaving()) return;
    if (hasUnsavedChanges()) setConfirming(branch);
    else void perform(branch);
  }

  function confirm() {
    const branch = confirming;
    setConfirming(null);
    if (branch) void perform(branch);
  }

  return {
    request,
    confirming,
    confirm,
    cancel: () => setConfirming(null),
    changedElsewhere,
    reload: unknownOutcome,
  };
}

/**
 * Alt+1…9 = สลับไปสาขาที่ 1…9 ในรายการ — ลงทะเบียนเฉพาะผู้ที่สลับสาขาได้
 * ไม่ทำงานขณะพิมพ์ในช่อง · ขณะบังหน้าจอ · ขณะมี dialog/sheet/เมนูเปิดอยู่
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
      if (document.querySelector(OPEN_LAYER)) return;
      event.preventDefault();
      select(index);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, blocking]);
}
