import { auditLog, goldPrice, user } from "@ong/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ApiErrorBody, expectApiError, expectMoneyAsStrings } from "../test/assertions";
import { type TestApp, type TestUser, databaseAvailable, startTestApp } from "../test/harness";
import { testName } from "../test/synthetic";

const available = await databaseAvailable();
const PW = "correct-horse-battery";
const NO_UUID = "00000000-0000-4000-8000-000000000000";

/**
 * วันทำการแยกตามเรื่อง — เทสต์ที่เขียนข้อมูลเขียนลงวันของตัวเองเท่านั้น · "ไม่เขียนอะไร" ตรวจจากภาพก่อน/หลังภายในเทสต์เดียวกัน
 * ราคาทุกตัวอยู่ในช่วง 67,850–67,950 (ห่างกันไม่ถึง 3%) ด่านพิมพ์ผิดจึงไม่เตือนไม่ว่าเทสต์ไหนรันก่อน
 * quote อยู่วันแรกสุด: ไม่มีวันก่อนหน้าที่มีราคาเลย (ไม่มีคำเตือน) — รันเดี่ยวหรือสลับลำดับ (--sequence.shuffle.tests) ได้ผลเดิม
 */
const DAY = {
  quote: "2027-01-04", // quote อย่างเดียว ไม่เขียน — ต้องเป็นวันแรกสุด
  branch: "2027-01-05", // ราคาเฉพาะสาขา: ปฏิเสธช่องที่ไม่รู้จัก แล้วคำขอปกติเขียนลงวันนี้
} as const;

/** สัญญา API ที่เทสต์นี้ตรึงไว้ — เขียนตรงตัว ไม่ import จาก route/service */
const PARSE_ERROR = { error: "ต้องส่ง bar_sell เป็นข้อความตัวเลข", field: "bar_sell" };
const BRANCH_ID_ERROR = { error: "branch_id ไม่ถูกต้อง", field: "branch_id" };
const FROM_REFERENCE_ERROR = {
  error: "from_reference ต้องมี announced_at และ round ของประกาศ",
  field: "from_reference",
};
const BRANCH_ONLY = "ราคาเงิน/แพลตตินั่มต่อกรัมตั้งได้ที่ราคากลางเท่านั้น";
const notText = (field: string) => ({ error: `ต้องส่ง ${field} เป็นข้อความตัวเลข หรือ null เพื่อล้าง`, field });
/** 400 ของช่องระดับบนสุดที่ไม่รู้จัก — ข้อความแบบ routes/admin.ts · field = ช่องแรกที่ไม่รู้จักตามลำดับใน body */
const unknownField = (...keys: string[]) => ({ error: `ไม่รู้จักช่อง ${keys.join(", ")}`, field: keys[0] ?? "" });
/** ประกาศสมาคมที่ browser เติมมา (from_reference) — ช่องที่รู้จักของ PUT ทั้งสอง แต่ไม่ใช่ของ quote */
const PREFILL = { announced_at: "2027-01-05T09:31:00+07:00", round: 1 };

