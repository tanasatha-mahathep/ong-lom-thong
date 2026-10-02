import { CARD_STATUS_MESSAGE, type CardStatus, DEDUCT_PERCENT_CHOICES, type PAYMENT_METHODS } from "@ong/core";
import { formatMoney } from "@/lib/format";
import { addDaysIso, isoToThaiInput, thaiInputToIso } from "@/lib/thai-date";
import type { CustomerListItem } from "@/features/customers/model";
import type { BuyT } from "./i18n";
import type th from "./locales/th";
import type { Quote, QuoteBody, QuoteError, QuotePaymentInput, SaveBody } from "./types";

/**
 * สถานะของบิลที่กำลังกรอกบนหน้า /buy — ฟังก์ชันล้วน (reducer + ตัวช่วย) ไม่มีสูตรเงิน
 * ยอดทุกตัวมาจาก POST /api/buy/quote · ตรงนี้แค่ประกอบ payload และอ่านเครื่องหมายของข้อความที่เซิร์ฟเวอร์ส่งมา
 */

export type PaymentMethod = keyof typeof PAYMENT_METHODS;

/**
 * แถวที่กำลังกรอก: โลหะ → ค่าบริสุทธิ์ (%) → หัก % → ปริมาณ — ไม่มีช่องราคา เซิร์ฟเวอร์คิดราคาให้ (UAT 30 ก.ย. 2569)
 * ทุกช่องเป็นข้อความตามที่พิมพ์/เลือก ไม่แปลงเป็น number
 */
export interface LineEntry {
  metal_id: string;
  purity_percent: string;
  /** "0"–"10" จาก dropdown (ค่าเริ่มต้น "0" = ไม่หัก) */
  deduct_percent: string;
  weight_g: string;
}
export interface LineRow extends LineEntry {
  key: string;
}

/** หัก % ที่เลือกได้ — ชุดเดียวกับที่ API ตรวจ (DEDUCT_PERCENT_CHOICES "0"–"10") · ค่าเริ่มต้น = ไม่หัก */
export const DEDUCT_CHOICES = DEDUCT_PERCENT_CHOICES;
export const NO_DEDUCT = "0";

export interface PaymentEntry {
  method: PaymentMethod;
  bank: string;
  amount: string;
}
export interface PaymentRow extends PaymentEntry {
  key: string;
}

export interface EntryError<F extends string> {
  field: F;
  message: string;
}
export type LineEntryField = keyof LineEntry;
export type PaymentEntryField = keyof PaymentEntry;

/** key ของข้อความ error บิลย้อนหลังใน locales ("backdate.errors.<key>") — แปลตอนแสดง */
export type BackdateError = keyof typeof th.backdate.errors;

/** บิลย้อนหลัง (ผู้จัดการขึ้นไป · ไม่เกิน 7 วัน · ต้องมีเวลาและเหตุผล) */
export interface Backdate {
  enabled: boolean;
  dateText: string;
  /** ISO ของวันที่ที่ยืนยันแล้ว (blur/Enter) และอยู่ในช่วงที่อนุญาต · null = ยังส่งไม่ได้ */
  date: string | null;
  dateError: BackdateError | null;
  /** date < วันนี้ ณ ตอนยืนยัน — ต้องมีเวลาและเหตุผล */
  past: boolean;
  timeText: string;
  timeError: BackdateError | null;
  reason: string;
}

/** ผลค้นลูกค้าจากช่องเลขบัตร */
export type LookupStatus = "idle" | "searching" | "badChecksum" | "notFound" | "failed";

export interface BuyState {
  backdate: Backdate;
  idText: string;
  lookup: LookupStatus;
  searchText: string;
  customer: CustomerListItem | null;
  /** คำค้นที่พบลูกค้าคนนี้ — ใช้ค้นซ้ำเมื่อกลับมาจากแท็บแก้ข้อมูลลูกค้า */
  customerQuery: string;
  lineEntry: LineEntry;
  lineError: EntryError<LineEntryField> | null;
  lines: LineRow[];
  detail: string;
  paymentEntry: PaymentEntry;
  paymentError: EntryError<PaymentEntryField> | null;
  payments: PaymentRow[];
}

