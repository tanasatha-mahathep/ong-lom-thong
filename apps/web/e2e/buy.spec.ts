import { type APIRequestContext, expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y";

// ซื้อเข้าครบวงจรด้วยคีย์บอร์ด: เสียบบัตร (พิมพ์แบบ Siam ID) → 2 รายการ (ค่าบริสุทธิ์ · หัก % · ปริมาณ — ราคาเซิร์ฟเวอร์คิด)
// → เต็มจำนวน → Ctrl+Enter → ใบรับซื้อ ("ทอง 96.5% หัก 3%") + พิมพ์
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

/** เงินแบบที่จอแสดง ("41535.00" → "41,535.00") — จัดรูปข้อความจาก API ไม่ได้คิดเงิน */
const money = (value: string) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value as unknown as number,
  );

test("ซื้อเข้าด้วยคีย์บอร์ดจนได้ใบรับซื้อ และพิมพ์อัตโนมัติหนึ่งครั้ง", async ({ page, playwright, baseURL }) => {
  // ครบวงจร: sign-in + สร้างลูกค้า + 2 รายการ + เต็มจำนวน + save + poll ใบรับซื้อ + 3 รอบ axe — ช้ากว่า timeout เริ่มต้น 30s บน staging
  test.setTimeout(90_000);
  test.skip(!staff.email || !staff.password, "ตั้ง E2E_EMAIL และ E2E_PASSWORD (บัญชีพนักงาน) ก่อนรัน");
  const origin = baseURL ?? "";

  // ราคาทอง + ราคาเงินต่อกรัมของวันนี้ต้องตั้งแล้ว (ผู้จัดการ · ราคากลาง) — ไม่มีบัญชีผู้จัดการ = ถือว่าตั้งไว้แล้ว
  if (manager.email && manager.password) {
    const managerApi = await playwright.request.newContext({ baseURL: origin });
    await signIn(managerApi, origin, manager);
    const price = await managerApi.put("/api/gold-price/today", {
      headers: { origin },
      data: { bar_sell: "67850", silver_per_g: "45", confirm_typo: true },
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

  // ยอดที่จอต้องแสดง = ที่เซิร์ฟเวอร์คิด (quote ตัวเดียวกับตอนบันทึก) — เทสต์ไม่คิดเงินเอง ราคาของวันบน staging จึงต่างได้
  const metals = (await (await page.request.get("/api/metals")).json()) as { id: string; code: string }[];
  const metalId = (code: string) => metals.find((metal) => metal.code === code)?.id ?? "";
  const quoted = await page.request.post("/api/buy/quote", {
    headers: { origin },
    data: {
      lines: [
        { metal_id: metalId("gold"), weight_g: "10", purity_percent: "96.5", deduct_percent: "3" },
        { metal_id: metalId("silver"), weight_g: "271.56", purity_percent: "92.5", deduct_percent: "0" },
      ],
      payments: [],
    },
  });
  expect(quoted.ok(), "quote the expected lines").toBeTruthy();
  const expected = (await quoted.json()) as { lines: { amount: string }[]; total_amount: string };
  expect(expected.lines, "today's gold and silver prices are set").toHaveLength(2);

  // Siam ID: เลขบัตร Tab ชื่อ … Enter — ช่องเลขบัตรกลืนส่วนที่เหลือ แล้วพาไปช่องค่าบริสุทธิ์ (โลหะเลือกทองไว้แล้ว)
  await page.keyboard.type(nationalId);
  await page.keyboard.press("Tab");
  await page.keyboard.type("นายทดสอบ E2E");
  await page.keyboard.press("Enter");
  const purity = page.getByLabel("ค่าบริสุทธิ์ (%)");
  const deduct = page.getByLabel("หัก %");
  const weight = page.getByLabel("ปริมาณ (กรัม)");
  await expect(purity).toBeFocused();
  // ไม่มีช่องราคาให้พิมพ์แล้ว
  await expect(page.getByLabel("ราคาจริงที่รับซื้อ (บาท)")).toHaveCount(0);

  // ทอง 96.5% หัก 3% 10 ก.: ค่าบริสุทธิ์ Enter → หัก % Enter → ปริมาณ Enter
  await page.keyboard.type("96.5");
  await page.keyboard.press("Enter");
  await expect(deduct).toBeFocused();
  await expect(deduct).toHaveValue("0");
  await deduct.selectOption("3");
  await deduct.focus();
  await page.keyboard.press("Enter");
  await expect(weight).toBeFocused();
  await page.keyboard.type("10");
  await page.keyboard.press("Enter");
  const lines = page.getByRole("table", { name: "รายการสินค้ารับซื้อ" });
  await expect(lines).toContainText("96.5%");
  await expect(lines).toContainText(money(expected.lines[0]?.amount ?? ""));
  // แถวกรอกว่าง หัก % กลับเป็น 0 · โฟกัสกลับช่องค่าบริสุทธิ์
  await expect(purity).toBeFocused();
  await expect(purity).toHaveValue("");
  await expect(deduct).toHaveValue("0");

  // โลหะที่สอง: Shift+Tab กลับไปช่องโลหะ (select) → เลือกเงิน → Enter ไปค่าบริสุทธิ์
  // (ลูกศรบน select ที่ปิดอยู่ทำงานต่างกันตามระบบปฏิบัติการ — เลือกค่าด้วย selectOption แล้วกลับมาใช้คีย์บอร์ดต่อ)
  await page.keyboard.press("Shift+Tab");
  const metal = page.getByLabel("ของเก่าที่รับซื้อ");
  await expect(metal).toBeFocused();
  await metal.selectOption({ label: "เงิน" });
  await metal.focus();
  await page.keyboard.press("Enter");
  await expect(purity).toBeFocused();
  await page.keyboard.type("92.5");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("271.56");
  await page.keyboard.press("Enter");
  await expect(lines).toContainText("เงิน");
  await expect(lines).toContainText(money(expected.lines[1]?.amount ?? ""));
  await expect(lines).toContainText(money(expected.total_amount));

  await page.getByRole("button", { name: "เต็มจำนวน" }).click();
  await expect(page.getByText("ชำระเงินครบถ้วน กรุณากดปุ่มบันทึก")).toBeVisible();
  await expect(page.getByRole("button", { name: /^บันทึก/ })).toBeFocused();
  await expectAccessible(page);

  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/buy\/[0-9a-f-]{36}$/);
  const receipt = page.getByRole("region", { name: "ใบรับซื้อของเก่า/ใบสำคัญจ่าย" });
  await expect(receipt).toContainText("ใบรับซื้อของเก่า/ใบสำคัญจ่าย");
  await expect(receipt).toContainText(/(?:[A-Z]+-)?RC\d{4}-\d{4}/);
  // ชื่อรายการบนใบพิมพ์ค่าบริสุทธิ์และหัก % เหมือน PDF (หัก 0 ไม่พิมพ์)
  await expect(receipt).toContainText("ทอง 96.5% หัก 3%");
  await expect(receipt).toContainText("เงิน 92.5%");
  await expect(receipt).not.toContainText(nationalId);
  await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await expect(page.getByRole("link", { name: "ซื้อเข้าบิลใหม่" })).toBeFocused();
  await expectAccessible(page);
});
