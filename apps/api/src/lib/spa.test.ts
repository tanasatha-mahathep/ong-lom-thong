import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveSpa } from "./spa";

const INDEX = '<!doctype html><script type="module" src="/assets/index-NEW123.js"></script>';

describe("serveSpa — tab เก่าข้าม redeploy ต้องไม่ได้ index.html แทน JS", () => {
  let dir = "";
  let app: Hono;

  beforeAll(() => {
    // build จำลองของ apps/web: index.html · asset มี hash · ฟอนต์ใน /fonts
    dir = mkdtempSync(join(tmpdir(), "ong-spa-"));
    mkdirSync(join(dir, "assets"));
    mkdirSync(join(dir, "fonts"));
    writeFileSync(join(dir, "index.html"), INDEX);
    writeFileSync(join(dir, "assets", "index-NEW123.js"), "export {};");
    writeFileSync(join(dir, "fonts", "Sarabun-Regular.woff2"), "woff2");
    app = new Hono().get("/api/healthz", (c) => c.json({ ok: true }));
    // serveStatic รับ root แบบสัมพัทธ์จาก cwd เท่านั้น
    serveSpa(app, relative(process.cwd(), dir));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("asset ที่มีอยู่ได้ไฟล์จริง · HEAD ด้วย", async () => {
    for (const method of ["GET", "HEAD"]) {
      const res = await app.request("/assets/index-NEW123.js", { method });
      expect(res.status, method).toBe(200);
      expect(res.headers.get("content-type"), method).toMatch(/javascript/);
    }
  });

  it("asset ที่ไม่มี (chunk ของ build ก่อน) = 404 ไม่ใช่ index.html", async () => {
    for (const path of ["/assets/index-OLD999.js", "/assets/nested/gone.css"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get("content-type"), path).not.toMatch(/text\/html/);
      expect(await res.text(), path).not.toContain("<!doctype html>");
    }
  });

  it("index.html ทุกทาง (/ · /index.html · route ของ SPA)", async () => {
    for (const path of ["/", "/index.html", "/customers/0f8e9a3c-1234-4234-8234-123456789012", "/buy"]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toBe(INDEX);
    }
  });

  it("ไฟล์อื่นนอก /assets ได้ไฟล์จริง · route ที่ลงก่อนไม่ถูกแตะ", async () => {
    expect((await app.request("/fonts/Sarabun-Regular.woff2")).status).toBe(200);
    expect(await (await app.request("/api/healthz")).json()).toEqual({ ok: true });
  });
});
