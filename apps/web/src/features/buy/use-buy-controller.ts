import { CARD_STATUS_MESSAGE, type CardStatus, isValidNationalId } from "@ong/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { z } from "zod";
import { type CustomerListItem } from "@/features/customers/model";
import { customerListQuery } from "@/features/customers/queries";
import { useCustomerSync } from "@/features/customers/sync";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError, apiFetch, errorMessage } from "@/lib/api";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { type Me, meQueryOptions } from "@/lib/queries";
import { todayIso } from "@/lib/thai-date";
import { useTranslation } from "./i18n";
import {
  type BuyAction,
  type EntryError,
  type FocusTarget,
  type LineEntry,
  type LineEntryField,
  type LineRow,
  MAX_LINES,
  MAX_PAYMENTS,
  type PaymentEntry,
  type PaymentEntryField,
  type PaymentMethod,
  type PaymentRow,
  backdateIssue,
  buildQuoteBody,
  buildSaveBody,
  buyReducer,
  cardStatusFromQuote,
  entryErrorFrom,
  errorFor,
  focusTargetForField,
  initialBuyState,
  isDuplicatePayment,
  isNegativeMoney,
  isZeroMoney,
  randomKey,
} from "./model";
import { buyKeys, buyQuoteQuery } from "./queries";
import { type Metal, type QuoteBody, type QuoteError, QuoteSchema, type SaveBody, SavedBuySchema } from "./types";
import { useBuyHotkeys } from "./use-buy-hotkeys";

const EMPTY_QUOTE_BODY: QuoteBody = { lines: [], payments: [] };
const NO_ERRORS: readonly QuoteError[] = [];
const LINE_FIELDS: readonly LineEntryField[] = ["metal_id", "weight_g", "amount"];
const PAYMENT_FIELDS: readonly PaymentEntryField[] = ["method", "bank", "amount"];
/** พิมพ์เหตุผลย้อนหลังหยุดแล้วค่อยถาม API (ช่องเดียวในบิลที่เป็นข้อความอิสระและอยู่ใน quote) */
const REASON_DEBOUNCE_MS = 300;

/** 409 idempotency_key ที่ key นี้บันทึกบิลอื่นไปแล้ว (เนื้อบิลต่างจากที่ส่ง) */
const ExistingBillSchema = z.object({ existing: z.object({ id: z.string(), doc_no: z.string() }) });
export type ExistingBill = z.infer<typeof ExistingBillSchema>["existing"];

export interface SaveBlock {
  message: string;
  target: FocusTarget | null;
}

/** ช่อง/ปุ่มที่ต้องย้ายโฟกัสไปหา (Enter ไล่ช่อง · หลังเพิ่มแถว · error หลังบันทึก) */
export type FocusName =
  | "idBox"
  | "search"
  | "newCustomer"
  | "editCustomer"
  | "metal"
  | "weight"
  | "amount"
  | "detail"
  | "paymentMethod"
  | "bank"
  | "paymentAmount"
  | "save"
  | "backdateDate"
  | "backdateTime"
  | "backdateReason";
/** element ของช่องที่ต้องย้ายโฟกัสไปหา — ref นี้อ่าน/เขียนเฉพาะใน callback ref และ event handler */
function useFocusRegistry() {
  const nodes = useRef(new Map<FocusName, HTMLElement>());
  /** ใช้เป็น callback ref: `ref={(el) => register("weight", el)}` */
  const register = (name: FocusName, el: HTMLElement | null) => {
    if (el) nodes.current.set(name, el);
    else nodes.current.delete(name);
  };
  return { nodes, register };
}

const LINE_FOCUS: Record<LineEntryField, FocusName> = { metal_id: "metal", weight_g: "weight", amount: "amount" };
const PAYMENT_FOCUS: Record<PaymentEntryField, FocusName> = {
  method: "paymentMethod",
  bank: "bank",
  amount: "paymentAmount",
};

