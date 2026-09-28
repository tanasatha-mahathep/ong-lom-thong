import { type CardStatus, maskNationalId, quoteBuy } from "@ong/core";
import type { QuoteBody } from "@/features/buy/types";
import { BRANCH_HQ, json } from "./app";

/**
 * API ปลอมของหน้าซื้อเข้า — quote ใช้ quoteBuy() ตัวเดียวกับเซิร์ฟเวอร์ (ฝั่งเทสต์เท่านั้น แอปไม่ import สูตรนี้)
 * ลูกค้าเป็นข้อมูลสมมติ (เลขบัตร checksum ถูก)
 */
export const TODAY = "2026-09-29";

export const METALS = [
  { id: "m-gold", code: "gold", name_th: "ทอง", unit: "g", assessment_enabled: false },
  { id: "m-nak", code: "nak", name_th: "นาก", unit: "g", assessment_enabled: false },
  { id: "m-silver", code: "silver", name_th: "เงิน", unit: "g", assessment_enabled: false },
  { id: "m-platinum", code: "platinum", name_th: "แพลตตินั่ม", unit: "g", assessment_enabled: false },
];

export interface FakeCustomer {
  id: string;
  national_id: string;
  name_th: string;
  card_status: CardStatus;
}

export const CUSTOMER_OK: FakeCustomer = {
  id: "0b6b3f3e-8d1c-4a55-9f0e-000000000001",
  national_id: "1909900001010",
  name_th: "นายทดสอบ ซื้อเข้า",
  card_status: "ok",
};
export const CUSTOMER_EXPIRED: FakeCustomer = {
  id: "0b6b3f3e-8d1c-4a55-9f0e-000000000002",
  national_id: "1909900001028",
  name_th: "นางทดสอบ บัตรหมดอายุ",
  card_status: "expired",
};

export const listItem = (c: FakeCustomer) => ({
  id: c.id,
  national_id_masked: maskNationalId(c.national_id),
  name_th: c.name_th,
  mobile: "0899999999",
  address: "99 หมู่ 9 ต.ทดสอบ อ.เมือง จ.ภูเก็ต",
  card_status: c.card_status,
});

/** ผล POST /api/buy/quote แบบเดียวกับ services/buy.ts (quoteJson) */
export function fakeQuote(body: QuoteBody, customers: readonly FakeCustomer[], goldPriceSet = true) {
  const buyer = customers.find((c) => c.id === body.customer_id);
  const q = quoteBuy({
    lines: body.lines.map((l) => ({ metalId: l.metal_id, weightG: l.weight_g, amount: l.amount })),
    payments: body.payments.map((p) => ({ method: p.method, bank: "bank" in p ? p.bank : null, amount: p.amount })),
    customer: buyer ? { id: buyer.id, cardStatus: buyer.card_status } : null,
    goldPriceSet,
  });
  return {
    ok: q.ok,
    errors: q.errors,
    date: body.date ?? TODAY,
    branch: BRANCH_HQ,
    gold_price_snapshot: goldPriceSet ? "67850.00" : null,
    lines: q.lines.map((l) => ({
      index: l.index,
      metal_id: l.metalId,
      weight_g: l.weightG,
      amount: l.amount,
      price_per_g: l.pricePerG,
    })),
    total_weight: q.totalWeight,
    total_amount: q.totalAmount,
    avg_price_per_g: q.avgPricePerG,
    paid: q.paid,
    balance: q.balance,
  };
}

/** GET /api/customers?q= — ค้นชื่อหรือเลขบัตรแบบ LIKE ของ API */
export function fakeCustomerSearch(path: string, customers: readonly FakeCustomer[]) {
  const q = new URL(path, "http://localhost").searchParams.get("q") ?? "";
  const digits = q.replace(/\D/g, "");
  const items = customers.filter(
    (c) => c.name_th.includes(q) || (digits.length >= 2 && c.national_id.includes(digits)),
  );
  return json({ items: items.map(listItem), page: 1, has_more: false });
}
