import { type Page, type Route, expect, test } from "@playwright/test";
import { expectAccessible } from "./a11y";

/**
 * จำลอง Siam ID บน Chromium จริง (เทียบเท่า SiamIdTabOrderTest ของ Django · spec §7) — API ปลอมทั้งหมด ไม่ต้องมี DB
 * Siam ID พิมพ์ทีละช่องแล้วกด Tab · ช่องที่ 9 พนักงานกด Ctrl+V วางรูป · บางรุ่นกด Enter ท้ายข้อมูล
 * ข้อมูลสมมติเท่านั้น (เลขบัตร checksum ถูก ชุดเดียวกับเทสต์ของ api)
 */

const NEW_ID = "0b8a3c52-5f7e-4a36-9a51-3f4b7a8c9d10";
const EXISTING_ID = "7d1e9f40-2c3b-4e8a-b6d5-1a2b3c4d5e6f";
/** รูป PNG 1×1 จุด */
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** ป้ายของ 11 ช่องตาม 03-customer-member.md (สำเนาตรงตัว — ไม่ import จากโค้ด) */
const LABELS = [
  "เลขประจำตัวประชาชน",
  "ชื่อ - นามสกุล (ภาษาไทย)",
  "ชื่อ - นามสกุล (ภาษาอังกฤษ)",
  "วันเดือนปีเกิด",
  "ศาสนา",
  "ที่อยู่",
  "วันที่ออกบัตร",
  "วันที่บัตรหมดอายุ",
  "รูปภาพ",
  "เบอร์มือถือ",
  "เบอร์โทรติดต่อที่สะดวก",
];
const KEYS = [
  "national_id",
  "name_th",
  "name_en",
  "birthday_text",
  "religion",
  "address",
  "card_issue_text",
  "card_expire_text",
  "photo",
  "mobile",
  "phone2",
];
/** สิ่งที่ Siam ID พิมพ์ลงช่อง 1–8 */
const CARD = [
  "1103700123458",
  "นายทดสอบ ระบบ",
  "Mr. Test System",
  "1 มกราคม 2530",
  "พุทธ",
  "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
  "01/01/2565",
  "31 ธ.ค. 2600",
];
const PHONES = ["0812345678", "021234567"];

const ME = {
  user: { id: "u-staff", name: "พนักงาน ทดสอบ", email: "staff@example.test" },
  role: "staff",
  branch: { id: "b-00000", code: "00000", name: "สำนักงานใหญ่" },
  branches: [{ id: "b-00000", code: "00000", name: "สำนักงานใหญ่" }],
  can_view_all: false,
};
const GOLD_PRICE = {
  date: "2026-09-29",
  bar_sell: "67850.00",
  bar_buy: "67650.00",
  jewelry_buy: "64268",
  diff: "200.00",
  source: "central",
};
const DETAIL = {
  id: NEW_ID,
  national_id: CARD[0],
  name_th: CARD[1],
  name_en: CARD[2],
  birthday_text: CARD[3],
  religion: CARD[4],
  address: CARD[5],
  card_issue_text: CARD[6],
  card_expire_text: CARD[7],
  card_expire_date: "2057-12-31",
  card_status: "ok",
  mobile: PHONES[0],
  phone2: PHONES[1],
  has_photo: true,
  created_at: "2026-09-29T03:00:00.000Z",
  updated_at: "2026-09-29T03:00:00.000Z",
};

