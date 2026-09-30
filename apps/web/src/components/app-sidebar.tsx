import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { AppVersion } from "@/components/app-version";
import { BranchChangedNotice, BranchSwitchConfirm, BranchSwitcher } from "@/components/branch-switcher";
import { CommandSearch, SearchTrigger } from "@/components/command-search";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { useBranchHotkeys, useBranchSwitch } from "@/hooks/use-branch-switch";
import { useCommandSearch } from "@/hooks/use-command-search";
import { useMe } from "@/lib/queries";

/**
 * sidebar ของแอป — หัว = ตัวเลือกสาขา (TeamSwitcher ของ sidebar-07) + ปุ่มค้นหา (Ctrl/⌘+K · ช่องค้นของ sidebar-01)
 * · เมนูตาม role · ท้าย = เมนูผู้ใช้
 */
export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation("shell");
  const me = useMe();
  // การสลับสาขา + ปุ่มลัดอยู่นอก <Sidebar> — บนมือถือ sheet ถูก unmount ตอนปิด ปุ่มลัดต้องยังทำงาน
  const branchSwitch = useBranchSwitch(me);
  useBranchHotkeys(me, branchSwitch.request);
  // หน้าค้นหาเช่นกัน — Ctrl/⌘+K ต้องเปิดได้ตอน sheet ปิด และหน้าค้นหาต้องอยู่ต่อหลังปิด sheet
  const search = useCommandSearch(me);

  return (
    <>
      {/* ย่อเป็นแถบไอคอนแบบ sidebar-07 (collapsible="icon") — Ctrl/⌘+B หรือปุ่มในหัวหน้า · จำใน cookie · ไม่มี SidebarRail (เจ้าของไม่ต้องการเส้น/เงาตอน hover ที่ขอบ) */}
      <Sidebar collapsible="icon" {...props}>
        {/* landmark ของทั้งแถบ — หัว (สาขา) และเมนูผู้ใช้ไม่หลุดอยู่นอก landmark */}
        <aside aria-label={t("sidebar")} className="flex h-full min-h-0 w-full flex-col">
          <SidebarHeader>
            <BranchSwitcher me={me} onSelect={branchSwitch.request} />
            <SearchTrigger onOpen={search.show} />
          </SidebarHeader>
          <SidebarContent>
            <NavMain role={me.role} />
          </SidebarContent>
          <SidebarFooter>
            <NavUser me={me} />
            <AppVersion />
          </SidebarFooter>
        </aside>
      </Sidebar>
      <BranchSwitchConfirm state={branchSwitch} />
      <BranchChangedNotice state={branchSwitch} />
      <CommandSearch state={search} me={me} />
    </>
  );
}
