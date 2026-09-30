import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y";

// หน้าค้นหา Ctrl/⌘+K กับ API จริง: ค้นลูกค้า (ทั้งร้าน) และบิล (เฉพาะสาขาปัจจุบัน) แล้ว Enter เปิด
// ข้อมูลที่สร้างเป็นลูกค้าสมมติ (เลขบัตร checksum ถูก ชื่อมี "ทดสอบ") — ใช้ได้ทั้งเครื่อง local และ staging UAT
// WEB_PORT=… E2E_EMAIL=… E2E_PASSWORD=… [E2E_MANAGER_EMAIL=… E2E_MANAGER_PASSWORD=…] pnpm --filter @ong/web e2e command-search
const staff = { email: process.env.E2E_EMAIL ?? "", password: process.env.E2E_PASSWORD ?? "" };
const manager = { email: process.env.E2E_MANAGER_EMAIL ?? "", password: process.env.E2E_MANAGER_PASSWORD ?? "" };

interface Me {
  branch: { id: string; code: string } | null;
  branches: { id: string; code: string }[];
}

/** เลขบัตรสมมติ 13 หลักที่หลักตรวจสอบถูก (mod 11) — ขึ้นต้น 9 ไม่ชนเลขจริง · สุ่ม (รันขนานในมิลลิวินาทีเดียวกันไม่ชนกัน) */
function makeFakeNationalId(): string {
  const body = `9${Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join("")}`;
  const sum = [...body].reduce((s, d, i) => s + Number(d) * (13 - i), 0);
  return `${body}${(11 - (sum % 11)) % 10}`;
}

/**
 * client สมมติคนละที่อยู่ต่อการ login (198.18.0.0/15 · RFC 2544 ไม่มีใครใช้จริง) — login จำกัดต่อ IP ที่อ่านจาก X-Real-IP
 * เท่านั้น (apps/api/src/auth.ts) รันซ้ำหลายรอบในนาทีเดียวจึงไม่ติด 429 · staging: edge ของ Railway เขียนทับค่านี้เสมอ
 */
const clientAddress = () =>
  `198.${18 + Math.floor(Math.random() * 2)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;

async function signIn(request: APIRequestContext, origin: string, who: { email: string; password: string }) {
  const res = await request.post("/api/auth/sign-in/email", {
    headers: { origin, "x-real-ip": clientAddress() },
    data: who,
  });
  expect(res.ok(), `login ${who.email}: HTTP ${res.status()}`).toBeTruthy();
}

async function setGoldPrice(request: APIRequestContext, origin: string) {
  const res = await request.put("/api/gold-price/today", {
    headers: { origin },
    data: { bar_sell: "67850", confirm_typo: true },
  });
  expect(res.ok(), `set today's gold price: HTTP ${res.status()}`).toBeTruthy();
}

interface SavedBill {
  id: string;
  doc_no: string;
}

/** บิลเงินสดหนึ่งรายการ (ทอง 5.86 g = 20,030 บาท ที่ราคา 67,850) ในสาขาปัจจุบันของ session */
function saveBill(request: APIRequestContext, origin: string, customerId: string, metalId: string, key: string) {
  return request.post("/api/buy", {
    headers: { origin },
    data: {
      customer_id: customerId,
      lines: [{ metal_id: metalId, weight_g: "5.86", amount: "20030" }],
      payments: [{ method: "cash", amount: "20030" }],
      full_tax: false,
      idempotency_key: key,
    },
  });
}

async function goldMetalId(request: APIRequestContext): Promise<string> {
  const metals = (await (await request.get("/api/metals")).json()) as { id: string; code: string }[];
  const gold = metals.find((metal) => metal.code === "gold");
  expect(gold, "gold metal").toBeTruthy();
  return gold?.id ?? "";
}

/** ผลที่รอ API (ค้น · เปิดหน้า) — เผื่อ staging และเครื่องที่รันหลายชุดพร้อมกัน (การสร้างบิลเรียก Gotenberg หนัก) */
const API = { timeout: 15_000 };

/** หน้าค้นหาเป็น modal — axe ตรวจเฉพาะชั้นนี้ (ดู a11y.ts) */
const PALETTE = '[role="dialog"][data-slot="dialog-content"]';

const searchBox = (page: Page) => page.getByRole("dialog", { name: "ค้นหา" }).getByRole("combobox", { name: "คำค้น" });