export const MAX_LINES = 50;
export const MAX_PAYMENTS = 10;
export const BACKDATE_MAX_DAYS = 7;
/** รูปเวลาเดียวกับ API (services/buy.ts) */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const EMPTY_BACKDATE: Backdate = {
  enabled: false,
  dateText: "",
  date: null,
  dateError: null,
  past: false,
  timeText: "",
  timeError: null,
  reason: "",
};

/** โลหะว่าง = ใช้โลหะแรกของรายการ (ทอง) — เลือกแล้วค้างไว้ข้ามแถว */
export const initialBuyState: BuyState = {
  backdate: EMPTY_BACKDATE,
  idText: "",
  lookup: "idle",
  searchText: "",
  customer: null,
  customerQuery: "",
  lineEntry: { metal_id: "", purity_percent: "", deduct_percent: NO_DEDUCT, weight_g: "" },
  lineError: null,
  lines: [],
  detail: "",
  paymentEntry: { method: "cash", bank: "", amount: "" },
  paymentError: null,
  payments: [],
};

export type BuyAction =
  | { type: "reset" }
  | { type: "backdateToggled"; enabled: boolean; today: string }
  | { type: "backdateDateTyped"; text: string }
  | { type: "backdateDateCommitted"; today: string }
  | { type: "backdateTimeTyped"; text: string }
  | { type: "backdateTimeCommitted" }
  | { type: "backdateReasonTyped"; text: string }
  | { type: "idTyped"; text: string }
  | { type: "lookupChanged"; status: LookupStatus }
  | { type: "searchTyped"; text: string }
  | { type: "customerSelected"; customer: CustomerListItem; query: string }
  | { type: "customerRefreshed"; customer: CustomerListItem }
  | { type: "customerCleared" }
  | { type: "lineEntryChanged"; patch: Partial<LineEntry> }
  | { type: "lineEntryCleared" }
  | { type: "lineErrorSet"; error: EntryError<LineEntryField> }
  | { type: "lineAdded"; line: LineRow; entry: LineEntry }
  | { type: "lineRemoved"; key: string }
  | { type: "detailTyped"; text: string }
  | { type: "paymentEntryChanged"; patch: Partial<PaymentEntry> }
  | { type: "paymentEntryCleared" }
  | { type: "paymentErrorSet"; error: EntryError<PaymentEntryField> }
  | { type: "paymentAdded"; row: PaymentRow; entry: PaymentEntry }
  | { type: "paymentRemoved"; key: string }
  | { type: "paymentsReplaced"; payments: PaymentRow[] };

/** ยืนยันวันที่ย้อนหลัง: อ่านได้ · ไม่เกินวันนี้ · ไม่เก่ากว่า 7 วัน (API ตรวจซ้ำเสมอ) */
function commitBackdate(b: Backdate, today: string): Backdate {
  const iso = thaiInputToIso(b.dateText);
  const error: BackdateError | null = !iso
    ? "badDate"
    : iso > today
      ? "futureDate"
      : iso < addDaysIso(today, -BACKDATE_MAX_DAYS)
        ? "tooOld"
        : null;
  return {
    ...b,
    // เขียนกลับเป็นรูปมาตรฐาน (1/10/2569 → 01/10/2569) หลังออกจากช่องเท่านั้น
    dateText: iso && !error ? isoToThaiInput(iso) : b.dateText,
    date: error ? null : iso,
    dateError: error,
    past: !error && iso !== null && iso < today,
  };
}

/** ล้างแถวที่กำลังกรอก (Esc · หลังเพิ่มแถว): ค่าบริสุทธิ์/ปริมาณว่าง · หัก % กลับเป็น 0 · โลหะคงเดิม */
const clearedEntry = (e: LineEntry): LineEntry => ({
  ...e,
  purity_percent: "",
  deduct_percent: NO_DEDUCT,
  weight_g: "",
});

