import { useQuery } from "@tanstack/react-query";
import { CircleAlert, Download, Info } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useTranslation } from "./i18n";
import { metalsQueryOptions } from "./queries";
import { isoToThaiInput, parseDateInput } from "./search";

/**
 * ช่องวันที่แบบพิมพ์ วว/ดด/ปปปป พ.ศ. — `<input type="text">` ห้าม date picker (CLAUDE.md กฎ 6)
 * อ่านด้วย parseThaiDate ของ @ong/core · จัดรูปหลังออกจากช่องเท่านั้น ไม่แทรกระหว่างพิมพ์
 */
export function ThaiDateField({
  id,
  label,
  value,
  error,
  onChange,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  error: string | null;
  onChange: (text: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation("reports");
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={t("filters.datePlaceholder")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          const parsed = parseDateInput(value);
          if ("iso" in parsed) onChange(isoToThaiInput(parsed.iso));
        }}
        aria-invalid={!!error}
        aria-describedby={error ? `${errorId} ${hintId}` : hintId}
        className="tabular-nums"
      />
      <FieldDescription id={hintId}>{t("filters.dateHint")}</FieldDescription>
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}

/** ประเภทโลหะจาก GET /api/metals — ค่าว่าง = ทุกประเภท */
export function MetalSelect({ id, value, onChange }: { id: string; value: string; onChange: (code: string) => void }) {
  const { t } = useTranslation("reports");
  const { data: metals } = useQuery(metalsQueryOptions);
  const known = !value || metals?.some((metal) => metal.code === value);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("filters.metal")}</FieldLabel>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <NativeSelectOption value="">{t("filters.allMetals")}</NativeSelectOption>
        {metals?.map((metal) => (
          <NativeSelectOption key={metal.code} value={metal.code}>
            {metal.name_th}
          </NativeSelectOption>
        ))}
        {/* ค่าจาก URL ก่อนรายการโลหะโหลดเสร็จ — ช่องต้องแสดงค่าที่กรองอยู่จริง */}
        {!known && <NativeSelectOption value={value}>{value}</NativeSelectOption>}
      </NativeSelect>
    </Field>
  );
}

/**
 * สาขา — แสดงเฉพาะบัญชีที่มีหลายสาขาหรือดูได้ทุกสาขา (useMe().branches) · ค่าว่าง = ทุกสาขาที่มีสิทธิ์
 * สาขาเดียว: ไม่มีช่องนี้ รายงานเป็นของสาขานั้นอยู่แล้ว (API จำกัดขอบเขตเอง)
 */
export function BranchSelect({ id, value, onChange }: { id: string; value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation("reports");
  const me = useMe();
  if (me.branches.length <= 1 && !me.can_view_all) return null;
  const known = !value || me.branches.some((branch) => branch.id === value);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{t("filters.branch")}</FieldLabel>
      <NativeSelect id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <NativeSelectOption value="">{t("filters.allBranches")}</NativeSelectOption>
        {me.branches.map((branch) => (
          <NativeSelectOption key={branch.id} value={branch.id}>
            {t("branchLabel", { code: branch.code, name: branch.name })}
          </NativeSelectOption>
        ))}
        {!known && <NativeSelectOption value={value}>{value}</NativeSelectOption>}
      </NativeSelect>
    </Field>
  );
}

/** ลิงก์ดาวน์โหลด CSV จริง (`<a download>`) — origin เดียวกัน cookie session ไปเอง */
export function CsvLink({ href, filename }: { href: string; filename: string }) {
  const { t } = useTranslation("reports");
  return (
    <Button asChild variant="outline">
      <a href={href} download={filename}>
        <Download aria-hidden="true" />
        {t("csv.download")}
      </a>
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

export function ReportLoadError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation("reports");
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{t("loadFailed", { ns: "common", what: t("report") })}</AlertTitle>
      <AlertDescription className="grid justify-items-start gap-2">
        <p>{errorMessage(error)}</p>
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