/** 400 ที่ชี้ช่องของแถวที่กำลังเพิ่ม เช่น "lines.3.weight_g" (ตัวเลขยาวเกิน) → ช่องในแถวกรอก */
function entryErrorOf<F extends string>(
  e: unknown,
  prefix: "lines" | "payments",
  index: number,
  fields: readonly F[],
  fallback: F,
): EntryError<F> {
  const field =
    e instanceof ApiError ? (fields.find((f) => e.field === `${prefix}.${index}.${f}`) ?? fallback) : fallback;
  return { field, message: errorMessage(e) };
}

/**
 * ทุกอย่างของหน้า /buy ยกเว้น layout: บิลที่กรอก (reducer) · quote สด · การเพิ่มแถวที่ให้ API ตรวจก่อน ·
 * ค้นลูกค้า · บันทึก + idempotency key · โฟกัส — ตัวเลขเงินทั้งหมดมาจาก API
 */
export function useBuyController(me: Me, metals: readonly Metal[]) {
  const { t } = useTranslation("buy");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(buyReducer, initialBuyState);
  /** error จากการบันทึกครั้งล่าสุด (400) — หายเมื่อแก้บิล */
  const [saveIssue, setSaveIssue] = useState<{ field: string | undefined; message: string } | null>(null);
  const [conflict, setConflict] = useState<ExistingBill | null>(null);
  const [branchLost, setBranchLost] = useState(false);
  const { nodes, register } = useFocusRegistry();
  /** หนึ่ง key ต่อบิลหนึ่งใบ — ใช้ซ้ำทุกครั้งที่กดบันทึกบิลนี้ (เน็ตหลุดแล้วกดใหม่ = ได้บิลเดิม) */
  const idempotencyKey = useRef<string | null>(null);
  const busy = useRef({ line: false, payment: false });
  const lookupSeq = useRef(0);

  const writable = me.role !== "accounting" && me.branch !== null;
  const canBackdate = me.role === "manager" || me.role === "admin";
  const metalId = state.lineEntry.metal_id || (metals[0]?.id ?? "");

  const reason = useDebouncedValue(state.backdate.reason, REASON_DEBOUNCE_MS);
  const body = writable ? buildQuoteBody(state, reason) : null;
  const quoteQuery = useQuery({
    ...buyQuoteQuery(body ?? EMPTY_QUOTE_BODY),
    enabled: body !== null,
    placeholderData: keepPreviousData,
  });
  const save = useMutation({
    mutationFn: (payload: SaveBody) => apiFetch("/api/buy", { method: "POST", json: payload, schema: SavedBuySchema }),
    // ไม่รู้ผล (เน็ตหลุด/5xx) ส่งซ้ำด้วย key เดิมได้ปลอดภัย — API ตอบบิลเดิมถ้าบันทึกไปแล้ว
    retry: (count, error) => error instanceof ApiError && (error.status === 0 || error.status >= 500) && count < 2,
  });

  // ---------- ผล quote ----------

  const quote = quoteQuery.data;
  const reasonSettled = !state.backdate.enabled || reason === state.backdate.reason;
  /** ผลของ payload ปัจจุบันพอดี — ยอดต่อแถว error ต่อช่อง และปุ่มบันทึกใช้เฉพาะตอน fresh */
  const fresh =
    body !== null && quote !== undefined && !quoteQuery.isPlaceholderData && !quoteQuery.isFetching && reasonSettled;
  const errors = fresh && quote ? quote.errors : NO_ERRORS;
  const quoteProblem = quoteQuery.isError && !quoteQuery.isFetching ? quoteQuery.error : null;
  const noBranch =
    me.branch === null ||
    branchLost ||
    (quoteProblem instanceof ApiError && quoteProblem.status === 403 && quoteProblem.field === "branch");

  /** บัตรของลูกค้าใช้เปิดบิลไม่ได้ (R2) — เชื่อผล quote (ตรวจ ณ วันที่ของบิล) · ก่อนได้ผลใช้สถานะจากการค้น */
  const customer = state.customer;
  const snapshotBlock = customer && customer.card_status !== "ok" ? CARD_STATUS_MESSAGE[customer.card_status] : null;
  const customerBlock = customer ? (fresh ? (errorFor(errors, "customer_id")?.message ?? null) : snapshotBlock) : null;
  const cardStatus: CardStatus | null = customer
    ? fresh
      ? (cardStatusFromQuote(errors) ?? customer.card_status)
      : customer.card_status
    : null;

  /** สาขานี้ขายไม่ได้ (ยังไม่ตั้งรหัสสาขาของกรมสรรพากร) — แก้ในหน้านี้ไม่ได้ ต้องให้ผู้ดูแลตั้ง */
  const branchSetupError = errorFor(errors, "branch")?.message;

  function fieldError(field: string): string | undefined {
    if (saveIssue?.field === field) return saveIssue.message;
    if (quoteProblem instanceof ApiError && quoteProblem.field === field) return errorMessage(quoteProblem);
    return errorFor(errors, field)?.message;
  }

  /** เหตุที่ยังบันทึกไม่ได้ + ช่องที่ต้องไปแก้ — null = บันทึกได้ */
  function computeSaveBlock(): SaveBlock | null {
    if (save.isPending) return { message: t("save.saving"), target: null };
    if (noBranch) return { message: t("access.noBranchTitle"), target: null };
    const bd = backdateIssue(state.backdate);
    if (bd) {
      return {
        message: t(`backdate.errors.${bd.error}`),
        target: bd.field === "date" ? "backdateDate" : "backdateTime",
      };
    }
    if (quoteProblem instanceof ApiError) {
      if (quoteProblem.status === 0 || quoteProblem.status >= 500) return { message: t("save.offline"), target: null };
      const target = quoteProblem.field ? focusTargetForField(quoteProblem.field, customer !== null) : null;
      return { message: errorMessage(quoteProblem), target };
    }
    if (!fresh || !quote) return { message: t("save.calculating"), target: null };
    const first = quote.errors[0];
    if (first) return { message: first.message, target: focusTargetForField(first.field, customer !== null) };
    return null;
  }
  const saveBlock = writable ? computeSaveBlock() : { message: t("save.forbidden"), target: null };

  // ---------- โฟกัส ----------

  function focusOn(name: FocusName | null) {
    const el = name ? nodes.current.get(name) : undefined;
    if (!el) return;
    if (el.getAttribute("role") === "radiogroup") {
      el.querySelector<HTMLElement>('[role="radio"][data-state="checked"], [role="radio"]')?.focus();
      return;
    }
    el.focus();
  }

  /**
   * เปลี่ยน state แล้วให้ DOM ตามทันที (flushSync) ก่อนย้ายโฟกัส — ปุ่ม/ช่องที่เพิ่งปรากฏโฟกัสได้เลย
   * เรียกจาก event handler หรือหลัง await เท่านั้น (ไม่เคยเรียกตอน render)
   */
  function act(action: BuyAction, then?: FocusName) {
    setSaveIssue(null);
    flushSync(() => dispatch(action));
    if (then) focusOn(then);
  }

  // ---------- ลูกค้า ----------

  const nextAfterPick = (c: CustomerListItem): FocusName => (c.card_status === "ok" ? "weight" : "editCustomer");

  /** เลขบัตร 13 หลัก (Siam ID หรือพิมพ์เอง) → ค้นแล้วเลือกให้เอง · คืนการย้ายโฟกัสหลังจบ burst */
  async function findByNationalId(digits: string, refetch = false): Promise<(() => void) | null> {
    const seq = ++lookupSeq.current;
    if (!isValidNationalId(digits)) {
      act({ type: "lookupChanged", status: "badChecksum" });
      return null;
    }
    act({ type: "lookupChanged", status: "searching" });
    try {
      const { items } = await qc.fetchQuery({
        ...customerListQuery({ q: digits, page: 1 }),
        ...(refetch && { staleTime: 0 }),
      });
      if (seq !== lookupSeq.current) return null;
      const [only, ...more] = items;
      if (!only) {
        act({ type: "lookupChanged", status: "notFound" });
        return () => focusOn("newCustomer");
      }
      if (more.length > 0) {
        act({ type: "searchTyped", text: digits });
        act({ type: "lookupChanged", status: "idle" });
        return () => focusOn("search");
      }
      act({ type: "customerSelected", customer: only, query: digits });
      return () => focusOn(nextAfterPick(only));
    } catch {
      if (seq === lookupSeq.current) act({ type: "lookupChanged", status: "failed" });
      return null;
    }
  }

  function pickCustomer(c: CustomerListItem, query: string) {
    lookupSeq.current++;
    act({ type: "customerSelected", customer: c, query }, nextAfterPick(c));
    toast.info(t("customer.picked", { name: c.name_th }));
  }

  function changeCustomer() {
    lookupSeq.current++;
    act({ type: "customerCleared" }, "idBox");
  }

  /** กลับมาจากแท็บแก้/เพิ่มลูกค้า (focus · visibility · BroadcastChannel) — ตรวจบัตรใหม่ · เลือกลูกค้าใหม่ให้เอง */
  function refreshAfterReturn() {
    if (!writable) return;
    void qc.invalidateQueries({ queryKey: buyKeys.quotes() });
    if (customer) {
      const id = customer.id;
      qc.fetchQuery({ ...customerListQuery({ q: state.customerQuery, page: 1 }), staleTime: 0 }).then(
        ({ items }) => {
          const again = items.find((i) => i.id === id);
          if (again) dispatch({ type: "customerRefreshed", customer: again });
        },
        () => undefined,
      );
      return;
    }
    const digits = state.idText.replace(/\D/g, "");
    if (digits.length === 13 && state.lookup === "notFound") {
      void findByNationalId(digits, true).then((next) => next?.());
    }
  }

  // ---------- รายการ ----------

  function lineError(error: EntryError<LineEntryField>) {
    act({ type: "lineErrorSet", error }, LINE_FOCUS[error.field]);
  }

  /** เพิ่มแถวเมื่อ API ตรวจแถวใหม่ผ่าน (quote ของบิลที่มีแถวนั้น) — ผลค้างใน cache จึงเห็นราคา/กรัมทันที */
  async function addLine() {
    if (busy.current.line) return;
    const entry = state.lineEntry;
    const weight = normalizeDecimalInput(entry.weight_g);
    const amount = normalizeDecimalInput(entry.amount);
    if (!weight) return lineError({ field: "weight_g", message: t("lines.missingWeight") });
    if (!amount) return lineError({ field: "amount", message: t("lines.missingAmount") });
    if (state.lines.length >= MAX_LINES) return lineError({ field: "amount", message: t("lines.limit") });
    const index = state.lines.length;
    const line: LineRow = { key: randomKey(), metal_id: metalId, weight_g: weight, amount };
    const next = buildQuoteBody({ ...state, lines: [...state.lines, line] }, reason);
    busy.current.line = true;
    try {
      if (next) {
        const q = await qc.fetchQuery(buyQuoteQuery(next));
        const error = entryErrorFrom(q.errors, "lines", index, LINE_FIELDS);
        if (error) return lineError(error);
      }
      act({ type: "lineAdded", line, entry }, "weight");
    } catch (e) {
      lineError(entryErrorOf(e, "lines", index, LINE_FIELDS, "amount"));
    } finally {
      busy.current.line = false;
    }
  }

  // ---------- ชำระเงิน ----------

  function paymentError(error: EntryError<PaymentEntryField>) {
    act({ type: "paymentErrorSet", error }, PAYMENT_FOCUS[error.field]);
  }

  /** วิธี + ธนาคารที่กำลังกรอก (โอนต้องมีธนาคาร) — null = ตรวจไม่ผ่าน (แสดง error แล้ว) */
  function paymentMethodEntry(): { method: PaymentMethod; bank: string } | null {
    const { method } = state.paymentEntry;
    const bank = method === "transfer" ? state.paymentEntry.bank.trim() : "";
    if (method === "transfer" && !bank) {
      paymentError({ field: "bank", message: t("payments.missingBank") });
      return null;
    }
    return { method, bank };
  }

  /** เพิ่มการชำระเมื่อ API ตรวจผ่าน และไม่ทำให้จ่ายเกินยอด (R4) — ยอดพอดีแล้วไปที่ปุ่มบันทึก */
  async function addPayment() {
    if (busy.current.payment) return;
    const entry = state.paymentEntry;
    const picked = paymentMethodEntry();
    if (!picked) return;
    const amount = normalizeDecimalInput(entry.amount);
    if (!amount) return paymentError({ field: "amount", message: t("payments.missingAmount") });
    if (isDuplicatePayment(state.payments, picked.method, picked.bank)) {
      return paymentError({ field: "method", message: t("payments.duplicate") });
    }
    if (state.payments.length >= MAX_PAYMENTS) return paymentError({ field: "amount", message: t("payments.limit") });
    const index = state.payments.length;
    const row: PaymentRow = { key: randomKey(), ...picked, amount };
    const next = buildQuoteBody({ ...state, payments: [...state.payments, row] }, reason);
    busy.current.payment = true;
    try {
      let settled = false;
      if (next) {
        const q = await qc.fetchQuery(buyQuoteQuery(next));
        const error = entryErrorFrom(q.errors, "payments", index, PAYMENT_FIELDS);
        if (error) return paymentError(error);
        if (isNegativeMoney(q.balance)) return paymentError({ field: "amount", message: t("payments.overpaid") });
        settled = isZeroMoney(q.balance) && !isZeroMoney(q.total_amount);
      }
      act({ type: "paymentAdded", row, entry }, settled ? "save" : "paymentAmount");
    } catch (e) {
      paymentError(entryErrorOf(e, "payments", index, PAYMENT_FIELDS, "amount"));
    } finally {
      busy.current.payment = false;
    }
  }

  /** เต็มจำนวน = ยอดคงเหลือจาก API (ไม่บวกลบในเครื่อง) · แทนแถววิธีเดียวกันที่มีอยู่ */
  async function payFull() {
    if (busy.current.payment) return;
    const picked = paymentMethodEntry();
    if (!picked) return;
    const others = state.payments.filter(
      (p) => !(p.method === picked.method && (picked.method === "cash" || p.bank.trim() === picked.bank)),
    );
    if (others.length >= MAX_PAYMENTS) return paymentError({ field: "amount", message: t("payments.limit") });
    const base = buildQuoteBody({ ...state, payments: others }, reason);
    if (!base) return;
    busy.current.payment = true;
    try {
      const q = await qc.fetchQuery(buyQuoteQuery(base));
      if (isZeroMoney(q.balance) || isNegativeMoney(q.balance)) {
        return paymentError({ field: "amount", message: t("payments.nothingLeft") });
      }
      const payments = [...others, { key: randomKey(), ...picked, amount: q.balance }];
      const final = buildQuoteBody({ ...state, payments }, reason);
      // ถามผลของบิลที่จ่ายครบไว้ก่อน — ปุ่มบันทึกพร้อมทันทีที่โฟกัสไปถึง
      if (final) await qc.fetchQuery(buyQuoteQuery(final));
      act({ type: "paymentsReplaced", payments }, "save");
    } catch (e) {
      paymentError(entryErrorOf(e, "payments", others.length, PAYMENT_FIELDS, "amount"));
    } finally {
      busy.current.payment = false;
    }
  }

  // ---------- บันทึก ----------

  function onSaveError(e: unknown, quoteBody: QuoteBody) {
    if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) {
      // ไม่รู้ว่าบันทึกไปหรือยัง — key เดิมยังอยู่ กดอีกครั้งได้บิลเดิม (ไม่ซ้ำ)
      toast.error(t("save.network"));
      focusOn("save");
      return;
    }
    if (e.status === 401) return;
    if (e.status === 409 && e.field === "idempotency_key") {
      const existing = ExistingBillSchema.safeParse(e.body);
      if (existing.success) {
        setConflict(existing.data.existing);
        return;
      }
      idempotencyKey.current = null;
      toast.error(t("save.keyChanged"));
      focusOn("save");
      return;
    }
    if (e.status === 403) {
      if (e.field === "branch") {
        setBranchLost(true);
        void qc.invalidateQueries({ queryKey: meQueryOptions.queryKey });
      } else {
        toast.error(t("save.forbidden"));
      }
      return;
    }
    if (e.status === 409) {
      // ผลตรวจทั้งบิลแนบมากับ 409 — วาง error ลงช่องทันที
      const parsed = QuoteSchema.safeParse(e.body);
      if (parsed.success) qc.setQueryData(buyQuoteQuery(quoteBody).queryKey, parsed.data);
    } else {
      setSaveIssue({ field: e.field, message: errorMessage(e) });
    }
    toast.error(t("save.failed", { error: errorMessage(e) }));
    focusOn((e.field && focusTargetForField(e.field, customer !== null)) || "save");
  }

  async function submit() {
    if (!writable || save.isPending) return;
    if (saveBlock) {
      focusOn(saveBlock.target);
      return;
    }
    idempotencyKey.current ??= randomKey();
    const payload = buildSaveBody(state, idempotencyKey.current);
    const quoteBody = buildQuoteBody(state);
    if (!payload || !quoteBody) return;
    setSaveIssue(null);
    try {
      const saved = await save.mutateAsync(payload);
      idempotencyKey.current = null;
      void qc.invalidateQueries({ queryKey: buyKeys.lists() });
      toast.success(t("save.saved", { docNo: saved.doc_no }));
      await navigate({ to: "/buy/$id", params: { id: saved.id } });
    } catch (e) {
      onSaveError(e, quoteBody);
    }
  }

  function openExisting() {
    const bill = conflict;
    setConflict(null);
    idempotencyKey.current = null;
    if (bill) void navigate({ to: "/buy/$id", params: { id: bill.id } });
  }

  /** ตั้งใจเปิดบิลใบใหม่ทั้งที่ key เดิมบันทึกบิลอื่นไปแล้ว — key ใหม่ แล้วบันทึกทันที */
  function saveAsNew() {
    setConflict(null);
    idempotencyKey.current = randomKey();
    void submit();
  }

  function clearBill() {
    idempotencyKey.current = null;
    lookupSeq.current++;
    setConflict(null);
    act({ type: "reset" }, "idBox");
  }

  useBuyHotkeys({ onSave: () => void submit(), onReturn: refreshAfterReturn });
  useCustomerSync(() => refreshAfterReturn());

  return {
    me,
    state,
    metals,
    metalId,
    register,
    writable,
    noBranch,
    canBackdate,
    quote,
    fresh,
    fieldError,
    branchSetupError,
    customerBlock,
    cardStatus,
    saveBlock,
    saving: save.isPending,
    conflict,
    actions: {
      focusOn,
      toggleBackdate: (enabled: boolean) =>
        act({ type: "backdateToggled", enabled, today: todayIso() }, enabled ? "backdateDate" : undefined),
      typeBackdateDate: (text: string) => act({ type: "backdateDateTyped", text }),
      commitBackdateDate: () => act({ type: "backdateDateCommitted", today: todayIso() }),
      typeBackdateTime: (text: string) => act({ type: "backdateTimeTyped", text }),
      commitBackdateTime: () => act({ type: "backdateTimeCommitted" }),
      typeBackdateReason: (text: string) => act({ type: "backdateReasonTyped", text }),
      typeId: (text: string) => {
        lookupSeq.current++;
        act({ type: "idTyped", text });
      },
      findByNationalId,
      typeSearch: (text: string) => act({ type: "searchTyped", text }),
      pickCustomer,
      changeCustomer,
      setLineEntry: (patch: Partial<LineEntry>) => act({ type: "lineEntryChanged", patch }),
      clearLineEntry: () => act({ type: "lineEntryCleared" }, "weight"),
      addLine,
      removeLine: (key: string) => act({ type: "lineRemoved", key }),
      typeDetail: (text: string) => act({ type: "detailTyped", text }),
      setPaymentEntry: (patch: Partial<PaymentEntry>) => act({ type: "paymentEntryChanged", patch }),
      clearPaymentEntry: () => act({ type: "paymentEntryCleared" }, "paymentAmount"),
      addPayment,
      payFull,
      removePayment: (key: string) => act({ type: "paymentRemoved", key }),
      submit,
      openExisting,
      saveAsNew,
      closeConflict: () => setConflict(null),
      clearBill,
    },
  };
}

export type BuyController = ReturnType<typeof useBuyController>;
