import { branch, seedReferenceData } from "@ong/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();

describe.skipIf(!available)("seedReferenceData — รหัสสาขาของสรรพากร (tax_branch_code)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  const taxCodes = async () =>
    Object.fromEntries((await t.db.select().from(branch)).map((b) => [b.code, b.taxBranchCode]));

  it("สำนักงานใหญ่ = 00000 · สาขาอื่นว่างจนกว่าเจ้าของจะให้รหัสจริง (§12 ข้อ 9)", async () => {
    expect(await taxCodes()).toEqual({ "00000": "00000", "00001": null, "00002": null });
  });

  it("DB ที่ seed ไปก่อน (ช่องยังว่าง) → รันซ้ำแล้วเติมให้ ไม่เพิ่มแถวซ้ำ", async () => {
    await t.db.update(branch).set({ taxBranchCode: null }).where(eq(branch.code, "00000"));
    await seedReferenceData(t.db);
    await seedReferenceData(t.db);
    expect(await taxCodes()).toEqual({ "00000": "00000", "00001": null, "00002": null });
  });

  it("ไม่ทับรหัสที่ตั้งไว้แล้ว และไม่เดารหัสให้สาขาอื่น", async () => {
    await t.db.update(branch).set({ taxBranchCode: "00007" }).where(eq(branch.code, "00001"));
    await seedReferenceData(t.db);
    expect(await taxCodes()).toEqual({ "00000": "00000", "00001": "00007", "00002": null });
  });
});
