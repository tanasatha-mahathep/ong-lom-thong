import { BRANCH_HQ, type fakeApi, json } from "@/test/app";
import { type Bill, type BillListTotals } from "./api";

/** ข้อมูลปลอมของ GET /api/buy สำหรับเทสต์หน้าค้นบิลและการ์ดบิลวันนี้ (เลขบัตรสมมติ มาสก์แบบ maskNationalId) */

/** ยอดเกิน 2^53 — ถ้าผ่าน float หลักท้ายจะเพี้ยน */
export const BILL: Bill = {
  id: "7f1c2d3e-0000-4000-8000-000000000002",
  doc_no: "PT-RC6910-0002",
  date: "2026-09-28",
  time: "14:05",
  branch: BRANCH_HQ,
  customer: { id: "c-0001", name_th: "นายทดสอบ ซื้อเข้า", national_id_masked: "1 XXXX XXXXX 01 0" },
  total_weight: "15.2",
  total_amount: "12345678901234567.89",
  status: "active",
  pdf_status: "ready",
  created_by: { id: "u-staff", name: "ทดสอบ staff" },
};

export const VOID_BILL: Bill = {
  ...BILL,
  id: "7f1c2d3e-0000-4000-8000-000000000001",
  doc_no: "PT-RC6910-0001",
  time: "09:30",
  customer: { id: "c-0002", name_th: "นางทดสอบ ยกเลิก", national_id_masked: "3 XXXX XXXXX 28 4" },
  total_weight: "3.000",
  total_amount: "5000.00",
  status: "void",
  pdf_status: "failed",
};

export const TOTALS: BillListTotals = {
  count: "1234",
  total_weight: "12345678901234.567",
  total_amount: "99999999999999.99",
};

/** คำตอบของ GET /api/buy รูปเต็ม (items · page · has_more · totals) */
export const buyList = (items: Bill[], extra: { page?: number; has_more?: boolean; totals?: BillListTotals } = {}) =>
  json({ items, page: 1, has_more: false, totals: TOTALS, ...extra });

/** query string ของทุกคำขอ GET /api/buy ตามลำดับ */
export const listRequests = (api: ReturnType<typeof fakeApi>) =>
  api
    .callsTo("GET", "/api/buy")
    .map((call) => Object.fromEntries(new URL(call.path, "http://test.local").searchParams));
