import { type APIRequestContext, expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y";

// ซื้อเข้าครบวงจรด้วยคีย์บอร์ด: เสียบบัตร (พิมพ์แบบ Siam ID) → 2 รายการ → เต็มจำนวน → Ctrl+Enter → ใบรับซื้อ + พิมพ์
// ใช้ได้ทั้งเครื่อง local และ staging UAT — ข้อมูลที่สร้างเป็นลูกค้าสมมติ (เลขบัตร checksum ถูก ชื่อมี "ทดสอบ")
const staff = { email: process.env.E2E_EMAIL ?? "", password: process.env.E2E_PASSWORD ?? "" };
const manager = { email: process.env.E2E_MANAGER_EMAIL ?? "", password: process.env.E2E_MANAGER_PASSWORD ?? "" };

/** เลขบัตรสมมติ 13 หลักที่หลักตรวจสอบถูก (mod 11) — ขึ้นต้น 9 ไม่ชนเลขจริง */
function makeFakeNationalId(): string {
  const body = `9${String(Date.now()).slice(-11)}`;
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (13 - i), 0);
  return `${body}${(11 - (sum % 11)) % 10}`;
}

async function signIn(request: APIRequestContext, baseURL: string, who: { email: string; password: string }) {
  const res = await request.post("/api/auth/sign-in/email", { headers: { origin: baseURL }, data: who });
  expect(res.ok(), `login ${who.email}: HTTP ${res.status()}`).toBeTruthy();
}

test("ซื้อเข้าด้วยคีย์บอร์ดจนได้ใบรับซื้อ และพิมพ์อัตโนมัติหนึ่งครั้ง", async ({ page, playwright, baseURL }) => {
  // ครบวงจร: sign-in + สร้างลูกค้า + 2 รายการ + เต็มจำนวน + save + poll ใบรับซื้อ + 3 รอบ axe — ช้ากว่า timeout เริ่มต้น 30s บน staging
  test.setTimeout(90_000);
  test.skip(!staff.email || !staff.password, "ตั้ง E2E_EMAIL และ E2E_PASSWORD (บัญชีพนักงาน) ก่อนรัน");
  const origin = baseURL ?? "";

  // ราคาทองวันนี้ต้องตั้งแล้ว (ผู้จัดการ) — ไม่มีบัญชีผู้จัดการ = ถือว่าตั้งไว้แล้ว
  if (manager.email && manager.password) {
    const managerApi = await playwright.request.newContext({ baseURL: origin });
    await signIn(managerApi, origin, manager);
    const price = await managerApi.put("/api/gold-price/today", {
      headers: { origin },
      data: { bar_sell: "67850", confirm_typo: true },
    });
    expect(price.ok(), "set today's gold price").toBeTruthy();
    await managerApi.dispose();
  }

  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await signIn(page.request, origin, staff);
  const nationalId = makeFakeNationalId();
  const created = await page.request.post("/api/customers", {
    headers: { origin },
    multipart: {
      national_id: nationalId,
      name_th: `นายทดสอบ E2E ${nationalId.slice(-4)}`,
      address: "1 หมู่ 1 ต.ทดสอบ อ.เมือง จ.ภูเก็ต",
      card_expire_text: "31/12/2575",
    },
  });
  expect(created.status(), "create a fake customer").toBe(201);

  await page.goto("/buy");
  const idBox = page.getByLabel("เลขบัตรประชาชน");
  await expect(idBox).toBeFocused();
  await expectAccessible(page);

  // Siam ID: เลขบัตร Tab ชื่อ … Enter — ช่องเลขบัตรกลืนส่วนที่เหลือ แล้วพาไปช่องปริมาณ
  await page.keyboard.type(nationalId);
  await page.keyboard.press("Tab");
  await page.keyboard.type("นายทดสอบ E2E");
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("ปริมาณ (กรัม)")).toBeFocused();

  await page.keyboard.type("5.86");
  await page.keyboard.press("Enter");
  await page.keyboard.type("20030");
  await page.keyboard.press("Enter");
  const lines = page.getByRole("table", { name: "รายการสินค้ารับซื้อ" });
  await expect(lines).toContainText("3,418.09");

  // โลหะที่สอง: Shift+Tab กลับไปกลุ่มโลหะ → ลูกศรขวา = นาก
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("ArrowRight");
  const nak = page.getByRole("radio", { name: "นาก" });
  await expect(nak).toBeFocused();
  await expect(nak).toBeChecked();
  await page.keyboard.press("Enter");
  await page.keyboard.type("100");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1,500");
  await page.keyboard.press("Enter");
  await expect(lines).toContainText("นาก");
  await expect(lines).toContainText("21,530.00");

  await page.getByRole("button", { name: "เต็มจำนวน" }).click();
  await expect(page.getByText("ชำระเงินครบถ้วน กรุณากดปุ่มบันทึก")).toBeVisible();
  await expect(page.getByRole("button", { name: /^บันทึก/ })).toBeFocused();
  await expectAccessible(page);

  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/buy\/[0-9a-f-]{36}$/);
  const receipt = page.getByRole("region", { name: "ใบรับซื้อของเก่า/ใบสำคัญจ่าย" });
  await expect(receipt).toContainText("ใบรับซื้อของเก่า/ใบสำคัญจ่าย");
  await expect(receipt).toContainText(/(?:[A-Z]+-)?RC\d{4}-\d{4}/);
  await expect(receipt).not.toContainText(nationalId);
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.getByRole("link", { name: "ซื้อเข้าบิลใหม่" })).toBeFocused();
  await expectAccessible(page);
});
