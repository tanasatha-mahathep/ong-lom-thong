import { describe, expect, it } from "vitest";
import { idcardPdfKey, receiptPdfKey, sha256Hex } from "./pdfArchive";

const BILL = { branchCode: "00000", date: "2026-10-01", docNo: "RC6910-0001" };

describe("key ของ PDF เก็บถาวร (spec §9.2)", () => {
  it("ใบรับซื้อ: receipts/<สาขา>/<ปี ค.ศ.>/<เดือน>/<เลขที่>.pdf · ฉบับยกเลิกเป็นไฟล์ใหม่ _void", () => {
    expect(receiptPdfKey(BILL)).toBe("receipts/00000/2026/10/RC6910-0001.pdf");
    expect(receiptPdfKey({ ...BILL, void: false })).toBe("receipts/00000/2026/10/RC6910-0001.pdf");
    expect(receiptPdfKey({ ...BILL, void: true })).toBe("receipts/00000/2026/10/RC6910-0001_void.pdf");
  });

  it("สำเนาบัตรอยู่คนละ prefix (สิทธิ์แคบกว่า)", () => {
    expect(idcardPdfKey(BILL)).toBe("idcards/00000/2026/10/RC6910-0001.pdf");
  });

  it("โฟลเดอร์เดือนมาจากวันที่ของบิล — ตรงกับที่ export รายเดือนอ่าน", () => {
    expect(receiptPdfKey({ branchCode: "00002", date: "2027-01-31", docNo: "RC7001-0123" })).toBe(
      "receipts/00002/2027/01/RC7001-0123.pdf",
    );
  });

  it("ปฏิเสธค่าที่อาจกลายเป็น path อื่นหรือชนกับไฟล์ _void", () => {
    for (const branchCode of ["", "../00000", "00/00", "00000 ", ".", "สาขา1"]) {
      expect(() => receiptPdfKey({ ...BILL, branchCode }), branchCode).toThrow(RangeError);
    }
    for (const docNo of ["", "..", "RC6910-0001/../x", "RC6910 0001", "RC6910_0001", "RC6910-0001.pdf", "-RC"]) {
      expect(() => receiptPdfKey({ ...BILL, docNo }), docNo).toThrow(RangeError);
      expect(() => idcardPdfKey({ ...BILL, docNo }), docNo).toThrow(RangeError);
    }
    for (const date of ["2026-02-30", "2026-13-01", "2026-9-1", "20261001", "2026-10-01T00:00:00Z", ""]) {
      expect(() => receiptPdfKey({ ...BILL, date }), date).toThrow(RangeError);
    }
  });
});

describe("sha256Hex", () => {
  it("ตรงกับค่ามาตรฐาน (FIPS 180-2)", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("ใช้เฉพาะ byte ของ view ที่ส่งมา ไม่ใช่ทั้ง buffer", () => {
    const whole = new TextEncoder().encode("xxabcxx");
    expect(sha256Hex(whole.subarray(2, 5))).toBe(sha256Hex(new TextEncoder().encode("abc")));
  });
});
