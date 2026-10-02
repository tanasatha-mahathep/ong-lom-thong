import { describe, expect, it } from "vitest";
import type { CustomerListItem } from "@/features/customers/model";
import { t } from "./i18n";
import {
  type BuyState,
  backdateIssue,
  balanceView,
  buildQuoteBody,
  buildSaveBody,
  buyReducer,
  cardStatusFromQuote,
  entryErrorFrom,
  focusTargetForField,
  initialBuyState,
  isDuplicatePayment,
  isNegativeMoney,
  isZeroMoney,
  randomKey,
} from "./model";
import type { Quote } from "./types";

const CUSTOMER: CustomerListItem = {
  id: "c-1",
  national_id_masked: "1 XXXX XXXXX 01 0",
  name_th: "นายทดสอบ ซื้อเข้า",
  mobile: "0899999999",
  address: "99 หมู่ 9",
  card_status: "ok",
};

const withBill = (patch: Partial<BuyState> = {}): BuyState => ({
  ...initialBuyState,
  customer: CUSTOMER,
  lines: [{ key: "l1", metal_id: "gold", purity_percent: "96.5", deduct_percent: "3", weight_g: "5.86" }],
  payments: [
    { key: "p1", method: "cash", bank: "ค้างจากโอน", amount: "20000" },
    { key: "p2", method: "transfer", bank: " กสิกรไทย ", amount: "30" },
  ],
  ...patch,
});

const quote = (patch: Partial<Quote> = {}): Quote => ({
  ok: true,
  errors: [],
  date: "2026-09-29",
  branch: { id: "b1", code: "00000", name: "สำนักงานใหญ่" },
  gold_price_snapshot: "67850.00",
  lines: [],
  payments: [],
  total_weight: "5.860",
  total_amount: "20030.00",
  avg_price_per_g: "3418.09",
  paid: "0.00",
  balance: "20030.00",
  ...patch,
});

describe("buildQuoteBody", () => {
  it("sends typed numbers as text (no price — the server computes it), a bank only for transfers, no date", () => {
    expect(buildQuoteBody(withBill())).toEqual({
      customer_id: "c-1",
      lines: [{ metal_id: "gold", weight_g: "5.86", purity_percent: "96.5", deduct_percent: "3" }],
      payments: [
        { method: "cash", amount: "20000" },
        { method: "transfer", bank: "กสิกรไทย", amount: "30" },
      ],
    });
  });

  it("omits the customer when none is picked", () => {
    expect(buildQuoteBody(initialBuyState)).toEqual({ lines: [], payments: [] });
  });

  it("adds the backdate and its reason, and refuses to build while the date is unusable", () => {
    const on = buyReducer(withBill(), { type: "backdateToggled", enabled: true, today: "2026-09-29" });
    const typed = buyReducer(on, { type: "backdateDateTyped", text: "27/09/2569" });
    const committed = buyReducer(typed, { type: "backdateDateCommitted", today: "2026-09-29" });
    expect(buildQuoteBody(committed, "  คีย์ใบเขียนมือ  ")).toMatchObject({
      date: "2026-09-27",
      backdate_reason: "คีย์ใบเขียนมือ",
    });
    const broken = buyReducer(buyReducer(committed, { type: "backdateDateTyped", text: "31/02/2569" }), {
      type: "backdateDateCommitted",
      today: "2026-09-29",
    });
    expect(buildQuoteBody(broken)).toBeNull();
  });
});

describe("buildSaveBody", () => {
  it("adds the key and full_tax false, trims the detail, and sends no time for a today bill", () => {
    const body = buildSaveBody(withBill({ detail: "  ทอง 96.5%  " }), "key-1234567890abcdef");
    expect(body).toMatchObject({ full_tax: false, idempotency_key: "key-1234567890abcdef", detail: "ทอง 96.5%" });
    expect(body).not.toHaveProperty("time");
    expect(buildSaveBody(withBill({ detail: "   " }), "k".repeat(16))).not.toHaveProperty("detail");
  });

  it("sends the time for a backdated bill", () => {
    let s = buyReducer(withBill(), { type: "backdateToggled", enabled: true, today: "2026-09-29" });
    s = buyReducer(s, { type: "backdateTimeTyped", text: " 14:05 " });
    s = buyReducer(s, { type: "backdateTimeCommitted" });
    expect(buildSaveBody(s, "k".repeat(16))).toMatchObject({ time: "14:05", date: "2026-09-29" });
  });
});

