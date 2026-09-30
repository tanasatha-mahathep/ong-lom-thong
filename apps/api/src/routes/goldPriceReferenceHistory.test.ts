import { type GoldReference, GoldReferenceError } from "@ong/core";
import { branch, goldReferenceAnnouncement } from "@ong/db";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CachedGoldReference,
  type GoldReferenceService,
  createGoldReferenceService,
} from "../services/goldReference";
import { recordGoldAnnouncement } from "../services/goldReferenceHistory";
import { expectApiError, moneyShapeViolations } from "../test/assertions";
import { GOLDTRADERS_EXPECTED } from "../test/fixtures/goldReference";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";
const SOURCE = "classic.goldtraders.or.th";
const HISTORY = "/api/gold-price/reference/history";
const DAYS_ERROR = { error: "days ต้องเป็นจำนวนเต็ม 1–366", field: "days" };

/** 10:00 น. 29 ก.ย. 2569 เวลาไทย — ประกาศ 09:31 ครั้งที่ 2 ของ fixture เป็นประกาศล่าสุด */
const T0 = new Date("2026-09-29T03:00:00Z");

/** ประกาศสมมติ (ตัวเลขรูปแบบเดียวกับประกาศจริง) — ราคาขยับทีละ 50 บาทตาม step */
function announcement(announcedAt: string, round: number | null, step = 0): GoldReference {
  const move = (base: number) => `${base + step * 50}.${base === 66295 ? "52" : "00"}`;
  return {
    announcedAt,
    round,
    barBuy: move(67650),
    barSell: move(67850),
    ornamentBuy: move(66295),
    ornamentSell: move(68650),
  };
}

/** รายการในประวัติที่ต้องได้จากประกาศหนึ่งครั้ง (รูปเดียวกับ GET /reference ไม่มี fetched_at/stale) */
const item = (a: GoldReference) => ({
  announced_at: a.announcedAt,
  round: a.round,
  source: SOURCE,
  bar_buy: a.barBuy,
  bar_sell: a.barSell,
  ornament_buy: a.ornamentBuy,
  ornament_sell: a.ornamentSell,
});

type Mode = "ok" | "invalid" | "down";

