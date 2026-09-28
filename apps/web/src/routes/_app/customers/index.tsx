import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { createColumnHelper } from "@tanstack/react-table";
import { CircleAlert, UserPlus } from "lucide-react";
import { type KeyboardEvent, useEffect, useEffectEvent, useId, useMemo, useState } from "react";
import { z } from "zod";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CardStatusBadge } from "@/features/customers/card-status";
import { useTranslation } from "@/features/customers/i18n";
import { type CustomerListItem, MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, normalizeQuery } from "@/features/customers/model";
import { customerListQuery } from "@/features/customers/queries";
import { useCustomerSync } from "@/features/customers/sync";
import { EMPTY } from "@/lib/format";

const SearchSchema = z.object({
  // router แปลงค่าที่เป็นตัวเลขล้วนใน URL เป็น number (?q=0812345678 จากที่พิมพ์เอง) — แปลงกลับเป็นข้อความ
  q: z.coerce.string().trim().max(MAX_QUERY_LENGTH).default("").catch(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});

export const Route = createFileRoute("/_app/customers/")({
  validateSearch: SearchSchema,
  search: { middlewares: [stripSearchParams({ q: "", page: 1 })] },
  staticData: { title: "ลูกค้า" },
  component: CustomersPage,
});

const DEBOUNCE_MS = 300;
const column = createColumnHelper<CustomerListItem>();

/** /customers — ค้นและเลือกลูกค้า (ชื่อไทย/อังกฤษ · เลขบัตร · เบอร์) หน้าละ 20 ล่าสุดก่อน */
function CustomersPage() {
  const { t } = useTranslation("customers");
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  useCustomerSync();

  // q 1 ตัวอักษร (พิมพ์ URL เอง) API ตอบ 400 — แสดงทั้งหมดแทน
  const q = search.q.length < MIN_QUERY_LENGTH ? "" : search.q;
  const list = useQuery(customerListQuery({ q, page: search.page }));

  const columns = useMemo(
    () => [
      column.accessor("national_id_masked", {
        header: t("list.columns.nationalId"),
        // มาสก์จาก API เสมอ (R13) — หน้านี้ไม่มีเลขเต็ม
        cell: (info) => <span className="font-mono whitespace-nowrap tabular-nums">{info.getValue()}</span>,
      }),
      column.accessor("name_th", {
        header: t("list.columns.name"),
        // ลิงก์จริง = ทางหลักของคีย์บอร์ด/screen reader · คลิกที่แถวเป็นทางลัดของเมาส์
        cell: (info) => (
          <Link
            to="/customers/$id"
            params={{ id: info.row.original.id }}
            className="font-medium underline-offset-4 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {info.getValue()}
          </Link>
        ),
      }),
      column.accessor("mobile", {
        header: t("list.columns.mobile"),
        cell: (info) => <span className="whitespace-nowrap tabular-nums">{info.getValue() || EMPTY}</span>,
      }),
      column.accessor("card_status", {
        header: t("list.columns.cardStatus"),
        cell: (info) => <CardStatusBadge status={info.getValue()} />,
      }),
      column.accessor("address", {
        header: t("list.columns.address"),
        cell: (info) => <span className="line-clamp-1 max-w-sm">{info.getValue() || EMPTY}</span>,
      }),
    ],
    [t],
  );

  return (
    <>
      <PageHeader
        actions={
          <Button asChild>
            <Link to="/customers/new">
              <UserPlus aria-hidden="true" />
              {t("list.add")}
            </Link>
          </Button>
        }
      />
      <SearchBox q={q} onSearch={(value) => void navigate({ search: { q: value, page: 1 }, replace: true })} />
      {list.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-3 text-destructive">
            {t("list.loadFailed")}
            <Button type="button" variant="outline" size="sm" onClick={() => void list.refetch()}>
              {t("list.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <DataTable
        caption={q ? t("list.captionSearch", { q }) : t("list.caption")}
        columns={columns}
        data={list.data?.items ?? []}
        getRowId={(customer) => customer.id}
        page={search.page}
        hasMore={list.data?.has_more ?? false}
        onPageChange={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
        onRowClick={(customer) => void navigate({ to: "/customers/$id", params: { id: customer.id } })}
        isLoading={list.isPending}
        emptyMessage={q ? t("list.emptySearch", { q }) : t("list.empty")}
      />
    </>
  );
}

/**
 * ช่องค้น — พิมพ์แล้วรอ 300 ms จึงค้น · Enter ค้นทันที · Esc ล้าง
 * คำค้นที่ส่งได้ (normalizeQuery) เท่านั้นที่ขึ้น URL · ย้อนกลับ/ไปหน้าถัดในประวัติแล้วช่องตาม URL
 */
function SearchBox({ q, onSearch }: { q: string; onSearch: (q: string) => void }) {
  const { t } = useTranslation("customers");
  const id = useId();
  const [draft, setDraft] = useState(q);
  // คำค้นล่าสุดที่ช่องนี้ส่งเอง — q ใน URL ต่างจากนี้ = เปลี่ยนจากภายนอก (ประวัติ · ลิงก์) ให้ช่องตาม
  const [committed, setCommitted] = useState(q);
  if (q !== committed) {
    setCommitted(q);
    setDraft(q);
  }

  const term = normalizeQuery(draft);
  const tooShort = term.length > 0 && term.length < MIN_QUERY_LENGTH;

  const commit = (value: string) => {
    if (value === committed) return;
    setCommitted(value);
    onSearch(value);
  };
  const onDebounced = useEffectEvent(commit);
  useEffect(() => {
    if (tooShort || term === committed) return;
    const timer = setTimeout(() => onDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, tooShort, committed]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !tooShort) {
      event.preventDefault();
      commit(term);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft("");
      commit("");
    }
  };

  return (
    <Field className="max-w-xl">
      <FieldLabel htmlFor={id}>{t("list.searchLabel")}</FieldLabel>
      <Input
        id={id}
        type="search"
        // หน้ารายการลูกค้าเปิดมาเพื่อค้น — คีย์บอร์ดพิมพ์ได้ทันที
        autoFocus
        autoComplete="off"
        spellCheck={false}
        placeholder={t("list.searchPlaceholder")}
        aria-describedby={`${id}-hint`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <FieldDescription id={`${id}-hint`} aria-live="polite">
        {t(tooShort ? "list.tooShort" : "list.searchHint")}
      </FieldDescription>
    </Field>
  );
}
