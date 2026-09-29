import { auditLog, branch, customer, goldPrice, metal, user } from "@ong/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";
const NO_UUID = "00000000-0000-4000-8000-000000000000";
// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const FAKE_ID = "1103700123458";

// 10:00 น. วันที่ 28 ก.ย. 2569 เวลาไทย
const TODAY = "2026-09-28";
const YESTERDAY = "2026-09-27";

interface BranchPrice {
  branch: { id: string; code: string; name: string };
  bar_sell: string | null;
  bar_buy: string | null;
  jewelry_buy: string | null;
  source: "branch" | "central" | null;
}

describe.skipIf(!available)("ราคาทองเฉพาะสาขา (อิงราคากลาง · override ได้ · R7 · R8 · R12)", () => {
  let t: TestApp;
  let clock = new Date("2026-09-28T03:00:00Z");
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let b0 = "";
  let b1 = "";
  let b2 = "";

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock });
    const accounts = [
      { who: "admin", role: "admin" as const, branch: "00000", viewAll: true },
      { who: "admin1", role: "admin" as const, branch: "00001" }, // admin ที่ไม่ได้ดูทุกสาขา
      { who: "mgr0", role: "manager" as const, branch: "00000" },
      { who: "mgr1", role: "manager" as const, branch: "00001" },
      { who: "acct", role: "accounting" as const, branch: "00000", viewAll: true },
      { who: "staff1", branch: "00001" },
      { who: "staff2", branch: "00002" },
      { who: "multi", branch: "00001", allow: ["00002"] }, // สาขาหลัก 00001 + อนุญาต 00002
      { who: "nobranch", role: "manager" as const },
    ];
    for (const a of accounts) {
      const created = await t.createUser({ email: `${a.who}@ong.test`, password: PW, ...a });
      ids[a.who] = created.id;
      cookies[a.who] = await t.login(`${a.who}@ong.test`, PW);
    }
    b0 = t.branches["00000"] ?? "";
    b1 = t.branches["00001"] ?? "";
    b2 = t.branches["00002"] ?? "";
    // ขายได้เฉพาะสาขาที่มีรหัสสาขาของกรมสรรพากร (seed ตั้งให้แค่สำนักงานใหญ่) — รหัสสมมติสำหรับเทสต์
    for (const code of ["00001", "00002"]) {
      await t.db.update(branch).set({ taxBranchCode: code }).where(eq(branch.code, code));
    }
    // เมื่อวาน: ราคากลาง 67,850 · สาขา 00001 ใช้ราคาของตัวเอง 70,000 · วันนี้: ราคากลาง 67,900
    await t.db.insert(goldPrice).values([
      { date: YESTERDAY, barSell: "67850", barBuy: "67650", jewelryBuy: "64268" },
      { branchId: b1, date: YESTERDAY, barSell: "70000", barBuy: "69800", jewelryBuy: "66310" },
      { date: TODAY, barSell: "67900", barBuy: "67700", jewelryBuy: "64315" },
    ]);
  });
  afterAll(async () => {
    await t?.close();
  });

  const path = (branchId: string) => `/api/gold-price/today/branches/${branchId}`;
  const put = async (who: string, branchId: string, body: unknown, origin?: string) =>
    t.request(path(branchId), { method: "PUT", cookie: cookies[who], body, origin });
  const del = async (who: string, branchId: string, origin?: string) =>
    t.request(path(branchId), { method: "DELETE", cookie: cookies[who], origin });
  const list = async (who: string) => {
    const res = await t.request("/api/gold-price/today/branches", { cookie: cookies[who] });
    expect(res.status).toBe(200);
    return (await res.json()) as BranchPrice[];
  };
  const today = async (who: string) => t.request("/api/gold-price/today", { cookie: cookies[who] });
  const quote = async (body: unknown, who = "mgr1") =>
    t.request("/api/gold-price/quote", { cookie: cookies[who], body });
  const overrides = async () => t.db.select().from(goldPrice).where(eq(goldPrice.date, TODAY));
  const branchAudits = async () =>
    (await t.db.select().from(auditLog).where(eq(auditLog.tableName, "gold_price")).orderBy(auditLog.id)).filter((a) =>
      a.action.endsWith("_branch"),
    );

  it("ต้อง login ทุก endpoint", async () => {
    expect((await t.request("/api/gold-price/today/branches")).status).toBe(401);
    expect((await t.request(path(b1), { method: "PUT", body: { bar_sell: "70100" } })).status).toBe(401);
    expect((await t.request(path(b1), { method: "DELETE" })).status).toBe(401);
  });

  it("staff และ accounting ตั้ง/ลบราคาเฉพาะสาขาไม่ได้ (403) แม้เป็นสาขาของตัวเอง", async () => {
    expect((await put("staff1", b1, { bar_sell: "70100" })).status).toBe(403);
    expect((await put("acct", b0, { bar_sell: "70100" })).status).toBe(403);
    expect((await del("staff1", b1)).status).toBe(403);
    expect((await del("acct", b0)).status).toBe(403);
    expect(await overrides()).toHaveLength(1); // ราคากลางของวันนี้แถวเดียว
  });

  it("CSRF: origin อื่นตั้ง/ลบไม่ได้", async () => {
    expect((await put("mgr1", b1, { bar_sell: "70100" }, "https://evil.test")).status).toBe(403);
    expect((await del("mgr1", b1, "https://evil.test")).status).toBe(403);
    expect(await overrides()).toHaveLength(1);
  });

  it("manager สาขาอื่น / สาขาไม่มีจริง / uuid ผิดรูป = 404 เหมือนกัน (ไม่บอกว่ามีอยู่)", async () => {
    for (const res of [
      await put("mgr0", b1, { bar_sell: "70100" }),
      await del("mgr0", b1),
      await put("mgr1", NO_UUID, { bar_sell: "70100" }),
      await put("mgr1", "not-a-uuid", { bar_sell: "70100" }),
    ]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not found" });
    }
    expect(await overrides()).toHaveLength(1);
  });

  it("ไม่มีสาขาที่เปิดอยู่เลย = 403 ทุก endpoint ราคาทอง (requireAnyBranch · fail-closed)", async () => {
    for (const res of [
      await t.request("/api/gold-price/today/branches", { cookie: cookies.nobranch }),
      await today("nobranch"),
      await quote({ bar_sell: "70100", branch_id: b0 }, "nobranch"),
      await put("nobranch", b0, { bar_sell: "70100" }),
      await del("nobranch", b0),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(await overrides()).toHaveLength(1);
  });

  it("admin ที่ไม่ได้ดูทุกสาขา ตั้งได้เฉพาะสาขาที่มีสิทธิ์ (forUser)", async () => {
    expect((await put("admin1", b0, { bar_sell: "67900" })).status).toBe(404);
    expect(await overrides()).toHaveLength(1);
  });

  it.each([
    [{ bar_sell: 70100 }, "ต้องส่ง bar_sell เป็นข้อความตัวเลข"],
    [{}, "ต้องส่ง bar_sell เป็นข้อความตัวเลข"],
    [{ bar_sell: "abc" }, "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0"],
    [{ bar_sell: "70100.001" }, "ราคาทศนิยมไม่เกิน 2 ตำแหน่ง"],
    [{ bar_sell: "1103700123458", confirm_typo: true }, "ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง"],
    [{ bar_sell: "1,000,000", confirm_typo: true }, "ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง"],
  ])("ข้อมูลผิด %j → 400 ชี้ bar_sell", async (body, error) => {
    const res = await put("mgr1", b1, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error, field: "bar_sell" });
  });

  it("F5: confirm_typo ผิดชนิด → 400 ชี้ confirm_typo ไม่ใช่ bar_sell (เดียวกับ PUT ราคากลาง)", async () => {
    const res = await put("mgr1", b1, { bar_sell: "70100", confirm_typo: "yes" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "confirm_typo ต้องเป็นจริงหรือเท็จ", field: "confirm_typo" });
    expect(await overrides()).toHaveLength(1); // ไม่มีอะไรถูกเขียน (ยังเป็นราคากลางของวันนี้จากการ seed)
  });

  it("ตั้งราคาเฉพาะสาขา: สาขานั้นเห็นราคาของตัวเอง · สาขาอื่นยังเห็นราคากลาง · ราคากลางไม่ถูกแตะ", async () => {
    const res = await put("mgr1", b1, { bar_sell: "70100" });
    expect(res.status).toBe(200);
    // 70,100 − 200 = 69,900 × 0.95 = 66,405 (สูตรเดียวกับราคากลาง)
    expect(await res.json()).toEqual({
      branch: { id: b1, code: "00001", name: "สาขา 2" },
      bar_sell: "70100.00",
      bar_buy: "69900.00",
      jewelry_buy: "66405",
      source: "branch",
    });
    expect(await (await today("staff1")).json()).toMatchObject({ bar_sell: "70100.00", source: "branch" });
    expect(await (await today("staff2")).json()).toMatchObject({ bar_sell: "67900.00", source: "central" });
    const [central] = await t.db
      .select()
      .from(goldPrice)
      .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, TODAY)));
    expect(central).toMatchObject({ barSell: "67900.00", barBuy: "67700.00" });
  });

  it("GET /today/branches: ทุกสาขาที่อ่านได้ พร้อมที่มา · manager เห็นเฉพาะสาขาตัวเอง", async () => {
    expect(await list("admin")).toEqual([
      {
        branch: { id: b0, code: "00000", name: "สำนักงานใหญ่ (สาขา 1)" },
        bar_sell: "67900.00",
        bar_buy: "67700.00",
        jewelry_buy: "64315",
        source: "central",
      },
      {
        branch: { id: b1, code: "00001", name: "สาขา 2" },
        bar_sell: "70100.00",
        bar_buy: "69900.00",
        jewelry_buy: "66405",
        source: "branch",
      },
      {
        branch: { id: b2, code: "00002", name: "สาขา 3" },
        bar_sell: "67900.00",
        bar_buy: "67700.00",
        jewelry_buy: "64315",
        source: "central",
      },
    ]);
    expect((await list("mgr0")).map((r) => r.branch.code)).toEqual(["00000"]);
    expect((await list("staff1")).map((r) => [r.branch.code, r.source])).toEqual([["00001", "branch"]]);
  });

  it("ด่านพิมพ์ผิดเทียบราคาที่สาขาใช้จริงเมื่อวาน — ของสาขาก่อน ไม่มีจึงราคากลาง (quote = บันทึก)", async () => {
    // 00001 เมื่อวานใช้ 70,000 ของตัวเอง → 70,100 ห่าง 0.1% ไม่เตือน (เทียบราคากลาง 67,850 จะเตือน 3.3%)
    expect(await (await quote({ bar_sell: "70100", branch_id: b1 })).json()).not.toHaveProperty("warning");
    const central = (await (await quote({ bar_sell: "70100" })).json()) as { warning?: string };
    expect(central.warning).toMatch(/^ราคาห่างจากครั้งก่อน 3\.3% \(67850 → 70100\)/);

    // 00002 เมื่อวานไม่มีราคาของตัวเอง → เทียบราคากลาง 67,850
    const q = (await (await quote({ bar_sell: "70100", branch_id: b2 }, "admin")).json()) as { warning?: string };
    expect(q.warning).toBe(central.warning);
    const rejected = await put("admin", b2, { bar_sell: "70100" });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: q.warning, field: "confirm_typo", warning: q.warning });
    expect((await overrides()).filter((r) => r.branchId === b2)).toHaveLength(0);

    const confirmed = await put("admin", b2, { bar_sell: "70100", confirm_typo: true });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ bar_sell: "70100.00", source: "branch" });
    const last = (await branchAudits()).at(-1);
    expect(last).toMatchObject({ action: "gold_price.set_branch", userId: ids.admin });
    expect(last?.diff).toMatchObject({ branch: { id: b2, code: "00002" }, typo_warning_confirmed: true });
  });

  it("quote: branch_id ที่อ่านไม่ได้ = 404 · ผิดชนิด = 400 ชี้ branch_id", async () => {
    const res = await quote({ bar_sell: "70100", branch_id: b0 }, "mgr1");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found", field: "branch_id" });
    const bad = await quote({ bar_sell: "70100", branch_id: 12 });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ field: "branch_id" });
  });

  it("audit: set_branch เก็บก่อน/หลัง · clear_branch เก็บค่าที่ลบ (R12)", async () => {
    await put("mgr1", b1, { bar_sell: "70150" });
    const res = await del("mgr1", b1);
    expect(res.status).toBe(200);

    const audits = (await branchAudits()).filter((a) => (a.diff as { branch: { id: string } }).branch.id === b1);
    expect(audits.map((a) => [a.action, a.userId])).toEqual([
      ["gold_price.set_branch", ids.mgr1],
      ["gold_price.set_branch", ids.mgr1],
      ["gold_price.clear_branch", ids.mgr1],
    ]);
    expect(audits[0]?.diff).toEqual({
      date: TODAY,
      branch: { id: b1, code: "00001", name: "สาขา 2" },
      before: null,
      after: { bar_sell: "70100.00", bar_buy: "69900.00", jewelry_buy: "66405.00", set_by: ids.mgr1 },
      typo_warning_confirmed: false,
    });
    expect(audits[1]?.diff).toMatchObject({
      before: { bar_sell: "70100.00" },
      after: { bar_sell: "70150.00", bar_buy: "69950.00", jewelry_buy: "66453.00" },
    });
    expect(audits[2]?.diff).toEqual({
      date: TODAY,
      branch: { id: b1, code: "00001", name: "สาขา 2" },
      removed: { bar_sell: "70150.00", bar_buy: "69950.00", jewelry_buy: "66453.00", set_by: ids.mgr1 },
    });
    expect(audits[2]?.rowId).toBe(audits[1]?.rowId);
  });

  it("ลบแล้วกลับไปใช้ราคากลาง · ลบซ้ำ = 200 สถานะปัจจุบัน ไม่ลง audit เพิ่ม", async () => {
    expect(await (await today("staff1")).json()).toMatchObject({ bar_sell: "67900.00", source: "central" });
    const before = (await branchAudits()).length;
    const again = await del("mgr1", b1);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({
      branch: { id: b1, code: "00001", name: "สาขา 2" },
      bar_sell: "67900.00",
      bar_buy: "67700.00",
      jewelry_buy: "64315",
      source: "central",
    });
    expect(await branchAudits()).toHaveLength(before);
  });

  it("บิลที่เปิดไปแล้วเก็บราคาของตัวเอง (snapshot) — ลบ override ไม่กระทบบิลเก่า · บิลใหม่ได้ราคากลาง", async () => {
    await put("mgr1", b1, { bar_sell: "70100" });
    const [gold] = await t.db.select().from(metal).where(eq(metal.code, "gold"));
    const [cust] = await t.db
      .insert(customer)
      .values({ nationalId: FAKE_ID, nameTh: "นายทดสอบ ราคาสาขา", cardExpireText: "31/12/2574" })
      .returning();
    const body = {
      customer_id: cust?.id,
      lines: [{ metal_id: gold?.id, weight_g: "5.860", amount: "20030" }],
      payments: [{ method: "cash", amount: "20030" }],
    };
    const saved = await t.request("/api/buy", {
      cookie: cookies.staff1,
      body: { ...body, idempotency_key: "branch-price-snapshot-0001" },
    });
    expect(saved.status).toBe(201);
    const { id } = (await saved.json()) as { id: string };
    const snapshot = async () =>
      (
        (await (await t.request(`/api/buy/${id}`, { cookie: cookies.staff1 })).json()) as {
          gold_price_snapshot: string;
        }
      ).gold_price_snapshot;
    expect(await snapshot()).toBe("70100.00");

    expect((await del("mgr1", b1)).status).toBe(200);
    expect(await snapshot()).toBe("70100.00");
    const q = await t.request("/api/buy/quote", { cookie: cookies.staff1, body });
    expect(await q.json()).toMatchObject({ ok: true, gold_price_snapshot: "67900.00" });
  });

  it("ตั้งราคากลางใหม่ไม่ทับราคาเฉพาะสาขา", async () => {
    await put("mgr1", b1, { bar_sell: "70100" });
    const res = await t.request("/api/gold-price/today", {
      method: "PUT",
      cookie: cookies.admin,
      body: { bar_sell: "67950" },
    });
    expect(res.status).toBe(200);
    expect(await (await today("staff1")).json()).toMatchObject({ bar_sell: "70100.00", source: "branch" });
    expect(await (await today("mgr0")).json()).toMatchObject({ bar_sell: "67950.00", source: "central" });
  });

  it("สาขาที่ปิดแล้ว: ตั้ง/ลบไม่ได้แม้ admin (404) · ไม่อยู่ในรายการ · ผู้ใช้ที่เหลือแต่สาขานั้น = 403", async () => {
    // 00002 มีราคาเฉพาะสาขาจากเทสต์ด่านพิมพ์ผิด (70,100)
    expect(await (await today("staff2")).json()).toMatchObject({ bar_sell: "70100.00", source: "branch" });
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      expect((await put("admin", b2, { bar_sell: "70000" })).status).toBe(404);
      expect((await del("admin", b2)).status).toBe(404);
      expect((await list("admin")).map((r) => r.branch.code)).toEqual(["00000", "00001"]);
      expect((await today("staff2")).status).toBe(403);
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
    }
    expect(await (await today("staff2")).json()).toMatchObject({ bar_sell: "70100.00", source: "branch" });
  });

  it("GET /today: สาขาปัจจุบันถูกถอนสิทธิ์หรือถูกปิด (ยังมีสาขาอื่น) = ราคากลาง ไม่ใช่ราคาของสาขานั้น", async () => {
    // multi ทำงานอยู่ที่ 00002 ซึ่งมีราคาเฉพาะสาขา 70,100 (จากเทสต์ด่านพิมพ์ผิด)
    expect((await t.request("/api/me/branch", { cookie: cookies.multi, body: { branch_id: b2 } })).status).toBe(200);
    expect(await (await today("multi")).json()).toMatchObject({ bar_sell: "70100.00", source: "branch" });

    await t.db
      .update(user)
      .set({ allowedBranchIds: [] })
      .where(eq(user.id, ids.multi ?? ""));
    try {
      expect(await (await today("multi")).json()).toMatchObject({ bar_sell: "67950.00", source: "central" });
    } finally {
      await t.db
        .update(user)
        .set({ allowedBranchIds: [b2] })
        .where(eq(user.id, ids.multi ?? ""));
    }
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      expect(await (await today("multi")).json()).toMatchObject({ bar_sell: "67950.00", source: "central" });
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
    }
    expect(await (await today("multi")).json()).toMatchObject({ bar_sell: "70100.00", source: "branch" });
  });

  it("วันที่ยังไม่ตั้งราคาใดเลย = source null ทุกสาขา · ตั้งราคาสาขาได้แม้ยังไม่มีราคากลาง", async () => {
    clock = new Date("2026-09-30T03:00:00Z");
    const rows = await list("admin");
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({ bar_sell: null, bar_buy: null, jewelry_buy: null, source: null });
    }
    expect((await today("staff1")).status).toBe(404);

    // admin ที่ไม่ได้ดูทุกสาขา ตั้งสาขาที่มีสิทธิ์ได้ · ด่านเทียบราคาที่ 00001 ใช้ครั้งก่อน (28 ก.ย. = 70,100)
    expect((await put("admin1", b1, { bar_sell: "70100" })).status).toBe(200);
    expect((await list("admin")).map((r) => [r.branch.code, r.source])).toEqual([
      ["00000", null],
      ["00001", "branch"],
      ["00002", null],
    ]);
  });
});