describe.skipIf(!available)("GET /api/gold-price/reference/history — ประวัติราคาสมาคม (กราฟ)", () => {
  let t: TestApp;
  let disabled: TestApp;
  let clock = T0;
  let mode: Mode = "ok";
  let reference: GoldReference = GOLDTRADERS_EXPECTED;
  let fetches = 0;
  const cookies: Record<string, string> = {};

  const fresh = () =>
    createGoldReferenceService({
      provider: {
        source: SOURCE,
        fetch: () => {
          fetches++;
          if (mode === "invalid") return Promise.reject(new GoldReferenceError("ขยะ"));
          if (mode === "down") return Promise.reject(new Error("ECONNREFUSED"));
          return Promise.resolve(reference);
        },
      },
      now: () => clock,
    });
  // cache ของ service ว่างทุกเทสต์ · ตัวบันทึกประวัติเป็นของแอป (createApp ครอบให้) จึงอยู่ข้ามเทสต์ —
  // เทสต์ที่ดึงผ่าน /reference ใช้ประกาศไม่ซ้ำกันเอง ไม่พึ่งลำดับเทสต์
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
  beforeEach(async () => {
    clock = T0;
    mode = "ok";
    reference = GOLDTRADERS_EXPECTED;
    current = fresh();
    await t.db.delete(goldReferenceAnnouncement);
  });

  const history = async (who = "staff", query = "") => t.request(`${HISTORY}${query}`, { cookie: cookies[who] });
  const liveReference = async (who = "staff") => t.request("/api/gold-price/reference", { cookie: cookies[who] });
  const rows = () =>
    t.db
      .select()
      .from(goldReferenceAnnouncement)
      .orderBy(asc(goldReferenceAnnouncement.announcedAt), asc(goldReferenceAnnouncement.round));
  /** เติมประวัติตรง ๆ (ไม่ผ่านแหล่งภายนอก) */
  const seed = async (...list: GoldReference[]) => {
    for (const a of list) {
      const value: CachedGoldReference = { ...a, source: SOURCE, fetchedAt: clock.toISOString() };
      await recordGoldAnnouncement(t.db, value, clock);
    }
  };
  const bodyOf = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as { days: number; from: string; items: ReturnType<typeof item>[] };
  };

  describe("สิทธิ์ — ข้อมูลสาธารณะใช้ร่วมทั้งร้าน ด่านเดียวกับ GET /reference", () => {
    it("ไม่ login = 401 ไม่มีประวัติในคำตอบ", async () => {
      await seed(GOLDTRADERS_EXPECTED);
      expect(await expectApiError(await t.request(HISTORY), 401)).toEqual({ error: "unauthorized" });
    });

    it("ไม่มีสาขาที่เปิดอยู่ = 403 (fail-closed ไม่ใช่ประวัติ) · สาขาเดียวของตัวเองถูกปิด = 403", async () => {
      await seed(GOLDTRADERS_EXPECTED);
      expect(await expectApiError(await history("nobranch"), 403)).toEqual({ error: "forbidden" });
      await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
      try {
        await expectApiError(await history("closed"), 403);
        await expectApiError(await history("admin"), 403);
      } finally {
        await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
      }
    });

    it("ทุก role ทุกสาขาได้ประวัติชุดเดียวกัน (ไม่กรองตามสาขา ไม่มีข้อมูลสาขาติดมา) · เงินเป็น string · no-store · อ่าน DB อย่างเดียว ไม่ดึงแหล่งภายนอก", async () => {
      await seed(GOLDTRADERS_EXPECTED);
      const before = fetches;
      const bodies: unknown[] = [];
      for (const who of ["staff", "manager", "accounting", "admin"]) {
        const res = await history(who);
        expect(res.headers.get("cache-control"), who).toMatch(/no-store/);
        const body = await bodyOf(res);
        expect(moneyShapeViolations(body), who).toEqual([]);
        expect(JSON.stringify(body), who).not.toMatch(/branch/);
        bodies.push(body);
      }
      expect(bodies[0]).toMatchObject({ items: [item(GOLDTRADERS_EXPECTED)] });
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect(fetches).toBe(before);
    });

    it("ไม่มีทางเขียนผ่าน HTTP: POST/PUT/PATCH/DELETE — origin อื่น = 403 (CSRF) · origin เดียวกัน = 404 · ประวัติไม่เปลี่ยน", async () => {
      await seed(GOLDTRADERS_EXPECTED);
      const before = await rows();
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const body = { days: "1" };
        const foreign = await t.request(HISTORY, {
          method,
          cookie: cookies.manager,
          body,
          origin: "https://evil.test",
        });
        expect(await expectApiError(foreign, 403, method)).toEqual({ error: "forbidden origin" });
        await expectApiError(await t.request(HISTORY, { method, cookie: cookies.manager, body }), 404, method);
      }
      expect(await rows()).toEqual(before);
    });
  });

  describe("?days= — ช่วงวันตามเวลาไทย นับวันนี้ด้วย", () => {
    it("ยังไม่มีประวัติ (เพิ่งติดตั้ง) = items ว่าง · ไม่ส่ง days = 90 วัน ตั้งแต่ 00:00 น. เวลาไทย", async () => {
      expect(await bodyOf(await history())).toEqual({ days: 90, from: "2026-07-02T00:00:00+07:00", items: [] });
    });

    it.each([
      ["0"],
      ["-1"],
      ["367"],
      ["1000"],
      ["abc"],
      ["1.5"],
      ["7.0"],
      [""],
      [" 7"],
      ["1e2"],
      ["0x10"],
      ["๗"],
      ["%EF%BC%97"], // "７" เลขเจ็ดแบบเต็มความกว้าง (U+FF17)
    ])("days=%s → 400 ชี้ field days", async (days) => {
      expect(await expectApiError(await history("staff", `?days=${days}`), 400)).toEqual(DAYS_ERROR);
    });

    it("ขอบ 1 และ 366 ได้ · ช่วงเริ่ม 00:00 น. เวลาไทยของ (วันนี้ − days + 1)", async () => {
      expect(await bodyOf(await history("staff", "?days=1"))).toMatchObject({
        days: 1,
        from: "2026-09-29T00:00:00+07:00",
      });
      expect(await bodyOf(await history("staff", "?days=366"))).toMatchObject({
        days: 366,
        from: "2025-09-29T00:00:00+07:00",
      });
    });

    it("ตัดที่ 00:00 น. เวลาไทยพอดี (รวมจุดนั้น) · เรียงเก่า → ใหม่แม้บันทึกสลับลำดับ · เวลาเดียวกันเรียงตามครั้งที่ (null ท้าย)", async () => {
      const outside = announcement("2026-09-22T23:59:00+07:00", 9);
      const edge = announcement("2026-09-23T00:00:00+07:00", null, 1);
      const r1 = announcement("2026-09-28T09:15:00+07:00", 1, 2);
      const r2same = announcement("2026-09-28T09:15:00+07:00", 2, 3);
      const unknown = announcement("2026-09-28T09:15:00+07:00", null, 4);
      const today = announcement("2026-09-29T09:31:00+07:00", 2, 5);
      await seed(today, unknown, r2same, outside, r1, edge);
      const body = await bodyOf(await history("staff", "?days=7"));
      expect(body.from).toBe("2026-09-23T00:00:00+07:00");
      expect(body.items).toEqual([edge, r1, r2same, unknown, today].map(item));
      expect(moneyShapeViolations(body)).toEqual([]);
    });

    it("วันนี้ตามเวลาไทย ไม่ใช่ UTC: 00:30 น. วันที่ 30 (17:30Z วันที่ 29) days=1 → เฉพาะประกาศวันที่ 30", async () => {
      clock = new Date("2026-09-29T17:30:00Z");
      const evening = announcement("2026-09-29T17:30:00+07:00", 12);
      const afterMidnight = announcement("2026-09-30T00:10:00+07:00", 1, 1);
      await seed(evening, afterMidnight);
      expect(await bodyOf(await history("staff", "?days=1"))).toEqual({
        days: 1,
        from: "2026-09-30T00:00:00+07:00",
        items: [item(afterMidnight)],
      });
      expect((await bodyOf(await history("staff", "?days=2"))).items).toEqual([evening, afterMidnight].map(item));
    });

    it("query อื่นที่ไม่รู้จักไม่มีผล", async () => {
      await seed(GOLDTRADERS_EXPECTED);
      expect(await bodyOf(await history("staff", "?days=7&q=x&branch_id=zzz"))).toEqual(
        await bodyOf(await history("staff", "?days=7")),
      );
    });
  });

  describe("บันทึกเมื่อ GET /reference ดึงสำเร็จ (ผ่าน createApp จริง · ไม่มี cron)", () => {
    it("ดึงได้ → หนึ่งแถว ค่าตรงกับที่ /reference ตอบทุกช่อง · recorded_at = นาฬิกาของแอป", async () => {
      reference = announcement("2026-09-29T09:40:00+07:00", 3, 1);
      const live = (await (await liveReference()).json()) as Record<string, unknown>;
      expect(live).toMatchObject({ announced_at: "2026-09-29T09:40:00+07:00", round: 3, stale: false });

      expect(await rows()).toEqual([
        {
          id: expect.any(String) as string,
          announcedAt: new Date("2026-09-29T09:40:00+07:00"),
          round: 3,
          source: SOURCE,
          barBuy: "67700.00",
          barSell: "67900.00",
          ornamentBuy: "66345.52",
          ornamentSell: "68700.00",
          recordedAt: T0,
        },
      ]);
      const { fetched_at: _f, stale: _s, ...sameShape } = live;
      expect((await bodyOf(await history())).items).toEqual([sameShape]);
    });

    it("เปิดดูซ้ำ · หลายคน · cache หมดแล้วดึงได้ประกาศเดิม → ยังแถวเดียว ไม่แก้แถวเดิม", async () => {
      reference = announcement("2026-09-29T09:45:00+07:00", 4, 2);
      await liveReference("staff");
      const [first] = await rows();
      for (const who of ["staff", "manager", "accounting", "admin"])
        expect((await liveReference(who)).status).toBe(200);
      clock = new Date(T0.getTime() + 5 * 60_000); // หมด TTL → ดึงใหม่ ได้ประกาศเดิม
      current = fresh();
      const before = fetches;
      expect((await liveReference()).status).toBe(200);
      expect(fetches).toBe(before + 1);
      expect(await rows()).toEqual([first]);
    });

    it("ประกาศครั้งถัดไป → เพิ่มแถว แถวเก่าอยู่เหมือนเดิม · ประวัติเรียงเก่า → ใหม่", async () => {
      const r5 = announcement("2026-09-29T09:50:00+07:00", 5, 3);
      const r6 = announcement("2026-09-29T09:55:00+07:00", 6, 4);
      reference = r5;
      await liveReference();
      clock = new Date(T0.getTime() + 5 * 60_000);
      reference = r6;
      expect(await (await liveReference()).json()).toMatchObject({ round: 6, bar_sell: r6.barSell });
      expect((await bodyOf(await history())).items).toEqual([r5, r6].map(item));
    });

    it("ประกาศไม่มีครั้งที่ (round null) เห็นซ้ำ = แถวเดียว · เวลาเดียวกันมีครั้งที่ = อีกแถว", async () => {
      const noRound = announcement("2026-09-29T09:20:00+07:00", null, 5);
      const numbered = announcement("2026-09-29T09:20:00+07:00", 1, 6);
      for (const a of [noRound, numbered, noRound]) {
        reference = a;
        current = fresh();
        expect((await liveReference()).status).toBe(200);
      }
      expect((await rows()).map((r) => r.round)).toEqual([1, null]);
    });

    it("request พร้อมกันหลังประกาศใหม่ → ดึงครั้งเดียว · ทุกคนได้ 200 · แถวเดียว", async () => {
      reference = announcement("2026-09-29T09:35:00+07:00", 7, 7);
      const before = fetches;
      const all = await Promise.all(["staff", "manager", "accounting", "admin", "staff"].map((w) => liveReference(w)));
      expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(fetches).toBe(before + 1);
      expect(await rows()).toHaveLength(1);
    });

    it("ยังไม่มีประกาศวันนี้ (ล่าสุดเป็นของเมื่อวาน · stale) ก็เป็นประกาศจริง → บันทึก", async () => {
      reference = announcement("2026-09-28T17:30:00+07:00", 8, 8);
      expect(await (await liveReference()).json()).toMatchObject({ stale: true, round: 8 });
      expect((await bodyOf(await history())).items).toEqual([item(reference)]);
    });

    it.each([
      ["invalid", "invalid"],
      ["down", "unavailable"],
    ] as const)("แหล่ง %s → /reference 503 reason %s เหมือนเดิม · ไม่บันทึกอะไร", async (m, reason) => {
      mode = m;
      expect(await expectApiError(await liveReference(), 503)).toEqual({ error: "ดึงราคาอ้างอิงไม่ได้", reason });
      expect(await rows()).toEqual([]);
    });

    it("แหล่งปิด (ค่าเริ่มต้นของ env) → /reference 503 disabled ไม่บันทึก · ประวัติที่เก็บไว้ยังอ่านได้", async () => {
      const res = await disabled.request("/api/gold-price/reference", { cookie: cookies.disabledStaff });
      expect(await expectApiError(res, 503)).toEqual({ error: "ดึงราคาอ้างอิงไม่ได้", reason: "disabled" });
      expect(await disabled.db.select().from(goldReferenceAnnouncement)).toEqual([]);
      await recordGoldAnnouncement(disabled.db, { ...GOLDTRADERS_EXPECTED, source: SOURCE, fetchedAt: "x" }, T0);
      const kept = await disabled.request(HISTORY, { cookie: cookies.disabledStaff });
      expect((await bodyOf(kept)).items).toEqual([item(GOLDTRADERS_EXPECTED)]);
    });

    it("บันทึกประวัติไม่ได้ (ตารางหาย) → /reference ยัง 200 ค่าเดิม · log เตือนไม่มีค่าใน query · request ถัดไปบันทึกได้", async () => {
      reference = announcement("2026-09-29T09:25:00+07:00", 9, 9);
      const expected = { round: 9, bar_sell: reference.barSell, stale: false };
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await t.db.execute(sql`alter table gold_reference_announcement rename to gold_reference_announcement_off`);
      try {
        expect(await (await liveReference()).json()).toMatchObject(expected);
        expect(warn).toHaveBeenCalledTimes(1);
        const [label, logged] = warn.mock.calls[0] as [string, unknown];
        expect(label).toBe("[gold-reference] could not store the announcement:");
        expect(logged).toMatchObject({ code: "42P01" });
        expect(JSON.stringify(logged)).not.toContain(reference.barSell);
      } finally {
        await t.db.execute(sql`alter table gold_reference_announcement_off rename to gold_reference_announcement`);
        warn.mockRestore();
      }
      expect(await rows()).toEqual([]);
      expect(await (await liveReference()).json()).toMatchObject(expected); // cache hit — แต่ยังไม่ได้บันทึก จึงลองใหม่
      expect((await bodyOf(await history())).items).toEqual([item(reference)]);
    });
  });
});
