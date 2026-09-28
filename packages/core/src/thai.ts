import type Decimal from "decimal.js";
import { D, halfUp } from "./money";

/**
 * ข้อความไทยบนเอกสาร — จำนวนเงินเป็นตัวอักษร · วันที่ พ.ศ. · ป้ายสาขาตามสรรพากร
 * ทั้งหมดปรากฏบนใบรับซื้อจริงของร้าน (RC6909-0010) จึงต้องตรง ไม่ใช่ของตกแต่ง
 * ที่มา: Django core/baht_text.py · core/templatetags/thai.py · core/models.py Branch.tax_branch_label
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

/**
 * จำนวนเงินเป็นตัวอักษรแบบที่พิมพ์บนใบรับซื้อ (บรรทัด "ตัวอักษร")
 * ปัดครึ่งขึ้น 2 ตำแหน่งด้วย decimal.js ก่อนอ่าน — ห้ามผ่าน float
 * "20030.00" → "สองหมื่นสามสิบบาทถ้วน" (ใบจริง RC6909-0010) · "3418.09" → "สามพันสี่ร้อยสิบแปดบาทเก้าสตางค์"
 * @throws เมื่อไม่ใช่ตัวเลข — เอกสารภาษีต้องไม่ออกมาพร้อมช่องตัวอักษรว่าง
 */
export function bahtText(amount: string | Decimal): string {
  const value = D(amount);
  if (!value.isFinite()) throw new RangeError(`bahtText: ไม่ใช่จำนวนเงิน: ${String(amount)}`);
  const rounded = halfUp(value, 2);
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

/** "YYYY-MM-DD" (หรือ ISO ที่ขึ้นต้นแบบนั้น) → ปี/เดือน/วัน ตามที่เขียน — ไม่แปลงเขตเวลา · วันไม่มีจริง = throw */
function parseIsoDate(iso: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(iso.trim());
  const y = Number(match?.[1]);
  const m = Number(match?.[2]);
  const d = Number(match?.[3]);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!match || dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new RangeError(`วันที่ต้องเป็น ISO ค.ศ. YYYY-MM-DD: ${iso}`);
  }
  return { y, m, d };
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
 * @throws เมื่อไม่ใช่ตัวเลข 5 หลัก — ไม่เดาเลขสาขาบนเอกสารภาษี
 */
export function taxBranchLabel(code: string | null | undefined): string | null {
  const c = code?.trim() ?? "";
  if (c === "") return null;
  if (!/^\d{5}$/.test(c)) throw new RangeError(`รหัสสาขาต้องเป็นตัวเลข 5 หลัก: "${c}"`);
  return c === "00000" ? "สำนักงานใหญ่" : `สาขาที่ ${c}`;
}
