import { type UseQueryResult, keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { CircleAlert } from "lucide-react";
import { useEffect, useEffectEvent, useId, useMemo } from "react";
import { useTranslation as useCommonTranslation } from "react-i18next";
import { AppForm } from "@/components/app-form";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { ThaiDateField } from "@/components/thai-date-field";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAppForm } from "@/hooks/use-app-form";
import { useBusinessDate } from "@/hooks/use-business-date";
import { ApiError } from "@/lib/api";
import { formatInteger, formatMoney, formatWeight } from "@/lib/format";
import { useMe } from "@/lib/queries";
import { formatDocDateTime } from "@/lib/thai-date";
import { useTranslation } from "./i18n";
import {
  type PurchaseParams,
  type PurchaseReport,
  type PurchaseRow,
  purchaseCsvHref,
  purchaseReportQueryOptions,
} from "./queries";
import { purchaseFilterSchema } from "./filter-schema";
import {
  ApplyButton,
  BranchSelect,
  CsvDownloadButton,
  MetalSelect,
  NumberCell,
  ReportForbidden,
  ReportLoadError,
  ReportSkeleton,
  TableFrame,
} from "./report-parts";
import { csvNameSuffix } from "./csv-name";
import { type FieldProblem, fieldProblem, problemOf } from "./report-problem";
import { type DatePreset, type PurchaseSearch, isoToThaiInput, monthStart, presetRange } from "./search";

const route = getRouteApi("/_app/reports/purchase");

const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

/**
 * /reports/purchase — รายงานยอดซื้อ (finance_report3) · manager · accounting · admin
 * ตัวกรองอยู่ใน URL (ISO) → query ของ API ตรงตัว · ยอดรวมทุกตัวมาจาก API — browser ไม่บวกเลขเอง
 */
export function PurchaseReportPage() {
  const { t } = useTranslation("reports");
  const { t: tc } = useCommonTranslation("common");
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const me = useMe();
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
          <CsvDownloadButton
            href={purchaseCsvHref(params)}
            disabled={!validRange}
            fallbackName={t("csv.purchaseFile", {
              from: params.date_from,
              to: params.date_to,
              suffix: csvNameSuffix(me.branches.find((branch) => branch.id === params.branch_id)?.code, params.metal),
            })}
          />
        }
      />
      <PurchaseFilters
        applied={params}
        loading={report.isFetching}
        problem={fieldProblem(report.error)}
        onApply={(next) => void navigate({ search: next })}
      />
      {validRange ? (
        <PurchaseResults report={report} />
      ) : (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>{tc("dateField.range")}</AlertTitle>
        </Alert>
      )}
    </>
  );
}

interface FilterValues {
  date_from: string;
  date_to: string;
  metal: string;
  branch_id: string;
}

const toValues = (p: PurchaseParams): FilterValues => ({
  date_from: isoToThaiInput(p.date_from),
  date_to: isoToThaiInput(p.date_to),
  metal: p.metal ?? "",
  branch_id: p.branch_id ?? "",
});

/** ค่าที่ตรวจแล้ว (วันที่เป็น ISO) → search ของ URL (ไม่ใส่ key ที่ไม่ได้กรอง) */
const toSearch = (v: FilterValues): PurchaseSearch => ({
  date_from: v.date_from,
  date_to: v.date_to,
  ...(v.metal ? { metal: v.metal } : {}),
  ...(v.branch_id ? { branch_id: v.branch_id } : {}),
});

/**
 * ตัวกรอง — ใช้ตัวกรองด้วย Enter ในช่องใดก็ได้ / ปุ่ม "แสดงรายงาน" · ตัวเลือก (โลหะ · สาขา) และปุ่มลัดช่วงวันที่ใช้ทันที
 * (เหมือนหน้าค้นบิล) · วันที่ที่พิมพ์ต้องกด Enter/ปุ่ม เพราะรายงานคำนวณยอดรวมทั้งช่วง หนักกว่ารายการบิล —
 * ไม่ยิงทุกครั้งที่ออกจากช่อง · ผิดรูป/ช่วงกลับด้านแจ้งใต้ช่องก่อนยิง API (U2)
 * ลิงก์ CSV และตัวเลขบนจอเป็นของตัวกรองที่ใช้แล้ว (URL) เสมอ ไม่ใช่ค่าที่ยังพิมพ์ค้างอยู่
 */
