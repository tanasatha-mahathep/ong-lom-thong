import { randomUUID } from "node:crypto";
import { auditLog, branch, customer, goldPrice, session, user } from "@ong/db";
import { and, count, eq, isNull, max } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { expectApiError, expectMoneyAsStrings, expectNoInternals } from "./test/assertions";
import { type TestApp, type TestUser, databaseAvailable, startTestApp } from "./test/harness";
import { expectNoNationalId, nationalIdsIn } from "./test/pii";
import { type Endpoint, STATE_CHANGING, fillParams, hasParams, listEndpoints } from "./test/routes";
import { cardFormat, syntheticNationalId, testName } from "./test/synthetic";

/*
 * เทสต์สัญญาของ API ทั้งก้อน — fail-closed by construction
 *
 * รายการ endpoint อ่านจาก router ของ Hono จริง (listEndpoints) ไม่ใช่รายการเขียนมือ: route ที่ใครเพิ่มเข้ามาใหม่
 * โดนตรวจทุกข้อข้างล่างทันทีโดยไม่ต้องแก้ไฟล์นี้ — ลืม requireSession · ลืมกัน CSRF · id ผิดรูปแล้ว 500 · error หลุด
 * ร่องรอยภายใน · หลุดเลขบัตร · เงินเป็น float · เปิด CORS · ผู้ใช้ไม่มีสาขาได้ข้อมูล · body ผิดรูปแล้ว 500 = แดง
 * ข้อยกเว้นทุกข้ออยู่ใน allowlist ด้านล่างพร้อมเหตุผล · ช่องโหว่ที่รู้แล้วมี it.fails ของตัวเองหนึ่งข้อต่อ finding
 * (F4 · F7 · F8 · F9) — แก้แล้ว it.fails จะแดง: เปลี่ยนเป็น it และลบค่าคงที่ของ finding นั้นออก
 *
 * มาตรฐาน: OWASP ASVS 4.0.3 (V3.3 · V4.1 · V4.2 · V5.1 · V7.4.1 · V8.2.1 · V8.3 · V13.2 · V14.5.3) และ 5.0 ·
 * OWASP API Security Top 10 2023 (API1 · API2 · API3 · API5 · API8 · API9) · RFC 9110 §9.2.1 (safe methods) ·
 * NIST SP 800-218 SSDF PW.8 · ISO/IEC/IEEE 29119-4 (equivalence partitioning · boundary values · error guessing)
 */

const NOW = new Date("2026-09-28T03:00:00Z"); // 10:00 น. วันที่ 28 ก.ย. 2569 เวลาไทย
const TODAY = "2026-09-28";
const PW = "correct-horse-battery";
/** origin ของแอปใน harness (BETTER_AUTH_URL) — ค่าเดียวที่ sameOriginOnly ยอมรับ */
const ORIGIN = "http://localhost:8787";
const PAST = new Date("2000-01-01T00:00:00Z");

const available = await databaseAvailable();
const t = available ? await startTestApp({ now: () => NOW }) : undefined;
/** อ่านตอน collect เพื่อให้แต่ละ route มีเทสต์ชื่อของตัวเอง — Postgres ไม่พร้อม = ว่าง (ทุกเทสต์ถูกข้าม) */
const endpoints = t ? listEndpoints(t.app) : [];
afterAll(() => t?.close());

// ---------- allowlist — ทุกรายการมีเหตุผลหนึ่งบรรทัด และต้องชี้ route ที่มีอยู่จริง (เทสต์ "ไม่มีรายการค้าง") ----------

/** ไม่ต้อง login */
const PUBLIC = new Set([
  "GET /api/healthz", // liveness probe — ไม่มีข้อมูลร้าน
  "GET /api/auth/*", // better-auth (get-session …) — ด่านของมันเองตรวจใน routes/me.test.ts
  "POST /api/auth/*", // better-auth (sign-in/email · sign-out) — ด่านของมันเองตรวจใน routes/me.test.ts
]);

/** route ที่อยู่นอก /api ได้ — นอก /api ไม่มี sameOriginOnly */
const NON_API = new Set([
  "GET /healthz", // liveness probe ของ Railway
]);

/** ไม่มีอะไรถูกลบ — ยกเลิก = เอกสารใหม่ (CLAUDE.md กฎ 5 · spec §5) */
const NO_DELETE_ALLOWED = new Set<string>([]);

/** endpoint เดียวที่ส่งเลขบัตรเต็มได้ (R13 · spec §5 · CLAUDE.md กฎ 7) */
const PII_EXCEPTION = "GET /api/customers/:id";

/** ผู้ใช้ที่ไม่มีสาขาเรียกได้ — พร้อมเงื่อนไขว่า "ได้" แปลว่าอะไร */
const BRANCHLESS_ALLOWED = new Map<string, (body: unknown) => void>([
  [
    // โปรไฟล์ตัวเอง — UI ต้องบอกได้ว่า "ยังไม่มีสาขา" · ต้องไม่มีสาขาใดติดมา (ไม่ใช่ทุกสาขา)
    "GET /api/me",
    (body) => {
      const me = body as { branch?: unknown; branches?: unknown };
      expect(me.branch, "GET /api/me: branch").toBeNull();
      expect(me.branches, "GET /api/me: branches").toEqual([]);
    },
  ],
]);

// F8 — GET ที่ต้อง login แต่ยังไม่ส่ง Cache-Control: no-store · sweep ข้ามไว้ ตรวจใน it.fails "F8 — …" แทน · แก้แล้วลบออก
const NO_STORE_PENDING_F8 = new Set([
  "GET /api/me",
  "GET /api/customers",
  "GET /api/gold-price/today",
  "GET /api/metals",
]);