export function buyReducer(state: BuyState, action: BuyAction): BuyState {
  switch (action.type) {
    case "reset":
      return initialBuyState;
    case "backdateToggled":
      return {
        ...state,
        backdate: action.enabled
          ? { ...EMPTY_BACKDATE, enabled: true, dateText: isoToThaiInput(action.today), date: action.today }
          : EMPTY_BACKDATE,
      };
    case "backdateDateTyped":
      // date เป็น null จนกว่าจะยืนยัน (blur/Enter) — กันไม่ให้ quote/save เงียบ ๆ ใช้วันที่เดิมที่เคยยืนยันไว้
      // ทั้งที่ตัวหนังสือในช่องเปลี่ยนไปแล้ว (buildQuoteBody คืน null เมื่อ enabled && date === null)
      return { ...state, backdate: { ...state.backdate, dateText: action.text, date: null, dateError: null } };
    case "backdateDateCommitted":
      return { ...state, backdate: commitBackdate(state.backdate, action.today) };
    case "backdateTimeTyped":
      return { ...state, backdate: { ...state.backdate, timeText: action.text, timeError: null } };
    case "backdateTimeCommitted": {
      const text = state.backdate.timeText.trim();
      const timeError = text !== "" && !TIME.test(text) ? "badTime" : null;
      return { ...state, backdate: { ...state.backdate, timeText: text, timeError } };
    }
    case "backdateReasonTyped":
      return { ...state, backdate: { ...state.backdate, reason: action.text } };
    case "idTyped":
      return { ...state, idText: action.text, lookup: "idle" };
    case "lookupChanged":
      return { ...state, lookup: action.status };
    case "searchTyped":
      return { ...state, searchText: action.text };
    case "customerSelected":
      return {
        ...state,
        customer: action.customer,
        customerQuery: action.query,
        idText: "",
        lookup: "idle",
        searchText: "",
      };
    case "customerRefreshed":
      return state.customer?.id === action.customer.id ? { ...state, customer: action.customer } : state;
    case "customerCleared":
      return { ...state, customer: null, customerQuery: "", idText: "", lookup: "idle", searchText: "" };
    case "lineEntryChanged":
      return { ...state, lineEntry: { ...state.lineEntry, ...action.patch }, lineError: null };
    case "lineEntryCleared":
      return { ...state, lineEntry: clearedEntry(state.lineEntry), lineError: null };
    case "lineErrorSet":
      return { ...state, lineError: action.error };
    case "lineAdded": {
      // ช่องที่พิมพ์ต่อระหว่างรอ quote ไม่ถูกล้างทิ้ง (โลหะคงไว้เสมอ — แถวถัดไปมักเป็นโลหะเดียวกัน)
      const e = state.lineEntry;
      const untouched =
        e.purity_percent === action.entry.purity_percent &&
        e.deduct_percent === action.entry.deduct_percent &&
        e.weight_g === action.entry.weight_g;
      return {
        ...state,
        lines: [...state.lines, action.line],
        lineEntry: untouched ? clearedEntry(e) : e,
        lineError: null,
      };
    }
    case "lineRemoved":
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) };
    case "detailTyped":
      return { ...state, detail: action.text };
    case "paymentEntryChanged":
      return { ...state, paymentEntry: { ...state.paymentEntry, ...action.patch }, paymentError: null };
    case "paymentEntryCleared":
      return { ...state, paymentEntry: { ...state.paymentEntry, bank: "", amount: "" }, paymentError: null };
    case "paymentErrorSet":
      return { ...state, paymentError: action.error };
    case "paymentAdded": {
      const untouched =
        state.paymentEntry.amount === action.entry.amount && state.paymentEntry.bank === action.entry.bank;
      return {
        ...state,
        payments: [...state.payments, action.row],
        paymentEntry: untouched ? { ...state.paymentEntry, bank: "", amount: "" } : state.paymentEntry,
        paymentError: null,
      };
    }
    case "paymentRemoved":
      return { ...state, payments: state.payments.filter((p) => p.key !== action.key) };
    case "paymentsReplaced":
      return {
        ...state,
        payments: action.payments,
        paymentEntry: { ...state.paymentEntry, bank: "", amount: "" },
        paymentError: null,
      };
  }
}

// ---------- payload ----------

