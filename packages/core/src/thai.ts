import type Decimal from "decimal.js";
import { ReceiptDataError } from "./errors";
import { halfUp, requireDecimal } from "./money";

/**
 * ข้อความไทยบนเอกสาร — จำนวนเงินเป็นตัวอักษร · วันที่ พ.ศ. · ป้ายสาขาตามสรรพากร
 * ทั้งหมดปรากฏบนใบรับซื้อจริงของร้าน (RC6909-0010) จึงต้องตรง ไม่ใช่ของตกแต่ง
 * ที่มา: Django core/baht_text.py · core/templatetags/thai.py · core/models.py Branch.tax_branch_label
 * ข้อมูลที่ใช้ไม่ได้ = ReceiptDataError เสมอ (งาน PDF แยกออกว่าเป็นความล้มเหลวถาวร ไม่ retry)
 */

const DIGIT = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"] as const;
const PLACE = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"] as const;

/** อ่านเลขไม่เกิน 6 หลัก (หนึ่งกลุ่มล้าน) · กลุ่มล่างของเลขที่เกินล้านมีศูนย์นำหน้าได้ ("000001" → "เอ็ด") */
function readGroup(digits: string): string {
  let out = "";
  const len = digits.length;
  for (let i = 0; i < len; i++) {
    const d = digits.charCodeAt(i) - 48;
    const pos = len - i - 1;
    if (d === 0) continue;
    if (pos === 0 && d === 1 && len > 1) out += "เอ็ด";
    else if (pos === 1 && d === 2) out += "ยี่สิบ";
    else if (pos === 1 && d === 1) out += "สิบ";
    else out += `${DIGIT[d] ?? ""}${PLACE[pos] ?? ""}`;
  }
  return out;
}

/** อ่านจำนวนเต็ม (สตริงตัวเลขล้วน) — ตัดทีละ 6 หลักเพราะภาษาไทยอ่าน "ล้าน" ซ้อนกันได้ */
function readInteger(digits: string): string {
  const s = digits.replace(/^0+(?=\d)/, "");
  if (s === "0") return "ศูนย์";
  if (s.length <= 6) return readGroup(s);
  const low = s.slice(-6);
  return `${readInteger(s.slice(0, -6))}ล้าน${/^0+$/.test(low) ? "" : readGroup(low)}`;
}

/** ยอดสูงสุดที่ DB เก็บได้ (numeric(14,2)) — เกินนี้ไม่ใช่ยอดบิลจริง */
const MAX_BAHT_TEXT = "999999999999.99";

/**
 * จำนวนเงินเป็นตัวอักษรแบบที่พิมพ์บนใบรับซื้อ (บรรทัด "ตัวอักษร")
 * ปัดครึ่งขึ้น 2 ตำแหน่งด้วย decimal.js ก่อนอ่าน — ห้ามผ่าน float
 * "20030.00" → "สองหมื่นสามสิบบาทถ้วน" (ใบจริง RC6909-0010) · "3418.09" → "สามพันสี่ร้อยสิบแปดบาทเก้าสตางค์"
 * @throws ReceiptDataError เมื่อไม่ใช่ตัวเลข หรือเกิน numeric(14,2) — เอกสารภาษีต้องไม่ออกมาพร้อมช่องตัวอักษรว่าง/ผิด
 */
export function bahtText(amount: string | Decimal): string {
  const rounded = halfUp(requireDecimal(amount, "จำนวนเงิน"), 2);
  if (rounded.abs().gt(MAX_BAHT_TEXT)) {
    throw new ReceiptDataError(`จำนวนเงินเกิน 999,999,999,999.99 (numeric(14,2)): "${String(amount)}"`);
  }
  const [baht = "0", satang = "00"] = rounded.abs().toFixed(2).split(".");
  const text = satang === "00" ? `${readInteger(baht)}บาทถ้วน` : `${readInteger(baht)}บาท${readInteger(satang)}สตางค์`;
  return rounded.isNegative() && !rounded.isZero() ? `ลบ${text}` : text;
}

const MONTH = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;
const MONTH_ABBR = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * รับเฉพาะ "YYYY-MM-DD" ปี ค.ศ. 2000–2200 ที่เป็นวันจริงในปฏิทิน — อย่างอื่น (มีเวลา/ช่องว่าง · ปี พ.ศ. · 30 ก.พ.) = throw
 * ไม่แปลงเขตเวลา: วันที่บนบิลคือวันทำการตามเวลาไทยที่บันทึกไว้แล้ว (businessDate)
 */
function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const match = ISO_DATE.exec(iso);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const real = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    if (y >= 2000 && y <= 2200 && real) return { y, m, d };
  }
  throw new ReceiptDataError(`วันที่ต้องเป็น ค.ศ. YYYY-MM-DD ปี 2000–2200 และเป็นวันจริง: "${String(iso)}"`);
}

/** วันที่แบบเต็มบนใบรับซื้อ: "2026-09-02" → "2 กันยายน 2569" */
export function thaiDate(iso: string): string {
  const { y, m, d } = parseIsoDate(iso);
  return `${d} ${MONTH[m - 1] ?? ""} ${y + 543}`;
}

/** วันที่แบบย่อสำหรับตาราง/รายการ: "2026-09-02" → "2 ก.ย. 2569" */
export function thaiDateShort(iso: string): string {
  const { y, m, d } = parseIsoDate(iso);
  return `${d} ${MONTH_ABBR[m - 1] ?? ""} ${y + 543}`;
}

/**
 * ป้ายสาขาที่ต้องพิมพ์ต่อท้ายที่อยู่ผู้ออกเอกสาร (ระเบียบสรรพากร · ระบบเดิมพิมพ์ "(สำนักงานใหญ่)")
 * "00000" → "สำนักงานใหญ่" · "00001" → "สาขาที่ 00001" · ว่าง/null → null (ไม่พิมพ์)
 * @throws ReceiptDataError เมื่อไม่ใช่ตัวเลข 5 หลัก — ไม่เดาเลขสาขาบนเอกสารภาษี
 */
export function taxBranchLabel(code: string | null | undefined): string | null {
  const c = code?.trim() ?? "";
  if (c === "") return null;
  if (!/^\d{5}$/.test(c)) throw new ReceiptDataError(`รหัสสาขาต้องเป็นตัวเลข 5 หลัก: "${c}"`);
  return c === "00000" ? "สำนักงานใหญ่" : `สาขาที่ ${c}`;
}