// F4 — ยังไม่มี requireAnyBranch (ผู้ใช้ไม่มีสาขาได้ 200) · sweep ข้ามไว้ ตรวจใน it.fails "F4 — …" แทน · แก้แล้วลบออก
const NO_BRANCH_GUARD_F4 = new Set(["GET /api/metals", "GET /api/gold-price/today"]);

/** route ที่ต้องเห็นเสมอ — กันชุดเทสต์ผ่านแบบว่างเปล่า (router อ่านไม่ออก = ไม่มีเทสต์ = เขียวหลอก) */
const KNOWN_ROUTES = [
  "GET /healthz",
  "GET /api/healthz",
  "GET /api/auth/*",
  "POST /api/auth/*",
  "GET /api/me",
  "POST /api/me/branch",
  "GET /api/gold-price/today",
  "POST /api/gold-price/quote",
  "PUT /api/gold-price/today",
  "GET /api/metals",
  "GET /api/customers",
  "POST /api/customers",
  "GET /api/customers/:id",
  "PUT /api/customers/:id",
  "GET /api/customers/:id/photo",
];

/** id ผิดรูป — ต้องได้คำตอบเดียวกับ id ที่ไม่มีอยู่ (ไม่ 500 · ไม่เป็น oracle) */
const MALFORMED_IDS = [
  "not-a-uuid",
  "0",
  "-1",
  "00000000-0000-0000-0000-00000000000g", // hex ผิดหนึ่งตัว
  "{00000000-0000-4000-8000-000000000000}", // รูปแบบ GUID มีปีกกา
  "000000000000400080000000000000000", // ไม่มีขีด
  "' OR '1'='1", // SQL injection
  "\u0000", // NUL byte
  "ทดสอบ", // ไม่ใช่ ASCII
  "a".repeat(2000), // ยาวมาก
  "null",
  "undefined",
];

/** Origin ที่ต้องถูกปฏิเสธ — null = ไม่ส่ง header Origin เลย */
const FOREIGN_ORIGINS: (string | null)[] = [
  "https://evil.test", // เว็บอื่น
  "null", // sandboxed iframe · file:// · redirect ข้ามโดเมน
  null, // ไม่มี Origin (curl · script)
  "http://localhost:8787.evil.test", // ขึ้นต้นเหมือน origin ของแอป
  "https://localhost:8787", // scheme ต่าง
  "http://localhost:8788", // port ต่าง
];

/** body ผิดรูปของ method ที่เปลี่ยนสถานะ — ต้องได้ 4xx ที่อ่านรู้เรื่อง ไม่ใช่ 5xx */
const MALFORMED_BODIES: [string, string, string][] = [
  ["JSON พัง", "application/json", "{"],
  ["JSON null", "application/json", "null"],
  ["JSON array", "application/json", "[]"],
  ["JSON string", "application/json", '"x"'],
  ["text/plain", "text/plain", "x"],
  ["multipart พัง", "multipart/form-data; boundary=x", "--x\r\nbroken"],
];

// ---------- ข้อมูลสมมติ (CLAUDE.md กฎ 8) ----------

const ID_WITH_PHOTO = syntheticNationalId();
const ID_NO_PHOTO = syntheticNationalId();
/** อยู่ใน body ของ request ที่ต้องถูกปฏิเสธ — ต้องไม่ถูกบันทึกที่ไหนเลย */
const ID_PROBE = syntheticNationalId();
const KNOWN_IDS = [ID_WITH_PHOTO, ID_NO_PHOTO, ID_PROBE];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

type Who = "super" | "branchless" | "closed" | "expired" | "deactivated" | "revoked";
const USERS: Record<Who, Omit<TestUser, "email" | "password">> = {
  super: { role: "admin", branch: "00000", viewAll: true }, // ผ่านทุกด่าน role/สาขา → ถึงจุดลึกสุดของทุก handler
  branchless: { role: "admin" }, // ไม่มีสาขา ไม่มี viewAll — role สูงสุด เหลือด่านสาขาด่านเดียว
  closed: { role: "manager", branch: "00002" }, // สาขาเดียวของตัวเองถูกปิดในเทสต์ F4
  expired: { branch: "00000" }, // session ถูกตั้งให้หมดอายุหลัง login
  deactivated: { branch: "00000" }, // บัญชีถูกปิดหลัง login
  revoked: { branch: "00000" }, // sign-out แล้ว cookie เดิมต้องใช้ไม่ได้
};
const cookies: Record<Who, string> = {
  super: "",
  branchless: "",
  closed: "",
  expired: "",
  deactivated: "",
  revoked: "",
};
let superId = "";
let expiredSession: typeof session.$inferSelect | undefined;
let custWithPhoto = "";
let custNoPhoto = "";
let priceSetBody: unknown;

// ---------- กลุ่ม endpoint ----------

const isApi = (e: Endpoint) => e.path === "/api" || e.path.startsWith("/api/");
const isStateChanging = (e: Endpoint) => (STATE_CHANGING as readonly string[]).includes(e.method);
// HEAD ได้จาก GET เสมอ (Hono) — ตรวจคู่กับ GET ใน 401 sweep
const swept = endpoints.filter((e) => e.method !== "HEAD");
const guarded = swept.filter((e) => isApi(e) && !PUBLIC.has(e.key));
const guardedGets = guarded.filter((e) => e.method === "GET");
const guardedWrites = guarded.filter(isStateChanging);
const csrfTargets = swept.filter((e) => isApi(e) && isStateChanging(e));
const paramRoutes = guarded.filter((e) => hasParams(e.path));

// ---------- ตัวช่วย ----------

/** แอปทดสอบของไฟล์นี้ — มีเฉพาะเมื่อ Postgres พร้อม (ทุกเทสต์อยู่ใน describe.skipIf(!available)) */
function harness(): TestApp {
  if (!t) throw new Error("Postgres ไม่พร้อม — เทสต์นี้ต้องถูกข้าม");
  return t;
}

