import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Store, TriangleAlert } from "lucide-react";
import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageMeta } from "@/hooks/use-page-meta";
import { formatInteger, formatMoney } from "@/lib/format";
import { canSetGoldPrice } from "@/lib/nav";
import { type Role, goldPriceTodayQueryOptions, useMe } from "@/lib/queries";

/** หัวหน้าของ dashboard-01 — breadcrumb · ราคาทองวันนี้ · สาขาปัจจุบัน */
export function SiteHeader() {
  const me = useMe();
  const { title, crumbs } = usePageMeta();

  return (
    // container query: ราคาทองขึ้นแถวเดียวกับ breadcrumb เมื่อหัวกว้างพอ (ขึ้นกับ sidebar เปิด/ปิด ไม่ใช่ขนาดจอ)
    <header className="@container/header flex min-h-(--header-height) shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
        <Breadcrumb className="min-w-0">
          <BreadcrumbList className="flex-nowrap">
            {crumbs.map((crumb) => (
              <Fragment key={crumb.title}>
                <BreadcrumbItem className="hidden whitespace-nowrap md:inline-flex">
                  {crumb.to ? (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.to}>{crumb.title}</Link>
                    </BreadcrumbLink>
                  ) : (
                    crumb.title
                  )}
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
              </Fragment>
            ))}
            <BreadcrumbItem className="min-w-0">
              <BreadcrumbPage className="truncate font-medium">{title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <Badge variant="outline" className="h-7 gap-1.5 px-2.5 text-sm font-normal @6xl/header:order-last">
        <Store aria-hidden="true" />
        <span className="sr-only">สาขาปัจจุบัน</span>
        {me.branch ? me.branch.name : "ยังไม่ได้เลือกสาขา"}
      </Badge>
      <div className="order-last w-full @6xl/header:order-none @6xl/header:w-auto">
        <GoldPriceToday role={me.role} />
      </div>
    </header>
  );
}

/** ราคาทองวันนี้ 3 ค่า (R8) — ยังไม่ตั้ง = ป้ายเตือน (manager/admin กดไปหน้าตั้งราคาได้) */
function GoldPriceToday({ role }: { role: Role }) {
  const { data: price, isPending, isError } = useQuery(goldPriceTodayQueryOptions);

  if (isPending) return <Skeleton className="h-5 w-72 max-w-full" />;
  if (isError) return <p className="text-sm text-destructive">โหลดราคาทองวันนี้ไม่ได้</p>;
  if (!price) {
    const warning = (
      <>
        <TriangleAlert aria-hidden="true" />
        ยังไม่ได้ตั้งราคาทองวันนี้
      </>
    );
    const className = "h-7 gap-1.5 border-amber-300 bg-amber-50 px-2.5 text-sm font-normal text-amber-900";
    return canSetGoldPrice(role) ? (
      <Badge asChild variant="outline" className={className}>
        <Link to="/settings/gold-price">{warning}</Link>
      </Badge>
    ) : (
      <Badge variant="outline" className={className}>
        {warning}
      </Badge>
    );
  }

  return (
    <div role="group" aria-label="ราคาทองวันนี้">
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <PriceItem label="ทองแท่งขายออก" value={formatMoney(price.bar_sell)} />
        <PriceItem label="ทองแท่งรับซื้อ" value={formatMoney(price.bar_buy)} />
        <PriceItem label="ทองรูปพรรณรับซื้อ" value={formatInteger(price.jewelry_buy)} />
      </dl>
    </div>
  );
}

function PriceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