interface SentFile {
  name: string;
  type: string;
  bytes: number[];
}
/** body multipart ที่หน้าเว็บส่งจริง (อ่านใน browser — CDP ไม่ให้ส่วนที่เป็นไฟล์) */
interface Sent {
  method: string;
  url: string;
  entries: [string, string | SentFile][];
}
declare global {
  interface Window {
    __sent: Sent[];
  }
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** API ปลอม — route ที่ลงทะเบียนทีหลังชนะ จึงลง catch-all 404 ก่อน */
async function mockApi(page: Page, { duplicate = false } = {}) {
  const counts = { post: 0, put: 0 };
  await page.route("**/api/**", (route) => json(route, { error: "not found" }, 404));
  await page.route("**/api/me", (route) => json(route, ME));
  await page.route("**/api/gold-price/today", (route) => json(route, GOLD_PRICE));
  await page.route(
    (url) => url.pathname === "/api/customers",
    (route) => {
      if (route.request().method() === "GET") return json(route, { items: [], page: 1, has_more: false });
      counts.post++;
      return duplicate
        ? json(route, { error: "มีลูกค้าเลขบัตรนี้อยู่แล้ว", field: "national_id", existing_id: EXISTING_ID }, 409)
        : json(route, { id: NEW_ID }, 201);
    },
  );
  await page.route(`**/api/customers/${NEW_ID}`, (route) => {
    if (route.request().method() !== "PUT") return json(route, DETAIL);
    counts.put++;
    // PUT ตอบเลขบัตรแบบมาสก์ — หน้าเว็บต้อง GET ใหม่เอง
    return json(route, { ...DETAIL, national_id: "1 XXXX XXXXX 45 8" });
  });
  await page.route(`**/api/customers/${NEW_ID}/photo`, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(PNG_B64, "base64") }),
  );
  await page.addInitScript(() => {
    const send = window.fetch.bind(window);
    window.__sent = [];
    window.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method !== "GET" && request.headers.get("content-type")?.startsWith("multipart/form-data")) {
        const entries: Sent["entries"] = [];
        for (const [key, value] of await request.clone().formData()) {
          entries.push(
            typeof value === "string"
              ? [key, value]
              : [key, { name: value.name, type: value.type, bytes: [...new Uint8Array(await value.arrayBuffer())] }],
          );
        }
        window.__sent.push({ method: request.method, url: request.url, entries });
      }
      return send(request);
    };
  });
  return counts;
}

/** สิ่งที่ Chrome ทำเมื่อกด Ctrl+V ขณะคลิปบอร์ดมีรูป (bitmap → ไฟล์ image/png) */
async function pastePng(page: Page) {
  await page.evaluate((b64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "image.png", { type: "image/png" }));
    const paste = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(paste);
  }, PNG_B64);
}

const slot = (page: Page, n: number) =>
  n === 9 ? page.getByTestId("photo-zone") : page.getByLabel(LABELS[n - 1] ?? "", { exact: true });

/** Siam ID พิมพ์ช่อง 1–8 คั่นด้วย Tab — ตรวจว่าโฟกัสไปช่องถัดไปถูกทุกครั้ง แล้วกด Enter ท้าย (บางรุ่น) */
async function siamIdTypes(page: Page) {
  for (const [i, value] of CARD.entries()) {
    await expect(slot(page, i + 1)).toBeFocused();
    await page.keyboard.type(value);
    if (i === CARD.length - 1) await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
  }
  await expect(slot(page, 9)).toBeFocused();
}

const pngBytes = [...Buffer.from(PNG_B64, "base64")];

test("เพิ่มลูกค้าด้วย Siam ID: 8 ช่อง + Tab → Ctrl+V รูป → เบอร์ → Enter ไม่บันทึก → Ctrl+Enter ส่งครั้งเดียวตามลำดับ", async ({
  page,
}) => {
  const counts = await mockApi(page);
  await page.goto("/customers/new");
  await expectAccessible(page);

  await siamIdTypes(page);
  await pastePng(page);
  await expect(page.getByRole("img", { name: "รูปใหม่ที่วางไว้" })).toBeVisible();
  await expect(page.getByText("บัตรใช้ได้ถึง 31 ธันวาคม 2600")).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(slot(page, 10)).toBeFocused();
  await page.keyboard.type(PHONES[0] ?? "");
  await page.keyboard.press("Tab");
  await expect(slot(page, 11)).toBeFocused();
  await page.keyboard.type(PHONES[1] ?? "");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "เพิ่มข้อมูล" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expectAccessible(page);
  // ยืนยันว่า Enter ทั้งหมดไม่ได้ส่งฟอร์ม (คำขอจะออกภายในไม่กี่มิลลิวินาทีถ้าส่ง)
  await page.waitForTimeout(300);
  expect(counts.post).toBe(0);
  await expect(page).toHaveURL(/\/customers\/new$/);

  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(new RegExp(`/customers/${NEW_ID}\\?saved=created`));
  expect(counts.post).toBe(1);

  const sent = await page.evaluate(() => window.__sent);
  expect(sent).toHaveLength(1);
  const entries = sent[0]?.entries ?? [];
  expect(entries.map(([key]) => key)).toEqual(KEYS);
  expect(Object.fromEntries(entries.filter(([key]) => key !== "photo"))).toEqual(
    Object.fromEntries([...CARD, ...PHONES].map((value, i) => [KEYS.filter((k) => k !== "photo")[i], value])),
  );
  expect(entries[8]?.[1]).toEqual({ name: "image.png", type: "image/png", bytes: pngBytes });

  await expect(page.getByText("เพิ่มข้อมูลลูกค้าเรียบร้อย")).toBeVisible();
  await expect(page.getByText("1 1037 00123 45 8")).toBeVisible();
  await expect(page.getByRole("img", { name: "รูปลูกค้า" })).toBeVisible();
  await expectAccessible(page);
});

