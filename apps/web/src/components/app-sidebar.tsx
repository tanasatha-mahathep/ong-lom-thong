import { Link } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { BrandMark } from "@/components/brand-mark";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useMe } from "@/lib/queries";
import { SHOP_NAME } from "@/lib/shop";

/** sidebar ของ dashboard-01 — หัว = ชื่อร้าน + สาขาปัจจุบัน · เมนูตาม role · ท้าย = เมนูผู้ใช้ */
export function AppSidebar(props: ComponentProps<typeof Sidebar>) {
  const me = useMe();

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/">
                <BrandMark className="size-8!" />
                <span className="grid flex-1 text-left leading-snug">
                  <span className="truncate font-semibold">{SHOP_NAME}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {me.branch ? me.branch.name : "ยังไม่ได้เลือกสาขา"}
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain role={me.role} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser me={me} />
      </SidebarFooter>
    </Sidebar>
  );
}
