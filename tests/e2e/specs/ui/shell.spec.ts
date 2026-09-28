import AxeBuilder from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { target } from "../../lib/target";

/** axe-core's WCAG 2.0 / 2.1 / 2.2 level A and AA rule tags */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** everything the browser complains about while the page runs */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
  page.on("requestfailed", (req) => problems.push(`request failed: ${req.url()} ${req.failure()?.errorText ?? ""}`));
  page.on("response", (res) => {
    if (res.status() >= 400) problems.push(`HTTP ${res.status()}: ${res.url()}`);
  });
  return problems;
}

/** the first request the SPA itself makes to /api (fetch/XHR) */
function firstApiCall(page: Page) {
  return page.waitForResponse((res) => {
    const kind = res.request().resourceType();
    return new URL(res.url()).pathname.startsWith("/api/") && (kind === "fetch" || kind === "xhr");
  });
}

test.describe("SPA in Chromium — the first screen a cashier sees", () => {
  test("boots in Thai with its own font and a quiet console", async ({ page }) => {
    const problems = watchProblems(page);
    const apiCall = firstApiCall(page);
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("lang", "th"); // WCAG 3.1.1 language of page
    await expect(page).toHaveTitle(/หลอมทอง/); // WCAG 2.4.2 page titled
    await expect(page.locator("#root")).not.toBeEmpty(); // React mounted

    // the SPA reaches the api on its own origin — one origin, cookie auth, no CORS (spec §10)
    const res = await apiCall;
    expect(new URL(res.url()).origin).toBe(target.origin);
    expect(res.status()).toBeLessThan(500);

    // Sarabun is self-hosted (no CDN): the body uses it and its @font-face really loads.
    // fonts.load() resolves [] when no face matches — check() would say true for a missing font.
    const font = await page.evaluate(async () => {
      const faces = await document.fonts.load('16px "Sarabun"', "ทองคำ");
      return { body: getComputedStyle(document.body).fontFamily, faces: faces.map((f) => f.status) };
    });
    expect(font.body).toMatch(/^"?Sarabun"?,/);
    expect(font.faces.length, "a Sarabun @font-face exists").toBeGreaterThan(0);
    expect(font.faces.every((status) => status === "loaded")).toBe(true);

    await page.waitForLoadState("load");
    expect(problems).toEqual([]);
  });

  test("no serious or critical WCAG 2.2 AA violations (axe-core)", async ({ page }, testInfo) => {
    const apiCall = firstApiCall(page);
    await page.goto("/");
    await apiCall; // let the first data render before scanning

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
    await testInfo.attach("axe-results.json", {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });

    const blocking = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    expect(blocking).toEqual([]);
  });
});