// ธีมเริ่มต้น "ตามระบบ" — จำลองเครื่องโหมดสว่าง/มืด แล้วตรวจ axe ทั้งสองธีม
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`ธีม ${colorScheme}`, () => {
    test.use({ colorScheme });

    test("Ctrl+K ค้นลูกค้าทั้งร้านและบิลเฉพาะสาขาปัจจุบัน → Enter เปิด (ผ่าน axe ตอนเปิดหน้าค้นหา)", async ({
      page,
      playwright,
      baseURL,
    }) => {
      // สร้างลูกค้า + บิล 1–2 ใบ + หลายรอบ axe — ช้ากว่า timeout เริ่มต้น 30s บน staging
      test.setTimeout(90_000);
      test.skip(!staff.email || !staff.password, "ตั้ง E2E_EMAIL และ E2E_PASSWORD (บัญชีพนักงาน) ก่อนรัน");
      const origin = baseURL ?? "";
      // ตัวอักษรล้วน — คำค้นที่มีตัวเลข ≥ 2 ตัว API จับคู่กับเลขบัตร/เบอร์ของลูกค้าคนอื่นด้วย
      const suffix = Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
      const nationalId = makeFakeNationalId();
      const name = `นายทดสอบ ค้นหา ${suffix}`;

      await signIn(page.request, origin, staff);
      const created = await page.request.post("/api/customers", {
        headers: { origin },
        multipart: { national_id: nationalId, name_th: name, card_expire_text: "31/12/2575" },
      });
      expect(created.status(), "create a fake customer").toBe(201);
      const { id: customerId } = (await created.json()) as { id: string };
      const me = (await (await page.request.get("/api/me")).json()) as Me;
      const staffBranch = me.branch?.id ?? "";
      expect(staffBranch, "staff account needs a current branch").not.toBe("");

      const gold = await goldMetalId(page.request);
      // บิลของสาขาอื่น (ผู้จัดการที่มีสิทธิ์สองสาขา) — ต้องไม่โผล่ในหน้าค้นหาของพนักงาน
      // ไม่มีบัญชีผู้จัดการ / ผู้จัดการมีสาขาเดียว / สาขานั้นยังเปิดบิลไม่ได้ (ยังไม่ตั้งรหัสสาขาสรรพากร) = ข้ามส่วนนี้
      let otherBranchBill: SavedBill | null = null;
      if (manager.email && manager.password) {
        const managerApi = await playwright.request.newContext({ baseURL: origin });
        await signIn(managerApi, origin, manager);
        await setGoldPrice(managerApi, origin);
        const managerMe = (await (await managerApi.get("/api/me")).json()) as Me;
        const other = managerMe.branches.find((branch) => branch.id !== staffBranch);
        if (other) {
          const switched = await managerApi.post("/api/me/branch", {
            headers: { origin },
            data: { branch_id: other.id },
          });
          expect(switched.ok(), "manager switches to the other branch").toBeTruthy();
          await setGoldPrice(managerApi, origin);
          const res = await saveBill(managerApi, origin, customerId, gold, `e2e-search-other-${suffix}-${Date.now()}`);
          if (res.status() === 201) otherBranchBill = (await res.json()) as SavedBill;
          else
            test
              .info()
              .annotations.push({ type: "skipped part", description: `other-branch bill: ${await res.text()}` });
        }
        await managerApi.dispose();
      }
      const saved = await saveBill(page.request, origin, customerId, gold, `e2e-search-${suffix}-${Date.now()}`);
      expect(saved.status(), `save a bill: ${await saved.text()}`).toBe(201);
      const bill = (await saved.json()) as SavedBill;

      const billSearches: URL[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname === "/api/buy" && url.searchParams.has("q")) billSearches.push(url);
      });

      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: "หน้าแรก" })).toBeVisible();
      await expect(page.getByRole("button", { name: "ค้นหา…" })).toHaveAttribute(
        "aria-keyshortcuts",
        "Control+K Meta+K",
      );

      // ตำแหน่งปุ่ม K (แป้นไทยก็ได้) — เปิดหน้าค้นหา โฟกัสช่องค้น
      await page.keyboard.press("Control+KeyK");
      await expect(searchBox(page)).toBeFocused();
      const dialog = page.getByRole("dialog", { name: "ค้นหา" });
      await expect(dialog.getByRole("group", { name: "ทางลัด" })).toBeVisible();
      await expectAccessible(page, { include: PALETTE });

      // ลูกค้า: ชื่อ + เลขบัตรมาสก์ · บิลของลูกค้าคนนี้เฉพาะสาขาปัจจุบัน
      await page.keyboard.type(suffix);
      // แถวบิลมีชื่อลูกค้าด้วย — ระบุแถวด้วย value ของ cmdk (customer:<id> · bill:<id>)
      const customerOption = dialog.locator(`[data-value="customer:${customerId}"]`);
      await expect(customerOption).toBeVisible(API);
      await expect(customerOption).toHaveAccessibleName(new RegExp(`^${name} 9 XXXX`));
      await expect(customerOption).not.toContainText(nationalId);
      await expect(dialog.locator(`[data-value="bill:${bill.id}"]`)).toBeVisible(API);
      if (otherBranchBill) await expect(dialog.locator(`[data-value="bill:${otherBranchBill.id}"]`)).toHaveCount(0);
      expect(billSearches.length).toBeGreaterThan(0);
      for (const url of billSearches) expect(url.searchParams.get("branch_id")).toBe(staffBranch);
      await expect(dialog.getByRole("status")).toContainText("พบลูกค้า 1 รายการ", API);
      await expectAccessible(page, { include: PALETTE });

      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/customers/${customerId}$`), API);
      await expect(page.getByRole("dialog", { name: "ค้นหา" })).toHaveCount(0);

      // บิล: ค้นด้วยเลขที่บิล → ลูกศรไม่ต้องกด (แถวแรกคือบิล) → Enter เปิดหน้าบิล
      await page.keyboard.press("Control+KeyK");
      await expect(searchBox(page)).toBeFocused();
      await page.keyboard.type(bill.doc_no);
      const billOption = dialog.locator(`[data-value="bill:${bill.id}"]`);
      await expect(billOption).toHaveAttribute("aria-selected", "true", API);
      await expect(billOption).toContainText("20,030.00 บาท");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`/buy/${bill.id}$`), API);

      // เลขบัตรเต็มค้นได้ แต่ไม่มีลิงก์ "ดูทั้งหมด" ที่พาเลขบัตรไปอยู่ใน URL
      await page.keyboard.press("Control+KeyK");
      await expect(searchBox(page)).toBeFocused();
      await page.keyboard.type(nationalId);
      await expect(dialog.locator(`[data-value="customer:${customerId}"]`)).toBeVisible(API);
      await expect(dialog.getByRole("option", { name: /ดูทั้งหมด/ })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "ค้นหา" })).toHaveCount(0);
      expect(page.url()).not.toMatch(/\d{12}/);
    });
  });
}
