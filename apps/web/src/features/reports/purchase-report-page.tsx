import { type UseQueryResult, keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { CircleAlert } from "lucide-react";
import { type FormEvent, useId, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBusinessDate } from "@/hooks/use-business-date";
import { ApiError } from "@/lib/api";
import { formatInteger, formatMoney, formatThaiDate, formatWeight } from "@/lib/format";
import { useTranslation } from "./i18n";
import {
  type PurchaseParams,
  type PurchaseReport,
  type PurchaseRow,
  purchaseCsvHref,
  purchaseReportQueryOptions,
} from "./queries";
import {
  BranchSelect,
  CsvLink,
  MetalSelect,
  NumberCell,
  ReportForbidden,
  ReportLoadError,
  ReportSkeleton,
  TableFrame,
  ThaiDateField,
} from "./report-parts";
import {
  type DatePreset,
  type PurchaseSearch,
  isoToThaiInput,
  monthStart,
  parseDateInput,
  presetRange,
} from "./search";

const route = getRouteApi("/_app/reports/purchase");

const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

/**
 * /reports/purchase — รายงานยอดซื้อ (finance_report3) · manager · accounting · admin
 * ตัวกรองอยู่ใน URL (ISO) → query ของ API ตรงตัว · ยอดรวมทุกตัวมาจาก API — browser ไม่บวกเลขเอง
 */
export function PurchaseReportPage() {
  const { t } = useTranslation("reports");
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const today = useBusinessDate();
  // ไม่ระบุช่วง = วันที่ 1 ของเดือนนี้ ถึงวันนี้ (ตามเวลาไทย) — ค่าเดียวกับค่าเริ่มต้นของ API
  const params: PurchaseParams = {
    date_from: search.date_from ?? monthStart(today),
    date_to: search.date_to ?? today,
    metal: search.metal,
    branch_id: search.branch_id,
  };
  const validRange = params.date_from <= params.date_to;
  const report = useQuery({
    ...purchaseReportQueryOptions(params),
    enabled: validRange,
    placeholderData: keepPreviousData,
  });

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
        description={t("purchase.description")}
        actions={
          <CsvLink
            href={purchaseCsvHref(params)}
            filename={t("csv.purchaseFile", { from: params.date_from, to: params.date_to })}
          />
        }
      />
      <PurchaseFilters applied={params} onApply={(next) => void navigate({ search: next })} />
      {validRange ? (
        <PurchaseResults report={report} />
      ) : (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{t("filters.errors.range")}</AlertTitle>
        </Alert>
      )}
    </>
  );
}

interface FilterValues {
  from: string;
  to: string;
  metal: string;
  branch: string;
}

const toValues = (p: PurchaseParams): FilterValues => ({
  from: isoToThaiInput(p.date_from),
  to: isoToThaiInput(p.date_to),
  metal: p.metal ?? "",
  branch: p.branch_id ?? "",
});

/** ค่าในฟอร์ม → search ของ URL (ไม่ใส่ key ที่ไม่ได้กรอง) */
const toSearch = (from: string, to: string, v: FilterValues): PurchaseSearch => ({
  date_from: from,
  date_to: to,
  ...(v.metal ? { metal: v.metal } : {}),
  ...(v.branch ? { branch_id: v.branch } : {}),
});

/**
 * ตัวกรอง — Enter ในช่องใดก็ได้ / ปุ่ม "แสดงรายงาน" = ใช้ตัวกรอง · ปุ่มลัดช่วงวันที่ใช้ทันที
 * ลิงก์ CSV และตัวเลขบนจอเป็นของตัวกรองที่ใช้แล้ว (URL) เสมอ ไม่ใช่ค่าที่ยังพิมพ์ค้างอยู่
 */
