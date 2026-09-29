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

/** เมนูที่เลือกอยู่ — พื้น sidebar-accent + ตัวหนา + แถบซ้าย (เห็นชัดทั้งตอนขยาย แถบไอคอน และ sheet มือถือ) */
const ACTIVE =
  "data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold data-[active=true]:text-sidebar-accent-foreground data-[active=true]:shadow-[inset_3px_0_0_var(--sidebar-primary)]";

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
                    <SidebarMenuButton asChild tooltip={label} className={ACTIVE} isActive={isActive}>
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
