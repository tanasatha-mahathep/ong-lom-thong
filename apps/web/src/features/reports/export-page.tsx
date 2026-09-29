import { CircleAlert, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { AppForm, SubmitButton } from "@/components/app-form";
import { LabeledSelect } from "@/components/labeled-select";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { FieldDescription } from "@/components/ui/field";
import { NativeSelectOption } from "@/components/ui/native-select";
import { useAppForm } from "@/hooks/use-app-form";
import { useBusinessDate } from "@/hooks/use-business-date";
import { apiFetch } from "@/lib/api";
import { canExportReports } from "@/lib/nav";
import { navigation } from "@/lib/navigation";
import { useMe } from "@/lib/queries";
import { useTranslation } from "./i18n";
import { type ExportParams, exportHref } from "./queries";
import { BranchSelect, ReportForbidden } from "./report-parts";
import { lastMonth } from "./search";

const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"] as const;
type MonthKey = (typeof MONTHS)[number];

/** ปี ค.ศ. + เดือนของเดือนก่อนหน้า "วันนี้" (ตามเวลาไทย) — ค่าเริ่มต้นของฟอร์ม ใช้ lastMonth() ตัวเดียวกับรายงานอื่น */
function defaultPeriod(today: string): { year: string; month: MonthKey } {
  const from = lastMonth(today).from; // "YYYY-MM-01"
  return { year: from.slice(0, 4), month: from.slice(5, 7) as MonthKey };
}

/** ชื่อช่องตรงกับ query ของ API (year · month · branch_id) — 400 ที่ชี้ `field` ตกที่ช่องนั้นเอง (U3) */
interface ExportValues {
  year: string;
  month: MonthKey;
  branch_id: string;
}

/**
 * ตรวจก่อนส่ง (U2): เดือนที่เลือกต้องไม่เกินเดือนปัจจุบันตามเวลาไทย — ไม่ต้องรอ API ปฏิเสธ
 * (API ยังตรวจซ้ำเสมอ · ข้อความจาก API ขึ้นใต้ช่องเดียวกันถ้าเวลาเครื่องกับเซิร์ฟเวอร์ต่างกัน)
 */
const exportSchema = (today: string, message: string) =>
  z.object({ year: z.string(), month: z.string(), branch_id: z.string() }).transform((values, ctx) => {
    if (`${values.year}-${values.month}` > today.slice(0, 7)) {
      ctx.issues.push({ code: "custom", input: values, path: ["month"], message });
      return z.NEVER;
    }
    return { year: Number(values.year), month: Number(values.month), branch_id: values.branch_id };
  });

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
  const today = useBusinessDate();
  const [defaults] = useState<ExportValues>(() => ({ ...defaultPeriod(today), branch_id: "" }));
  const schema = useMemo(() => exportSchema(today, t("export.futureMonth")), [today, t]);

  // ปีของตัวเลือก — ปีปัจจุบันย้อนหลัง 6 ปี (ไม่มีปีอนาคต)
  const currentYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 6 }, (_, i) => String(currentYear - i));

  /**
   * HEAD เช็คก่อนเสมอ — 2xx ค่อยพาเบราว์เซอร์ไปดาวน์โหลดจริง (ไม่ fetch ตัว zip เข้าหน่วยความจำ)
   * ระหว่างเช็คทั้งฟอร์มปิด + ปุ่มหมุน (U4) · ผล: toast บนกลาง (U5) — เริ่มดาวน์โหลดแล้ว / ล้มเหลวพร้อมเหตุผล
   * ไม่ใช้ชั้นบังหน้าจอ (U6): การดาวน์โหลดไฟล์ไม่ทำให้หน้านี้เปลี่ยนหรือโหลดใหม่
   */
  const f = useAppForm({
    defaultValues: defaults,
    schema,
    submit: async (params: ExportParams) => {
      const url = exportHref({ ...params, branch_id: params.branch_id || undefined });
      await apiFetch(url, { method: "HEAD" });
      return url;
    },
    successMessage: t("export.started"),
    onSuccess: (url) => navigation.downloadAt(url),
  });

  return (
    <AppForm
      form={f}
      aria-label={t("export.formLabel")}
      className="max-w-2xl rounded-lg border bg-card p-4"
      fieldsetClassName="grid gap-4"
    >
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <f.form.Field name="year">
          {(field) => (
            <LabeledSelect {...f.bind(field)} label={t("export.year")}>
              {years.map((y) => (
                <NativeSelectOption key={y} value={y}>
                  {t("export.yearLabel", { year: Number(y) + 543 })}
                </NativeSelectOption>
              ))}
            </LabeledSelect>
          )}
        </f.form.Field>

        <f.form.Field name="month">
          {(field) => (
            <LabeledSelect {...f.bind(field)} label={t("export.month")}>
              {MONTHS.map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {t(`export.months.${m}`)}
                </NativeSelectOption>
              ))}
            </LabeledSelect>
          )}
        </f.form.Field>

        <f.form.Field name="branch_id">{(field) => <BranchSelect {...f.bind(field)} />}</f.form.Field>
      </div>
      <FieldDescription>{t("export.hint")}</FieldDescription>

      {f.formError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{f.formError}</AlertTitle>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton form={f} pendingLabel={t("export.checking")}>
          <Download aria-hidden="true" />
          {t("export.download")}
        </SubmitButton>
        <p className="text-sm text-muted-foreground">{t("export.retryHint")}</p>
      </div>
    </AppForm>
  );
}
