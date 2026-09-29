import { type UseQueryResult, keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useId, useMemo } from "react";
import { useTranslation as useCommonTranslation } from "react-i18next";
import { AppForm } from "@/components/app-form";
import { PageHeader } from "@/components/page-header";
import { ThaiDateField } from "@/components/thai-date-field";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppForm } from "@/hooks/use-app-form";
import { useBusinessDate } from "@/hooks/use-business-date";
import { ApiError } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { formatWeight } from "@/lib/format";
import { useTranslation } from "./i18n";
import { type StockParams, type StockReport, stockCsvHref, stockReportQueryOptions } from "./queries";
import { stockFilterSchema } from "./filter-schema";
import {
  ApplyButton,
  BranchSelect,
  CsvDownloadButton,
  NumberCell,
  ReportForbidden,
  ReportLoadError,
  ReportSkeleton,
  TableFrame,
} from "./report-parts";
import { csvNameSuffix } from "./csv-name";
import { type FieldProblem, fieldProblem, problemOf } from "./report-problem";
import { type StockSearch, isoToThaiInput, lastMonth } from "./search";

const route = getRouteApi("/_app/reports/stock");

const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

/**
 * /reports/stock — สต็อกคงเหลือ ณ วันที่ (stock_show) · manager · accounting · admin
 * ตาราง สาขา × ประเภทโลหะ (กรัม) · แถวรวมจาก `total` ของ API — ไม่รวมกรัมข้ามโลหะ และไม่บวกเลขใน browser
 */
export function StockReportPage() {
  const { t } = useTranslation("reports");
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const me = useMe();
  const today = useBusinessDate();
  const params: StockParams = { as_of: search.as_of ?? today, branch_id: search.branch_id };
  const report = useQuery({ ...stockReportQueryOptions(params), placeholderData: keepPreviousData });

  if (isForbidden(report.error)) {
    return (
      <>
        <PageHeader />
        <ReportForbidden />
      </>
    );
  }

  return (
    <>
      <PageHeader
        description={t("stock.description")}
        actions={
          <CsvDownloadButton
            href={stockCsvHref(params)}
            fallbackName={t("csv.stockFile", {
              asOf: params.as_of,
              suffix: csvNameSuffix(me.branches.find((branch) => branch.id === params.branch_id)?.code, undefined),
            })}
          />
        }
      />
      <StockFilters
        applied={params}
        loading={report.isFetching}
        problem={fieldProblem(report.error)}
        onApply={(next) => void navigate({ search: next })}
      />
      <StockResults report={report} />
    </>
  );
}

interface FilterValues {
  as_of: string;
  branch_id: string;
}

const toValues = (p: StockParams): FilterValues => ({ as_of: isoToThaiInput(p.as_of), branch_id: p.branch_id ?? "" });

/** ค่าที่ตรวจแล้ว (วันที่เป็น ISO) → search ของ URL */
const toSearch = (v: FilterValues): StockSearch => ({
  as_of: v.as_of,
  ...(v.branch_id ? { branch_id: v.branch_id } : {}),
});

/**
 * ตัวกรอง — วันที่ที่พิมพ์: Enter / "แสดงรายงาน" · สาขาและปุ่มลัดใช้ทันที (กติกาเดียวกับรายงานยอดซื้อและหน้าค้นบิล)
 * วันที่ผิดรูปแจ้งใต้ช่องก่อนยิง API (U2) · 400 ของ API ที่ชี้ช่องแสดงใต้ช่องนั้น (U3)
 */
