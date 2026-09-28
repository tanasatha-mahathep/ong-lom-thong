import { account, auditLog, branch, customer, goldPrice, metal, session, user } from "@ong/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminError } from "../services/adminCommon";
import { USER_MSG, updateUserAccount } from "../services/users";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import { openTransaction, waitForLockWait } from "../test/locks";

const available = await databaseAvailable();
const PW = "correct-horse-battery";
const EVIL = "https://evil.example";
const NO_UUID = "00000000-0000-4000-8000-000000000000";
// 10:00 น. 5 ต.ค. 2569 เวลาไทย
const NOW = new Date("2026-10-05T03:00:00Z");
const TODAY = "2026-10-05";
// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const ID_A = "1103700123458";
const GENERATED = /^[2-9A-HJ-NP-Za-km-z]{20}$/;

interface BranchRef {
  id: string;
  code: string;
  name: string;
}
interface UserJson {
  id: string;
  email: string;
  name: string;
  role: string;
  branch: BranchRef | null;
  allowed_branches: BranchRef[];
  can_view_all: boolean;
  is_active: boolean;
  created_at: string;
}
interface CreatedRes {
  user: UserJson;
  temporary_password: string | null;
}
interface MeBody {
  branch: { code: string } | null;
  branches: { code: string }[];
}