function PurchaseFilters({ applied, onApply }: { applied: PurchaseParams; onApply: (next: PurchaseSearch) => void }) {
  const { t } = useTranslation("reports");
  const ids = useId();
  const today = useBusinessDate();
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState(() => toValues(applied));
  const [errors, setErrors] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });

  // URL เปลี่ยนจากทางอื่น (ย้อนกลับ/ไปต่อ · ปุ่มลัด) → ช่องแสดงค่าที่ใช้อยู่จริง โดยไม่ remount ฟอร์ม (โฟกัสไม่หลุด)
  const appliedKey = JSON.stringify(applied);
  const [syncedKey, setSyncedKey] = useState(appliedKey);
  if (appliedKey !== syncedKey) {
    setSyncedKey(appliedKey);
    setValues(toValues(applied));
    setErrors({ from: null, to: null });
  }

  const change = (patch: Partial<FilterValues>) => {
    setValues((current) => ({ ...current, ...patch }));
    if (patch.from !== undefined) setErrors((current) => ({ ...current, from: null }));
    if (patch.to !== undefined) setErrors((current) => ({ ...current, to: null }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const from = parseDateInput(values.from);
    const to = parseDateInput(values.to);
    const next = {
      from: "error" in from ? t(`filters.errors.${from.error}`) : null,
      to:
        "error" in to
          ? t(`filters.errors.${to.error}`)
          : "iso" in from && from.iso > to.iso
            ? t("filters.errors.range")
            : null,
    };
    if (next.from || next.to || !("iso" in from) || !("iso" in to)) {
      setErrors(next);
      (next.from ? fromRef : toRef).current?.focus();
      return;
    }
    onApply(toSearch(from.iso, to.iso, values));
  };

  const applyPreset = (preset: DatePreset) => {
    const range = presetRange(preset, today);
    setValues((current) => ({ ...current, from: isoToThaiInput(range.from), to: isoToThaiInput(range.to) }));
    setErrors({ from: null, to: null });
    onApply(toSearch(range.from, range.to, values));
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
          id={`${ids}-from`}
          inputRef={fromRef}
          label={t("filters.dateFrom")}
          value={values.from}
          error={errors.from}
          onChange={(from) => change({ from })}
        />
        <ThaiDateField
          id={`${ids}-to`}
          inputRef={toRef}
          label={t("filters.dateTo")}
          value={values.to}
          error={errors.to}
          onChange={(to) => change({ to })}
        />
        <MetalSelect id={`${ids}-metal`} value={values.metal} onChange={(metal) => change({ metal })} />
        <BranchSelect id={`${ids}-branch`} value={values.branch} onChange={(branch) => change({ branch })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit">{t("filters.apply")}</Button>
        <div role="group" aria-label={t("filters.presets")} className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => applyPreset("thisMonth")}>
            {t("filters.thisMonth")}
          </Button>
          <Button type="button" variant="outline" onClick={() => applyPreset("lastMonth")}>
            {t("filters.lastMonth")}
          </Button>
          <Button type="button" variant="outline" onClick={() => applyPreset("today")}>
            {t("filters.today")}
          </Button>
        </div>
      </div>
    </form>
  );
}

function PurchaseResults({ report }: { report: UseQueryResult<PurchaseReport> }) {
  const { t } = useTranslation("reports");
  const data = report.data;
  if (data === undefined) {
    return report.isError ? (
      <ReportLoadError error={report.error} onRetry={() => void report.refetch()} />
    ) : (
      <ReportSkeleton />
    );
  }

  return (
    <div aria-busy={report.isFetching} className="grid gap-4 md:gap-6">
      <p className="text-sm text-muted-foreground">
        {t("purchase.period", {
          from: formatThaiDate(data.date_from, "long"),
          to: formatThaiDate(data.date_to, "long"),
        })}
      </p>
      <PurchaseSummary total={data.total} />
      <div className="grid items-start gap-4 md:gap-6 xl:grid-cols-2">
        <ByBranchTable report={data} />
        <ByMetalTable report={data} />
      </div>
      <BillRows rows={data.rows} />
    </div>
  );
}

/** การ์ดสรุป — จำนวนบิล · น้ำหนัก · ยอดเงิน จาก `total` ของ API */
function PurchaseSummary({ total }: { total: PurchaseReport["total"] }) {
  const { t } = useTranslation("reports");
  const titleId = useId();
  const items = [
    { label: t("purchase.summary.count"), value: formatInteger(total.count) },
    { label: t("purchase.summary.weight"), value: formatWeight(total.total_weight) },
    { label: t("purchase.summary.amount"), value: formatMoney(total.total_amount) },
  ];
  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">
        {t("purchase.summary.title")}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="grid gap-1 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="text-lg font-semibold">
      {children}
    </h2>
  );
}