function PurchaseFilters({
  applied,
  loading,
  problem,
  onApply,
}: {
  applied: PurchaseParams;
  loading: boolean;
  problem: FieldProblem | undefined;
  onApply: (next: PurchaseSearch) => void;
}) {
  const { t } = useTranslation("reports");
  const { t: tc } = useCommonTranslation("common");
  const today = useBusinessDate();
  const schema = useMemo(() => purchaseFilterSchema(tc), [tc]);
  const f = useAppForm({
    defaultValues: toValues(applied),
    schema,
    submit: (values) => Promise.resolve(values),
    onSuccess: (values) => onApply(toSearch(values)),
  });

  // URL เปลี่ยนจากทางอื่น (ย้อนกลับ/ไปต่อ · ปุ่มลัด) → ช่องแสดงค่าที่ใช้อยู่จริง โดยไม่ remount ฟอร์ม (โฟกัสไม่หลุด)
  const appliedKey = JSON.stringify(applied);
  const syncFromUrl = useEffectEvent(() => f.form.reset(toValues(applied)));
  useEffect(() => syncFromUrl(), [appliedKey]);

  const applyPreset = (preset: DatePreset) => {
    const range = presetRange(preset, today);
    const { metal, branch_id } = f.form.state.values;
    f.form.setFieldValue("date_from", isoToThaiInput(range.from));
    f.form.setFieldValue("date_to", isoToThaiInput(range.to));
    onApply(toSearch({ date_from: range.from, date_to: range.to, metal, branch_id }));
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
        <f.form.Field name="date_from">
          {(field) => {
            const bound = f.bind(field);
            return (
              <ThaiDateField
                {...bound}
                label={t("filters.dateFrom")}
                error={bound.error ?? problemOf(problem, "date_from")}
                onFormat={field.handleChange}
              />
            );
          }}
        </f.form.Field>
        <f.form.Field name="date_to">
          {(field) => {
            const bound = f.bind(field);
            return (
              <ThaiDateField
                {...bound}
                label={t("filters.dateTo")}
                error={bound.error ?? problemOf(problem, "date_to")}
                onFormat={field.handleChange}
              />
            );
          }}
        </f.form.Field>
        <f.form.Field name="metal">
          {(field) => {
            const bound = f.bind(field);
            return (
              <MetalSelect
                {...bound}
                error={bound.error ?? problemOf(problem, "metal")}
                onChange={(event) => {
                  bound.onChange(event);
                  f.submit();
                }}
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
    </AppForm>
  );
}

function PurchaseResults({ report }: { report: UseQueryResult<PurchaseReport> }) {
  const { t } = useTranslation("reports");
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

  return (
    <div aria-busy={report.isFetching} className="grid grid-cols-1 gap-4 md:gap-6">
      <p className="text-sm text-muted-foreground">
        {t("purchase.period", {
          from: isoToThaiInput(data.date_from),
          to: isoToThaiInput(data.date_to),
        })}
      </p>
      <PurchaseSummary total={data.total} />
      <div className="grid grid-cols-1 items-start gap-4 md:gap-6 xl:grid-cols-2">
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
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <div
            key={item.label}
            className="grid min-w-0 gap-1 rounded-xl border bg-card p-4 text-card-foreground shadow-sm"
          >
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="text-2xl font-semibold tabular-nums [overflow-wrap:anywhere]">{item.value}</dd>
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
    <section aria-labelledby={titleId} className="grid grid-cols-1 gap-3">
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
    <section aria-labelledby={titleId} className="grid grid-cols-1 gap-3">
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
            {formatDocDateTime(info.getValue(), info.row.original.time)}
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
        // ป้ายเดียวกับบนใบรับซื้อ ("ทอง 96.5% หัก 3%") — ชิ้นที่ % ต่างกันแยกบรรทัด · ป้ายไม่ซ้ำกันในบิลเดียว (API รวมกลุ่มแล้ว)
        cell: (info) => (
          <ul className="grid gap-0.5">
            {info.row.original.items.map((item) => (
              <li key={item.label} className="whitespace-nowrap tabular-nums">
                {t("purchase.rows.itemLine", {
                  item: item.label,
                  grams: formatWeight(item.grams),
                  amount: formatMoney(item.amount),
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
    <section aria-labelledby={titleId} className="grid grid-cols-1 gap-3">
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