function StockFilters({
  applied,
  loading,
  problem,
  onApply,
}: {
  applied: StockParams;
  loading: boolean;
  problem: FieldProblem | undefined;
  onApply: (next: StockSearch) => void;
}) {
  const { t } = useTranslation("reports");
  const { t: tc } = useCommonTranslation("common");
  const today = useBusinessDate();
  const schema = useMemo(() => stockFilterSchema(tc), [tc]);
  const f = useAppForm({
    defaultValues: toValues(applied),
    schema,
    submit: (values) => Promise.resolve(values),
    onSuccess: (values) => onApply(toSearch(values)),
  });

  // URL เปลี่ยนจากทางอื่น → ช่องแสดงค่าที่ใช้อยู่จริง โดยไม่ remount ฟอร์ม
  const appliedKey = JSON.stringify(applied);
  const syncFromUrl = useEffectEvent(() => f.form.reset(toValues(applied)));
  useEffect(() => syncFromUrl(), [appliedKey]);

  const applyDate = (iso: string) => {
    f.form.setFieldValue("as_of", isoToThaiInput(iso));
    onApply(toSearch({ as_of: iso, branch_id: f.form.state.values.branch_id }));
  };

  return (
    <AppForm
      form={f}
      role="search"
      aria-label={t("filters.label")}
      className="rounded-lg border bg-card p-4"
      fieldsetClassName="grid gap-4"
    >
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <f.form.Field name="as_of">
          {(field) => {
            const bound = f.bind(field);
            return (
              <ThaiDateField
                {...bound}
                label={t("filters.asOf")}
                error={bound.error ?? problemOf(problem, "as_of")}
                onFormat={field.handleChange}
              />
            );
          }}
        </f.form.Field>
        <f.form.Field name="branch_id">
          {(field) => {
            const bound = f.bind(field);
            return (
              <BranchSelect
                {...bound}
                error={bound.error ?? problemOf(problem, "branch_id")}
                onChange={(event) => {
                  bound.onChange(event);
                  f.submit();
                }}
              />
            );
          }}
        </f.form.Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ApplyButton loading={loading} />
        <div role="group" aria-label={t("filters.presets")} className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => applyDate(today)}>
            {t("filters.today")}
          </Button>
          <Button type="button" variant="outline" onClick={() => applyDate(lastMonth(today).to)}>
            {t("filters.endOfLastMonth")}
          </Button>
        </div>
      </div>
    </AppForm>
  );
}

function StockResults({ report }: { report: UseQueryResult<StockReport> }) {
  const { t } = useTranslation("reports");
  const titleId = useId();
  const data = report.data;
  if (data === undefined) {
    return report.isError ? (
      <ReportLoadError
        error={report.error}
        detail={!fieldProblem(report.error)}
        onRetry={() => void report.refetch()}
      />
    ) : (
      <ReportSkeleton />
    );
  }

  // คอลัมน์ = โลหะตามลำดับของร้านจาก `total` · ช่องของแต่ละสาขาจับคู่ด้วย metal_code (ไม่พึ่งลำดับ)
  const metals = data.total.by_metal;
  return (
    <section aria-labelledby={titleId} aria-busy={report.isFetching} className="grid grid-cols-1 gap-3">
      <div className="grid gap-1">
        <h2 id={titleId} className="text-lg font-semibold">
          {t("stock.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("stock.asOf", { date: isoToThaiInput(data.as_of) })}</p>
      </div>
      <TableFrame>
        <Table>
          <TableCaption className="sr-only">{t("stock.caption")}</TableCaption>
          <TableHeader className="bg-muted">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="px-3">
                {t("stock.branch")}
              </TableHead>
              {metals.map((metal) => (
                <TableHead key={metal.metal_code} scope="col" className="px-3 text-right">
                  {t("stock.metalColumn", { metal: metal.name_th })}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.by_branch.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={metals.length + 1} className="h-24 text-center text-muted-foreground">
                  {t("stock.empty")}
                </TableCell>
              </TableRow>
            ) : (
              data.by_branch.map((row) => (
                <TableRow key={row.branch.id}>
                  <TableHead scope="row" className="px-3 font-normal">
                    {t("branchLabel", { code: row.branch.code, name: row.branch.name })}
                  </TableHead>
                  {metals.map((metal) => (
                    <NumberCell key={metal.metal_code}>
                      {formatWeight(row.by_metal.find((cell) => cell.metal_code === metal.metal_code)?.grams)}
                    </NumberCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="row" className="px-3">
                {t("stock.total")}
              </TableHead>
              {metals.map((metal) => (
                <NumberCell key={metal.metal_code}>{formatWeight(metal.grams)}</NumberCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </TableFrame>
    </section>
  );
}
