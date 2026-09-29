import { metal, session } from "@ong/db";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectApiError, expectMoneyAsStrings } from "../test/assertions";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

interface MetalRow {
  id: string;
  code: string;
  name_th: string;
  unit: string;
  assessment_enabled: boolean;
}

/** ลำดับ dropdown ระบบเดิม (seed) — ทอง · นาก · เงิน · แพลตตินั่ม */
const SEEDED_CODES = ["gold", "nak", "silver", "platinum"];
const SEEDED_NAMES = ["ทอง", "นาก", "เงิน", "แพลตตินั่ม"];
/** คีย์ตามสัญญา spec §5 เท่านั้น — sort_order และคอลัมน์ภายในอื่นห้ามหลุด (OWASP API3:2023) */
const METAL_KEYS = ["assessment_enabled", "code", "id", "name_th", "unit"];
/** uuid รูปมาตรฐาน (RFC 9562) ตัวพิมพ์เล็กแบบที่ Postgres คืน */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FORGED = "better-auth.session_token=forged.signature";
/** อดีตที่แน่นอน — ไม่พึ่งนาฬิกาเครื่อง (better-auth เทียบวันหมดอายุกับนาฬิกาจริง) */
const LONG_AGO = new Date("2000-01-01T00:00:00Z");
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;
/** สิ่งที่ผู้โจมตีอยากเขียนทับ — ถ้ามี route รับเขียนโดยไม่ตั้งใจ ตาราง metal จะเปลี่ยน */
const TAMPER = { code: "gold", name_th: "ทดสอบ แก้ชื่อโลหะ", unit: "kg", assessment_enabled: true, sort_order: 0 };

