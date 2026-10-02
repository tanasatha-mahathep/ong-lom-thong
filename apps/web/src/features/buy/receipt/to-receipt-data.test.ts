import { describe, expect, it } from "vitest";
import { makeAssessedLine, makeBill } from "@/test/bill-fixture";
import { RECEIPT_COMPANY_FALLBACK, toReceiptData } from "./to-receipt-data";

describe("toReceiptData", () => {
  it("builds the screen receipt from the bill with a masked ID and the shop header", () => {
    const data = toReceiptData(makeBill({ detail: "ทอง 96.5%" }));
    expect(data).toEqual({
      company: RECEIPT_COMPANY_FALLBACK,
      branch: { name: "สำนักงานใหญ่ (สาขา 1)", taxBranchCode: "00000" },
      docNo: "RC6909-0001",
      date: "2026-09-29",
      time: "14:05",
      customer: {
        nameTh: "นายทดสอบ ซื้อเข้า",
        address: "99 หมู่ 9 ต.ทดสอบ อ.เมือง จ.ภูเก็ต",
        nationalId: "1 XXXX XXXXX 01 0",
      },
      // บิลก่อนมีค่าบริสุทธิ์ — null = ใบพิมพ์ชื่อโลหะอย่างเดียว
      lines: [{ metalName: "ทอง", weightG: "5.860", amount: "20030.00", purityPercent: null, deductPercent: null }],
      detail: "ทอง 96.5%",
      totalAmount: "20030.00",
      payments: [{ label: "เงินสด", bank: null, amount: "20030.00" }],
      status: "active",
      voidReason: null,
    });
  });

  it("passes purity and deduction to the receipt lines so the screen matches the PDF", () => {
    const data = toReceiptData(makeBill({ lines: [makeAssessedLine()] }));
    expect(data.lines).toEqual([
      { metalName: "ทอง", weightG: "10.000", amount: "41535.00", purityPercent: "96.50", deductPercent: "3" },
    ]);
  });

  it("keeps the void reason only on void bills", () => {
    expect(toReceiptData(makeBill({ status: "void", void_reason: "คีย์ผิดลูกค้า" })).voidReason).toBe("คีย์ผิดลูกค้า");
    expect(toReceiptData(makeBill({ void_reason: "ค้างจากร่าง" })).voidReason).toBeNull();
  });

  it("prefers the receipt the API built for the PDF", () => {
    const api = { ...toReceiptData(makeBill()), company: { ...RECEIPT_COMPANY_FALLBACK, tel: "076000000" } };
    expect(toReceiptData(makeBill({ receipt: api }))).toBe(api);
  });
});