type App = ReturnType<typeof createApp>;
interface Hit {
  method?: string;
  cookie?: string;
  /** null = ไม่ส่ง Origin เลย · ไม่ระบุ = origin ของแอป */
  origin?: string | null;
  /** FormData = multipart · อย่างอื่น = JSON */
  body?: unknown;
  headers?: Record<string, string>;
}

/** harness.request ส่ง Origin เสมอและยิงได้แอปเดียว — ตัวนี้ละ Origin ได้ ใส่ header เองได้ และยิงแอปที่ DB พังได้ */
function hitOn(target: App, path: string, { method = "GET", cookie, origin = ORIGIN, body, headers = {} }: Hit = {}) {
  const h: Record<string, string> = { ...headers };
  if (origin !== null) h.origin = origin;
  if (cookie) h.cookie = cookie;
  let payload: FormData | string | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  return target.request(path, { method, headers: h, body: payload });
}
const hit = (path: string, init?: Hit) => hitOn(harness().app, path, init);

interface Seen {
  status: number;
  type: string | null;
  text: string;
}
const seen = async (res: Response): Promise<Seen> => ({
  status: res.status,
  type: res.headers.get("content-type"),
  text: await res.text(),
});
const isJson = (type: string | null) => /^application\/json\b/.test(type ?? "");
const noStore = /\bno-store\b/i;
const pathOf = (key: string) => key.slice(key.indexOf(" ") + 1);
/** id ในข้อความของเทสต์ — ตัวที่ยาวมากตัดให้สั้น · ตัวควบคุมถูก escape */
const show = (id: string) => JSON.stringify(id.length > 40 ? `${id.slice(0, 12)}…(${id.length} ตัว)` : id);

/** error ของ API แบบตรงตัว: status · JSON {error} ไม่มีช่องอื่นหลุด · ไม่มีร่องรอยภายใน · ไม่มีเลขบัตร */
async function expectError(res: Response, status: number, error: string, where: string): Promise<void> {
  const text = await res.clone().text();
  expect(await expectApiError(res, status, where), where).toEqual({ error });
  expectNoNationalId(text, where, KNOWN_IDS);
}

/** ไม่ใช่ 5xx · ถ้าเป็น 4xx ต้องเป็น error รูป spec §5 — คืน body (ถ้าเป็น error) ให้ตรวจต่อ */
async function expectNot5xx(res: Response, where: string) {
  expect(res.status, `${where}: ได้ ${res.status}`).toBeLessThan(500);
  return res.status >= 400 ? expectApiError(res, res.status, where) : undefined;
}

/** path ที่ยิงจริง — wildcard ของ better-auth ชี้ไป endpoint ที่มีผลจริงถ้าด่านหาย */
const CONCRETE: Record<string, string> = {
  "GET /api/auth/*": "/api/auth/get-session",
  "POST /api/auth/*": "/api/auth/sign-in/email",
};
const probePath = (e: Endpoint, id: string) => CONCRETE[e.key] ?? fillParams(e.path, id);

/** ฟอร์มลูกค้า (multipart) ข้อมูลสมมติ — photo = รูป PNG เล็ก ๆ */
function customerForm(nationalId: string, label: string, photo = false): FormData {
  const form = new FormData();
  form.append("national_id", nationalId);
  form.append("name_th", testName(label));
  if (photo) form.append("photo", new File([PNG], "card.png", { type: "image/png" }));
  return form;
}

/**
 * body ที่ผ่าน validation ได้จริงของ route ที่รู้จัก — ถ้าด่านหาย request นี้ "มีผลจริง" (เขียน DB · สลับสาขา · สร้าง session)
 * CSRF sweep จึงพิสูจน์ได้ว่าไม่มีผลข้างเคียง และ fault injection วิ่งถึง DB · route ใหม่ที่ไม่อยู่ในนี้ได้ {} (ยังโดนตรวจครบทุกข้อ)
 */
function probeBody(key: string): unknown {
  switch (key) {
    case "POST /api/auth/*":
      return { email: "super@ong.test", password: PW };
    case "POST /api/me/branch":
      return { branch_id: harness().branches["00001"] };
    case "POST /api/gold-price/quote":
      return { bar_sell: "67850" };
    case "PUT /api/gold-price/today":
      return { bar_sell: "67900" };
    case "POST /api/customers":
      return customerForm(ID_PROBE, "จาก probe", true);
    case "PUT /api/customers/:id":
      return customerForm(ID_WITH_PHOTO, "แก้จาก probe");
    default:
      return {};
  }
}
const bodyFor = (e: Endpoint) => (isStateChanging(e) ? probeBody(e.key) : undefined);

/** cookie ของ session ที่หมดอายุ — ตั้งใหม่ก่อนใช้ทุกครั้ง เพราะ better-auth ลบ session ที่หมดอายุทิ้งเมื่อเจอ */
async function armExpired(): Promise<string> {
  if (!expiredSession) throw new Error("ยังไม่มี session ของผู้ใช้ expired (beforeAll)");
  await harness()
    .db.insert(session)
    .values({ ...expiredSession, expiresAt: PAST })
    .onConflictDoUpdate({ target: session.id, set: { expiresAt: PAST } });
  return cookies.expired;
}

/** สิ่งที่ request ที่ถูกปฏิเสธต้องไม่แตะ — จำนวนแถว + ค่าที่ถูกแก้ในที่ได้ */
async function sideEffects() {
  const { db, storage } = harness();
  const [[audits], [customers], [prices], central, [sessions], superSessions] = await Promise.all([
    db.select({ n: count() }).from(auditLog),
    db.select({ n: count(), lastUpdate: max(customer.updatedAt) }).from(customer),
    db.select({ n: count() }).from(goldPrice),
    db
      .select({ barSell: goldPrice.barSell })
      .from(goldPrice)
      .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, TODAY))),
    db.select({ n: count() }).from(session),
    db.select({ id: session.id, branch: session.currentBranchId }).from(session).where(eq(session.userId, superId)),
  ]);
  return { audits, customers, prices, central, sessions, superSessions, photos: storage.keys().length };
}

