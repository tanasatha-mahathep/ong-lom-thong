import { CircleAlert, Download } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useBusinessDate } from "@/hooks/use-business-date";
import { ApiError, apiFetch, errorMessage } from "@/lib/api";
import { canExportReports } from "@/lib/nav";
import { navigation } from "@/lib/navigation";
import { useMe } from "@/lib/queries";
import { useTranslation } from "./i18n";
import { type ExportParams, exportHref } from "./queries";
import { BranchSelect, ReportForbidden } from "./report-parts";
import { lastMonth } from "./search";

const focusById = (id: string) => document.getElementById(id)?.focus();

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;
type MonthKey = (typeof MONTHS)[number];

/** ปี ค.ศ. + เดือนของเดือนก่อนหน้า "วันนี้" (ตามเวลาไทย) — ค่าเริ่มต้นของฟอร์ม ใช้ lastMonth() ตัวเดียวกับรายงานอื่น */
function defaultPeriod(today: string): { year: string; month: MonthKey } {
  const from = lastMonth(today).from; // "YYYY-MM-01"
  return { year: from.slice(0, 4), month: from.slice(5, 7) as MonthKey };
}

/** error ของ HEAD precheck — มี field ที่หน้านี้มีช่องจริง (year · month) = ใต้ช่องนั้น · อื่น ๆ (branch_id · 403 · 404) = แจ้งรวม */
interface ExportError {
  field?: "year" | "month";
  message: string;
}

function exportErrorOf(error: unknown): ExportError {
  const field = error instanceof ApiError ? error.field : undefined;
  return { field: field === "year" || field === "month" ? field : undefined, message: errorMessage(error) };
}

/**
 * /reports/export — ส่งบัญชีรายเดือน (spec §9.4) · accounting · admin เท่านั้น
 * ฟอร์มเลือกเดือน + สาขา → HEAD เช็คสิทธิ/ความถูกต้องก่อน → ดาวน์โหลดจริงด้วย navigation (ไม่ fetch zip เข้าหน่วยความจำ)
 */
export function ExportPage() {
  const { t } = useTranslation("reports");
  const me = useMe();

  if (!canExportReports(me.role)) {
    return (
      <>
        <PageHeader />
        <ReportForbidden title={t("export.forbidden.title")} body={t("export.forbidden.body")} />
      </>
    );
  }

  return (
    <>
      <PageHeader description={t("export.description")} />
      <ExportForm />
    </>
  );
}

function ExportForm() {
  const { t } = useTranslation("reports");
  const ids = useId();
  const today = useBusinessDate();
  const [{ year: defaultYear, month: defaultMonth }] = useState(() => defaultPeriod(today));
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState<MonthKey>(defaultMonth);
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<ExportError | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  const yearId = `${ids}-year`;
  const monthId = `${ids}-month`;
  const branchId = `${ids}-branch`;
  const buttonId = `${ids}-download`;
  const yearErrorId = `${yearId}-error`;
  const monthErrorId = `${monthId}-error`;

  // ปีของตัวเลือก — ปีปัจจุบันย้อนหลัง 6 ปี (ไม่มีปีอนาคต) · เดือนอนาคตของปีปัจจุบันให้ API ปฏิเสธและแจ้งใต้ช่อง
  const currentYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 6 }, (_, i) => String(currentYear - i));

  /** HEAD เช็คก่อนเสมอ — 2xx ค่อย navigate ไปดาวน์โหลดจริง (ไม่ fetch ตัว zip เข้าหน่วยความจำ) */
  const runExport = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const params: ExportParams = { year: Number(year), month: Number(month), branch_id: branch || undefined };
    const url = exportHref(params);
    try {
      await apiFetch(url, { method: "HEAD" });
      navigation.downloadAt(url);
    } catch (e) {
      const mapped = exportErrorOf(e);
      setError(mapped);
      if (mapped.field === "year") focusById(yearId);
      else if (mapped.field === "month") focusById(monthId);
      else focusById(buttonId);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runExport();
  };

  const yearError = error?.field === "year" ? error.message : null;
  const monthError = error?.field === "month" ? error.message : null;
  const formError = error && !error.field ? error.message : null;

  return (
    <form
      aria-label={t("export.formLabel")}
      noValidate
      onSubmit={submit}
      className="grid max-w-2xl gap-4 rounded-lg border bg-card p-4"
    >
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field data-invalid={!!yearError}>
          <FieldLabel htmlFor={yearId}>{t("export.year")}</FieldLabel>
          <NativeSelect
            id={yearId}
            value={year}
            aria-invalid={!!yearError}
            aria-describedby={yearError ? yearErrorId : undefined}
            onChange={(event) => {
              setYear(event.target.value);
              setError(null);
            }}
          >
            {years.map((y) => (
              <NativeSelectOption key={y} value={y}>
                {t("export.yearLabel", { year: Number(y) + 543 })}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError id={yearErrorId}>{yearError}</FieldError>
        </Field>

        <Field data-invalid={!!monthError}>
          <FieldLabel htmlFor={monthId}>{t("export.month")}</FieldLabel>
          <NativeSelect
            id={monthId}
            value={month}
            aria-invalid={!!monthError}
            aria-describedby={monthError ? monthErrorId : undefined}
            onChange={(event) => {
              setMonth(event.target.value as MonthKey);
              setError(null);
            }}
          >
            {MONTHS.map((m) => (
              <NativeSelectOption key={m} value={m}>
                {t(`export.months.${m}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError id={monthErrorId}>{monthError}</FieldError>
        </Field>

        <BranchSelect
          id={branchId}
          value={branch}
          onChange={(next) => {
            setBranch(next);
            setError(null);
          }}
        />
      </div>
      <FieldDescription>{t("export.hint")}</FieldDescription>

      {formError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{formError}</AlertTitle>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button id={buttonId} type="submit" disabled={pending}>
          <Download aria-hidden="true" />
          {pending ? t("saving", { ns: "common" }) : t("export.download")}
        </Button>
        <p className="text-sm text-muted-foreground">{t("export.retryHint")}</p>
      </div>
    </form>
  );
}
