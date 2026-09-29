import { screen, within } from "@testing-library/react";
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
  });
  renderApp(path);
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
