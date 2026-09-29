import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requireSameOriginFetch } from "./fetchSite";

const CROSS_SITE = { error: "เปิดไฟล์นี้จากเว็บอื่นไม่ได้ — เปิดจากหน้าระบบโดยตรง" };

const BILL = "0199a0d6-0000-4000-8000-000000000001";
const CUSTOMER = "0199a0d6-0000-4000-8000-000000000002";

/** เส้นทางที่ต้องมีด่าน — ของสำคัญที่ออกทาง GET (zip บัญชี · สำเนาบัตร · ใบรับซื้อ · รูปสำเนาบัตร) */
const GUARDED = [
  "/api/reports/export?year=2026&month=10",
  `/api/buy/${BILL}/idcard`,
  `/api/buy/${BILL}/pdf`,
  `/api/customers/${CUSTOMER}/photo`,
] as const;

/** เส้นทางที่ต้องไม่โดนด่าน — JSON ธรรมดา · เส้นทางที่ชื่อใกล้กัน · better-auth */
const UNGUARDED = [
  "/api/me",
  "/api/buy",
  `/api/buy/${BILL}`,
  "/api/reports/purchase",
  "/api/reports/stock",
  `/api/customers/${CUSTOMER}`,
  "/api/auth/get-session",
] as const;

/** แอปจิ๋ว: ทุก route ตอบ 200 เหมือนกัน — สิ่งที่วัดคือด่านปล่อยผ่านหรือปฏิเสธ ไม่ใช่ตรรกะของ route */
function app() {
  return new Hono().use("/api/*", requireSameOriginFetch).all("/api/*", (c) => c.json({ ok: true }));
}

const get = (path: string, site?: string) =>
  app().request(path, { headers: site === undefined ? {} : { "Sec-Fetch-Site": site } });

