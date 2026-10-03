import { ROLES, type Role, auditLog, goldPrice, goldPriceSetting, user } from "@ong/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectApiError, expectMoneyAsStrings, moneyShapeViolations } from "../test/assertions";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import { openTransaction, waitForLockWait } from "../test/locks";
import { expectNoNationalId } from "../test/pii";
import { testName } from "../test/synthetic";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

/**
 * วันทำการแยกตามเรื่อง — ด่านพิมพ์ผิดเทียบวันก่อนหน้าล่าสุดที่มีค่า จึงให้ราคาทุกวันก่อน normalPrev ห่างกันไม่ถึง 3%
 * (ทอง 67,850–68,500 · เงิน 45.00–45.50 · แพลตตินั่ม 1,000–1,005.50)
 * ทุกเทสต์ตั้งข้อมูลของตัวเอง (ในเทสต์ หรือใส่ตรงใน DB ใน beforeAll) — รันเดี่ยวหรือสลับลำดับ (--sequence.shuffle.tests) ได้ผลเดิม
 */
const DAY = {
  noCentral: "2026-12-01", // ไม่มีราคากลาง — มีแค่ราคาเฉพาะสาขา 00001 (ใส่ตรงใน beforeAll)
  keep: "2026-12-02",
  blank: "2026-12-03",
  setting: "2026-12-04",
  branch: "2026-12-05",
  race: "2026-12-06",
  vanish: "2026-12-07",
  // ราคากลางใส่ตรงใน DB (ทอง 67,850 · เงิน 45.00 · แพลตตินั่ม 1,000.00) — คำขอที่ต้องถูกปฏิเสธ "แม้มีราคากลางแล้ว" (ไม่เขียนอะไร)
  rejected: "2026-12-08",
  normalPrev: "2026-12-14", // ครั้งก่อนของ normal: ทอง 67,900 · เงิน 45.00 · แพลตตินั่ม 1,000.00
  normal: "2026-12-15",
  typoPrev: "2026-12-20", // ครั้งก่อนของ typo: ทอง 67,900 · เงิน 45.00 · แพลตตินั่ม 1,000.00
  typo: "2026-12-21", // ราคากลางตั้งแล้วที่ทอง 76,000 — ห่างจาก typoPrev 11.9% (ถ้า quote ราคาทองซ้ำจะติดด่าน)
} as const;

/** ตั้งราคาได้เฉพาะ manager/admin (spec §10) — role อื่นทุกตัวต้องได้ 403 */
const PRICE_SETTERS: readonly Role[] = ["manager", "admin"];
const FORGED_COOKIE = "better-auth.session_token=forged.signature";

/** สัญญา API ที่เทสต์นี้ตรึงไว้ — เขียนตรงตัว ไม่ import จาก service */
const GOLD_FIRST = {
  error: "ต้องกรอกราคาทองแท่งขายออกของวันนี้ก่อน แล้วจึงบันทึกราคาเงิน/แพลตตินั่มอย่างเดียวได้",
  field: "bar_sell",
};
const PARSE_ERROR = { error: "ต้องส่ง bar_sell เป็นข้อความตัวเลข", field: "bar_sell" };
const FROM_REFERENCE_WITHOUT_GOLD = {
  error: "from_reference ใช้คู่กับ bar_sell เท่านั้น — ราคาสมาคมเป็นที่มาของราคาทอง",
  field: "from_reference",
};
const BAD_BAR_SELL = { error: "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0", field: "bar_sell" };
const PREFILL = { announced_at: "2026-12-15T09:31:00+07:00", round: 2 };

/**
 * ค่าทองที่ derive แล้ว (ส่วนต่าง 200 · รูปพรรณ × 0.95 ปัดครึ่งขึ้น) — คิดมือ · api = คำตอบ · db = numeric(14,2) ในแถว
 */
