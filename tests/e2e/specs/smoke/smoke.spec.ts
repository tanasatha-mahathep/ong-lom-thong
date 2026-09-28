import { expectApiError, expectNoLeak } from "../../lib/http";
import { expect, test } from "./site";

interface Health {
  ok: boolean;
  time: string;
}

test.describe("health — what Railway's healthcheck and the SPA poll", () => {
  for (const path of ["/healthz", "/api/healthz"]) {
    test(`${path} answers ok`, async ({ site }) => {
      const res = await site.get(path);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("application/json");
      const body = (await res.json()) as Health;
      expect(body.ok).toBe(true);
      expect(Number.isNaN(Date.parse(body.time))).toBe(false);
    });
  }
});

test.describe("SPA shell — the api serves apps/web on the same origin", () => {
  test("the shell is served with a Thai document language and its assets load", async ({ site }) => {
    const res = await site.get("/");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/html");
    const html = await res.text();
    expect(html).toMatch(/<html[^>]*\blang="th"/);
    expect(html).toMatch(/<div id="root"[^>]*>/); // the mount point, whatever a later build pre-renders into it

    // every script/stylesheet the shell references must come back as what it claims to be
    const assets = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(assets.length, "the shell references its bundle").toBeGreaterThan(0);
    for (const asset of assets as string[]) {
      const file = await site.get(asset);
      expect(file.status(), asset).toBe(200);
      expect(file.headers()["content-type"], asset).toMatch(asset.endsWith(".css") ? /text\/css/ : /javascript/);
    }
  });

  test("a deep link gets the same shell (client-side routing)", async ({ site }) => {
    const [root, deep] = await Promise.all([site.get("/"), site.get("/customers")]);
    expect(deep.status()).toBe(200);
    expect(await deep.text()).toBe(await root.text());
  });

  test("path traversal never serves files from outside the web build (ASVS V12.3)", async ({ site }) => {
    for (const path of ["/..%2fpackage.json", "/%2e%2e/package.json", "/..%2f..%2fetc%2fpasswd", "/dist/index.js"]) {
      const res = await site.get(path);
      const body = await res.text();
      expect(body, path).not.toContain('"dependencies"');
      expect(body, path).not.toContain("root:x:0:0");
      expect(body, path).not.toContain("createApp");
    }
  });
});

test.describe("access control — fail closed without a session (spec §10 · ASVS V4)", () => {
  for (const path of ["/api/me", "/api/customers", "/api/metals", "/api/gold-price/today", "/api/buy"]) {
    test(`GET ${path} without a session is 401`, async ({ site }) => {
      expect((await expectApiError(await site.get(path), 401)).error).toBe("unauthorized");
    });
  }

  test("a forged session cookie is 401, not an error", async ({ site }) => {
    const forged = { cookie: "__Secure-better-auth.session_token=forged.c2lnbmF0dXJl" };
    await expectApiError(await site.get("/api/me", forged), 401);
  });
});

test.describe("CSRF — writes from another origin are refused before any handler (spec §10)", () => {
  const writes = [
    ["POST", "/api/customers"],
    ["POST", "/api/buy"],
    ["POST", "/api/buy/quote"],
    ["PUT", "/api/gold-price/today"],
    ["POST", "/api/me/branch"],
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/auth/sign-out"],
  ] as const;

  for (const [method, path] of writes) {
    test(`${method} ${path} from a foreign origin is 403`, async ({ site }) => {
      const res = await site.foreignWrite(method, path);
      expect((await expectApiError(res, 403)).error).toBe("forbidden origin");
      expect(res.headers()["set-cookie"]).toBeUndefined();
    });
  }

  test("a write without any Origin header is refused too", async ({ site }) => {
    await expectApiError(await site.foreignWrite("POST", "/api/customers", null), 403);
  });
});

test.describe("error bodies — no stack traces or internals (ASVS V7.4 · V14.3)", () => {
  test("malformed and hostile requests get short JSON errors", async ({ site }) => {
    const responses = await Promise.all([
      site.get("/api/customers/%E0%A4%A"),
      site.get("/api/customers?page=%ZZ"),
      site.get("/api/customers/not-a-uuid"),
      site.get(`/api/customers/${"x".repeat(4000)}`),
      site.get("/api/me", { cookie: "__Secure-better-auth.session_token=%00%ff" }),
      site.foreignWrite("DELETE", "/api/customers"),
    ]);
    for (const res of responses) {
      const body = await res.text();
      expect(res.status(), res.url()).toBeGreaterThanOrEqual(400);
      expect(res.status(), `${res.url()} must not crash the server`).toBeLessThan(500);
      expectNoLeak(body);
    }
  });

  test("HEAD on the api does not leak either", async ({ site }) => {
    const res = await site.head("/api/me");
    expect(res.status()).toBe(401);
    expectNoLeak(await res.text());
  });
});
