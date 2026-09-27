import type { Db } from "./index";
import { branch, goldPriceSetting, metal } from "./schema";

/**
 * ข้อมูลตั้งต้น — รันซ้ำได้ (onConflictDoNothing)
 * รหัสสาขา 00000/00001/00002 เป็นค่าชั่วคราวจนกว่าจะได้รหัส 5 หลักจริงจากสรรพากร (คำถาม §12 ข้อ 9)
 */
export async function seedReferenceData(db: Db): Promise<void> {
  await db
    .insert(branch)
    .values([
      { code: "00000", name: "สำนักงานใหญ่ (สาขา 1)" },
      { code: "00001", name: "สาขา 2" },
      { code: "00002", name: "สาขา 3" },
    ])
    .onConflictDoNothing();

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
