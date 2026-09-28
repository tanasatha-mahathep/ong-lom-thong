import { randomUUID } from "node:crypto";
import {
  auditLog,
  branch,
  buyReceipt,
  customer,
  docSequence,
  goldPrice,
  metal,
  session,
  stockMovement,
  user,
} from "@ong/db";
import { and, count, eq, isNull, max } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { UNUSABLE_CHARS_MSG } from "./lib/text";
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
 * แก้แล้ว it.fails จะแดง: เปลี่ยนเป็น it และลบค่าคงที่ของ finding นั้นออก — F4 · F7 · F8 · F9 · F13 · F17 แก้แล้ว (ตรึงเป็น it)
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

/** ไม่มีอะไรถูกลบ — ยกเลิก = เอกสารใหม่ (CLAUDE.md กฎ 5 · spec §5) · ยกเว้นที่ระบุเหตุผลไว้ (เจ้าของตัดสินใจ) */
const NO_DELETE_ALLOWED = new Set<string>([
  // PR #60: ยกเลิกราคาเฉพาะสาขาของวันนี้ → กลับไปใช้ราคากลาง · ไม่ใช่เอกสาร/ไฟล์ (กฎ 5 พูดถึงใบรับซื้อ/PDF)
  // ลง audit gold_price.clear_branch พร้อมค่าที่ลบ · ใบรับซื้อเก็บ snapshot ราคาของตัวเองอยู่แล้ว — spec §5 ยังไม่มี DELETE
  "DELETE /api/gold-price/today/branches/:branchId",
]);

/**
 * เลข 13 หลักที่ไม่ใช่เลขบัตรของบุคคล — เลขผู้เสียภาษีของร้าน (นิติบุคคล · COMPANY_TAX_ID) ต้องพิมพ์บนใบรับซื้อ
 * (เอกสารภาษี) และมากับบิลใน snapshot ของกิจการ (PR #68) · ยกเว้นเฉพาะเลขนี้ตัวเดียว เลขอื่นยังถูกจับ
 */
const notPersonalIds = () => [harness().env.COMPANY_TAX_ID];

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
  // PR #68: จัดการสาขา/ผู้ใช้ — requireRole("admin") ทั้ง router · เป็นข้อมูลระบบทั้งร้าน ไม่ใช่ข้อมูลของสาขา (spec §10:
  // admin = ผู้ใช้/สาขา/ตั้งค่า) · admin ที่ยังไม่มีสาขาต้องเข้าได้เพื่อผูกสาขาให้คนอื่น (bootstrap) — ต้องได้รายการจริง
  ["GET /api/admin/branches", (body) => expect((body as { items?: unknown }).items).toEqual(expect.any(Array))],
  ["GET /api/admin/users", (body) => expect((body as { items?: unknown }).items).toEqual(expect.any(Array))],
]);

/**
 * 404 JSON ของ path ที่ไม่มีใต้ /api ทุก method (app.all("/api/*") · PR #61 แก้ F7) — ไม่ใช่ endpoint: ไม่ต้อง login
 * (path ที่ไม่มีตอบ 404 เหมือนกันทุกคน) · ยังอยู่ใต้ sameOriginOnly (Origin แปลก = 403 ก่อน 404) · ตรวจแยกใน "path/method ที่ไม่มี"
 */
const NOT_FOUND_FALLBACK = "/api/*";
const isFallback = (e: Endpoint) => e.path === NOT_FOUND_FALLBACK;

/** header ความปลอดภัยที่ทุก response ของ /api ต้องมี (PR #61 · OWASP ASVS 4.0.3 V14.4 · RFC 9111 §5.2.2.5) */
const SECURITY_HEADERS: [string, RegExp][] = [
  ["cache-control", /\bno-store\b/],
  ["x-content-type-options", /^nosniff$/],
  ["x-frame-options", /^DENY$/],
  ["content-security-policy", /frame-ancestors 'none'/],
  ["referrer-policy", /^strict-origin-when-cross-origin$/],
  ["strict-transport-security", /^max-age=\d+/],
  ["cross-origin-opener-policy", /^same-origin$/],
];

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
  "GET /api/buy",
  "POST /api/buy/quote",
  "POST /api/buy",
  "GET /api/buy/:id",
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
let receiptId = "";
let goldId = "";
let priceSetBody: unknown;

