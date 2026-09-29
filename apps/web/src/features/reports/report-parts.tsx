import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Download, Info, LoaderCircle } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { LabeledSelect, type LabeledSelectProps } from "@/components/labeled-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell } from "@/components/ui/table";
import { apiBlob, errorMessage } from "@/lib/api";
import { navigation } from "@/lib/navigation";
import { notifyError, notifySuccess } from "@/lib/notify";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useTranslation } from "./i18n";
import { metalsQueryOptions } from "./queries";

/** ประเภทโลหะจาก GET /api/metals — ค่าว่าง = ทุกประเภท */
export function MetalSelect(props: Omit<LabeledSelectProps, "label" | "children" | "value"> & { value: string }) {
  const { t } = useTranslation("reports");
  const { data: metals } = useQuery(metalsQueryOptions);
  const known = !props.value || metals?.some((metal) => metal.code === props.value);
  return (
    <LabeledSelect {...props} label={t("filters.metal")}>
      <NativeSelectOption value="">{t("filters.allMetals")}</NativeSelectOption>
      {metals?.map((metal) => (
        <NativeSelectOption key={metal.code} value={metal.code}>
          {metal.name_th}
        </NativeSelectOption>
      ))}
      {/* ค่าจาก URL ก่อนรายการโลหะโหลดเสร็จ — ช่องต้องแสดงค่าที่กรองอยู่จริง */}
      {!known && <NativeSelectOption value={props.value}>{props.value}</NativeSelectOption>}
    </LabeledSelect>
  );
}

/**
 * สาขา — แสดงเฉพาะบัญชีที่มีหลายสาขาหรือดูได้ทุกสาขา (useMe().branches) · ค่าว่าง = ทุกสาขาที่มีสิทธิ์
 * สาขาเดียว: ไม่มีช่องนี้ รายงานเป็นของสาขานั้นอยู่แล้ว (API จำกัดขอบเขตเอง)
 */
export function BranchSelect(props: Omit<LabeledSelectProps, "label" | "children" | "value"> & { value: string }) {
  const { t } = useTranslation("reports");
  const me = useMe();
  if (me.branches.length <= 1 && !me.can_view_all) return null;
  const known = !props.value || me.branches.some((branch) => branch.id === props.value);
  return (
    <LabeledSelect {...props} label={t("filters.branch")}>
      <NativeSelectOption value="">{t("filters.allBranches")}</NativeSelectOption>
      {me.branches.map((branch) => (
        <NativeSelectOption key={branch.id} value={branch.id}>
          {t("branchLabel", { code: branch.code, name: branch.name })}
        </NativeSelectOption>
      ))}
      {!known && <NativeSelectOption value={props.value}>{props.value}</NativeSelectOption>}
    </LabeledSelect>
  );
}

/**
 * ดาวน์โหลด CSV (UTF-8 + BOM) — origin เดียวกัน cookie session ไปเอง · ไม่มี public URL
 * ขอผ่าน fetch เพื่อรู้ผล (U4/U5): ระหว่างโหลดปุ่มกดไม่ได้ + หมุน · สำเร็จ/ล้มเหลวมี toast บนกลาง
 * (เดิมเป็น `<a download>` — browser ไม่บอกว่าไฟล์มาหรือไม่ ผู้ใช้จึงไม่รู้เมื่อ 403/ล่ม)
 */
export function CsvDownloadButton({ href, filename }: { href: `/api/${string}`; filename: string }) {
  const { t } = useTranslation("reports");
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const download = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      navigation.saveBlob(await apiBlob(href), filename);
      notifySuccess(t("csv.done", { file: filename }), { id: CSV_TOAST });
    } catch (error) {
      notifyError(t("csv.failed", { reason: errorMessage(error) }), { id: CSV_TOAST });
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void download()}
    >
      {pending ? (
        <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
      ) : (
        <Download aria-hidden="true" />
      )}
      {pending ? t("csv.downloading") : t("csv.download")}
    </Button>
  );
}

/** toast เดียวต่อหน้า — กดซ้ำแทนที่ ไม่กอง */
const CSV_TOAST = "report-csv";

/** ปุ่มยืนยันตัวกรอง (ส่งฟอร์ม) — ระหว่างโหลดรายงานกดไม่ได้ + หมุน (U4) */
export function ApplyButton({ loading }: { loading: boolean }) {
  const { t } = useTranslation("reports");
  return (
    <Button type="submit" disabled={loading}>
      {loading && <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />}
      {loading ? t("filters.loading") : t("filters.apply")}
    </Button>
  );
}

/**
 * API ตอบ 403 (role ที่ดูรายงานนี้ไม่ได้ · บัญชีที่ไม่มีสาขา) — เมนูซ่อนไว้แล้ว แต่เปิด URL ตรง ๆ ได้
 * ข้อความเริ่มต้นของรายงานทั่วไป (manager/accounting/admin) — หน้าที่จำกัด role แคบกว่า (เช่น export) ส่ง title/body เอง
 */
export function ReportForbidden({ title, body }: { title?: string; body?: string } = {}) {
  const { t } = useTranslation("reports");
  return (
    <Alert>
      <Info aria-hidden="true" />
      <AlertTitle>{title ?? t("forbidden.title")}</AlertTitle>
      <AlertDescription>{body ?? t("forbidden.body")}</AlertDescription>
    </Alert>
  );
}

/** `detail: false` = ข้อความของ error แสดงใต้ช่องของตัวกรองแล้ว (400 ที่ชี้ช่อง) — ไม่ซ้ำในกล่องนี้ */
export function ReportLoadError({
  error,
  onRetry,
  detail = true,
}: {
  error: Error;
  onRetry: () => void;
  detail?: boolean;
}) {
  const { t } = useTranslation("reports");
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{t("loadFailed", { ns: "common", what: t("report") })}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-2">
        {detail && <p>{errorMessage(error)}</p>}
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("retry", { ns: "common" })}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** ยังไม่มีข้อมูล (โหลดครั้งแรก · หลังสลับสาขา query ถูก reset) */
export function ReportSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

/** กรอบตารางพื้นทึบ (เหมือน DataTable) */
export function TableFrame({ children }: { children: ReactNode }) {
  return <div className="min-w-0 overflow-hidden rounded-lg border bg-card">{children}</div>;
}

/** ช่องตัวเลข — ชิดขวา ตัวเลขกว้างเท่ากัน */
export function NumberCell({ children, className }: { children: ReactNode; className?: string }) {
  return <TableCell className={cn("px-3 text-right tabular-nums", className)}>{children}</TableCell>;
}
