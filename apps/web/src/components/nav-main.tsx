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
 * เมนูที่เลือกอยู่ = pill สีหลัก (ทอง `--primary` + ตัวอักษรน้ำตาลเข้ม `--primary-foreground` 5.54:1 สว่าง · 4.54:1 มืด)
 * ไม่ใช้ `--sidebar-primary` (คู่นั้นไม่ถึง 4.5:1) · ไอคอนใช้ currentColor ตามตัวอักษร · น้ำหนักตัวอักษรเท่าเดิม
 * hover เมนูอื่น = พื้นเทาอ่อน (sidebar-accent) · hover เมนูที่เลือก = ทองเข้มขึ้นเล็กน้อย
 * โฟกัส: เส้นขอบใน (ring) สีน้ำตาลบนพื้นทอง + outline ของ :focus-visible ด้านนอก · แถบไอคอนตอนย่อได้สี่เหลี่ยมทองเดียวกัน
 */
const ITEM =
  "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 data-[active=true]:bg-primary data-[active=true]:font-normal data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary/90 data-[active=true]:hover:text-primary-foreground data-[active=true]:active:bg-primary/90 data-[active=true]:active:text-primary-foreground data-[active=true]:focus-visible:ring-primary-foreground";

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
