import type Decimal from "decimal.js";
import { pricePerGram } from "./buy";
import { D, fmtMoney, fmtWeight } from "./money";

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

function finite(v: string, what: string): Decimal {
  const d = D(v);
  if (!d.isFinite()) throw new RangeError(`${what}ไม่ใช่ตัวเลข: ${v}`);
  return d;
}

/**
 * ใบจริงของร้านพิมพ์ "1 บรรทัดต่อชนิดโลหะ" พร้อมราคาต่อหน่วยแบบถัวเฉลี่ย
 * (RC6909-0010: ทอง 5.860 ก. 3,418.09 บาท/ก. = 20,030.00 · %เนื้อทองแต่ละก้อนอยู่ในช่องรายละเอียด)
 * ที่มา: Django sales/views.py `_group_by_metal` + `BuyReceiptGroupingTest`
 * เรียงตามลำดับที่โลหะปรากฏครั้งแรกในบิล
 */
export function groupLinesByMetal(lines: readonly ReceiptLine[]): ReceiptLineGroup[] {
  const groups = new Map<string, { weight: Decimal; amount: Decimal }>();
  for (const line of lines) {
    const weight = finite(line.weightG, "น้ำหนัก");
    const amount = finite(line.amount, "ราคา");
    const g = groups.get(line.metalName);
    if (g) {
      g.weight = g.weight.plus(weight);
      g.amount = g.amount.plus(amount);
    } else {
      groups.set(line.metalName, { weight, amount });
    }
  }
  return [...groups].map(([metalName, g]) => {
    if (!g.weight.gt(0)) throw new RangeError(`น้ำหนักรวมของ${metalName}ต้องมากกว่า 0`);
    return {
      metalName,
      weightG: fmtWeight(g.weight),
      unitPrice: fmtMoney(pricePerGram(g.amount, g.weight)),
      amount: fmtMoney(g.amount),
    };
  });
}