describe("backdate", () => {
  const commit = (text: string) =>
    buyReducer(
      buyReducer(buyReducer(initialBuyState, { type: "backdateToggled", enabled: true, today: "2026-09-29" }), {
        type: "backdateDateTyped",
        text,
      }),
      { type: "backdateDateCommitted", today: "2026-09-29" },
    ).backdate;

  it("reads BE dates, rewrites them in the standard form and flags past dates", () => {
    expect(commit("1/9/2569")).toMatchObject({ date: null, dateError: "tooOld" });
    expect(commit("22/9/2569")).toMatchObject({ date: "2026-09-22", dateText: "22/09/2569", past: true });
    expect(commit("29/09/2569")).toMatchObject({ date: "2026-09-29", past: false, dateError: null });
  });

  it("rejects unreadable and future dates", () => {
    expect(commit("29/13/2569")).toMatchObject({ date: null, dateError: "badDate" });
    expect(commit("30/09/2569")).toMatchObject({ date: null, dateError: "futureDate" });
  });

  it("needs a time for a past date and checks the time format", () => {
    const past = commit("28/09/2569");
    expect(backdateIssue(past)).toEqual({ field: "time", error: "timeRequired" });
    const badTime = buyReducer(
      buyReducer({ ...initialBuyState, backdate: past }, { type: "backdateTimeTyped", text: "25:00" }),
      { type: "backdateTimeCommitted" },
    ).backdate;
    expect(backdateIssue(badTime)).toEqual({ field: "time", error: "badTime" });
    expect(backdateIssue({ ...past, timeText: "09:30" })).toBeNull();
    expect(backdateIssue(initialBuyState.backdate)).toBeNull();
  });

  it("blocks an uncommitted date change instead of silently keeping the old one (B1)", () => {
    const committed = buyReducer(
      buyReducer(buyReducer(initialBuyState, { type: "backdateToggled", enabled: true, today: "2026-09-29" }), {
        type: "backdateDateTyped",
        text: "22/09/2569",
      }),
      { type: "backdateDateCommitted", today: "2026-09-29" },
    );
    expect(committed.backdate.date).toBe("2026-09-22");

    // พิมพ์วันที่ใหม่แล้วยังไม่กด Enter/blur — date ต้องไม่ใช่ทั้งค่าเดิม (22) และค่าที่พิมพ์ใหม่ (23) จนกว่าจะยืนยัน
    const retyped = buyReducer(committed, { type: "backdateDateTyped", text: "23/09/2569" });
    expect(retyped.backdate.date).toBeNull();
    expect(retyped.backdate.dateText).toBe("23/09/2569");
    expect(buildQuoteBody(retyped)).toBeNull();
    expect(buildSaveBody(retyped, "k".repeat(16))).toBeNull();
    expect(backdateIssue(retyped.backdate)).toEqual({ field: "date", error: "dateNotConfirmed" });

    // ยืนยันแล้ว — date กลับมาเป็นค่าที่ตรวจแล้วอีกครั้ง (ปัญหาที่เหลือคือยังไม่กรอกเวลา ไม่ใช่วันที่อีกต่อไป)
    const reCommitted = buyReducer(retyped, { type: "backdateDateCommitted", today: "2026-09-29" });
    expect(reCommitted.backdate.date).toBe("2026-09-23");
    expect(backdateIssue(reCommitted.backdate)).toEqual({ field: "time", error: "timeRequired" });
  });

  it("checks the typed time live, so an invalid time cannot slip through before it is committed (B1)", () => {
    const past = commit("28/09/2569");
    // เวลาที่พิมพ์ไว้ผิดรูปแบบแต่ยังไม่ได้ blur/Enter — timeError ในสถานะยังเป็น null แต่ backdateIssue ต้องจับได้
    expect(backdateIssue({ ...past, timeText: "25:00", timeError: null })).toEqual({
      field: "time",
      error: "badTime",
    });
  });
});