function paymentInput(p: PaymentEntry): QuotePaymentInput {
  return p.method === "transfer"
    ? { method: "transfer", bank: p.bank.trim(), amount: p.amount }
    : { method: "cash", amount: p.amount };
}

/**
 * payload ของ POST /buy/quote — ช่องว่างไม่ส่งคีย์ · null = ยังส่งไม่ได้ (วันที่ย้อนหลังยังไม่ถูก)
 * @param reason เหตุผลย้อนหลังที่หน่วงแล้ว (พิมพ์ทีละตัวไม่ยิง quote ทุกตัว) — ไม่ส่ง = ค่าปัจจุบัน
 */
export function buildQuoteBody(s: BuyState, reason: string = s.backdate.reason): QuoteBody | null {
  const b = s.backdate;
  if (b.enabled && b.date === null) return null;
  const body: QuoteBody = {
    lines: s.lines.map(({ metal_id, weight_g, purity_percent, deduct_percent }) => ({
      metal_id,
      weight_g,
      purity_percent,
      deduct_percent,
    })),
    payments: s.payments.map(paymentInput),
  };
  if (s.customer) body.customer_id = s.customer.id;
  if (b.enabled && b.date) body.date = b.date;
  const why = reason.trim();
  if (b.enabled && why) body.backdate_reason = why;
  return body;
}

/** payload ของ POST /buy = quote + เวลา (ย้อนหลัง) + รายละเอียด + idempotency key */
export function buildSaveBody(s: BuyState, idempotencyKey: string): SaveBody | null {
  const quote = buildQuoteBody(s);
  if (!quote) return null;
  const body: SaveBody = { ...quote, full_tax: false, idempotency_key: idempotencyKey };
  const time = s.backdate.timeText.trim();
  if (s.backdate.enabled && time) body.time = time;
  const detail = s.detail.trim();
  if (detail) body.detail = detail;
  return body;
}

/**
 * key สุ่ม — ใช้เป็น idempotency key (ตรงรูป API ^[A-Za-z0-9_-]{16,128}$) และ key ของแถวในตาราง
 * idempotency: หนึ่ง key ต่อบิลหนึ่งใบ ใช้ซ้ำทุกครั้งที่กดบันทึกบิลเดิม — API ผูก key กับเนื้อบิลทั้งใบ
 */
export function randomKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- อ่านผล quote (ไม่คำนวณ — อ่านเครื่องหมายของข้อความจากเซิร์ฟเวอร์เท่านั้น) ----------

export const isZeroMoney = (s: string) => /^-?0+(\.0+)?$/.test(s);
export const isNegativeMoney = (s: string) => s.startsWith("-") && !isZeroMoney(s);

/** แถวซ้ำตามกุญแจเดียวกับ API: วิธี + ธนาคาร (ตัดช่องว่าง) */
export function isDuplicatePayment(payments: readonly PaymentEntry[], method: PaymentMethod, bank: string): boolean {
  return payments.some((p) => p.method === method && (method === "cash" || p.bank.trim() === bank.trim()));
}

/** error ของช่องนั้นพอดี เช่น "lines.0.weight_g" */
export const errorFor = (errors: readonly QuoteError[], field: string) => errors.find((e) => e.field === field);

/** error ทุกช่องของแถว i เช่น prefix "lines" → lines.i.* */
export const rowErrors = (errors: readonly QuoteError[], prefix: "lines" | "payments", index: number) =>
  errors.filter((e) => e.field.startsWith(`${prefix}.${index}.`));

/**
 * ช่องในแถวที่กำลังกรอกที่ API ติ (แถวใหม่ที่ index = จำนวนแถวเดิม)
 * ติหลายช่องพร้อมกัน → ช่องแรกตามลำดับ `fields` (= ลำดับที่พนักงานกรอก) ไม่ใช่ลำดับที่เซิร์ฟเวอร์ตรวจ
 */
export function entryErrorFrom<F extends string>(
  errors: readonly QuoteError[],
  prefix: "lines" | "payments",
  index: number,
  fields: readonly F[],
): EntryError<F> | null {
  const row = rowErrors(errors, prefix, index);
  for (const field of fields) {
    const e = row.find((x) => x.field === `${prefix}.${index}.${field}`);
    if (e) return { field, message: e.message };
  }
  return null;
}

