import { branch, session, user } from "@ong/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

interface MeBody {
  role: string;
  branch: { id: string; code: string } | null;
  branch_closed: { id: string; code: string; name: string } | null;
  branches: { id: string; code: string }[];
  can_view_all: boolean;
}

describe.skipIf(!available)("auth + /api/me — สาขา fail-closed", () => {
  let t: TestApp;
  let staffId = "";
  const codesOf = (b: MeBody) => b.branches.map((x) => x.code);

  beforeAll(async () => {
    t = await startTestApp();
    staffId = (await t.createUser({ email: "staff@ong.test", password: PW, branch: "00000" })).id;
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

  it("สาขาปัจจุบันถูกปิด: branch เป็น null แต่ branch_closed บอกสาขานั้น (ยังมีสิทธิ์เดิม)", async () => {
    const cookie = await t.login("multi@ong.test", PW);
    await t.request("/api/me/branch", { cookie, body: { branch_id: t.branches["00001"] } });
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00001"));
    try {
      const { body } = await me(cookie);
      expect(body.branch).toBeNull();
      expect(body.branch_closed).toEqual({ id: t.branches["00001"], code: "00001", name: "สาขา 2" });
      expect(codesOf(body)).toEqual(["00000"]);
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00001"));
    }
  });

  it("currentBranchId ชี้สาขาที่ไม่เคยมีสิทธิ์แล้วถูกปิด — branch_closed เป็น null เหมือนกัน (ไม่รั่วชื่อสาขา)", async () => {
    const cookie = await t.login("staff@ong.test", PW); // staff มีสิทธิ์แค่ 00000
    await t.db.update(session).set({ currentBranchId: t.branches["00001"] }).where(eq(session.userId, staffId));
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00001"));
    try {
      const { body } = await me(cookie);
      expect(body.branch).toBeNull();
      expect(body.branch_closed).toBeNull();
      expect(codesOf(body)).toEqual(["00000"]);
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00001"));
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
