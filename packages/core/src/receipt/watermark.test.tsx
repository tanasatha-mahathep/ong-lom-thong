import { describe, expect, it } from "vitest";
import { type ReceiptData, renderIdCardHtml, renderReceiptHtml } from "./index";

// ข้อมูลสมมติ — ลายน้ำคือสิ่งที่ทดสอบ (เลขบัตร checksum ถูก ไม่ใช่ของจริง)
const data: ReceiptData = {
  company: { name: "ร้านทดสอบ", address: "1 ถนนทดสอบ", tel: "0800000000", fax: null, taxId: "1234567890121" },
  branch: { name: "สำนักงานใหญ่", taxBranchCode: "00000" },
  docNo: "RC6910-0001",
  date: "2026-10-05",
  time: "10:00",
  customer: { nameTh: "นายทดสอบ ลายน้ำ", address: null, nationalId: "1103700123458" },
  lines: [{ metalName: "ทอง", weightG: "5.860", amount: "20030.00" }],
  detail: null,
  totalAmount: "20030.00",
  payments: [{ label: "เงินสด", bank: null, amount: "20030.00" }],
  status: "active",
};
const TEXT = "ตัวอย่าง — ระบบทดสอบ ไม่ใช่ใบรับซื้อจริง";
const idcard = { docNo: "RC6910-0001", date: "2026-10-05", companyName: "ร้านทดสอบ", photoSrc: "card.png" };

describe("ลายน้ำระบบทดสอบ (RECEIPT_WATERMARK)", () => {
  it("ใบรับซื้อและสำเนาบัตร: มีลายน้ำเมื่อส่งมา", () => {
    for (const html of [
      renderReceiptHtml({ ...data, watermark: TEXT }),
      renderIdCardHtml({ ...idcard, watermark: TEXT }),
    ]) {
      expect(html).toContain('class="ong-watermark"');
      expect(html).toContain(TEXT);
    }
  });

  it("production ไม่ส่ง = ไม่มีลายน้ำ (ใบจริง)", () => {
    for (const html of [
      renderReceiptHtml(data),
      renderReceiptHtml({ ...data, watermark: "" }),
      renderIdCardHtml(idcard),
    ]) {
      expect(html).not.toContain('class="ong-watermark"');
    }
  });
});
