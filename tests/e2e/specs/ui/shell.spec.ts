import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "../../lib/fixtures";
import { CLIENT_IP_HEADER, clientAddress } from "../../lib/http";
import { target } from "../../lib/target";

/** axe-core's WCAG 2.0 / 2.1 / 2.2 level A and AA rule tags */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// the browser is one more client behind the edge: its own client IP, like the api project's clients
test.use({ extraHTTPHeaders: { [CLIENT_IP_HEADER]: clientAddress() } });

interface CspViolation {
  directive: string;
  blocked: string;
  source: string;
}

/**
 * zod v4 probes `new Function("")` once per page (util.allowsEval) to pick its JIT parser, catches the refusal and
 * falls back — harmless, but a script-src violation on every load of the production build (apps/web: set
 * `z.config({ jitless: true })`). Allowed in the journey; `@known-issue` below turns red once it is gone.
 */
const isZodEvalProbe = (v: CspViolation) => v.directive === "script-src" && v.blocked === "eval";

/**
 * Everything the browser complains about: console errors, uncaught exceptions, failed requests, HTTP ≥ 400 and
 * Content-Security-Policy violations (the production CSP only exists in the image — `vite dev` has none).
 * CSP violations are collected from `securitypolicyviolation` events, which say exactly what was blocked; the
 * console lines Chromium prints for them are left to that list. One response is by design: before signing in,
 * the SPA's session probe GET /api/me answers 401 (Chromium logs "Failed to load resource") — allowed only then.
 */
async function watchProblems(page: Page) {
  const problems: string[] = [];
  const csp: CspViolation[] = [];
  let signedIn = false;
  const expected = (url: string, status: number) => !signedIn && status === 401 && new URL(url).pathname === "/api/me";

  await page.exposeFunction("__e2eCspViolation", (v: CspViolation) => csp.push(v));
  await page.addInitScript(() => {
    const report = (window as unknown as { __e2eCspViolation: (v: CspViolation) => void }).__e2eCspViolation;
    document.addEventListener("securitypolicyviolation", (e) =>
      report({ directive: e.effectiveDirective, blocked: e.blockedURI, source: `${e.sourceFile}:${e.lineNumber}` }),
    );
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Content Security Policy|'script-src' was not explicitly set|unsafe-eval|unsafe-inline/.test(text)) return;
    if (text.startsWith("Failed to load resource") && text.includes("401") && expected(msg.location().url, 401)) {
      return;
    }
    problems.push(`console.error: ${text} (${msg.location().url})`);
  });
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
  page.on("requestfailed", (req) => problems.push(`request failed: ${req.url()} ${req.failure()?.errorText ?? ""}`));
  page.on("response", (res) => {
    if (res.status() >= 400 && !expected(res.url(), res.status())) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  return {
    problems,
    csp,
    signingIn: () => {
      signedIn = true;
    },
  };
}

async function expectAccessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  await test.info().attach(`axe-${name}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(blocking, `${name}: serious/critical WCAG 2.2 AA violations`).toEqual([]);
}

test.describe("SPA in Chromium from the production image — sign in to the first screen a cashier sees", () => {
  test("login page → sign in by keyboard → home with today's price board", async ({ page, signedIn, accounts }) => {
    // the board shows the price the api stores — set it (R7) so the screen is the same on every run
    const manager = await signedIn("manager");
    expect((await manager.put("/api/gold-price/today", { data: { bar_sell: "67850" } })).status()).toBe(200);

    const watch = await watchProblems(page);
    const apiCalls: string[] = [];
    page.on("request", (req) => {
      if (new URL(req.url()).pathname.startsWith("/api/")) apiCalls.push(req.url());
    });

    await test.step("signed out, / sends the cashier to /login", async () => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบ" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("lang", "th"); // WCAG 3.1.1
      await expect(page).toHaveTitle(/หลอมทอง/); // WCAG 2.4.2
      await expect(page.getByLabel("อีเมล")).toBeFocused(); // keyboard-first counter
    });

    await test.step("the self-hosted Sarabun face is used and actually loads", async () => {
      // fonts.load() resolves [] when no face matches — check() would say true for a missing font
      const font = await page.evaluate(async () => {
        const faces = await document.fonts.load('16px "Sarabun"', "ทองคำ");
        return { body: getComputedStyle(document.body).fontFamily, faces: faces.map((f) => f.status) };
      });
      expect(font.body).toMatch(/^"?Sarabun"?,/);
      expect(font.faces.length, "a Sarabun @font-face exists").toBeGreaterThan(0);
      expect(font.faces.every((status) => status === "loaded")).toBe(true);
    });

    await test.step("the login page passes axe", () => expectAccessible(page, "login"));

    await test.step("sign in with the keyboard only", async () => {
      watch.signingIn();
      await page.keyboard.type(accounts.staff.email);
      await page.keyboard.press("Tab");
      await page.keyboard.type(accounts.staff.password);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1, name: "หน้าแรก" })).toBeVisible();
      await expect(page).toHaveURL(`${target.baseURL}/`);
      await expect(page.getByRole("navigation", { name: "เมนูหลัก" })).toBeVisible();
    });

    await test.step("the price board shows the server's R8 numbers as they are", async () => {
      // 67,850 → bar buy 67,650 → jewelry HALF_UP(67,650 × 0.95) = 64,268 — no arithmetic in the browser.
      // The board in <main>, not the header's compact copy of the same prices.
      const main = page.getByRole("main");
      for (const [label, value] of [
        ["ทองแท่งขายออก", "67,850"],
        ["ทองแท่งรับซื้อ", "67,650"],
        ["ทองรูปพรรณรับซื้อ", "64,268"],
      ] as const) {
        await expect(main.getByRole("term").filter({ hasText: label })).toBeVisible();
        await expect(main.getByRole("definition").filter({ hasText: value }), label).toHaveText(`${value}บาท`);
      }
    });

    await test.step("the home page passes axe", () => expectAccessible(page, "home"));

    // one origin, cookie auth, no CORS (spec §10) — a quiet console and nothing blocked by the CSP the whole way
    expect(apiCalls.length).toBeGreaterThan(0);
    expect(apiCalls.filter((url) => new URL(url).origin !== target.origin)).toEqual([]);
    await page.waitForLoadState("load");
    expect(watch.problems).toEqual([]);
    expect(watch.csp.filter((v) => !isZodEvalProbe(v))).toEqual([]);
  });

  test.fail(
    "the production CSP blocks nothing on the home page",
    {
      tag: "@known-issue",
      annotation: {
        type: "issue",
        description:
          "apps/web (web session): zod v4 probes eval once per page load (util.allowsEval → new Function('')); " +
          "the CSP refuses it (script-src 'self' via default-src) — a violation on every load. " +
          "Fix: z.config({ jitless: true }) before any schema parses. Remove test.fail with that change.",
      },
    },
    async ({ page, signedIn }) => {
      const watch = await watchProblems(page);
      const staff = await signedIn("staff");
      await page.context().addCookies((await staff.storageState()).cookies);
      await page.goto("/");
      // the price board and the day's totals are parsed with zod schemas by now
      await expect(page.getByRole("heading", { level: 1, name: "หน้าแรก" })).toBeVisible();
      await expect(page.getByRole("main").getByRole("heading", { level: 2, name: "ยอดซื้อวันนี้" })).toBeVisible();
      // one more page task so a queued securitypolicyviolation event has reached the test
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(watch.csp).toEqual([]);
    },
  );
});