describe("entry rows", () => {
  const entry = { metal_id: "nak", purity_percent: "90", deduct_percent: "2", weight_g: "1" };
  const LINE_FIELDS = ["metal_id", "purity_percent", "deduct_percent", "weight_g"] as const;

  it("starts with no deduction and an empty purity", () => {
    expect(initialBuyState.lineEntry).toEqual({ metal_id: "", purity_percent: "", deduct_percent: "0", weight_g: "" });
  });

  it("clears purity and weight and resets the deduction after an add, but keeps the metal and anything typed meanwhile", () => {
    const s = { ...initialBuyState, lineEntry: entry };
    const added = buyReducer(s, { type: "lineAdded", line: { key: "k", ...entry }, entry });
    expect(added.lines).toHaveLength(1);
    expect(added.lineEntry).toEqual({ metal_id: "nak", purity_percent: "", deduct_percent: "0", weight_g: "" });
    const typing = { ...s, lineEntry: { ...entry, purity_percent: "75" } };
    expect(buyReducer(typing, { type: "lineAdded", line: { key: "k", ...entry }, entry }).lineEntry).toEqual({
      ...entry,
      purity_percent: "75",
    });
  });

  it("Esc clears the row being typed: purity and weight empty, deduction back to 0, metal kept", () => {
    const s = { ...initialBuyState, lineEntry: entry, lineError: { field: "weight_g" as const, message: "x" } };
    const cleared = buyReducer(s, { type: "lineEntryCleared" });
    expect(cleared.lineEntry).toEqual({ metal_id: "nak", purity_percent: "", deduct_percent: "0", weight_g: "" });
    expect(cleared.lineError).toBeNull();
  });

  it("maps a server error of the new row to its entry field, the first one in typing order", () => {
    const errors = [
      { field: "customer_id", message: "ต้องระบุลูกค้าก่อนบันทึก" },
      // เซิร์ฟเวอร์ตรวจน้ำหนักก่อนค่าบริสุทธิ์ — แต่พนักงานกรอกค่าบริสุทธิ์ก่อน จึงชี้ช่องนั้นก่อน
      { field: "lines.2.weight_g", message: "น้ำหนักต้องมากกว่า 0" },
      { field: "lines.2.purity_percent", message: "กรุณากรอกค่าบริสุทธิ์ (%)" },
    ];
    expect(entryErrorFrom(errors, "lines", 2, LINE_FIELDS)).toEqual({
      field: "purity_percent",
      message: "กรุณากรอกค่าบริสุทธิ์ (%)",
    });
    expect(entryErrorFrom(errors.slice(0, 2), "lines", 2, LINE_FIELDS)).toEqual({
      field: "weight_g",
      message: "น้ำหนักต้องมากกว่า 0",
    });
    expect(entryErrorFrom(errors, "lines", 1, LINE_FIELDS)).toBeNull();
  });
});

describe("payments", () => {
  it("treats the same method (and bank after trimming) as a duplicate, like the API", () => {
    const rows = withBill().payments;
    expect(isDuplicatePayment(rows, "cash", "")).toBe(true);
    expect(isDuplicatePayment(rows, "transfer", "กสิกรไทย")).toBe(true);
    expect(isDuplicatePayment(rows, "transfer", "กรุงเทพ")).toBe(false);
  });

  it("reads the sign of server money text without computing", () => {
    expect(isZeroMoney("0.00")).toBe(true);
    expect(isZeroMoney("-0.00")).toBe(true);
    expect(isZeroMoney("0.01")).toBe(false);
    expect(isNegativeMoney("-100.00")).toBe(true);
    expect(isNegativeMoney("-0.00")).toBe(false);
  });

  it("shows the legacy balance messages and never green while stale", () => {
    expect(balanceView(quote(), true, false, t)).toEqual({
      tone: "due",
      text: t("payments.balanceDue", { amount: "20,030.00" }),
    });
    expect(balanceView(quote({ balance: "0.00" }), true, true, t)).toEqual({
      tone: "balanced",
      text: t("payments.balanced"),
    });
    expect(balanceView(quote({ balance: "-100.00" }), true, true, t).text).toBe(
      t("payments.balanceOver", { amount: "100.00" }),
    );
    expect(balanceView(quote({ balance: "0.00" }), false, true, t).tone).toBe("stale");
    expect(balanceView(quote({ balance: "0.00", total_amount: "0.00" }), true, false, t).tone).toBe("due");
  });
});

describe("quote helpers", () => {
  it("reads the card status back from the server message", () => {
    expect(cardStatusFromQuote([{ field: "customer_id", message: "บัตรประชาชนหมดอายุแล้ว" }])).toBe("expired");
    expect(cardStatusFromQuote([{ field: "lines", message: "ยังไม่มีรายการสินค้า" }])).toBe("ok");
    expect(cardStatusFromQuote([{ field: "customer_id", message: "ต้องระบุลูกค้าก่อนบันทึก" }])).toBeNull();
  });

  it("sends focus to the field that needs fixing", () => {
    expect(focusTargetForField("customer_id", false)).toBe("idBox");
    expect(focusTargetForField("customer_id", true)).toBe("editCustomer");
    expect(focusTargetForField("lines", true)).toBe("purity");
    expect(focusTargetForField("lines.0.purity_percent", true)).toBe("purity");
    expect(focusTargetForField("payments.1.bank", true)).toBe("bank");
    expect(focusTargetForField("payments", true)).toBe("paymentAmount");
    expect(focusTargetForField("backdate_reason", true)).toBe("backdateReason");
    expect(focusTargetForField("gold_price", true)).toBeNull();
    expect(focusTargetForField("branch", true)).toBeNull();
  });

  it("makes idempotency keys the API accepts", () => {
    expect(randomKey()).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(randomKey()).not.toBe(randomKey());
  });
});