describe.skipIf(!available)("โลหะที่รับซื้อ (spec §5 · R10) — /api/metals", () => {
  let t: TestApp;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    t = await startTestApp();
    const users = [
      ["staff", "staff", "00000"],
      ["manager", "manager", "00000"],
      ["accounting", "accounting", "00001"],
      ["admin", "admin", "00002"],
      ["staff2", "staff", "00002"],
    ] as const;
    for (const [who, role, code] of users) {
      await t.createUser({ email: `${who}@ong.test`, password: PW, role, branch: code });
      cookies[who] = await t.login(`${who}@ong.test`, PW);
    }
  });
  afterAll(async () => {
    await t?.close();
  });

  const list = (who: string) => t.request("/api/metals", { cookie: cookies[who] });
  const metalTable = () => t.db.select().from(metal).orderBy(asc(metal.code));
  const write = (method: string, path: string, init: { origin?: string } = {}) =>
    t.request(path, { method, cookie: cookies.admin, body: method === "DELETE" ? undefined : TAMPER, ...init });

  it("ไม่มี session = 401 ทั้ง GET และ HEAD", async () => {
    const res = await t.request("/api/metals");
    expect(await expectApiError(res, 401, "GET ไม่มี cookie")).toEqual({ error: "unauthorized" });
    const head = await t.request("/api/metals", { method: "HEAD" });
    expect(head.status).toBe(401);
    expect(await head.text()).toBe("");
  });

  it("cookie ปลอม (ลายเซ็นไม่ถูก) = 401", async () => {
    const res = await t.request("/api/metals", { cookie: FORGED });
    expect(await expectApiError(res, 401, "GET cookie ปลอม")).toEqual({ error: "unauthorized" });
  });

  it("session หมดอายุ = 401 — cookie เดิมที่เพิ่งใช้ได้ก็ใช้ต่อไม่ได้", async () => {
    const u = await t.createUser({ email: "expiring@ong.test", password: PW, branch: "00000" });
    const cookie = await t.login("expiring@ong.test", PW);
    expect((await t.request("/api/metals", { cookie })).status).toBe(200);
    await t.db.update(session).set({ expiresAt: LONG_AGO }).where(eq(session.userId, u.id));
    const res = await t.request("/api/metals", { cookie });
    expect(await expectApiError(res, 401, "GET session หมดอายุ")).toEqual({ error: "unauthorized" });
  });

  it("ทุก role (staff · manager · accounting · admin) ที่มีสาขา ได้ 200 และ body เหมือนกันทุกไบต์", async () => {
    const texts: string[] = [];
    for (const who of ["staff", "manager", "accounting", "admin"]) {
      const res = await list(who);
      expect(res.status, who).toBe(200);
      texts.push(await res.text());
    }
    for (const text of texts) expect(text).toBe(texts[0]);
  });

  it("รูปตาม spec §5: 4 แถวเรียงตามระบบเดิม · หน่วยกรัม · โหมดประเมินปิดโดยค่าเริ่มต้น (R10) · คีย์ตามสัญญาเท่านั้น", async () => {
    const res = await list("staff");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/json\b/);
    const rows = (await res.json()) as MetalRow[];
    expect(rows.map((m) => m.code)).toEqual(SEEDED_CODES);
    expect(rows.map((m) => m.name_th)).toEqual(SEEDED_NAMES);
    const idByCode = new Map((await metalTable()).map((m) => [m.code, m.id]));
    for (const m of rows) {
      expect(Object.keys(m).sort(), m.code).toEqual(METAL_KEYS);
      expect(m.unit, m.code).toBe("g");
      expect(m.assessment_enabled, m.code).toBe(false);
      expect(m.id, m.code).toMatch(UUID);
      expect(m.id, m.code).toBe(idByCode.get(m.code));
    }
    expectMoneyAsStrings(rows, "GET /api/metals");
  });

  it("รายการมาจากตาราง metal ไม่ใช่ค่าคงที่ในโค้ด — แก้ลำดับ/โหมดประเมินใน DB แล้ว response เปลี่ยนตาม", async () => {
    const [nak] = await t.db.select().from(metal).where(eq(metal.code, "nak"));
    if (!nak) throw new Error("seed ต้องมีนาก");
    // sort_order 0 = ขึ้นก่อนทอง · UPDATE ย้ายแถวไปท้าย heap — ถ้า query ไม่มี ORDER BY ลำดับจะผิดให้เห็นทันที
    await t.db.update(metal).set({ sortOrder: 0, assessmentEnabled: true }).where(eq(metal.code, "nak"));
    try {
      const rows = (await (await list("staff")).json()) as MetalRow[];
      expect(rows.map((m) => m.code)).toEqual(["nak", "gold", "silver", "platinum"]);
      expect(rows.map((m) => m.assessment_enabled)).toEqual([true, false, false, false]);
    } finally {
      await t.db
        .update(metal)
        .set({ sortOrder: nak.sortOrder, assessmentEnabled: nak.assessmentEnabled })
        .where(eq(metal.code, "nak"));
    }
    const rows = (await (await list("staff")).json()) as MetalRow[];
    expect(rows.map((m) => m.code)).toEqual(SEEDED_CODES);
    expect(rows.map((m) => m.assessment_enabled)).toEqual([false, false, false, false]);
  });

  it("อ่านอย่างเดียว: POST/PUT/PATCH/DELETE ที่ /api/metals และ /api/metals/:id ไม่ได้ 2xx แม้เป็น admin · ตาราง metal ไม่เปลี่ยน", async () => {
    const before = await metalTable();
    const gold = before.find((m) => m.code === "gold");
    if (!gold) throw new Error("seed ต้องมีทอง");
    for (const path of ["/api/metals", `/api/metals/${gold.id}`]) {
      for (const method of WRITE_METHODS) {
        const res = await write(method, path);
        expect([404, 405], `${method} ${path} → ${res.status}`).toContain(res.status);
      }
    }
    expect(await metalTable()).toEqual(before);
  });

  it("CSRF: เขียนจาก origin อื่น = 403 forbidden origin ก่อนถึง route · ตาราง metal ไม่เปลี่ยน", async () => {
    const before = await metalTable();
    for (const path of ["/api/metals", `/api/metals/${before[0]?.id ?? "x"}`]) {
      for (const method of WRITE_METHODS) {
        const res = await write(method, path, { origin: "https://evil.example" });
        expect(await expectApiError(res, 403, `${method} ${path} origin อื่น`)).toEqual({ error: "forbidden origin" });
      }
    }
    expect(await metalTable()).toEqual(before);
  });

  it("ข้อมูลอ้างอิงทั้งร้าน: ผู้ใช้สาขา 00000 และสาขา 00002 ได้รายการเดียวกัน (ไม่ผูกสาขาโดยออกแบบ)", async () => {
    const [a, b] = [await list("staff"), await list("staff2")];
    expect([a.status, b.status]).toEqual([200, 200]);
    const [textA, textB] = [await a.text(), await b.text()];
    expect(textB).toBe(textA);
    expect((JSON.parse(textA) as MetalRow[]).map((m) => m.code)).toEqual(SEEDED_CODES);
  });
});
