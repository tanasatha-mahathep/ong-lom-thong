import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { BranchSwitchConfirm, BranchSwitcher } from "@/components/branch-switcher";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import { useBranchHotkeys, useBranchSwitch } from "@/hooks/use-branch-switch";
import { useMe } from "@/lib/queries";

/** sidebar ของแอป — หัว = ตัวเลือกสาขา (TeamSwitcher ของ sidebar-07) · เมนูตาม role · ท้าย = เมนูผู้ใช้ */
export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const { t } = useTranslation("shell");
  const me = useMe();
  // การสลับสาขา + ปุ่มลัดอยู่นอก <Sidebar> — บนมือถือ sheet ถูก unmount ตอนปิด ปุ่มลัดต้องยังทำงาน
  const branchSwitch = useBranchSwitch(me);
  useBranchHotkeys(me, branchSwitch.request);

  return (
    <>
      <Sidebar collapsible="offcanvas" {...props}>
        {/* landmark ของทั้งแถบ — หัว (สาขา) และเมนูผู้ใช้ไม่หลุดอยู่นอก landmark */}
        <aside aria-label={t("sidebar")} className="flex h-full min-h-0 w-full flex-col">
          <SidebarHeader>
            <BranchSwitcher me={me} onSelect={branchSwitch.request} />
          </SidebarHeader>
          <SidebarContent>
            <NavMain role={me.role} />
          </SidebarContent>
          <SidebarFooter>
            <NavUser me={me} />
          </SidebarFooter>
        </aside>
      </Sidebar>
      <BranchSwitchConfirm state={branchSwitch} />
    </>
  );
}
