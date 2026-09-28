import { expect, test } from "../../lib/fixtures";
import { expectApiError } from "../../lib/http";

/**
 * Every method on a path the api does not have is a JSON 404 — not the SPA shell with 200 (spec §5 error shape).
 * Same-origin writes (smoke only sends cross-site ones, which CSRF refuses first); nothing exists to be written.
 */
test.describe("unknown /api paths — JSON 404 on every method", () => {
  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    test(`${method} → 404 {"error":"not found"}, no-store`, async ({ anonymous, signedIn }) => {
      for (const [who, client] of [
        ["signed out", await anonymous()],
        ["signed in", await signedIn("staff")],
      ] as const) {
        const withBody = method !== "GET" && method !== "OPTIONS";
        const res = await client.fetch("/api/this-route-does-not-exist", {
          method,
          ...(withBody ? { data: { probe: "e2e" } } : {}),
        });
        const body = await expectApiError(res, 404);
        expect(body, who).toEqual({ error: "not found" });
        expect(res.headers()["cache-control"], who).toBe("no-store");
      }
    });
  }
});
