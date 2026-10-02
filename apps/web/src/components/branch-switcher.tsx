import { Link } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus, Store } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark } from "@/components/brand-mark";
import { RailTooltip } from "@/components/rail-tooltip";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import type { useBranchSwitch } from "@/hooks/use-branch-switch";
import { type Branch, type Me, canSwitchBranch } from "@/lib/queries";

/** ปุ่มลัด Alt+1…9 ได้แค่ 9 สาขาแรกในรายการ (ตรงกับ hooks/use-branch-switch.ts) */
const MAX_SHORTCUTS = 9;

/** ยืนยันก่อนสลับสาขาทั้งที่ฟอร์มยังไม่บันทึก — ปุ่มแรกที่ได้โฟกัสคือ "อยู่ต่อ" */
export function BranchSwitchConfirm({ state }: { state: ReturnType<typeof useBranchSwitch> }) {
  const { t } = useTranslation("shell");
  return (
    <AlertDialog open={state.confirming !== null} onOpenChange={(open) => !open && state.cancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("branchSwitcher.confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("branchSwitcher.confirmBody", { name: state.confirming?.name ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("branchSwitcher.confirmStay")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={state.confirm}>
            {t("branchSwitcher.confirmSwitch")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * สาขาถูกเปลี่ยนจากที่อื่นขณะมีฟอร์มค้าง — กันทั้งหน้า (ปิดไม่ได้ · Esc ไม่ปิด) ให้โหลดหน้าใหม่เท่านั้น
 * ไม่บันทึกลงสาขาที่ผู้ใช้ไม่ได้เห็นบนจอ
 */
export function BranchChangedNotice({ state }: { state: ReturnType<typeof useBranchSwitch> }) {
  const { t } = useTranslation("shell");
  const branch = state.changedElsewhere;
  return (
    <AlertDialog open={branch !== undefined}>
      <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("branchSwitcher.changedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("branchSwitcher.changedBody", { name: branch?.name ?? t("noBranch", { ns: "common" }) })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={state.reload}>{t("branchSwitcher.changedReload")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** ช่องสี่เหลี่ยมหัว sidebar = โลโก้ร้าน (ประดับ — ชื่อสาขาอยู่ข้าง ๆ) · ย่อเป็นแถบไอคอนก็เหลือแค่ช่องนี้ */
function BranchTile() {
  // ครอบด้วย span: SidebarMenuButton บีบ svg ลูกตรงเหลือ 16px ([&>svg]:size-4) — โลโก้ต้องเต็มช่อง 32px
  // เท่าช่อง TeamSwitcher ของ sidebar-07 ทั้งตอนขยาย หัวนิ่ง และแถบไอคอน (ปุ่มเป็น size-8 พอดีโลโก้)
  return (
    <span data-slot="branch-tile" className="flex size-8 shrink-0 items-center justify-center">
      <BrandMark className="size-8 rounded-lg" />
    </span>
  );
}

/** ชื่อสาขา (ตัวหนา) + รหัสสาขา — "สาขาปัจจุบัน" สำหรับ screen reader อยู่ในชื่อปุ่มด้วย */
function BranchLabel({ me }: { me: Me }) {
  const { t } = useTranslation("shell");
  return (
    <span className="grid flex-1 text-left text-sm leading-tight">
      <span className="sr-only">{t("currentBranch")} </span>
      <span className="truncate font-semibold">{me.branch?.name ?? t("noBranch", { ns: "common" })}</span>
      <span className="truncate text-xs text-muted-foreground tabular-nums">
        {me.branch ? t("branchCode", { ns: "common", code: me.branch.code }) : t("shopName", { ns: "common" })}
      </span>
    </span>
  );
}

/**
 * หัว sidebar แบบ TeamSwitcher ของ sidebar-07 — สาขาเดียว = หัวนิ่ง (ลิงก์หน้าหลัก)
 * หลายสาขา = เมนูเลือกสาขา (ติ๊กสาขาปัจจุบัน · Alt+n · ผู้ดูแลมี "จัดการสาขา")
 */
export function BranchSwitcher({ me, onSelect }: { me: Me; onSelect: (branch: Branch) => void }) {
  const { t } = useTranslation("shell");
  const { isMobile } = useSidebar();

  if (!canSwitchBranch(me)) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" asChild tooltip={me.branch?.name}>
            <Link to="/">
              <BranchTile />
              <BranchLabel me={me} />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <RailTooltip label={me.branch?.name ?? t("noBranch", { ns: "common" })}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <BranchTile />
                <BranchLabel me={me} />
                <ChevronsUpDown className="ml-auto" aria-hidden="true" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
          </RailTooltip>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {t("branchSwitcher.label")}
            </DropdownMenuLabel>
            {me.branches.map((branch, index) => {
              const current = branch.id === me.branch?.id;
              const shortcut = index < MAX_SHORTCUTS ? t("branchSwitcher.shortcut", { n: index + 1 }) : undefined;
              return (
                // เลือกได้ทีละสาขา = menuitemradio (ติ๊กสาขาปัจจุบันด้วยไอคอนเช็กแบบ TeamSwitcher)
                <DropdownMenuItem
                  key={branch.id}
                  role="menuitemradio"
                  aria-checked={current}
                  aria-keyshortcuts={shortcut}
                  className="gap-2 p-2"
                  onSelect={() => onSelect(branch)}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md border">
                    <Store className="size-3.5 text-foreground" aria-hidden="true" />
                  </span>
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate">{branch.name}</span>
                    <span className="truncate text-xs text-muted-foreground tabular-nums">
                      {t("branchCode", { ns: "common", code: branch.code })}
                    </span>
                  </span>
                  <Check className={current ? "text-foreground" : "invisible"} aria-hidden="true" />
                  {shortcut && <DropdownMenuShortcut aria-hidden="true">{shortcut}</DropdownMenuShortcut>}
                </DropdownMenuItem>
              );
            })}
            {me.role === "admin" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="gap-2 p-2">
                  <Link to="/settings/branches">
                    <span className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                      <Plus className="size-4" aria-hidden="true" />
                    </span>
                    <span className="font-medium text-muted-foreground">{t("branchSwitcher.manage")}</span>
                  </Link>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
