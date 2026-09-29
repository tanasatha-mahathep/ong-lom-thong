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
