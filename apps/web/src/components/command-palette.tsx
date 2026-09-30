import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, LoaderCircle, ReceiptText, RotateCw, Store, UserRound, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  CommandDialog,
  CommandDialogCommand,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DialogClose } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { buyListQuery } from "@/features/bills/api";
import { MAX_QUERY_LENGTH, MIN_QUERY_LENGTH, cleanQuery } from "@/features/bills/search";
import { CardStatusBadge } from "@/features/customers/card-status";
import { customerListQuery } from "@/features/customers/queries";
import type { CommandSearchState, SearchDestination } from "@/hooks/use-command-search";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatMoney } from "@/lib/format";
import type { Me } from "@/lib/queries";
import { type SearchPage, matchesQuery, searchActionsFor, searchPagesFor } from "@/lib/search-items";
import { looksLikeNationalId } from "@/lib/sensitive-query";
import { formatDocDateTime } from "@/lib/thai-date";
import { cn } from "@/lib/utils";

/** หน่วงคำค้นก่อนถาม API — พิมพ์ต่อเนื่องไม่ยิงทุกตัวอักษร (คำขอเก่ายกเลิกเองผ่าน signal ของ TanStack Query) */
const DEBOUNCE_MS = 250;
/** ผลต่อกลุ่ม — ที่เหลือดูได้ที่ "ดูทั้งหมด" */
const RESULT_LIMIT = 5;
/** ผลค้นมีคำค้นของผู้ใช้ (อาจเป็นเลขบัตรประชาชน) — ไม่เก็บใน cache ต่อหลังหน้าค้นหาเลิกแสดง */
const SEARCH_GC_MS = 0;

/** ข้อความรองในแถว — แถวที่เลือกอยู่ (พื้น accent) ใช้สีเข้ม: muted-foreground บน accent ต่ำกว่า 4.5:1 ในธีมสว่าง */
const SUBTLE = "text-muted-foreground group-data-[selected=true]/row:text-accent-foreground";
/** ป้ายปุ่ม — muted-foreground บนพื้น muted ของ Kbd ได้ 4.3:1 ในธีมสว่าง (ต่ำกว่า AA) จึงใช้ตัวอักษรเข้มขึ้น */
const KBD = "text-foreground/80";
/** แถวแจ้งสถานะ (กำลังค้น · ยังไม่ได้เลือกสาขา) — เลือกไม่ได้ แต่ตัวอักษรต้องอ่านได้ (ไม่จาง 50%) */
const INFO_ROW = "text-muted-foreground data-[disabled=true]:opacity-100";

/** ปุ่มที่ผู้ใช้เลื่อนแถวเอง — หลังจากนี้ผลที่มาใหม่ไม่ดึงแถวที่เลือกกลับไปบนสุด (จนกว่าจะพิมพ์คำใหม่) */
const MOVE_KEYS = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);

/**
 * ผลของคำค้นก่อนหน้าค้างไว้ระหว่างโหลดเฉพาะเมื่อพิมพ์ต่อ/ลบจากคำเดิม — ล้างช่องแล้วพิมพ์คำใหม่ = เริ่มค้นใหม่ ไม่โชว์ผลเก่า
 * (keepPreviousData ค้างผลข้ามการล้างช่องด้วย)
 */
function continuesFrom<T>(term: string) {
  return (previous: T | undefined, query: { queryKey: readonly unknown[] } | undefined): T | undefined => {
    const filters = query?.queryKey[2];
    const q = typeof filters === "object" && filters !== null && "q" in filters ? String(filters.q) : "";
    return q !== "" && (term.startsWith(q) || q.startsWith(term)) ? previous : undefined;
  };
}

/**
 * หน้าค้นหา (โหลดแบบ lazy จาก components/command-search.tsx) — combobox + listbox ของ cmdk ใน Dialog ของ Radix
 * กรองเอง (shouldFilter=false): หน้า/ทางลัดกรองในเครื่อง · ลูกค้า (ทั้งร้าน) และบิล (สาขาปัจจุบันเท่านั้น) กรองที่ API
 */
