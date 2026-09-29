import type { Bill } from "@/features/buy/bill-api";
import { BRANCH_HQ } from "./app";

/** บิลที่บันทึกแล้วแบบ GET /api/buy/:id (ลูกค้าสมมติ · ยอดตรงกันทั้งใบ) */
export function makeBill(patch: Partial<Bill> = {}): Bill {
  return {
    id: "7f1c2d3e-0000-4000-8000-000000000001",
    doc_no: "RC6909-0001",
    date: "2026-09-29",
    time: "14:05",
    branch: { ...BRANCH_HQ, tax_branch_code: "00000" },
    customer: {
      id: "0b6b3f3e-8d1c-4a55-9f0e-000000000001",
      name_th: "นายทดสอบ ซื้อเข้า",
      name_en: null,
      address: "99 หมู่ 9 ต.ทดสอบ อ.เมือง จ.ภูเก็ต",
      national_id_masked: "1 XXXX XXXXX 01 0",
    },
    gold_price_snapshot: "67850.00",
    detail: null,
    lines: [
      {
        line_no: 1,
        metal: { id: "m-gold", code: "gold", name_th: "ทอง" },
        weight_g: "5.860",
        amount: "20030.00",
        price_per_g: "3418.09",
      },
    ],
    payments: [{ method: "cash", method_label: "เงินสด", bank: null, amount: "20030.00" }],
    total_weight: "5.860",
    total_amount: "20030.00",
    avg_price_per_g: "3418.09",
    status: "active",
    pdf_status: "pending",
    idcard_status: "none",
    void_pdf_status: "none",
    created_by: { id: "u-staff", name: "ทดสอบ staff" },
    created_at: "2026-09-29T07:05:00.000Z",
    voided_at: null,
    void_reason: null,
    ...patch,
  };
}