/** ค่าทองที่ derive แล้ว (ส่วนต่าง 200 · รูปพรรณ × 0.95 ปัดครึ่งขึ้น บาทเต็ม) — คิดมือ */
const G67850 = { bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268" }; // 67,650 × 0.95 = 64,267.50
const G67900 = { bar_sell: "67900.00", bar_buy: "67700.00", jewelry_buy: "64315" }; // 67,700 × 0.95 = 64,315
const G67950 = { bar_sell: "67950.00", bar_buy: "67750.00", jewelry_buy: "64363" }; // 67,750 × 0.95 = 64,362.50
const NO_PER_GRAM = { silver_per_g: null, platinum_per_g: null };

const QUOTE = "/api/gold-price/quote";
const branchPath = (branchId: string) => `/api/gold-price/today/branches/${branchId}`;

describe.skipIf(!available)(
  "ด่าน body ของราคาทอง: ช่องที่ไม่รู้จัก (ราคาเฉพาะสาขา · quote) (API3 · ASVS V5.1.2)",
  () => {
    let t: TestApp;
    let clock = new Date(`${DAY.quote}T03:00:00Z`);
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
      // manager: สาขาหลัก 00000 + อนุญาต 00001 (ตั้งราคาเฉพาะสาขา 00001 ได้ · 00002 ไม่ได้) · admin ดูทุกสาขา
      const accounts: (TestUser & { who: string })[] = [
        {
          who: "manager",
          email: "gb-manager@ong.test",
          password: PW,
          role: "manager",
          branch: "00000",
          allow: ["00001"],
        },
        { who: "admin", email: "gb-admin@ong.test", password: PW, role: "admin", branch: "00000", viewAll: true },
        { who: "staff", email: "gb-staff@ong.test", password: PW, role: "staff", branch: "00000" },
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
    });
    afterAll(async () => {
      await t?.close();
    });

    const quote = (who: string, body: unknown) => t.request(QUOTE, { method: "POST", cookie: cookies[who], body });
    const putBranch = (who: string, branchId: string, body: unknown) =>
      t.request(branchPath(branchId), { method: "PUT", cookie: cookies[who], body });
    /** request ดิบ: body เป็นข้อความตามที่ส่ง (เช่น JSON ที่มีช่อง "__proto__" จริง) · origin ไม่ส่ง = origin ของแอป */
    const raw = (
      method: string,
      path: string,
      init: { who?: string; body?: string; contentType?: string; origin?: string },
    ) => {
      const headers: Record<string, string> = {
        "content-type": init.contentType ?? "application/json",
        origin: init.origin ?? new URL(t.env.BETTER_AUTH_URL).origin,
      };
      const cookie = init.who ? cookies[init.who] : undefined;
      if (cookie) headers.cookie = cookie;
      return t.app.request(path, { method, headers, body: init.body });
    };
    /** ทุกแถวของ gold_price + audit_log — พิสูจน์ว่า request ที่ถูกปฏิเสธไม่เขียนอะไรเลย */
    const writes = async () => ({
      prices: await t.db.select().from(goldPrice).orderBy(goldPrice.id),
      audits: await t.db.select().from(auditLog).orderBy(auditLog.id),
    });
    it("PUT /today/branches/:id — ช่องที่ไม่รู้จัก (สะกด silver_per_gram · branch_id ใน body · ค่าที่ derive · ช่องของระบบ) = 400 ชี้ช่องแรก ทั้ง manager และ admin · ไม่เขียนแถวสาขา ไม่ลง audit · ด่านราคาต่อกรัมของสาขาเหมือนเดิม · คำขอปกติยัง 200", async () => {
      onDay(DAY.branch);
      const b1 = bid("00001");
      const before = await writes();
      // ช่องที่รู้จักในทุก body ถูกต้อง — ถ้าช่องเกินถูกตัดทิ้งเงียบ ๆ ทุก body จะได้ 200 และเขียนราคาเฉพาะสาขา + audit จริง
      const cases: [Record<string, unknown>, ApiErrorBody][] = [
        // สะกดชื่อช่องผิด — ถ้าตัดทิ้งจะบันทึกราคาทองของสาขาเหมือนไม่ได้ส่งช่องนั้น
        [{ bar_sell: "67900", silver_per_gram: "45.10" }, unknownField("silver_per_gram")],
        [{ bar_sell: "67900", barSell: "68000" }, unknownField("barSell")],
        [{ bar_sell: "67900", confirmTypo: true }, unknownField("confirmTypo")],
        [{ bar_sell: "67900", fromReference: PREFILL }, unknownField("fromReference")],
        // สาขามาจาก path เท่านั้น — branch_id ใน body (สาขาอื่นหรือสาขาเดียวกัน) = ช่องที่ไม่รู้จัก
        [{ bar_sell: "67900", branch_id: bid("00000") }, unknownField("branch_id")],
        [{ bar_sell: "67900", branch_id: b1 }, unknownField("branch_id")],
        // ค่าที่เซิร์ฟเวอร์ derive เอง (R8) · ช่องของระบบ — หลายช่องพร้อมกันชี้ช่องแรก
        [{ bar_sell: "67900", bar_buy: "1.00", jewelry_buy: "1" }, unknownField("bar_buy", "jewelry_buy")],
        [
          { bar_sell: "67900", diff: "0", date: "2026-01-01", set_by: uid("admin"), source: "central" },
          unknownField("diff", "date", "set_by", "source"),
        ],
        // ช่องที่รู้จักของหน้าเว็บครบ (bar_sell · confirm_typo · from_reference) + ช่องเกินช่องเดียว ก็ยัง 400
        [{ bar_sell: "67900", confirm_typo: true, from_reference: PREFILL, id: NO_UUID }, unknownField("id")],
        // ราคาต่อกรัม (ช่องที่รู้จัก) + ช่องที่ไม่รู้จัก → ตรวจรูป body ก่อน จึงชี้ช่องที่ไม่รู้จักก่อนด่านราคาต่อกรัมของสาขา
        [{ bar_sell: "67900", silver_per_g: "45", note: "x" }, unknownField("note")],
        // ช่องที่รู้จักแต่ค่าผิด/ไม่ได้ส่ง + ช่องที่ไม่รู้จัก → ชี้ช่องที่รู้จักก่อน (zod ตรวจ shape ก่อนช่องเกิน) · bar_sell ยังบังคับ
        [{ bar_sell: 67900, bar_buy: "1.00" }, PARSE_ERROR],
        [{ barSell: "67900" }, PARSE_ERROR],
        // ช่องเกินข้างใน from_reference ยังชี้ from_reference ตามเดิม
        [{ bar_sell: "67900", from_reference: { ...PREFILL, source: "x" } }, FROM_REFERENCE_ERROR],
      ];
      for (const who of ["manager", "admin"]) {
        for (const [body, expected] of cases) {
          const where = `PUT สาขา 00001 โดย ${who} ${JSON.stringify(body)}`;
          expect(await expectApiError(await putBranch(who, b1, body), 400, where), where).toEqual(expected);
        }
        // JSON ดิบ: "__proto__" เป็นช่องของ body จริงหลัง JSON.parse — ปฏิเสธเหมือนช่องอื่น ไม่ข้ามเงียบ ๆ
        const proto = await raw("PUT", branchPath(b1), {
          who,
          body: '{"bar_sell":"67900","__proto__":{"bar_buy":"1.00"}}',
        });
        expect(await expectApiError(proto, 400, `PUT สาขา โดย ${who} __proto__`)).toEqual(unknownField("__proto__"));
      }
      // ด่านราคาต่อกรัมของสาขา (ไม่มีช่องที่ไม่รู้จัก) ยังตอบ 400 เดิม
      for (const [body, field] of [
        [{ bar_sell: "67900", silver_per_g: "45" }, "silver_per_g"],
        [{ bar_sell: "67900", platinum_per_g: null }, "platinum_per_g"],
      ] as const) {
        const where = `PUT สาขา ${JSON.stringify(body)}`;
        expect(await expectApiError(await putBranch("manager", b1, body), 400, where)).toEqual({
          error: BRANCH_ONLY,
          field,
        });
      }
      // ไม่มีแถวราคาเฉพาะสาขาของวันนี้ ไม่มี audit ใหม่ (รวม gold_price.set_branch) — ทุกแถวเท่าเดิม
      const after = await writes();
      expect(after.prices.filter((p) => p.branchId !== null && p.date === DAY.branch)).toEqual([]);
      expect(after).toEqual(before);

      // คำขอแบบที่หน้าเว็บส่งยัง 200: {bar_sell} · {bar_sell, confirm_typo, from_reference} — สาขามาจาก path
      const branch = { id: b1, code: "00001", name: "สาขา 2" };
      const plain = await putBranch("manager", b1, { bar_sell: "67900" });
      expect(plain.status, "manager ส่ง bar_sell อย่างเดียว").toBe(200);
      expect(await plain.json()).toEqual({ branch, ...G67900, ...NO_PER_GRAM, source: "branch" });
      const full = await putBranch("admin", b1, { bar_sell: "67950", confirm_typo: true, from_reference: PREFILL });
      expect(full.status, "admin ส่งช่องที่หน้าเว็บใช้ครบ").toBe(200);
      const saved = (await full.json()) as Record<string, unknown>;
      expectMoneyAsStrings(saved, "PUT สาขา");
      expect(saved).toEqual({ branch, ...G67950, ...NO_PER_GRAM, source: "branch" });
      const added = (await writes()).audits.slice(before.audits.length);
      expect(added).toMatchObject([
        { action: "gold_price.set_branch", tableName: "gold_price", userId: uid("manager") },
        { action: "gold_price.set_branch", tableName: "gold_price", userId: uid("admin") },
      ]);
      // from_reference ยังรับและลง audit (ไม่ถูกตัดทิ้ง) · แหล่งราคาสมาคมปิดอยู่ในเทสต์ = มีแค่คำอ้างของ client
      expect(added[1]?.diff).toMatchObject({
        branch: { id: b1, code: "00001" },
        reference: { client_prefilled: true, client_announced_at: PREFILL.announced_at, client_round: PREFILL.round },
      });
    });

    it("POST /quote — ช่องที่ไม่รู้จัก (สะกด barSell · branchId · ช่องของการบันทึก confirm_typo/from_reference · ค่าที่ derive) = 400 ชี้ช่องแรก · ช่องที่หน้าเว็บส่ง (bar_sell · branch_id · silver_per_g · platinum_per_g) ยัง 200 ค่าเดิม · ไม่เขียนอะไร", async () => {
      onDay(DAY.quote);
      const before = await writes();
      const cases: [Record<string, unknown>, ApiErrorBody][] = [
        // สะกดผิด — ถ้าตัดทิ้ง preview จะเป็นราคาที่ไม่ได้ขอ (branchId หาย = เทียบราคากลางแทนราคาของสาขา)
        [{ bar_sell: "67850", barSell: "68000" }, unknownField("barSell")],
        [{ bar_sell: "67850", branchId: bid("00001") }, unknownField("branchId")],
        [{ bar_sell: "67850", silver_per_gram: "45" }, unknownField("silver_per_gram")],
        // ช่องของการบันทึกไม่มีความหมายกับ preview — หน้าเว็บไม่ส่งมาที่ quote
        [{ bar_sell: "67850", confirm_typo: true }, unknownField("confirm_typo")],
        [{ bar_sell: "67850", from_reference: PREFILL }, unknownField("from_reference")],
        // ค่าที่ derive · ช่องของระบบ — หลายช่องชี้ช่องแรก
        [{ bar_sell: "67850", bar_buy: "1.00", jewelry_buy: "1" }, unknownField("bar_buy", "jewelry_buy")],
        [{ bar_sell: "67850", diff: "0", date: "2026-01-01" }, unknownField("diff", "date")],
        // ช่องที่รู้จักครบทั้ง 4 ช่อง + ช่องเกินช่องเดียว ก็ยัง 400
        [
          { bar_sell: "67850", branch_id: null, silver_per_g: "45", platinum_per_g: "1000", extra: "1" },
          unknownField("extra"),
        ],
        // ช่องที่รู้จักแต่ค่าผิด/ไม่ได้ส่ง + ช่องที่ไม่รู้จัก → ชี้ช่องที่รู้จักก่อน (ข้อความเดิมของช่องนั้น)
        [{ barSell: "67850" }, PARSE_ERROR],
        [{ bar_sell: 67850, bar_buy: "1.00" }, PARSE_ERROR],
        [{ bar_sell: "67850", silver_per_g: 45, foo: "1" }, notText("silver_per_g")],
        [{ bar_sell: "67850", branch_id: 12, foo: "1" }, BRANCH_ID_ERROR],
      ];
      // quote ไม่จำกัด role (ทุกคนที่มีสาขา) — staff และ manager ได้ผลเดียวกัน
      for (const who of ["staff", "manager"]) {
        for (const [body, expected] of cases) {
          const where = `quote โดย ${who} ${JSON.stringify(body)}`;
          expect(await expectApiError(await quote(who, body), 400, where), where).toEqual(expected);
        }
        const proto = await raw("POST", QUOTE, { who, body: '{"bar_sell":"67850","__proto__":{"bar_buy":"1.00"}}' });
        expect(await expectApiError(proto, 400, `quote โดย ${who} __proto__`)).toEqual(unknownField("__proto__"));
      }

      // body แบบที่หน้าเว็บส่ง (features/gold-price/queries.ts) — ผลเหมือนก่อนทำ strict (คิดมือ · วันนี้ไม่มีครั้งก่อน = ไม่เตือน)
      const normal: [string, string, Record<string, unknown>, Record<string, unknown>][] = [
        ["staff", "ราคาทองอย่างเดียว", { bar_sell: "67850" }, G67850],
        [
          "manager",
          "ราคากลาง + ราคาต่อกรัม (คั่นหลักพัน)",
          { bar_sell: "67,850", silver_per_g: "45.5", platinum_per_g: "1,050" },
          { ...G67850, silver_per_g: "45.50", platinum_per_g: "1050.00" },
        ],
        [
          "manager",
          'ล้างราคาต่อกรัมด้วย null และ ""',
          { bar_sell: "67850", silver_per_g: null, platinum_per_g: "" },
          { ...G67850, ...NO_PER_GRAM },
        ],
        ["manager", "ราคาเฉพาะสาขา (branch_id)", { bar_sell: "67850", branch_id: bid("00001") }, G67850],
        ["manager", "branch_id: null = ราคากลาง", { bar_sell: "67850", branch_id: null }, G67850],
      ];
      for (const [who, label, body, expected] of normal) {
        const res = await quote(who, body);
        const text = await res.text();
        expect(res.status, `${label}: ${text.slice(0, 200)}`).toBe(200);
        const json = JSON.parse(text) as Record<string, unknown>;
        expectMoneyAsStrings(json, label);
        expect(json, label).toEqual(expected);
      }
      expect(await writes()).toEqual(before);
    });
  },
);
