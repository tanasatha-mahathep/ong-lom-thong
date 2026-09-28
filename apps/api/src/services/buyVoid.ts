import { D, fmtWeight } from "@ong/core";
import { type Db, auditLog, buyLine, buyReceipt, stockMovement } from "@ong/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { BranchRef, Viewer } from "../lib/scope";

export const VoidBody = z.object(
  {
    reason: z
      .string({ error: "กรุณาระบุเหตุผลที่ยกเลิก" })
      .trim()
      .min(1, "กรุณาระบุเหตุผลที่ยกเลิก")
      .max(500, "เหตุผลยาวเกิน 500 ตัวอักษร"),
  },
  { error: "ต้องส่งข้อมูลเป็น JSON object" },
);

export type VoidResult = "not_found" | "already_void" | "voided";

/**
 * ยกเลิกบิล (R12 · R15) — ทรานแซกชันเดียว: สถานะ void + ผู้ยกเลิก/เวลา/เหตุผล · กลับรายการสต็อก · audit
 * - บิลไม่ถูกลบ ไฟล์ PDF ฉบับเดิมคงอยู่ · ฉบับยกเลิก (…_void.pdf) สร้างใหม่เบื้องหลัง (void_pdf_status = pending)
 * - สต็อก: แถวติดลบหนึ่งแถวต่อรายการ ลง "วันที่ของบิล" — การยกเลิกลบเอกสารทั้งใบเหมือนไม่เคยเกิด
 *   สต็อกจึงตรงกับรายงานยอดซื้อ (ตัดบิลยกเลิกตามวันที่บิล) และไฟล์ …_void.pdf ในโฟลเดอร์เดือนของบิล
 * - ล็อกแถวบิลก่อนตรวจสถานะ — กดยกเลิกซ้ำพร้อมกันได้ผลครั้งเดียว อีกครั้ง = already_void
 */
export async function voidBuy(
  db: Db,
  readable: BranchRef[],
  viewer: Viewer,
  id: string,
  reason: string,
  now: Date,
): Promise<VoidResult> {
  if (!z.uuid().safeParse(id).success || readable.length === 0) return "not_found";
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: buyReceipt.id,
        docNo: buyReceipt.docNo,
        date: buyReceipt.date,
        status: buyReceipt.status,
        branchId: buyReceipt.branchId,
      })
      .from(buyReceipt)
      .where(
        and(
          eq(buyReceipt.id, id),
          inArray(
            buyReceipt.branchId,
            readable.map((b) => b.id),
          ),
        ),
      )
      .for("update");
    if (!row) return "not_found";
    if (row.status === "void") return "already_void";

    const lines = await tx
      .select({ metalId: buyLine.metalId, weightG: buyLine.weightG })
      .from(buyLine)
      .where(eq(buyLine.receiptId, id))
      .orderBy(asc(buyLine.lineNo));
    await tx
      .update(buyReceipt)
      .set({ status: "void", voidedBy: viewer.userId, voidedAt: now, voidReason: reason, voidPdfStatus: "pending" })
      .where(eq(buyReceipt.id, id));

    if (lines.length > 0) {
      await tx.insert(stockMovement).values(
        lines.map((l) => ({
          branchId: row.branchId,
          metalId: l.metalId,
          date: row.date,
          grams: fmtWeight(D(l.weightG).negated()),
          sourceReceiptId: id,
        })),
      );
    }
    await tx.insert(auditLog).values({
      userId: viewer.userId,
      action: "buy.void",
      tableName: "buy_receipt",
      rowId: id,
      diff: { doc_no: row.docNo, status: { from: "active", to: "void" }, reason, stock_reversed_on: row.date },
    });
    return "voided";
  });
}