/** ยอดต่อสาขา + แถวรวมจาก `total` (ไม่บวกแถวเอง) */
function ByBranchTable({ report }: { report: PurchaseReport }) {
  const { t } = useTranslation("reports");
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <SectionTitle id={titleId}>{t("purchase.byBranch.title")}</SectionTitle>
      <TableFrame>
        <Table>
          <TableCaption className="sr-only">{t("purchase.byBranch.caption")}</TableCaption>
          <TableHeader className="bg-muted">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="px-3">
                {t("purchase.byBranch.branch")}
              </TableHead>
              <TableHead scope="col" className="px-3 text-right">
                {t("purchase.byBranch.count")}
              </TableHead>
              <TableHead scope="col" className="px-3 text-right">
                {t("purchase.byBranch.weight")}
              </TableHead>
              <TableHead scope="col" className="px-3 text-right">
                {t("purchase.byBranch.amount")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.by_branch.map((row) => (
              <TableRow key={row.branch.id}>
                <TableHead scope="row" className="px-3 font-normal">
                  {t("branchLabel", { code: row.branch.code, name: row.branch.name })}
                </TableHead>
                <NumberCell>{formatInteger(row.count)}</NumberCell>
                <NumberCell>{formatWeight(row.total_weight)}</NumberCell>
                <NumberCell>{formatMoney(row.total_amount)}</NumberCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="row" className="px-3">
                {t("purchase.byBranch.total")}
              </TableHead>
              <NumberCell>{formatInteger(report.total.count)}</NumberCell>
              <NumberCell>{formatWeight(report.total.total_weight)}</NumberCell>
              <NumberCell>{formatMoney(report.total.total_amount)}</NumberCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableFrame>
    </section>
  );
}

/** ยอดต่อประเภทโลหะ (รวมทุกสาขา) + แถวรวมจาก `total` */
function ByMetalTable({ report }: { report: PurchaseReport }) {
  const { t } = useTranslation("reports");
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <SectionTitle id={titleId}>{t("purchase.byMetal.title")}</SectionTitle>
      <TableFrame>
        <Table>
          <TableCaption className="sr-only">{t("purchase.byMetal.caption")}</TableCaption>
          <TableHeader className="bg-muted">
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col" className="px-3">
                {t("purchase.byMetal.metal")}
              </TableHead>
              <TableHead scope="col" className="px-3 text-right">
                {t("purchase.byMetal.weight")}
              </TableHead>
              <TableHead scope="col" className="px-3 text-right">
                {t("purchase.byMetal.amount")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.total.by_metal.map((metal) => (
              <TableRow key={metal.metal_code}>
                <TableHead scope="row" className="px-3 font-normal">
                  {metal.name_th}
                </TableHead>
                <NumberCell>{formatWeight(metal.grams)}</NumberCell>
                <NumberCell>{formatMoney(metal.amount)}</NumberCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="row" className="px-3">
                {t("purchase.byMetal.total")}
              </TableHead>
              <NumberCell>{formatWeight(report.total.total_weight)}</NumberCell>
              <NumberCell>{formatMoney(report.total.total_amount)}</NumberCell>
            </TableRow>
          </TableFooter>
        </Table>
      </TableFrame>
    </section>
  );
}

const column = createColumnHelper<PurchaseRow>();
const noPaging = () => undefined;

/** รายการบิล (ทั้งช่วงวันที่ในคำตอบเดียว) — เลขที่ใบเป็นลิงก์ไปหน้าบิล · เลขบัตรมาสก์จาก API */
function BillRows({ rows }: { rows: PurchaseRow[] }) {
  const { t } = useTranslation("reports");
  const titleId = useId();
  const columns = useMemo(
    () => [
      column.accessor("no", {
        header: t("purchase.rows.no"),
        cell: (info) => formatInteger(String(info.getValue())),
        meta: { numeric: true },
      }),
      column.accessor("doc_no", {
        header: t("purchase.rows.docNo"),
        cell: (info) => (
          <Link
            to="/buy/$id"
            params={{ id: info.row.original.id }}
            className="font-medium whitespace-nowrap underline underline-offset-4"
          >
            {info.getValue()}
          </Link>
        ),
      }),
      column.accessor("date", {
        header: t("purchase.rows.date"),
        cell: (info) => (
          <span className="whitespace-nowrap tabular-nums">
            {t("purchase.rows.dateTime", { date: formatThaiDate(info.getValue()), time: info.row.original.time })}
          </span>
        ),
      }),
      column.accessor((row) => row.branch.name, { id: "branch", header: t("purchase.rows.branch") }),
      column.accessor((row) => row.customer.name_th, {
        id: "customer",
        header: t("purchase.rows.customer"),
        cell: (info) => (
          <span className="grid">
            <span>{info.getValue()}</span>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {info.row.original.customer.national_id_masked}
            </span>
          </span>
        ),
      }),
      column.display({
        id: "items",
        header: t("purchase.rows.items"),
        cell: (info) => (
          <ul className="grid gap-0.5">
            {info.row.original.metals.map((metal) => (
              <li key={metal.metal_code} className="whitespace-nowrap tabular-nums">
                {t("purchase.rows.itemLine", {
                  metal: metal.name_th,
                  grams: formatWeight(metal.grams),
                  amount: formatMoney(metal.amount),
                })}
              </li>
            ))}
          </ul>
        ),
      }),
      column.accessor("total_weight", {
        header: t("purchase.rows.weight"),
        cell: (info) => formatWeight(info.getValue()),
        meta: { numeric: true },
      }),
      column.accessor("total_amount", {
        header: t("purchase.rows.amount"),
        cell: (info) => formatMoney(info.getValue()),
        meta: { numeric: true },
      }),
      column.accessor((row) => row.created_by.name, { id: "created_by", header: t("purchase.rows.createdBy") }),
    ],
    [t],
  );

  return (
    <section aria-labelledby={titleId} className="grid gap-3">
      <SectionTitle id={titleId}>{t("purchase.rows.title")}</SectionTitle>
      <DataTable
        columns={columns}
        data={rows}
        caption={t("purchase.rows.caption")}
        getRowId={(row) => row.id}
        page={1}
        hasMore={false}
        onPageChange={noPaging}
        emptyMessage={t("purchase.rows.empty")}
      />
    </section>
  );
}
