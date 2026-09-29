import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { metalsQuery } from "@/features/buy/queries";
import { useBusinessDate } from "@/hooks/use-business-date";
import { ApiError, errorMessage } from "@/lib/api";
import { formatInteger, formatMoney, formatWeight } from "@/lib/format";
import { type Branch, useMe } from "@/lib/queries";
import { looksLikeNationalId } from "@/lib/sensitive-query";
import { isoToThaiInput, todayIso } from "@/lib/thai-date";
import { cn } from "@/lib/utils";
import { type BillListTotals, buyListQuery } from "./api";
import { makeBillColumns } from "./bill-columns";
import { useTranslation } from "./i18n";
import {
  type BillsSearch,
  DATE_PRESETS,
  type DateRange,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  cleanQuery,
  parseDateFilter,
  toListParams,
} from "./search";
import { type UrlDraft, useUrlDraft } from "./use-url-draft";

const route = getRouteApi("/_app/bills");

/** หน่วงคำค้นก่อนส่งเข้า URL — พิมพ์ต่อเนื่องไม่ยิง API ทุกตัวอักษร */
const SEARCH_DEBOUNCE_MS = 300;

const FILTER_KEYS = ["q", "from", "to", "metal", "branch"] as const;
type FilterPatch = Partial<Pick<BillsSearch, (typeof FILTER_KEYS)[number]>>;

/** ตัวกรองใหม่ — มีช่องไหนเปลี่ยนจริงจึงกลับไปหน้า 1 (ค่าเดิมทุกช่อง = คงหน้าเดิม) */
function withFilters(prev: BillsSearch, patch: FilterPatch): BillsSearch {
  const next = { ...prev, ...patch };
  return FILTER_KEYS.some((key) => next[key] !== prev[key]) ? { ...next, page: undefined } : prev;
}

/** ช่องที่ API ชี้ได้ใน 400 และมีช่องกรอกให้แสดง error ใต้ช่อง */
interface FieldProblem {
  field: "q" | "date_from" | "date_to";
  message: string;
}

function fieldProblem(error: Error | null): FieldProblem | undefined {
  if (!(error instanceof ApiError) || error.status !== 400) return undefined;
  const { field } = error;
  return field === "q" || field === "date_from" || field === "date_to" ? { field, message: error.error } : undefined;
}

/** รวม id ของคำอธิบาย/ข้อผิดพลาดที่มีอยู่จริง สำหรับ aria-describedby */
function describedBy(...ids: (string | false | undefined)[]): string | undefined {
  const present = ids.filter((id): id is string => !!id);
  return present.length > 0 ? present.join(" ") : undefined;
}

/** Enter เปล่า ๆ ที่ไม่ได้อยู่ระหว่างพิมพ์แบบ IME */
const isEnter = (e: KeyboardEvent) => e.key === "Enter" && !e.nativeEvent.isComposing;

/**
 * ค้นบิลซื้อเข้าย้อนหลัง (spec §3) — ตัวกรองทั้งหมดอยู่ใน URL: กลับจากหน้าบิลได้ผลเดิม · ส่งลิงก์ต่อกันได้
 * ไม่ใส่ตัวกรอง = ทุกวันที่ ทุกสาขาที่อ่านได้ ใหม่สุดก่อน · ยอดรวมมาจาก API (ไม่รวมในหน้าเว็บ)
 */
