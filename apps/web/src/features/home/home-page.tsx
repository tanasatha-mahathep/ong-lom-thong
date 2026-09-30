import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HandCoins, TriangleAlert, UserPlus } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import { PriceCard } from "@/components/price-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TodayBillsCard } from "@/features/bills/TodayBillsCard";
import { ReferencePricePanel } from "@/features/gold-price/reference-price";
import { useBusinessDate } from "@/hooks/use-business-date";
import { formatBoardPrice, formatInteger, formatMoney, formatThaiDate, formatWeight } from "@/lib/format";
import { canCreateBill, canSetGoldPrice } from "@/lib/nav";
import { type Branch, type Role, goldPriceTodayQueryOptions, useMe } from "@/lib/queries";
import { todayBuysQueryOptions } from "./queries";

/** หน้าแรก (spec §3 · §14.2) — กระดานราคาวันนี้ · ปุ่มใหญ่ · ยอดซื้อวันนี้ของสาขาปัจจุบัน */
export function HomePage() {
  const { t } = useTranslation();
  const me = useMe();
  const today = useBusinessDate();
  return (
    <>
      <PageHeader description={`${formatThaiDate(today, "long")} · ${me.branch?.name ?? t("noBranch")}`} />
      <PriceBoard role={me.role} />
      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <QuickActions role={me.role} />
        <TodayTotalsCard branch={me.branch} date={today} />
      </div>
      <TodayBillsCard />
    </>
  );
}

/**
 * ราคาของสาขาปัจจุบัน 3 ค่า (R8) แบบกระดานราคาของระบบเดิม — ยังไม่ตั้ง = แจ้งตาม role (R7)
 * ใต้กระดาน: ราคาสมาคม (อ้างอิง) แยกกรอบ — อ่านอย่างเดียว
 */
function PriceBoard({ role }: { role: Role }) {
  const { t } = useTranslation("home");
  const titleId = useId();
  const { data: price, isPending, refetch } = useQuery(goldPriceTodayQueryOptions);

  return (
    <section aria-labelledby={titleId} aria-busy={isPending} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={titleId} className="text-lg font-semibold">
          {t("goldPrice.today", { ns: "common" })}
        </h2>
        {price && <Badge variant="outline">{t(`goldPrice.source.${price.source}`, { ns: "common" })}</Badge>}
        <p className="text-sm text-muted-foreground">{t("boardHint")}</p>
      </div>
      {price === undefined ? (
        isPending ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {["bar-sell", "bar-buy", "jewelry-buy"].map((key) => (
              <Skeleton key={key} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <LoadError what={t("goldPrice.today", { ns: "common" })} onRetry={() => void refetch()} />
        )
      ) : price ? (
        <dl className="grid gap-4 sm:grid-cols-3">
          <PriceCard label={t("goldPrice.barSell", { ns: "common" })} value={formatBoardPrice(price.bar_sell)} />
          <PriceCard label={t("goldPrice.barBuy", { ns: "common" })} value={formatBoardPrice(price.bar_buy)} />
          <PriceCard label={t("goldPrice.jewelryBuy", { ns: "common" })} value={formatInteger(price.jewelry_buy)} />
        </dl>
      ) : (
        <NoPriceAlert role={role} />
      )}
      {/* ราคาสมาคม (อ้างอิง) — แยกจากกระดานราคาของร้านข้างบน · ไม่ใช่ราคาที่ใช้เปิดบิล */}
      <ReferencePricePanel />
    </section>
  );
}

function NoPriceAlert({ role }: { role: Role }) {
  const { t } = useTranslation("home");
  return (
    <Alert className="border-warning-border bg-warning text-warning-foreground">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>{t("goldPrice.notSet", { ns: "common" })}</AlertTitle>
      <AlertDescription className="text-warning-foreground">
        {canSetGoldPrice(role) ? (
          <>
            <p>{t("noPrice.canSet")}</p>
            <Button asChild size="sm">
              <Link to="/settings/gold-price">{t("noPrice.setPrice")}</Link>
            </Button>
          </>
        ) : (
          <p>{t("noPrice.askManager")}</p>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** ปุ่มใหญ่ — ซื้อเข้าเฉพาะ role ที่เปิดบิลได้ (ฝ่ายบัญชีไม่เห็น) · เมนูซ่อนเพื่อความสะดวก API บังคับจริง */
function QuickActions({ role }: { role: Role }) {
  const { t } = useTranslation("home");
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
      <h2 id={titleId} className="sr-only">
        {t("shortcuts")}
      </h2>
      {canCreateBill(role) && (
        <Button asChild className="h-16 text-lg">
          <Link to="/buy">
            <HandCoins className="size-6" aria-hidden="true" />
            {t("buy")}
          </Link>
        </Button>
      )}
      <Button asChild variant="outline" className="h-16 text-lg">
        <Link to="/customers/new">
          <UserPlus className="size-6" aria-hidden="true" />
          {t("newCustomer")}
        </Link>
      </Button>
    </section>
  );
}

function TodayTotalsCard({ branch, date }: { branch: Branch | null; date: string }) {
  const { t } = useTranslation("home");
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="lg:col-span-2">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{t("todayTotals.title")}</h2>
          </CardTitle>
          <CardDescription>
            {branch ? t("todayTotals.scope", { branch: branch.name }) : t("noBranch", { ns: "common" })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {branch ? <TodayTotals branchId={branch.id} date={date} /> : <p>{t("todayTotals.pickBranch")}</p>}
        </CardContent>
      </Card>
    </section>
  );
}

/** totals ของ GET /api/buy — เซิร์ฟเวอร์รวมให้ทั้งหมด browser แค่แสดง (R14) */
function TodayTotals({ branchId, date }: { branchId: string; date: string }) {
  const { t } = useTranslation("home");
  const {
    data: totals,
    isPending,
    refetch,
  } = useQuery({ ...todayBuysQueryOptions(branchId, date), select: (data) => data.totals });

  if (totals === undefined) {
    return isPending ? (
      <Skeleton className="h-16 w-full" />
    ) : (
      <LoadError what={t("todayTotals.title")} onRetry={() => void refetch()} />
    );
  }
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Stat label={t("todayTotals.count")} value={formatInteger(totals.count)} />
      <Stat label={t("todayTotals.weight")} value={formatWeight(totals.total_weight)} />
      <Stat label={t("todayTotals.amount")} value={formatMoney(totals.total_amount)} />
    </dl>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function LoadError({ what, onRetry }: { what: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-destructive">{t("loadFailed", { what })}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("retry")}
      </Button>
    </div>
  );
}