export function CommandPalette({ state, me }: { state: CommandSearchState; me: Me }) {
  const { t } = useTranslation("shell");
  return (
    <CommandDialog
      key={state.session}
      open={state.open}
      onOpenChange={(open) => {
        if (!open) state.close();
      }}
      title={t("search.title")}
      description={me.branch ? t("search.description", { name: me.branch.name }) : t("search.descriptionNoBranch")}
      showCloseButton={false}
      className="top-[max(1rem,10dvh)] translate-y-0 sm:max-w-xl"
      // PaletteBody ถือ <Command> เอง — คุมแถวที่เลือก (value) จากผลค้นที่มาไม่พร้อมกัน
      withCommand={false}
      onCloseAutoFocus={state.restoreFocus}
    >
      <PaletteBody me={me} onSelect={state.select} />
    </CommandDialog>
  );
}

function PaletteBody({ me, onSelect }: { me: Me; onSelect: (destination: SearchDestination) => void }) {
  const { t } = useTranslation("shell");
  const navigate = useNavigate();
  const hintId = useId();
  const [input, setInput] = useState("");
  const term = cleanQuery(input);
  const debounced = useDebouncedValue(term, DEBOUNCE_MS);
  /** ลูกค้า/บิลค้นได้เมื่อยาว ≥ 2 (1 ตัวอักษร API ตอบ 400) */
  const searching = term.length >= MIN_QUERY_LENGTH;
  const q = debounced.length >= MIN_QUERY_LENGTH ? debounced : "";
  const settled = debounced === term;
  const branch = me.branch;

  const customers = useQuery({
    ...customerListQuery({ q, page: 1 }),
    enabled: searching && q !== "",
    placeholderData: continuesFrom(term),
    gcTime: SEARCH_GC_MS,
  });
  // fail-closed: ยังไม่มีสาขาปัจจุบัน = ไม่ถามบิลเลย (ไม่ส่งแบบไม่มี branch_id ซึ่งได้ทุกสาขาที่อ่านได้)
  const bills = useQuery({
    ...buyListQuery({ q, branch_id: branch?.id }),
    enabled: searching && q !== "" && branch !== null,
    placeholderData: continuesFrom(term),
    gcTime: SEARCH_GC_MS,
  });

  const pageTexts = ({ item, group }: SearchPage) => [
    t(`nav.${item.title}`),
    t(`routes.${item.title}`),
    group ? t(`groups.${group}`) : "",
    item.to,
  ];
  const pages = searchPagesFor(me.role).filter((page) => matchesQuery(term, pageTexts(page)));
  const actions = searchActionsFor(me.role).filter((action) =>
    matchesQuery(term, [t(`search.actions.${action.key}`), t(`nav.${action.related}`), action.to]),
  );

  const customersLoading = searching && (!settled || q === "" || customers.isFetching);
  const customerItems = searching ? customers.data?.items.slice(0, RESULT_LIMIT) : undefined;
  const customersFailed = searching && !customersLoading && customers.isError;
  const billsSearchable = searching && branch !== null;
  const billsLoading = billsSearchable && (!settled || q === "" || bills.isFetching);
  const billItems = billsSearchable ? bills.data?.items.slice(0, RESULT_LIMIT) : undefined;
  const billsFailed = billsSearchable && !billsLoading && bills.isError;
  const loading = customersLoading || billsLoading;
  // เลขบัตรประชาชนห้ามลง URL (CLAUDE.md กฎ 7) — ผลในหน้าค้นหาคือคำตอบ ไม่มีลิงก์ "ดูทั้งหมด" ที่พา q ไปด้วย
  const canSeeAll = !looksLikeNationalId(term);

  const pageCount = pages.length + actions.length;
  const customerCount = customerItems?.length ?? 0;
  const billCount = billItems?.length ?? 0;
  const noResults =
    searching && !loading && !customersFailed && !billsFailed && pageCount + customerCount + billCount === 0;

  const hint =
    term.length === 0
      ? t(branch ? "search.hintEmpty" : "search.hintEmptyNoBranch")
      : searching
        ? null
        : t("search.hintOneMore");

  /** ประกาศหลังผลนิ่งเท่านั้น (ไม่อ่านทุกตัวอักษรที่พิมพ์) — ว่างระหว่างโหลด ผลใหม่จึงถูกอ่านแม้ข้อความเท่าเดิม */
  const status = (() => {
    if (term.length === 0) return "";
    if (!searching) return t("search.status.oneMore", { n: pageCount });
    if (loading) return "";
    if (noResults) return t("search.status.none", { q: term });
    const parts = [
      customerCount > 0 && t("search.status.customers", { n: customerCount }),
      billCount > 0 && t("search.status.bills", { n: billCount }),
      pageCount > 0 && t("search.status.pages", { n: pageCount }),
    ].filter((part): part is string => typeof part === "string");
    const found = parts.length > 0 ? [t("search.status.found", { summary: parts.join(" · ") })] : [];
    const failed = [
      customersFailed && t("search.status.failedCustomers"),
      billsFailed && t("search.status.failedBills"),
    ].filter((part): part is string => typeof part === "string");
    return [...found, ...failed].join(" · ");
  })();

  /**
   * แถวที่เลือก = แถวแรกที่เลือกได้ (Enter เปิดผลแรกที่เห็น) จนกว่าผู้ใช้จะเลื่อนเอง — ผลแต่ละกลุ่มมาไม่พร้อมกัน (บิลมาก่อนลูกค้าได้)
   * แต่ cmdk เลือกแถวแรกเองเฉพาะตอนยังไม่มีแถวที่เลือก จึงคุม value เอง (aria-activedescendant ตามด้วย CommandInput)
   * ลำดับเดียวกับ DOM ด้านล่าง: ทางลัด → หน้า → ลูกค้า → บิล (แถว "กำลังค้นหา…" / "ยังไม่ได้เลือกสาขา" เลือกไม่ได้)
   */
  const [selected, setSelected] = useState("");
  const [movedFor, setMovedFor] = useState<string | null>(null);
  const firstAction = actions[0];
  const firstPage = pages[0];
  const firstCustomer = customerItems?.[0];
  const firstBill = billItems?.[0];
  const top =
    (firstAction && `action:${firstAction.key}`) ??
    (firstPage && `page:${firstPage.item.to}`) ??
    (customersFailed ? "retry:customers" : undefined) ??
    (firstCustomer && `customer:${firstCustomer.id}`) ??
    (billsFailed ? "retry:bills" : undefined) ??
    (firstBill && `bill:${firstBill.id}`);
  if (movedFor !== term && top !== undefined && selected !== top) setSelected(top);
  const markMoved = () => {
    if (movedFor !== term) setMovedFor(term);
  };

  const go = (destination: SearchDestination) => () => onSelect(destination);

  return (
    <CommandDialogCommand
      label={t("search.inputLabel")}
      shouldFilter={false}
      loop
      // Ctrl+J/K/N/P ของ cmdk ชนกับ Ctrl+K (ปิด) และอ่าน event.key (แป้นไทยใช้ไม่ได้อยู่แล้ว)
      vimBindings={false}
      value={selected}
      onValueChange={setSelected}
      onKeyDown={(event) => {
        // Enter ในหน้าค้นหาเป็นของหน้าค้นหาเท่านั้น — Ctrl+Enter ต้องไม่ถึงปุ่มลัดบันทึกของฟอร์มข้างหลัง
        if (event.key === "Enter") event.stopPropagation();
        if (MOVE_KEYS.has(event.key)) markMoved();
      }}
    >
      <CommandInput
        value={input}
        onValueChange={setInput}
        placeholder={t("search.placeholder")}
        maxLength={MAX_QUERY_LENGTH}
        aria-describedby={hint ? hintId : undefined}
        // ที่ว่างให้ปุ่มปิดบนจอเล็ก
        className="pr-10 sm:pr-2"
      />
      {/* จอเล็ก (มักไม่มีแป้นพิมพ์/Esc) — ปุ่มปิดที่มุม · จอใหญ่ใช้ Esc ตามแถบปุ่มด้านล่าง */}
      <DialogClose className="absolute top-1.5 right-1.5 inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground sm:hidden">
        <X className="size-4" aria-hidden="true" />
        <span className="sr-only">{t("close")}</span>
      </DialogClose>
      {hint && (
        <p id={hintId} className="px-3 pt-3 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      <CommandList
        label={t("search.results")}
        aria-busy={loading || undefined}
        className="max-h-[min(55dvh,28rem)]"
        // ชี้เมาส์ = เลือกแถวนั้น (cmdk) — ผลที่มาทีหลังไม่ดึงกลับ
        onPointerMove={markMoved}
      >
        {actions.length > 0 && (
          <CommandGroup heading={t("search.groups.actions")}>
            {actions.map((action) => {
              const label = t(`search.actions.${action.key}`);
              return (
                <CommandItem
                  key={action.key}
                  value={`action:${action.key}`}
                  className="group/row"
                  onSelect={go({ path: action.to, label, go: () => navigate({ to: action.to }) })}
                >
                  <action.icon aria-hidden="true" />
                  <span className="truncate">{label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {pages.length > 0 && (
          <CommandGroup heading={t("search.groups.pages")}>
            {pages.map(({ item, group }) => {
              const label = t(`nav.${item.title}`);
              return (
                <CommandItem
                  key={item.to}
                  value={`page:${item.to}`}
                  className="group/row"
                  onSelect={go({ path: item.to, label, go: () => navigate({ to: item.to }) })}
                >
                  <item.icon aria-hidden="true" />
                  <span className="truncate">{label}</span>{" "}
                  {group && <span className={cn("ml-auto shrink-0 text-xs", SUBTLE)}>{t(`groups.${group}`)}</span>}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}
        {searching && (customersLoading || customersFailed || customerCount > 0) && (
          <CommandGroup heading={<GroupHeading label={t("search.groups.customers")} busy={customersLoading} />}>
            {customersLoading && !customerItems && <LoadingRow value="loading:customers" />}
            {customersFailed && (
              <CommandItem
                value="retry:customers"
                className="group/row text-destructive"
                onSelect={() => void customers.refetch()}
              >
                <RotateCw aria-hidden="true" />
                {t("search.failedCustomers")}
              </CommandItem>
            )}
            {customerItems?.map((customer) => (
              <CommandItem
                key={customer.id}
                value={`customer:${customer.id}`}
                className="group/row"
                onSelect={go({
                  path: `/customers/${customer.id}`,
                  label: customer.name_th,
                  go: () => navigate({ to: "/customers/$id", params: { id: customer.id } }),
                })}
              >
                <UserRound aria-hidden="true" />
                <span className="grid min-w-0 flex-1 leading-snug">
                  <span className="truncate font-medium">{customer.name_th}</span>{" "}
                  {/* มาสก์จาก API เสมอ (R13) — หน้าค้นหาไม่มีเลขบัตรเต็ม */}
                  <span className={cn("truncate text-xs tabular-nums", SUBTLE)}>{customer.national_id_masked}</span>
                </span>{" "}
                {customer.card_status !== "ok" && (
                  <CardStatusBadge status={customer.card_status} className="bg-background" />
                )}
              </CommandItem>
            ))}
            {canSeeAll && customerCount > 0 && (
              <CommandItem
                value="more:customers"
                className="group/row"
                onSelect={go({
                  path: "/customers",
                  withSearch: true,
                  label: t("nav.customers"),
                  go: () => navigate({ to: "/customers", search: { q: term, page: 1 } }),
                })}
              >
                <ArrowRight aria-hidden="true" />
                <span>{t("search.seeAll")}</span>{" "}
                <span className={cn("text-xs", SUBTLE)}>{t("search.seeAllCustomers")}</span>
              </CommandItem>
            )}
          </CommandGroup>
        )}
        {searching && branch === null && (
          <CommandGroup heading={t("search.groups.billsNoBranch")}>
            <CommandItem value="info:no-branch" disabled className={INFO_ROW}>
              <Store aria-hidden="true" />
              {t("search.noBranch")}
            </CommandItem>
          </CommandGroup>
        )}
        {branch && billsSearchable && (billsLoading || billsFailed || billCount > 0) && (
          <CommandGroup
            heading={<GroupHeading label={t("search.groups.bills", { name: branch.name })} busy={billsLoading} />}
          >
            {billsLoading && !billItems && <LoadingRow value="loading:bills" />}
            {billsFailed && (
              <CommandItem
                value="retry:bills"
                className="group/row text-destructive"
                onSelect={() => void bills.refetch()}
              >
                <RotateCw aria-hidden="true" />
                {t("search.failedBills")}
              </CommandItem>
            )}
            {billItems?.map((bill) => {
              const voided = bill.status === "void";
              return (
                <CommandItem
                  key={bill.id}
                  value={`bill:${bill.id}`}
                  className="group/row"
                  onSelect={go({
                    path: `/buy/${bill.id}`,
                    label: bill.doc_no,
                    go: () => navigate({ to: "/buy/$id", params: { id: bill.id } }),
                  })}
                >
                  <ReceiptText aria-hidden="true" />
                  <span className="grid min-w-0 flex-1 leading-snug">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-semibold tabular-nums">{bill.doc_no}</span>{" "}
                      {bill.status !== "active" && (
                        <Badge variant="destructive">{voided ? t("status.void", { ns: "bills" }) : bill.status}</Badge>
                      )}
                    </span>{" "}
                    <span className={cn("truncate text-xs tabular-nums", SUBTLE)}>
                      {t("search.billMeta", {
                        date: formatDocDateTime(bill.date, bill.time),
                        customer: bill.customer.name_th,
                      })}
                    </span>
                  </span>{" "}
                  <span className={cn("shrink-0 text-right tabular-nums", voided && "line-through")}>
                    {t("search.amount", { amount: formatMoney(bill.total_amount) })}
                  </span>
                </CommandItem>
              );
            })}
            {canSeeAll && billCount > 0 && (
              <CommandItem
                value="more:bills"
                className="group/row"
                onSelect={go({
                  path: "/bills",
                  withSearch: true,
                  label: t("nav.bills"),
                  go: () => navigate({ to: "/bills", search: { q: term, branch: branch.id } }),
                })}
              >
                <ArrowRight aria-hidden="true" />
                <span>{t("search.seeAll")}</span>{" "}
                <span className={cn("text-xs", SUBTLE)}>{t("search.seeAllBills")}</span>
              </CommandItem>
            )}
          </CommandGroup>
        )}
      </CommandList>
      {noResults && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("search.empty", { q: term })}</p>
      )}
      <div className="flex items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <div aria-hidden="true" className="hidden items-center gap-3 sm:flex">
          <span className="flex items-center gap-1">
            <Kbd className={KBD}>{t("search.keys.up")}</Kbd>
            <Kbd className={KBD}>{t("search.keys.down")}</Kbd>
            {t("search.keys.move")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd className={KBD}>{t("search.keys.enter")}</Kbd>
            {t("search.keys.open")}
          </span>
          <span className="flex items-center gap-1">
            <Kbd className={KBD}>{t("search.keys.escape")}</Kbd>
            {t("search.keys.close")}
          </span>
        </div>
        <p className="ml-auto flex min-w-0 items-center gap-1.5">
          <Store className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {branch ? t("search.scope", { name: branch.name }) : t("noBranch", { ns: "common" })}
          </span>
        </p>
      </div>
      {/* ผลค้นกับจำนวน (WCAG 4.1.3) — อยู่ตั้งแต่เปิด (live region ต้องมีก่อนข้อความเปลี่ยน) */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </CommandDialogCommand>
  );
}

/** หัวกลุ่ม + วงหมุนขณะโหลดผลใหม่ (ผลเดิมยังแสดง) — cmdk ซ่อนหัวกลุ่มจาก screen reader และใช้เป็นชื่อกลุ่มแทน */
function GroupHeading({ label, busy }: { label: string; busy: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      {busy && <LoaderCircle className="size-3 motion-safe:animate-spin" aria-hidden="true" />}
    </span>
  );
}

/**
 * แถว "กำลังค้นหา…" ของกลุ่มที่ยังไม่มีผล — เป็น option ที่เลือกไม่ได้ (ไม่ใช่ Command.Loading ของ cmdk ที่เป็น
 * role="progressbar" ซึ่งอยู่ใน listbox ไม่ได้ตาม ARIA) · ลูกศรข้ามแถวนี้ · listbox บอก aria-busy อยู่แล้ว
 */
function LoadingRow({ value }: { value: string }) {
  const { t } = useTranslation("shell");
  return (
    <CommandItem value={value} disabled className={INFO_ROW}>
      <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
      {t("search.loading")}
    </CommandItem>
  );
}