/** สถานะบัตรตามผล quote (ตรวจ ณ วันที่ของบิล) — null = ยังไม่มีลูกค้า */
export function cardStatusFromQuote(errors: readonly QuoteError[]): CardStatus | null {
  const e = errorFor(errors, "customer_id");
  if (!e) return "ok";
  const found = (Object.keys(CARD_STATUS_MESSAGE) as (keyof typeof CARD_STATUS_MESSAGE)[]).find(
    (k) => CARD_STATUS_MESSAGE[k] === e.message,
  );
  return found ?? null;
}

export type BalanceTone = "stale" | "due" | "balanced" | "over";

/** ข้อความคงเหลือแบบระบบเดิม (check_balance) — เขียวเฉพาะผล quote ล่าสุดที่ยอด 0 และมีการชำระ */
export function balanceView(
  quote: Quote | undefined,
  fresh: boolean,
  hasPayments: boolean,
  t: BuyT,
): { tone: BalanceTone; text: string } {
  if (!quote || !fresh) return { tone: "stale", text: t("payments.balanceStale") };
  if (isNegativeMoney(quote.balance)) {
    return { tone: "over", text: t("payments.balanceOver", { amount: formatMoney(quote.balance.slice(1)) }) };
  }
  if (isZeroMoney(quote.balance) && !isZeroMoney(quote.total_amount) && hasPayments) {
    return { tone: "balanced", text: t("payments.balanced") };
  }
  return { tone: "due", text: t("payments.balanceDue", { amount: formatMoney(quote.balance) }) };
}

/** ช่องที่ต้องไปแก้ต่อ error หนึ่งตัว — null = ไม่มีช่องให้แก้ในหน้านี้ (ราคาทอง · สาขา) */
export type FocusTarget =
  | "idBox"
  | "editCustomer"
  | "purity"
  | "weight"
  | "detail"
  | "paymentAmount"
  | "bank"
  | "backdateDate"
  | "backdateTime"
  | "backdateReason";

/** error ของรายการสินค้า (ไม่มีแถว · แถวที่เพิ่มแล้วติด) → ช่องแรกของแถวกรอก (ค่าบริสุทธิ์) ที่เริ่มแถวใหม่/แก้ต่อได้ */
export function focusTargetForField(field: string, hasCustomer: boolean): FocusTarget | null {
  if (field === "customer_id") return hasCustomer ? "editCustomer" : "idBox";
  if (field === "lines" || field.startsWith("lines.")) return "purity";
  if (/^payments\.\d+\.bank$/.test(field)) return "bank";
  if (field === "payments" || field.startsWith("payments.")) return "paymentAmount";
  if (field === "date") return "backdateDate";
  if (field === "time") return "backdateTime";
  if (field === "backdate_reason") return "backdateReason";
  if (field === "detail") return "detail";
  return null;
}

/**
 * ปัญหาของบิลย้อนหลังที่ตรวจได้ก่อนส่ง (API ตรวจซ้ำ) — ช่องแรกที่ต้องแก้
 * date: null + dateError: null = พิมพ์แล้วแต่ยังไม่ได้ยืนยัน (ต่างจาก null + error = ยืนยันแล้วแต่ผิด)
 * time: ตรวจจากข้อความปัจจุบันเสมอ (ไม่ใช้ timeError ที่ตั้งไว้ตอน commit) กัน Ctrl+Enter ทันทีหลังพิมพ์เวลาใหม่
 * โดยยังไม่ blur/Enter หลุดผ่านไปพร้อมเวลาที่ยังไม่ตรวจ
 */
export function backdateIssue(b: Backdate): { field: "date" | "time"; error: BackdateError } | null {
  if (!b.enabled) return null;
  if (b.date === null) return { field: "date", error: b.dateError ?? "dateNotConfirmed" };
  const time = b.timeText.trim();
  if (time !== "" && !TIME.test(time)) return { field: "time", error: "badTime" };
  if (b.past && time === "") return { field: "time", error: "timeRequired" };
  return null;
}