// ---------- กลุ่ม endpoint ----------

const isApi = (e: Endpoint) => e.path === "/api" || e.path.startsWith("/api/");
const isStateChanging = (e: Endpoint) => (STATE_CHANGING as readonly string[]).includes(e.method);
// HEAD ได้จาก GET เสมอ (Hono) — ตรวจคู่กับ GET ใน 401 sweep
const swept = endpoints.filter((e) => e.method !== "HEAD");
const guarded = swept.filter((e) => isApi(e) && !PUBLIC.has(e.key) && !isFallback(e));
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
  form.append("card_expire_text", "31/12/2574"); // บัตรยังไม่หมดอายุ — ใช้เปิดบิลได้ (R2)
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
    case "POST /api/buy/quote":
      return billBody();
    case "POST /api/buy":
      return { ...billBody(), idempotency_key: `probe-${randomUUID()}` }; // key ใหม่ทุกครั้ง = ถ้าหลุดจะเขียนบิลใหม่จริง
    default:
      return {};
  }
}
/** บิลใบจริง 5.860 กรัม · 20,030 บาท ของลูกค้าที่มีรูป (บัตรยังไม่หมดอายุ) */
function billBody() {
  return {
    customer_id: custWithPhoto,
    lines: [{ metal_id: goldId, weight_g: "5.860", amount: "20030" }],
    payments: [{ method: "cash", amount: "20030" }],
  };
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
  const [[audits], [customers], [prices], central, [sessions], superSessions, [receipts], [stock], sequences] =
    await Promise.all([
      db.select({ n: count() }).from(auditLog),
      db.select({ n: count(), lastUpdate: max(customer.updatedAt) }).from(customer),
      db.select({ n: count() }).from(goldPrice),
      db
        .select({ barSell: goldPrice.barSell })
        .from(goldPrice)
        .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, TODAY))),
      db.select({ n: count() }).from(session),
      db.select({ id: session.id, branch: session.currentBranchId }).from(session).where(eq(session.userId, superId)),
      db.select({ n: count() }).from(buyReceipt),
      db.select({ n: count() }).from(stockMovement),
      db.select().from(docSequence), // เลขที่เอกสาร (R9) ต้องไม่ถูกกินไปกับ request ที่ถูกปฏิเสธ
    ]);
  const photos = storage.keys().length;
  return { audits, customers, prices, central, sessions, superSessions, receipts, stock, sequences, photos };
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
/** id จริงของแต่ละทรัพยากรที่ไฟล์นี้สร้างไว้ — เป็น fixture ไม่ใช่รายการ route (route ยังอ่านจาก router) */
function fixturesFor(e: Endpoint): { id: string; nationalId: string }[] {
  const customers = [
    { id: custWithPhoto, nationalId: ID_WITH_PHOTO },
    { id: custNoPhoto, nationalId: ID_NO_PHOTO },
  ];
  const receipts = [{ id: receiptId, nationalId: ID_WITH_PHOTO }];
  if (e.path.startsWith("/api/customers/")) return customers;
  if (e.path.startsWith("/api/buy/")) return receipts;
  return [...customers, ...receipts]; // route ใหม่ที่ยังไม่มี fixture — ลองทุก id (ไม่ตรงก็ได้ 404 ซึ่งถูกตรวจเหมือนกัน)
}

