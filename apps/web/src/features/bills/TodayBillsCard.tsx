import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { HandCoins } from "lucide-react";
import { useId, useMemo } from "react";
import { DataTable } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayBuysQueryOptions } from "@/features/home/queries";
import { useBusinessDate } from "@/hooks/use-business-date";
import { formatInteger } from "@/lib/format";
import { canCreateBill } from "@/lib/nav";
import { type Role, useMe } from "@/lib/queries";
import { makeBillColumns } from "./bill-columns";
import { useTranslation } from "./i18n";

/** หน้าจอเปิดค้างทั้งวัน — บิลจากเครื่องอื่นในสาขาขึ้นเองภายในหนึ่งนาที */
const REFRESH_MS = 60_000;

/** การ์ดแสดงหน้าเดียว (page 1 · hasMore false) ปุ่มเปลี่ยนหน้าจึงไม่แสดง — ดูต่อที่หน้าค้นบิล */
const singlePage = () => undefined;

/**
 * บิลซื้อเข้าวันนี้ของสาขาปัจจุบัน บนหน้าหลัก — query เดียวกับการ์ดยอดซื้อวันนี้ (key เดียว ยิงครั้งเดียว)
 * ยอดรวมไม่แสดงซ้ำ (การ์ดยอดซื้อวันนี้แสดงแล้ว)
 */
export function TodayBillsCard() {
  const { t } = useTranslation("bills");
  const me = useMe();
  const today = useBusinessDate();
  const titleId = useId();
  const branch = me.branch;

  return (
    <section aria-labelledby={titleId}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={titleId}>{t("today.title")}</h2>
          </CardTitle>
          {branch && (
            <CardAction>
              <Button asChild variant="outline" size="sm">
                {/* ผู้ใช้หลายสาขา: ส่งสาขาไปด้วย หน้าค้นบิลจึงแสดงชุดเดียวกับการ์ดนี้ */}
                <Link
                  to="/bills"
                  search={{ from: today, to: today, branch: me.branches.length > 1 ? branch.id : undefined }}
                >
                  {t("today.viewAll")}
                </Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {branch ? <TodayBills branchId={branch.id} today={today} role={me.role} /> : <p>{t("today.noBranch")}</p>}
        </CardContent>
      </Card>
    </section>
  );
}

function TodayBills({ branchId, today, role }: { branchId: string; today: string; role: Role }) {
  const { t } = useTranslation("bills");
  const { data, isPending, refetch } = useQuery({
    ...todayBuysQueryOptions(branchId, today),
    refetchInterval: REFRESH_MS,
  });
  const columns = useMemo(() => makeBillColumns({ t, showBranch: false, compact: true }), [t]);

  if (data === undefined && !isPending) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-destructive">{t("today.loadError")}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t("retry", { ns: "common" })}
        </Button>
      </div>
    );
  }
  if (data?.items.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-muted-foreground">{t("today.empty")}</p>
        {canCreateBill(role) && (
          <Button asChild size="sm">
            <Link to="/buy">
              <HandCoins aria-hidden="true" />
              {t("today.buy")}
            </Link>
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <DataTable
        columns={columns}
        data={data?.items ?? []}
        caption={t("today.caption")}
        page={1}
        hasMore={false}
        onPageChange={singlePage}
        isLoading={isPending}
        getRowId={(bill) => bill.id}
      />
      {data?.has_more && (
        <p className="text-sm text-muted-foreground">
          {t("today.latestOnly", { count: formatInteger(String(data.items.length)) })}
        </p>
      )}
    </div>
  );
}
