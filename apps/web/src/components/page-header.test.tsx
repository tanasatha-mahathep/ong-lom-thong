import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { makeBill } from "@/test/bill-fixture";
import { METALS } from "@/test/buy-api";
import { CUSTOMER_DETAIL, CUSTOMER_ID } from "@/test/customers";

const BILL = makeBill();

function setup(path: string) {
  fakeApi({
    "GET /api/me": () => json(makeMe("admin")),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "GET /api/metals": () => json(METALS),
    [`GET /api/buy/${BILL.id}`]: () => json(BILL),
    [`GET /api/customers/${CUSTOMER_ID}`]: () => json(CUSTOMER_DETAIL),
    "GET /api/customers": () => json({ items: [], page: 1, has_more: false }),
  });
  return renderApp(path);
}

/** แถบหัวเรื่องของหน้า = h1 เดียว + เส้นคั่นใต้แถบ */
async function pageHeader() {
  const heading = await screen.findByRole("heading", { level: 1 }, { timeout: 10_000 });
  const bar = heading.closest<HTMLElement>('[data-slot="page-header"]');
  expect(bar).not.toBeNull();
  expect(bar).toHaveClass("border-b");
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  return { heading, bar: bar as HTMLElement };
}

describe("แถบหัวเรื่องของทุกหน้า (PageHeader)", () => {
  it.each([
    ["/", "หน้าแรก"],
    ["/buy", "ซื้อเข้า"],
    [`/buy/${BILL.id}`, "ดูบิล"],
    ["/bills", "ค้นบิล"],
    ["/customers", "ลูกค้า"],
    ["/customers/new", "เพิ่มลูกค้า"],
    [`/customers/${CUSTOMER_ID}`, "ข้อมูลลูกค้า"],
    ["/reports/purchase", "รายงานยอดซื้อ"],
    ["/reports/stock", "สต็อกคงเหลือ"],
    ["/reports/export", "ส่งบัญชีรายเดือน"],
    ["/settings/branches", "จัดการสาขา"],
    ["/settings/gold-price", "ตั้งราคาทองวันนี้"],
    ["/settings/users", "จัดการผู้ใช้"],
  ])("%s → h1 เดียว '%s' ในแถบที่มีเส้นใต้", async (path, title) => {
    setup(path);
    const { heading } = await pageHeader();
    expect(heading).toHaveTextContent(title);
  });

  it("ปุ่มหลักของหน้าอยู่ขวาในแถบเดียวกับชื่อ (เช่น + เพิ่มลูกค้า)", async () => {
    setup("/customers");
    const { bar } = await pageHeader();
    const add = within(bar).getByRole("link", { name: "เพิ่มลูกค้า" });
    expect(add).toHaveAttribute("href", "/customers/new");
    // ชื่อซ้าย ปุ่มขวา · จอแคบขึ้นบรรทัดใหม่ได้ (ไม่ล้นแนวนอน)
    expect(bar).toHaveClass("flex", "flex-wrap", "justify-between");
    expect(bar.lastElementChild).toContainElement(add);
  });
});

describe("ปุ่มย้อนกลับ [←] หน้าชื่อหน้าเอกสาร", () => {
  const backLink = (bar: HTMLElement) => bar.querySelector<HTMLAnchorElement>('[data-slot="page-back"]');

  it.each([
    [`/customers/${CUSTOMER_ID}`, "กลับไปรายการลูกค้า", "/customers"],
    ["/customers/new", "กลับไปรายการลูกค้า", "/customers"],
    [`/buy/${BILL.id}`, "กลับไปค้นบิล", "/bills"],
  ])("%s → ปุ่มไอคอน '%s' ไป %s ก่อนชื่อหน้า", async (path, label, href) => {
    setup(path);
    const { bar, heading } = await pageHeader();
    const back = within(bar).getByRole("link", { name: label });
    expect(back).toBe(backLink(bar));
    expect(back).toHaveAttribute("href", href);
    expect(back.querySelector("svg.lucide-arrow-left")).not.toBeNull();
    // อยู่ก่อนชื่อหน้า (ซ้ายของ h1) และเป็นปุ่มเดียวที่พากลับ — ปุ่มข้อความ "กลับไป…" เดิมถูกเอาออก
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("link", { name: label })).toHaveLength(1);
  });

  it.each(["/", "/buy", "/bills", "/customers", "/reports/purchase", "/settings/users"])(
    "%s (หน้าบนสุดของเมนู) → ไม่มีปุ่มย้อนกลับ",
    async (path) => {
      setup(path);
      const { bar } = await pageHeader();
      expect(backLink(bar)).toBeNull();
    },
  );

  it("กลับไปรายการพร้อมตัวกรองที่ใช้ล่าสุด", async () => {
    const router = setup("/customers?q=somchai");
    await pageHeader();
    await router.navigate({ to: "/customers/$id", params: { id: CUSTOMER_ID } });
    await screen.findByRole("heading", { level: 1, name: "ข้อมูลลูกค้า" });
    const { bar } = await pageHeader();
    await waitFor(() => expect(backLink(bar)?.getAttribute("href")).toBe("/customers?q=somchai"));
  });
});
