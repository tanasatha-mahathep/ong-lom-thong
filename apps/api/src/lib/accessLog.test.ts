import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { accessLog, loggablePath } from "./accessLog";

function app(lines: string[]) {
  return new Hono()
    .use(accessLog((l) => lines.push(l)))
    .get("/api/data", (c) => c.json({ ok: true }))
    .get("/api/boom", () => {
      throw new Error("boom");
    })
    .onError((_err, c) => c.json({ error: "internal error" }, 500));
}

describe("accessLog — ไม่มี PII", () => {
  it("method · path ไม่มี query · status · เวลา — ไม่มีคำค้น cookie หรือ header", async () => {
    const lines: string[] = [];
    await app(lines).request("/api/data?q=1103700123458&page=2", {
      headers: { cookie: "better-auth.session_token=secret-token", "x-real-ip": "198.51.100.9" },
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^GET \/api\/data 200 \d+ms$/);
    for (const leak of ["1103700123458", "q=", "?", "secret-token", "198.51.100.9"]) {
      expect(lines[0]).not.toContain(leak);
    }
  });

  it("route พัง = บรรทัด 500 · เลข 13 หลักใน path ถูกปิด · uuid ไม่โดน", async () => {
    const lines: string[] = [];
    await app(lines).request("/api/boom");
    expect(lines).toEqual([expect.stringMatching(/^GET \/api\/boom 500 \d+ms$/)]);
    expect(loggablePath("/api/customers/1103700123458/photo")).toBe("/api/customers/#############/photo");
    const uuid = "/api/customers/12345678-1234-4234-8234-123456789012";
    expect(loggablePath(uuid)).toBe(uuid);
  });

  it("write = null ไม่ log (เทสต์)", async () => {
    const res = await new Hono()
      .use(accessLog(null))
      .get("/", (c) => c.text("ok"))
      .request("/");
    expect(res.status).toBe(200);
  });
});