export function BillsPage() {
  const { t } = useTranslation("bills");
  const me = useMe();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  // เลขบัตรประชาชนเต็ม 13 หลักที่พิมพ์ค้น: ใช้ค้นได้แต่ไม่เก็บลง URL (ต่างจากตัวกรองอื่นที่อยู่ใน URL ทั้งหมด)
  const [sensitiveQuery, setSensitiveQuery] = useState<string | undefined>(undefined);
  const effectiveSearch = sensitiveQuery === undefined ? search : { ...search, q: sensitiveQuery };
  // ค้างผลของตัวกรองก่อนหน้าไว้ระหว่างโหลด ตารางไม่กระพริบ — ยอดรวมขึ้น "กำลังค้นหา…" แทนยอดเก่า
  const list = useQuery({ ...buyListQuery(toListParams(effectiveSearch)), placeholderData: keepPreviousData });

  const showBranchFilter = me.branches.length > 1;
  const columns = useMemo(
    () => makeBillColumns({ t, showBranch: showBranchFilter && !search.branch, compact: false }),
    [t, showBranchFilter, search.branch],
  );

  // replace: ปุ่มย้อนกลับของ browser ออกจากหน้านี้ ไม่ไล่ย้อนตัวกรองทีละขั้น
  // ตัวกรองทางปกติทุกตัวรวมถึงคำค้นที่ไม่ใช่เลขบัตร ทับคำค้นที่พิมพ์เข้ามาก่อนหน้าเสมอ
  const applyFilters = (patch: FilterPatch) => {
    setSensitiveQuery(undefined);
    void navigate({ search: (prev) => withFilters(prev, patch), replace: true });
  };
  const clearFilters = () => {
    setSensitiveQuery(undefined);
    void navigate({ search: {}, replace: true });
  };
  // เลขบัตรประชาชนเต็ม 13 หลัก: เก็บไว้ในหน้านี้เท่านั้น ล้างเลขหน้าใน URL เหมือนตัวกรองอื่นเปลี่ยน
  const applySensitiveQuery = (q: string) => {
    setSensitiveQuery(q);
    void navigate({ search: (prev) => ({ ...prev, page: undefined }), replace: true });
  };
  const goToPage = (page: number) =>
    void navigate({ search: (prev) => ({ ...prev, page: page > 1 ? page : undefined }), replace: true });

  const problem = fieldProblem(list.error);

  return (
    <>
      <PageHeader />
      <BillFilters
        search={search}
        branches={showBranchFilter ? me.branches : null}
        problem={problem}
        onApply={applyFilters}
        onSensitiveQuery={applySensitiveQuery}
        onClear={clearFilters}
      />
      {list.error && !problem && (
        <Alert variant="destructive">
          <AlertTitle>{t("results.error")}</AlertTitle>
          <AlertDescription>
            <p>{errorMessage(list.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
              {t("retry", { ns: "common" })}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {(list.data || list.isPending) && (
        <div className="grid gap-3" aria-busy={list.isPlaceholderData}>
          <DataTable
            columns={columns}
            data={list.data?.items ?? []}
            caption={t("results.caption")}
            page={list.data?.page ?? search.page ?? 1}
            hasMore={list.data?.has_more ?? false}
            onPageChange={goToPage}
            isLoading={list.isPending}
            getRowId={(bill) => bill.id}
            emptyMessage={t("results.empty")}
          />
          {list.data && <BillTotals totals={list.data.totals} stale={list.isPlaceholderData} />}
        </div>
      )}
    </>
  );
}

interface BillFiltersProps {
  search: BillsSearch;
  /** สาขาให้เลือก — null = ผู้ใช้มีสาขาเดียว ไม่แสดงช่องสาขา */
  branches: Branch[] | null;
  /** 400 ของ API ที่ชี้ช่องค้น/วันที่ */
  problem: FieldProblem | undefined;
  onApply: (patch: FilterPatch) => void;
  /** คำค้นเป็นเลขบัตรประชาชนเต็ม 13 หลัก — ค้นได้แต่ไม่ผ่าน onApply (ไม่ลง URL) */
  onSensitiveQuery: (q: string) => void;
  onClear: () => void;
}

/** การ์ดตัวกรอง — ลำดับ DOM = ลำดับ Tab: คำค้น → วันที่ → โลหะ → สาขา → ช่วงวันที่สำเร็จรูป → ล้าง */
function BillFilters({ search, branches, problem, onApply, onSensitiveQuery, onClear }: BillFiltersProps) {
  const { t } = useTranslation("bills");
  const id = useId();
  const today = useBusinessDate();
  const { data: metals = [] } = useQuery(metalsQuery);

  const query = useUrlDraft(search.q ?? "", (value) => value, cleanQuery);
  const from = useUrlDraft(search.from ?? "", isoToThaiInput, parseDateFilter);
  const to = useUrlDraft(search.to ?? "", isoToThaiInput, parseDateFilter);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // ออกจากหน้าก่อนครบเวลาหน่วง (เช่น กดเปิดบิล) — คำค้นที่ค้างต้องไม่พากลับมาหน้านี้
  useEffect(() => () => clearTimeout(timer.current), []);

  /**
   * ส่งคำค้นเข้า URL — 1 ตัวอักษรไม่ส่ง (ช่องแสดงคำแนะนำ) · ช่องว่าง = เลิกกรอง
   * เลขบัตรประชาชนเต็ม 13 หลัก: ค้นเหมือนกันแต่ไม่ผ่าน onApply เพื่อไม่ให้เลขบัตรเต็มไปอยู่ใน URL
   */
  const commitQuery = (text: string) => {
    clearTimeout(timer.current);
    const q = cleanQuery(text);
    if (q.length > 0 && q.length < MIN_QUERY_LENGTH) return;
    query.commit(q);
    if (looksLikeNationalId(q)) {
      onSensitiveQuery(q);
      return;
    }
    onApply({ q: q || undefined });
  };

  const typeQuery = (text: string) => {
    query.edit(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => commitQuery(text), SEARCH_DEBOUNCE_MS);
  };

  /** blur / Enter — อ่านไม่ได้แสดง error ใต้ช่องและไม่แตะ URL · อ่านได้จัดรูปข้อความเป็น วว/ดด/ปปปป */
  const commitDate = (key: "from" | "to", draft: UrlDraft) => {
    const iso = parseDateFilter(draft.text);
    if (iso === null) {
      draft.fail(t("filters.dateInvalid"));
      return;
    }
    draft.commit(iso, isoToThaiInput(iso));
    const value = iso || undefined;
    if (value !== search[key]) onApply(key === "from" ? { from: value } : { to: value });
  };

  const applyPreset = (range: DateRange) => {
    from.reset(range.from ?? "");
    to.reset(range.to ?? "");
    onApply({ from: range.from, to: range.to });
  };

  const clear = () => {
    clearTimeout(timer.current);
    query.reset("");
    from.reset("");
    to.reset("");
    onClear();
  };

  const typedQuery = cleanQuery(query.text);
  const queryTooShort = typedQuery.length > 0 && typedQuery.length < MIN_QUERY_LENGTH;
  const queryError = problem?.field === "q" ? problem.message : undefined;

  return (
    <Card role="search" aria-label={t("filters.region")}>
      <CardContent className="grid gap-4">
        <Field data-invalid={!!queryError} className="max-w-xl">
          <FieldLabel htmlFor={`${id}-q`}>{t("filters.search")}</FieldLabel>
          <Input
            id={`${id}-q`}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={MAX_QUERY_LENGTH}
            placeholder={t("filters.searchPlaceholder")}
            value={query.text}
            onChange={(e) => typeQuery(e.target.value)}
            onKeyDown={(e) => {
              if (!isEnter(e)) return;
              e.preventDefault();
              commitQuery(e.currentTarget.value);
            }}
            aria-invalid={!!queryError}
            aria-describedby={describedBy(queryTooShort && `${id}-q-hint`, queryError && `${id}-q-error`)}
          />
          {/* live region อยู่ตลอด (ซ่อนแบบ sr-only เมื่อว่าง) — คำแนะนำที่โผล่ขึ้นมาจึงถูกอ่านออกเสียง */}
          <FieldDescription id={`${id}-q-hint`} aria-live="polite" className={cn(!queryTooShort && "sr-only")}>
            {queryTooShort ? t("filters.searchTooShort") : null}
          </FieldDescription>
          <FieldError id={`${id}-q-error`}>{queryError}</FieldError>
        </Field>

        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DateField
            id={`${id}-from`}
            label={t("filters.from")}
            draft={from}
            error={from.error ?? (problem?.field === "date_from" ? problem.message : undefined)}
            onCommit={() => commitDate("from", from)}
          />
          <DateField
            id={`${id}-to`}
            label={t("filters.to")}
            draft={to}
            error={to.error ?? (problem?.field === "date_to" ? problem.message : undefined)}
            onCommit={() => commitDate("to", to)}
          />
          <FilterSelect
            id={`${id}-metal`}
            label={t("filters.metal")}
            allLabel={t("filters.allMetals")}
            value={search.metal}
            options={metals.map((metal) => ({ value: metal.code, label: metal.name_th }))}
            onChange={(metal) => onApply({ metal })}
          />
          {branches && (
            <FilterSelect
              id={`${id}-branch`}
              label={t("filters.branch")}
              allLabel={t("filters.allBranches")}
              value={search.branch}
              options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
              onChange={(branch) => onApply({ branch })}
            />
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label={t("filters.presets")} className="flex flex-wrap gap-2">
            {DATE_PRESETS.map((preset) => {
              const range = preset.range(today);
              const pressed = range.from === search.from && range.to === search.to;
              return (
                <Button
                  key={preset.label}
                  size="sm"
                  variant={pressed ? "default" : "outline"}
                  aria-pressed={pressed}
                  onClick={() => applyPreset(preset.range(todayIso()))}
                >
                  {t(preset.label)}
                </Button>
              );
            })}
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={clear}>
            {t("filters.clear")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface DateFieldProps {
  id: string;
  label: string;
  draft: UrlDraft;
  error: string | undefined;
  onCommit: () => void;
}

/** ช่องวันที่ พ.ศ. แบบพิมพ์เอง (CLAUDE.md กฎ 6: `<input type="text">` ห้าม date picker / input mask) */
function DateField({ id, label, draft, error, onCommit }: DateFieldProps) {
  const { t } = useTranslation("bills");
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="text"
        autoComplete="off"
        placeholder={t("filters.datePlaceholder")}
        value={draft.text}
        onChange={(e) => draft.edit(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (!isEnter(e)) return;
          e.preventDefault();
          onCommit();
        }}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="tabular-nums"
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}

/** หน้าตาเดียวกับ Input (โทนสีจาก token ใช้ได้ทั้งโหมดสว่าง/มืด) */
const SELECT_CLASS =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-base text-foreground shadow-xs outline-none md:text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

interface FilterSelectProps {
  id: string;
  label: string;
  /** ตัวเลือกแรก = ไม่กรอง */
  allLabel: string;
  value: string | undefined;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}

/** `<select>` ของ browser — ไม่มีป๊อปอัปแย่งโฟกัส · ใช้คีย์บอร์ดได้เอง */
function FilterSelect({ id, label, allLabel, value, options, onChange }: FilterSelectProps) {
  // ค่าใน URL ที่ไม่อยู่ในรายการ (ลิงก์เก่า · รายการยังโหลดไม่เสร็จ) แสดงเป็นตัวเลือกดิบ — ช่องต้องตรงกับตัวกรองที่ใช้จริง
  const unlisted = value && !options.some((option) => option.value === value) ? value : null;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={SELECT_CLASS}
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {unlisted && <option value={unlisted}>{unlisted}</option>}
      </select>
    </Field>
  );
}

/** ยอดท้ายตาราง — ของทุกหน้าตามตัวกรอง จาก API ตรง ๆ · ระหว่างโหลดตัวกรองใหม่ไม่โชว์ยอดของตัวกรองเก่า */
function BillTotals({ totals, stale }: { totals: BillListTotals; stale: boolean }) {
  const { t } = useTranslation("bills");
  return (
    <div className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 text-right">
      <p aria-live="polite" className="font-medium tabular-nums">
        {stale
          ? t("results.loading")
          : t("results.totals", {
              count: formatInteger(totals.count),
              weight: formatWeight(totals.total_weight),
              amount: formatMoney(totals.total_amount),
            })}
      </p>
      {!stale && <p className="text-sm text-muted-foreground">{t("results.totalsNote")}</p>}
    </div>
  );
}
