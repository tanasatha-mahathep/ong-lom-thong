import { useQuery } from "@tanstack/react-query";
import { Landmark, TriangleAlert } from "lucide-react";
import { type ReactNode, useId } from "react";
import { PriceCard } from "@/components/price-card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { formatBoardPrice, formatThaiDateTime } from "@/lib/format";
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
 * การ์ด 4 ใบ 1 → 2 → 4 คอลัมน์ตามความกว้างของกรอบเอง (@container/reference) ไม่ใช่ความกว้างจอ — กรอบนี้เต็มความกว้าง
 * เนื้อหาในหน้าหลัก แต่อยู่ในการ์ดครึ่งจอของหน้าตั้งราคา (lg:grid-cols-2) · จุดเปลี่ยนวัดจากค่าที่กว้างที่สุดของประกาศจริง
 * "66,683.52 บาท" (ทองรูปพรรณรับซื้อมีสตางค์): 2 ใบเมื่อกรอบ ≥ 26rem · 4 ใบเมื่อ ≥ 56rem — การ์ดจึงไม่แคบกว่าราว 10rem
 * และตัวเลขกับ "บาท" อยู่บรรทัดเดียวในการ์ด (PriceCard compact) · โครงรอโหลดใช้ grid เดียวกัน ข้อมูลมาแล้วไม่กระโดด
 */
const CARD_GRID = "grid gap-4 @[26rem]/reference:grid-cols-2 @4xl/reference:grid-cols-4";
const CARD_KEYS = ["bar-buy", "bar-sell", "ornament-buy", "ornament-sell"] as const;

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

  // การ์ดข้างในหน้าตาเดียวกับกระดานราคาของร้าน — กรอบจึงเป็นตัวแยก: เส้นประ muted-foreground/70 (border ปกติจางเกือบ
  // มองไม่เห็นบนพื้นขาว) ให้เห็นชัดทั้งสองธีมว่าเป็นราคาอ้างอิง ไม่ใช่แถวที่สองของกระดานร้าน — /70 ผ่าน WCAG 1.4.11
  // (non-text contrast ≥ 3:1) ทั้งสองธีม (/50 เดิมได้แค่ ~2.1–2.7:1)
  // grid-cols-1 = track minmax(0,1fr): เนื้อหาใน action (ปุ่ม nowrap) ดันกรอบ/การ์ดให้กว้างเกินที่ไม่ได้
  return (
    <section
      aria-labelledby={titleId}
      aria-busy={isPending}
      className={cn(
        "@container/reference grid grid-cols-1 gap-3 rounded-xl border border-dashed border-muted-foreground/70 bg-muted p-4",
        className,
      )}
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
          {/* ก่อนตัวเลข: เห็นคำเตือนก่อนอ่านราคา — จอแคบการ์ดเรียงลงมา 4 ใบ คำเตือนท้ายกรอบจะเลื่อนไม่ถึง */}
          {data.stale && <StaleNote />}
          {/*
            ลำดับตามเจ้าของร้าน: ทองคำแท่ง รับซื้อ · ขายออก · ทองรูปพรรณ รับซื้อ · ขายออก
            formatBoardPrice ทั้ง 4 ค่าแบบกระดานของร้านข้างบน: บาทเต็มไม่มี ".00" · มีสตางค์แสดงครบ ไม่ปัดทิ้ง
            (ทองรูปพรรณรับซื้อของสมาคมปกติมีสตางค์ "66,683.52" — วันที่เป็นบาทเต็มก็แสดงแบบเดียวกับอีก 3 ใบ)
          */}
          <dl className={CARD_GRID}>
            <PriceCard compact label={t("reference.barBuy")} value={formatBoardPrice(data.bar_buy)} />
            <PriceCard compact label={t("reference.barSell")} value={formatBoardPrice(data.bar_sell)} />
            <PriceCard compact label={t("reference.ornamentBuy")} value={formatBoardPrice(data.ornament_buy)} />
            <PriceCard compact label={t("reference.ornamentSell")} value={formatBoardPrice(data.ornament_sell)} />
          </dl>
          {action?.(data)}
        </>
      ) : isPending ? (
        <>
          <span className="sr-only">{t("reference.loading")}</span>
          {/* รูปเดียวกับตอนมีข้อมูล (บรรทัดประกาศ + การ์ด 4 ใบ) · bg-card: bg-accent กลืนกับพื้น muted ของกรอบ */}
          <Skeleton className="h-5 w-72 max-w-full bg-card" />
          <div className={CARD_GRID}>
            {CARD_KEYS.map((key) => (
              <Skeleton key={key} className="h-28 rounded-xl bg-card" />
            ))}
          </div>
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
