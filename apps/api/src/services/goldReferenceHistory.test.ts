import type { GoldReference } from "@ong/core";
import { goldReferenceAnnouncement } from "@ong/db";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pgError } from "../lib/pg";
import { GOLDTRADERS_EXPECTED } from "../test/fixtures/goldReference";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import {
  type CachedGoldReference,
  type GoldReferenceResult,
  type GoldReferenceService,
  createGoldReferenceService,
} from "./goldReference";
import { recordGoldAnnouncement, withAnnouncementHistory } from "./goldReferenceHistory";

// 10:00 น. 29 ก.ย. 2569 เวลาไทย — ประกาศ 09:31 ครั้งที่ 2 (fixture)
const T0 = new Date("2026-09-29T03:00:00Z");
const CACHED: CachedGoldReference = { ...GOLDTRADERS_EXPECTED, source: "fake.test", fetchedAt: T0.toISOString() };
/** ประกาศครั้งถัดไปของวันเดียวกัน — ราคาขยับ 100 บาท */
const NEXT: CachedGoldReference = {
  ...CACHED,
  announcedAt: "2026-09-29T09:58:00+07:00",
  round: 3,
  barBuy: "67750.00",
  barSell: "67950.00",
  ornamentBuy: "66393.52",
  ornamentSell: "68750.00",
};

const ok = (value: CachedGoldReference, stale = false): GoldReferenceResult => ({ ok: true, value, stale });

/** service ปลอมที่ตอบตามที่ตั้งไว้ใน `next` — แยกพฤติกรรมของตัวครอบออกจาก cache ของ service จริง */
function scripted(first: GoldReferenceResult) {
  const state = { next: first };
  const peek = vi.fn(() => CACHED);
  const service: GoldReferenceService = { get: () => Promise.resolve(state.next), peek };
  return { state, service, peek };
}