test("เลขบัตรซ้ำ (409) → แจ้งใต้ช่องที่ 1 พร้อมลิงก์ลูกค้าเดิมที่ไม่แทรกลำดับ Tab", async ({ page }) => {
  await mockApi(page, { duplicate: true });
  await page.goto("/customers/new");
  await expect(slot(page, 1)).toBeFocused();
  await page.keyboard.type(CARD[0] ?? "");
  await page.keyboard.press("Tab");
  await page.keyboard.type(CARD[1] ?? "");
  await page.keyboard.press("Control+Enter");

  await expect(page.getByText("มีลูกค้าเลขบัตรนี้อยู่แล้ว")).toBeVisible();
  await expect(slot(page, 1)).toBeFocused();
  const links = page.getByRole("link", { name: "เปิดข้อมูลลูกค้าเดิม" });
  await expect(links.first()).toHaveAttribute("href", `/customers/${EXISTING_ID}`);
  await expect(links.first()).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("Tab");
  await expect(slot(page, 2)).toBeFocused();
  await expectAccessible(page);
});

test("แก้ไข: อ่านบัตรใหม่ล้างช่อง 1–8 → Siam ID + รูป → PUT ครบตามลำดับ · แก้ครั้งถัดไปไม่มีรูปใหม่ = ไม่ส่ง photo", async ({
  page,
}) => {
  const counts = await mockApi(page);
  await page.goto(`/customers/${NEW_ID}?mode=edit`);
  await expect(slot(page, 1)).toHaveValue(CARD[0] ?? "");
  await expect(slot(page, 1)).not.toBeFocused();

  await page.getByRole("button", { name: /อ่านบัตรใหม่/ }).click();
  for (let n = 1; n <= 8; n++) await expect(slot(page, n)).toHaveValue("");
  await siamIdTypes(page);
  await pastePng(page);
  await expect(page.getByRole("img", { name: "รูปใหม่ที่วางไว้" })).toBeVisible();
  await page.keyboard.press("Control+Enter");

  await expect(page.getByText("บันทึกการแก้ไขเรียบร้อย")).toBeVisible();
  expect(counts.put).toBe(1);
  // หน้าดูแสดงเลขบัตรเต็มจาก GET ใหม่ ไม่ใช่เลขมาสก์ที่ PUT ตอบ
  await expect(page.getByText("1 1037 00123 45 8")).toBeVisible();

  await page.getByRole("button", { name: "แก้ไข", exact: true }).click();
  await expect(page.getByRole("form", { name: "แก้ไขข้อมูลลูกค้า" })).toBeVisible();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("บันทึกการแก้ไขเรียบร้อย")).toBeVisible();

  const sent = await page.evaluate(() => window.__sent);
  expect(sent.map((s) => s.method)).toEqual(["PUT", "PUT"]);
  expect(sent[0]?.entries.map(([key]) => key)).toEqual(KEYS);
  expect(sent[0]?.entries[8]?.[1]).toEqual({ name: "image.png", type: "image/png", bytes: pngBytes });
  expect(sent[1]?.entries.map(([key]) => key)).toEqual(KEYS.filter((key) => key !== "photo"));
});
