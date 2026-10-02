import type { ReceiptData } from "@ong/core/receipt";
import type { Bill } from "../bill-api";

/**
 * หัวใบของร้าน — ค่าเดียวกับ COMPANY_* ใน .env.example (หน้า "ข้อมูลบริษัท" ของระบบเดิม)
 * ใช้เฉพาะตอน API ยังไม่ส่ง `receipt` (ก่อน feat/api-pdf-wiring) — มีแล้วใช้ของ API เสมอ (หัวใบแช่แข็งต่อบิล R15)
 */
export const RECEIPT_COMPANY_FALLBACK: ReceiptData["company"] = {
  name: "โอเอ็นจี หลอมทอง",
  address: "156/7 ถนนพังงา ตำบลตลาดใหญ่ อำเภอเมืองภูเก็ต จังหวัดภูเก็ต 83000",
  tel: "0654249514",
  fax: null,
  taxId: "3839900461751",
};

/**
 * ข้อมูลใบรับซื้อบนจอ — ของ API ก่อน (ชุดเดียวกับ PDF) · ไม่มีจึงประกอบจากบิล
 * เลขบัตรบนจอเป็นแบบมาสก์เสมอ (R13) — เลขเต็มอยู่ใน PDF เก็บถาวรเท่านั้น
 * ไม่คำนวณอะไร: ยอด/ราคาต่อหน่วยของใบ <Receipt/> ทำด้วย helper ของ @ong/core ตัวเดียวกับ PDF
 */
export function toReceiptData(bill: Bill): ReceiptData {
  if (bill.receipt) return bill.receipt;
  return {
    company: RECEIPT_COMPANY_FALLBACK,
    branch: { name: bill.branch.name, taxBranchCode: bill.branch.tax_branch_code },
    docNo: bill.doc_no,
    date: bill.date,
    time: bill.time,
    customer: {
      nameTh: bill.customer.name_th,
      address: bill.customer.address,
      nationalId: bill.customer.national_id_masked,
    },
    // ค่าบริสุทธิ์/หัก % ไปกับแถว — <Receipt/> ตั้งชื่อรายการ "ทอง 96.5% หัก 3%" ด้วยตัวเดียวกับ PDF (บิลเก่า null = ชื่อโลหะ)
    lines: bill.lines.map((l) => ({
      metalName: l.metal.name_th,
      weightG: l.weight_g,
      amount: l.amount,
      purityPercent: l.purity_percent,
      deductPercent: l.deduct_percent,
    })),
    detail: bill.detail,
    totalAmount: bill.total_amount,
    payments: bill.payments.map((p) => ({ label: p.method_label, bank: p.bank, amount: p.amount })),
    status: bill.status,
    voidReason: bill.status === "void" ? bill.void_reason : null,
  };
}
