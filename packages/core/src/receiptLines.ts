import type Decimal from "decimal.js";
import { pricePerGram } from "./buy";
import { ReceiptDataError } from "./errors";
import { fmtMoney, fmtWeight, requireDecimal } from "./money";

/** แถวรายการตามที่บันทึก (เงิน/น้ำหนักเป็น string จาก numeric) */
export interface ReceiptLine {
  metalName: string;
  weightG: string;
  amount: string;
}

/** แถวที่พิมพ์บนใบรับซื้อ — หนึ่งแถวต่อโลหะ */
export interface ReceiptLineGroup {
  metalName: string;
  /** Σ น้ำหนัก 3 ตำแหน่ง */
  weightG: string;
  /** ราคาต่อหน่วยถัวเฉลี่ย = Σราคา ÷ Σน้ำหนัก ปัดครึ่งขึ้น 2 ตำแหน่ง (pricePerGram) */
  unitPrice: string;
  /** Σ ราคา 2 ตำแหน่ง */
  amount: string;
}

/**
 * ใบจริงของร้านพิมพ์ "1 บรรทัดต่อชนิดโลหะ" พร้อมราคาต่อหน่วยแบบถัวเฉลี่ย
 * (RC6909-0010: ทอง 5.860 ก. 3,418.09 บาท/ก. = 20,030.00 · %เนื้อทองแต่ละก้อนอยู่ในช่องรายละเอียด)
 * ที่มา: Django sales/views.py `_group_by_metal` + `BuyReceiptGroupingTest`
 * เรียงตามลำดับที่โลหะปรากฏครั้งแรกในบิล · ตัวเลขเสีย/น้ำหนักรวมไม่เกิน 0 = ReceiptDataError
 */
export function groupLinesByMetal(lines: readonly ReceiptLine[]): ReceiptLineGroup[] {
  const groups = new Map<string, { weight: Decimal; amount: Decimal }>();
  for (const line of lines) {
    const weight = requireDecimal(line.weightG, "น้ำหนัก");
    const amount = requireDecimal(line.amount, "ราคา");
    const g = groups.get(line.metalName);
    if (g) {
      g.weight = g.weight.plus(weight);
      g.amount = g.amount.plus(amount);
    } else {
      groups.set(line.metalName, { weight, amount });
    }
  }
  return [...groups].map(([metalName, g]) => {
    if (!g.weight.gt(0)) throw new ReceiptDataError(`น้ำหนักรวมของ${metalName}ต้องมากกว่า 0`);
    return {
      metalName,
      weightG: fmtWeight(g.weight),
      unitPrice: fmtMoney(pricePerGram(g.amount, g.weight)),
      amount: fmtMoney(g.amount),
    };
  });
}
