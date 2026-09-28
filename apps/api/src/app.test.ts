import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { type TestApp, databaseAvailable, startTestApp } from "./test/harness";

const available = await databaseAvailable();
const PW = "correct-horse-battery";
const ORIGIN = "http://localhost:8787";
const SPA = "<!doctype html><title>ONG</title>";

describe.skipIf(!available)("createApp — JSON 404 · access log", () => {
  let t: TestApp;
  let cookie = "";

  beforeAll(async () => {
    t = await startTestApp();
    // SPA fallback แบบ index.ts — ลงหลัง createApp
    t.app.get("/*", (c) => c.html(SPA));
    await t.createUser({ email: "staff@ong.test", password: PW, branch: "00000" });
    cookie = await t.login("staff@ong.test", PW);
  });
  afterAll(async () => {
    await t?.close();
  });

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE"])(
    "%s /api/<ไม่มี route> = JSON 404 ไม่ใช่ index.html ของ SPA",
    async (method) => {
      for (const path of ["/api/nope", "/api/nope/deeper", "/api"]) {
        const res = await t.request(path, { method, cookie, origin: ORIGIN });
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(res.headers.get("content-type"), `${method} ${path}`).toMatch(/^application\/json/);
        expect(await res.json()).toEqual({ error: "not found" });
      }
    },
  );

  it("path ที่ไม่มีใต้ router ที่ต้อง login: login แล้ว = JSON 404 · ไม่ login = 401", async () => {
    const res = await t.request("/api/customers/00000000-0000-4000-8000-000000000000/nope", { cookie });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect((await t.request("/api/customers/x/nope")).status).toBe(401);
  });

  it("access log ลงก่อน route: /api ถูก log · ไม่มี query string (เลขบัตร) · ไม่มี cookie", async () => {
    // เทสต์อื่นปิด log (NODE_ENV=test) — ตัวนี้สร้างแอปแบบ dev จาก dependency ชุดเดียวกัน
    const logged = createApp({ ...t, env: { ...t.env, NODE_ENV: "development" } });
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await logged.request("/api/customers?q=1103700123458", { headers: { cookie } });
      expect(res.status).toBe(200);
      await logged.request("/api/nope", { headers: { cookie } });
      const lines = spy.mock.calls.map((args) => args.join(" "));
      expect(lines).toEqual([
        expect.stringMatching(/^GET \/api\/customers 200 \d+ms$/),
        expect.stringMatching(/^GET \/api\/nope 404 \d+ms$/),
      ]);
      for (const line of lines) {
        expect(line).not.toContain("1103700123458");
        expect(line).not.toContain("q=");
        expect(line).not.toContain("session_token");
      }
    } finally {
      spy.mockRestore();
    }
  });
});
