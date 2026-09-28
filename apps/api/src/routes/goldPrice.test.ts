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
    for (const who of ["manager", "staff", "staff2"]) cookies[who] = await t.login(`${who}@ong.test`, PW);
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
  ])("quote ปฏิเสธ %j", async (body, error) => {
    const res = await quote(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error, field: "bar_sell" });
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
    expect(await rejected.json()).toMatchObject({ field: "bar_sell", warning: q.warning });
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
} as const;
/** role ที่ตั้งราคาได้ (spec §10) — role อื่นทุกตัว รวมถึง role ที่เพิ่มในอนาคต ต้องได้ 403 */
const PRICE_SETTERS: readonly Role[] = ["manager", "admin"];
const FORGED_COOKIE = "better-auth.session_token=forged.signature";
const PARSE_ERROR = { error: "ต้องส่ง bar_sell เป็นข้อความตัวเลข", field: "bar_sell" };
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
  diff: "200.00",
  source: "central",
};

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
    ["PUT", "/api/gold-price/today", { bar_sell: "67850", confirm_typo: true }],
  ] as const)("%s %s: ไม่มี cookie หรือ cookie ปลอม = 401 unauthorized · ไม่เขียนอะไร", async (method, path, body) => {
    onDay(DAY.guard);
    const before = await writes();
    for (const cookie of [undefined, FORGED_COOKIE]) {
      const res = await t.request(path, { method, cookie, body });
      const where = `${method} ${path} (${cookie ? "cookie ปลอม" : "ไม่มี cookie"})`;
      expect(await expectApiError(res, 401, where)).toEqual({ error: "unauthorized" });
    }
    expect(await writes()).toEqual(before);
  });

  it.each(ROLES.filter((role) => !PRICE_SETTERS.includes(role)))(
    "PUT /today โดย %s = 403 forbidden (ตัดสินก่อนดู body) · ไม่เขียนอะไร (spec §10 · API5)",
    async (who) => {
      onDay(DAY.roles);
      const before = await writes();
      for (const body of [{ bar_sell: "67850", confirm_typo: true }, {}]) {
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
        const body = JSON.stringify({ bar_sell: "67850", confirm_typo: true });
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
    const saved = { date: DAY.money, ...derived, diff: "200.00", source: "central" };
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

  it("PUT แนบช่องที่ไม่ได้เปิดให้ตั้ง (bar_buy · jewelry_buy · diff · date · branch_id · set_by · source · id) = ถูกตัดทิ้ง (API3 · ASVS V5.1.2)", async () => {
    onDay(DAY.massAssign);
    const before = await writes();
    const forgedId = "00000000-0000-4000-8000-000000000000";
    const res = await put(cookies.manager, {
      bar_sell: "67850",
      bar_buy: "1.00",
      jewelry_buy: "1",
      diff: "0",
      date: "2026-01-01",
      branch_id: bid("00001"),
      set_by: uid("admin"),
      source: "branch",
      id: forgedId,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      date: DAY.massAssign,
      bar_sell: "67850.00",
      bar_buy: "67650.00",
      jewelry_buy: "64268",
      diff: "200.00",
      source: "central",
    });
    const after = await writes();
    const added = after.prices.filter((p) => !before.prices.some((b) => b.id === p.id));
    expect(added).toMatchObject([
      {
        branchId: null,
        date: DAY.massAssign,
        barSell: "67850.00",
        barBuy: "67650.00",
        jewelryBuy: "64268.00",
        setBy: uid("manager"),
      },
    ]);
    expect(added[0]?.id).not.toBe(forgedId);
    expect(after.prices.filter((p) => p.id !== added[0]?.id)).toEqual(before.prices);
    expect(await t.db.select({ diff: goldPriceSetting.diff }).from(goldPriceSetting)).toEqual([{ diff: "200.00" }]);
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
      after: { bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268.00", set_by: uid("manager") },
      typo_warning_confirmed: false,
    });
    expect(moneyShapeViolations(added[0]?.diff)).toEqual([]);
  });

  // F3 — root cause: apps/api/src/routes/goldPrice.ts:31 ส่ง c.var.viewer.currentBranchId (ค่าดิบใน session) ให้
  // priceForBranch ตรง ๆ ไม่ผ่าน currentBranch(viewer, await forUser(db, viewer)) ตามที่ lib/scope.ts:39-42 กำหนด
  // ("สิทธิ์ถูกถอนระหว่าง session = null") → คนที่ถูกถอนสิทธิ์ / สาขาที่ปิดแล้วยังได้ราคาเฉพาะสาขา (API1 · ASVS V4.2.1)
  // แก้: const b = currentBranch(v, await forUser(db, v)) แล้ว priceForBranch(db, date, b?.id ?? null)
  it.fails(
    "F3 — ถูกถอนสิทธิ์สาขา 00001 ระหว่าง session หรือสาขา 00001 ถูกปิด: GET /today ต้องได้ราคากลาง ไม่ใช่ราคาเฉพาะสาขา 00001",
    async () => {
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
    },
  );

  // F5 — root cause: apps/api/src/routes/goldPrice.ts:54-55 ทุกความผิดของ SetBody ตอบ field "bar_sell"
  // (confirm_typo ผิดชนิดก็ชี้ bar_sell) · แก้: ใช้ path ของ issue แรกจาก zod (body.error.issues[0].path[0]) เป็น field
  it.fails(
    "F5 — PUT /today: confirm_typo ที่ไม่ใช่ boolean → 400 ชี้ช่อง confirm_typo (ไม่ใช่ bar_sell) · ไม่เขียนอะไร",
    async () => {
      onDay(DAY.guard);
      const before = await writes();
      const res = await put(cookies.manager, { bar_sell: "67850", confirm_typo: "yes" });
      expect((await expectApiError(res, 400, "PUT confirm_typo=yes")).field).toBe("confirm_typo");
      expect(await writes()).toEqual(before);
    },
  );

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

  // F11 — root cause: apps/api/src/services/goldPrice.ts:94-98 setCentralPrice อ่าน before ด้วย SELECT … FOR UPDATE
  // ซึ่งล็อกแถวที่ยังไม่มีไม่ได้ (ราคาแรกของวัน) → PUT สองตัวพร้อมกัน (กดบันทึกซ้ำ · สองคนตั้งพร้อมกัน) เห็น before = null
  // ทั้งคู่ ตัวที่สองจึงบันทึก "gold_price.create" + before: null (:112-118) ทั้งที่จริงเขียนทับราคาของตัวแรก
  // (R12 · ASVS V7.1.4) · แก้: ล็อกก่อนอ่าน เช่น pg_advisory_xact_lock(hashtext('gold_price:' || date))
  // ต้นทรานแซกชัน หรือ INSERT … ON CONFLICT DO NOTHING ก่อนแล้วค่อย SELECT … FOR UPDATE
  it.fails(
    "F11 — PUT ราคาแรกของวันพร้อมกัน 2 ครั้ง: audit ต้องเป็น create 1 แถว + update 1 แถวที่ before = ราคาของครั้งแรก (R12)",
    async () => {
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
    },
  );

  // F10 — root cause: apps/api/src/services/goldPrice.ts:38-44 quoteGoldPrice ไม่มีเพดานราคา แต่คอลัมน์เงินเป็น
  // numeric(14,2) (packages/db/src/schema.ts:21 · :154) เก็บได้ไม่ถึง 1,000,000,000,000 → quote ตอบ 200 แต่ PUT
  // โยน numeric field overflow → 500 (apps/api/src/app.ts:50-53) — preview กับ save ให้ผลต่างกัน (กฎ 2 · ASVS V5.1.4)
  // แก้: เพดานใน quoteGoldPrice (ไม่เกินที่คอลัมน์เก็บได้ หรือเพดานธุรกิจ) → GoldPriceInputError → 400 ชี้ช่อง bar_sell
  it.fails(
    "F10 — bar_sell เกินที่คอลัมน์เงินเก็บได้ (1,000,000,000,000) → 400 ชี้ช่อง bar_sell ทั้ง quote และ PUT · ไม่ใช่ 200/500 · ไม่เขียนอะไร",
    async () => {
      onDay(DAY.guard);
      const before = await writes();
      // ตอนนี้ PUT เป็น 500 → app.onError พิมพ์ PostgresError — ปิดเสียงเฉพาะเทสต์นี้
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const seen: Record<string, { status: number; field: string | null }> = {};
      try {
        for (const [method, path] of BODY_ROUTES) {
          const body = JSON.stringify({ bar_sell: "1000000000000", confirm_typo: true });
          seen[method] = await outcome(await raw(method, path, { cookie: cookies.manager, body }));
        }
      } finally {
        consoleError.mockRestore();
      }
      const rejected = { status: 400, field: "bar_sell" };
      expect(seen).toEqual({ POST: rejected, PUT: rejected });
      expect(await writes()).toEqual(before);
    },
  );

  // F12 — root cause: apps/api/src/routes/goldPrice.ts:37 และ :54 เรียก c.req.json() โดยไม่ดู Content-Type → body
  // JSON ที่มาเป็น text/plain (ชนิดที่ฟอร์ม HTML ข้ามเว็บส่งได้โดยไม่มี preflight) ถูกรับเหมือน application/json
  // ด่าน Origin (lib/origin.ts) ยังกันข้ามเว็บอยู่ จึงเป็นชั้นป้องกันซ้อน (ASVS 4.0.3 V13.2.5 · V13.1.5 · RFC 9110 §15.5.16)
  // แก้: ตอบ 415 เมื่อ content-type ไม่ใช่ application/json — แบบเดียวกับ routes/customers.ts:38 ที่ตอบ 415 เมื่อไม่ใช่ multipart
  it.fails("F12 — POST /quote ที่ Content-Type ไม่ใช่ application/json (text/plain) → 415", async () => {
    const body = JSON.stringify({ bar_sell: "67850" });
    const res = await raw("POST", "/api/gold-price/quote", { cookie: cookies.staff, contentType: "text/plain", body });
    await expectApiError(res, 415, "quote text/plain");
  });
});
