import { target } from "../../lib/target";
import { expect, test } from "./site";

/**
 * Product gaps found by this suite, owned by the api — expected to fail until fixed (test.fail keeps CI green
 * and turns red the moment a fix lands, so the annotation gets removed in the same change).
 * Tag: @known-issue. Details and reproduction: tests/e2e/README.md → "Known issues".
 */

test.fail(
  "an unknown /api path answers JSON 404 instead of the SPA shell",
  {
    tag: "@known-issue",
    annotation: {
      type: "issue",
      description:
        "apps/api/src/index.ts registers the SPA fallback (GET /* → index.html) after createApp, so " +
        "api.notFound never runs: GET /api/nope → 200 text/html. Clients and monitors see success.",
    },
  },
  async ({ site }) => {
    const res = await site.get("/api/this-route-does-not-exist");
    expect(res.status()).toBe(404);
    expect(res.headers()["content-type"]).toContain("application/json");
  },
);

test.fail(
  "responses carry the OWASP security headers",
  {
    tag: "@known-issue",
    annotation: {
      type: "issue",
      description:
        "No secure-headers middleware (e.g. hono/secure-headers): the shell and the api send no CSP, " +
        "frame-ancestors/X-Frame-Options, X-Content-Type-Options or Referrer-Policy, and staging adds no " +
        "HSTS at the edge (ASVS 4.0.3 V14.4.3–V14.4.7).",
    },
  },
  async ({ site }) => {
    for (const path of ["/", "/api/healthz"]) {
      const headers = (await site.get(path)).headers();
      expect.soft(headers["x-content-type-options"], `${path} nosniff`).toBe("nosniff");
      expect.soft(headers["referrer-policy"], `${path} Referrer-Policy`).toBeTruthy();
      expect
        .soft(`${headers["content-security-policy"] ?? ""} ${headers["x-frame-options"] ?? ""}`, `${path} framing`)
        .toMatch(/frame-ancestors|DENY|SAMEORIGIN/i);
      if (path === "/") expect.soft(headers["content-security-policy"], "CSP on the shell").toBeTruthy();
      if (target.baseURL.startsWith("https:")) {
        expect.soft(headers["strict-transport-security"], `${path} HSTS`).toMatch(/max-age=\d{7,}/);
      }
    }
  },
);
