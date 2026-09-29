import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SkipLink } from "@/components/skip-link";
import { NotFoundPage } from "@/components/status-page";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ApiError } from "@/lib/api";
import { meQueryOptions, useMe } from "@/lib/queries";

/** ทุกหน้าหลัง login — guard: ต้องมี session (401 → /login พร้อม redirect กลับ) */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ context: { queryClient }, location }) => {
    try {
      await queryClient.ensureQueryData(meQueryOptions);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        throw redirect({
          to: "/login",
          search: location.href === "/" ? {} : { redirect: location.href },
          replace: true,
        });
      }
      throw error;
    }
  },
  component: AppLayout,
  // หน้าไม่มีในแอป (login แล้ว) — แสดงใน <main> ของ shell
  notFoundComponent: NotFoundPage,
});

/** โครงของ dashboard-01: sidebar แบบ inset + หัวหน้า + เนื้อหา */
function AppLayout() {
  const me = useMe();
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as CSSProperties
      }
    >
      <SkipLink />
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">
          {/* สลับสาขา = หน้าเนื้อหา mount ใหม่ — state ในหน้า (บิลที่กรอก · ฟอร์ม) ของสาขาเดิมไม่ติดไปสาขาใหม่ */}
          <Outlet key={me.branch?.id ?? "none"} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
