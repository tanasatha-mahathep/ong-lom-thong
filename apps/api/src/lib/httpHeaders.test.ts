import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { noStoreByDefault, securityHeaders } from "./httpHeaders";

const CSP =
  "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

function app() {
  return new Hono()
    .use(securityHeaders)
    .use("/api/*", noStoreByDefault)
    .get("/api/receipt.pdf", (c) =>
      // แบบ route PDF (#54): ตั้ง Content-Disposition / Cache-Control เอง
      c.body("%PDF-1.4", 200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="B-0001.pdf"',
        "Cache-Control": "private, max-age=0, must-revalidate",
      }),
    )
    .get("/api/data", (c) => c.json({ ok: true }))
    .get("/", (c) => c.html("<!doctype html><title>spa</title>"));
}

describe("securityHeaders + noStoreByDefault", () => {
  it("ทุก response ได้ CSP · DENY · nosniff · HSTS · COOP · referrer", async () => {
    for (const path of ["/", "/api/data", "/api/receipt.pdf"]) {
      const res = await app().request(path);
      expect(res.headers.get("content-security-policy"), path).toBe(CSP);
      expect(res.headers.get("x-frame-options"), path).toBe("DENY");
      expect(res.headers.get("x-content-type-options"), path).toBe("nosniff");
      expect(res.headers.get("strict-transport-security"), path).toBe("max-age=31536000");
      expect(res.headers.get("cross-origin-opener-policy"), path).toBe("same-origin");
      expect(res.headers.get("referrer-policy"), path).toBe("strict-origin-when-cross-origin");
    }
  });

  it("API ได้ no-store เป็นค่าเริ่มต้น · route ที่ตั้ง Cache-Control / Content-Disposition เองไม่ถูกทับ · SPA ไม่โดน", async () => {
    expect((await app().request("/api/data")).headers.get("cache-control")).toBe("no-store");
    const pdf = await app().request("/api/receipt.pdf");
    expect(pdf.headers.get("cache-control")).toBe("private, max-age=0, must-revalidate");
    expect(pdf.headers.get("content-disposition")).toBe('inline; filename="B-0001.pdf"');
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect((await app().request("/")).headers.get("cache-control")).toBeNull();
  });
});