describe.skipIf(!available)("ผู้ดูแล: ผู้ใช้ — /api/admin/users", () => {
  let t: TestApp;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  /** รหัสผ่านทุกตัวที่เกิดในไฟล์นี้ — ต้องไม่โผล่ใน audit / GET */
  const secrets = new Set<string>([PW]);
  let customerId = "";
  let goldId = "";
  let keySeq = 0;

  beforeAll(async () => {
    t = await startTestApp({ now: () => NOW });
    const accounts = [
      { who: "admin", role: "admin" as const, branch: "00000" },
      { who: "staff", branch: "00000" },
      { who: "manager", role: "manager" as const, branch: "00000", viewAll: true },
      { who: "acct", role: "accounting" as const, branch: "00000" },
    ];
    for (const a of accounts) {
      const created = await t.createUser({ email: `${a.who}@ong.test`, password: PW, ...a });
      ids[a.who] = created.id;
      cookies[a.who] = await t.login(`${a.who}@ong.test`, PW);
    }
    await t.db.insert(goldPrice).values({ date: TODAY, barSell: "67850", barBuy: "67650", jewelryBuy: "64268" });
    // สาขาที่ไม่มีรหัสสรรพากรเปิดบิลไม่ได้ — ตั้งให้ 00001 ที่เทสต์ขอบเขตสาขาใช้เปิดบิล
    await t.db.update(branch).set({ taxBranchCode: "00001" }).where(eq(branch.code, "00001"));
    const [c] = await t.db
      .insert(customer)
      .values({ nationalId: ID_A, nameTh: "นายทดสอบ ขอบเขตสาขา", cardExpireText: "31/12/2574" })
      .returning({ id: customer.id });
    customerId = c?.id ?? "";
    const [g] = await t.db.select().from(metal).where(eq(metal.code, "gold"));
    goldId = g?.id ?? "";
  });
  afterAll(async () => {
    await t?.close();
  });

  const post = async (body: unknown, who = "admin", origin?: string) =>
    t.request("/api/admin/users", { cookie: cookies[who], body, origin });
  const put = async (id: string, body: unknown, who = "admin", origin?: string) =>
    t.request(`/api/admin/users/${id}`, { method: "PUT", cookie: cookies[who], body, origin });
  const reset = async (id: string, body?: unknown, who = "admin", origin?: string) =>
    t.request(`/api/admin/users/${id}/reset-password`, { method: "POST", cookie: cookies[who], body, origin });
  const list = async (qs = "") => {
    const res = await t.request(`/api/admin/users${qs ? `?${qs}` : ""}`, { cookie: cookies.admin });
    expect(res.status).toBe(200);
    return ((await res.json()) as { items: UserJson[] }).items;
  };
  const signIn = async (email: string, password: string) =>
    (await t.request("/api/auth/sign-in/email", { body: { email, password } })).status;
  const me = async (cookie: string | undefined) => t.request("/api/me", { cookie });
  const userAudits = () => t.db.select().from(auditLog).where(eq(auditLog.tableName, "user"));
  const userCount = async () => (await t.db.select({ id: user.id }).from(user)).length;
  const created = async (body: Record<string, unknown>) => {
    const res = await post(body);
    expect(res.status).toBe(201);
    const out = (await res.json()) as CreatedRes;
    if (out.temporary_password) secrets.add(out.temporary_password);
    return out;
  };
  const bill = () => ({
    customer_id: customerId,
    lines: [{ metal_id: goldId, weight_g: "5.860", amount: "20030" }],
    payments: [{ method: "cash", amount: "20030" }],
    idempotency_key: `admin-scope-${String(++keySeq).padStart(8, "0")}`,
  });

  // ---------- สิทธิ์ ----------

  it("ไม่มี session = 401 ทุก endpoint", async () => {
    const target = ids.staff ?? "";
    expect((await t.request("/api/admin/users")).status).toBe(401);
    expect(
      (await t.request("/api/admin/users", { body: { email: "x@ong.test", name: "x", role: "staff" } })).status,
    ).toBe(401);
    expect((await t.request(`/api/admin/users/${target}`, { method: "PUT", body: { role: "admin" } })).status).toBe(
      401,
    );
    expect((await t.request(`/api/admin/users/${target}/reset-password`, { method: "POST" })).status).toBe(401);
    expect(await userCount()).toBe(4);
    expect(await signIn("staff@ong.test", PW)).toBe(200);
  });

  it.each(["staff", "manager", "acct"])("%s (ไม่ใช่ admin) = 403 ทุก endpoint · ไม่มีอะไรเปลี่ยน", async (who) => {
    const target = ids.staff ?? "";
    const responses = [
      await t.request("/api/admin/users", { cookie: cookies[who] }),
      await post({ email: `sneak-${who}@ong.test`, name: "แอบสร้าง", role: "admin" }, who),
      await put(target, { role: "admin", can_view_all: true }, who),
      await reset(target, { password: "attacker-password-1" }, who),
    ];
    for (const res of responses) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(await userCount()).toBe(4);
    expect(await userAudits()).toHaveLength(0);
    const [staff] = await t.db.select().from(user).where(eq(user.id, target));
    expect(staff).toMatchObject({ role: "staff", canViewAll: false });
    expect(await signIn("staff@ong.test", "attacker-password-1")).toBe(401);
  });

  it("CSRF: origin อื่นเขียนไม่ได้ (403) · GET ไม่เปิด CORS", async () => {
    const target = ids.staff ?? "";
    for (const res of [
      await post({ email: "csrf@ong.test", name: "x", role: "admin" }, "admin", EVIL),
      await put(target, { role: "admin" }, "admin", EVIL),
      await reset(target, { password: "attacker-password-1" }, "admin", EVIL),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden origin" });
    }
    const noOrigin = await t.app.request(`/api/admin/users/${target}/reset-password`, {
      method: "POST",
      headers: { cookie: cookies.admin ?? "" },
    });
    expect(noOrigin.status).toBe(403);
    expect(await userCount()).toBe(4);
    expect(await userAudits()).toHaveLength(0);
    expect(await signIn("staff@ong.test", PW)).toBe(200);
    const read = await t.request("/api/admin/users", { cookie: cookies.admin, origin: EVIL });
    expect(read.headers.get("access-control-allow-origin")).toBeNull();
  });

  // ---------- สร้าง ----------

  it("สร้างด้วยรหัสผ่านที่ผู้ดูแลตั้ง → 201 · ไม่ส่งรหัสผ่านกลับ · login ได้ · audit ไม่มีรหัสผ่าน/hash", async () => {
    const password = "Somchai-Pass-2569";
    secrets.add(password);
    const res = await post({
      email: " Somchai@ONG.test ",
      name: " สมชาย ใจดี ",
      role: "staff",
      branch_id: t.branches["00000"],
      allowed_branch_ids: [t.branches["00002"], t.branches["00001"], t.branches["00002"]],
      password,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as CreatedRes;
    expect(body).toEqual({
      user: {
        id: expect.any(String) as unknown,
        email: "somchai@ong.test",
        name: "สมชาย ใจดี",
        role: "staff",
        branch: { id: t.branches["00000"], code: "00000", name: "สำนักงานใหญ่ (สาขา 1)" },
        // เรียงตามหน้าจัดการสาขา · id ซ้ำถูกตัด
        allowed_branches: [
          { id: t.branches["00001"], code: "00001", name: "สาขา 2" },
          { id: t.branches["00002"], code: "00002", name: "สาขา 3" },
        ],
        can_view_all: false,
        is_active: true,
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      },
      temporary_password: null,
    });
    ids.somchai = body.user.id;
    expect(JSON.stringify(body)).not.toContain(password);

    const cookie = await t.login("somchai@ong.test", password);
    const mine = (await (await me(cookie)).json()) as MeBody;
    expect(mine.branch?.code).toBe("00000");
    expect(mine.branches.map((b) => b.code)).toEqual(["00000", "00001", "00002"]);

    const [row] = await userAudits();
    expect(row).toMatchObject({ action: "user.create", userId: ids.admin, rowId: ids.somchai });
    expect(row?.diff).toEqual({
      after: {
        email: "somchai@ong.test",
        name: "สมชาย ใจดี",
        role: "staff",
        branch_id: t.branches["00000"],
        allowed_branch_ids: [t.branches["00002"], t.branches["00001"]],
        can_view_all: false,
        is_active: true,
      },
      credential: "provided",
      via: "api",
    });
  });

  it("ไม่ส่งรหัสผ่าน → สุ่ม 20 ตัว (ไม่มีตัวที่อ่านสับสน) คืนครั้งเดียว · login ได้ · ไม่โผล่ใน GET/audit", async () => {
    const body = await created({ email: "manee@ong.test", name: "มานี มีสุข", role: "manager", branch_id: null });
    expect(body.temporary_password).toMatch(GENERATED);
    expect(body.user).toMatchObject({ role: "manager", branch: null, allowed_branches: [] });
    ids.manee = body.user.id;
    expect(await signIn("manee@ong.test", body.temporary_password ?? "")).toBe(200);

    const listed = await t.request("/api/admin/users", { cookie: cookies.admin });
    expect(await listed.text()).not.toContain(body.temporary_password);
    const [audit] = (await userAudits()).filter((a) => a.rowId === ids.manee);
    expect(audit?.diff).toMatchObject({ credential: "generated", via: "api" });
    expect(JSON.stringify(audit?.diff)).not.toContain(body.temporary_password);
  });

  it("อีเมลซ้ำ (ไม่สนตัวพิมพ์) = 409 · ไม่สร้าง ไม่ลง audit", async () => {
    const before = (await userAudits()).length;
    const res = await post({ email: "SOMCHAI@ong.test", name: "ซ้ำ", role: "staff" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: USER_MSG.emailTaken, field: "email" });
    expect((await userAudits()).length).toBe(before);
    expect(await userCount()).toBe(6);
  });

  it.each([
    [{ name: "x", role: "staff" }, "email", USER_MSG.emailRequired],
    [{ email: "not-an-email", name: "x", role: "staff" }, "email", USER_MSG.email],
    [{ email: "x@ong.test", role: "staff" }, "name", USER_MSG.name],
    [{ email: "x@ong.test", name: "  ", role: "staff" }, "name", USER_MSG.name],
    [{ email: "x@ong.test", name: "x" }, "role", USER_MSG.role],
    [{ email: "x@ong.test", name: "x", role: "owner" }, "role", USER_MSG.role],
    [{ email: "x@ong.test", name: "x", role: "staff", branch_id: "00001" }, "branch_id", USER_MSG.branchId],
    [
      { email: "x@ong.test", name: "x", role: "staff", allowed_branch_ids: ["00001"] },
      "allowed_branch_ids.0",
      USER_MSG.allowedIds,
    ],
    [
      { email: "x@ong.test", name: "x", role: "staff", allowed_branch_ids: "00001" },
      "allowed_branch_ids",
      USER_MSG.allowedIds,
    ],
    [
      { email: "x@ong.test", name: "x", role: "staff", can_view_all: "yes" },
      "can_view_all",
      USER_MSG.flag("can_view_all"),
    ],
    [{ email: "x@ong.test", name: "x", role: "staff", password: "short-pw" }, "password", USER_MSG.passwordShort],
    [{ email: "x@ong.test", name: "x", role: "staff", password: "x".repeat(129) }, "password", USER_MSG.passwordLong],
    [{ email: "x@ong.test", name: "x", role: "staff", password: 1234567890 }, "password", USER_MSG.passwordType],
  ])("สร้าง: %j → 400 ชี้ %s", async (body, field, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error, field });
  });

  it("สาขาต้องมีอยู่และเปิดอยู่ — ไม่งั้น 400 ชี้ช่อง", async () => {
    const closed = t.branches["00002"] ?? "";
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.id, closed));
    try {
      const unknown = await post({ email: "x@ong.test", name: "x", role: "staff", branch_id: NO_UUID });
      expect(await unknown.json()).toEqual({ error: USER_MSG.branchMissing, field: "branch_id" });
      const main = await post({ email: "x@ong.test", name: "x", role: "staff", branch_id: closed });
      expect(main.status).toBe(400);
      expect(await main.json()).toEqual({ error: USER_MSG.branchClosed("00002 สาขา 3"), field: "branch_id" });
      const extra = await post({
        email: "x@ong.test",
        name: "x",
        role: "staff",
        allowed_branch_ids: [t.branches["00001"], closed],
      });
      expect(await extra.json()).toEqual({
        error: USER_MSG.branchClosed("00002 สาขา 3"),
        field: "allowed_branch_ids.1",
      });
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.id, closed));
    }
    expect(await userCount()).toBe(6);
  });

  it("ช่องที่ไม่รู้จัก (เช่น camelCase) = 400 ทั้งสร้าง/แก้/รีเซ็ต · ไม่มีอะไรเปลี่ยน", async () => {
    const target = ids.staff ?? "";
    const edited = await put(target, { canViewAll: true });
    expect(edited.status).toBe(400);
    expect(await edited.json()).toEqual({ error: "ไม่รู้จักช่อง canViewAll", field: "canViewAll" });
    const added = await post({ email: "x@ong.test", name: "x", role: "staff", is_active: false });
    expect(added.status).toBe(400);
    expect(await added.json()).toEqual({ error: "ไม่รู้จักช่อง is_active", field: "is_active" });
    const reset1 = await reset(target, { newPassword: "Staff-New-Pass-01" });
    expect(reset1.status).toBe(400);
    expect(await reset1.json()).toEqual({ error: "ไม่รู้จักช่อง newPassword", field: "newPassword" });
    const [row] = await t.db.select().from(user).where(eq(user.id, target));
    expect(row?.canViewAll).toBe(false);
    expect(await userCount()).toBe(6);
    expect(await signIn("staff@ong.test", PW)).toBe(200);
  });

  // ---------- รายการ ----------

  it("รายการผู้ใช้: ไม่มีรหัสผ่าน/hash · ไม่ cache", async () => {
    const res = await t.request("/api/admin/users", { cookie: cookies.admin });
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    for (const secret of secrets) expect(text).not.toContain(secret);
    for (const a of await t.db.select().from(account)) expect(text).not.toContain(a.password ?? "never");
    const items = (JSON.parse(text) as { items: UserJson[] }).items;
    expect(items).toHaveLength(6);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(
      ["allowed_branches", "branch", "can_view_all", "created_at", "email", "id", "is_active", "name", "role"].sort(),
    );
  });

  it("ค้น/กรอง: q (อีเมล/ชื่อ) · role · active · branch_id (สาขาหลักหรือที่อนุญาต)", async () => {
    const emails = (items: UserJson[]) => items.map((u) => u.email).sort();
    expect(emails(await list("q=SOMCHAI"))).toEqual(["somchai@ong.test"]);
    expect(emails(await list(`q=${encodeURIComponent("มานี")}`))).toEqual(["manee@ong.test"]);
    expect(emails(await list("q=100%25"))).toEqual([]);
    expect(emails(await list("role=manager"))).toEqual(["manager@ong.test", "manee@ong.test"]);
    expect(emails(await list(`branch_id=${t.branches["00001"]}`))).toEqual(["somchai@ong.test"]);
    expect(emails(await list(`branch_id=${t.branches["00000"]}`))).toEqual([
      "acct@ong.test",
      "admin@ong.test",
      "manager@ong.test",
      "somchai@ong.test",
      "staff@ong.test",
    ]);
    expect(await list("active=false")).toEqual([]);
    expect(await list("role=&active=&q=")).toHaveLength(6);
    for (const [qs, field] of [
      ["role=owner", "role"],
      ["active=yes", "active"],
      ["branch_id=00001", "branch_id"],
    ]) {
      const res = await t.request(`/api/admin/users?${qs}`, { cookie: cookies.admin });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { field: string }).field).toBe(field);
    }
  });

  // ---------- แก้ ----------

  it("แก้ role/สาขา/ชื่อ → 200 · audit เฉพาะช่องที่เปลี่ยน (before/after)", async () => {
    const res = await put(ids.manee ?? "", {
      name: "มานี มีสุข (หัวหน้า)",
      branch_id: t.branches["00001"],
      allowed_branch_ids: [t.branches["00000"]],
      can_view_all: false,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: UserJson; sessions_revoked: number };
    expect(body.sessions_revoked).toBe(0);
    expect(body.user).toMatchObject({
      name: "มานี มีสุข (หัวหน้า)",
      role: "manager",
      branch: { code: "00001" },
      allowed_branches: [{ code: "00000" }],
    });
    const [row] = (await userAudits()).filter((a) => a.action === "user.update" && a.rowId === ids.manee);
    expect(row?.userId).toBe(ids.admin);
    expect(row?.diff).toEqual({
      name: { before: "มานี มีสุข", after: "มานี มีสุข (หัวหน้า)" },
      branch_id: { before: null, after: t.branches["00001"] },
      allowed_branch_ids: { before: [], after: [t.branches["00000"]] },
    });
  });

  it("อีเมลแก้ไม่ได้ · รหัสผ่านไม่รับทาง PUT · ไม่มี/ id ผิดรูป = 404 · ไม่เปลี่ยนอะไร = ไม่ลง audit", async () => {
    const id = ids.manee ?? "";
    const email = await put(id, { email: "other@ong.test", name: "x" });
    expect(email.status).toBe(400);
    expect(await email.json()).toEqual({ error: USER_MSG.emailImmutable, field: "email" });
    const pw = await put(id, { password: "new-password-123" });
    expect(await pw.json()).toEqual({ error: USER_MSG.passwordElsewhere, field: "password" });
    expect((await put("no-such-user", { name: "x" })).status).toBe(404);
    expect((await put("../../etc", { name: "x" })).status).toBe(404);
    expect((await put(id, { role: "owner" })).status).toBe(400);

    const before = (await userAudits()).length;
    const same = await put(id, { email: "MANEE@ong.test", name: "มานี มีสุข (หัวหน้า)", role: "manager" });
    expect(same.status).toBe(200);
    expect((await userAudits()).length).toBe(before);
    expect(await signIn("manee@ong.test", "new-password-123")).toBe(401);
  });

  it("สาขาที่ผูกไว้แล้วถูกปิดทีหลัง คงไว้ได้ · ผูกสาขาที่ปิดเพิ่มใหม่ = 400", async () => {
    const id = ids.somchai ?? "";
    const closed = t.branches["00002"] ?? "";
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.id, closed));
    try {
      // ฟอร์มส่งค่าเดิมทั้งก้อน (มี 00002 ที่ถูกปิดไปแล้ว) + เปลี่ยนชื่อ
      const keep = await put(id, {
        name: "สมชาย ใจดี",
        branch_id: t.branches["00000"],
        allowed_branch_ids: [t.branches["00002"], t.branches["00001"]],
      });
      expect(keep.status).toBe(200);
      const add = await put(ids.manee ?? "", { allowed_branch_ids: [t.branches["00000"], closed] });
      expect(add.status).toBe(400);
      expect(await add.json()).toEqual({ error: USER_MSG.branchClosed("00002 สาขา 3"), field: "allowed_branch_ids.1" });
      const move = await put(ids.manee ?? "", { branch_id: closed });
      expect(await move.json()).toEqual({ error: USER_MSG.branchClosed("00002 สาขา 3"), field: "branch_id" });
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.id, closed));
    }
  });

  // ---------- session ถูกเพิกถอน ----------

  it("ปิดบัญชี → ทุก session ถูกลบทันที (cookie เก่า 401 แม้เปิดบัญชีคืน) · login ใหม่ได้หลังเปิดคืน", async () => {
    const id = ids.somchai ?? "";
    const pw = "Somchai-Pass-2569";
    const a = await t.login("somchai@ong.test", pw);
    const b = await t.login("somchai@ong.test", pw);
    expect((await me(a)).status).toBe(200);
    const sessionsBefore = await t.db.select().from(session).where(eq(session.userId, id));

    const off = await put(id, { is_active: false });
    expect(off.status).toBe(200);
    const body = (await off.json()) as { user: UserJson; sessions_revoked: number };
    expect(body.user.is_active).toBe(false);
    expect(body.sessions_revoked).toBe(sessionsBefore.length);
    expect(await t.db.select().from(session).where(eq(session.userId, id))).toHaveLength(0);
    expect((await me(a)).status).toBe(401);
    expect((await me(b)).status).toBe(401);
    expect(await signIn("somchai@ong.test", pw)).toBe(401);

    const on = await put(id, { is_active: true });
    expect(((await on.json()) as { sessions_revoked: number }).sessions_revoked).toBe(0);
    expect((await me(a)).status).toBe(401);
    expect((await me(await t.login("somchai@ong.test", pw))).status).toBe(200);

    const rows = (await userAudits()).filter((r) => r.action === "user.update" && r.rowId === id);
    expect(rows.map((r) => r.diff)).toContainEqual({
      is_active: { before: true, after: false },
      sessions_revoked: sessionsBefore.length,
    });
  });

  it("รีเซ็ตรหัสผ่าน (สุ่ม) → คืนครั้งเดียว · ลบทุก session · รหัสเก่าใช้ไม่ได้ · audit ไม่มีรหัส/hash", async () => {
    const id = ids.somchai ?? "";
    const old = "Somchai-Pass-2569";
    const cookie = await t.login("somchai@ong.test", old);
    const sessions = (await t.db.select().from(session).where(eq(session.userId, id))).length;

    const res = await reset(id);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { temporary_password: string | null; sessions_revoked: number };
    expect(body.temporary_password).toMatch(GENERATED);
    expect(body.sessions_revoked).toBe(sessions);
    secrets.add(body.temporary_password ?? "");

    expect((await me(cookie)).status).toBe(401);
    expect(await signIn("somchai@ong.test", old)).toBe(401);
    expect(await signIn("somchai@ong.test", body.temporary_password ?? "")).toBe(200);

    const [row] = (await userAudits()).filter((r) => r.action === "user.reset_password" && r.rowId === id);
    expect(row).toMatchObject({ userId: ids.admin, tableName: "user" });
    expect(row?.diff).toEqual({ credential: "generated", sessions_revoked: sessions, via: "api" });
  });

  it("รีเซ็ตด้วยรหัสที่ผู้ดูแลตั้ง → ไม่ส่งกลับ · login ได้ · สั้นไป 400 · ไม่มีผู้ใช้ 404", async () => {
    const id = ids.manee ?? "";
    const password = "Manee-New-Pass-01";
    secrets.add(password);
    // sign-in ในเทสต์ก่อนหน้าสร้าง session ไว้แล้ว — นับจาก DB
    const sessions = (await t.db.select().from(session).where(eq(session.userId, id))).length;
    expect(sessions).toBeGreaterThan(0);
    const res = await reset(id, { password });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ temporary_password: null, sessions_revoked: sessions });
    expect(await signIn("manee@ong.test", password)).toBe(200);

    const short = await reset(id, { password: "short" });
    expect(short.status).toBe(400);
    expect(await short.json()).toEqual({ error: USER_MSG.passwordShort, field: "password" });
    expect((await reset("no-such-user")).status).toBe(404);
    expect((await reset(id, "not json")).status).toBe(400);
    expect(await signIn("manee@ong.test", password)).toBe(200);
  });

  // ---------- กันผู้ดูแลล็อกตัวเองออก ----------

  it("ลดสิทธิ์/ปิดบัญชีตัวเองไม่ได้ (409) · แก้ชื่อตัวเองได้", async () => {
    const id = ids.admin ?? "";
    const before = (await userAudits()).length;
    const demote = await put(id, { role: "manager" });
    expect(demote.status).toBe(409);
    expect(await demote.json()).toEqual({ error: USER_MSG.selfDemote, field: "role" });
    const off = await put(id, { is_active: false });
    expect(off.status).toBe(409);
    expect(await off.json()).toEqual({ error: USER_MSG.selfDeactivate, field: "is_active" });
    expect((await userAudits()).length).toBe(before);
    const [row] = await t.db.select().from(user).where(eq(user.id, id));
    expect(row).toMatchObject({ role: "admin", isActive: true });

    expect((await put(id, { name: "ผู้ดูแลหลัก" })).status).toBe(200);
    expect((await t.request("/api/admin/users", { cookie: cookies.admin })).status).toBe(200);
  });

  it("admin ที่ถูกลดสิทธิ์เสียสิทธิ์ผู้ดูแลทันที (session เดิม)", async () => {
    const body = await created({ email: "admin2@ong.test", name: "ผู้ดูแลสำรอง", role: "admin" });
    ids.admin2 = body.user.id;
    cookies.admin2 = await t.login("admin2@ong.test", body.temporary_password ?? "");
    expect((await t.request("/api/admin/users", { cookie: cookies.admin2 })).status).toBe(200);

    expect((await put(ids.admin2, { role: "manager" })).status).toBe(200);
    expect((await t.request("/api/admin/users", { cookie: cookies.admin2 })).status).toBe(403);
  });

  it("ต้องเหลือ admin ที่ใช้งานได้ ≥ 1 — service ปฏิเสธแม้ไม่ใช่การแก้ตัวเอง (เช่นจาก CLI)", async () => {
    const id = ids.admin ?? "";
    const cli = { userId: null, via: "cli" as const };
    for (const [input, field] of [
      [{ role: "staff" as const }, "role"],
      [{ is_active: false }, "is_active"],
    ] as const) {
      const attempt = updateUserAccount(t.db, id, input, cli);
      await expect(attempt).rejects.toBeInstanceOf(AdminError);
      await expect(attempt).rejects.toMatchObject({ status: 409, field, message: USER_MSG.lastAdmin });
    }
    const [row] = await t.db.select().from(user).where(eq(user.id, id));
    expect(row).toMatchObject({ role: "admin", isActive: true });
  });

  it("ลด admin พร้อมกันสองทาง → คำขอหลังรอ lock แล้วได้ 409 · admin ไม่มีทางเหลือ 0", async () => {
    const body = await created({ email: "admin3@ong.test", name: "ผู้ดูแลคนที่สาม", role: "admin" });
    const third = body.user.id;
    const first = ids.admin ?? "";
    // อีกทรานแซกชัน (ผู้ดูแลอีกคน/สคริปต์) กำลังลดสิทธิ์ admin คนแรกอยู่ ยังไม่ commit
    const other = await openTransaction(t.db);
    await other.sql`update "user" set role = 'staff' where id = ${first}`;
    // admin คนแรกยังผ่าน requireRole (เห็นค่าที่ commit แล้ว) แล้วสั่งลดสิทธิ์ admin คนที่สาม
    const pending = put(third, { role: "staff" });
    await waitForLockWait(t.db);
    await other.commit();

    const res = await pending;
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: USER_MSG.lastAdmin, field: "role" });
    const admins = await t.db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.role, "admin"), eq(user.isActive, true)));
    expect(admins.map((a) => a.id)).toEqual([third]);

    // คืนค่าให้เทสต์ถัดไป
    await t.db.update(user).set({ role: "admin" }).where(eq(user.id, first));
    expect((await put(third, { is_active: false })).status).toBe(200);
  });

  it("PUT กับ reset-password ของผู้ใช้คนเดียวกันทับกัน → ทั้งคู่ commit (ไม่ deadlock กับ FK ของ audit_log)", async () => {
    const target = ids.manee ?? "";
    const password = "Manee-Overlap-2569";
    secrets.add(password);
    // จุดหยุด: ถือแถว credential ของเป้าหมายไว้ → reset ล็อกแถวผู้ใช้แล้วค้างก่อนถึงการเขียน audit
    const gate = await openTransaction(t.db);
    await gate.sql`select id from account where user_id = ${target} and provider_id = 'credential' for update`;
    const resetting = reset(target, { password });
    await waitForLockWait(t.db, 1);
    // PUT ล็อกแถว admin (ผู้ทำ) แล้วรอแถวเป้าหมายที่ reset ถืออยู่
    const updating = put(target, { name: "มานี (แก้ระหว่างรีเซ็ต)" });
    await waitForLockWait(t.db, 2);
    // reset ไปต่อ: audit_log.user_id = admin → FK check (FOR KEY SHARE) บนแถวที่ PUT ล็อกไว้
    // ล็อกแบบ FOR UPDATE ตรงนี้ = รอกันเป็นวง → Postgres ยกเลิกหนึ่งคำขอ (40P01 → 500)
    await gate.commit();

    const [r, u] = await Promise.all([resetting, updating]);
    expect(r.status).toBe(200);
    expect(u.status).toBe(200);
    expect(await signIn("manee@ong.test", password)).toBe(200);
    const [row] = await t.db.select().from(user).where(eq(user.id, target));
    expect(row?.name).toBe("มานี (แก้ระหว่างรีเซ็ต)");
    const actions = (await userAudits()).filter((a) => a.rowId === target).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.reset_password", "user.update"]));
  });

  // ---------- สิทธิ์สาขามีผลทันที (session เดิม ไม่ต้อง login ใหม่) ----------

  it("เพิ่มสาขาที่อนุญาต → สลับไปสาขานั้นได้ทันที · ถอนออก → บิลของสาขานั้นอ่านไม่ได้ทันที", async () => {
    const target = ids.staff ?? "";
    const cookie = cookies.staff;
    const b1 = t.branches["00001"] ?? "";
    expect((await t.request("/api/me/branch", { cookie, body: { branch_id: b1 } })).status).toBe(404);

    expect((await put(target, { allowed_branch_ids: [b1] })).status).toBe(200);
    const switched = await t.request("/api/me/branch", { cookie, body: { branch_id: b1 } });
    expect(switched.status).toBe(200);
    const saved = await t.request("/api/buy", { cookie, body: bill() });
    expect(saved.status).toBe(201);
    const billId = ((await saved.json()) as { id: string }).id;
    expect((await t.request(`/api/buy/${billId}`, { cookie })).status).toBe(200);

    expect((await put(target, { allowed_branch_ids: [] })).status).toBe(200);
    expect((await t.request(`/api/buy/${billId}`, { cookie })).status).toBe(404);
    const listed = (await (await t.request("/api/buy", { cookie })).json()) as { items: { id: string }[] };
    expect(listed.items.map((i) => i.id)).not.toContain(billId);
    const mine = (await (await me(cookie)).json()) as MeBody;
    expect(mine.branch).toBeNull();
    expect(mine.branches.map((b) => b.code)).toEqual(["00000"]);
    const blocked = await t.request("/api/buy", { cookie, body: bill() });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "ยังไม่ได้เลือกสาขาที่ทำงาน", field: "branch" });
  });

  it("เปลี่ยน role มีผลทันที: staff → accounting เปิดบิลไม่ได้ (403)", async () => {
    const target = ids.staff ?? "";
    const cookie = cookies.staff;
    expect((await t.request("/api/me/branch", { cookie, body: { branch_id: t.branches["00000"] } })).status).toBe(200);
    expect((await t.request("/api/buy/quote", { cookie, body: bill() })).status).toBe(200);
    expect((await put(target, { role: "accounting" })).status).toBe(200);
    const res = await t.request("/api/buy", { cookie, body: bill() });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect((await put(target, { role: "staff" })).status).toBe(200);
  });

  // ---------- audit ----------

  it("ทุกการเขียนที่สำเร็จมี audit · ไม่มีรหัสผ่านหรือ hash ใน audit_log เลย", async () => {
    const rows = await t.db.select().from(auditLog);
    const text = JSON.stringify(rows);
    for (const secret of secrets) expect(text).not.toContain(secret);
    for (const a of await t.db.select().from(account)) expect(text).not.toContain(a.password ?? "never");
    const actions = rows.filter((r) => r.tableName === "user").map((r) => r.action);
    expect(new Set(actions)).toEqual(new Set(["user.create", "user.update", "user.reset_password"]));
    // สร้างผ่าน API 4 บัญชี (somchai · manee · admin2 · admin3)
    expect(actions.filter((a) => a === "user.create")).toHaveLength(4);
  });
});
