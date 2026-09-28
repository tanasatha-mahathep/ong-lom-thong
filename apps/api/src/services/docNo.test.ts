import { docSequence } from "@ong/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();

describe.skipIf(!available)("next_doc_no() — เลขลำดับเกิน 4 หลักไม่ถูกตัด (migration 0005)", () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(async () => {
    await t?.close();
  });

  const next = async (branchId: string, date: string) => {
    const rows = await t.db.execute<{ no: string }>(
      sql`select next_doc_no(${branchId}::uuid, 'RC', ${date}::date) as no`,
    );
    return rows[0]?.no;
  };

  it("9999 → 10000 → 10001 ไม่ชนกัน", async () => {
    const branchId = t.branches["00000"];
    if (!branchId) throw new Error("seed branch 00000 missing");
    await t.db.insert(docSequence).values({ branchId, prefix: "RC", period: "6910", lastNo: 9998 });
    const got = [
      await next(branchId, "2026-10-01"),
      await next(branchId, "2026-10-02"),
      await next(branchId, "2026-10-03"),
    ];
    expect(got).toEqual(["RC6910-9999", "RC6910-10000", "RC6910-10001"]);
    expect(new Set(got).size).toBe(3);
  });

  it("เลขน้อยยังเติมศูนย์ 4 หลักเหมือนเดิม", async () => {
    const branchId = t.branches["00001"];
    if (!branchId) throw new Error("seed branch 00001 missing");
    expect(await next(branchId, "2026-11-15")).toBe("RC6911-0001");
  });
});