describe("requireSameOriginFetch", () => {
  it.each(GUARDED)("cross-site เข้า %s = 403 ไม่ถึง handler", async (path) => {
    const res = await get(path, "cross-site");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(CROSS_SITE);
  });

  // subdomain ข้างเคียง (หรือที่ถูกยึด) ก็ same-site และส่ง cookie SameSite=Lax ได้ — SPA กับ API origin เดียว
  // จึงไม่มี client จริงที่ต้องใช้ same-site
  it.each(GUARDED)("same-site เข้า %s = 403", async (path) => {
    expect((await get(path, "same-site")).status).toBe(403);
  });

  // ห้าม fail-closed กับ header ที่หายไป — ไม่งั้นฝ่ายบัญชี/เครื่องมือของร้านดาวน์โหลดไม่ได้
  it.each(GUARDED)("ไม่มี header Sec-Fetch-Site เข้า %s = ผ่าน (browser เก่า · curl)", async (path) => {
    const res = await get(path);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each(GUARDED)("same-origin เข้า %s = ผ่าน", async (path) => {
    expect((await get(path, "same-origin")).status).toBe(200);
  });

  // ผู้ใช้เปิดเอง: พิมพ์ URL · bookmark · เปิดไฟล์ที่ดาวน์โหลดไว้ — ผู้โจมตีทำให้เกิดค่านี้ไม่ได้
  it.each(GUARDED)("none เข้า %s = ผ่าน (พิมพ์ URL · bookmark)", async (path) => {
    expect((await get(path, "none")).status).toBe(200);
  });

  it("ค่าที่ไม่รู้จัก = 403 (browser ส่งได้แค่ 4 ค่าตามสเปก)", async () => {
    expect((await get(GUARDED[0], "weird")).status).toBe(403);
  });

  it("เทียบค่าแบบไม่สนตัวพิมพ์และช่องว่าง (เผื่อ proxy แก้รูปคำ)", async () => {
    expect((await get(GUARDED[0], " Same-Origin ")).status).toBe(200);
    expect((await get(GUARDED[0], "CROSS-SITE")).status).toBe(403);
  });

  // browser ไม่ส่งค่าว่าง — ถ้าเจอคือ proxy ระหว่างทางแก้ ไม่ใช่การโจมตี จึงนับเท่ากับไม่ได้ส่งมา
  it("ค่าว่าง = เท่ากับไม่ได้ส่ง header (ผ่าน)", async () => {
    for (const value of ["", "   "]) {
      expect((await get(GUARDED[0], value)).status, JSON.stringify(value)).toBe(200);
    }
  });

  it.each(UNGUARDED)("endpoint อื่นไม่ได้รับผลกระทบ: cross-site เข้า %s ยังผ่าน", async (path) => {
    const res = await get(path, "cross-site");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("/api/auth/* ไม่โดนด่านนี้ — better-auth ตรวจ CSRF ของตัวเอง", async () => {
    for (const path of ["/api/auth/get-session", "/api/auth/sign-in/email", "/api/auth/sign-out"]) {
      expect((await get(path, "cross-site")).status, path).toBe(200);
    }
  });

  // POST ของ /buy/:id/pdf/retry และ /buy/:id/void ไม่เข้าด่านนี้ (sameOriginOnly กัน Origin ให้แล้ว)
  it("เส้นทาง POST ที่ต่อท้ายจาก path ที่กัน ไม่ถูกจับผิดตัว", async () => {
    expect((await get(`/api/buy/${BILL}/pdf/retry`, "cross-site")).status).toBe(200);
    expect((await get(`/api/buy/${BILL}/void`, "cross-site")).status).toBe(200);
  });

  it("HEAD ของ zip บัญชีก็ถูกกัน — cross-site ไม่ควรวัดได้ว่าเดือนนั้นมีอะไร", async () => {
    const res = await app().request("/api/reports/export?year=2026&month=10", {
      method: "HEAD",
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });
});

/**
 * path แปลก ๆ ต้องไม่ทำให้ด่านถูกข้าม — GUARDED_PATHS เทียบกับ c.req.path ตรงตัวอักษร คำถามคือ
 * "มี path รูปไหนที่ไปถึง handler ได้ แต่ regex ไม่ match" (ถ้ามี = ดูดไฟล์และลง audit ได้โดยไม่ผ่านด่าน)
 *
 * คำตอบจากการวัดจริงข้างล่าง: **ไม่มี** — Hono decode + normalize path ก่อนส่งให้ middleware และ router
 * ก็ match ด้วยค่าเดียวกันนั้น ฉะนั้น "handler ถึงได้" ⇒ "ด่านเห็น path ที่ normalize แล้ว" เสมอ
 * ส่วน path ที่ normalize ไม่เป็นรูปนั้น (slash เกิน · trailing slash · %2F · ตัวพิมพ์ใหญ่) router ก็ไม่ match
 * → ตกที่ /api/* 404 ไม่ถึง handler และไม่ลง audit · เทียบ raw path จึงปลอดภัย
 *
 * เทสต์กลุ่มนี้คือ regression guard: ถ้า Hono เปลี่ยนพฤติกรรม decode/normalize วันหลัง จะ fail ที่นี่
 */
describe("requireSameOriginFetch — path ที่ encode / รูปแปลก", () => {
  /** เลียนโครง app.ts: sub-app ที่ /api มี route จริง แล้วปิดท้ายด้วย /api/* = 404 */
  function realistic() {
    const api = new Hono()
      .use(requireSameOriginFetch)
      .get("/reports/export", (c) => c.json({ ok: true }))
      .get("/buy/:id/pdf", (c) => c.json({ ok: true }));
    const outer = new Hono();
    outer.route("/api", api);
    outer.all("/api/*", (c) => c.json({ error: "not found" }, 404));
    return outer;
  }
  const hit = (raw: string, site = "cross-site") =>
    realistic().request(`http://localhost${raw}`, { headers: { "Sec-Fetch-Site": site } });

  // Hono decode ก่อน middleware — ด่านจึงยังจับได้ (ถ้าวันหนึ่งไม่ decode เทสต์นี้จะ fail = ช่องโหว่)
  it.each([
    ["percent-encode ตัวอักษรกลางคำ", "/api/reports/e%78port"],
    ["percent-encode ตัวแรก", "/api/reports/%65xport"],
    ["มี ./ คั่น", "/api/./reports/export"],
    ["percent-encode ใน path ของบิล", `/api/buy/${BILL}/%70df`],
  ])("%s → ยังถูกกัน 403", async (_label, raw) => {
    const res = await hit(raw);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(CROSS_SITE);
  });

  // รูปที่ regex ไม่ match — ต้องเป็น 404 (ไม่ถึง handler) ไม่ใช่ 200
  it.each([
    ["trailing slash", "/api/reports/export/"],
    ["slash เกิน", "/api/reports//export"],
    ["%2F แทน /", "/api%2Freports%2Fexport"],
    ["ช่องว่างต่อท้าย", "/api/reports/export%20"],
    ["ตัวพิมพ์ใหญ่", "/API/reports/export"],
  ])("%s → 404 ไม่ถึง handler (ไม่ใช่ 200)", async (_label, raw) => {
    expect((await hit(raw)).status).toBe(404);
  });

  it("path ปกติยังทำงาน — เทียบว่า 404 ข้างบนมาจากรูป path ไม่ใช่จากด่าน", async () => {
    expect((await hit("/api/reports/export", "same-origin")).status).toBe(200);
    expect((await hit("/api/reports/e%78port", "same-origin")).status).toBe(200);
  });
});
