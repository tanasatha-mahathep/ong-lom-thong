import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { activeNavPath, navFor } from "@/lib/nav";
import type { Role } from "@/lib/queries";

/**
 * เมนูที่เลือกอยู่แบบ sidebar ของ Next.js docs — พื้นนุ่ม ๆ มุมมนเต็มแถว + ตัวอักษรเข้มขึ้นเล็กน้อย (น้ำหนักเท่าเดิม ไม่มีแถบซ้าย)
 * hover ของเมนูอื่นอ่อนกว่า (60%) — แยกออกจากเมนูที่เลือกได้ · แถบไอคอนตอนย่อได้พื้นสี่เหลี่ยมเดียวกัน
 */
const ITEM =
  "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 data-[active=true]:bg-sidebar-accent data-[active=true]:font-normal data-[active=true]:text-sidebar-accent-foreground data-[active=true]:hover:bg-sidebar-accent";

/**
 * เมนูหลักตาม role (spec §10) — ทุกเมนูมีไอคอน + tooltip (แถบไอคอนตอนย่อ sidebar แบบ sidebar-07)
 * ชื่อกลุ่มซ่อนเองตอนย่อ · เลือกอยู่ได้ทีละเมนู (activeNavPath: หน้าลูกเป็นของเมนูแม่ · /buy/$id = ค้นบิล)
 */
export function NavMain({ role }: { role: Role }) {
  const { t } = useTranslation("shell");
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = activeNavPath(pathname, role);

  return (
    <nav aria-label={t("mainNav")} className="flex flex-col gap-2">
      {navFor(role).map((group) => (
        <SidebarGroup key={group.title ?? "main"}>
          {group.title && <SidebarGroupLabel>{t(`groups.${group.title}`)}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const label = t(`nav.${item.title}`);
                const isActive = item.to === active;
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild tooltip={label} className={ITEM} isActive={isActive}>
                      {/* aria-current ตาม activeNavPath (Link ของ router ติดเองเฉพาะตรงตัว — exact กันเมนูที่สองติดซ้อน) */}
                      <Link to={item.to} activeOptions={{ exact: true }} aria-current={isActive ? "page" : undefined}>
                        <item.icon aria-hidden="true" />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}
