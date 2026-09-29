import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BILL, VOID_BILL, buyList } from "@/features/bills/test-data";
import { BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { METALS } from "@/test/buy-api";

/**
 * jsdom ไม่คำนวณ layout จึงวัดความกว้างจริงไม่ได้ — ตรวจ "สัญญา" ของ class ที่ทำให้หน้าไม่ล้นแนวนอน:
 * (1) SidebarInset (flex item ในแถวเดียวกับ sidebar) ต้อง `min-w-0` ไม่งั้นตารางกว้างดันทั้งหน้ากว้างกว่าจอ
 * (2) ทุก `display:grid` ระหว่าง <main> กับตารางต้องมี `grid-cols-*` (แทน track `auto` ที่ขยายตาม min-content ของตาราง)
 * (3) ตารางอยู่ในกล่อง `overflow-x-auto` ของตัวเอง — ล้นแล้วเลื่อนในกล่อง ไม่ใช่ทั้งหน้า
 * วัดจริงที่ 1366 · 1024 · 768 · 390 ด้วย Playwright (make e2e) — ดู PR
 */
const money = { count: "1", total_weight: "1.000", total_amount: "1.00" };
const metal = { metal_code: "gold", name_th: "ทองคำ", grams: "1.000", amount: "1.00" };
const PURCHASE = {
  date_from: "2026-09-01",
  date_to: "2026-09-29",
  metal: null,
  rows: [
    {
      no: 1,
      id: "r-1",
      date: "2026-09-02",
      time: "10:15",
      doc_no: "RC6909-0001",
      branch: BRANCH_HQ,
      customer: { id: "c-1", name_th: "สมชาย ทดสอบ", national_id_masked: "1 XXXX XXXXX 12 3" },
      metals: [metal],
      total_weight: "1.000",
      total_amount: "1.00",
      created_by: { id: "u-1", name: "พนักงาน ทดสอบ" },
    },
  ],
  by_branch: [{ branch: BRANCH_HQ, ...money, by_metal: [metal] }],
  total: { ...money, by_metal: [metal] },
};
const STOCK = {
  as_of: "2026-09-29",
  by_branch: [{ branch: BRANCH_HQ, by_metal: [{ metal_code: "gold", name_th: "ทองคำ", grams: "1.000" }] }],
  total: { by_metal: [{ metal_code: "gold", name_th: "ทองคำ", grams: "1.000" }] },
};

function assertNoPageLevelOverflowContract() {
  const main = document.getElementById("main");
  if (!main) throw new Error("ไม่พบ <main>");
  expect(main.closest("[data-slot=sidebar-inset]")).toHaveClass("min-w-0");
  expect(main).toHaveClass("min-w-0");

  const tables = main.querySelectorAll("table");
  expect(tables.length).toBeGreaterThan(0);
  for (const table of tables) {
    expect(table.closest("[data-slot=table-container]")).toHaveClass("overflow-x-auto");
    for (let el = table.parentElement; el && el !== main; el = el.parentElement) {
      const classes = [...el.classList];
      if (classes.includes("grid")) expect(classes.some((c) => c.startsWith("grid-cols-"))).toBe(true);
    }
  }
}

function open(path: string) {
  fakeApi({
    "GET /api/me": () => json(makeMe("manager", [BRANCH_HQ])),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "GET /api/metals": () => json(METALS),
    "GET /api/buy": () => buyList([BILL, VOID_BILL]),
    "GET /api/reports/purchase": () => json(PURCHASE),
    "GET /api/reports/stock": () => json(STOCK),
  });
  renderApp(path);
}

describe("หน้ารายการไม่ล้นแนวนอนระดับหน้า", () => {
  it("/bills", async () => {
    open("/bills");
    await screen.findByRole("link", { name: BILL.doc_no }, { timeout: 10_000 });
    assertNoPageLevelOverflowContract();
  });

  it("/reports/purchase", async () => {
    open("/reports/purchase");
    await screen.findByRole("link", { name: "RC6909-0001" }, { timeout: 10_000 });
    assertNoPageLevelOverflowContract();
  });

  it("/reports/stock", async () => {
    open("/reports/stock");
    await screen.findByRole("table", { name: /สต็อกคงเหลือ/ }, { timeout: 10_000 });
    assertNoPageLevelOverflowContract();
  });
});
