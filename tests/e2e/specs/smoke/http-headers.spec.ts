import { expect, test } from "./site";

/**
 * Response headers — OWASP ASVS 4.0.3 V14.4 and the OWASP Secure Headers Project, as apps/api/src/lib/httpHeaders.ts
 * and lib/spa.ts set them. Minimums, not the exact strings: a stricter policy later must not fail these checks.
 */

const ONE_YEAR = 31_536_000;

/** Content-Security-Policy → directive → sources */
function parseCsp(header: string | undefined): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of (header ?? "").split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/** what every response carries, whatever it is — soft, so one run lists every missing header */
function expectSecurityHeaders(headers: Record<string, string>, where: string): void {
  expect.soft(headers["x-content-type-options"], `${where}: nosniff`).toBe("nosniff");
  expect.soft(headers["x-frame-options"], `${where}: X-Frame-Options`).toBe("DENY");
  expect.soft(headers["referrer-policy"], `${where}: Referrer-Policy`).toBe("strict-origin-when-cross-origin");
  expect.soft(headers["cross-origin-opener-policy"], `${where}: COOP`).toBe("same-origin");
  expect.soft(headers["cross-origin-resource-policy"], `${where}: CORP`).toBe("same-origin");
  // HSTS ≥ 1 year. The app sends it on every response, over plain http://localhost too: browsers ignore HSTS
  // received over an insecure connection (RFC 6797 §8.1) and apply it once Railway serves the site over HTTPS.
  const hsts = headers["strict-transport-security"] ?? "";
  const maxAge = /(?:^|;)\s*max-age=(\d+)/i.exec(hsts)?.[1];
  expect.soft(Number(maxAge ?? 0), `${where}: Strict-Transport-Security max-age`).toBeGreaterThanOrEqual(ONE_YEAR);
  // ASVS 5.0 3.4.1 (L2): subdomains too — the api sets it since PR #68
  expect.soft(/(?:^|;)\s*includesubdomains\s*(?:;|$)/i.test(hsts), `${where}: HSTS includeSubDomains`).toBe(true);

  const csp = parseCsp(headers["content-security-policy"]);
  expect.soft(csp.get("default-src"), `${where}: CSP default-src`).toEqual(["'self'"]);
  // no script-src means default-src governs scripts: this origin only — no inline script, no eval, no CDN
  const scripts = csp.get("script-src") ?? csp.get("default-src") ?? [];
  expect.soft(scripts, `${where}: CSP scripts only from 'self'`).toEqual(["'self'"]);
  expect.soft(csp.get("object-src"), `${where}: CSP object-src`).toEqual(["'none'"]);
  // ASVS 5.0 3.4.3: the SPA has no <base>, so nothing may set one (PR #68)
  expect.soft(csp.get("base-uri"), `${where}: CSP base-uri`).toEqual(["'none'"]);
  expect.soft(csp.get("frame-ancestors"), `${where}: CSP frame-ancestors`).toEqual(["'none'"]);
  expect.soft(csp.get("form-action"), `${where}: CSP form-action`).toEqual(["'self'"]);
}

test.describe("security headers and caching (ASVS V14.4 · spec §10)", () => {
  test("the SPA shell on every route: secured, revalidated on each load (no-cache)", async ({ site }) => {
    // no-cache: after a deploy the browser must fetch the index.html that points at the new asset hashes
    for (const path of ["/", "/index.html", "/login", "/customers"]) {
      const res = await site.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"], path).toContain("text/html");
      expect.soft(res.headers()["cache-control"], `${path}: Cache-Control`).toBe("no-cache");
      expectSecurityHeaders(res.headers(), path);
      // documents only: powerful features the counter never needs stay off (the ID photo comes by paste or upload)
      const policy = res.headers()["permissions-policy"] ?? "";
      for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
        expect
          .soft(policy, `${path}: Permissions-Policy ${feature}=()`)
          .toMatch(new RegExp(`(?:^|,)\\s*${feature}=\\(\\)`));
      }
    }
    const hsts = (await site.get("/")).headers()["strict-transport-security"] ?? "(none)";
    test.info().annotations.push({ type: "Strict-Transport-Security", description: hsts });
  });

  test("hashed assets: cached for a year, immutable", async ({ site }) => {
    const html = await (await site.get("/")).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1] ?? "");
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      const res = await site.get(asset);
      expect(res.status(), asset).toBe(200);
      expect
        .soft(res.headers()["cache-control"], `${asset}: Cache-Control`)
        .toBe(`public, max-age=${ONE_YEAR}, immutable`);
      expectSecurityHeaders(res.headers(), asset);
    }
  });

  test("the api: never cached, secured on success and on every error", async ({ site }) => {
    const responses = [
      ["GET /api/healthz", await site.get("/api/healthz")],
      ["GET /api/me (401)", await site.get("/api/me")],
      ["GET unknown /api path (404)", await site.get("/api/this-route-does-not-exist")],
      ["POST /api/customers cross-site (403)", await site.foreignWrite("POST", "/api/customers")],
    ] as const;
    for (const [what, res] of responses) {
      expect.soft(res.headers()["cache-control"], `${what}: Cache-Control`).toBe("no-store");
      expectSecurityHeaders(res.headers(), what);
    }
  });
});
