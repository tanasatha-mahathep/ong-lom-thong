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
  /** ราคาต่อกรัมที่สาขาใช้จริง (ของราคากลาง) — null = ยังไม่ได้ตั้ง */
  silver_per_g: string | null;
  platinum_per_g: string | null;
  source: "branch" | "central" | null;
}

/** ยังไม่ได้ตั้งราคาต่อกรัม — คีย์อยู่เสมอเป็น null */
const NO_PER_GRAM = { silver_per_g: null, platinum_per_g: null };

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
      ...NO_PER_GRAM,
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
        ...NO_PER_GRAM,
        source: "central",
      },
      {
        branch: { id: b1, code: "00001", name: "สาขา 2" },
        bar_sell: "70100.00",
        bar_buy: "69900.00",
        jewelry_buy: "66405",
        ...NO_PER_GRAM,
        source: "branch",
      },
      {
        branch: { id: b2, code: "00002", name: "สาขา 3" },
        bar_sell: "67900.00",
        bar_buy: "67700.00",
        jewelry_buy: "64315",
        ...NO_PER_GRAM,
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
      after: {
        bar_sell: "70100.00",
        bar_buy: "69900.00",
        jewelry_buy: "66405.00",
        ...NO_PER_GRAM,
        set_by: ids.mgr1,
      },
      typo_warning_confirmed: false,
    });
    expect(audits[1]?.diff).toMatchObject({
      before: { bar_sell: "70100.00" },
      after: { bar_sell: "70150.00", bar_buy: "69950.00", jewelry_buy: "66453.00" },
    });
    expect(audits[2]?.diff).toEqual({
      date: TODAY,
      branch: { id: b1, code: "00001", name: "สาขา 2" },
      removed: {
        bar_sell: "70150.00",
        bar_buy: "69950.00",
        jewelry_buy: "66453.00",
        ...NO_PER_GRAM,
        set_by: ids.mgr1,
      },
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
      ...NO_PER_GRAM,
      source: "central",
    });
    expect(await branchAudits()).toHaveLength(before);
  });

  it("บิลที่เปิดไปแล้วเก็บราคาของตัวเอง (snapshot) — ลบ override ไม่กระทบบิลเก่า · บิลใหม่คิดยอดจากราคากลาง", async () => {
    await put("mgr1", b1, { bar_sell: "70100" });
    const [gold] = await t.db.select().from(metal).where(eq(metal.code, "gold"));
    const [cust] = await t.db
      .insert(customer)
      .values({ nationalId: FAKE_ID, nameTh: "นายทดสอบ ราคาสาขา", cardExpireText: "31/12/2574" })
      .returning();
    // ระบบคิดยอดเอง (assessBuyLine · คิดมือ ปัดลงบาทเต็มทุกขั้น): ทองรับซื้อของ 00001 = 70,100 − 200 = 69,900
    //   69,900 × 0.0656 = 4,585.44 × 96.5% = 4,424.9496 → 4,424/กรัม × 5.860 = 25,924.64 → 25,924 · หัก 0% → 25,924.00
    //   ราคา/กรัม (แสดง) 25,924 ÷ 5.86 = 4,423.8907… → 4423.89
    const body = {
      customer_id: cust?.id,
      lines: [{ metal_id: gold?.id, weight_g: "5.860", purity_percent: "96.5" }],
      payments: [{ method: "cash", amount: "25924" }],
    };
    const saved = await t.request("/api/buy", {
      cookie: cookies.staff1,
      body: { ...body, idempotency_key: "branch-price-snapshot-0001" },
    });
    expect(saved.status, await saved.clone().text()).toBe(201);
    const { id } = (await saved.json()) as { id: string };
    const bill = async () => (await t.request(`/api/buy/${id}`, { cookie: cookies.staff1 })).json();
    const atBranchPrice = {
      gold_price_snapshot: "70100.00",
      lines: [
        {
          weight_g: "5.860",
          purity_percent: "96.50",
          deduct_percent: "0",
          base_price: "69900.00",
          unit_price: "4424.00",
          gross_amount: "25924.00",
          amount: "25924.00",
          price_per_g: "4423.89",
        },
      ],
    };
    expect(await bill()).toMatchObject(atBranchPrice);

    expect((await del("mgr1", b1)).status).toBe(200);
    expect(await bill()).toMatchObject(atBranchPrice);
    // บิลใหม่ที่ 00001 ใช้ราคากลาง 67,900 → รับซื้อ 67,700 × 0.0656 = 4,441.12 × 96.5% = 4,285.6808 → 4,285/กรัม
    //   × 5.860 = 25,110.10 → 25,110
    const q = await t.request("/api/buy/quote", {
      cookie: cookies.staff1,
      body: { ...body, payments: [{ method: "cash", amount: "25110" }] },
    });
    expect(await q.json()).toMatchObject({
      ok: true,
      gold_price_snapshot: "67900.00",
      lines: [
        {
          base_price: "67700.00",
          unit_price: "4285.00",
          gross_amount: "25110.00",
          deduct_amount: "0.00",
          amount: "25110.00",
        },
      ],
      total_amount: "25110.00",
    });
    // ยอดชำระของบิลเดิม (25,924) ใช้กับราคาใหม่ไม่ได้ — ยอดมาจากราคาของวัน ไม่ใช่จากที่ผู้ใช้ส่ง
    const stale = await t.request("/api/buy/quote", { cookie: cookies.staff1, body });
    expect(await stale.json()).toMatchObject({
      ok: false,
      errors: [{ field: "payments", message: "เกินยอดที่ต้องชำระ" }],
      total_amount: "25110.00",
    });
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
      expect(row).toMatchObject({ bar_sell: null, bar_buy: null, jewelry_buy: null, ...NO_PER_GRAM, source: null });
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

  // ── ราคาต่อกรัมเงิน/แพลตตินั่ม (UAT 30 ก.ย. 2569) — ตั้งที่ราคากลางเท่านั้น ทุกสาขาใช้ค่าของราคากลาง ──
  // วันที่ 1 ต.ค. (หลังทุกวันที่เทสต์ข้างบนใช้) — ยังไม่มีวันก่อนหน้าที่มีราคาต่อกรัม

  const PER_GRAM_DAY = "2026-10-01";
  const BRANCH_ONLY = "ราคาเงิน/แพลตตินั่มต่อกรัมตั้งได้ที่ราคากลางเท่านั้น";
  const ref = (id: string, code: string, name: string) => ({ id, code, name });
  const putCentral = async (body: unknown) =>
    t.request("/api/gold-price/today", { method: "PUT", cookie: cookies.admin, body });
  /** ราคากลาง 67,950 → รับซื้อ 67,750 → รูปพรรณ 67,750 × 0.95 = 64,362.50 → 64,363 (คิดมือ) */
  const CENTRAL_GOLD = { bar_sell: "67950.00", bar_buy: "67750.00", jewelry_buy: "64363" };
  /** ราคาเฉพาะสาขา 70,100 → 69,900 → 69,900 × 0.95 = 66,405 */
  const B1_GOLD = { bar_sell: "70100.00", bar_buy: "69900.00", jewelry_buy: "66405" };

  it("ราคาต่อกรัมของราคากลางใช้ทุกสาขา — สาขาที่มีราคาทองของตัวเองก็เห็นราคาเงิน/แพลตตินั่มของราคากลาง (ค่าที่ใช้จริง ไม่ใช่สำเนา)", async () => {
    clock = new Date(`${PER_GRAM_DAY}T03:00:00Z`);
    // ยืนยันด่านพิมพ์ผิดไว้ — เทสต์นี้ตรวจการกระจายราคา ไม่ใช่ด่าน (ด่านอยู่ใน goldPrice.test.ts)
    const central = await putCentral({
      bar_sell: "67950",
      silver_per_g: "45",
      platinum_per_g: "1000",
      confirm_typo: true,
    });
    expect(central.status).toBe(200);
    const perGram = { silver_per_g: "45.00", platinum_per_g: "1000.00" };
    expect(await central.json()).toEqual({
      date: PER_GRAM_DAY,
      ...CENTRAL_GOLD,
      ...perGram,
      diff: "200.00",
      source: "central",
    });

    // 00001 ตั้งราคาทองของตัวเอง — คำตอบคือราคาที่สาขาใช้จริง: ทองของสาขา + ราคาต่อกรัมของราคากลาง
    const own = await put("mgr1", b1, { bar_sell: "70100", confirm_typo: true });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({
      branch: ref(b1, "00001", "สาขา 2"),
      ...B1_GOLD,
      ...perGram,
      source: "branch",
    });
    // แถวของสาขาไม่ได้คัดลอกราคาต่อกรัมไป (null) และ audit ของแถวนั้นก็เป็น null — ราคากลางเปลี่ยนเมื่อไรสาขาเห็นทันที
    const [row] = await t.db
      .select()
      .from(goldPrice)
      .where(and(eq(goldPrice.branchId, b1), eq(goldPrice.date, PER_GRAM_DAY)));
    expect(row).toMatchObject({ barSell: "70100.00", silverPerG: null, platinumPerG: null });
    expect((await branchAudits()).at(-1)?.diff).toMatchObject({
      before: null,
      after: { bar_sell: "70100.00", ...NO_PER_GRAM, set_by: ids.mgr1 },
    });

    expect(await (await today("staff1")).json()).toEqual({
      date: PER_GRAM_DAY,
      ...B1_GOLD,
      ...perGram,
      diff: "200.00",
      source: "branch",
    });
    expect(await (await today("staff2")).json()).toEqual({
      date: PER_GRAM_DAY,
      ...CENTRAL_GOLD,
      ...perGram,
      diff: "200.00",
      source: "central",
    });
    expect(await list("admin")).toEqual([
      { branch: ref(b0, "00000", "สำนักงานใหญ่ (สาขา 1)"), ...CENTRAL_GOLD, ...perGram, source: "central" },
      { branch: ref(b1, "00001", "สาขา 2"), ...B1_GOLD, ...perGram, source: "branch" },
      { branch: ref(b2, "00002", "สาขา 3"), ...CENTRAL_GOLD, ...perGram, source: "central" },
    ]);

    // ยอดรับซื้อเงินที่ 00001 คิดจากราคาเงินของราคากลาง ส่วนทองใช้ราคาของสาขา (คิดมือ ปัดลงบาทเต็มทุกขั้น):
    //   45.00 × 92.5% = 41.625 → 41/กรัม × 271.56 = 11,133.96 → 11,133 · ราคา/กรัม 11,133 ÷ 271.56 = 40.996… → 41.00
    const [silver] = await t.db.select().from(metal).where(eq(metal.code, "silver"));
    const q = await t.request("/api/buy/quote", {
      cookie: cookies.staff1,
      body: {
        lines: [{ metal_id: silver?.id, weight_g: "271.56", purity_percent: "92.5" }],
        payments: [{ method: "cash", amount: "11133" }],
      },
    });
    expect(q.status).toBe(200);
    const quoted = (await q.json()) as { errors: { field: string }[] };
    expect(quoted.errors.filter((e) => e.field.startsWith("lines"))).toEqual([]);
    expect(quoted).toMatchObject({
      gold_price_snapshot: "70100.00",
      lines: [
        {
          weight_g: "271.560",
          purity_percent: "92.50",
          deduct_percent: "0",
          base_price: "45.00",
          unit_price: "41.00",
          gross_amount: "11133.00",
          deduct_amount: "0.00",
          amount: "11133.00",
          price_per_g: "41.00",
        },
      ],
      total_amount: "11133.00",
    });

    // ราคากลางแก้ราคาเงิน (แพลตตินั่มไม่ส่ง = คงไว้) → ทุกสาขาเห็นทันที · ล้างแพลตตินั่ม → ทุกสาขาเป็น null
    expect((await putCentral({ bar_sell: "67950", silver_per_g: "46", confirm_typo: true })).status).toBe(200);
    expect((await list("admin")).map((r) => [r.branch.code, r.silver_per_g, r.platinum_per_g])).toEqual([
      ["00000", "46.00", "1000.00"],
      ["00001", "46.00", "1000.00"],
      ["00002", "46.00", "1000.00"],
    ]);
    expect((await putCentral({ bar_sell: "67950", platinum_per_g: null, confirm_typo: true })).status).toBe(200);
    expect((await list("admin")).map((r) => [r.branch.code, r.source, r.silver_per_g, r.platinum_per_g])).toEqual([
      ["00000", "central", "46.00", null],
      ["00001", "branch", "46.00", null],
      ["00002", "central", "46.00", null],
    ]);
    expect(await (await today("staff1")).json()).toMatchObject({
      bar_sell: "70100.00",
      silver_per_g: "46.00",
      platinum_per_g: null,
      source: "branch",
    });
  });

  it("ราคาเฉพาะสาขาตั้งราคาต่อกรัมไม่ได้: PUT /today/branches/:id และ quote ที่มี branch_id + ราคาต่อกรัม = 400 ชี้ช่องนั้น (ล้างก็ไม่ได้) · สิทธิ์/สาขา/CSRF เหมือนเดิม · ไม่เขียนอะไร", async () => {
    clock = new Date(`${PER_GRAM_DAY}T03:00:00Z`);
    const writes = async () => ({
      prices: await t.db.select().from(goldPrice).orderBy(goldPrice.id),
      audits: await t.db.select().from(auditLog).orderBy(auditLog.id),
    });
    const before = await writes();
    const cases: [Record<string, unknown>, "silver_per_g" | "platinum_per_g"][] = [
      [{ bar_sell: "70100", silver_per_g: "45.00" }, "silver_per_g"],
      [{ bar_sell: "70100", silver_per_g: null }, "silver_per_g"],
      [{ bar_sell: "70100", silver_per_g: "" }, "silver_per_g"],
      [{ bar_sell: "70100", platinum_per_g: "1000" }, "platinum_per_g"],
      [{ bar_sell: "70100", platinum_per_g: null }, "platinum_per_g"],
      [{ bar_sell: "70100", silver_per_g: "45", platinum_per_g: "1000", confirm_typo: true }, "silver_per_g"],
    ];
    for (const [body, field] of cases) {
      const where = JSON.stringify(body);
      const res = await put("mgr1", b1, body);
      expect(res.status, `PUT ${where}`).toBe(400);
      expect(await res.json(), `PUT ${where}`).toEqual({ error: BRANCH_ONLY, field });
      const q = await quote({ ...body, branch_id: b1 });
      expect(q.status, `quote ${where}`).toBe(400);
      expect(await q.json(), `quote ${where}`).toEqual({ error: BRANCH_ONLY, field });
    }
    // ตัวเลข JSON ถูกปฏิเสธที่ชนิดก่อน (กฎ 1) — ยังชี้ช่องราคาต่อกรัม
    const numeric = await put("mgr1", b1, { bar_sell: "70100", silver_per_g: 45 });
    expect(numeric.status).toBe(400);
    expect(await numeric.json()).toEqual({
      error: "ต้องส่ง silver_per_g เป็นข้อความตัวเลข หรือ null เพื่อล้าง",
      field: "silver_per_g",
    });
    // quote: branch_id ที่อ่านไม่ได้ กับที่ไม่มีอยู่จริง ได้คำตอบเหมือนกันทุกตัวอักษร (ไม่บอกว่าสาขามีอยู่)
    const probe = async (branchId: string) => {
      const res = await quote({ bar_sell: "70100", branch_id: branchId, silver_per_g: "45" });
      return { status: res.status, body: await res.json() };
    };
    expect(await probe(b0)).toEqual(await probe(NO_UUID));

    // สาขาอื่น / ไม่มีจริง / uuid ผิดรูป = 404 ก่อนดู body · role ที่ตั้งราคาไม่ได้ = 403 · ไม่ login = 401 · origin อื่น = 403
    const perGramBody = { bar_sell: "70100", silver_per_g: "45" };
    for (const [label, res, status, error] of [
      ["mgr0 → 00001", await put("mgr0", b1, perGramBody), 404, "not found"],
      ["admin1 → 00000", await put("admin1", b0, perGramBody), 404, "not found"],
      ["mgr1 → ไม่มีจริง", await put("mgr1", NO_UUID, perGramBody), 404, "not found"],
      ["mgr1 → uuid ผิดรูป", await put("mgr1", "not-a-uuid", perGramBody), 404, "not found"],
      ["staff1 (ราคาต่อกรัมอย่างเดียว)", await put("staff1", b1, { silver_per_g: "45" }), 403, "forbidden"],
      ["accounting", await put("acct", b0, perGramBody), 403, "forbidden"],
      ["ไม่ login", await t.request(path(b1), { method: "PUT", body: perGramBody }), 401, "unauthorized"],
      ["origin อื่น", await put("mgr1", b1, perGramBody, "https://evil.test"), 403, "forbidden origin"],
    ] as const) {
      expect(res.status, label).toBe(status);
      expect(await res.json(), label).toEqual({ error });
    }
    expect(await writes()).toEqual(before);
  });

  it("แถวของสาขาที่มีราคาต่อกรัมเอง (ไม่มี endpoint เขียน — ใส่ตรงใน DB) ชนะราคากลางทีละช่อง · ตั้งราคาทองของสาขาไม่แตะราคาต่อกรัม · audit set/clear เก็บราคาต่อกรัม (R12)", async () => {
    clock = new Date(`${PER_GRAM_DAY}T03:00:00Z`);
    // ราคากลาง: เงิน 46.00 · แพลตตินั่ม 1,000.00
    expect(
      (await putCentral({ bar_sell: "67950", silver_per_g: "46", platinum_per_g: "1000", confirm_typo: true })).status,
    ).toBe(200);
    await t.db.insert(goldPrice).values({
      branchId: b2,
      date: PER_GRAM_DAY,
      barSell: "68000",
      barBuy: "67800",
      jewelryBuy: "64410",
      silverPerG: "47.00",
    });
    expect(await (await today("staff2")).json()).toEqual({
      date: PER_GRAM_DAY,
      bar_sell: "68000.00",
      bar_buy: "67800.00",
      jewelry_buy: "64410",
      silver_per_g: "47.00", // ของสาขาเอง
      platinum_per_g: "1000.00", // สาขาไม่มี → ของราคากลาง
      diff: "200.00",
      source: "branch",
    });
    expect((await list("admin")).map((r) => [r.branch.code, r.source, r.silver_per_g, r.platinum_per_g])).toEqual([
      ["00000", "central", "46.00", "1000.00"],
      ["00001", "branch", "46.00", "1000.00"],
      ["00002", "branch", "47.00", "1000.00"],
    ]);

    // 68,050 − 200 = 67,850 × 0.95 = 64,457.50 → 64,458 · ห่างจาก 70,100 ที่ 00002 ใช้ 28 ก.ย. 2.9% (ไม่เกินเกณฑ์)
    const set = await put("admin", b2, { bar_sell: "68050" });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({
      branch: ref(b2, "00002", "สาขา 3"),
      bar_sell: "68050.00",
      bar_buy: "67850.00",
      jewelry_buy: "64458",
      silver_per_g: "47.00",
      platinum_per_g: "1000.00",
      source: "branch",
    });
    const setAudit = (await branchAudits()).at(-1);
    expect(setAudit?.action).toBe("gold_price.set_branch");
    expect(setAudit?.diff).toEqual({
      date: PER_GRAM_DAY,
      branch: ref(b2, "00002", "สาขา 3"),
      before: {
        bar_sell: "68000.00",
        bar_buy: "67800.00",
        jewelry_buy: "64410.00",
        silver_per_g: "47.00",
        platinum_per_g: null,
        set_by: null,
      },
      after: {
        bar_sell: "68050.00",
        bar_buy: "67850.00",
        jewelry_buy: "64458.00",
        silver_per_g: "47.00",
        platinum_per_g: null,
        set_by: ids.admin,
      },
      typo_warning_confirmed: false,
    });

    const removed = await del("admin", b2);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      branch: ref(b2, "00002", "สาขา 3"),
      ...CENTRAL_GOLD,
      silver_per_g: "46.00",
      platinum_per_g: "1000.00",
      source: "central",
    });
    const clearAudit = (await branchAudits()).at(-1);
    expect(clearAudit?.action).toBe("gold_price.clear_branch");
    expect(clearAudit?.diff).toEqual({
      date: PER_GRAM_DAY,
      branch: ref(b2, "00002", "สาขา 3"),
      removed: {
        bar_sell: "68050.00",
        bar_buy: "67850.00",
        jewelry_buy: "64458.00",
        silver_per_g: "47.00",
        platinum_per_g: null,
        set_by: ids.admin,
      },
    });
  });
});