async function createCustomerAsSuper(nationalId: string, label: string, photo = false): Promise<string> {
  const res = await hit("/api/customers", {
    method: "POST",
    cookie: cookies.super,
    body: customerForm(nationalId, label, photo),
  });
  if (res.status !== 201) throw new Error(`สร้างลูกค้าไม่สำเร็จ: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

interface Target {
  path: string;
  /** เลขบัตรของลูกค้าที่ path นี้ชี้ถึง (route ที่มี :id) */
  nationalId?: string;
}
/** request ของ GET sweep — :id = ลูกค้าจริงทุกคน · list = ไม่ค้น + ค้นด้วยเลขบัตรเต็ม · แบบหน้าบัตร · บางส่วน 5 หลัก */
function getTargets(e: Endpoint): Target[] {
  if (hasParams(e.path)) {
    return [
      { path: probePath(e, custWithPhoto), nationalId: ID_WITH_PHOTO },
      { path: probePath(e, custNoPhoto), nationalId: ID_NO_PHOTO },
    ];
  }
  const base = probePath(e, "");
  const queries = [ID_WITH_PHOTO, cardFormat(ID_WITH_PHOTO, " "), ID_WITH_PHOTO.slice(4, 9)];
  return [{ path: base }, ...queries.map((q) => ({ path: `${base}?q=${encodeURIComponent(q)}` }))];
}

function expectNoCors(res: Response, where: string): void {
  const cors = [...res.headers.keys()].filter((k) => k.startsWith("access-control-allow-"));
  expect(cors, `${where}: ต้องไม่มี header CORS`).toEqual([]);
}

describe.skipIf(!available)("สัญญา API — ทุก route ที่ลงทะเบียนใน Hono ถูกตรวจอัตโนมัติ", () => {
  beforeAll(async () => {
    const T = harness();
    const ids = {} as Record<Who, string>;
    for (const who of Object.keys(USERS) as Who[]) {
      ids[who] = (await T.createUser({ email: `${who}@ong.test`, password: PW, ...USERS[who] })).id;
      cookies[who] = await T.login(`${who}@ong.test`, PW);
    }
    superId = ids.super;

    [expiredSession] = await T.db.select().from(session).where(eq(session.userId, ids.expired));
    await armExpired();
    await T.db.update(user).set({ isActive: false }).where(eq(user.id, ids.deactivated));
    const out = await T.request("/api/auth/sign-out", { method: "POST", cookie: cookies.revoked, body: {} });
    if (out.status !== 200) throw new Error(`sign-out ไม่สำเร็จ: ${out.status} ${await out.text()}`);
    const [left] = await T.db.select({ n: count() }).from(session).where(eq(session.userId, ids.revoked));
    if (left?.n !== 0) throw new Error("sign-out แล้ว session ยังอยู่ใน DB");

    // ข้อมูลจริงให้ GET ตอบ 200 — ราคากลางวันนี้ + ลูกค้า 2 คน (มีรูป · ไม่มีรูป)
    const price = await T.request("/api/gold-price/today", {
      method: "PUT",
      cookie: cookies.super,
      body: { bar_sell: "67850" },
    });
    if (price.status !== 200) throw new Error(`ตั้งราคาไม่สำเร็จ: ${price.status} ${await price.text()}`);
    priceSetBody = await price.json();
    custWithPhoto = await createCustomerAsSuper(ID_WITH_PHOTO, "ลูกค้ามีรูป", true);
    custNoPhoto = await createCustomerAsSuper(ID_NO_PHOTO, "ลูกค้าไม่มีรูป");
  });

  describe("ทะเบียน route (API9:2023 inventory · ASVS 4.0.3 V13.2.1)", () => {
    it("เห็น route ที่รู้จักครบ — ชุดเทสต์ผ่านแบบว่างเปล่าไม่ได้", () => {
      expect(endpoints.map((e) => e.key)).toEqual(expect.arrayContaining(KNOWN_ROUTES));
    });

    it("ทุกรายการใน allowlist ชี้ route ที่มีอยู่จริง (ไม่มีรายการค้าง)", () => {
      const keys = new Set(endpoints.map((e) => e.key));
      const lists: Record<string, string[]> = {
        PUBLIC: [...PUBLIC],
        NON_API: [...NON_API],
        NO_DELETE_ALLOWED: [...NO_DELETE_ALLOWED],
        PII_EXCEPTION: [PII_EXCEPTION],
        BRANCHLESS_ALLOWED: [...BRANCHLESS_ALLOWED.keys()],
        NO_STORE_PENDING_F8: [...NO_STORE_PENDING_F8],
        NO_BRANCH_GUARD_F4: [...NO_BRANCH_GUARD_F4],
      };
      for (const [name, entries] of Object.entries(lists)) {
        for (const key of entries)
          expect(keys.has(key), `${name} มี "${key}" ซึ่งไม่มี route นี้แล้ว — ลบออก`).toBe(true);
      }
      // ข้อยกเว้นของ GET sweep ต้องเป็น GET ที่ต้อง login จริง — ไม่งั้นข้ามไปเปล่า ๆ
      for (const key of [PII_EXCEPTION, ...BRANCHLESS_ALLOWED.keys(), ...NO_STORE_PENDING_F8, ...NO_BRANCH_GUARD_F4]) {
        expect(
          guardedGets.map((e) => e.key),
          key,
        ).toContain(key);
      }
    });

    it("route นอก /api มีเฉพาะที่อยู่ใน NON_API · ไม่มี DELETE ที่ไหนเลย (CLAUDE.md กฎ 5)", () => {
      const outside = endpoints.filter((e) => !isApi(e) && !NON_API.has(e.key)).map((e) => e.key);
      expect(outside, "route นอก /api ไม่ผ่าน sameOriginOnly — ย้ายเข้า /api หรือเพิ่มใน NON_API พร้อมเหตุผล").toEqual(
        [],
      );
      const deletes = endpoints.filter((e) => e.method === "DELETE" && !NO_DELETE_ALLOWED.has(e.key)).map((e) => e.key);
      expect(deletes, "ไม่มีการลบ — ยกเลิก = เอกสารใหม่ (CLAUDE.md กฎ 5 · spec §5)").toEqual([]);
    });
  });

  describe("401 — credential ที่ใช้ไม่ได้ทุกแบบ = 401 ก่อน 404/validation (ASVS 4.0.3 V4.1.5 · V3.3.1 · API2:2023)", () => {
    /** เป็นฟังก์ชันเพราะ session หมดอายุต้องตั้งใหม่ก่อนใช้ทุกครั้ง */
    const badCredentials: [string, () => Promise<string | undefined>][] = [
      ["ไม่มี cookie", () => Promise.resolve(undefined)],
      ["cookie ปลอม", () => Promise.resolve("better-auth.session_token=forged.signature")],
      ["session หมดอายุ", armExpired],
      ["บัญชีถูกปิดหลัง login", () => Promise.resolve(cookies.deactivated)],
      ["session ที่ sign-out แล้ว", () => Promise.resolve(cookies.revoked)],
    ];
    for (const e of guarded) {
      const isGet = e.method === "GET";
      it(`${e.key}${isGet ? " + HEAD" : ""} → 401 {error:"unauthorized"} (ไม่มี · ปลอม · หมดอายุ · บัญชีปิด · sign-out แล้ว)`, async () => {
        const path = probePath(e, randomUUID());
        for (const [label, credential] of badCredentials) {
          const res = await hit(path, { method: e.method, cookie: await credential(), body: bodyFor(e) });
          await expectError(res, 401, "unauthorized", `${e.key} [${label}]`);
        }
        // 401 มาก่อน 404: id ที่มีอยู่จริง · สุ่ม · ผิดรูป ได้คำตอบเดียวกัน — คนที่ไม่ได้ login ไม่รู้ว่า id ไหนมีอยู่
        const paths = hasParams(e.path) ? [path, probePath(e, custWithPhoto), probePath(e, "not-a-uuid")] : [path];
        for (const p of paths.slice(1)) {
          const res = await hit(p, { method: e.method, body: bodyFor(e) });
          await expectError(res, 401, "unauthorized", `${e.key} [ไม่มี cookie · ${p}]`);
        }
        if (isGet) {
          for (const p of paths) {
            const res = await hit(p, { method: "HEAD" });
            expect(res.status, `HEAD ${p}`).toBe(401);
            expect(await res.text(), `HEAD ${p} ต้องไม่มี body`).toBe("");
          }
        }
      });
    }
  });

  describe("CSRF — method ที่เปลี่ยนสถานะใต้ /api รับเฉพาะ Origin ของแอป (ASVS 4.0.3 V13.2.3 · V4.2.2 · 5.0 V3.5)", () => {
    for (const e of csrfTargets) {
      it(`${e.key} + cookie ที่ใช้ได้ → 403 {error:"forbidden origin"} ทุก Origin แปลกปลอม · ไม่มีผลข้างเคียง`, async () => {
        const before = await sideEffects();
        for (const origin of FOREIGN_ORIGINS) {
          const res = await hit(probePath(e, custWithPhoto), {
            method: e.method,
            cookie: cookies.super,
            origin,
            body: probeBody(e.key),
          });
          await expectError(res, 403, "forbidden origin", `${e.key} [Origin: ${origin ?? "(ไม่มี header)"}]`);
        }
        expect(await sideEffects(), `${e.key}: request ที่ถูกปฏิเสธต้องไม่เขียนอะไรเลย`).toEqual(before);
      });
    }
  });

  describe("404 — id สุ่ม/ผิดรูปไม่ทำให้ 500 และไม่บอกว่ามีอยู่ (API1:2023 BOLA · ASVS 4.0.3 V4.2.1)", () => {
    for (const e of paramRoutes) {
      if (e.method === "GET") {
        it(`${e.key} — uuid สุ่ม + id ผิดรูป ${MALFORMED_IDS.length} แบบ → 404 {error:"not found"} ทุกตัว`, async () => {
          for (const id of [randomUUID(), ...MALFORMED_IDS]) {
            const res = await hit(fillParams(e.path, id), { cookie: cookies.super });
            await expectError(res, 404, "not found", `${e.key} [id=${show(id)}]`);
          }
        });
      } else {
        // method ที่เปลี่ยนสถานะไม่บังคับว่าต้องหา id ก่อน validate body — แต่ทุก id ต้องได้คำตอบเดียวกัน
        it(`${e.key} — uuid สุ่มกับ id ผิดรูป ${MALFORMED_IDS.length} แบบได้ status + body เดียวกัน (4xx)`, async () => {
          const send = (id: string) =>
            hit(fillParams(e.path, id), { method: e.method, cookie: cookies.super, body: {} });
          const res = await send(randomUUID());
          const first = await seen(res.clone());
          await expectApiError(res, first.status, `${e.key} [uuid สุ่ม]`);
          expect(first.status >= 400 && first.status < 500, `${e.key}: ต้องเป็น 4xx — ได้ ${first.status}`).toBe(true);
          expectNoNationalId(first.text, e.key, KNOWN_IDS);
          for (const id of MALFORMED_IDS) {
            expect(await seen(await send(id)), `${e.key} [id=${show(id)}]`).toEqual(first);
          }
        });
      }

      const expected = e.method === "GET" ? "403/404" : "4xx";
      it(`${e.key} — ผู้ใช้ไม่มีสาขา: id ที่มีอยู่จริงกับ uuid สุ่มได้คำตอบเดียวกัน (${expected})`, async () => {
        const send = (id: string) =>
          hit(fillParams(e.path, id), {
            method: e.method,
            cookie: cookies.branchless,
            body: isStateChanging(e) ? {} : undefined,
          });
        const res = await send(custWithPhoto);
        const existing = await seen(res.clone());
        await expectApiError(res, existing.status, `${e.key} [ไม่มีสาขา · id จริง]`);
        if (e.method === "GET") expect([403, 404], `${e.key} ได้ ${existing.status}`).toContain(existing.status);
        else expect(existing.status >= 400 && existing.status < 500, `${e.key} ได้ ${existing.status}`).toBe(true);
        expect(await seen(await send(randomUUID())), `${e.key} [ไม่มีสาขา · uuid สุ่ม]`).toEqual(existing);
      });
    }
  });

  describe('DB ล่ม → 500 {error:"internal error"} ไม่มีร่องรอยภายใน (ASVS 4.0.3 V7.4.1 · V4.1.5 · API8:2023)', () => {
    const SECRET = `SECRET-${randomUUID()}`;
    const results = new Map<string, Seen>();
    const logged: unknown[] = [];

    beforeAll(async () => {
      const T = harness();
      const explode = () => {
        throw new Error(`${SECRET} at /srv/app/src/secret.ts:1:2`);
      };
      // ทุกทางเข้า DB ของ drizzle พัง (select · insert · update · delete · transaction · execute · $count · query …)
      // better-auth ยังใช้ DB จริงผ่าน adapter ของมันเอง → session ผ่าน แล้วไปพังใน route/ด่านสาขา
      const brokenDb = new Proxy(T.db, {
        get(target, prop, receiver) {
          if (prop === "query") return new Proxy({}, { get: () => ({ findFirst: explode, findMany: explode }) });
          const real: unknown = Reflect.get(target, prop, receiver);
          return typeof real === "function" ? explode : real;
        },
      });
      const broken = createApp({ db: brokenDb, auth: T.auth, env: T.env, storage: T.storage, now: () => NOW });
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        for (const e of guarded) {
          const res = await hitOn(broken, probePath(e, custWithPhoto), {
            method: e.method,
            cookie: cookies.super,
            body: bodyFor(e),
          });
          results.set(e.key, await seen(res));
        }
        logged.push(...(spy.mock.calls.flat() as unknown[]));
      } finally {
        spy.mockRestore();
      }
    });

    for (const e of guarded) {
      it(`${e.key} — 5xx = {error:"internal error"} ตรงตัว · ข้อความ error จริง/stack/โครง DB ไม่หลุด`, () => {
        const r = results.get(e.key);
        if (!r) throw new Error(`ไม่ได้ยิง ${e.key}`);
        expect(r.text, `${e.key}: ข้อความ error จริงหลุด`).not.toContain(SECRET);
        expectNoInternals(r.text, e.key);
        expectNoNationalId(r.text, e.key, KNOWN_IDS);
        if (r.status >= 500) {
          expect(r.status, e.key).toBe(500);
          expect(r.type, e.key).toMatch(/^application\/json\b/);
          expect(JSON.parse(r.text), e.key).toEqual({ error: "internal error" });
        }
      });
    }

    it("sanity — DB ที่พังทำให้ได้ 500 จริง และ error ตัวจริงถูก log ฝั่งเซิร์ฟเวอร์ (console.error)", () => {
      const failed = [...results].filter(([, r]) => r.status === 500).map(([key]) => key);
      expect(failed.length, "ไม่มี route ไหนได้ 500 — fault injection ไม่ถึง DB").toBeGreaterThan(0);
      expect(
        logged.some((arg) => String(arg).includes(SECRET)),
        "error จริงต้องถูก log ไว้ตรวจสอบ",
      ).toBe(true);
    });
  });

  describe("GET ทุกตัวที่ต้อง login — super · ข้อมูลจริง (ยิงครั้งเดียว ตรวจสามเรื่อง)", () => {
    interface Fetched extends Target, Seen {
      cacheControl: string | null;
    }
    const fetched = new Map<string, Fetched[]>();
    beforeAll(async () => {
      for (const e of guardedGets) {
        const list: Fetched[] = [];
        for (const target of getTargets(e)) {
          const res = await hit(target.path, { cookie: cookies.super });
          list.push({ ...target, cacheControl: res.headers.get("cache-control"), ...(await seen(res)) });
        }
        fetched.set(e.key, list);
      }
    });
    const responsesOf = (e: Endpoint) => fetched.get(e.key) ?? [];

    describe("Cache-Control: no-store (ASVS 4.0.3 V8.2.1 · API8:2023)", () => {
      for (const e of guardedGets.filter((e) => !NO_STORE_PENDING_F8.has(e.key))) {
        it(`${e.key} → 2xx พร้อม Cache-Control: no-store`, (ctx) => {
          const ok = responsesOf(e).find((r) => r.status >= 200 && r.status < 300);
          if (!ok) return ctx.skip(`${e.key}: ไม่มีข้อมูลในไฟล์นี้ที่ทำให้ได้ 2xx — ตรวจ header ไม่ได้`);
          expect(ok.cacheControl, `${e.key} [${ok.path}]`).toMatch(noStore);
        });
      }

      // วันนี้มีแค่ GET /api/customers/:id และ /:id/photo ที่ตั้ง no-store
      // แก้: ตั้ง header ใน route (หรือ middleware ของ /api หลัง requireSession) แล้วลบออกจาก NO_STORE_PENDING_F8
      it.fails(
        "F8 — GET /api/me · /api/customers · /api/gold-price/today · /api/metals ต้องส่ง Cache-Control: no-store",
        async () => {
          for (const key of NO_STORE_PENDING_F8) {
            const res = await hit(pathOf(key), { cookie: cookies.super });
            expect(res.status, key).toBe(200);
            expect(res.headers.get("cache-control"), key).toMatch(noStore);
          }
        },
      );
    });

    describe("เลขบัตรเต็มออกได้ที่ GET /api/customers/:id เท่านั้น (R13 · CLAUDE.md กฎ 7 · API3:2023)", () => {
      for (const e of guardedGets) {
        const exception = e.key === PII_EXCEPTION;
        const what = exception ? "ข้อยกเว้นเดียว: มีเลขบัตรของลูกค้าคนนั้นคนเดียว + no-store" : "ไม่มีเลขบัตรเต็ม";
        it(`${e.key} — ${what} (ทุก id จริง · ค้นด้วยเลขเต็ม/แบบหน้าบัตร/บางส่วน)`, () => {
          const responses = responsesOf(e);
          expect(responses, e.key).not.toEqual([]);
          for (const r of responses) {
            const where = `${e.key} [${r.path}]`;
            if (exception) {
              // ข้อยกเว้นต้อง "ยังทำงาน" และแคบ — เลขของคนที่ขอเท่านั้น ไม่ cache
              expect(r.status, where).toBe(200);
              expect(isJson(r.type), where).toBe(true);
              expect(nationalIdsIn(r.text), where).toEqual([r.nationalId]);
              expect(r.cacheControl, where).toMatch(noStore);
            } else if (!r.type?.startsWith("image/")) {
              expectNoNationalId(r.text, where, KNOWN_IDS);
            }
          }
        });
      }

      it("GET /api/auth/get-session (PUBLIC แต่ส่งข้อมูลผู้ใช้) — ไม่มีเลขบัตรเต็ม", async () => {
        const res = await hit("/api/auth/get-session", { cookie: cookies.super });
        expect(res.status).toBe(200);
        expectNoNationalId(await res.text(), "GET /api/auth/get-session", KNOWN_IDS);
      });
    });

    describe("เงิน/น้ำหนักใน JSON เป็น string · ไม่มี float (CLAUDE.md กฎ 1)", () => {
      for (const e of guardedGets) {
        it(`${e.key} — JSON ทุกก้อนที่ตอบมาผ่าน expectMoneyAsStrings`, (ctx) => {
          const json = responsesOf(e).filter((r) => isJson(r.type));
          if (json.length === 0) return ctx.skip(`${e.key}: ไม่มี response ที่เป็น JSON`);
          for (const r of json) expectMoneyAsStrings(JSON.parse(r.text), `${e.key} [${r.path}]`);
        });
      }

      it("POST /api/gold-price/quote — เงินเป็น string", async () => {
        const res = await hit("/api/gold-price/quote", {
          method: "POST",
          cookie: cookies.super,
          body: { bar_sell: "67850" },
        });
        expect(res.status).toBe(200);
        expectMoneyAsStrings(await res.json(), "POST /api/gold-price/quote");
      });

      it("PUT /api/gold-price/today (ตั้งราคาตอนเตรียมข้อมูล) — เงินเป็น string", () => {
        expect(priceSetBody).toMatchObject({ bar_sell: "67850.00" });
        expectMoneyAsStrings(priceSetBody, "PUT /api/gold-price/today");
      });
    });
  });

  describe("ไม่มี CORS — เว็บอื่นอ่าน response ด้วย cookie ของผู้ใช้ไม่ได้ (ASVS 4.0.3 V14.5.3 · API8:2023)", () => {
    for (const path of [...new Set(swept.map((e) => e.path))]) {
      it(`${path} — preflight และ GET จาก Origin อื่น (รวม "null") ไม่ได้ Access-Control-Allow-*`, async () => {
        const group = swept.filter((e) => e.path === path);
        const gets = new Set(group.filter((e) => e.method === "GET").map((e) => probePath(e, custWithPhoto)));
        // wildcard ของ better-auth มี path จริงต่างกันตาม method — preflight ทุกตัว (ไม่ซ้ำ)
        for (const concrete of new Set(group.map((e) => probePath(e, custWithPhoto)))) {
          for (const origin of ["https://evil.test", "null"]) {
            const preflight = await hit(concrete, {
              method: "OPTIONS",
              origin,
              headers: { "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
            });
            expectNoCors(preflight, `OPTIONS ${concrete} [Origin: ${origin}]`);
            if (gets.has(concrete)) {
              const res = await hit(concrete, { cookie: cookies.super, origin });
              expectNoCors(res, `GET ${concrete} [Origin: ${origin}]`);
            }
          }
        }
      });
    }
  });

  describe("ผู้ใช้ที่ไม่มีสาขา — fail-closed (CLAUDE.md กฎ 4 · API5:2023)", () => {
    for (const e of guardedGets.filter((e) => !hasParams(e.path) && !NO_BRANCH_GUARD_F4.has(e.key))) {
      const allowed = BRANCHLESS_ALLOWED.get(e.key);
      const what = allowed ? "200 แต่ไม่มีสาขาใดติดมา (BRANCHLESS_ALLOWED)" : "403/404 หรือรายการว่าง";
      it(`${e.key} → ${what}`, async () => {
        const res = await hit(e.path, { cookie: cookies.branchless });
        if (allowed) {
          expect(res.status, e.key).toBe(200);
          allowed(await res.json());
          return;
        }
        if (res.status === 403 || res.status === 404) {
          await expectApiError(res, res.status, e.key);
          return;
        }
        expect(res.status, `${e.key}: ผู้ใช้ไม่มีสาขาได้ ${res.status}`).toBe(200);
        const body = (await res.json()) as { items?: unknown };
        expect(body.items, `${e.key}: ผู้ใช้ไม่มีสาขาได้ข้อมูล — ใส่ requireAnyBranch หรือกรองด้วย forUser()`).toEqual(
          [],
        );
      });
    }

    // วันนี้ metals · gold-price มีแค่ requireSession → 200 ทุกตัว และ manager/admin ที่ไม่มีสาขาตั้งราคากลางได้ (เขียน audit)
    // แก้: เพิ่ม requireAnyBranch ให้ metalRoutes และ goldPriceRoutes แล้วลบออกจาก NO_BRANCH_GUARD_F4
    it.fails(
      "F4 — ผู้ใช้ที่ไม่มีสาขาที่เปิดอยู่ (ไม่เคยได้สาขา · สาขาเดียวถูกปิด) ได้ 403 ที่ /api/metals · /api/gold-price/* และตั้งราคาไม่ได้",
      async () => {
        const expectNoAccess = async (who: "branchless" | "closed") => {
          const cookie = cookies[who];
          const reads: [string, string, unknown][] = [
            ["GET", "/api/metals", undefined],
            ["GET", "/api/gold-price/today", undefined],
            ["POST", "/api/gold-price/quote", { bar_sell: "67850" }],
          ];
          for (const [method, path, body] of reads) {
            await expectApiError(await hit(path, { method, cookie, body }), 403, `${who} ${method} ${path}`);
          }
          const before = await sideEffects();
          const res = await hit("/api/gold-price/today", { method: "PUT", cookie, body: { bar_sell: "67850" } });
          await expectApiError(res, 403, `${who} PUT /api/gold-price/today`);
          expect(await sideEffects(), `${who}: ตั้งราคาไม่ได้ต้องไม่มีอะไรถูกเขียน`).toEqual(before);
        };
        await expectNoAccess("branchless"); // (a) admin ที่ไม่เคยได้สาขา
        const { db } = harness();
        await db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
        try {
          await expectNoAccess("closed"); // (b) manager ที่สาขาเดียวของตัวเองถูกปิด
        } finally {
          await db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
        }
      },
    );
  });

  describe("input ผิดรูป → 4xx ที่อ่านรู้เรื่อง ไม่ใช่ 5xx (ASVS 4.0.3 V5.1.3 · V5.1.4 · API8:2023)", () => {
    for (const e of guardedWrites) {
      it(`${e.key} — body ผิดรูป ${MALFORMED_BODIES.length} แบบ (JSON พัง/null/array/string · text/plain · multipart พัง) → ไม่ใช่ 5xx`, async () => {
        for (const [label, type, body] of MALFORMED_BODIES) {
          const res = await harness().app.request(probePath(e, custNoPhoto), {
            method: e.method,
            headers: { origin: ORIGIN, cookie: cookies.super, "content-type": type },
            body,
          });
          await expectNot5xx(res, `${e.key} [${label}]`);
        }
      });
    }

    // F9 — NUL byte (U+0000) ในข้อความที่ส่งเข้ามาไปถึง Postgres ซึ่งปฏิเสธ (22021 invalid byte sequence for encoding "UTF8": 0x00)
    // → 500 ทั้งค้นลูกค้าและบันทึกลูกค้า · เครื่องอ่านบัตรบางรุ่นเติม NUL ท้ายช่องได้ · id ใน path ไม่โดน (ตรวจ uuid ก่อนถึง DB)
    // ที่ถูก: 400 ชี้ช่อง (หรือตัด NUL ทิ้งก่อนบันทึก) · แก้: ปฏิเสธ/ตัด \u0000 ใน zod schema ของข้อความ (ListQuery.q · CustomerInput)
    it.fails("F9 — ข้อความที่มี NUL byte (U+0000) ต้องไม่ทำให้ 500 (ค้นลูกค้า · เพิ่มลูกค้า · แก้ลูกค้า)", async () => {
      await expectNot5xx(await hit("/api/customers?q=a%00b", { cookie: cookies.super }), "GET /api/customers?q=a%00b");
      const created = customerForm(syntheticNationalId(), "มี NUL");
      created.set("name_th", `${testName("มี")}\u0000NUL`);
      const post = await hit("/api/customers", { method: "POST", cookie: cookies.super, body: created });
      await expectNot5xx(post, "POST /api/customers (name_th มี NUL)");
      const updated = customerForm(ID_NO_PHOTO, "ลูกค้าไม่มีรูป");
      updated.set("address", "1 ถ.ทดสอบ\u0000");
      const put = await hit(`/api/customers/${custNoPhoto}`, { method: "PUT", cookie: cookies.super, body: updated });
      await expectNot5xx(put, "PUT /api/customers/:id (address มี NUL)");
    });
  });

  describe("path/method ที่ไม่มี", () => {
    // สาเหตุ: app.ts ตั้ง api.notFound(...) ให้ sub-app แต่ Hono ไม่คัดลอก notFound ตอน app.route("/api", api)
    // → ได้ notFound ของ app หลัก (ค่า default ของ Hono: text/plain "404 Not Found")
    // production แย่กว่านี้: index.ts:16-17 ต่อ serveStatic + SPA fallback (GET /*) ท้ายแอป → GET /api/<ไม่มี> ได้
    // index.html 200 text/html · แก้: app.notFound(JSON) ใน createApp และให้ SPA fallback ข้าม /api/*
    // (ถ้าแก้ด้วย api.all("*") ใน sub-app แทน route นั้นจะโผล่ใน listEndpoints — ต้องเพิ่มเป็นข้อยกเว้นในไฟล์นี้)
    it.fails(
      'F7 — GET /api/does-not-exist และ DELETE /api/customers/:id → 404 JSON {error:"not found"} (spec §5)',
      async () => {
        const unknown = await hit("/api/does-not-exist", { cookie: cookies.super });
        await expectError(unknown, 404, "not found", "GET /api/does-not-exist");
        const del = await hit(`/api/customers/${randomUUID()}`, { method: "DELETE", cookie: cookies.super });
        await expectError(del, 404, "not found", "DELETE /api/customers/:id");
      },
    );
  });
});
