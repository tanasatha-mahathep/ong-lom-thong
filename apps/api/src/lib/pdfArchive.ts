import { createHash } from "node:crypto";

/**
 * ที่อยู่ของ PDF เก็บถาวรใน bucket (spec §9.2) — ใบรับซื้อกับสำเนาบัตรแยก prefix เพราะสิทธิ์เข้าถึงต่างกัน (PDPA)
 * export รายเดือน (§9.4) อ่านทั้งโฟลเดอร์ `receipts/<สาขา>/<yyyy>/<mm>/` — ห้ามเปลี่ยนรูปแบบหลังมีไฟล์จริงแล้ว
 */

export const PDF_CONTENT_TYPE = "application/pdf";

export interface ArchiveKeyInput {
  /** branch.code เช่น "00000" */
  branchCode: string;
  /** buy_receipt.date (YYYY-MM-DD วันตามเวลาไทย) — กำหนดโฟลเดอร์ปี ค.ศ./เดือน */
  date: string;
  /** buy_receipt.doc_no เช่น "RC6910-0001" */
  docNo: string;
}

// ส่วนของ key มาจาก DB แต่ key คือหลักฐานถาวร — รับเฉพาะตัวอักษรที่ไม่มีทางกลายเป็น path อื่น (/ . .. ช่องว่าง _)
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function archiveKey(prefix: string, { branchCode, date, docNo }: ArchiveKeyInput, suffix = ""): string {
  if (!SEGMENT.test(branchCode)) throw new RangeError(`รหัสสาขาใช้เป็น key ไม่ได้: ${JSON.stringify(branchCode)}`);
  if (!SEGMENT.test(docNo)) throw new RangeError(`เลขที่เอกสารใช้เป็น key ไม่ได้: ${JSON.stringify(docNo)}`);
  const m = ISO_DATE.exec(date);
  // Date เลื่อนวันที่เกินเดือนไปเดือนถัดไป (2026-02-30 → 03-02) — เทียบกลับให้ตรงตัวอักษร
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!m || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`วันที่ต้องเป็น YYYY-MM-DD: ${JSON.stringify(date)}`);
  }
  return `${prefix}/${branchCode}/${m[1]}/${m[2]}/${docNo}${suffix}.pdf`;
}

/** `receipts/<สาขา>/<yyyy>/<mm>/<doc_no>.pdf` · ฉบับยกเลิก = `…_void.pdf` (ไฟล์ใหม่ ฉบับเดิมคงอยู่) */
export function receiptPdfKey(input: ArchiveKeyInput & { void?: boolean }): string {
  return archiveKey("receipts", input, input.void ? "_void" : "");
}

/** `idcards/<สาขา>/<yyyy>/<mm>/<doc_no>.pdf` — สำเนาบัตรแยกไฟล์ สิทธิ์แคบกว่าใบรับซื้อ (spec §9.1) */
export function idcardPdfKey(input: ArchiveKeyInput): string {
  return archiveKey("idcards", input);
}

/** sha256 (hex ตัวเล็ก) ของไฟล์ที่เก็บ — บันทึกคู่ key ใน DB ไว้พิสูจน์ว่าไฟล์ไม่ถูกแก้ภายหลัง */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