const GOLD = {
  g67850: { api: { bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268" }, db: "64268.00" }, // 64,267.50 → 64,268
  g67900: { api: { bar_sell: "67900.00", bar_buy: "67700.00", jewelry_buy: "64315" }, db: "64315.00" },
  g68000: { api: { bar_sell: "68000.00", bar_buy: "67800.00", jewelry_buy: "64410" }, db: "64410.00" },
  g76000: { api: { bar_sell: "76000.00", bar_buy: "75800.00", jewelry_buy: "72010" }, db: "72010.00" },
} as const;
/** ค่าทองของแถวในรูปที่ DB เก็บ (ค่า audit ก็รูปนี้) */
const dbGold = (g: (typeof GOLD)[keyof typeof GOLD]) => ({
  barSell: g.api.bar_sell,
  barBuy: g.api.bar_buy,
  jewelryBuy: g.db,
});
const auditGold = (g: (typeof GOLD)[keyof typeof GOLD]) => ({
  bar_sell: g.api.bar_sell,
  bar_buy: g.api.bar_buy,
  jewelry_buy: g.db,
});

/**
 * คำเตือนคิดมือ (เกณฑ์ seed typo_guard_percent = 3)
 * เงิน 45 → 50.50: 5.50 ÷ 45 × 100 = 12.22…% · แพลตตินั่ม 1,000 → 1,100: 10% · ทอง 67,900 → 76,000: 8,100 ÷ 67,900 = 11.92…%
 */
const WARN = {
  silver: "ราคาเงินห่างจากครั้งก่อน 12.2% (45 → 50.50) — ตรวจสอบก่อนบันทึก",
  platinum: "ราคาแพลตตินั่มห่างจากครั้งก่อน 10.0% (1000 → 1100) — ตรวจสอบก่อนบันทึก",
  gold: "ราคาห่างจากครั้งก่อน 11.9% (67900 → 76000) — ตรวจสอบก่อนบันทึก",
} as const;

describe.skipIf(!available)(
  "PUT /today ไม่ส่ง bar_sell: แก้แค่ราคาเงิน/แพลตตินั่มของราคากลาง · ค่าทองคงเดิม · ยังไม่มีราคากลาง = 400 (R8 · R12)",
  () => {
    let t: TestApp;
    let clock = new Date(`${DAY.noCentral}T03:00:00Z`);
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
      // manager/admin ที่สาขา 00000 · mgr1 ทำงานอยู่สาขา 00001 · role อื่นทุกตัวที่สาขา 00000
      const accounts: { who: string; role: Role; branch: string }[] = [
        { who: "manager", role: "manager", branch: "00000" },
        { who: "admin", role: "admin", branch: "00000" },
        { who: "mgr1", role: "manager", branch: "00001" },
        ...ROLES.filter((role) => !PRICE_SETTERS.includes(role)).map((role) => ({ who: role, role, branch: "00000" })),
      ];
      for (const { who, ...account } of accounts) {
        const email = `pgo-${who}@ong.test`;
        const created = await t.createUser({ email, password: PW, ...account });
        // ข้อมูลสมมติ: ชื่อขึ้นต้น "ทดสอบ"
        await t.db
          .update(user)
          .set({ name: testName(who) })
          .where(eq(user.id, created.id));
        ids[who] = created.id;
        cookies[who] = await t.login(email, PW);
      }
      await t.db.insert(goldPrice).values([
        // วันที่ยังไม่มีราคากลาง แต่สาขา 00001 ตั้งราคาของตัวเองแล้ว — แถวสาขาต้องไม่ถูกนับเป็นราคากลาง
        { branchId: bid("00001"), date: DAY.noCentral, barSell: "68500", barBuy: "68300", jewelryBuy: "64885" },
        {
          date: DAY.rejected,
          barSell: "67850",
          barBuy: "67650",
          jewelryBuy: "64268",
          silverPerG: "45.00",
          platinumPerG: "1000.00",
        },
        {
          date: DAY.normalPrev,
          barSell: "67900",
          barBuy: "67700",
          jewelryBuy: "64315",
          silverPerG: "45.00",
          platinumPerG: "1000.00",
        },
        {
          date: DAY.typoPrev,
          barSell: "67900",
          barBuy: "67700",
          jewelryBuy: "64315",
          silverPerG: "45.00",
          platinumPerG: "1000.00",
        },
        { date: DAY.typo, barSell: "76000", barBuy: "75800", jewelryBuy: "72010", silverPerG: "45.00" },
      ]);
    });
    afterAll(async () => {
      await t?.close();
    });

    const put = (who: string | undefined, body: unknown, origin?: string) =>
      t.request("/api/gold-price/today", { method: "PUT", cookie: who ? cookies[who] : undefined, body, origin });
    const putBranch = (who: string, branchId: string, body: unknown) =>
      t.request(`/api/gold-price/today/branches/${branchId}`, { method: "PUT", cookie: cookies[who], body });
    const quote = (body: unknown) => t.request("/api/gold-price/quote", { cookie: cookies.staff, body });
    /** 200 + JSON ที่เงินเป็น string ทั้งก้อน (กฎ 1) · ไม่มีเลขบัตร */
    const ok = async (res: Response, where: string): Promise<Record<string, unknown>> => {
      const text = await res.text();
      expect(res.status, `${where}: ${text.slice(0, 300)}`).toBe(200);
      expectNoNationalId(text, where);
      const body = JSON.parse(text) as Record<string, unknown>;
      expectMoneyAsStrings(body, where);
      return body;
    };
    const today = async (who: string, where: string) =>
      ok(await t.request("/api/gold-price/today", { cookie: cookies[who] }), `GET /today ${who} ${where}`);
    /** ทุกแถวของ gold_price + audit_log — พิสูจน์ว่า request ที่ถูกปฏิเสธไม่เขียนอะไรเลย */
    const writes = async () => ({
      prices: await t.db.select().from(goldPrice).orderBy(goldPrice.id),
      audits: await t.db.select().from(auditLog).orderBy(auditLog.id),
    });
    const centralRows = (date: string) =>
      t.db
        .select()
        .from(goldPrice)
        .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, date)));
    const centralRow = async (date: string) => {
      const rows = await centralRows(date);
      expect(rows, `ราคากลางของ ${date} ต้องมีแถวเดียว`).toHaveLength(1);
      return rows[0];
    };
    const goldOf = (row: { barSell: string; barBuy: string; jewelryBuy: string } | undefined) => ({
      barSell: row?.barSell,
      barBuy: row?.barBuy,
      jewelryBuy: row?.jewelryBuy,
    });
    /** วันที่มีราคากลางอยู่แล้ว (ใส่ใน beforeAll) — ยืนยันเงื่อนไขก่อน "ถูกปฏิเสธแม้มีราคากลาง" จึงจริงทุกลำดับการรัน */
    const onRejectedDay = async () => {
      onDay(DAY.rejected);
      expect(await centralRow(DAY.rejected), "ราคากลางที่ใส่ไว้ต้องยังอยู่").toMatchObject({
        ...dbGold(GOLD.g67850),
        silverPerG: "45.00",
        platinumPerG: "1000.00",
      });
    };
    /** audit ที่เพิ่มขึ้นหลัง snapshot */
    const auditsSince = async (before: Awaited<ReturnType<typeof writes>>) =>
      (await writes()).audits.slice(before.audits.length);

    it('ยังไม่มีราคากลางของวันนี้: ส่งแค่ราคาเงิน/แพลตตินั่ม (bar_sell ไม่ส่ง · null · "" · ช่องว่าง) → 400 ชี้ bar_sell ให้กรอกราคาทองก่อน · แถวราคาเฉพาะสาขาไม่นับ · ไม่เขียนอะไร', async () => {
      onDay(DAY.noCentral);
      // mgr1 ทำงานอยู่สาขา 00001 ซึ่งมีราคาของตัวเองวันนี้ — GET /today เห็นราคา แต่ราคากลางยังไม่มี
      expect(await today("mgr1", "ก่อน")).toMatchObject({ bar_sell: "68500.00", source: "branch" });
      expect(await expectApiError(await t.request("/api/gold-price/today", { cookie: cookies.manager }), 404)).toEqual({
        error: "ยังไม่ได้ตั้งราคาทองของวันนี้",
        date: DAY.noCentral,
      });
      const before = await writes();
      const bodies: Record<string, unknown>[] = [
        { silver_per_g: "45.50" },
        { platinum_per_g: "1000" },
        { silver_per_g: null },
        { bar_sell: null, silver_per_g: "45.50" },
        { bar_sell: "", platinum_per_g: "1000" },
        { bar_sell: "   ", silver_per_g: "45.50", platinum_per_g: "1000", confirm_typo: true },
        // ด่านนี้มาก่อนการตรวจราคาต่อกรัม (ลำดับเดียวกับหลายช่องผิด: bar_sell ก่อน)
        { silver_per_g: "abc" },
        { platinum_per_g: "100000", confirm_typo: true },
      ];
      for (const who of ["manager", "admin", "mgr1"]) {
        for (const body of bodies) {
          const where = `PUT โดย ${who} ${JSON.stringify(body)}`;
          expect(await expectApiError(await put(who, body), 400, where), where).toEqual(GOLD_FIRST);
        }
      }
      expect(await writes()).toEqual(before);
      expect(await centralRows(DAY.noCentral)).toEqual([]);
    });

    it("มีราคากลางแล้ว: ส่งแค่ราคาเงิน/แพลตตินั่ม → 200 · ค่าทองทุกตัวของแถวราคากลางเท่าเดิม · ช่องที่ไม่ส่งคงเดิม · GET /today ตาม · audit gold_price.update ก่อน/หลัง (R12)", async () => {
      onDay(DAY.keep);
      const set = await put("manager", { bar_sell: "67850", silver_per_g: "45.00", platinum_per_g: "1000" });
      expect(await ok(set, "ตั้งราคาทองก่อน")).toMatchObject(GOLD.g67850.api);
      const original = await centralRow(DAY.keep);

      const steps = [
        { label: "แก้ราคาเงิน · แพลตตินั่มไม่ส่ง = คงไว้", who: "admin", body: { silver_per_g: "45.50" } },
        { label: "แก้แพลตตินั่ม · เงินไม่ส่ง = คงไว้", who: "manager", body: { platinum_per_g: "1,005.50" } },
        { label: "ล้างราคาเงินด้วย null", who: "admin", body: { silver_per_g: null } },
        {
          label: 'ตั้งเงินคืน + ล้างแพลตตินั่มด้วย ""',
          who: "manager",
          body: { silver_per_g: "45.25", platinum_per_g: "" },
        },
        {
          label: "ทั้งคู่พร้อมกัน + confirm_typo (ไม่มีคำเตือน)",
          who: "admin",
          body: { silver_per_g: "45.40", platinum_per_g: "1002", confirm_typo: true },
        },
      ] as const;
      const expectedPerGram = [
        { silver: "45.50", platinum: "1000.00" },
        { silver: "45.50", platinum: "1005.50" },
        { silver: null, platinum: "1005.50" },
        { silver: "45.25", platinum: null },
        { silver: "45.40", platinum: "1002.00" },
      ];
      let previous = { silver: "45.00" as string | null, platinum: "1000.00" as string | null, setBy: uid("manager") };
      for (const [i, step] of steps.entries()) {
        const want = expectedPerGram[i] ?? { silver: null, platinum: null };
        const before = await writes();
        const expected = {
          date: DAY.keep,
          ...GOLD.g67850.api,
          silver_per_g: want.silver,
          platinum_per_g: want.platinum,
          diff: "200.00",
          source: "central",
        };
        expect(await ok(await put(step.who, step.body), `PUT ${step.label}`), step.label).toEqual(expected);
        expect(await today("staff", step.label), step.label).toEqual(expected);

        // แถวเดิม (ไม่สร้างแถวใหม่) · ค่าทองตรงกับตอนตั้งทุกตัว · ผู้ตั้ง = คนที่บันทึกล่าสุด (แบบเดียวกับ PUT ที่ส่ง bar_sell)
        const row = await centralRow(DAY.keep);
        expect(row, step.label).toMatchObject({
          id: original?.id,
          ...goldOf(original),
          silverPerG: want.silver,
          platinumPerG: want.platinum,
          setBy: uid(step.who),
          createdAt: original?.createdAt,
        });

        const added = await auditsSince(before);
        expect(added, step.label).toMatchObject([
          { action: "gold_price.update", tableName: "gold_price", rowId: original?.id, userId: uid(step.who) },
        ]);
        // รูปเดิมของ audit ราคากลาง · ไม่มีคีย์ reference (ไม่ได้ตั้งราคาทอง จึงไม่มีราคาทองให้อ้างราคาสมาคม)
        expect(added[0]?.diff, step.label).toEqual({
          date: DAY.keep,
          before: {
            ...auditGold(GOLD.g67850),
            silver_per_g: previous.silver,
            platinum_per_g: previous.platinum,
            set_by: previous.setBy,
          },
          after: {
            ...auditGold(GOLD.g67850),
            silver_per_g: want.silver,
            platinum_per_g: want.platinum,
            set_by: uid(step.who),
          },
          typo_warning_confirmed: false,
        });
        expect(moneyShapeViolations(added[0]?.diff), step.label).toEqual([]);
        expectNoNationalId(JSON.stringify(added[0]?.diff), `audit ${step.label}`);
        previous = { silver: want.silver, platinum: want.platinum, setBy: uid(step.who) };
      }
    });

    it('bar_sell เป็น null · "" · ช่องว่างล้วน = ไม่ส่ง (มีราคากลางแล้ว) → บันทึกแค่ราคาต่อกรัม ค่าทองเดิมทุกตัว', async () => {
      onDay(DAY.blank);
      expect((await put("manager", { bar_sell: "67900", silver_per_g: "45.00" })).status).toBe(200);
      for (const [bar_sell, silver] of [
        [null, "45.10"],
        ["", "45.20"],
        ["   ", "45.30"],
      ] as const) {
        const where = `bar_sell=${JSON.stringify(bar_sell)}`;
        const body = await ok(await put("manager", { bar_sell, silver_per_g: silver }), where);
        expect(body, where).toMatchObject({ ...GOLD.g67900.api, silver_per_g: silver, source: "central" });
        expect(await centralRow(DAY.blank), where).toMatchObject({ ...dbGold(GOLD.g67900), silverPerG: silver });
      }
    });

    it('ไม่มีราคาให้บันทึกเลย ({} · bar_sell null/"" อย่างเดียว · confirm_typo อย่างเดียว) → 400 เดิมของ bar_sell แม้มีราคากลางแล้ว · ไม่เขียนอะไร', async () => {
      await onRejectedDay();
      const before = await writes();
      for (const body of [{}, { bar_sell: null }, { bar_sell: "" }, { bar_sell: "  " }, { confirm_typo: true }]) {
        const where = `PUT ${JSON.stringify(body)}`;
        expect(await expectApiError(await put("manager", body), 400, where), where).toEqual(PARSE_ERROR);
      }
      expect(await writes()).toEqual(before);
    });

    it("from_reference (ที่มาของราคาทอง) มากับคำขอที่ไม่ได้ตั้งราคาทอง → 400 ชี้ from_reference (ไม่ทิ้งเงียบ ๆ) · ไม่เขียนอะไร", async () => {
      await onRejectedDay();
      const before = await writes();
      for (const body of [
        { silver_per_g: "45.50", from_reference: PREFILL },
        { bar_sell: null, platinum_per_g: "1000", from_reference: PREFILL },
      ]) {
        const where = `PUT ${JSON.stringify(body)}`;
        expect(await expectApiError(await put("manager", body), 400, where), where).toEqual(
          FROM_REFERENCE_WITHOUT_GOLD,
        );
      }
      expect(await writes()).toEqual(before);
    });

    it("ไม่ได้ตั้งราคาทอง + ช่องที่ไม่รู้จัก (สะกดผิด · ค่าทอง · branch_id · ช่องของระบบ) → 400 ชี้ชื่อช่องนั้น แม้มีราคาเงินมาด้วยและมีราคากลางแล้ว · ราคากลางและ audit ไม่เปลี่ยน (API3)", async () => {
      await onRejectedDay();
      const before = await writes();
      const unknownField = (...keys: string[]) => ({ error: `ไม่รู้จักช่อง ${keys.join(", ")}`, field: keys[0] ?? "" });
      const cases: [Record<string, unknown>, { error: string; field: string }][] = [
        // ก่อน bar_sell จะไม่บังคับ body เหล่านี้ได้ 400 เพราะขาด bar_sell — ต้องไม่กลายเป็น 200 ที่บันทึกแค่ราคาเงิน
        [{ barSell: "68000", silver_per_g: "45.10" }, unknownField("barSell")],
        [{ bar_sel: "68000", silver_per_g: "45.10" }, unknownField("bar_sel")],
        [{ bar_buy: "1.00", jewelry_buy: "1", silver_per_g: "45.10" }, unknownField("bar_buy", "jewelry_buy")],
        // ราคาต่อกรัมตั้งได้ที่ราคากลางเท่านั้น — ใส่ branch_id มาต้องไม่ไปเปลี่ยนราคาเงินของทุกสาขา
        [{ branch_id: bid("00001"), silver_per_g: "30.00" }, unknownField("branch_id")],
        [{ bar_sell: null, barSell: "68000", platinum_per_g: "1000" }, unknownField("barSell")],
        [{ bar_sell: "", diff: "0", silver_per_g: "45.10", confirm_typo: true }, unknownField("diff")],
        [{ barSell: "68000" }, unknownField("barSell")],
        // ช่องเกินข้างใน from_reference ยังชี้ from_reference (ไม่ใช่ชื่อช่องข้างใน)
        [
          { silver_per_g: "45.10", from_reference: { ...PREFILL, bar_sell: "1" } },
          { error: "from_reference ต้องมี announced_at และ round ของประกาศ", field: "from_reference" },
        ],
        [
          { silver_per_g: "45.10", set_by: uid("admin"), date: "2026-01-01", source: "branch" },
          unknownField("set_by", "date", "source"),
        ],
      ];
      for (const who of ["manager", "admin", "mgr1"]) {
        for (const [body, expected] of cases) {
          const where = `PUT โดย ${who} ${JSON.stringify(body)}`;
          expect(await expectApiError(await put(who, body), 400, where), where).toEqual(expected);
        }
      }
      expect(await writes()).toEqual(before);
      expect(await centralRow(DAY.rejected)).toMatchObject({
        ...dbGold(GOLD.g67850),
        silverPerG: "45.00",
        platinumPerG: "1000.00",
      });

      // วันที่ยังไม่มีราคากลาง: ช่องที่สะกดผิดถูกชี้ก่อน "กรอกราคาทองก่อน" (บอกให้แก้ชื่อช่อง ไม่ใช่ให้กรอกซ้ำ)
      onDay(DAY.noCentral);
      const typo = await put("manager", { barSell: "68000", silver_per_g: "45.10" });
      expect(await expectApiError(typo, 400, "ไม่มีราคากลาง + สะกดผิด")).toEqual(unknownField("barSell"));
      expect(await writes()).toEqual(before);
    });

    it("ราคาต่อกรัมผิดรูป (มีราคากลางแล้ว) → 400 ชี้ช่องนั้น ข้อความเดียวกับตอนส่ง bar_sell · ตัวเลข JSON = 400 (กฎ 1) · ไม่เขียนอะไร", async () => {
      await onRejectedDay();
      const before = await writes();
      const cases: [Record<string, unknown>, { error: string; field: string }][] = [
        [{ silver_per_g: "abc" }, { error: "ราคาเงินต่อกรัมต้องเป็นตัวเลขมากกว่า 0", field: "silver_per_g" }],
        [{ silver_per_g: "0" }, { error: "ราคาเงินต่อกรัมต้องเป็นตัวเลขมากกว่า 0", field: "silver_per_g" }],
        [{ silver_per_g: "45.555" }, { error: "ราคาทศนิยมไม่เกิน 2 ตำแหน่ง", field: "silver_per_g" }],
        [
          { platinum_per_g: "100000", confirm_typo: true },
          { error: "ราคาแพลตตินั่มต่อกรัมสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง", field: "platinum_per_g" },
        ],
        [
          { silver_per_g: 45.5 },
          { error: "ต้องส่ง silver_per_g เป็นข้อความตัวเลข หรือ null เพื่อล้าง", field: "silver_per_g" },
        ],
        [{ bar_sell: 67850, silver_per_g: "45.50" }, PARSE_ERROR],
      ];
      for (const [body, expected] of cases) {
        const where = `PUT ${JSON.stringify(body)}`;
        expect(await expectApiError(await put("manager", body), 400, where), where).toEqual(expected);
      }
      expect(await writes()).toEqual(before);
    });

    it("ค่าตั้งเปลี่ยนหลังตั้งราคาทอง (ส่วนต่าง 200 → 300): แก้แค่ราคาเงิน ค่าทองของแถวไม่ถูกคำนวณใหม่", async () => {
      onDay(DAY.setting);
      expect((await put("manager", { bar_sell: "67850", silver_per_g: "45.00" })).status).toBe(200);
      const original = await centralRow(DAY.setting);
      await t.db.update(goldPriceSetting).set({ diff: "300" }).where(eq(goldPriceSetting.id, 1));
      try {
        // สูตรตอนนี้ให้ค่าอื่นแล้ว (67,850 − 300 = 67,550 × 0.95 = 64,172.50 → 64,173) — quote เท่านั้น ไม่บันทึก
        expect(await ok(await quote({ bar_sell: "67850" }), "quote หลังเปลี่ยนค่าตั้ง")).toMatchObject({
          bar_buy: "67550.00",
          jewelry_buy: "64173",
        });
        const body = await ok(await put("manager", { silver_per_g: "45.20" }), "PUT แค่ราคาเงิน");
        expect(body).toMatchObject({ ...GOLD.g67850.api, silver_per_g: "45.20", source: "central" });
        expect(await centralRow(DAY.setting)).toMatchObject({ ...goldOf(original), silverPerG: "45.20" });
      } finally {
        await t.db.update(goldPriceSetting).set({ diff: "200" }).where(eq(goldPriceSetting.id, 1));
      }
    });

    it("มีราคาเฉพาะสาขา: ผู้จัดการที่ทำงานอยู่สาขานั้นแก้แค่ราคาเงิน → แถวราคากลางเก็บค่าทองของราคากลางเดิม (ไม่คัดลอกจากแถวสาขา) · แถวสาขาไม่ถูกแตะ · GET /today แต่ละสาขาถูกต้อง", async () => {
      onDay(DAY.branch);
      expect((await put("manager", { bar_sell: "67900", silver_per_g: "45.00", platinum_per_g: "1000" })).status).toBe(
        200,
      );
      expect((await putBranch("mgr1", bid("00001"), { bar_sell: "68500" })).status).toBe(200);
      const branchRow = async () => {
        const [row] = await t.db
          .select()
          .from(goldPrice)
          .where(and(eq(goldPrice.branchId, bid("00001")), eq(goldPrice.date, DAY.branch)));
        return row;
      };
      const branchBefore = await branchRow();
      expect(branchBefore).toMatchObject({ barSell: "68500.00", barBuy: "68300.00", jewelryBuy: "64885.00" });
      // ราคาที่ mgr1 เห็นตอนนี้คือราคาของสาขา 00001
      expect(await today("mgr1", "ก่อนแก้")).toMatchObject({ bar_sell: "68500.00", source: "branch" });

      const res = await put("mgr1", { silver_per_g: "45.50" });
      // คำตอบของ PUT /today = ราคากลางเสมอ (เหมือนเดิม) — ไม่ใช่ราคาของสาขาที่ทำงานอยู่
      expect(await ok(res, "PUT แค่ราคาเงิน โดย mgr1")).toEqual({
        date: DAY.branch,
        ...GOLD.g67900.api,
        silver_per_g: "45.50",
        platinum_per_g: "1000.00",
        diff: "200.00",
        source: "central",
      });
      expect(await centralRow(DAY.branch)).toMatchObject({
        ...dbGold(GOLD.g67900),
        silverPerG: "45.50",
        platinumPerG: "1000.00",
      });
      expect(await branchRow()).toEqual(branchBefore);
      // สาขา 00001 ยังใช้ราคาทองของตัวเอง + ราคาต่อกรัมของราคากลาง · สาขา 00000 ใช้ราคากลางทั้งหมด
      expect(await today("mgr1", "หลังแก้")).toEqual({
        date: DAY.branch,
        bar_sell: "68500.00",
        bar_buy: "68300.00",
        jewelry_buy: "64885",
        silver_per_g: "45.50",
        platinum_per_g: "1000.00",
        diff: "200.00",
        source: "branch",
      });
      expect(await today("staff", "หลังแก้")).toMatchObject({
        ...GOLD.g67900.api,
        silver_per_g: "45.50",
        source: "central",
      });
    });

    it('PUT ราคาเฉพาะสาขายังบังคับ bar_sell: ไม่ส่ง · null · "" (มีหรือไม่มีราคาเงินมาด้วย) → 400 ชี้ bar_sell · ไม่เขียนทับแถวราคากลาง · ไม่เขียนอะไร', async () => {
      onDay(DAY.branch);
      const before = await writes();
      const cases: [Record<string, unknown>, { error: string; field: string }][] = [
        [{}, PARSE_ERROR],
        [{ silver_per_g: "45.50" }, PARSE_ERROR],
        [{ platinum_per_g: null, confirm_typo: true }, PARSE_ERROR],
        [{ bar_sell: null }, PARSE_ERROR],
        [{ bar_sell: null, silver_per_g: "45.50" }, PARSE_ERROR],
        [{ bar_sell: "" }, BAD_BAR_SELL],
        [{ bar_sell: "   ", confirm_typo: true }, BAD_BAR_SELL],
      ];
      // สาขาที่แต่ละคนมีสิทธิ์: 00001 มีราคาของสาขาแล้ว · 00000 ยังใช้ราคากลาง
      for (const [who, code] of [
        ["mgr1", "00001"],
        ["admin", "00000"],
      ] as const) {
        for (const [body, expected] of cases) {
          const where = `PUT /today/branches/${code} โดย ${who} ${JSON.stringify(body)}`;
          const res = await putBranch(who, bid(code), body);
          expect(await expectApiError(res, 400, where), where).toEqual(expected);
        }
      }
      // วันที่ยังไม่มีราคากลาง (มีแค่ราคาสาขา) ก็เหมือนกัน
      onDay(DAY.noCentral);
      const res = await putBranch("mgr1", bid("00001"), { silver_per_g: "45.50" });
      expect(await expectApiError(res, 400, "ไม่มีราคากลาง")).toEqual(PARSE_ERROR);
      expect(await writes()).toEqual(before);
    });

    it("สิทธิ์เหมือนเดิม: role ที่ตั้งราคาไม่ได้ = 403 (ตัดสินก่อนดู body) แม้มีราคากลางแล้ว · ไม่ login/cookie ปลอม = 401 · origin อื่น = 403 · ไม่เขียนอะไร", async () => {
      await onRejectedDay();
      const before = await writes();
      const bodies = [{ silver_per_g: "45.50" }, { platinum_per_g: null }, { bar_sell: null, silver_per_g: "45.50" }];
      for (const role of ROLES.filter((r) => !PRICE_SETTERS.includes(r))) {
        for (const body of bodies) {
          const where = `PUT โดย ${role} ${JSON.stringify(body)}`;
          expect(await expectApiError(await put(role, body), 403, where), where).toEqual({ error: "forbidden" });
        }
      }
      for (const body of bodies) {
        expect(await expectApiError(await put(undefined, body), 401, "ไม่มี cookie")).toEqual({
          error: "unauthorized",
        });
        const forged = await t.request("/api/gold-price/today", { method: "PUT", cookie: FORGED_COOKIE, body });
        expect(await expectApiError(forged, 401, "cookie ปลอม")).toEqual({ error: "unauthorized" });
        expect(await expectApiError(await put("manager", body, "https://evil.example"), 403, "origin อื่น")).toEqual({
          error: "forbidden origin",
        });
      }
      expect(await writes()).toEqual(before);
    });

    it("อีกคนเปลี่ยนราคาทองระหว่างที่คำขอแก้ราคาเงินรอล็อกอยู่ → ราคาทองใหม่ไม่ถูกทับด้วยค่าที่อ่านไว้ก่อน (ไม่มี lost update) · audit before = ค่าใต้ล็อก", async () => {
      onDay(DAY.race);
      expect((await put("manager", { bar_sell: "67850", silver_per_g: "45.00" })).status).toBe(200);
      const before = await writes();
      // ทรานแซกชันค้าง (ยังไม่ commit) เปลี่ยนราคาทองของแถวราคากลาง → ถือ row lock ไว้
      const held = await openTransaction(t.db);
      let committed = false;
      try {
        await held.sql`update gold_price set bar_sell = '68000', bar_buy = '67800', jewelry_buy = '64410'
                         where branch_id is null and date = ${DAY.race}`;
        const pending = Promise.resolve(put("admin", { silver_per_g: "45.50" }));
        await waitForLockWait(t.db, 1); // คำขอผ่านด่านแรก (เห็นแถวเดิม) แล้วรอล็อกอยู่จริง
        await held.commit();
        committed = true;
        const body = await ok(await pending, "PUT แค่ราคาเงิน หลังรอล็อก");
        expect(body).toMatchObject({ ...GOLD.g68000.api, silver_per_g: "45.50", source: "central" });
      } finally {
        if (!committed) await held.commit();
      }
      expect(await centralRow(DAY.race)).toMatchObject({ ...dbGold(GOLD.g68000), silverPerG: "45.50" });
      // update ดิบของทรานแซกชันค้างไม่ลง audit — เพิ่มแค่ของคำขอนี้แถวเดียว
      const added = await auditsSince(before);
      expect(added).toMatchObject([{ action: "gold_price.update", userId: uid("admin") }]);
      expect(added[0]?.diff).toMatchObject({
        before: { ...auditGold(GOLD.g68000), silver_per_g: "45.00" },
        after: { ...auditGold(GOLD.g68000), silver_per_g: "45.50" },
      });
    });

    it("ราคากลางหายไประหว่างที่คำขอรอล็อก (หลังผ่านด่านแรกแล้ว) → 400 ชี้ bar_sell · ไม่สร้างแถวที่ไม่มีราคาทอง · ไม่ลง audit", async () => {
      onDay(DAY.vanish);
      expect((await put("manager", { bar_sell: "67850", silver_per_g: "45.00" })).status).toBe(200);
      const held = await openTransaction(t.db);
      let committed = false;
      let pending: Promise<Response> | null = null;
      const before = await writes();
      try {
        // เช่นผู้ดูแลลบผ่าน SQL — แอปไม่มีทางลบราคากลาง แต่ด่านใต้ล็อกต้องไม่พึ่งข้อนั้น
        await held.sql`delete from gold_price where branch_id is null and date = ${DAY.vanish}`;
        pending = Promise.resolve(put("manager", { silver_per_g: "45.50" }));
        await waitForLockWait(t.db, 1);
        await held.commit();
        committed = true;
        expect(await expectApiError(await pending, 400, "แถวหายระหว่างรอ")).toEqual(GOLD_FIRST);
      } finally {
        if (!committed) await held.commit();
        await pending?.catch(() => undefined);
      }
      expect(await centralRows(DAY.vanish)).toEqual([]);
      expect((await writes()).audits).toEqual(before.audits);
    });

    it("ส่ง bar_sell ตามปกติ → ทำงานเหมือนเดิม: derive ค่าทอง · ราคาต่อกรัมที่ไม่ส่งคงไว้ · ด่านพิมพ์ผิดราคาทอง 409 · from_reference ยังรับ · audit create/update", async () => {
      onDay(DAY.normal);
      const start = await writes();
      const created = await put("manager", {
        bar_sell: "67,850.50",
        silver_per_g: "45.5",
        platinum_per_g: "1,000",
        from_reference: PREFILL,
      });
      // 67,850.50 − 200 = 67,650.50 × 0.95 = 64,267.975 → 64,268
      expect(await ok(created, "สร้าง")).toEqual({
        date: DAY.normal,
        bar_sell: "67850.50",
        bar_buy: "67650.50",
        jewelry_buy: "64268",
        silver_per_g: "45.50",
        platinum_per_g: "1000.00",
        diff: "200.00",
        source: "central",
      });
      const createAudits = await auditsSince(start);
      expect(createAudits).toMatchObject([
        { action: "gold_price.create", tableName: "gold_price", userId: uid("manager") },
      ]);
      expect(createAudits[0]?.diff).toEqual({
        date: DAY.normal,
        before: null,
        after: {
          bar_sell: "67850.50",
          bar_buy: "67650.50",
          jewelry_buy: "64268.00",
          silver_per_g: "45.50",
          platinum_per_g: "1000.00",
          set_by: uid("manager"),
        },
        typo_warning_confirmed: false,
        // แหล่งราคาสมาคมปิดอยู่ในเทสต์ → บันทึกแค่คำอ้างของ client (รูปเดิม)
        reference: {
          client_prefilled: true,
          client_announced_at: PREFILL.announced_at,
          client_round: PREFILL.round,
          server_seen: null,
          saved_matches_server_bar_sell: null,
          client_matches_server_announcement: null,
        },
      });

      // ส่ง bar_sell ใหม่ → derive ใหม่จากค่านั้น · ราคาต่อกรัมที่ไม่ส่งคงไว้
      expect(await ok(await put("admin", { bar_sell: "67900" }), "แก้ราคาทอง")).toEqual({
        date: DAY.normal,
        ...GOLD.g67900.api,
        silver_per_g: "45.50",
        platinum_per_g: "1000.00",
        diff: "200.00",
        source: "central",
      });
      expect(await centralRow(DAY.normal)).toMatchObject({ ...dbGold(GOLD.g67900), setBy: uid("admin") });

      // ด่านพิมพ์ผิดราคาทองยังเทียบราคากลางครั้งก่อน (normalPrev 67,900)
      const before = await writes();
      expect(await expectApiError(await put("manager", { bar_sell: "76000" }), 409, "ทองห่างเกินเกณฑ์")).toEqual({
        error: WARN.gold,
        field: "confirm_typo",
        warning: WARN.gold,
      });
      expect(await writes()).toEqual(before);
      const confirmed = await put("manager", { bar_sell: "76000", confirm_typo: true });
      expect(await ok(confirmed, "ยืนยัน")).toMatchObject({ ...GOLD.g76000.api, silver_per_g: "45.50" });
      const added = await auditsSince(before);
      expect(added).toMatchObject([{ action: "gold_price.update", userId: uid("manager") }]);
      expect(added[0]?.diff).toMatchObject({
        before: auditGold(GOLD.g67900),
        after: auditGold(GOLD.g76000),
        typo_warning_confirmed: true,
      });
    });

    it("ด่านพิมพ์ผิดของราคาต่อกรัมยังทำงาน (quoteGoldPrice ตัวเดียวกัน): 409 ชี้ confirm_typo จนกว่าจะยืนยัน · ราคาทองที่คงไว้ไม่ถูกเตือน · ยืนยันแล้ว audit typo_warning_confirmed", async () => {
      onDay(DAY.typo);
      // เทียบ: quote ที่ส่งราคาทองมาด้วยเตือนราคาทอง (76,000 ห่างจาก 67,900) — คำขอที่ไม่ส่ง bar_sell ต้องไม่มีข้อความนี้
      expect(await ok(await quote({ bar_sell: "76000", silver_per_g: "50.50" }), "quote เทียบ")).toMatchObject({
        warning: `${WARN.gold} · ${WARN.silver}`,
      });
      const before = await writes();
      for (const [body, warning] of [
        [{ silver_per_g: "50.50" }, WARN.silver],
        [{ platinum_per_g: "1100" }, WARN.platinum],
        [{ silver_per_g: "50.50", platinum_per_g: "1100" }, `${WARN.silver} · ${WARN.platinum}`],
        [{ bar_sell: "", silver_per_g: "50.50", confirm_typo: false }, WARN.silver],
      ] as const) {
        const where = `PUT ${JSON.stringify(body)}`;
        expect(await expectApiError(await put("manager", body), 409, where), where).toEqual({
          error: warning,
          field: "confirm_typo",
          warning,
        });
      }
      expect(await writes()).toEqual(before);

      const confirmed = await put("manager", { silver_per_g: "50.50", confirm_typo: true });
      expect(await ok(confirmed, "ยืนยัน")).toMatchObject({
        ...GOLD.g76000.api,
        silver_per_g: "50.50",
        platinum_per_g: null,
        source: "central",
      });
      expect(await centralRow(DAY.typo)).toMatchObject({ ...dbGold(GOLD.g76000), silverPerG: "50.50" });
      const added = await auditsSince(before);
      expect(added).toMatchObject([{ action: "gold_price.update", tableName: "gold_price", userId: uid("manager") }]);
      expect(added[0]?.diff).toEqual({
        date: DAY.typo,
        before: {
          ...auditGold(GOLD.g76000),
          silver_per_g: "45.00",
          platinum_per_g: null,
          set_by: null,
        },
        after: {
          ...auditGold(GOLD.g76000),
          silver_per_g: "50.50",
          platinum_per_g: null,
          set_by: uid("manager"),
        },
        typo_warning_confirmed: true,
      });
    });
  },
);
