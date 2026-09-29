import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { type CSSProperties, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SkipLink } from "@/components/skip-link";
import { NotFoundPage } from "@/components/status-page";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ApiError } from "@/lib/api";
import { useContentEpoch } from "@/lib/branch-epoch";
import { meQueryOptions } from "@/lib/queries";
import { readSidebarOpen } from "@/lib/sidebar-state";

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
  const contentEpoch = useContentEpoch();
  // อ่าน cookie ครั้งเดียวตอน mount — ย่อ sidebar ค้างไว้ข้ามการโหลดหน้า
  const [defaultOpen] = useState(readSidebarOpen);
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as CSSProperties
      }
    >
      <SkipLink />
      <AppSidebar variant="inset" />
      <SidebarInset className="min-w-0">
        <SiteHeader />
        <main id="main" tabIndex={-1} className="flex min-w-0 flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6 [&>*]:min-w-0">
          {/* สลับสาขาสำเร็จ = หน้าเนื้อหา mount ใหม่ — state ในหน้า (บิลที่กรอก · ฟอร์ม) ของสาขาเดิมไม่ติดไปสาขาใหม่
              (hooks/use-branch-switch.ts เพิ่ม epoch เอง ไม่ผูกกับ me ตรง ๆ: me เปลี่ยนจากที่อื่นต้องไม่ล้างฟอร์มเงียบ ๆ) */}
          <Outlet key={contentEpoch} />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
