import { branch, metal, seedReferenceData } from "@ong/db";
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

  it("ผู้ดูแลย้ายสำนักงานใหญ่ไปสาขาอื่นแล้ว → seed ไม่เติม 00000 ซ้ำ (สำนักงานใหญ่มีได้แห่งเดียว)", async () => {
    await t.db.update(branch).set({ taxBranchCode: null }).where(eq(branch.code, "00000"));
    await t.db.update(branch).set({ taxBranchCode: "00000" }).where(eq(branch.code, "00002"));
    await seedReferenceData(t.db);
    expect(await taxCodes()).toEqual({ "00000": null, "00001": "00007", "00002": "00000" });
  });

  it("DB ที่ผู้ดูแลตั้งสาขาจริงไว้แล้ว → seed ไม่เพิ่มสาขาชั่วคราว/สำนักงานใหญ่ซ้ำ แต่ยังใส่โลหะ", async () => {
    await t.db.delete(branch);
    await t.db.delete(metal);
    await t.db.insert(branch).values({ code: "10000", name: "สำนักงานใหญ่จริง", taxBranchCode: "00000" });
    await seedReferenceData(t.db);
    expect(await taxCodes()).toEqual({ "10000": "00000" });
    expect((await t.db.select().from(metal)).map((m) => m.code).sort()).toEqual(["gold", "nak", "platinum", "silver"]);
  });
});
