import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
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

/** หัวหน้าของ dashboard-01 — breadcrumb · ราคาทองวันนี้ (สาขาอยู่หัว sidebar · ธีมอยู่เมนูผู้ใช้) */
export function SiteHeader() {
  const { t } = useTranslation("shell");
  const me = useMe();
  const { title, crumbs } = usePageMeta();

  return (
    // container query: ราคาทองขึ้นแถวเดียวกับ breadcrumb เมื่อหัวกว้างพอ (ขึ้นกับ sidebar เปิด/ปิด ไม่ใช่ขนาดจอ)
    <header className="@container/header flex min-h-(--header-height) shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 lg:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
      </div>
      <div className="order-last w-full @6xl/header:order-none @6xl/header:w-auto">
        <GoldPriceToday role={me.role} />
      </div>
    </header>
  );
}

/** ราคาทองวันนี้ 3 ค่า (R8) — ยังไม่ตั้ง = ป้ายเตือน (manager/admin กดไปหน้าตั้งราคาได้) */
function GoldPriceToday({ role }: { role: Role }) {
  const { t } = useTranslation();
  const { data: price, isPending, isError } = useQuery(goldPriceTodayQueryOptions);

  if (isPending) return <Skeleton className="h-5 w-72 max-w-full" />;
  if (isError) return <p className="text-sm text-destructive">{t("loadFailed", { what: t("goldPrice.today") })}</p>;
  if (!price) {
    const warning = (
      <>
        <TriangleAlert aria-hidden="true" />
        {t("goldPrice.notSet")}
      </>
    );
    const className = "h-7 gap-1.5 border-warning-border bg-warning px-2.5 text-sm font-normal text-warning-foreground";
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
    <div role="group" aria-label={t("goldPrice.today")}>
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <PriceItem label={t("goldPrice.barSell")} value={formatMoney(price.bar_sell)} />
        <PriceItem label={t("goldPrice.barBuy")} value={formatMoney(price.bar_buy)} />
        <PriceItem label={t("goldPrice.jewelryBuy")} value={formatInteger(price.jewelry_buy)} />
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