/** request ของ GET sweep — :id = ทรัพยากรจริง · list = ไม่ค้น + ค้นด้วยเลขบัตรเต็ม · แบบหน้าบัตร · บางส่วน 5 หลัก */
function getTargets(e: Endpoint): Target[] {
  if (hasParams(e.path)) return fixturesFor(e).map((f) => ({ path: probePath(e, f.id), nationalId: f.nationalId }));
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

    // บิลจริงหนึ่งใบ (สาขา 00000 ของ super) — GET /api/buy และ /api/buy/:id ต้องมีข้อมูลให้ตรวจ ไม่ใช่ข้าม
    const [gold] = await T.db.select({ id: metal.id }).from(metal).where(eq(metal.code, "gold"));
    goldId = gold?.id ?? "";
    const bill = await T.request("/api/buy", {
      cookie: cookies.super,
      body: { ...billBody(), idempotency_key: `contract-fixture-${randomUUID()}` },
    });
    if (bill.status !== 201) throw new Error(`เปิดบิลไม่สำเร็จ: ${bill.status} ${await bill.text()}`);
    receiptId = ((await bill.json()) as { id: string }).id;
    // งานสร้าง PDF หลังบันทึก (renderer ปลอมของ harness) — ให้ /buy/:id/pdf และ /idcard มีไฟล์จริงให้ตรวจ ไม่ใช่ข้าม
    await T.tasks.idle();
    const [ready] = await T.db
      .select({ pdf: buyReceipt.pdfStatus, idcard: buyReceipt.idcardStatus })
      .from(buyReceipt)
      .where(eq(buyReceipt.id, receiptId));
    if (ready?.pdf !== "ready" || ready.idcard !== "ready")
      throw new Error(`PDF ของบิลตั้งต้นไม่พร้อม: ${JSON.stringify(ready)}`);
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
      };
      for (const [name, entries] of Object.entries(lists)) {
        for (const key of entries)
          expect(keys.has(key), `${name} มี "${key}" ซึ่งไม่มี route นี้แล้ว — ลบออก`).toBe(true);
      }
      // ข้อยกเว้นของ GET sweep ต้องเป็น GET ที่ต้อง login จริง — ไม่งั้นข้ามไปเปล่า ๆ
      for (const key of [PII_EXCEPTION, ...BRANCHLESS_ALLOWED.keys()]) {
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
      const deletes = endpoints
        .filter((e) => e.method === "DELETE" && !isFallback(e) && !NO_DELETE_ALLOWED.has(e.key))
        .map((e) => e.key);
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
      const broken = createApp({
        db: brokenDb,
        auth: T.auth,
        env: T.env,
        storage: T.storage,
        pdf: T.pdf,
        now: () => NOW,
      });
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
      headers: Record<string, string | null>;
    }
    const fetched = new Map<string, Fetched[]>();
    beforeAll(async () => {
      for (const e of guardedGets) {
        const list: Fetched[] = [];
        for (const target of getTargets(e)) {
          const res = await hit(target.path, { cookie: cookies.super });
          const headers = Object.fromEntries(SECURITY_HEADERS.map(([name]) => [name, res.headers.get(name)]));
          list.push({ ...target, cacheControl: res.headers.get("cache-control"), headers, ...(await seen(res)) });
        }
        fetched.set(e.key, list);
      }
    });
    const responsesOf = (e: Endpoint) => fetched.get(e.key) ?? [];

    describe("Cache-Control: no-store (ASVS 4.0.3 V8.2.1 · API8:2023)", () => {
      for (const e of guardedGets) {
        it(`${e.key} → 2xx พร้อม Cache-Control: no-store`, (ctx) => {
          const ok = responsesOf(e).find((r) => r.status >= 200 && r.status < 300);
          if (!ok) return ctx.skip(`${e.key}: ไม่มีข้อมูลในไฟล์นี้ที่ทำให้ได้ 2xx — ตรวจ header ไม่ได้`);
          expect(ok.cacheControl ?? "(ไม่มี Cache-Control)", `${e.key} [${ok.path}]`).toMatch(noStore);
        });
      }

      // F8 · F17 — แก้แล้วใน dev (PR #61 · fix(api): send security headers and no-store on every api response):
      // /api/* ตั้ง Cache-Control: no-store เป็นค่าเริ่มต้น (route ที่ตั้งเองใช้ค่าของ route) · เดิมเป็น it.fails สองตัว
      // (F8: /api/me · รายการลูกค้า · ราคาวันนี้ · โลหะ · F17: ราคาวันนี้ทุกสาขาของ PR #60) — sweep ข้างบนครอบทุก GET แล้ว
      it("F8 (แก้แล้ว) — รายการลูกค้า · /api/me · response ของ PUT /api/customers/:id (+ ราคาวันนี้ · โลหะ) ส่ง Cache-Control: no-store", async () => {
        for (const path of ["/api/customers", "/api/me", "/api/gold-price/today", "/api/metals"]) {
          const res = await hit(path, { cookie: cookies.super });
          expect(res.status, path).toBe(200);
          expect(res.headers.get("cache-control") ?? "(ไม่มี Cache-Control)", path).toMatch(noStore);
        }
        const put = await hit(`/api/customers/${custNoPhoto}`, {
          method: "PUT",
          cookie: cookies.super,
          body: customerForm(ID_NO_PHOTO, "ลูกค้าไม่มีรูป"),
        });
        expect(put.status).toBe(200);
        expect(put.headers.get("cache-control") ?? "(ไม่มี Cache-Control)", "PUT /api/customers/:id").toMatch(noStore);
      });

      it("F17 (แก้แล้ว) — GET /api/gold-price/today/branches ส่ง Cache-Control: no-store", async () => {
        const res = await hit("/api/gold-price/today/branches", { cookie: cookies.super });
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control") ?? "(ไม่มี Cache-Control)").toMatch(noStore);
      });
    });

    describe("header ความปลอดภัยทุก response (PR #61 · ASVS 4.0.3 V14.4.3–V14.4.7 · V8.2.1)", () => {
      for (const e of guardedGets) {
        it(`${e.key} — nosniff · X-Frame-Options DENY · CSP frame-ancestors 'none' · Referrer-Policy · HSTS · COOP · no-store`, () => {
          const responses = responsesOf(e);
          expect(responses, e.key).not.toEqual([]);
          for (const r of responses) {
            for (const [name, pattern] of SECURITY_HEADERS) {
              expect(r.headers[name] ?? `(ไม่มี ${name})`, `${e.key} [${r.path}] ${name}`).toMatch(pattern);
            }
          }
        });
      }
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
            } else if (!r.type?.startsWith("image/") && !r.type?.startsWith("application/pdf")) {
              // รูปบัตรและไฟล์ PDF ใบรับซื้อ/สำเนาบัตรมีเลขเต็มได้ (CLAUDE.md กฎ 7 · R13) — เสิร์ฟหลัง login + no-store เท่านั้น
              expectNoNationalId(r.text, where, KNOWN_IDS, notPersonalIds());
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
        it(`${e.key} — JSON ทุกก้อนผ่าน expectMoneyAsStrings · ที่ไม่ใช่ JSON ต้องเป็นไฟล์ (PDF/รูป)`, () => {
          const responses = responsesOf(e);
          expect(responses, e.key).not.toEqual([]);
          for (const r of responses) {
            const where = `${e.key} [${r.path}]`;
            if (isJson(r.type)) expectMoneyAsStrings(JSON.parse(r.text), where);
            else
              expect(r.type ?? "(ไม่มี Content-Type)", `${where}: ไม่ใช่ JSON ต้องเป็นไฟล์`).toMatch(
                /^(application\/pdf|image\/)/,
              );
          }
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
    for (const e of guardedGets.filter((e) => !hasParams(e.path))) {
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

    // F4 — แก้แล้วใน dev (PR #60 · fix(api): require an open branch for the gold price and metal routes)
    // เดิมเป็น it.fails (metals · gold-price มีแค่ requireSession → 200 และ manager/admin ที่ไม่มีสาขาตั้งราคากลางได้)
    it("F4 (แก้แล้ว) — ผู้ใช้ที่ไม่มีสาขาที่เปิดอยู่ (ไม่เคยได้สาขา · สาขาเดียวถูกปิด) ได้ 403 ที่ /api/metals · /api/gold-price/* และตั้งราคาไม่ได้", async () => {
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
    });
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

    // F9 · F13 — แก้แล้วใน dev (PR #53 · fix(api): reject malformed UTF-16 in free-text input): อักขระควบคุม (เช่น NUL)
    // และ surrogate ที่ไม่มีคู่ในช่องข้อความอิสระ → 400 ชี้ช่อง ก่อนถึง Postgres (เดิม 22021 → 500 · เป็น it.fails สองตัว)
    const unusable = (field: string) => ({ error: UNUSABLE_CHARS_MSG, field });

    it("F9 (แก้แล้ว) — ลูกค้า: NUL byte ในคำค้น · ชื่อ · ที่อยู่ → 400 ชี้ช่อง · ไม่มีอะไรถูกบันทึก", async () => {
      const cookie = cookies.super;
      const before = await sideEffects();
      const search = await hit("/api/customers?q=a%00b", { cookie });
      expect(await expectApiError(search, 400, "GET /api/customers?q=a%00b")).toEqual(unusable("q"));
      const created = customerForm(syntheticNationalId(), "มี NUL");
      created.set("name_th", `${testName("มี")}\u0000NUL`);
      const post = await hit("/api/customers", { method: "POST", cookie, body: created });
      expect(await expectApiError(post, 400, "POST /api/customers (name_th มี NUL)")).toEqual(unusable("name_th"));
      const updated = customerForm(ID_NO_PHOTO, "ลูกค้าไม่มีรูป");
      updated.set("address", "1 ถ.ทดสอบ\u0000");
      const put = await hit(`/api/customers/${custNoPhoto}`, { method: "PUT", cookie, body: updated });
      expect(await expectApiError(put, 400, "PUT /api/customers/:id (address มี NUL)")).toEqual(unusable("address"));
      expect(await sideEffects()).toEqual(before);
    });

    it("F13 (แก้แล้ว) — /api/buy: NUL byte ในคำค้น · ตัวกรองโลหะ · detail · ชื่อธนาคาร → 400 ชี้ช่อง · ไม่มีอะไรถูกบันทึก", async () => {
      const cookie = cookies.super;
      const before = await sideEffects();
      const reads: [string, string][] = [
        ["/api/buy?q=a%00b", "q"],
        ["/api/buy?metal=%00", "metal"],
      ];
      for (const [path, field] of reads) {
        expect(await expectApiError(await hit(path, { cookie }), 400, `GET ${path}`)).toEqual(unusable(field));
      }
      const bills: [string, Record<string, unknown>][] = [
        ["detail", { detail: "ทดสอบ\u0000" }],
        ["payments.0.bank", { payments: [{ method: "transfer", bank: "ทดสอบ\u0000", amount: "20030" }] }],
      ];
      for (const [field, over] of bills) {
        const body = { ...billBody(), idempotency_key: `nul-${randomUUID()}`, ...over };
        const res = await hit("/api/buy", { method: "POST", cookie, body });
        expect(await expectApiError(res, 400, `POST /api/buy (${field} มี NUL)`)).toEqual(unusable(field));
      }
      expect(await sideEffects()).toEqual(before);
    });
  });

  describe("path/method ที่ไม่มี", () => {
    // F7 — แก้แล้วใน dev (PR #61 · fix(api): answer unknown /api paths with a JSON 404): app.all("/api/*") ท้ายแอป
    // เดิมเป็น it.fails (api.notFound ของ sub-app ไม่ถูกใช้ → text/plain "404 Not Found" · production ตกไป SPA index.html 200)
    it('F7 (แก้แล้ว) — path/method ที่ไม่มีใต้ /api ทุก method → 404 JSON {error:"not found"} ทั้งมีและไม่มี session · Origin แปลก = 403 ก่อน', async () => {
      for (const cookie of [cookies.super, undefined]) {
        const who = cookie ? "super" : "ไม่มี cookie";
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
          const res = await hit("/api/does-not-exist", { method, cookie, body: method === "GET" ? undefined : {} });
          await expectError(res, 404, "not found", `${method} /api/does-not-exist [${who}]`);
        }
        const head = await hit("/api/does-not-exist", { method: "HEAD", cookie });
        expect(head.status, `HEAD [${who}]`).toBe(404);
        // method ที่ไม่มีบน prefix ที่ต้อง login (/api/customers/*): ไม่มี session = 401 ก่อน (ด่านของ router ครอบทุก method)
        const del = await hit(`/api/customers/${randomUUID()}`, { method: "DELETE", cookie });
        if (cookie) await expectError(del, 404, "not found", `DELETE /api/customers/:id [${who}]`);
        else await expectError(del, 401, "unauthorized", `DELETE /api/customers/:id [${who}]`);
      }
      const foreign = await hit("/api/does-not-exist", {
        method: "POST",
        cookie: cookies.super,
        origin: "https://evil.test",
        body: {},
      });
      await expectError(foreign, 403, "forbidden origin", "POST /api/does-not-exist [Origin อื่น]");
    });
  });
});
