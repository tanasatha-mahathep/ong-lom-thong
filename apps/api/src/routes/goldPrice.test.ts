import { ROLES, type Role, auditLog, branch, goldPrice, goldPriceSetting, user } from "@ong/db";
import { TransactionRollbackError, and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { expectApiError, expectMoneyAsStrings, moneyShapeViolations } from "../test/assertions";
import { type TestApp, type TestUser, databaseAvailable, startTestApp } from "../test/harness";
import { expectNoNationalId } from "../test/pii";
import { testName } from "../test/synthetic";

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
    // ยังไม่ได้ตั้งราคาต่อกรัม = null (รับซื้อเงิน/แพลตตินั่มไม่ได้) — คีย์อยู่เสมอ ไม่หายไป
    expect(await res.json()).toEqual({
      date: "2026-09-28",
      bar_sell: "67850.00",
      bar_buy: "67650.00",
      jewelry_buy: "64268",
      silver_per_g: null,
      platinum_per_g: null,
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

// ─────────────────────────────────────────────────────────────────────────────
// สัญญา API ของ route ราคาทองทั้งสามตัว — รายการบังคับของสกิล api-endpoint (401 · 403 role · CSRF · validation ·
// เงินเป็น string · scoping สาขา · audit) + ข้อบกพร่องที่รู้แล้วเป็น it.fails (ผ่านตอนนี้ · แดงเมื่อโค้ดถูกแก้ → เปลี่ยนเป็น it)
// OWASP ASVS 4.0.3: V4.1.1/V4.1.3 role · V4.1.5 fail-closed · V4.2.1 ข้ามสาขา · V4.2.2 + V13.2.3 CSRF ด้วย Origin ·
//   V5.1.2 mass assignment · V5.1.3/V5.1.4 + V13.2.2 validation ตาม schema · V7.1.4 audit · V7.4.1 error ไม่หลุดภายใน
// OWASP API Security Top 10 2023: API1 BOLA (ราคาเฉพาะสาขา) · API2 (session ปลอม) · API3 BOPLA · API4 · API5 BFLA · API8
// ─────────────────────────────────────────────────────────────────────────────

/** วันทำการแยกตามเรื่อง — เทสต์ที่เขียนข้อมูลไม่ชนกันและไม่พึ่งลำดับ · ทุกราคาห่างกัน < 3% จึงไม่ติดด่านพิมพ์ผิด */
const DAY = {
  seeded: "2026-10-01", // ราคากลาง 67,850 + ราคาเฉพาะสาขา 00001 68,000 (ใส่ตรงใน beforeAll)
  empty: "2026-10-02", // ยังไม่ตั้งราคา (R7)
  roles: "2026-10-03",
  massAssign: "2026-10-04",
  audit: "2026-10-05",
  money: "2026-10-06",
  race: "2026-10-07",
  guard: "2026-10-08", // request ที่ต้องถูกปฏิเสธ — ถ้าหลุดจะเขียนลงวันนี้
  cap: "2026-10-09", // เพดานราคา 999,999.99 (PR #60) — ค่าที่ผ่านเขียนลงวันนี้
} as const;
/** role ที่ตั้งราคาได้ (spec §10) — role อื่นทุกตัว รวมถึง role ที่เพิ่มในอนาคต ต้องได้ 403 */
const PRICE_SETTERS: readonly Role[] = ["manager", "admin"];
const FORGED_COOKIE = "better-auth.session_token=forged.signature";
const PARSE_ERROR = { error: "ต้องส่ง bar_sell เป็นข้อความตัวเลข", field: "bar_sell" };
/** 400 ของช่องระดับบนสุดที่ไม่รู้จัก — ข้อความแบบ routes/admin.ts · field = ช่องแรกที่ไม่รู้จักตามลำดับใน body */
const unknownField = (...keys: string[]) => ({ error: `ไม่รู้จักช่อง ${keys.join(", ")}`, field: keys[0] ?? "" });
/** ประกาศสมาคมที่ browser เติมมา (from_reference) — ช่องที่รู้จักของ PUT /today */
const PREFILL = { announced_at: "2026-10-04T09:31:00+07:00", round: 2 };
const MONEY_2DP = /^\d+\.\d{2}$/;
const WHOLE_BAHT = /^\d+$/;
const BODY_ROUTES = [
  ["POST", "/api/gold-price/quote"],
  ["PUT", "/api/gold-price/today"],
] as const;
const CENTRAL_SEEDED = {
  date: DAY.seeded,
  bar_sell: "67850.00",
  bar_buy: "67650.00",
  jewelry_buy: "64268",
  silver_per_g: null,
  platinum_per_g: null,
  diff: "200.00",
  source: "central",
};
/** ราคาต่อกรัมที่ยังไม่ได้ตั้ง — GET/PUT /today ส่งคีย์มาเสมอ (null) · quote ส่งเฉพาะเมื่อ request ส่งมา */
const NO_PER_GRAM = { silver_per_g: null, platinum_per_g: null };

describe.skipIf(!available)("สัญญา API ราคาทอง: สิทธิ์ · CSRF · validation · เงินเป็น string · สาขา · audit", () => {
  let t: TestApp;
  let clock = new Date(`${DAY.seeded}T03:00:00Z`);
  /** นาฬิกา = 10:00 น. เวลาไทยของวันนั้น */
  const onDay = (date: string) => {
    clock = new Date(`${date}T03:00:00Z`);
  };
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const need = (map: Record<string, string>, key: string): string => {
    const value = map[key];
    if (!value) throw new Error(`ไม่มี ${key}`);
    return value;
  };
  const uid = (who: string) => need(ids, who);
  const bid = (code: string) => need(t.branches, code);

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock });
    // หนึ่งบัญชีต่อ role ที่สาขา 00000 + multi ที่มีสิทธิ์ 00000 และ 00001
    const accounts: (TestUser & { who: string })[] = [
      ...ROLES.map((role) => ({ who: role, email: `gp-${role}@ong.test`, password: PW, role, branch: "00000" })),
      { who: "multi", email: "gp-multi@ong.test", password: PW, branch: "00000", allow: ["00001"] },
    ];
    for (const { who, ...account } of accounts) {
      const created = await t.createUser(account);
      // ข้อมูลสมมติ: ชื่อขึ้นต้น "ทดสอบ"
      await t.db
        .update(user)
        .set({ name: testName(who) })
        .where(eq(user.id, created.id));
      ids[who] = created.id;
      cookies[who] = await t.login(account.email, PW);
    }
    await t.db.insert(goldPrice).values([
      { branchId: null, date: DAY.seeded, barSell: "67850", barBuy: "67650", jewelryBuy: "64268" },
      { branchId: bid("00001"), date: DAY.seeded, barSell: "68000", barBuy: "67800", jewelryBuy: "64410" },
    ]);
  });
  afterAll(async () => {
    await t?.close();
  });

  const today = (cookie?: string) => t.request("/api/gold-price/today", { cookie });
  const quote = (cookie?: string, body?: unknown) =>
    t.request("/api/gold-price/quote", { method: "POST", cookie, body });
  const put = (cookie?: string, body?: unknown) => t.request("/api/gold-price/today", { method: "PUT", cookie, body });
  /** request ดิบ: ควบคุม body · Content-Type · Origin เอง (origin: null = ไม่ส่ง header Origin เลย) */
  const raw = (
    method: string,
    path: string,
    init: { cookie?: string; body?: string; contentType?: string; origin?: string | null },
  ) => {
    const headers: Record<string, string> = { "content-type": init.contentType ?? "application/json" };
    const origin = init.origin === undefined ? new URL(t.env.BETTER_AUTH_URL).origin : init.origin;
    if (origin !== null) headers.origin = origin;
    if (init.cookie) headers.cookie = init.cookie;
    return t.app.request(path, { method, headers, body: init.body });
  };
  /** status + field ของคำตอบ — ใช้รวบผลหลาย request ไว้ตรวจครั้งเดียว */
  const outcome = async (res: Response) => {
    const body = (await res.json()) as { field?: string };
    return { status: res.status, field: body.field ?? null };
  };
  /** ทุกแถวของ gold_price + audit_log — พิสูจน์ว่า request ที่ถูกปฏิเสธไม่เขียนอะไรเลย */
  const writes = async () => ({
    prices: await t.db.select().from(goldPrice).orderBy(goldPrice.id),
    audits: await t.db.select().from(auditLog).orderBy(auditLog.id),
  });
  const switchBranch = async (who: string, code: string) => {
    const res = await t.request("/api/me/branch", { cookie: cookies[who], body: { branch_id: bid(code) } });
    expect(res.status, `สลับ ${who} ไปสาขา ${code}`).toBe(200);
  };

  it.each([
    ["GET", "/api/gold-price/today", undefined],
    ["POST", "/api/gold-price/quote", { bar_sell: "67850" }],
    ["POST", "/api/gold-price/quote", { bar_sell: "67850", silver_per_g: "45.50", platinum_per_g: "1000.00" }],
    ["PUT", "/api/gold-price/today", { bar_sell: "67850", confirm_typo: true }],
    [
      "PUT",
      "/api/gold-price/today",
      { bar_sell: "67850", silver_per_g: "45.50", platinum_per_g: null, confirm_typo: true },
    ],
  ] as const)(
    "%s %s %j: ไม่มี cookie หรือ cookie ปลอม = 401 unauthorized · ไม่เขียนอะไร",
    async (method, path, body) => {
      onDay(DAY.guard);
      const before = await writes();
      for (const cookie of [undefined, FORGED_COOKIE]) {
        const res = await t.request(path, { method, cookie, body });
        const where = `${method} ${path} (${cookie ? "cookie ปลอม" : "ไม่มี cookie"})`;
        expect(await expectApiError(res, 401, where)).toEqual({ error: "unauthorized" });
      }
      expect(await writes()).toEqual(before);
    },
  );

  it.each(ROLES.filter((role) => !PRICE_SETTERS.includes(role)))(
    "PUT /today โดย %s = 403 forbidden (ตัดสินก่อนดู body) · ไม่เขียนอะไร (spec §10 · API5)",
    async (who) => {
      onDay(DAY.roles);
      const before = await writes();
      // รวมถึง body ที่ตั้งแค่ราคาต่อกรัมของเงิน/แพลตตินั่ม — สิทธิ์ตั้งราคาเดียวกับราคาทอง
      // และ body ที่มีช่องที่ไม่รู้จัก (manager/admin ได้ 400 ชี้ชื่อช่อง) — role อื่นได้ 403 เดิม ไม่ถึงด่านตรวจ body
      for (const body of [
        { bar_sell: "67850", confirm_typo: true },
        {},
        { silver_per_g: "45.50" },
        { platinum_per_g: null },
        { bar_sell: "67850", silver_per_g: "45.50", platinum_per_g: "1000.00", confirm_typo: true },
        { bar_sell: "67850", branch_id: "00000000-0000-4000-8000-000000000000", bar_buy: "1.00" },
        { barSell: "67850", silver_per_g: "45.50" },
      ]) {
        const res = await put(cookies[who], body);
        expect(await expectApiError(res, 403, `PUT โดย ${who} body=${JSON.stringify(body)}`)).toEqual({
          error: "forbidden",
        });
      }
      expect(await writes()).toEqual(before);
    },
  );

  it("PUT /today โดย manager = 200 (สร้าง) · admin = 200 (แก้) · audit ระบุผู้ทำถูกคน", async () => {
    onDay(DAY.roles);
    const steps = [
      ["manager", "67850", "gold_price.create"],
      ["admin", "67900", "gold_price.update"],
    ] as const;
    for (const [who, barSell, action] of steps) {
      const before = await writes();
      const res = await put(cookies[who], { bar_sell: barSell });
      expect(res.status, who).toBe(200);
      expect(await res.json()).toMatchObject({ date: DAY.roles, bar_sell: `${barSell}.00`, source: "central" });
      const added = (await writes()).audits.slice(before.audits.length);
      expect(added, who).toMatchObject([{ action, userId: uid(who), tableName: "gold_price" }]);
    }
  });

  it.each([...ROLES])("%s อ่านราคาวันนี้และ quote ได้ (200) · วันที่ยังไม่ตั้งราคา = 404 ตาม R7", async (role) => {
    onDay(DAY.seeded);
    const res = await today(cookies[role]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(CENTRAL_SEEDED);
    const q = await quote(cookies[role], { bar_sell: "67850" });
    expect(q.status).toBe(200);
    expect(await q.json()).toEqual({ bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268" });
    onDay(DAY.empty);
    expect(await expectApiError(await today(cookies[role]), 404, `GET /today โดย ${role}`)).toEqual({
      error: "ยังไม่ได้ตั้งราคาทองของวันนี้",
      date: DAY.empty,
    });
  });

  it.each([
    ["origin อื่น", "https://evil.example"],
    ["โดเมนหน้าตาคล้าย (ต่อท้าย)", "http://localhost:8787.evil.example"],
    ["คนละ scheme", "https://localhost:8787"],
    ["คนละ port", "http://localhost:8788"],
    ['Origin "null" (iframe sandbox · file://)', "null"],
    ["ไม่มี header Origin", null],
  ] as const)(
    "CSRF — %s: POST /quote และ PUT /today = 403 แม้ cookie ของ manager ถูกต้อง · ไม่เขียนอะไร",
    async (_label, origin) => {
      onDay(DAY.guard);
      const before = await writes();
      for (const [method, path] of BODY_ROUTES) {
        const body = JSON.stringify({ bar_sell: "67850", silver_per_g: "45.50", confirm_typo: true });
        const res = await raw(method, path, { cookie: cookies.manager, origin, body });
        expect(await expectApiError(res, 403, `${method} ${path} origin=${origin}`)).toEqual({
          error: "forbidden origin",
        });
      }
      expect(await writes()).toEqual(before);
    },
  );

  it.each([
    ["ไม่มี body", undefined, PARSE_ERROR.error],
    ["{}", {}, PARSE_ERROR.error],
    ["bar_sell เป็นตัวเลข JSON", { bar_sell: 67850 }, PARSE_ERROR.error],
    ['bar_sell "abc"', { bar_sell: "abc" }, "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0"],
    ["ทศนิยม 3 ตำแหน่ง", { bar_sell: "67850.001" }, "ราคาทศนิยมไม่เกิน 2 ตำแหน่ง"],
  ])("PUT /today — %s → 400 ชี้ช่อง bar_sell · ไม่เขียนอะไร", async (label, body, error) => {
    onDay(DAY.guard);
    const before = await writes();
    // raw = Content-Type: application/json เสมอ (รวมกรณีไม่มี body) — ผลเหมือนเดิมหลังแก้ F12
    const res = await raw("PUT", "/api/gold-price/today", {
      cookie: cookies.manager,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(await expectApiError(res, 400, `PUT ${label}`)).toEqual({ error, field: "bar_sell" });
    expect(await writes()).toEqual(before);
  });

  it("POST /quote ไม่มี body · JSON เสียทั้ง quote และ PUT → 400 ชี้ช่อง bar_sell · ไม่เขียนอะไร", async () => {
    onDay(DAY.guard);
    const before = await writes();
    // ไม่มี body แต่ประกาศว่าเป็น JSON — ยังเป็น 400 หลังแก้ F12 (ไม่มี Content-Type เลยควรได้ 415 ตาม F12)
    const empty = await raw("POST", "/api/gold-price/quote", { cookie: cookies.staff });
    expect(await expectApiError(empty, 400, "quote ไม่มี body")).toEqual(PARSE_ERROR);
    for (const [method, path] of BODY_ROUTES) {
      const res = await raw(method, path, { cookie: cookies.manager, body: '{"bar_sell":"67850"' });
      expect(await expectApiError(res, 400, `${method} ${path} JSON เสีย`)).toEqual(PARSE_ERROR);
    }
    expect(await writes()).toEqual(before);
  });

  it.each(["67850", "67850.5", "6.785e4", '["67850"]', '{"value":"67850"}', "true", "null"])(
    "bar_sell เป็น JSON %s (ไม่ใช่ string) → 400 ชี้ช่อง bar_sell ทั้ง quote และ PUT · PUT ไม่เขียนอะไร (กฎ 1)",
    async (json) => {
      onDay(DAY.guard);
      const before = await writes();
      for (const [method, path] of BODY_ROUTES) {
        const body = `{"bar_sell":${json},"confirm_typo":true}`;
        const res = await raw(method, path, { cookie: cookies.manager, body });
        expect(await expectApiError(res, 400, `${method} ${path} bar_sell=${json}`)).toEqual(PARSE_ERROR);
      }
      expect(await writes()).toEqual(before);
    },
  );

  it("เงินใน response เป็น string ทศนิยมตายตัวทุก route — bar_sell/bar_buy/diff 2 ตำแหน่ง · jewelry_buy จำนวนเต็ม (กฎ 1 · R8)", async () => {
    onDay(DAY.money);
    const derived = { bar_sell: "67850.50", bar_buy: "67650.50", jewelry_buy: "64268" };
    const saved = { date: DAY.money, ...derived, ...NO_PER_GRAM, diff: "200.00", source: "central" };
    const responses = [
      ["PUT /today", await put(cookies.manager, { bar_sell: "67850.5" }), saved],
      ["POST /quote", await quote(cookies.staff, { bar_sell: "67,850.5" }), derived],
      ["GET /today", await today(cookies.staff), saved],
    ] as const;
    for (const [where, res, expected] of responses) {
      expect(res.status, where).toBe(200);
      expect(res.headers.get("content-type"), where).toMatch(/^application\/json\b/);
      const text = await res.text();
      expectNoNationalId(text, where);
      const body = JSON.parse(text) as Record<string, unknown>;
      expectMoneyAsStrings(body, where);
      expect(body, where).toEqual(expected);
      for (const key of ["bar_sell", "bar_buy", "diff"].filter((k) => k in body)) {
        expect(body[key], `${where} ${key}`).toMatch(MONEY_2DP);
      }
      expect(body.jewelry_buy, `${where} jewelry_buy`).toMatch(WHOLE_BAHT);
    }
  });

  it("Content-Type: application/json; charset=utf-8 ใช้ได้ปกติ (charset ไม่ทำให้ถูกปฏิเสธ)", async () => {
    const body = JSON.stringify({ bar_sell: "67850" });
    const res = await raw("POST", "/api/gold-price/quote", {
      cookie: cookies.staff,
      contentType: "application/json; charset=utf-8",
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ bar_sell: "67850.00" });
  });

  it("ราคาเฉพาะสาขา 00001 เห็นเฉพาะตอนทำงานอยู่ 00001 · สลับกลับ 00000 = ราคากลาง · คนไม่มีสิทธิ์สลับไปไม่ได้ (R7 · กฎ 4 · API1)", async () => {
    onDay(DAY.seeded);
    await switchBranch("multi", "00001");
    expect(await (await today(cookies.multi)).json()).toEqual({
      ...CENTRAL_SEEDED,
      bar_sell: "68000.00",
      bar_buy: "67800.00",
      jewelry_buy: "64410",
      source: "branch",
    });
    await switchBranch("multi", "00000");
    expect(await (await today(cookies.multi)).json()).toEqual(CENTRAL_SEEDED);
    // staff มีสิทธิ์แค่ 00000: สลับไป 00001 = 404 (ไม่บอกว่ามีสาขานั้น) และยังเห็นแค่ราคากลาง
    const denied = await t.request("/api/me/branch", { cookie: cookies.staff, body: { branch_id: bid("00001") } });
    expect(denied.status).toBe(404);
    expect(await (await today(cookies.staff)).json()).toEqual(CENTRAL_SEEDED);
  });

  it("PUT แนบช่องที่ไม่ได้เปิดให้ตั้ง (bar_buy · jewelry_buy · diff · date · branch_id · set_by · source · id) มากับ bar_sell = 400 ชี้ช่องแรกที่ไม่รู้จัก · ไม่ตัดทิ้งเงียบ ๆ · ไม่เขียนอะไร (API3 · ASVS V5.1.2)", async () => {
    onDay(DAY.massAssign);
    const before = await writes();
    const res = await put(cookies.manager, {
      bar_sell: "67850",
      bar_buy: "1.00",
      jewelry_buy: "1",
      diff: "0",
      date: "2026-01-01",
      branch_id: bid("00001"),
      set_by: uid("admin"),
      source: "branch",
      id: "00000000-0000-4000-8000-000000000000",
    });
    expect(await expectApiError(res, 400, "PUT แนบช่องที่ไม่ได้เปิดให้ตั้ง")).toEqual(
      unknownField("bar_buy", "jewelry_buy", "diff", "date", "branch_id", "set_by", "source", "id"),
    );
    // ราคากลาง · ราคาเฉพาะสาขา · audit เท่าเดิมทุกแถว · ส่วนต่างรับซื้อ (ค่าตั้งของร้าน) ไม่ถูกแตะ
    expect(await writes()).toEqual(before);
    expect(await t.db.select({ diff: goldPriceSetting.diff }).from(goldPriceSetting)).toEqual([{ diff: "200.00" }]);
  });

  it("PUT /today ที่ส่ง bar_sell มาด้วย + ช่องที่ไม่รู้จัก (branch_id · ค่าที่ derive · ช่องของระบบ · สะกดผิด · __proto__) → 400 ชี้ช่องแรกที่ไม่รู้จัก ทั้ง manager และ admin · ราคากลาง ราคาสาขา audit ไม่เปลี่ยน · คำขอปกติยัง 200 (API3 · ASVS V5.1.2)", async () => {
    onDay(DAY.massAssign);
    // ราคากลางของวันนี้ที่มีอยู่แล้ว — คำขอที่ถูกปฏิเสธต้องไม่แตะแถวนี้ (รวมราคาเงิน/แพลตตินั่ม)
    const created = await put(cookies.manager, { bar_sell: "67850", silver_per_g: "45.00", platinum_per_g: "1000" });
    expect(created.status, "manager ตั้งราคาด้วยคำขอปกติ").toBe(200);
    const before = await writes();
    // ช่องที่รู้จักในทุก body ถูกต้อง (ทอง 67,900 ห่างจากเดิม 0.07% ไม่ติดด่านพิมพ์ผิด)
    // — ถ้าช่องเกินถูกตัดทิ้งเงียบ ๆ ทุก body จะได้ 200 และเปลี่ยนราคากลางของทุกสาขาจริง
    const cases: [Record<string, unknown>, { error: string; field: string }][] = [
      // ตั้งใจตั้งราคาเฉพาะสาขา 00001 + ราคาเงิน แต่ส่งมาที่ราคากลาง
      [{ bar_sell: "67900", branch_id: bid("00001"), silver_per_g: "30.00" }, unknownField("branch_id")],
      // ค่าที่เซิร์ฟเวอร์ derive เอง (R8) ตั้งตรงไม่ได้
      [{ bar_sell: "67900", bar_buy: "1.00", jewelry_buy: "1" }, unknownField("bar_buy", "jewelry_buy")],
      // ช่องของระบบ ทีละช่อง และหลายช่องพร้อมกัน (ชี้ช่องแรก)
      [{ bar_sell: "67900", diff: "0" }, unknownField("diff")],
      [{ bar_sell: "67900", set_by: uid("admin") }, unknownField("set_by")],
      [{ bar_sell: "67900", date: "2026-01-01" }, unknownField("date")],
      [{ bar_sell: "67900", source: "branch" }, unknownField("source")],
      [
        { bar_sell: "67900", silver_per_g: "45.10", set_by: uid("admin"), date: "2026-01-01", source: "branch" },
        unknownField("set_by", "date", "source"),
      ],
      // สะกดชื่อช่องผิด — ถ้าตัดทิ้งจะบันทึกเหมือนไม่ได้ส่งช่องนั้น (ราคาเงินไม่ถูกตั้ง · คำอ้างราคาสมาคมหาย)
      [{ bar_sell: "67900", barSell: "68000" }, unknownField("barSell")],
      [{ bar_sel: "68000", bar_sell: "67900" }, unknownField("bar_sel")],
      [{ bar_sell: "67900", silver_per_gram: "45.10" }, unknownField("silver_per_gram")],
      [{ bar_sell: "67900", platinumPerG: "1000" }, unknownField("platinumPerG")],
      [{ bar_sell: "67900", confirmTypo: true }, unknownField("confirmTypo")],
      [{ bar_sell: "67900", fromReference: PREFILL }, unknownField("fromReference")],
      // ช่องที่รู้จักครบทั้ง 5 ช่องและถูกต้อง + ช่องเกินช่องเดียว ก็ยัง 400
      [
        {
          bar_sell: "67900",
          silver_per_g: "45.10",
          platinum_per_g: null,
          confirm_typo: true,
          from_reference: PREFILL,
          branch_id: bid("00000"),
        },
        unknownField("branch_id"),
      ],
      // ช่องที่รู้จักแต่ค่าผิด + ช่องที่ไม่รู้จัก → ชี้ช่องที่รู้จักก่อน (zod ตรวจ shape ก่อนช่องเกิน)
      [{ bar_sell: 67900, bar_buy: "1.00" }, PARSE_ERROR],
    ];
    for (const who of PRICE_SETTERS) {
      for (const [body, expected] of cases) {
        const where = `PUT โดย ${who} ${JSON.stringify(body)}`;
        expect(await expectApiError(await put(cookies[who], body), 400, where), where).toEqual(expected);
      }
      // JSON ดิบ: "__proto__" เป็นช่องของ body จริงหลัง JSON.parse — ปฏิเสธเหมือนช่องอื่น ไม่ข้ามเงียบ ๆ
      const proto = await raw("PUT", "/api/gold-price/today", {
        cookie: cookies[who],
        body: '{"bar_sell":"67900","__proto__":{"bar_buy":"1.00"}}',
      });
      expect(await expectApiError(proto, 400, `PUT โดย ${who} __proto__`)).toEqual(unknownField("__proto__"));
    }
    // ไม่มีอะไรถูกเขียน: ราคากลาง ราคาเฉพาะสาขา audit เท่าเดิมทุกแถว · ส่วนต่างรับซื้อของร้านไม่ถูกแตะ
    expect(await writes()).toEqual(before);
    expect(await t.db.select({ diff: goldPriceSetting.diff }).from(goldPriceSetting)).toEqual([{ diff: "200.00" }]);

    // คำขอปกติยังได้ 200: admin ส่งช่องที่รู้จักครบทั้ง 5 ช่อง · manager แก้แค่ราคาต่อกรัม (ไม่ส่ง bar_sell)
    const full = await put(cookies.admin, {
      bar_sell: "67900",
      silver_per_g: "45.10",
      platinum_per_g: null,
      confirm_typo: true,
      from_reference: PREFILL,
    });
    const gold67900 = { bar_sell: "67900.00", bar_buy: "67700.00", jewelry_buy: "64315" }; // 67,700 × 0.95
    const saved = { date: DAY.massAssign, ...gold67900, diff: "200.00", source: "central" };
    expect(full.status, "admin ส่งช่องที่รู้จักครบ").toBe(200);
    expect(await full.json()).toEqual({ ...saved, silver_per_g: "45.10", platinum_per_g: null });
    const perGramOnly = await put(cookies.manager, { platinum_per_g: "1,000", confirm_typo: false });
    expect(perGramOnly.status, "manager แก้แค่ราคาต่อกรัม").toBe(200);
    expect(await perGramOnly.json()).toEqual({ ...saved, silver_per_g: "45.10", platinum_per_g: "1000.00" });
    const added = (await writes()).audits.slice(before.audits.length);
    expect(added).toMatchObject([
      { action: "gold_price.update", tableName: "gold_price", userId: uid("admin") },
      { action: "gold_price.update", tableName: "gold_price", userId: uid("manager") },
    ]);
    // from_reference ยังรับและลง audit (ไม่ถูกตัดทิ้ง) · แหล่งราคาสมาคมปิดอยู่ในเทสต์ = มีแค่คำอ้างของ client
    expect(added[0]?.diff).toMatchObject({
      reference: { client_prefilled: true, client_announced_at: PREFILL.announced_at, client_round: PREFILL.round },
    });
  });

  it("PUT ที่สร้างราคาของวัน → audit gold_price.create แถวเดียว · ผู้ทำ = manager · before null · เงินใน diff เป็น string 2 ตำแหน่ง ไม่มี float (R12)", async () => {
    onDay(DAY.audit);
    const before = await writes();
    const res = await put(cookies.manager, { bar_sell: "67850" });
    expect(res.status).toBe(200);
    const after = await writes();
    const created = after.prices.filter((p) => !before.prices.some((b) => b.id === p.id));
    expect(created).toHaveLength(1);
    const added = after.audits.slice(before.audits.length);
    expect(added).toMatchObject([
      { action: "gold_price.create", tableName: "gold_price", rowId: created[0]?.id, userId: uid("manager") },
    ]);
    expect(added[0]?.diff).toEqual({
      date: DAY.audit,
      before: null,
      after: {
        bar_sell: "67850.00",
        bar_buy: "67650.00",
        jewelry_buy: "64268.00",
        ...NO_PER_GRAM,
        set_by: uid("manager"),
      },
      typo_warning_confirmed: false,
    });
    expect(moneyShapeViolations(added[0]?.diff)).toEqual([]);
  });

  // F3 — แก้แล้วใน dev (PR #60 · fix(api): require an open branch …): GET /today หาสาขาปัจจุบันผ่าน
  // currentBranch(viewer, await forUser(db, viewer)) — ถูกถอนสิทธิ์/สาขาถูกปิดระหว่าง session = ราคากลาง (fail-closed)
  // เดิมเป็น it.fails (ได้ราคาเฉพาะสาขา 00001 ทั้งที่ไม่มีสิทธิ์แล้ว) · ตอนนี้ตรึงพฤติกรรมที่ถูกไว้
  it("F3 (แก้แล้ว) — ถูกถอนสิทธิ์สาขา 00001 ระหว่าง session หรือสาขา 00001 ถูกปิด: GET /today ได้ราคากลาง ไม่ใช่ราคาเฉพาะสาขา 00001", async () => {
    onDay(DAY.seeded);
    const view = async () => {
      const res = await today(cookies.multi);
      const body = (await res.json()) as { bar_sell?: string; source?: string };
      return { status: res.status, bar_sell: body.bar_sell, source: body.source };
    };
    const seen: Record<string, unknown> = {};

    await switchBranch("multi", "00001");
    await t.db
      .update(user)
      .set({ allowedBranchIds: [] })
      .where(eq(user.id, uid("multi")));
    try {
      seen.revoked = await view();
    } finally {
      await t.db
        .update(user)
        .set({ allowedBranchIds: [bid("00001")] })
        .where(eq(user.id, uid("multi")));
    }

    await switchBranch("multi", "00001");
    await t.db
      .update(branch)
      .set({ isActive: false })
      .where(eq(branch.id, bid("00001")));
    try {
      seen.closed = await view();
    } finally {
      await t.db
        .update(branch)
        .set({ isActive: true })
        .where(eq(branch.id, bid("00001")));
    }

    const central = { status: 200, bar_sell: "67850.00", source: "central" };
    expect(seen).toEqual({ revoked: central, closed: central });
  });

  // F5 — ยังไม่แก้: routes/goldPrice.ts PUT /today ตอบ BAR_SELL_ERROR (field "bar_sell") ทุกครั้งที่ SetBody ไม่ผ่าน
  // (confirm_typo ผิดชนิดก็ชี้ bar_sell) · PR #60 แก้อีกเรื่อง: 409 ของด่านพิมพ์ผิดชี้ confirm_typo แล้ว (เทสต์ของ dev ข้างบน)
  // แก้: ใช้ path ของ issue แรกจาก zod (body.error.issues[0].path[0]) เป็น field
  // เดิมเป็น it.fails — แก้ใน PR #89 (dev 7d8436e) · ตอนนี้ตรึงพฤติกรรมที่ถูกไว้
  it("F5 — PUT /today: confirm_typo ที่ไม่ใช่ boolean → 400 ชี้ช่อง confirm_typo (ไม่ใช่ bar_sell) · ไม่เขียนอะไร", async () => {
    onDay(DAY.guard);
    const before = await writes();
    const res = await put(cookies.manager, { bar_sell: "67850", confirm_typo: "yes" });
    expect((await expectApiError(res, 400, "PUT confirm_typo=yes")).field).toBe("confirm_typo");
    expect(await writes()).toEqual(before);
  });

  // F6 — แก้แล้วใน dev (PR #53 · fix(core): strict parseDecimal): เงินที่ผู้ใช้พิมพ์รับเฉพาะตัวเลขล้วน (มีทศนิยมได้) หรือคั่นหลักพัน
  // ถูกต้อง — hex/binary/octal · e-notation · "_" · คอมมาผิดตำแหน่ง · เครื่องหมาย · ช่องว่างกลางตัวเลข ถูกปฏิเสธ
  // เดิมเป็น it.fails ("0x10908" = 67,848 · "1e1000000" ขยายเป็นคำตอบ 3 MB) · ตอนนี้ตรึงพฤติกรรมที่ถูกไว้ทั้ง quote และ PUT
  it("F6 (แก้แล้ว) — bar_sell รับเฉพาะตัวเลขล้วนหรือคั่นหลักพันถูกต้อง: รูปแบบอื่น 400 ชี้ bar_sell ทั้ง quote และ PUT · ไม่เขียนอะไร", async () => {
    onDay(DAY.guard);
    const rejected = [
      "0x10908", // hex = 67,848
      "0b10000100100001010", // binary = 67,850
      "0o204412", // octal = 67,850
      "6.785e4", // e-notation
      "1e10000", // e-notation ที่ขยายเป็นหมื่นหลัก (API4)
      "1_000",
      "6,78,50", // คอมมาผิดตำแหน่ง
      "20,03",
      "0,123", // น่าจะหมายถึง 0.123 ไม่ใช่ 123
      ".5",
      "5.",
      "+67850",
      "67 850", // ช่องว่างกลางตัวเลข
    ];
    const before = await writes();
    const bad = { error: "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0", field: "bar_sell" };
    for (const bar_sell of rejected) {
      expect(await expectApiError(await quote(cookies.staff, { bar_sell }), 400, `quote ${bar_sell}`)).toEqual(bad);
      const res = await put(cookies.manager, { bar_sell, confirm_typo: true });
      expect(await expectApiError(res, 400, `PUT ${bar_sell}`)).toEqual(bad);
    }
    expect(await writes()).toEqual(before);

    const accepted: [string, string][] = [
      ["67850", "67850.00"],
      ["67850.5", "67850.50"],
      ["67,850", "67850.00"], // คั่นหลักพันถูกต้อง
      ["67,850.50", "67850.50"],
      [" 67850 ", "67850.00"], // ช่องว่างหัวท้ายถูกตัด
    ];
    for (const [bar_sell, normalised] of accepted) {
      const res = await quote(cookies.staff, { bar_sell });
      expect(res.status, bar_sell).toBe(200);
      expect(((await res.json()) as { bar_sell: string }).bar_sell, bar_sell).toBe(normalised);
    }
  });

  it("เพดานราคาทองแท่ง (PR #60): 999,999.99 ผ่านทั้ง quote และ PUT · 1,000,000.00 → 400 ชี้ bar_sell · ไม่เขียนอะไร (boundary value)", async () => {
    onDay(DAY.cap);
    const tooHigh = { error: "ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง", field: "bar_sell" };
    for (const bar_sell of ["1000000", "1000000.00", "1,000,000.00"]) {
      expect(await expectApiError(await quote(cookies.staff, { bar_sell }), 400, `quote ${bar_sell}`)).toEqual(tooHigh);
      const before = await writes();
      const res = await put(cookies.manager, { bar_sell, confirm_typo: true });
      expect(await expectApiError(res, 400, `PUT ${bar_sell}`)).toEqual(tooHigh);
      expect(await writes(), `PUT ${bar_sell} ต้องไม่เขียนอะไร`).toEqual(before);
    }
    const top = { bar_sell: "999999.99", bar_buy: "999799.99", jewelry_buy: "949810" };
    for (const bar_sell of ["999999.99", "999,999.99"]) {
      const q = await quote(cookies.staff, { bar_sell });
      expect(q.status, bar_sell).toBe(200);
      expect(await q.json(), bar_sell).toMatchObject(top);
    }
    // ห่างจากราคาวันก่อนมาก → ต้องยืนยันด่านพิมพ์ผิด แล้วบันทึกได้ที่เพดานพอดี
    const saved = await put(cookies.manager, { bar_sell: "999,999.99", confirm_typo: true });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ date: DAY.cap, ...top, source: "central" });
  });

  // F11 — root cause: apps/api/src/services/goldPrice.ts:94-98 setCentralPrice อ่าน before ด้วย SELECT … FOR UPDATE
  // ซึ่งล็อกแถวที่ยังไม่มีไม่ได้ (ราคาแรกของวัน) → PUT สองตัวพร้อมกัน (กดบันทึกซ้ำ · สองคนตั้งพร้อมกัน) เห็น before = null
  // ทั้งคู่ ตัวที่สองจึงบันทึก "gold_price.create" + before: null (:112-118) ทั้งที่จริงเขียนทับราคาของตัวแรก
  // (R12 · ASVS V7.1.4) · แก้: ล็อกก่อนอ่าน เช่น pg_advisory_xact_lock(hashtext('gold_price:' || date))
  // ต้นทรานแซกชัน หรือ INSERT … ON CONFLICT DO NOTHING ก่อนแล้วค่อย SELECT … FOR UPDATE
  // เดิมเป็น it.fails — แก้ใน PR #89 (dev 7d8436e) · ตอนนี้ตรึงพฤติกรรมที่ถูกไว้
  it("F11 — PUT ราคาแรกของวันพร้อมกัน 2 ครั้ง: audit ต้องเป็น create 1 แถว + update 1 แถวที่ before = ราคาของครั้งแรก (R12)", async () => {
    onDay(DAY.race);
    const waitingOnLocks = async () => {
      const [row] = await t.db.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_stat_activity
              where datname = current_database() and backend_type = 'client backend' and wait_event_type = 'Lock'`,
      );
      return row?.n ?? 0;
    };
    const pending: Promise<Response>[] = [];
    try {
      // ถือแถวราคากลางของวันนั้นไว้ในทรานแซกชันที่ยังไม่ commit: PUT ทั้งสองอ่าน before ไม่เจอแล้วไปรอที่ unique index
      // → rollback ปล่อยให้แข่งกันจริง — ลำดับเหตุการณ์แน่นอนทุกครั้ง ไม่พึ่งจังหวะเครื่อง
      await t.db
        .transaction(async (tx) => {
          await tx.insert(goldPrice).values({ date: DAY.race, barSell: "1", barBuy: "1", jewelryBuy: "1" });
          for (const [who, barSell] of [
            ["manager", "67850"],
            ["admin", "67900"],
          ] as const) {
            pending.push(Promise.resolve(put(cookies[who], { bar_sell: barSell })));
          }
          await vi.waitFor(async () => expect(await waitingOnLocks()).toBe(2), { timeout: 5_000, interval: 10 });
          tx.rollback();
        })
        .catch((e: unknown) => {
          if (!(e instanceof TransactionRollbackError)) throw e;
        });
    } finally {
      await Promise.allSettled(pending); // ไม่ทิ้ง request ค้างไว้เบื้องหลังแม้ส่วนบนพัง
    }
    expect((await Promise.all(pending)).map((r) => r.status)).toEqual([200, 200]);
    const rows = await t.db
      .select()
      .from(goldPrice)
      .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, DAY.race)));
    expect(rows).toHaveLength(1);
    const audits = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.rowId, rows[0]?.id ?? ""))
      .orderBy(auditLog.id);
    expect(audits.map((a) => a.action)).toEqual(["gold_price.create", "gold_price.update"]);
    const [first, second] = audits.map((a) => a.diff as { before: unknown; after: unknown });
    expect(second?.before).toEqual(first?.after);
  });

  // F10 — แก้แล้วใน dev (PR #60 · fix(api): cap the gold bar price at 999,999.99): เดิม quote ตอบ 200 แต่ PUT ล้น
  // numeric(14,2) → 500 (preview กับ save ตัดสินต่างกัน · กฎ 2) · ตอนนี้ทั้งคู่ 400 ชี้ bar_sell ด้วยเหตุผลเดียวกัน
  it("F10 (แก้แล้ว) — bar_sell เกินที่คอลัมน์เงินเก็บได้ (1,000,000,000,000) → 400 ชี้ช่อง bar_sell ทั้ง quote และ PUT · ไม่ใช่ 200/500 · ไม่เขียนอะไร", async () => {
    onDay(DAY.guard);
    const before = await writes();
    // ตอนนี้ PUT เป็น 500 → app.onError พิมพ์ PostgresError — ปิดเสียงเฉพาะเทสต์นี้
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: Record<string, { status: number; field: string | null }> = {};
    try {
      for (const [method, path] of BODY_ROUTES) {
        // confirm_typo เป็นช่องของการบันทึก — POST /quote รับเฉพาะช่องของหน้าเว็บ (strict) จึงส่งเฉพาะกับ PUT
        const confirm = method === "PUT" ? { confirm_typo: true } : {};
        const body = JSON.stringify({ bar_sell: "1000000000000", ...confirm });
        seen[method] = await outcome(await raw(method, path, { cookie: cookies.manager, body }));
      }
    } finally {
      consoleError.mockRestore();
    }
    const rejected = { status: 400, field: "bar_sell" };
    expect(seen).toEqual({ POST: rejected, PUT: rejected });
    expect(await writes()).toEqual(before);
  });

  // F12 — root cause: apps/api/src/routes/goldPrice.ts:37 และ :54 เรียก c.req.json() โดยไม่ดู Content-Type → body
  // JSON ที่มาเป็น text/plain (ชนิดที่ฟอร์ม HTML ข้ามเว็บส่งได้โดยไม่มี preflight) ถูกรับเหมือน application/json
  // ด่าน Origin (lib/origin.ts) ยังกันข้ามเว็บอยู่ จึงเป็นชั้นป้องกันซ้อน (ASVS 4.0.3 V13.2.5 · V13.1.5 · RFC 9110 §15.5.16)
  // แก้: ตอบ 415 เมื่อ content-type ไม่ใช่ application/json — แบบเดียวกับ routes/customers.ts:38 ที่ตอบ 415 เมื่อไม่ใช่ multipart
  // เดิมเป็น it.fails — แก้ใน PR #89 (dev 7d8436e) · ตอนนี้ตรึงพฤติกรรมที่ถูกไว้
  it("F12 — POST /quote ที่ Content-Type ไม่ใช่ application/json (text/plain) → 415", async () => {
    const body = JSON.stringify({ bar_sell: "67850" });
    const res = await raw("POST", "/api/gold-price/quote", { cookie: cookies.staff, contentType: "text/plain", body });
    await expectApiError(res, 415, "quote text/plain");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ราคารับซื้อต่อกรัมของเงิน/แพลตตินั่ม (UAT 30 ก.ย. 2569 · อนุมัติ 2 ต.ค. 2569) — ฐานของสูตรรับซื้อเงิน/แพลตตินั่ม
// ตั้งที่ราคากลางเท่านั้น ทุกสาขาใช้ร่วม · PUT: ไม่ส่ง = คงค่าเดิมของวันนี้ · null หรือ "" = ล้าง · ข้อความตัวเลข = ตั้งใหม่
// ด่านพิมพ์ผิดเทียบวันก่อนหน้าล่าสุดที่มีค่า (ข้ามวันที่ไม่ได้ตั้ง) · หลายคำเตือนต่อด้วย " · " ใน 409 เดียว
// ฝั่งสาขา (GET /today/branches · PUT /today/branches/:id · quote ที่มี branch_id) อยู่ใน goldPriceBranch.test.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * วันทำการแยกตามเรื่อง — ด่านพิมพ์ผิดมองย้อนไปวันก่อนหน้าที่มีค่า จึงวางช่วงวันไม่ให้เรื่องหนึ่งเป็น "ครั้งก่อน" ของอีกเรื่อง
 * quote/life อยู่ต้นสุด (ไม่มีวันก่อนหน้าที่มีราคาต่อกรัม) · typo* อยู่ท้ายสุดและมีวันก่อนหน้าของตัวเองที่ใส่ตรงใน DB
 */
const PG = {
  quote: "2026-11-02", // quote อย่างเดียว ไม่เขียน
  life: "2026-11-03", // ตั้ง → คงไว้ → ล้าง
  guard: "2026-11-04", // request ที่ต้องถูกปฏิเสธ — ถ้าหลุดจะเขียนลงวันนี้
  cap: "2026-11-05", // เพดาน 99,999.99 — ค่าที่ผ่านเขียนลงวันนี้
  typoSet: "2026-11-20", // ครั้งก่อนที่มีราคาต่อกรัม: ทอง 67,900 · เงิน 45.00 · แพลตตินั่ม 1,000.00
  typoBlank: "2026-11-21", // วันถัดมาไม่ได้ตั้งราคาต่อกรัม (null) · ทอง 68,000 — ทองเทียบวันนี้ เงิน/แพลตตินั่มต้องข้ามไป typoSet
  typo: "2026-11-22",
} as const;
const PER_GRAM_MSG = {
  silverPositive: "ราคาเงินต่อกรัมต้องเป็นตัวเลขมากกว่า 0",
  silverHigh: "ราคาเงินต่อกรัมสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง",
  platinumPositive: "ราคาแพลตตินั่มต่อกรัมต้องเป็นตัวเลขมากกว่า 0",
  platinumHigh: "ราคาแพลตตินั่มต่อกรัมสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง",
  scale: "ราคาทศนิยมไม่เกิน 2 ตำแหน่ง",
} as const;
/** ตัวเลข JSON / ชนิดอื่นที่ไม่ใช่ string (zod) — routes/goldPrice.ts perGramError */
const notText = (field: string) => `ต้องส่ง ${field} เป็นข้อความตัวเลข หรือ null เพื่อล้าง`;
/**
 * คำเตือนคิดมือ (เกณฑ์ seed typo_guard_percent = 3 · ไม่ใช้เซิร์ฟเวอร์เป็นคำตอบ) — ราคาเต็มบาทพิมพ์ไม่มีทศนิยม มีสตางค์พิมพ์ 2 ตำแหน่ง
 * เงิน 45 → 50.50: |50.50 − 45| ÷ 45 × 100 = 12.22…% → "12.2"
 * เงิน 45 → 46.36: 1.36 ÷ 45 × 100 = 3.02…% → "3.0" (เกินเกณฑ์) · 46.35 และ 43.65 ห่าง 1.35 ÷ 45 = 3% พอดี → ไม่เตือน
 * แพลตตินั่ม 1,000 → 1,100: 100 ÷ 1,000 × 100 = 10% → "10.0"
 * ทอง 68,000 → 76,000: 8,000 ÷ 68,000 × 100 = 11.76…% → "11.8"
 */
const WARN = {
  silver: "ราคาเงินห่างจากครั้งก่อน 12.2% (45 → 50.50) — ตรวจสอบก่อนบันทึก",
  silverEdge: "ราคาเงินห่างจากครั้งก่อน 3.0% (45 → 46.36) — ตรวจสอบก่อนบันทึก",
  platinum: "ราคาแพลตตินั่มห่างจากครั้งก่อน 10.0% (1000 → 1100) — ตรวจสอบก่อนบันทึก",
  gold: "ราคาห่างจากครั้งก่อน 11.8% (68000 → 76000) — ตรวจสอบก่อนบันทึก",
} as const;
/** ราคาทองที่ derive แล้ว (diff 200 · รูปพรรณ × 0.95 ปัดครึ่งขึ้น) — คิดมือ */
const GOLD = {
  g67850: { bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268" }, // 67,650 × 0.95 = 64,267.50 → 64,268
  g67900: { bar_sell: "67900.00", bar_buy: "67700.00", jewelry_buy: "64315" }, // 67,700 × 0.95 = 64,315
  g68000: { bar_sell: "68000.00", bar_buy: "67800.00", jewelry_buy: "64410" }, // 67,800 × 0.95 = 64,410
  g76000: { bar_sell: "76000.00", bar_buy: "75800.00", jewelry_buy: "72010" }, // 75,800 × 0.95 = 72,010
} as const;

describe.skipIf(!available)(
  "ราคาต่อกรัมเงิน/แพลตตินั่ม: ตั้ง · คงไว้ · ล้าง · validation · ด่านพิมพ์ผิด · audit",
  () => {
    let t: TestApp;
    let clock = new Date(`${PG.quote}T03:00:00Z`);
    /** นาฬิกา = 10:00 น. เวลาไทยของวันนั้น */
    const onDay = (date: string) => {
      clock = new Date(`${date}T03:00:00Z`);
    };
    const cookies: Record<string, string> = {};
    const ids: Record<string, string> = {};
    const manager = () => {
      const id = ids.manager;
      if (!id) throw new Error("ไม่มี manager");
      return id;
    };

    beforeAll(async () => {
      t = await startTestApp({ now: () => clock });
      for (const [who, role] of [
        ["manager", "manager"],
        ["staff", "staff"],
      ] as const) {
        const email = `pg-${who}@ong.test`;
        const created = await t.createUser({ email, password: PW, role, branch: "00000" });
        // ข้อมูลสมมติ: ชื่อขึ้นต้น "ทดสอบ"
        await t.db
          .update(user)
          .set({ name: testName(who) })
          .where(eq(user.id, created.id));
        ids[who] = created.id;
        cookies[who] = await t.login(email, PW);
      }
      // ครั้งก่อนของด่านพิมพ์ผิด — ใส่ตรงใน DB (ไม่ผ่าน API จึงไม่ขึ้นกับลำดับเทสต์)
      await t.db.insert(goldPrice).values([
        {
          date: PG.typoSet,
          barSell: "67900",
          barBuy: "67700",
          jewelryBuy: "64315",
          silverPerG: "45.00",
          platinumPerG: "1000.00",
        },
        { date: PG.typoBlank, barSell: "68000", barBuy: "67800", jewelryBuy: "64410" },
      ]);
    });
    afterAll(async () => {
      await t?.close();
    });

    const put = (body: unknown, who = "manager") =>
      t.request("/api/gold-price/today", { method: "PUT", cookie: cookies[who], body });
    const quote = (body: unknown) => t.request("/api/gold-price/quote", { cookie: cookies.staff, body });
    /** status + JSON ที่เงินเป็น string ทั้งก้อน (กฎ 1) */
    const ok = async (res: Response, where: string): Promise<Record<string, unknown>> => {
      const text = await res.text();
      expect(res.status, `${where}: ${text.slice(0, 300)}`).toBe(200);
      const body = JSON.parse(text) as Record<string, unknown>;
      expectMoneyAsStrings(body, where);
      return body;
    };
    const today = async (where: string) =>
      ok(await t.request("/api/gold-price/today", { cookie: cookies.staff }), `GET /today ${where}`);
    const writes = async () => ({
      prices: await t.db.select().from(goldPrice).orderBy(goldPrice.id),
      audits: await t.db.select().from(auditLog).orderBy(auditLog.id),
    });
    const centralRow = async (date: string) => {
      const [row] = await t.db
        .select()
        .from(goldPrice)
        .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, date)));
      return row;
    };

    it('POST /quote: ราคาต่อกรัมที่ส่งมาตอบเป็นรูปมาตรฐาน 2 ตำแหน่ง · "" หรือ null = null · ไม่ส่ง = ไม่มีคีย์ · ไม่มีครั้งก่อน = ไม่เตือน · ไม่เขียนอะไร', async () => {
      onDay(PG.quote);
      const before = await writes();
      const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
        ["ไม่ส่งราคาต่อกรัม", {}, GOLD.g67850],
        ["เงิน 45.5", { silver_per_g: "45.5" }, { ...GOLD.g67850, silver_per_g: "45.50" }],
        [
          "แพลตตินั่มคั่นหลักพัน + ช่องว่างหัวท้าย",
          { platinum_per_g: " 1,050.5 " },
          { ...GOLD.g67850, platinum_per_g: "1050.50" },
        ],
        ['ล้างด้วย "" และ null', { silver_per_g: "", platinum_per_g: null }, { ...GOLD.g67850, ...NO_PER_GRAM }],
        [
          "ทั้งคู่เป็นเลขเต็ม",
          { silver_per_g: "45", platinum_per_g: "1000" },
          { ...GOLD.g67850, silver_per_g: "45.00", platinum_per_g: "1000.00" },
        ],
        [
          "branch_id: null = ราคากลาง",
          { branch_id: null, silver_per_g: "45.50" },
          { ...GOLD.g67850, silver_per_g: "45.50" },
        ],
      ];
      for (const [label, extra, expected] of cases) {
        // toEqual: ไม่มี warning (ไม่มีวันก่อนหน้าเลย) และไม่มีคีย์ราคาต่อกรัมที่ไม่ได้ส่งมา
        expect(await ok(await quote({ bar_sell: "67850", ...extra }), label), label).toEqual(expected);
      }
      expect(await writes()).toEqual(before);
    });

    it('PUT /today: ตั้ง → ไม่ส่ง = คงค่าเดิมของวันนี้ → null ล้าง → "" ล้าง → ตั้งใหม่ · GET /today ตามทุกขั้น · audit ก่อน/หลังเป็น string หรือ null (R12)', async () => {
      onDay(PG.life);
      const steps = [
        {
          label: "ตั้งครั้งแรก (create)",
          body: { bar_sell: "67850", silver_per_g: "45.5", platinum_per_g: "1,050" },
          gold: GOLD.g67850,
          silver: "45.50",
          platinum: "1050.00",
        },
        {
          label: "ไม่ส่งทั้งคู่ = คงค่าเดิม",
          body: { bar_sell: "67900" },
          gold: GOLD.g67900,
          silver: "45.50",
          platinum: "1050.00",
        },
        {
          label: "เงิน null = ล้าง · แพลตตินั่มไม่ส่ง = คงไว้",
          body: { bar_sell: "67900", silver_per_g: null },
          gold: GOLD.g67900,
          silver: null,
          platinum: "1050.00",
        },
        {
          label: 'แพลตตินั่ม "" = ล้าง · เงินไม่ส่ง = คง null',
          body: { bar_sell: "67900", platinum_per_g: "" },
          gold: GOLD.g67900,
          silver: null,
          platinum: null,
        },
        {
          label: "ตั้งใหม่หลังล้าง",
          body: { bar_sell: "67900", silver_per_g: "45", platinum_per_g: "1000.5" },
          gold: GOLD.g67900,
          silver: "45.00",
          platinum: "1000.50",
        },
        {
          label: 'ล้างทั้งคู่พร้อมกัน ("" และ null)',
          body: { bar_sell: "67900", silver_per_g: "", platinum_per_g: null },
          gold: GOLD.g67900,
          silver: null,
          platinum: null,
        },
      ];
      let previous: unknown = null;
      for (const [i, step] of steps.entries()) {
        const before = await writes();
        const expected = {
          date: PG.life,
          ...step.gold,
          silver_per_g: step.silver,
          platinum_per_g: step.platinum,
          diff: "200.00",
          source: "central",
        };
        expect(await ok(await put(step.body), `PUT ${step.label}`), step.label).toEqual(expected);
        expect(await today(step.label), step.label).toEqual(expected);
        expect(await centralRow(PG.life), step.label).toMatchObject({
          silverPerG: step.silver,
          platinumPerG: step.platinum,
        });

        const added = (await writes()).audits.slice(before.audits.length);
        expect(added, step.label).toMatchObject([
          { action: i === 0 ? "gold_price.create" : "gold_price.update", tableName: "gold_price", userId: manager() },
        ]);
        const after = {
          bar_sell: step.gold.bar_sell,
          bar_buy: step.gold.bar_buy,
          jewelry_buy: `${step.gold.jewelry_buy}.00`,
          silver_per_g: step.silver,
          platinum_per_g: step.platinum,
          set_by: manager(),
        };
        expect(added[0]?.diff, step.label).toEqual({
          date: PG.life,
          before: previous,
          after,
          typo_warning_confirmed: false,
        });
        expect(moneyShapeViolations(added[0]?.diff), step.label).toEqual([]);
        previous = after;
      }
    });

    it.each([
      ["silver_per_g", "0", PER_GRAM_MSG.silverPositive],
      ["silver_per_g", "0.00", PER_GRAM_MSG.silverPositive],
      ["silver_per_g", "-1", PER_GRAM_MSG.silverPositive],
      ["silver_per_g", "abc", PER_GRAM_MSG.silverPositive],
      ["silver_per_g", "4 5", PER_GRAM_MSG.silverPositive],
      ["silver_per_g", "45.555", PER_GRAM_MSG.scale],
      ["silver_per_g", "0.001", PER_GRAM_MSG.scale],
      ["silver_per_g", "100000", PER_GRAM_MSG.silverHigh],
      ["silver_per_g", "100,000.00", PER_GRAM_MSG.silverHigh],
      ["silver_per_g", "1103700123458", PER_GRAM_MSG.silverHigh], // เลขบัตรสมมติที่ Siam ID พิมพ์หลุดเข้าช่องราคา
      ["platinum_per_g", "0", PER_GRAM_MSG.platinumPositive],
      ["platinum_per_g", "-1050", PER_GRAM_MSG.platinumPositive],
      ["platinum_per_g", "abc", PER_GRAM_MSG.platinumPositive],
      ["platinum_per_g", "1050.505", PER_GRAM_MSG.scale],
      ["platinum_per_g", "100000", PER_GRAM_MSG.platinumHigh],
      ["platinum_per_g", "1103700123458", PER_GRAM_MSG.platinumHigh],
    ] as const)(
      "%s = %j → 400 ชี้ช่องนั้น ทั้ง quote และ PUT (แม้ยืนยันด่านพิมพ์ผิดแล้ว) · ไม่เขียนอะไร",
      async (field, value, error) => {
        onDay(PG.guard);
        const before = await writes();
        const body = { bar_sell: "67850", [field]: value };
        expect(await expectApiError(await quote(body), 400, `quote ${field}=${value}`)).toEqual({ error, field });
        const res = await put({ ...body, confirm_typo: true });
        expect(await expectApiError(res, 400, `PUT ${field}=${value}`)).toEqual({ error, field });
        expect(await writes()).toEqual(before);
      },
    );

    it.each(["silver_per_g", "platinum_per_g"] as const)(
      "%s ที่ไม่ใช่ string (ตัวเลข JSON · boolean · array · object) หรือยาวเกิน 32 ตัว → 400 ชี้ช่องนั้น ทั้ง quote และ PUT · ไม่เขียนอะไร (กฎ 1)",
      async (field) => {
        onDay(PG.guard);
        const before = await writes();
        const expected = { error: notText(field), field };
        for (const value of [45, 45.5, 0, true, ["45.50"], { value: "45.50" }, "1".repeat(33)]) {
          const body = { bar_sell: "67850", [field]: value };
          const where = `${field}=${JSON.stringify(value)}`;
          expect(await expectApiError(await quote(body), 400, `quote ${where}`)).toEqual(expected);
          const res = await put({ ...body, confirm_typo: true });
          expect(await expectApiError(res, 400, `PUT ${where}`)).toEqual(expected);
        }
        expect(await writes()).toEqual(before);
      },
    );

    it("หลายช่องผิดพร้อมกัน: ชี้ bar_sell ก่อน แล้วจึงเงิน แล้วจึงแพลตตินั่ม — ลำดับเดียวกันทั้ง quote และ PUT · ไม่เขียนอะไร", async () => {
      onDay(PG.guard);
      const before = await writes();
      const cases: [Record<string, unknown>, { error: string; field: string }][] = [
        [
          { bar_sell: "abc", silver_per_g: "abc" },
          { error: "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0", field: "bar_sell" },
        ],
        [{ bar_sell: 67850, silver_per_g: 45 }, PARSE_ERROR],
        [
          { bar_sell: "67850", silver_per_g: "0", platinum_per_g: "0" },
          { error: PER_GRAM_MSG.silverPositive, field: "silver_per_g" },
        ],
        [
          { bar_sell: "67850", silver_per_g: "45.50", platinum_per_g: "0" },
          { error: PER_GRAM_MSG.platinumPositive, field: "platinum_per_g" },
        ],
        [
          { bar_sell: "67850", silver_per_g: 45, platinum_per_g: 1000 },
          { error: notText("silver_per_g"), field: "silver_per_g" },
        ],
        [
          { bar_sell: "67850", silver_per_g: "45.50", platinum_per_g: 1000 },
          { error: notText("platinum_per_g"), field: "platinum_per_g" },
        ],
      ];
      for (const [body, expected] of cases) {
        const where = JSON.stringify(body);
        expect(await expectApiError(await quote(body), 400, `quote ${where}`)).toEqual(expected);
        const res = await put({ ...body, confirm_typo: true });
        expect(await expectApiError(res, 400, `PUT ${where}`)).toEqual(expected);
      }
      expect(await writes()).toEqual(before);
    });

    it("เพดานราคาต่อกรัม: 99,999.99 และ 0.01 ผ่านทั้ง quote และ PUT (100,000 ไม่ผ่าน — ดูเทสต์ validation) (boundary value)", async () => {
      onDay(PG.cap);
      for (const [input, normalised] of [
        ["99999.99", "99999.99"],
        ["99,999.99", "99999.99"],
        ["0.01", "0.01"],
      ] as const) {
        for (const field of ["silver_per_g", "platinum_per_g"] as const) {
          const body = await ok(await quote({ bar_sell: "67900", [field]: input }), `quote ${field}=${input}`);
          expect(body[field], `quote ${field}=${input}`).toBe(normalised);
        }
      }
      // วันก่อนหน้าอาจมีราคาต่อกรัม (ลำดับเทสต์) — ยืนยันด่านพิมพ์ผิดไว้ เทสต์นี้ตรวจเพดานเท่านั้น
      const res = await put({
        bar_sell: "67900",
        silver_per_g: "99,999.99",
        platinum_per_g: "99999.99",
        confirm_typo: true,
      });
      expect(await ok(res, "PUT เพดาน")).toMatchObject({
        date: PG.cap,
        silver_per_g: "99999.99",
        platinum_per_g: "99999.99",
      });
      expect(await centralRow(PG.cap)).toMatchObject({ silverPerG: "99999.99", platinumPerG: "99999.99" });
    });

    it("ด่านพิมพ์ผิดราคาต่อกรัม: เทียบวันก่อนหน้าล่าสุดที่มีค่า (ข้ามวันที่เป็น null) · quote = PUT · 409 ชี้ confirm_typo · เกณฑ์ 3% พอดีไม่เตือน · ล้างไม่เตือน · ไม่เขียนอะไร", async () => {
      onDay(PG.typo);
      const before = await writes();
      const reject = async (body: Record<string, unknown>, warning: string) => {
        const where = JSON.stringify(body);
        expect(await ok(await quote(body), `quote ${where}`), where).toMatchObject({ warning });
        expect(await expectApiError(await put(body), 409, `PUT ${where}`)).toEqual({
          error: warning,
          field: "confirm_typo",
          warning,
        });
      };

      // วันก่อน (typoBlank) ไม่มีราคาเงิน → ต้องเทียบ 45 ของ typoSet ไม่ใช่ "ไม่มีครั้งก่อน"
      expect(await ok(await quote({ bar_sell: "68000", silver_per_g: "50.50" }), "quote เงิน")).toEqual({
        ...GOLD.g68000,
        silver_per_g: "50.50",
        warning: WARN.silver,
      });
      await reject({ bar_sell: "68000", silver_per_g: "50.50" }, WARN.silver);
      expect(await ok(await quote({ bar_sell: "68000", platinum_per_g: "1100" }), "quote แพลตตินั่ม")).toEqual({
        ...GOLD.g68000,
        platinum_per_g: "1100.00",
        warning: WARN.platinum,
      });
      await reject({ bar_sell: "68000", platinum_per_g: "1100" }, WARN.platinum);

      // ขอบเกณฑ์: ห่าง 3% พอดี (ทั้งขึ้นและลง) ไม่เตือน · เกินไปนิดเดียวเตือน
      for (const [input, normalised, warning] of [
        ["46.35", "46.35", null],
        ["43.65", "43.65", null],
        ["46", "46.00", null],
        ["46.36", "46.36", WARN.silverEdge],
      ] as const) {
        const body = await ok(await quote({ bar_sell: "68000", silver_per_g: input }), `quote เงิน ${input}`);
        expect(body, input).toEqual({ ...GOLD.g68000, silver_per_g: normalised, ...(warning ? { warning } : {}) });
      }
      await reject({ bar_sell: "68000", silver_per_g: "46.36" }, WARN.silverEdge);

      // ล้างราคาไม่เทียบอะไร — ไม่เตือนแม้ครั้งก่อนมีค่า
      const cleared = await ok(
        await quote({ bar_sell: "68000", silver_per_g: null, platinum_per_g: "" }),
        "quote ล้าง",
      );
      expect(cleared).toEqual({ ...GOLD.g68000, ...NO_PER_GRAM });

      expect(await writes()).toEqual(before);
      expect((await t.request("/api/gold-price/today", { cookie: cookies.staff })).status).toBe(404);
    });

    it('หลายราคาห่างเกินเกณฑ์พร้อมกัน → 409 เดียว คำเตือนต่อด้วย " · " (ทอง · เงิน · แพลตตินั่ม) · ราคาที่อยู่ในเกณฑ์ไม่มีข้อความ · ไม่เขียนอะไร', async () => {
      onDay(PG.typo);
      const before = await writes();
      const cases: [Record<string, string>, string][] = [
        [
          { bar_sell: "76000", silver_per_g: "50.50", platinum_per_g: "1100" },
          `${WARN.gold} · ${WARN.silver} · ${WARN.platinum}`,
        ],
        [{ bar_sell: "76000", silver_per_g: "50.50" }, `${WARN.gold} · ${WARN.silver}`],
        [{ bar_sell: "76000", platinum_per_g: "1100" }, `${WARN.gold} · ${WARN.platinum}`],
        // ทองอยู่ในเกณฑ์ (68,000 = วันก่อน) → เริ่มที่เงิน ไม่มีตัวคั่นนำหน้า
        [{ bar_sell: "68000", silver_per_g: "50.50", platinum_per_g: "1100" }, `${WARN.silver} · ${WARN.platinum}`],
        // เงินอยู่ในเกณฑ์ (46 ห่าง 2.2%) → ทองอย่างเดียว ไม่มีตัวคั่นห้อยท้าย
        [{ bar_sell: "76000", silver_per_g: "46" }, WARN.gold],
      ];
      for (const [body, warning] of cases) {
        const where = JSON.stringify(body);
        expect((await ok(await quote(body), `quote ${where}`)).warning, where).toBe(warning);
        expect(await expectApiError(await put(body), 409, `PUT ${where}`)).toEqual({
          error: warning,
          field: "confirm_typo",
          warning,
        });
      }
      expect(await writes()).toEqual(before);
    });

    it("ยืนยันแล้ว (confirm_typo: true) → 200 บันทึกราคาต่อกรัม · GET /today ตรงกัน · audit create มีราคาต่อกรัมเป็น string + typo_warning_confirmed (R12)", async () => {
      onDay(PG.typo);
      const before = await writes();
      const res = await put({ bar_sell: "76000", silver_per_g: "50.50", platinum_per_g: "1100", confirm_typo: true });
      const expected = {
        date: PG.typo,
        ...GOLD.g76000,
        silver_per_g: "50.50",
        platinum_per_g: "1100.00",
        diff: "200.00",
        source: "central",
      };
      expect(await ok(res, "PUT ยืนยัน")).toEqual(expected);
      expect(await today("หลังยืนยัน")).toEqual(expected);

      const added = (await writes()).audits.slice(before.audits.length);
      expect(added).toMatchObject([{ action: "gold_price.create", tableName: "gold_price", userId: manager() }]);
      expect(added[0]?.diff).toEqual({
        date: PG.typo,
        before: null,
        after: {
          bar_sell: "76000.00",
          bar_buy: "75800.00",
          jewelry_buy: "72010.00",
          silver_per_g: "50.50",
          platinum_per_g: "1100.00",
          set_by: manager(),
        },
        typo_warning_confirmed: true,
      });
      expect(moneyShapeViolations(added[0]?.diff)).toEqual([]);
    });
  },
);
