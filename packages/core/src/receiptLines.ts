import type Decimal from "decimal.js";
import { formatPercent } from "./assess";
import { pricePerGram } from "./buy";
import { ReceiptDataError } from "./errors";
import { fmtMoney, fmtWeight, requireDecimal } from "./money";

/** แถวรายการตามที่บันทึก (เงิน/น้ำหนัก/เปอร์เซ็นต์เป็น string จาก numeric) */
export interface ReceiptLine {
  metalName: string;
  weightG: string;
  amount: string;
  /** ค่าบริสุทธิ์ (%) — null/ไม่ส่ง = บิลก่อนมีช่องนี้ (ราคาพิมพ์เอง) */
  purityPercent?: string | null;
  /** หัก % — null/ไม่ส่ง = บิลก่อนมีช่องนี้ */
  deductPercent?: string | null;
}

/** แถวที่พิมพ์บนใบรับซื้อ — หนึ่งแถวต่อ (โลหะ · ค่าบริสุทธิ์ · หัก %) */
export interface ReceiptLineGroup {
  /** ชื่อที่พิมพ์ในช่องรายการ เช่น "ทอง 96.5% หัก 3%" · บิลเก่า = ชื่อโลหะ */
  label: string;
  /** Σ น้ำหนัก 3 ตำแหน่ง */
  weightG: string;
  /** ราคาต่อหน่วยถัวเฉลี่ย = Σราคา ÷ Σน้ำหนัก ปัดครึ่งขึ้น 2 ตำแหน่ง (pricePerGram) */
  unitPrice: string;
  /** Σ ราคา 2 ตำแหน่ง */
  amount: string;
}

/**
 * ชื่อรายการบนใบ: โลหะ + ค่าบริสุทธิ์ + หัก % (หัก 0 ไม่พิมพ์) — ร้านขอให้แสดง % บนใบ (UAT 30 ก.ย. 2569)
 * บิลก่อนมีช่องบริสุทธิ์ = ชื่อโลหะอย่างเดียวเหมือนเดิม
 */
export function receiptLineLabel(line: Pick<ReceiptLine, "metalName" | "purityPercent" | "deductPercent">): string {
  if (line.purityPercent == null) return line.metalName;
  const purity = `${line.metalName} ${formatPercent(requireDecimal(line.purityPercent, "ค่าบริสุทธิ์"))}%`;
  const deduct = line.deductPercent == null ? null : requireDecimal(line.deductPercent, "หัก %");
  return deduct?.gt(0) ? `${purity} หัก ${formatPercent(deduct)}%` : purity;
}

/**
 * ใบจริงของร้านพิมพ์ "1 บรรทัดต่อชนิดโลหะ" พร้อมราคาต่อหน่วยแบบถัวเฉลี่ย
 * (RC6909-0010: ทอง 5.860 ก. 3,418.09 บาท/ก. = 20,030.00 · ที่มา Django `_group_by_metal` + `BuyReceiptGroupingTest`)
 * มีค่าบริสุทธิ์/หัก % แล้ว จึงรวมตาม (โลหะ · บริสุทธิ์ · หัก %) แทน — ชิ้นที่ % ต่างกันพิมพ์แยกบรรทัด
 * เรียงตามลำดับที่กลุ่มปรากฏครั้งแรกในบิล · ตัวเลขเสีย/น้ำหนักรวมไม่เกิน 0 = ReceiptDataError
 */
export function groupLinesByMetal(lines: readonly ReceiptLine[]): ReceiptLineGroup[] {
  const groups = new Map<string, { weight: Decimal; amount: Decimal }>();
  for (const line of lines) {
    const weight = requireDecimal(line.weightG, "น้ำหนัก");
    const amount = requireDecimal(line.amount, "ราคา");
    const label = receiptLineLabel(line);
    const g = groups.get(label);
    if (g) {
      g.weight = g.weight.plus(weight);
      g.amount = g.amount.plus(amount);
    } else {
      groups.set(label, { weight, amount });
    }
  }
  return [...groups].map(([label, g]) => {
    if (!g.weight.gt(0)) throw new ReceiptDataError(`น้ำหนักรวมของ${label}ต้องมากกว่า 0`);
    return {
      label,
      weightG: fmtWeight(g.weight),
      unitPrice: fmtMoney(pricePerGram(g.amount, g.weight)),
      amount: fmtMoney(g.amount),
    };
  });
}
