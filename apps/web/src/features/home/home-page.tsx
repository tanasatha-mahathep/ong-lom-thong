import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HandCoins, TriangleAlert, UserPlus } from "lucide-react";
import { useId } from "react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBusinessDate } from "@/hooks/use-business-date";
import { formatBoardPrice, formatInteger, formatMoney, formatThaiDate, formatWeight } from "@/lib/format";
import { canCreateBill, canSetGoldPrice } from "@/lib/nav";
import { type Branch, GOLD_PRICE_SOURCE_LABEL, type Role, goldPriceTodayQueryOptions, useMe } from "@/lib/queries";
import { todayBuysQueryOptions } from "./queries";

/** หน้าแรก (spec §3 · §14.2) — กระดานราคาวันนี้ · ปุ่มใหญ่ · ยอดซื้อวันนี้ของสาขาปัจจุบัน */
export function HomePage() {
  const me = useMe();
  const today = useBusinessDate();
  return (
    <>
      <PageHeader description={`${formatThaiDate(today, "long")} · ${me.branch?.name ?? "ยังไม่ได้เลือกสาขา"}`} />
      <PriceBoard role={me.role} />
      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <QuickActions role={me.role} />
        <TodayTotalsCard branch={me.branch} date={today} />
      </div>
      {/* ตารางบิลวันนี้ (W4) — เพิ่ม <TodayBillsCard /> ตรงนี้ บรรทัดเดียว */}
    </>
  );
}

/** ราคาของสาขาปัจจุบัน 3 ค่า (R8) แบบกระดานราคาของระบบเดิม — ยังไม่ตั้ง = แจ้งตาม role (R7) */
function PriceBoard({ role }: { role: Role }) {
  const titleId = useId();
  const { data: price, isPending, refetch } = useQuery(goldPriceTodayQueryOptions);

  return (
    <section aria-labelledby={titleId} aria-busy={isPending} className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={titleId} className="text-lg font-semibold">
          ราคาทองวันนี้
        </h2>
        {price && <Badge variant="outline">{GOLD_PRICE_SOURCE_LABEL[price.source]}</Badge>}
        <p className="text-sm text-muted-foreground">ทองคำ 96.5% · ราคาต่อน้ำหนักทอง 1 บาท</p>
      </div>
      {price === undefined ? (
        isPending ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {["bar-sell", "bar-buy", "jewelry-buy"].map((key) => (
              <Skeleton key={key} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <LoadError what="ราคาทองวันนี้" onRetry={() => void refetch()} />
        )
      ) : price ? (
        <dl className="grid gap-4 sm:grid-cols-3">
          <BoardCard label="ทองแท่งขายออก" value={formatBoardPrice(price.bar_sell)} />
          <BoardCard label="ทองแท่งรับซื้อ" value={formatBoardPrice(price.bar_buy)} />
          <BoardCard label="ทองรูปพรรณรับซื้อ" value={formatInteger(price.jewelry_buy)} />
        </dl>
      ) : (
        <NoPriceAlert role={role} />
      )}
    </section>
  );
}

/** SectionCards ของ dashboard-01 — ตัวเลขใหญ่ tabular-nums จากข้อความของ API ตรง ๆ */
function BoardCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="@container/card gap-2 px-6 py-5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-3xl font-bold tabular-nums @[16rem]/card:text-4xl">{value}</span>
        <span className="text-muted-foreground">บาท</span>
      </dd>
    </Card>
  );
}

function NoPriceAlert({ role }: { role: Role }) {
  return (
    <Alert className="border-amber-300 bg-amber-50 text-amber-950">
      <TriangleAlert aria-hidden="true" />
      <AlertTitle>ยังไม่ได้ตั้งราคาทองวันนี้</AlertTitle>
      <AlertDescription className="text-amber-950">
        {canSetGoldPrice(role) ? (
          <>
            <p>ตั้งราคาก่อน จึงจะเปิดบิลซื้อเข้าได้</p>
            <Button asChild size="sm">
              <Link to="/settings/gold-price">ตั้งราคาทองวันนี้</Link>
            </Button>
          </>
        ) : (
          <p>แจ้งผู้จัดการให้ตั้งราคาทองก่อน จึงจะเปิดบิลได้</p>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** ปุ่มใหญ่ — ซื้อเข้าเฉพาะ role ที่เปิดบิลได้ (ฝ่ายบัญชีไม่เห็น) · เมนูซ่อนเพื่อความสะดวก API บังคับจริง */
function QuickActions({ role }: { role: Role }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="grid content-start gap-3 sm:grid-cols-2 lg:grid-cols-1">
      <h2 id={titleId} className="sr-only">
        ทางลัด
      </h2>
      {canCreateBill(role) && (
        <Button asChild className="h-16 text-lg">
          <Link to="/buy">
            <HandCoins className="size-6" aria-hidden="true" />
            ซื้อเข้า
          </Link>
        </Button>
      )}
      <Button asChild variant="outline" className="h-16 text-lg">
        <Link to="/customers/new">
          <UserPlus className="size-6" aria-hidden="true" />
          ลูกค้าใหม่
        </Link>
      </Button>
    </section>
  );
}

function TodayTotalsCard({ branch, date }: { branch: Branch | null; date: string }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="lg:col-span-2">
      <Card className="h-full">
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>ยอดซื้อวันนี้</h2>
          </CardTitle>
          <CardDescription>{branch ? `${branch.name} · ไม่นับบิลที่ยกเลิก` : "ยังไม่ได้เลือกสาขา"}</CardDescription>
        </CardHeader>
        <CardContent>
          {branch ? (
            <TodayTotals branchId={branch.id} date={date} />
          ) : (
            <p>เลือกสาขาจากเมนูผู้ใช้ก่อน จึงจะเห็นยอดของสาขา</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** totals ของ GET /api/buy — เซิร์ฟเวอร์รวมให้ทั้งหมด browser แค่แสดง (R14) */
function TodayTotals({ branchId, date }: { branchId: string; date: string }) {
  const {
    data: totals,
    isPending,
    refetch,
  } = useQuery({ ...todayBuysQueryOptions(branchId, date), select: (data) => data.totals });

  if (totals === undefined) {
    return isPending ? (
      <Skeleton className="h-16 w-full" />
    ) : (
      <LoadError what="ยอดซื้อวันนี้" onRetry={() => void refetch()} />
    );
  }
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Stat label="จำนวนบิล" value={formatInteger(totals.count)} />
      <Stat label="น้ำหนักรวม (กรัม)" value={formatWeight(totals.total_weight)} />
      <Stat label="ยอดเงินรวม (บาท)" value={formatMoney(totals.total_amount)} />
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
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="text-destructive">โหลด{what}ไม่ได้</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        ลองใหม่
      </Button>
    </div>
  );
}
