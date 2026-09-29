import { auditLog, goldPrice } from "@ong/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

/**
 * F11: สอง PUT ราคาแรกของวันพร้อมกัน (ยังไม่มีแถว) เคยทำให้ audit ลง "create" ซ้ำสองครั้งแทนที่จะเป็น
 * create แล้ว update — `SELECT … FOR UPDATE` ล็อกแถวที่ยังไม่มีอยู่ไม่ได้ ทั้งสอง request จึงเห็น "ก่อน" เป็น null
 * พร้อมกัน services/goldPrice.ts แก้ด้วย pg_advisory_xact_lock ต่อ (สาขาหรือราคากลาง, วันที่) ก่อน SELECT
 * เทสต์นี้ยิงจริงพร้อมกันผ่าน Promise.all กับ Postgres จริง (ไม่ mock) — ตรวจผลลัพธ์ที่สังเกตได้ ไม่ผูกกับว่าใครชนะ
 */
describe.skipIf(!available)("F11: race สอง PUT ราคาแรกของวันพร้อมกัน — audit ต้องเป็น [create, update]", () => {
  let t: TestApp;
  // วันที่ใหม่ที่ไม่มีเทสต์อื่นแตะ — ยังไม่มีราคาทั้งกลางและเฉพาะสาขา (first-of-day จริง)
  const clock = new Date("2026-10-15T03:00:00Z");
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock });
    await t.createUser({ email: "manager@ong.test", password: PW, role: "manager", branch: "00000" });
    cookies.manager = await t.login("manager@ong.test", PW);
    // อุ่น connection pool ไว้ล่วงหน้า — Promise.all ด้านล่างต้องชนกันจริงที่ SELECT/insert ไม่ใช่รอ connection ใหม่
    // ตั้งไม่ทัน (เชื่อมต่อครั้งแรกช้ากว่าคิวรีจริงมาก ทำให้ดูเหมือนไม่ชนกันทั้งที่ยังไม่ได้ล็อก — เทสต์นี้ยืนยันแล้วว่าจำเป็น)
    await Promise.all(Array.from({ length: 4 }, () => t.db.execute(sql`select 1`)));
  });
  afterAll(async () => {
    await t?.close();
  });

  it("ราคากลาง: แถวเดียว · audit [create, update] · before ตัวที่สอง = after ตัวแรก", async () => {
    const [resA, resB] = await Promise.all([
      t.request("/api/gold-price/today", { method: "PUT", cookie: cookies.manager, body: { bar_sell: "67850" } }),
      t.request("/api/gold-price/today", { method: "PUT", cookie: cookies.manager, body: { bar_sell: "67900" } }),
    ]);
    expect([resA.status, resB.status]).toEqual([200, 200]);

    const rows = await t.db
      .select()
      .from(goldPrice)
      .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, "2026-10-15")));
    expect(rows).toHaveLength(1); // upsert แก้แถวเดียว ไม่ใช่สองแถวชนกัน

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.tableName, "gold_price")).orderBy(auditLog.id);
    expect(audits.map((a) => a.action)).toEqual(["gold_price.create", "gold_price.update"]);

    const created = audits[0]?.diff as { before: unknown; after: { bar_sell: string } };
    const updated = audits[1]?.diff as { before: { bar_sell: string } | null; after: { bar_sell: string } };
    expect(created.before).toBeNull();
    expect(updated.before).not.toBeNull(); // นี่คือบั๊กเดิม — ตัวที่สองเคยเห็น before เป็น null เหมือนกัน
    expect(updated.before?.bar_sell).toBe(created.after.bar_sell);
    // แถวที่เหลืออยู่จริงต้องตรงกับ after ของ audit ตัวหลังสุด (ตัวที่ upsert ชนะจริง ๆ)
    expect(rows[0]?.barSell).toBe(updated.after.bar_sell);
  });

  it("ราคาเฉพาะสาขา: คีย์ล็อกแยกจากราคากลาง (คนละแถว) — before ตัวที่สอง = after ตัวแรกเหมือนกัน", async () => {
    const b0 = t.branches["00000"] ?? "";
    const [resA, resB] = await Promise.all([
      t.request(`/api/gold-price/today/branches/${b0}`, {
        method: "PUT",
        cookie: cookies.manager,
        body: { bar_sell: "68000" },
      }),
      t.request(`/api/gold-price/today/branches/${b0}`, {
        method: "PUT",
        cookie: cookies.manager,
        body: { bar_sell: "68050" },
      }),
    ]);
    expect([resA.status, resB.status]).toEqual([200, 200]);

    const rows = await t.db
      .select()
      .from(goldPrice)
      .where(and(eq(goldPrice.branchId, b0), eq(goldPrice.date, "2026-10-15")));
    expect(rows).toHaveLength(1);

    const audits = (
      await t.db.select().from(auditLog).where(eq(auditLog.tableName, "gold_price")).orderBy(auditLog.id)
    ).filter((a) => a.action === "gold_price.set_branch");
    expect(audits).toHaveLength(2);
    const [first, second] = audits.map(
      (a) => a.diff as { before: { bar_sell: string } | null; after: { bar_sell: string } },
    );
    expect(first?.before).toBeNull();
    expect(second?.before).not.toBeNull();
    expect(second?.before?.bar_sell).toBe(first?.after.bar_sell);
    expect(rows[0]?.barSell).toBe(second?.after.bar_sell);
  });
});
