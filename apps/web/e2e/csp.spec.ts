import { expect, test } from "@playwright/test";

// build จริงที่ api เสิร์ฟ (header CSP เดียวกับ production) — `pnpm build` แล้วให้ api เสิร์ฟ dist ที่ ./public
// E2E_PROD_URL=http://localhost:8787 pnpm --filter @ong/web e2e csp
const prodUrl = process.env.E2E_PROD_URL ?? "";

test.describe("production build ภายใต้ CSP", () => {
  test.skip(!prodUrl, "ตั้ง E2E_PROD_URL เป็น api ที่เสิร์ฟ build ของ web");

  test("/login ไม่มี CSP violation และไม่มี error ใน console", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      // ยังไม่ login → GET /api/me ตอบ 401 เป็นเรื่องปกติ (Chrome log เป็น error ของ network)
      if (message.type() === "error" && !message.text().includes("401")) problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    const response = await page.goto(`${prodUrl}/login`);
    expect(response?.headers()["content-security-policy"]).toContain("default-src 'self'");
    await expect(page.getByLabel("อีเมล")).toBeFocused();
    expect(problems).toEqual([]);
  });

  test("deep link ที่ไม่มีหน้า → 404 ภาษาไทยที่มี main และ h1 (SPA fallback ของ api)", async ({ page }) => {
    await page.goto(`${prodUrl}/no-such-page/deep`);
    await expect(page.getByRole("heading", { level: 1, name: "ไม่พบหน้านี้" })).toBeVisible();
    await expect(page.getByRole("main")).toHaveCount(1);
  });

  test("deep link ของหน้าที่ต้อง login → ไปหน้า login พร้อมจำปลายทาง", async ({ page }) => {
    await page.goto(`${prodUrl}/customers`);
    await expect(page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบ" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("redirect")).toBe("/customers");
  });
});
