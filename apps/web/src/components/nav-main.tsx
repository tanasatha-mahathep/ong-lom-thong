import { Link, useMatchRoute } from "@tanstack/react-router";
import { CirclePlus } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { canCreateBill, navFor } from "@/lib/nav";
import type { Role } from "@/lib/queries";

/** เมนูหลักตาม role (spec §10) — ปุ่ม "ซื้อเข้า" อยู่ตำแหน่ง Quick Create ของ dashboard-01 */
export function NavMain({ role }: { role: Role }) {
  const matchRoute = useMatchRoute();

  return (
    <nav aria-label="เมนูหลัก" className="flex flex-col gap-2">
      {canCreateBill(role) && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className="h-9 bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                >
                  <Link to="/buy">
                    <CirclePlus aria-hidden="true" />
                    <span>ซื้อเข้า</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
      {navFor(role).map((group) => (
        <SidebarGroup key={group.title ?? "main"}>
          {group.title && <SidebarGroupLabel>{group.title}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    // "/" ต้องตรงตัว ไม่งั้นทุกหน้าจะนับเป็นหน้าแรก · หน้าลูก (เช่น /customers/new) นับเป็นเมนูแม่
                    isActive={!!matchRoute({ to: item.to, fuzzy: item.to !== "/" })}
                  >
                    <Link to={item.to} activeOptions={{ exact: item.to === "/" }}>
                      <item.icon aria-hidden="true" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}
