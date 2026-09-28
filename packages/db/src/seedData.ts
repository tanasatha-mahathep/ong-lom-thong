import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "./index";
import { branch, goldPriceSetting, metal } from "./schema";

/**
 * ข้อมูลตั้งต้น — รันซ้ำได้ (onConflictDoNothing)
 * รหัสสาขา 00000/00001/00002 เป็นค่าชั่วคราวจนกว่าจะได้รหัส 5 หลักจริงจากสรรพากร (คำถาม §12 ข้อ 9)
 * tax_branch_code (พิมพ์บนเอกสาร): สำนักงานใหญ่ = "00000" ตามระเบียบสรรพากร · สาขาอื่นว่างไว้จนเจ้าของให้รหัสจริง
 * — PDF ของสาขาที่ไม่มีรหัสจะไม่ถูกสร้าง (fail-closed) แทนการพิมพ์รหัสชั่วคราวลงเอกสารถาวร
 */
export async function seedReferenceData(db: Db): Promise<void> {
  await db
    .insert(branch)
    .values([
      { code: "00000", name: "สำนักงานใหญ่ (สาขา 1)", taxBranchCode: "00000" },
      { code: "00001", name: "สาขา 2" },
      { code: "00002", name: "สาขา 3" },
    ])
    .onConflictDoNothing();
  // DB ที่ seed ไปก่อนแล้ว (ช่องนี้ยังว่าง): เติมให้สำนักงานใหญ่ — แถวที่มีค่าอยู่แล้วไม่ถูกแตะ
  await db
    .update(branch)
    .set({ taxBranchCode: "00000" })
    .where(and(eq(branch.code, "00000"), isNull(branch.taxBranchCode)));

  // ลำดับตาม dropdown ระบบเดิม: ทอง · นาก · เงิน · แพลตตินั่ม
  await db
    .insert(metal)
    .values([
      { code: "gold", nameTh: "ทอง", sortOrder: 1 },
      { code: "nak", nameTh: "นาก", sortOrder: 2 },
      { code: "silver", nameTh: "เงิน", sortOrder: 3 },
      { code: "platinum", nameTh: "แพลตตินั่ม", sortOrder: 4 },
    ])
    .onConflictDoNothing();

  await db.insert(goldPriceSetting).values({ id: 1 }).onConflictDoNothing();
}
