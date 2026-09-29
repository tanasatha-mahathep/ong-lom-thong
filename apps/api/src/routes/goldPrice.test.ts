import { auditLog, branch, goldPrice, goldPriceSetting } from "@ong/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

describe.skipIf(!available)("ราคาทองวันนี้ (R7 · R8 · R12) + โลหะ", () => {
  let t: TestApp;
  // 10:00 น. วันที่ 28 ก.ย. 2569 เวลาไทย
  let clock = new Date("2026-09-28T03:00:00Z");
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock });
    await t.createUser({ email: "manager@ong.test", password: PW, role: "manager", branch: "00000" });
    await t.createUser({ email: "staff@ong.test", password: PW, branch: "00000" });
    await t.createUser({ email: "staff2@ong.test", password: PW, branch: "00001" });
    await t.createUser({ email: "nobranch@ong.test", password: PW, role: "manager" });
    await t.createUser({ email: "mgr2@ong.test", password: PW, role: "manager", branch: "00002" });
    for (const who of ["manager", "staff", "staff2", "nobranch", "mgr2"]) {
      cookies[who] = await t.login(`${who}@ong.test`, PW);
    }
  });
  afterAll(async () => {
    await t?.close();
  });

  const put = (who: string, body: unknown) =>
    t.request("/api/gold-price/today", { method: "PUT", cookie: cookies[who], body });
  const quote = (body: unknown) => t.request("/api/gold-price/quote", { cookie: cookies.staff, body });
  const today = (who: string) => t.request("/api/gold-price/today", { cookie: cookies[who] });

  it("โลหะ: ต้อง login · เรียงตามระบบเดิม", async () => {
    expect((await t.request("/api/metals")).status).toBe(401);
    const res = await t.request("/api/metals", { cookie: cookies.staff });
    const rows = (await res.json()) as { code: string; name_th: string; unit: string; assessment_enabled: boolean }[];
    expect(rows.map((m) => m.code)).toEqual(["gold", "nak", "silver", "platinum"]);
    expect(rows[0]).toMatchObject({ name_th: "ทอง", unit: "g", assessment_enabled: false });
  });

  it("ไม่มีสาขาที่เปิดอยู่ (ไม่ผูกสาขา / สาขาถูกปิดหมด) = 403 ทั้งราคาทองและโลหะ (fail-closed)", async () => {
    // app.request อาจคืน Response ตรง ๆ (ไม่ใช่ Promise) — await ทีละตัว
    const endpoints = async (who: string) => [
      await t.request("/api/metals", { cookie: cookies[who] }),
      await today(who),
      await t.request("/api/gold-price/quote", { cookie: cookies[who], body: { bar_sell: "67850" } }),
      await put(who, { bar_sell: "67850" }),
    ];
    for (const res of await endpoints("nobranch")) expect(res.status).toBe(403);
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      for (const res of await endpoints("mgr2")) expect(res.status).toBe(403);
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
    }
    expect(await t.db.select().from(goldPrice)).toEqual([]);
    expect((await t.request("/api/metals", { cookie: cookies.mgr2 })).status).toBe(200);
  });

  it("ยังไม่ตั้งราคา = 404 พร้อมข้อความ R7", async () => {
    const res = await today("staff");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "ยังไม่ได้ตั้งราคาทองของวันนี้", date: "2026-09-28" });
  });

  it("quote: 67,850 → 67,650 → 64,268 (กระดานราคาจริง)", async () => {
    const res = await quote({ bar_sell: "67,850" });
    expect(await res.json()).toEqual({ bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268" });
  });

  it.each([
    [{ bar_sell: 67850 }, "ต้องส่ง bar_sell เป็นข้อความตัวเลข"],
    [{ bar_sell: "abc" }, "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0"],
    [{ bar_sell: "0" }, "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0"],
    [{ bar_sell: "67850.001" }, "ราคาทศนิยมไม่เกิน 2 ตำแหน่ง"],
    [{ bar_sell: "150" }, "ราคาต่ำกว่าส่วนต่างรับซื้อ"],
    [{ bar_sell: "1000000" }, "ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง"],
    [{ bar_sell: "1,000,000,000,000" }, "ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง"],
  ])("quote ปฏิเสธ %j", async (body, error) => {
    const res = await quote(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error, field: "bar_sell" });
  });

  it("F12: content-type text/plain ถูกปฏิเสธ (415) ไม่ใช่ 400 ของ validation — JSON ปกติ (มี charset) ยังทำงาน", async () => {
    const raw = await t.app.request("/api/gold-price/quote", {
      method: "POST",
      headers: { cookie: cookies.staff ?? "", origin: "http://localhost:8787", "content-type": "text/plain" },
      body: JSON.stringify({ bar_sell: "67850" }),
    });
    expect(raw.status).toBe(415);
    expect(await raw.json()).toEqual({ error: "ต้องส่งเป็น application/json" });

    const ok = await t.app.request("/api/gold-price/quote", {
      method: "POST",
      headers: {
        cookie: cookies.staff ?? "",
        origin: "http://localhost:8787",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ bar_sell: "67850" }),
    });
    expect(ok.status).toBe(200);
  });

  it("ราคาสูงผิดปกติ = 400 แม้ยืนยันแล้ว — วันแรกที่ไม่มีราคาก่อนหน้าให้ด่านพิมพ์ผิดเทียบก็กัน (ไม่ล้น numeric เป็น 500)", async () => {
    // เลขบัตร 13 หลัก (สมมติ) ที่ Siam ID พิมพ์หลุดเข้าช่องราคา · ล้านล้านบาท
    for (const bar_sell of ["1103700123458", "1,000,000,000,000", "1000000.00"]) {
      const res = await put("manager", { bar_sell, confirm_typo: true });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง", field: "bar_sell" });
    }
    expect(await t.db.select().from(goldPrice)).toEqual([]);
    // เพดานพอดี 999,999.99 ยังคำนวณได้ (quote เท่านั้น ไม่บันทึก)
    expect(await (await quote({ bar_sell: "999999.99" })).json()).toEqual({
      bar_sell: "999999.99",
      bar_buy: "999799.99",
      jewelry_buy: "949810",
    });
  });

  it("staff ตั้งราคาไม่ได้ (403) · manager ตั้งได้", async () => {
    expect((await put("staff", { bar_sell: "67850" })).status).toBe(403);
    const res = await put("manager", { bar_sell: "67850" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      date: "2026-09-28",
      bar_sell: "67850.00",
      bar_buy: "67650.00",
      jewelry_buy: "64268",
      diff: "200.00",
      source: "central",
    });
  });

  it("F5: confirm_typo ผิดชนิด → 400 ชี้ confirm_typo ไม่ใช่ bar_sell (bar_sell เองถูกต้องอยู่แล้ว)", async () => {
    const res = await put("manager", { bar_sell: "67850", confirm_typo: "yes" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "confirm_typo ต้องเป็นจริงหรือเท็จ", field: "confirm_typo" });
  });

  it("ราคากลางเห็นทุกสาขา", async () => {
    for (const who of ["staff", "staff2"]) {
      expect(await (await today(who)).json()).toMatchObject({ bar_sell: "67850.00", source: "central" });
    }
  });

  it("ตั้งซ้ำวันเดียวกัน = แก้แถวเดิม + audit ก่อน/หลัง (R12)", async () => {
    await put("manager", { bar_sell: "67900" });
    const rows = await t.db
      .select()
      .from(goldPrice)
      .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, "2026-09-28")));
    expect(rows).toHaveLength(1);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.tableName, "gold_price")).orderBy(auditLog.id);
    expect(audits.map((a) => a.action)).toEqual(["gold_price.create", "gold_price.update"]);
    expect(audits[1]?.diff).toMatchObject({
      date: "2026-09-28",
      before: { bar_sell: "67850.00" },
      after: { bar_sell: "67900.00", bar_buy: "67700.00" },
      typo_warning_confirmed: false,
    });
  });

  it("ด่านกันพิมพ์ผิด: ห่างจากเมื่อวานเกินเกณฑ์ = 409 จนกว่าจะยืนยัน", async () => {
    clock = new Date("2026-09-29T03:00:00Z");
    const q = (await (await quote({ bar_sell: "76000" })).json()) as { warning?: string };
    expect(q.warning).toMatch(/^ราคาห่างจากครั้งก่อน 11\.9%/);

    const rejected = await put("manager", { bar_sell: "76000" });
    expect(rejected.status).toBe(409);
    // 409 ชี้ช่องยืนยัน (confirm_typo) · คำเตือนอยู่ใน warning
    expect(await rejected.json()).toEqual({ error: q.warning, field: "confirm_typo", warning: q.warning });
    expect((await today("staff")).status).toBe(404);

    const confirmed = await put("manager", { bar_sell: "76000", confirm_typo: true });
    expect(confirmed.status).toBe(200);
    const [last] = await t.db.select().from(auditLog).orderBy(auditLog.id).limit(1).offset(2);
    expect(last?.diff).toMatchObject({ typo_warning_confirmed: true });
  });

  it("อยู่ในเกณฑ์ = ไม่เตือน", async () => {
    clock = new Date("2026-09-30T03:00:00Z");
    const q = (await (await quote({ bar_sell: "76200" })).json()) as { warning?: string };
    expect(q.warning).toBeUndefined();
  });

  it("ค่าตั้งมาจาก DB (ฟังก์ชันเดียวกันทั้ง quote และบันทึก) · รูปพรรณปัดครึ่งขึ้น", async () => {
    await t.db.update(goldPriceSetting).set({ diff: "300" }).where(eq(goldPriceSetting.id, 1));
    try {
      // 67,850 − 300 = 67,550 × 0.95 = 64,172.50 → 64,173
      const res = await quote({ bar_sell: "67850" });
      expect(await res.json()).toMatchObject({ bar_buy: "67550.00", jewelry_buy: "64173" });
    } finally {
      await t.db.update(goldPriceSetting).set({ diff: "200" }).where(eq(goldPriceSetting.id, 1));
    }
  });

  it("ราคาเฉพาะสาขามาก่อนราคากลาง — เฉพาะสาขานั้น", async () => {
    clock = new Date("2026-09-28T03:00:00Z");
    await t.db.insert(goldPrice).values({
      branchId: t.branches["00001"],
      date: "2026-09-28",
      barSell: "68000",
      barBuy: "67800",
      jewelryBuy: "64410",
    });
    expect(await (await today("staff2")).json()).toMatchObject({ bar_sell: "68000.00", source: "branch" });
    expect(await (await today("staff")).json()).toMatchObject({ bar_sell: "67900.00", source: "central" });
  });

  it("'วันนี้' คือวันตามเวลาไทย — 00:30 น. วันที่ 29 (UTC ยังเป็นวันที่ 28)", async () => {
    clock = new Date("2026-09-28T17:30:00Z");
    expect(await (await today("staff")).json()).toMatchObject({ date: "2026-09-29", bar_sell: "76000.00" });
  });
});
