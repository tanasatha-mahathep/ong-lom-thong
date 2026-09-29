import { type UseQueryResult, keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { type FormEvent, useId, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
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
import { useBusinessDate } from "@/hooks/use-business-date";
import { ApiError } from "@/lib/api";
import { formatThaiDate, formatWeight } from "@/lib/format";
import { useTranslation } from "./i18n";
import { type StockParams, type StockReport, stockCsvHref, stockReportQueryOptions } from "./queries";
import {
  BranchSelect,
  CsvLink,
  NumberCell,
  ReportForbidden,
  ReportLoadError,
  ReportSkeleton,
  TableFrame,
  ThaiDateField,
} from "./report-parts";
import { type StockSearch, isoToThaiInput, lastMonth, parseDateInput } from "./search";

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
        actions={<CsvLink href={stockCsvHref(params)} filename={t("csv.stockFile", { asOf: params.as_of })} />}
      />
      <StockFilters applied={params} onApply={(next) => void navigate({ search: next })} />
      <StockResults report={report} />
    </>
  );
}

interface FilterValues {
  asOf: string;
  branch: string;
}

const toValues = (p: StockParams): FilterValues => ({ asOf: isoToThaiInput(p.as_of), branch: p.branch_id ?? "" });

const toSearch = (asOf: string, v: FilterValues): StockSearch => ({
  as_of: asOf,
  ...(v.branch ? { branch_id: v.branch } : {}),
});

/** ตัวกรอง — Enter / "แสดงรายงาน" = ใช้ตัวกรอง · ปุ่มลัดใช้ทันที */
function StockFilters({ applied, onApply }: { applied: StockParams; onApply: (next: StockSearch) => void }) {
  const { t } = useTranslation("reports");
  const ids = useId();
  const today = useBusinessDate();
  const asOfRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState(() => toValues(applied));
  const [error, setError] = useState<string | null>(null);

  // URL เปลี่ยนจากทางอื่น → ช่องแสดงค่าที่ใช้อยู่จริง โดยไม่ remount ฟอร์ม
  const appliedKey = JSON.stringify(applied);
  const [syncedKey, setSyncedKey] = useState(appliedKey);
  if (appliedKey !== syncedKey) {
    setSyncedKey(appliedKey);
    setValues(toValues(applied));
    setError(null);
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const asOf = parseDateInput(values.asOf);
    if ("error" in asOf) {
      setError(t(`filters.errors.${asOf.error}`));
      asOfRef.current?.focus();
      return;
    }
    onApply(toSearch(asOf.iso, values));
  };

  const applyDate = (iso: string) => {
    setValues((current) => ({ ...current, asOf: isoToThaiInput(iso) }));
    setError(null);
    onApply(toSearch(iso, values));
  };

  return (
    <form
      role="search"
      aria-label={t("filters.label")}
      noValidate
      onSubmit={submit}
      className="grid gap-4 rounded-lg border bg-card p-4"
    >
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <ThaiDateField
          id={`${ids}-as-of`}
          inputRef={asOfRef}
          label={t("filters.asOf")}
          value={values.asOf}
          error={error}
          onChange={(asOf) => {
            setValues((current) => ({ ...current, asOf }));
            setError(null);
          }}
        />
        <BranchSelect
          id={`${ids}-branch`}
          value={values.branch}
          onChange={(branch) => setValues((current) => ({ ...current, branch }))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{t("filters.apply")}</Button>
        <div role="group" aria-label={t("filters.presets")} className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => applyDate(today)}>
            {t("filters.today")}
          </Button>
          <Button type="button" variant="outline" onClick={() => applyDate(lastMonth(today).to)}>
            {t("filters.endOfLastMonth")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function StockResults({ report }: { report: UseQueryResult<StockReport> }) {
  const { t } = useTranslation("reports");
  const titleId = useId();
  const data = report.data;
  if (data === undefined) {
    return report.isError ? (
      <ReportLoadError error={report.error} onRetry={() => void report.refetch()} />
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
        <p className="text-sm text-muted-foreground">{t("stock.asOf", { date: formatThaiDate(data.as_of, "long") })}</p>
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
