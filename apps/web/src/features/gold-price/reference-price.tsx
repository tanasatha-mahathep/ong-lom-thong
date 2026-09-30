import { useQuery } from "@tanstack/react-query";
import { Landmark, TriangleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { formatBoardPrice, formatMoney, formatThaiDateTime } from "@/lib/format";
import { type GoldReference, goldReferenceQueryOptions } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useTranslation } from "./i18n";

/** 503 reason "disabled" = ยังไม่ได้เปิดใช้ (ไม่ใช่แหล่งล่ม) — ข้อความต่างกัน */
const isDisabled = (error: unknown) =>
  error instanceof ApiError &&
  error.status === 503 &&
  typeof error.body === "object" &&
  error.body !== null &&
  (error.body as { reason?: unknown }).reason === "disabled";

/**
 * ราคาสมาคมค้าทองคำ (อ้างอิง) แบบเต็ม — หน้าหลัก และหน้าตั้งราคา
 * กรอบเส้นประ + พื้น muted + ป้าย "อ้างอิง": แยกจากราคาที่ร้านบันทึก (การ์ดทึบ) ให้เห็นทันที · ไม่มีสูตรเงินใน browser
 * `action` = ปุ่มของหน้าตั้งราคา (เติมค่าเริ่มต้น) — แสดงเฉพาะตอนมีราคา
 */
export function ReferencePricePanel({
  className,
  action,
}: {
  className?: string;
  action?: (reference: GoldReference) => ReactNode;
}) {
  const { t } = useTranslation("goldPrice");
  const titleId = useId();
  const { data, error, isPending } = useQuery(goldReferenceQueryOptions);

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={isPending}
      className={cn("grid gap-3 rounded-xl border border-dashed bg-muted p-4", className)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Landmark className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id={titleId} className="font-semibold">
          {t("reference.title")}
        </h3>
        <Badge variant="outline">{t("reference.badge")}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t("reference.description")}</p>
      {data ? (
        <>
          <ReferenceMeta reference={data} />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <ReferenceValue label={t("reference.barBuy")} value={formatBoardPrice(data.bar_buy)} />
            <ReferenceValue label={t("reference.barSell")} value={formatBoardPrice(data.bar_sell)} />
            <ReferenceValue label={t("reference.ornamentBuy")} value={formatMoney(data.ornament_buy)} />
            <ReferenceValue label={t("reference.ornamentSell")} value={formatBoardPrice(data.ornament_sell)} />
          </dl>
          {data.stale && <StaleNote />}
          {action?.(data)}
        </>
      ) : isPending ? (
        <>
          <span className="sr-only">{t("reference.loading")}</span>
          <Skeleton className="h-12 w-full" />
        </>
      ) : (
        <ReferenceFailed disabled={isDisabled(error)} />
      )}
    </section>
  );
}

/**
 * บรรทัดเดียวสำหรับหน้าเปิดบิล (/buy) — อ่านอย่างเดียว ไม่มีปุ่ม/ลิงก์ (ไม่เพิ่มจุดโฟกัสในลำดับคีย์บอร์ดของบิล)
 * ดึงไม่ได้ = บอกสั้น ๆ ไม่ขวางการเปิดบิล (บิลใช้ราคาที่ร้านบันทึกเท่านั้น)
 */
export function ReferencePriceLine({ className }: { className?: string }) {
  const { t } = useTranslation("goldPrice");
  const { data, error, isPending } = useQuery(goldReferenceQueryOptions);
  if (isPending) return null;
  return (
    <div
      role="note"
      className={cn("rounded-md border border-dashed bg-muted px-3 py-2 text-sm text-muted-foreground", className)}
    >
      {data ? (
        <>
          <p className="tabular-nums">
            {data.round === null
              ? t("reference.compact", {
                  price: formatBoardPrice(data.bar_sell),
                  time: formatThaiDateTime(data.announced_at),
                })
              : t("reference.compactRound", {
                  price: formatBoardPrice(data.bar_sell),
                  time: formatThaiDateTime(data.announced_at),
                  round: data.round,
                })}
          </p>
          {data.stale && (
            <p className="mt-1 rounded-sm border border-warning-border bg-warning px-2 py-1 text-warning-foreground">
              {t("reference.stale")}
            </p>
          )}
        </>
      ) : (
        <p>{isDisabled(error) ? t("reference.disabled") : t("reference.failed")}</p>
      )}
    </div>
  );
}

function ReferenceMeta({ reference }: { reference: GoldReference }) {
  const { t } = useTranslation("goldPrice");
  return (
    <p className="flex flex-wrap gap-x-3 text-sm tabular-nums">
      <span>{t("reference.announced", { time: formatThaiDateTime(reference.announced_at) })}</span>
      {reference.round !== null && <span>{t("reference.round", { round: reference.round })}</span>}
      <span className="text-muted-foreground">{t("reference.source", { source: reference.source })}</span>
    </p>
  );
}

function ReferenceValue({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation("goldPrice");
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums">{value}</span>
        <span className="text-sm text-muted-foreground">{t("baht", { ns: "common" })}</span>
      </dd>
    </div>
  );
}

function StaleNote() {
  const { t } = useTranslation("goldPrice");
  return (
    <p className="flex items-start gap-2 rounded-md border border-warning-border bg-warning px-3 py-2 text-sm text-warning-foreground">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {t("reference.stale")}
    </p>
  );
}

function ReferenceFailed({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation("goldPrice");
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-medium">{t("reference.failed")}</p>
      <p className="text-muted-foreground">{disabled ? t("reference.disabled") : t("reference.failedHint")}</p>
    </div>
  );
}