describe("withAnnouncementHistory — บันทึกประกาศที่ดึงได้ (ไม่มี DB)", () => {
  it("ใช้กับ service จริง: ดึงได้ → บันทึก · cache hit และดึงใหม่ได้ประกาศเดิมไม่เขียนซ้ำ · ประกาศใหม่เขียน", async () => {
    let now = T0.getTime();
    let announced: GoldReference = GOLDTRADERS_EXPECTED;
    const fetch = vi.fn(() => Promise.resolve(announced));
    const record = vi.fn(() => Promise.resolve());
    const s = withAnnouncementHistory(
      createGoldReferenceService({ provider: { source: "fake.test", fetch }, now: () => new Date(now) }),
      { record },
    );

    const first = await s.get();
    expect(first).toEqual(ok(CACHED));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(CACHED);

    await s.get(); // cache hit
    now += 5 * 60_000; // หมด TTL → ดึงใหม่ ได้ประกาศเดิม
    await s.get();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenCalledTimes(1);

    announced = { ...NEXT };
    now += 5 * 60_000;
    expect(await s.get()).toMatchObject({ ok: true, value: { round: 3, barSell: "67950.00" } });
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenLastCalledWith({ ...NEXT, fetchedAt: new Date(now).toISOString() });
  });

  it.each(["disabled", "unavailable", "invalid"] as const)(
    "ผล %s (503) ไม่บันทึก · ส่งผลเดิมตรงตัว",
    async (reason) => {
      const { service } = scripted({ ok: false, reason });
      const record = vi.fn(() => Promise.resolve());
      expect(await withAnnouncementHistory(service, { record }).get()).toEqual({ ok: false, reason });
      expect(record).not.toHaveBeenCalled();
    },
  );

  it("stale (ประกาศล่าสุดยังเป็นของเมื่อวาน) ก็เป็นประกาศจริง → บันทึก", async () => {
    const yesterday = { ...CACHED, announcedAt: "2026-09-28T17:30:00+07:00", round: 5 };
    const record = vi.fn(() => Promise.resolve());
    const s = withAnnouncementHistory(scripted(ok(yesterday, true)).service, { record });
    expect(await s.get()).toEqual(ok(yesterday, true));
    expect(record).toHaveBeenCalledWith(yesterday);
  });

  it("บันทึกล้ม → ยังคืนผลเดิม · onError ได้ error ตัวจริง · request ถัดไปลองใหม่ · สำเร็จแล้วหยุดลอง", async () => {
    const boom = new Error("relation does not exist");
    const record = vi.fn<(v: CachedGoldReference) => Promise<void>>().mockRejectedValueOnce(boom);
    record.mockResolvedValue(undefined);
    const onError = vi.fn();
    const s = withAnnouncementHistory(scripted(ok(CACHED)).service, { record, onError });

    expect(await s.get()).toEqual(ok(CACHED));
    expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
    expect(await s.get()).toEqual(ok(CACHED));
    expect(await s.get()).toEqual(ok(CACHED));
    expect(record).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("ไม่ส่ง onError → บันทึกล้มก็ไม่โยนต่อ (ราคาอ้างอิงไม่ล้มเพราะประวัติ)", async () => {
    const record = vi.fn(() => Promise.reject(new Error("db down")));
    const s = withAnnouncementHistory(scripted(ok(CACHED)).service, { record });
    await expect(s.get()).resolves.toEqual(ok(CACHED));
  });

  it("ประกาศเดียวกัน = จุดเวลาเดียวกัน + ครั้งที่เดียวกัน (ISO ต่างรูปไม่นับซ้ำ) · round null กับมีค่า = คนละประกาศ", async () => {
    const { state, service } = scripted(ok(CACHED));
    const record = vi.fn(() => Promise.resolve());
    const s = withAnnouncementHistory(service, { record });
    await s.get();
    state.next = ok({ ...CACHED, announcedAt: "2026-09-29T02:31:00Z" }); // 09:31 น. เวลาไทยเหมือนเดิม
    await s.get();
    expect(record).toHaveBeenCalledTimes(1);
    state.next = ok({ ...CACHED, round: null });
    await s.get();
    state.next = ok({ ...CACHED, round: 4 });
    await s.get();
    expect(record).toHaveBeenCalledTimes(3);
  });

  it("peek ผ่านไปที่ service ตรง ๆ ไม่ดึง ไม่บันทึก", () => {
    const { service, peek } = scripted(ok(CACHED));
    const record = vi.fn(() => Promise.resolve());
    expect(withAnnouncementHistory(service, { record }).peek()).toBe(CACHED);
    expect(peek).toHaveBeenCalledTimes(1);
    expect(record).not.toHaveBeenCalled();
  });
});

const available = await databaseAvailable();

describe.skipIf(!available)("recordGoldAnnouncement — ประกาศหนึ่งครั้ง = หนึ่งแถว (Postgres จริง)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startTestApp({ now: () => T0 });
    // อุ่น pool ไว้ก่อน — เทสต์พร้อมกันข้างล่างต้องชนกันที่ insert จริง ไม่ใช่รอเปิด connection
    await Promise.all(Array.from({ length: 8 }, () => t.db.execute(sql`select 1`)));
  });
  afterAll(async () => {
    await t?.close();
  });
  beforeEach(async () => {
    await t.db.delete(goldReferenceAnnouncement);
  });
  const rows = () =>
    t.db
      .select()
      .from(goldReferenceAnnouncement)
      .orderBy(asc(goldReferenceAnnouncement.announcedAt), asc(goldReferenceAnnouncement.round));

  it("แถวใหม่ → true ค่าตรงทุกช่อง (เงิน numeric กลับมาเป็น string ตรงหลัก) · ประกาศเดิมราคาต่าง → false ไม่เขียนทับ", async () => {
    expect(await recordGoldAnnouncement(t.db, CACHED, T0)).toBe(true);
    const later = new Date(T0.getTime() + 60_000);
    const corrected = { ...CACHED, barSell: "67900.00", source: "other.test" };
    expect(await recordGoldAnnouncement(t.db, corrected, later)).toBe(false);
    expect(await rows()).toEqual([
      {
        id: expect.any(String) as string,
        announcedAt: new Date("2026-09-29T02:31:00Z"),
        round: 2,
        source: "fake.test",
        barBuy: "67650.00",
        barSell: "67850.00",
        ornamentBuy: "66295.52",
        ornamentSell: "68650.00",
        recordedAt: T0,
      },
    ]);
  });

  it("เพดานราคา 999,999.99 และสตางค์ของรูปพรรณเก็บครบ ไม่ปัด ไม่ผ่าน float", async () => {
    const top = { ...NEXT, barSell: "999999.99", ornamentSell: "999999.99", ornamentBuy: "0.01" };
    expect(await recordGoldAnnouncement(t.db, top, T0)).toBe(true);
    expect(await rows()).toMatchObject([{ barSell: "999999.99", ornamentSell: "999999.99", ornamentBuy: "0.01" }]);
  });

  it("round null ซ้ำ = แถวเดียว (NULLS NOT DISTINCT) · เวลาเดียวกันคนละครั้งที่ / null กับมีค่า = คนละแถว · ISO ต่างรูปเวลาเดียวกัน = ซ้ำ", async () => {
    const noRound = { ...CACHED, round: null };
    expect(await recordGoldAnnouncement(t.db, noRound, T0)).toBe(true);
    expect(await recordGoldAnnouncement(t.db, noRound, T0)).toBe(false);
    expect(await recordGoldAnnouncement(t.db, { ...noRound, announcedAt: "2026-09-29T02:31:00Z" }, T0)).toBe(false);
    expect(await recordGoldAnnouncement(t.db, CACHED, T0)).toBe(true);
    expect(await recordGoldAnnouncement(t.db, { ...CACHED, round: 3 }, T0)).toBe(true);
    expect(await recordGoldAnnouncement(t.db, { ...CACHED, announcedAt: "2026-09-29T02:31:00.000Z" }, T0)).toBe(false);
    expect((await rows()).map((r) => r.round)).toEqual([2, 3, null]);
  });

  it("หลาย instance บันทึกประกาศเดียวกันพร้อมกัน → แถวเดียว · มีตัวเดียวที่ได้ true · ไม่มีตัวไหน error", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => recordGoldAnnouncement(t.db, NEXT, T0)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it("DB กันค่าที่ไม่ใช่ประกาศ: ครั้งที่ 0 / ราคา 0 / ติดลบ → check violation (23514) ไม่มีแถว", async () => {
    for (const bad of [
      { ...CACHED, round: 0 },
      { ...CACHED, barBuy: "0.00" },
      { ...CACHED, ornamentSell: "-1.00" },
    ]) {
      const e = await recordGoldAnnouncement(t.db, bad, T0).catch((x: unknown) => x);
      expect(pgError(e)?.code, JSON.stringify(bad)).toBe("23514");
    }
    expect(await rows()).toEqual([]);
  });

  it("เวลาประกาศผิดรูป (provider ตรวจแล้ว ไม่ควรมาถึง) → โยน error ไม่บันทึกเวลาเพี้ยน", async () => {
    await expect(recordGoldAnnouncement(t.db, { ...CACHED, announcedAt: "29/09/2569 09:31" }, T0)).rejects.toThrow();
    expect(await rows()).toEqual([]);
  });
});
