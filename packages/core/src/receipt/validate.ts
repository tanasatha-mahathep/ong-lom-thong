import { ReceiptDataError } from "../errors";
import { ZERO, requireDecimal } from "../money";
import { taxBranchLabel } from "../thai";
import type { ReceiptData } from "./types";

/**
 * ใบรับซื้อต้องไม่มีตัวเลขขัดกันเอง — มีรายการ · Σรายการ = ยอดบิล · Σชำระ = ยอดบิล (R4)
 * DB บังคับไว้แล้ว ตัวนี้กันบั๊กตอน map ข้อมูล: หน้าเว็บ/พิมพ์/PDF พังด้วยเหตุผลเดียวกัน ดีกว่าออกใบผิด
 */
export function assertReceiptTotals(data: ReceiptData): void {
  if (data.lines.length === 0) throw new ReceiptDataError(`ใบรับซื้อ ${data.docNo}: ไม่มีรายการ`);
  const total = requireDecimal(data.totalAmount, "ยอดบิล");
  const lines = data.lines.reduce((sum, l) => sum.plus(requireDecimal(l.amount, "ราคา")), ZERO);
  const paid = data.payments.reduce((sum, p) => sum.plus(requireDecimal(p.amount, "จำนวนเงินที่ชำระ")), ZERO);
  if (!lines.eq(total)) {
    throw new ReceiptDataError(
      `ใบรับซื้อ ${data.docNo}: รวมรายการ ${lines.toFixed(2)} ไม่เท่ายอดบิล ${total.toFixed(2)}`,
    );
  }
  if (!paid.eq(total)) {
    throw new ReceiptDataError(`ใบรับซื้อ ${data.docNo}: รวมชำระ ${paid.toFixed(2)} ไม่เท่ายอดบิล ${total.toFixed(2)}`);
  }
}

/**
 * PDF เก็บถาวรต้องมีป้ายสาขาของสรรพากรจริงเสมอ (fail-closed) — ไม่มีรหัส = ข้อมูลสาขายังไม่ครบ (สเปก §12 ข้อ 9)
 * ห้ามเอารหัสภายใน/รหัสชั่วคราวมาพิมพ์แทนบนเอกสารถาวร
 */
export function requireTaxBranchLabel(data: ReceiptData): string {
  const label = taxBranchLabel(data.branch.taxBranchCode);
  if (label === null) {
    throw new ReceiptDataError(
      `ใบรับซื้อ ${data.docNo}: สาขา "${data.branch.name}" ยังไม่มีรหัสสาขาของสรรพากร (tax_branch_code) — สร้าง PDF ไม่ได้`,
    );
  }
  return label;
}
