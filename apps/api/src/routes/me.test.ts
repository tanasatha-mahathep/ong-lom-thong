import { account, branch, session, user } from "@ong/db";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectApiError } from "../test/assertions";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import { expectNoNationalId } from "../test/pii";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

interface MeBody {
  role: string;
  branch: { id: string; code: string } | null;
  branches: { id: string; code: string }[];
  can_view_all: boolean;
}

describe.skipIf(!available)("auth + /api/me — สาขา fail-closed", () => {
  let t: TestApp;
  const codesOf = (b: MeBody) => b.branches.map((x) => x.code);

  beforeAll(async () => {
    t = await startTestApp();
    await t.createUser({ email: "staff@ong.test", password: PW, branch: "00000" });
    await t.createUser({ email: "multi@ong.test", password: PW, branch: "00000", allow: ["00001"] });
    await t.createUser({ email: "boss@ong.test", password: PW, role: "admin", viewAll: true });
    await t.createUser({ email: "nobranch@ong.test", password: PW });
    await t.createUser({ email: "off@ong.test", password: PW, branch: "00000", active: false });
  });
  afterAll(async () => {
    await t?.close();
  });

  const me = async (cookie: string) => {
    const res = await t.request("/api/me", { cookie });
    return { status: res.status, body: (await res.json()) as MeBody };
  };

  it("ไม่มี session = 401 ทั้ง /api/me และ endpoint อื่นใต้ /api", async () => {
    expect((await t.request("/api/me")).status).toBe(401);
    expect((await t.request("/api/gold-price/quote", { body: { bar_sell: "67850" } })).status).toBe(401);
  });

  it("ปิด sign-up สาธารณะ — สมัครเองไม่ได้", async () => {
    const res = await t.request("/api/auth/sign-up/email", {
      body: { email: "new@ong.test", password: PW, name: "new" },
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const rows = await t.db.select().from(user).where(eq(user.email, "new@ong.test"));
    expect(rows).toHaveLength(0);
  });

  it("รหัสผ่านผิด = 401 ไม่ได้ cookie", async () => {
    const res = await t.request("/api/auth/sign-in/email", {
      body: { email: "staff@ong.test", password: "wrong-password" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("login จาก origin อื่นถูกปฏิเสธ (CSRF)", async () => {
    const res = await t.request("/api/auth/sign-in/email", {
      body: { email: "staff@ong.test", password: PW },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });

  it("route ของเราเองก็ปฏิเสธ origin อื่นและ request ที่ไม่มี Origin (CSRF)", async () => {
    const cookie = await t.login("multi@ong.test", PW);
    const body = { branch_id: t.branches["00001"] };
    expect((await t.request("/api/me/branch", { cookie, body, origin: "https://evil.example" })).status).toBe(403);
    const noOrigin = await t.app.request("/api/me/branch", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(noOrigin.status).toBe(403);
    expect((await me(cookie)).body.branch?.code).toBe("00000");
  });

  it("บัญชีที่ถูกปิด login ไม่ได้", async () => {
    await expect(t.login("off@ong.test", PW)).rejects.toThrow(/login off@ong.test failed/);
  });

  it("staff เห็นแค่สาขาหลัก และเริ่มงานที่สาขานั้น", async () => {
    const { status, body } = await me(await t.login("staff@ong.test", PW));
    expect(status).toBe(200);
    expect(body.role).toBe("staff");
    expect(codesOf(body)).toEqual(["00000"]);
    expect(body.branch?.code).toBe("00000");
    expect(body.can_view_all).toBe(false);
  });

  it("สลับไปสาขาที่ไม่มีสิทธิ์ = 404 และสาขาปัจจุบันไม่เปลี่ยน", async () => {
    const cookie = await t.login("staff@ong.test", PW);
    const res = await t.request("/api/me/branch", { cookie, body: { branch_id: t.branches["00001"] } });
    expect(res.status).toBe(404);
    expect((await me(cookie)).body.branch?.code).toBe("00000");
  });

  it("สาขาที่ไม่มีอยู่จริงตอบเหมือนไม่มีสิทธิ์ (ไม่บอกใบ้)", async () => {
    const cookie = await t.login("staff@ong.test", PW);
    const res = await t.request("/api/me/branch", {
      cookie,
      body: { branch_id: "00000000-0000-4000-8000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("branch_id ผิดรูปแบบ = 400", async () => {
    const cookie = await t.login("staff@ong.test", PW);
    const res = await t.request("/api/me/branch", { cookie, body: { branch_id: "00001" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "branch_id ไม่ถูกต้อง", field: "branch_id" });
  });

  it("มีสิทธิ์สาขาเพิ่ม: เห็นสาขาหลัก + สาขาที่อนุญาต และสลับได้", async () => {
    const cookie = await t.login("multi@ong.test", PW);
    expect(codesOf((await me(cookie)).body)).toEqual(["00000", "00001"]);
    const res = await t.request("/api/me/branch", { cookie, body: { branch_id: t.branches["00001"] } });
    expect(res.status).toBe(200);
    expect((await me(cookie)).body.branch?.code).toBe("00001");
  });

  it("สลับสาขาได้เฉพาะ session ของตัวเอง — อีก session ยังอยู่สาขาเดิม", async () => {
    const a = await t.login("multi@ong.test", PW);
    const b = await t.login("multi@ong.test", PW);
    await t.request("/api/me/branch", { cookie: a, body: { branch_id: t.branches["00001"] } });
    expect((await me(b)).body.branch?.code).toBe("00000");
  });

  it("can_view_all เห็นทุกสาขาที่เปิดอยู่ · ไม่มีสาขาหลัก = ยังไม่มีสาขาปัจจุบัน", async () => {
    const { body } = await me(await t.login("boss@ong.test", PW));
    expect(codesOf(body)).toEqual(["00000", "00001", "00002"]);
    expect(body.branch).toBeNull();
    expect(body.can_view_all).toBe(true);
  });

  it("สาขาที่ปิดแล้วหายจากสิทธิ์ แม้ผู้ใช้ can_view_all", async () => {
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      const { body } = await me(await t.login("boss@ong.test", PW));
      expect(codesOf(body)).toEqual(["00000", "00001"]);
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
    }
  });

  it("ไม่มีสาขาเลย = รายการว่าง ไม่ใช่ทุกสาขา (fail-closed)", async () => {
    const { status, body } = await me(await t.login("nobranch@ong.test", PW));
    expect(status).toBe(200);
    expect(body.branches).toEqual([]);
    expect(body.branch).toBeNull();
  });

  it("ถอนสิทธิ์สาขาระหว่าง session: สาขาปัจจุบันกลายเป็น null ทันที", async () => {
    const cookie = await t.login("multi@ong.test", PW);
    await t.request("/api/me/branch", { cookie, body: { branch_id: t.branches["00001"] } });
    await t.db.update(user).set({ allowedBranchIds: [] }).where(eq(user.email, "multi@ong.test"));
    try {
      const { body } = await me(cookie);
      expect(codesOf(body)).toEqual(["00000"]);
      expect(body.branch).toBeNull();
    } finally {
      await t.db
        .update(user)
        .set({ allowedBranchIds: [t.branches["00001"] as string] })
        .where(eq(user.email, "multi@ong.test"));
    }
  });

  it("ปิดบัญชีระหว่างใช้งาน: session เดิมใช้ต่อไม่ได้ (401)", async () => {
    await t.createUser({ email: "leaving@ong.test", password: PW, branch: "00000" });
    const cookie = await t.login("leaving@ong.test", PW);
    expect((await me(cookie)).status).toBe(200);
    await t.db.update(user).set({ isActive: false }).where(eq(user.email, "leaving@ong.test"));
    expect((await t.request("/api/me", { cookie })).status).toBe(401);
  });

  it("client ตั้ง role/สาขาเองผ่าน update-user ไม่ได้", async () => {
    const cookie = await t.login("staff@ong.test", PW);
    await t.request("/api/auth/update-user", { cookie, body: { role: "admin", canViewAll: true } });
    const { body } = await me(cookie);
    expect(body.role).toBe("staff");
    expect(body.can_view_all).toBe(false);
  });

  it("gold-price quote ต้อง login และคำนวณด้วยฟังก์ชันเดียวกับตอนบันทึก", async () => {
    const cookie = await t.login("staff@ong.test", PW);
    const res = await t.request("/api/gold-price/quote", { cookie, body: { bar_sell: "67850" } });
    expect(await res.json()).toEqual({ bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268" });
  });
});

describe.skipIf(!available)("/api/me — สัญญา API: 401 · สาขาถูกปิด · validation · CSRF · API3:2023", () => {
  let t: TestApp;
  let multiId = "";
  let victimId = "";
  let expiringId = "";
  /** session ของ multi ที่เทสต์ "ต้องไม่เปลี่ยนสาขา" ใช้ร่วมกัน — ทุกเทสต์ที่ใช้ตรวจว่ายังอยู่ 00000 */
  let shared = "";
  const FORGED = "better-auth.session_token=forged.signature";
  /** อดีตที่แน่นอน — ไม่พึ่งนาฬิกาเครื่อง (better-auth เทียบวันหมดอายุกับนาฬิกาจริง) */
  const LONG_AGO = new Date("2000-01-01T00:00:00Z");
  const UNAUTHORIZED = { error: "unauthorized" };
  const NOT_FOUND = { error: "not found", field: "branch_id" };
  /** uuid v4 รูปถูกที่ไม่มีสาขาไหนใช้ */
  const GHOST = "00000000-0000-4000-8000-000000000000";

  beforeAll(async () => {
    t = await startTestApp();
    // ทุกคนมีสิทธิ์ 00001 เพิ่ม — คำขอสลับไป 00001 ที่ถูกปฏิเสธจึงถูกปฏิเสธเพราะตัวกันที่เทสต์อยู่ ไม่ใช่เพราะไม่มีสิทธิ์
    const create = async (email: string, home: string) =>
      (await t.createUser({ email, password: PW, branch: home, allow: ["00001"] })).id;
    multiId = await create("multi@ong.test", "00000");
    victimId = await create("victim@ong.test", "00002");
    expiringId = await create("expiring@ong.test", "00000");
    await t.createUser({ email: "boss@ong.test", password: PW, role: "admin", viewAll: true });
    shared = await t.login("multi@ong.test", PW);
  });
  afterAll(async () => {
    await t?.close();
  });

  const idOf = (code: string) => {
    const id = t.branches[code];
    if (!id) throw new Error(`ไม่มีสาขา ${code} ใน seed`);
    return id;
  };
  const appOrigin = () => new URL(t.env.BETTER_AUTH_URL).origin;
  const meOf = async (cookie: string) => {
    const res = await t.request("/api/me", { cookie });
    expect(res.status).toBe(200);
    return (await res.json()) as MeBody;
  };
  const currentCode = async (cookie: string) => (await meOf(cookie)).branch?.code ?? null;
  const switchTo = (cookie: string, branchId: unknown, origin?: string) =>
    t.request("/api/me/branch", { cookie, body: { branch_id: branchId }, origin });
  /** request ดิบ — body ไม่ใช่ JSON หรือไม่มี body เลย (harness ส่ง JSON เสมอ) */
  const rawSwitch = (headers: Record<string, string>, body?: string) =>
    t.app.request("/api/me/branch", {
      method: "POST",
      headers: { cookie: shared, origin: appOrigin(), ...headers },
      body,
    });
  const setBranchOpen = (code: string, isActive: boolean) =>
    t.db.update(branch).set({ isActive }).where(eq(branch.code, code));

  it("ไม่มี cookie: POST /api/me/branch = 401", async () => {
    const res = await t.request("/api/me/branch", { body: { branch_id: idOf("00001") } });
    expect(await expectApiError(res, 401, "POST ไม่มี cookie")).toEqual(UNAUTHORIZED);
  });

  it("cookie ปลอม (ลายเซ็นไม่ถูก) = 401 ทั้ง GET /api/me และ POST /api/me/branch", async () => {
    expect(await expectApiError(await t.request("/api/me", { cookie: FORGED }), 401, "GET cookie ปลอม")).toEqual(
      UNAUTHORIZED,
    );
    const post = await switchTo(FORGED, idOf("00001"));
    expect(await expectApiError(post, 401, "POST cookie ปลอม")).toEqual(UNAUTHORIZED);
  });

  it("session หมดอายุ = 401 ทั้ง GET และ POST · สาขาใน session ไม่ถูกเปลี่ยน", async () => {
    const forGet = await t.login("expiring@ong.test", PW);
    const forPost = await t.login("expiring@ong.test", PW);
    // ก่อนหมดอายุ cookie ทั้งสองใช้ได้จริง — 401 ข้างล่างจึงมาจากการหมดอายุเท่านั้น
    for (const cookie of [forGet, forPost]) expect(await currentCode(cookie)).toBe("00000");
    await t.db.update(session).set({ expiresAt: LONG_AGO }).where(eq(session.userId, expiringId));

    const get = await t.request("/api/me", { cookie: forGet });
    expect(await expectApiError(get, 401, "GET session หมดอายุ")).toEqual(UNAUTHORIZED);
    const post = await switchTo(forPost, idOf("00001"));
    expect(await expectApiError(post, 401, "POST session หมดอายุ")).toEqual(UNAUTHORIZED);
    const moved = await t.db
      .select()
      .from(session)
      .where(and(eq(session.userId, expiringId), eq(session.currentBranchId, idOf("00001"))));
    expect(moved).toEqual([]);
  });

  it("session ถูกเพิกถอนฝั่งเซิร์ฟเวอร์ (ลบแถว session) = 401 ทันที ทั้ง GET และ POST", async () => {
    const cookie = await t.login("expiring@ong.test", PW);
    expect(await currentCode(cookie)).toBe("00000");
    await t.db.delete(session).where(eq(session.userId, expiringId));
    const get = await t.request("/api/me", { cookie });
    expect(await expectApiError(get, 401, "GET session ถูกเพิกถอน")).toEqual(UNAUTHORIZED);
    const post = await switchTo(cookie, idOf("00001"));
    expect(await expectApiError(post, 401, "POST session ถูกเพิกถอน")).toEqual(UNAUTHORIZED);
  });

  it("สาขาที่มีสิทธิ์แต่ถูกปิด: สลับไม่ได้ 404 ตอบเหมือนสาขาที่ไม่มีอยู่จริงทุกไบต์ · สาขาปัจจุบันไม่เปลี่ยน", async () => {
    const cookie = await t.login("multi@ong.test", PW);
    const ghost = await switchTo(cookie, GHOST);
    const ghostText = await ghost.clone().text();
    expect(await expectApiError(ghost, 404, "สาขาที่ไม่มีอยู่จริง")).toEqual(NOT_FOUND);

    await setBranchOpen("00001", false);
    try {
      const closed = await switchTo(cookie, idOf("00001"));
      const closedText = await closed.clone().text();
      expect(await expectApiError(closed, 404, "สาขาที่มีสิทธิ์แต่ถูกปิด")).toEqual(NOT_FOUND);
      expect(closedText).toBe(ghostText);
      expect(await currentCode(cookie)).toBe("00000");
    } finally {
      await setBranchOpen("00001", true);
    }
    // เปิดคืนแล้วสลับได้ — 404 เมื่อครู่มาจากการปิดสาขาเท่านั้น
    expect((await switchTo(cookie, idOf("00001"))).status).toBe(200);
    expect(await currentCode(cookie)).toBe("00001");
  });

  it("can_view_all: สลับไปได้ทุกสาขาที่เปิด (200) · สาขาที่ถูกปิด = 404 แบบเดียวกัน และสาขาปัจจุบันไม่เปลี่ยน", async () => {
    const cookie = await t.login("boss@ong.test", PW);
    for (const code of ["00000", "00001", "00002"]) {
      const res = await switchTo(cookie, idOf(code));
      expect(res.status, code).toBe(200);
      expect(((await res.json()) as { branch: { code: string } }).branch.code).toBe(code);
      expect(await currentCode(cookie)).toBe(code);
    }
    await setBranchOpen("00001", false);
    try {
      const res = await switchTo(cookie, idOf("00001"));
      expect(await expectApiError(res, 404, "admin → สาขาที่ถูกปิด")).toEqual(NOT_FOUND);
      expect(await currentCode(cookie)).toBe("00002");
    } finally {
      await setBranchOpen("00001", true);
    }
  });

  it("สาขาปัจจุบันถูกปิดระหว่าง session: branch = null และสาขานั้นหายจากรายการ (fail-closed) · เปิดคืนแล้ว session เดิมกลับมาที่สาขาเดิม", async () => {
    const cookie = await t.login("multi@ong.test", PW);
    expect((await switchTo(cookie, idOf("00001"))).status).toBe(200);
    await setBranchOpen("00001", false);
    try {
      const body = await meOf(cookie);
      expect(body.branch).toBeNull();
      expect(body.branches.map((b) => b.code)).toEqual(["00000"]);
    } finally {
      await setBranchOpen("00001", true);
    }
    const body = await meOf(cookie);
    expect(body.branch?.code).toBe("00001");
    expect(body.branches.map((b) => b.code)).toEqual(["00000", "00001"]);
  });

  it.each<[string, () => Response | Promise<Response>]>([
    // ไม่มี body แต่ประกาศว่าเป็น JSON · text/plain อยู่ใน sweep "input ผิดรูป" ของ app.contract.test.ts (4xx ใดก็ได้ — ดู F12)
    ["ไม่มี body", () => rawSwitch({ "content-type": "application/json" })],
    ["JSON ไม่ครบ", () => rawSwitch({ "content-type": "application/json" }, '{"branch_id":')],
    ["branch_id เป็นตัวเลข", () => switchTo(shared, 123)],
    ["branch_id เป็น array ของ uuid ที่มีสิทธิ์", () => switchTo(shared, [idOf("00001")])],
    ["branch_id เป็น null", () => switchTo(shared, null)],
    ["ไม่มี branch_id", () => t.request("/api/me/branch", { cookie: shared, body: {} })],
  ])("validation: %s = 400 ชี้ field branch_id · สาขาไม่เปลี่ยน", async (label, send) => {
    const body = await expectApiError(await send(), 400, label);
    expect(body.field).toBe("branch_id");
    expect(await currentCode(shared)).toBe("00000");
  });

  it.each([
    ['"null" (iframe sandbox · file:)', "null"],
    ["scheme ต่าง", "https://localhost:8787"],
    ["port ต่าง", "http://localhost:8788"],
    ["ต่อท้ายชื่อโดเมน", "http://localhost:8787.evil.test"],
    ["ตัวพิมพ์ใหญ่ (browser ไม่ส่งแบบนี้)", "http://LOCALHOST:8787"],
    ["มี path ต่อท้าย", "http://localhost:8787/"],
    ["host อื่นในเครื่องเดียวกัน", "http://127.0.0.1:8787"],
  ])("CSRF: Origin %s — %s = 403 forbidden origin · สาขาไม่เปลี่ยน", async (_label, origin) => {
    expect(appOrigin()).toBe("http://localhost:8787");
    const res = await switchTo(shared, idOf("00001"), origin);
    expect(await expectApiError(res, 403, `Origin ${origin}`)).toEqual({ error: "forbidden origin" });
    expect(await currentCode(shared)).toBe("00000");
  });

  it("data minimisation (OWASP API3:2023): /api/me ส่งเฉพาะคีย์ตามสัญญา — ไม่มี session token · password hash · สิทธิ์ภายใน · เลขบัตร", async () => {
    const res = await t.request("/api/me", { cookie: shared });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Record<string, unknown> & {
      user: Record<string, unknown>;
      branch: Record<string, unknown> | null;
      branches: Record<string, unknown>[];
    };
    expect(Object.keys(body).sort()).toEqual(["branch", "branches", "can_view_all", "role", "user"]);
    expect(Object.keys(body.user).sort()).toEqual(["email", "id", "name"]);
    expect(body.user).toEqual({ id: multiId, name: "multi", email: "multi@ong.test" });
    expect(body.role).toBe("staff");
    expect(body.can_view_all).toBe(false);
    expect(body.branch).not.toBeNull();
    for (const b of [body.branch ?? {}, ...body.branches]) {
      expect(Object.keys(b).sort()).toEqual(["code", "id", "name"]);
    }

    // ค่าลับของผู้ใช้คนนี้ที่อยู่ใน DB ต้องไม่โผล่ใน response แม้แต่ส่วนเดียว
    const sessions = await t.db.select().from(session).where(eq(session.userId, multiId));
    const accounts = await t.db.select().from(account).where(eq(account.userId, multiId));
    const secrets = [
      ...sessions.flatMap((s) => [s.token, s.id]),
      ...accounts.flatMap((a) => (a.password ? [a.password] : [])),
    ];
    expect(secrets.length).toBeGreaterThanOrEqual(3); // อย่างน้อย token + id ของ session ที่ใช้อยู่ + password hash
    for (const secret of secrets) {
      expect(text.includes(secret), "response มีค่าลับจากตาราง session/account").toBe(false);
    }
    expectNoNationalId(text, "GET /api/me");
  });

  it("mass assignment (OWASP API3:2023): ฟิลด์เกินใน POST /api/me/branch ถูกเมิน — role/สิทธิ์ไม่เปลี่ยน · session ของผู้ใช้อื่นไม่ถูกแตะ", async () => {
    const attacker = await t.login("multi@ong.test", PW);
    const victim = await t.login("victim@ong.test", PW);
    const victimSessions = () =>
      t.db.select().from(session).where(eq(session.userId, victimId)).orderBy(asc(session.id));
    const victimBefore = await victimSessions();
    const [attackerBefore] = await t.db.select().from(user).where(eq(user.id, multiId));

    const res = await t.request("/api/me/branch", {
      cookie: attacker,
      body: {
        branch_id: idOf("00001"),
        role: "admin",
        can_view_all: true,
        canViewAll: true,
        allowed_branch_ids: Object.values(t.branches),
        user_id: victimId,
        userId: victimId,
        session_id: victimBefore[0]?.id,
        sessionId: victimBefore[0]?.id,
      },
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { branch: { code: string } };
    expect(Object.keys(out)).toEqual(["branch"]);
    expect(Object.keys(out.branch).sort()).toEqual(["code", "id", "name"]);
    expect(out.branch.code).toBe("00001");

    // ผู้โจมตี: สลับสาขาได้ตามสิทธิ์ แต่ role/สิทธิ์เดิมทุกอย่าง
    const mine = await meOf(attacker);
    expect(mine.role).toBe("staff");
    expect(mine.can_view_all).toBe(false);
    expect(mine.branches.map((b) => b.code)).toEqual(["00000", "00001"]);
    expect(mine.branch?.code).toBe("00001");
    const [attackerAfter] = await t.db.select().from(user).where(eq(user.id, multiId));
    expect(attackerAfter).toEqual(attackerBefore);

    // ผู้ใช้อื่น: แถว session ไม่เปลี่ยนแม้แต่ช่องเดียว · ยังทำงานที่สาขาหลักของตัวเอง
    expect(await victimSessions()).toEqual(victimBefore);
    expect(await currentCode(victim)).toBe("00002");
  });
});
