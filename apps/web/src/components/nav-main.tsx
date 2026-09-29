import { Link, useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { navFor } from "@/lib/nav";
import type { Role } from "@/lib/queries";

/** ปุ่มสีหลัก (ซื้อเข้า) — คงสีตอน hover/active/เลือกอยู่ ไม่กลายเป็นสีของเมนูธรรมดา */
const PRIMARY =
  "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground data-[active=true]:bg-primary data-[active=true]:text-primary-foreground";

/**
 * เมนูหลักตาม role (spec §10) — ทุกเมนูมีไอคอน + tooltip (แถบไอคอนตอนย่อ sidebar แบบ sidebar-07)
 * ชื่อกลุ่มซ่อนเองตอนย่อ · "ซื้อเข้า" เป็นเมนูเดียวแบบปุ่มสีหลัก
 */
export function NavMain({ role }: { role: Role }) {
  const { t } = useTranslation("shell");
  const matchRoute = useMatchRoute();

  return (
    <nav aria-label={t("mainNav")} className="flex flex-col gap-2">
      {navFor(role).map((group) => (
        <SidebarGroup key={group.title ?? "main"}>
          {group.title && <SidebarGroupLabel>{t(`groups.${group.title}`)}</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const label = t(`nav.${item.title}`);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      tooltip={label}
                      className={item.primary ? PRIMARY : undefined}
                      // "/" ต้องตรงตัว ไม่งั้นทุกหน้าจะนับเป็นหน้าแรก · หน้าลูก (เช่น /customers/new) นับเป็นเมนูแม่
                      isActive={!!matchRoute({ to: item.to, fuzzy: item.to !== "/" })}
                    >
                      <Link to={item.to} activeOptions={{ exact: item.to === "/" }}>
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
