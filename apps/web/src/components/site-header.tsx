import { Link } from "@tanstack/react-router";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { NotificationBell } from "@/components/notification-bell";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePageMeta } from "@/hooks/use-page-meta";

/**
 * หัวหน้าของ dashboard-01 — ปุ่มย่อ/ขยาย sidebar + breadcrumb ซ้าย · กระดิ่งแจ้งเตือนขวาสุด
 * สาขาอยู่ที่หัว sidebar (tooltip ตอนย่อ) · ธีมอยู่เมนูผู้ใช้ · ราคาทองวันนี้อยู่หน้าแรก (เจ้าของจะกำหนดที่แสดงเอง)
 */
export function SiteHeader() {
  const { t } = useTranslation("shell");
  const { title, crumbs } = usePageMeta();

  return (
    <header className="flex min-h-(--header-height) shrink-0 items-center gap-2 border-b px-4 py-2 lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb aria-label={t("breadcrumb")} className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb) => (
            <Fragment key={crumb.title}>
              <BreadcrumbItem className="hidden whitespace-nowrap md:inline-flex">
                {crumb.to ? (
                  <BreadcrumbLink asChild>
                    <Link to={crumb.to}>{t(`routes.${crumb.title}`)}</Link>
                  </BreadcrumbLink>
                ) : (
                  t(`routes.${crumb.title}`)
                )}
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
            </Fragment>
          ))}
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate font-medium">{title && t(`routes.${title}`)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex shrink-0 items-center">
        <NotificationBell />
      </div>
    </header>
  );
}
