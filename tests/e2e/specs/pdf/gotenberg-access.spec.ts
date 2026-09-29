import { randomBytes } from "node:crypto";
import { type APIResponse, expect, test } from "@playwright/test";
import { GOTENBERG_USERNAME, basicAuth, convert, gotenbergPassword, pdfFixture } from "../../lib/pdf";
import { target } from "../../lib/target";

/**
 * The renderer only works for whoever holds the shared secret (OWASP ASVS 4.0.3 V4.1 — access control enforced by
 * the service, deny by default). Every convert request below is the same valid form; only the credentials change.
 */

const HTML = pdfFixture("thai-a4.html");
const url = (path: string): string => `${target.gotenbergURL}${path}`;

/** 401 with a Basic challenge (RFC 9110 §11.6.1 · RFC 7617) and no PDF in the body */
async function expectChallenge(res: APIResponse): Promise<void> {
  const body = await res.body();
  expect(res.status(), body.toString("utf8", 0, 200)).toBe(401);
  expect(res.headers()["www-authenticate"]).toMatch(/^basic\b/i);
  expect(body.toString("latin1", 0, 5)).not.toBe("%PDF-");
}

test.describe("Gotenberg answers only to the shared secret", () => {
  test("/health answers 200 without credentials, Chromium up", async ({ request }) => {
    const res = await request.get(url("/health"));
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { details?: { chromium?: { status?: unknown } } };
    expect(body.details?.chromium?.status).toBe("up");
  });

  test("convert without credentials → 401", async ({ request }) => {
    await expectChallenge(await convert(request, HTML));
  });

  test("convert with a wrong password → 401", async ({ request }) => {
    const authorization = basicAuth(GOTENBERG_USERNAME, randomBytes(32).toString("hex"));
    await expectChallenge(await convert(request, HTML, { authorization }));
  });

  test("convert with the right password under another user name → 401", async ({ request }) => {
    const authorization = basicAuth("gotenberg", gotenbergPassword());
    await expectChallenge(await convert(request, HTML, { authorization }));
  });

  test("positive control: the same request with the shared secret → 200 PDF", async ({ request }) => {
    const res = await convert(request, HTML, { authorization: basicAuth(GOTENBERG_USERNAME, gotenbergPassword()) });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).toString("latin1", 0, 5)).toBe("%PDF-");
  });

  test("the other routes need the secret too — only /health is open", async ({ request }) => {
    // 404 would also keep them closed (a later image may drop a route); what must never happen is an answer
    for (const path of ["/version", "/prometheus/metrics"]) {
      const res = await request.get(url(path));
      expect.soft([401, 404], `${path} without credentials → ${res.status()}`).toContain(res.status());
    }
  });

  test("the LibreOffice routes are off even with the secret (--libreoffice-disable-routes)", async ({ request }) => {
    const res = await request.post(url("/forms/libreoffice/convert"), {
      headers: { authorization: basicAuth(GOTENBERG_USERNAME, gotenbergPassword()) },
      multipart: { files: { name: "index.html", mimeType: "text/html; charset=utf-8", buffer: Buffer.from(HTML) } },
    });
    expect(res.status()).toBe(404);
  });
});
