import { type GoldReference, GoldReferenceError } from "@ong/core";
import { auditLog, branch, goldPrice } from "@ong/db";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type GoldReferenceService, createGoldReferenceService } from "../services/goldReference";
import { expectApiError, moneyShapeViolations } from "../test/assertions";
import { GOLDTRADERS_EXPECTED } from "../test/fixtures/goldReference";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

type Mode = "ok" | "invalid" | "down" | "hang";

describe.skipIf(!available)(
  "GET /api/gold-price/reference — ราคาสมาคม (อ้างอิง) · แสดง/เติมค่าเริ่มต้นเท่านั้น",
  () => {
    let t: TestApp;
    let disabled: TestApp;
    // 10:00 น. 29 ก.ย. 2569 เวลาไทย — ประกาศสมมติ 09:31 ครั้งที่ 2
    const clock = new Date("2026-09-29T03:00:00Z");
    let mode: Mode = "ok";
    let reference: GoldReference = GOLDTRADERS_EXPECTED;
    let fetches = 0;
    const cookies: Record<string, string> = {};

    const fresh = () =>
      createGoldReferenceService({
        provider: {
          source: "classic.goldtraders.or.th",
          fetch: (signal) => {
            fetches++;
            if (mode === "invalid") return Promise.reject(new GoldReferenceError("ขยะ"));
            if (mode === "down") return Promise.reject(new Error("ECONNREFUSED"));
            if (mode === "hang") {
              return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
            }
            return Promise.resolve(reference);
          },
        },
        now: () => clock,
        timeoutMs: 50,
      });
    // service ใหม่ทุกเทสต์ (cache ว่าง) — cache/cooldown/stale ตรวจใน services/goldReference.test.ts
    let current = fresh();
    const goldReference: GoldReferenceService = { get: () => current.get(), peek: () => current.peek() };

    beforeAll(async () => {
      t = await startTestApp({ now: () => clock, goldReference });
      disabled = await startTestApp({ now: () => clock });
      const users = [
        { email: "staff@ong.test", role: "staff", branch: "00000" },
        { email: "manager@ong.test", role: "manager", branch: "00000" },
        { email: "accounting@ong.test", role: "accounting", branch: "00001" },
        { email: "admin@ong.test", role: "admin", branch: "00002" },
        { email: "nobranch@ong.test", role: "manager", branch: null },
        { email: "closed@ong.test", role: "staff", branch: "00002" },
      ] as const;
      for (const u of users) {
        await t.createUser({ ...u, password: PW });
        cookies[u.email.split("@")[0] as string] = await t.login(u.email, PW);
      }
      await disabled.createUser({ email: "staff@ong.test", password: PW, branch: "00000" });
      cookies.disabledStaff = await disabled.login("staff@ong.test", PW);
    });
    afterAll(async () => {
      await t?.close();
      await disabled?.close();
    });
    beforeEach(() => {
      current = fresh();
      mode = "ok";
      reference = GOLDTRADERS_EXPECTED;
    });

    const get = (who?: string) => t.request("/api/gold-price/reference", { cookie: who ? cookies[who] : undefined });

    const EXPECTED = {
      source: "classic.goldtraders.or.th",
      announced_at: "2026-09-29T09:31:00+07:00",
      round: 2,
      bar_buy: "67650.00",
      bar_sell: "67850.00",
      ornament_buy: "66295.52",
      ornament_sell: "68650.00",
      fetched_at: "2026-09-29T03:00:00.000Z",
      stale: false,
    };

    it("ไม่ login = 401 · ไม่ดึงแหล่งภายนอก", async () => {
      const before = fetches;
      await expectApiError(await get(), 401);
      expect(fetches).toBe(before);
    });

    it("ไม่มีสาขาที่เปิดอยู่ = 403 (fail-closed) · สาขาถูกปิด = 403", async () => {
      await expectApiError(await get("nobranch"), 403);
      await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
      try {
        await expectApiError(await get("closed"), 403);
        await expectApiError(await get("admin"), 403);
      } finally {
        await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
      }
    });

    it("ทุก role ที่มีสาขาได้ค่าเดียวกัน — ข้อมูลสาธารณะ ไม่มีข้อมูลสาขา/ราคาร้านติดมา · เงินเป็น string", async () => {
      for (const who of ["staff", "manager", "accounting", "admin"]) {
        const res = await get(who);
        expect(res.status, who).toBe(200);
        expect(res.headers.get("cache-control")).toMatch(/no-store/);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body, who).toEqual(EXPECTED);
        expect(moneyShapeViolations(body)).toEqual([]);
      }
    });

    it("ไม่ตั้งราคาร้านเอง — ดึงราคาสมาคมแล้ว gold_price ยังว่าง · /today ยัง 404", async () => {
      expect((await get("manager")).status).toBe(200);
      expect(await t.db.select().from(goldPrice)).toEqual([]);
      expect((await t.request("/api/gold-price/today", { cookie: cookies.staff })).status).toBe(404);
    });

    it("ประกาศล่าสุดเป็นของเมื่อวาน = stale true", async () => {
      reference = { ...GOLDTRADERS_EXPECTED, announcedAt: "2026-09-28T17:30:00+07:00", round: 5 };
      expect(await (await get("staff")).json()).toMatchObject({ stale: true, round: 5 });
    });

    it.each([
      ["invalid", "invalid"],
      ["down", "unavailable"],
      ["hang", "unavailable"],
    ] as const)("แหล่ง %s → 503 reason %s · ไม่มีราคาในคำตอบ", async (m, reason) => {
      mode = m;
      const body = await expectApiError(await get("staff"), 503);
      expect(body).toEqual({ error: "ดึงราคาอ้างอิงไม่ได้", reason });
    });

    it("ปิดไว้ (ค่าเริ่มต้นของ env) → 503 reason disabled", async () => {
      const res = await disabled.request("/api/gold-price/reference", { cookie: cookies.disabledStaff });
      expect(await expectApiError(res, 503)).toEqual({ error: "ดึงราคาอ้างอิงไม่ได้", reason: "disabled" });
    });

    describe("audit ตอนบันทึกราคา (ไม่ต้อง migration — audit_log.diff jsonb)", () => {
      const put = (path: string, body: unknown, origin?: string) =>
        t.request(path, { method: "PUT", cookie: cookies.manager, body, origin });
      const lastAudit = async (action: string) => {
        const [row] = await t.db
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, action))
          .orderBy(desc(auditLog.at))
          .limit(1);
        return row?.diff as Record<string, unknown> | undefined;
      };

      const PREFILL = { announced_at: "2026-09-29T09:31:00+07:00", round: 2 };
      const SERVER_SEEN = {
        source: "classic.goldtraders.or.th",
        announced_at: "2026-09-29T09:31:00+07:00",
        round: 2,
        bar_sell: "67850.00",
        fetched_at: "2026-09-29T03:00:00.000Z",
      };

      it.each([
        ["boolean (รูปเก่า)", true],
        ["ข้อความ", "yes"],
        ["ไม่มี round", { announced_at: PREFILL.announced_at }],
        ["เวลาไม่ใช่ ISO", { announced_at: "29/09/2569 09:31", round: 2 }],
        ["round เป็น 0", { ...PREFILL, round: 0 }],
        ["มีช่องเกิน", { ...PREFILL, bar_sell: "1" }],
      ])("from_reference ผิดรูป (%s) = 400 ชี้ field ไม่บันทึก", async (_, from_reference) => {
        const body = await expectApiError(
          await put("/api/gold-price/today", { bar_sell: "67850", from_reference }),
          400,
        );
        expect(body.field).toBe("from_reference");
        expect(await t.db.select().from(goldPrice)).toEqual([]);
      });

      it("CSRF: PUT จาก origin อื่น = 403 ไม่บันทึก", async () => {
        const res = await put(
          "/api/gold-price/today",
          { bar_sell: "67850", from_reference: PREFILL },
          "https://evil.test",
        );
        await expectApiError(res, 403);
        expect(await t.db.select().from(goldPrice)).toEqual([]);
      });

      it("ราคากลาง: เติมจากราคาสมาคม → audit แยกคำอ้างของ client กับที่เซิร์ฟเวอร์เห็น", async () => {
        await get("manager");
        const res = await put("/api/gold-price/today", { bar_sell: "67850", from_reference: PREFILL });
        expect(res.status).toBe(200);
        const diff = await lastAudit("gold_price.create");
        expect(diff?.reference).toEqual({
          client_prefilled: true,
          client_announced_at: "2026-09-29T09:31:00+07:00",
          client_round: 2,
          server_seen: SERVER_SEEN,
          saved_matches_server_bar_sell: true,
          client_matches_server_announcement: true,
        });
        expect(moneyShapeViolations(diff)).toEqual([]);
      });

      it("ราคากลาง: client อ้างประกาศที่เซิร์ฟเวอร์ไม่เห็น → บันทึกตามจริงว่าไม่ตรง", async () => {
        await get("manager");
        const claim = { announced_at: "2026-09-29T15:00:00+07:00", round: 7 };
        const res = await put("/api/gold-price/today", { bar_sell: "67900", from_reference: claim });
        expect(res.status).toBe(200);
        expect((await lastAudit("gold_price.update"))?.reference).toMatchObject({
          client_prefilled: true,
          client_round: 7,
          server_seen: SERVER_SEEN,
          saved_matches_server_bar_sell: false,
          client_matches_server_announcement: false,
        });
      });

      it("ราคากลาง: ไม่ได้เติม แต่เซิร์ฟเวอร์เห็นราคาสมาคม → บันทึกสิ่งที่เซิร์ฟเวอร์เห็น", async () => {
        await get("manager");
        const res = await put("/api/gold-price/today", { bar_sell: "67900" });
        expect(res.status).toBe(200);
        expect((await lastAudit("gold_price.update"))?.reference).toMatchObject({
          client_prefilled: false,
          client_announced_at: null,
          server_seen: SERVER_SEEN,
          saved_matches_server_bar_sell: false,
          client_matches_server_announcement: null,
        });
      });

      it("ราคาเฉพาะสาขา: audit มี reference เหมือนกัน", async () => {
        await get("manager");
        const b1 = t.branches["00000"] as string;
        const res = await put(`/api/gold-price/today/branches/${b1}`, {
          bar_sell: "67,850.00",
          from_reference: PREFILL,
        });
        expect(res.status).toBe(200);
        expect((await lastAudit("gold_price.set_branch"))?.reference).toMatchObject({
          client_prefilled: true,
          saved_matches_server_bar_sell: true,
          client_matches_server_announcement: true,
        });
      });

      it("แหล่งปิด + เติมมา → บันทึกแค่คำอ้าง (server_seen null) · ไม่ได้เติม = ไม่มีคีย์ reference", async () => {
        await disabled.createUser({ email: "m@ong.test", password: PW, role: "manager", branch: "00000" });
        const cookie = await disabled.login("m@ong.test", PW);
        const res = await disabled.request("/api/gold-price/today", {
          method: "PUT",
          cookie,
          body: { bar_sell: "67850", from_reference: PREFILL },
        });
        expect(res.status).toBe(200);
        const [row] = await disabled.db.select().from(auditLog).where(eq(auditLog.action, "gold_price.create"));
        expect((row?.diff as { reference?: unknown }).reference).toEqual({
          client_prefilled: true,
          client_announced_at: "2026-09-29T09:31:00+07:00",
          client_round: 2,
          server_seen: null,
          saved_matches_server_bar_sell: null,
          client_matches_server_announcement: null,
        });
        const again = await disabled.request("/api/gold-price/today", {
          method: "PUT",
          cookie,
          body: { bar_sell: "67900" },
        });
        expect(again.status).toBe(200);
        const [upd] = await disabled.db.select().from(auditLog).where(eq(auditLog.action, "gold_price.update"));
        expect(upd?.diff).not.toHaveProperty("reference");
      });
    });
  },
);
