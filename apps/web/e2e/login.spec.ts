import { expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y";

// บัญชีทดสอบใน DB local (สร้างด้วย apps/api `create-user`) — ไม่เก็บรหัสผ่านไว้ใน repo
const email = process.env.E2E_EMAIL ?? "";
const password = process.env.E2E_PASSWORD ?? "";

// ธีมเริ่มต้น "ตามระบบ" — จำลองเครื่องโหมดสว่าง/มืด แล้วตรวจ axe ทั้งสองธีม
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`ธีม ${colorScheme}`, () => {
    test.use({ colorScheme });

    test("login ด้วยคีย์บอร์ด → เข้าแอป → ออกจากระบบ (ผ่าน axe ทุกหน้า)", async ({ page }) => {
      test.skip(!email || !password, "ตั้ง E2E_EMAIL และ E2E_PASSWORD ก่อนรัน");

      await page.goto("/login");
      // public/theme-init.js ใส่ .dark ก่อน React วาด
      await expect(page.locator("html")).toHaveClass(colorScheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await expect(page.getByLabel("อีเมล")).toBeFocused();
      await expectAccessible(page);

      await page.keyboard.type(email);
      await page.keyboard.press("Tab");
      await page.keyboard.type(password);
      await page.keyboard.press("Enter");

      // บัญชีหลายสาขามีขั้นเลือกสาขา (โฟกัสอยู่ที่สาขาปัจจุบัน) — Enter ยืนยันได้เลย
      const home = page.getByRole("heading", { level: 1, name: "หน้าหลัก" });
      const branchStep = page.getByRole("heading", { level: 1, name: "เลือกสาขาที่ทำงาน" });
      await expect(home.or(branchStep)).toBeVisible();
      if (await branchStep.isVisible()) {
        await expectAccessible(page);
        await page.keyboard.press("Enter");
      }

      await expect(home).toBeVisible();
      await expect(page.getByRole("navigation", { name: "เมนูหลัก" })).toBeVisible();
      await expectAccessible(page);

      await page.getByRole("button", { name: new RegExp(email) }).click();
      await page.getByRole("menuitem", { name: "ออกจากระบบ" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบ" })).toBeVisible();
    });
  });
}
