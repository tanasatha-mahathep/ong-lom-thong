import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/queries";
import { BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

// 01:30 น. วันที่ 28 เวลาไทย แต่ยังเป็นวันที่ 27 ใน UTC — "วันนี้" ของร้านต้องเป็นวันตามเวลาไทย
const NOW = new Date("2026-09-27T18:30:00Z");
const TODAY_BUYS = `/api/buy?date_from=2026-09-28&date_to=2026-09-28&branch_id=${BRANCH_HQ.id}`;
const buyList = (totals: { count: string; total_weight: string; total_amount: string }) =>
  json({ items: [], page: 1, has_more: false, totals });
const NO_PRICE = () => json({ error: "ยังไม่ได้ตั้งราคาทองของวันนี้", date: "2026-09-28" }, 404);

afterEach(() => {
  vi.useRealTimers();
});

function openHome(role: Role, routes: Parameters<typeof fakeApi>[0] = {}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const api = fakeApi({
    "GET /api/me": () => json(makeMe(role)),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    [`GET ${TODAY_BUYS}`]: () => buyList({ count: "0", total_weight: "0.000", total_amount: "0.00" }),
    ...routes,
  });
  renderApp("/");
  return api;
}

describe("หน้าแรก — กระดานราคาวันนี้", () => {
  it("ราคาทองแท่งแสดงเป็นบาทเต็มแบบกระดานของระบบเดิม", async () => {
    openHome("staff");
    const board = await screen.findByRole("region", { name: "ราคาทองวันนี้" });

    expect(await within(board).findByText("67,850")).toBeInTheDocument();
    expect(within(board).getByText("67,650")).toBeInTheDocument();
    expect(within(board).getByText("64,268")).toBeInTheDocument();
    expect(within(board).getByText("ราคากลาง")).toBeInTheDocument();
  });

  it("ตัวเลขมาจากข้อความของ API ตรงทุกหลัก — ไม่ผ่าน float", async () => {
    // Number("12345678901234567") = 12345678901234568 — ถ้าแปลงเป็น number หลักท้ายจะเพี้ยน
    openHome("staff", {
      "GET /api/gold-price/today": () =>
        json({
          ...GOLD_PRICE,
          bar_sell: "12345678901234567.00",
          bar_buy: "12345678901234367.50",
          jewelry_buy: "11728395056172649",
        }),
    });
    const board = await screen.findByRole("region", { name: "ราคาทองวันนี้" });

    expect(await within(board).findByText("12,345,678,901,234,567")).toBeInTheDocument();
    // มีสตางค์ → แสดงครบ ไม่ปัดทิ้ง
    expect(within(board).getByText("12,345,678,901,234,367.50")).toBeInTheDocument();
    expect(within(board).getByText("11,728,395,056,172,649")).toBeInTheDocument();
  });

  it.each<Role>(["manager", "admin"])("ยังไม่ตั้งราคา → %s ได้ลิงก์ไปหน้าตั้งราคา", async (role) => {
    openHome(role, { "GET /api/gold-price/today": NO_PRICE });
    const board = await screen.findByRole("region", { name: "ราคาทองวันนี้" });

    const alert = await within(board).findByRole("alert");
    expect(alert).toHaveTextContent("ยังไม่ได้ตั้งราคาทองวันนี้");
    expect(within(alert).getByRole("link", { name: "ตั้งราคาทองวันนี้" })).toHaveAttribute(
      "href",
      "/settings/gold-price",
    );
  });

  it.each<Role>(["staff", "accounting"])("ยังไม่ตั้งราคา → %s ได้คำแนะนำให้แจ้งผู้จัดการ", async (role) => {
    openHome(role, { "GET /api/gold-price/today": NO_PRICE });
    const board = await screen.findByRole("region", { name: "ราคาทองวันนี้" });

    const alert = await within(board).findByRole("alert");
    expect(alert).toHaveTextContent("ยังไม่ได้ตั้งราคาทองวันนี้");
    expect(alert).toHaveTextContent("แจ้งผู้จัดการให้ตั้งราคาทองก่อน จึงจะเปิดบิลได้");
    expect(within(alert).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("หน้าแรก — ปุ่มใหญ่", () => {
  it.each<Role>(["staff", "manager", "admin"])("%s มีปุ่มซื้อเข้าและลูกค้าใหม่", async (role) => {
    openHome(role);
    const actions = await screen.findByRole("region", { name: "ทางลัด" });

    expect(within(actions).getByRole("link", { name: "ซื้อเข้า" })).toHaveAttribute("href", "/buy");
    expect(within(actions).getByRole("link", { name: "ลูกค้าใหม่" })).toHaveAttribute("href", "/customers/new");
  });

  it("ฝ่ายบัญชีเปิดบิลไม่ได้ — ไม่มีปุ่มซื้อเข้า", async () => {
    openHome("accounting");
    const actions = await screen.findByRole("region", { name: "ทางลัด" });

    expect(within(actions).queryByRole("link", { name: "ซื้อเข้า" })).not.toBeInTheDocument();
    expect(within(actions).getByRole("link", { name: "ลูกค้าใหม่" })).toBeInTheDocument();
  });
});

describe("หน้าแรก — ยอดซื้อวันนี้", () => {
  it("ถามยอดของวันตามเวลาไทยในสาขาปัจจุบัน แล้วแสดง totals ของเซิร์ฟเวอร์ตรงทุกหลัก", async () => {
    const api = openHome("staff", {
      [`GET ${TODAY_BUYS}`]: () =>
        buyList({ count: "1234", total_weight: "12345678901234.567", total_amount: "99999999999999.99" }),
    });
    const card = await screen.findByRole("region", { name: "ยอดซื้อวันนี้" });

    expect(await within(card).findByText("99,999,999,999,999.99")).toBeInTheDocument();
    expect(within(card).getByText("12,345,678,901,234.567")).toBeInTheDocument();
    expect(within(card).getByText("1,234")).toBeInTheDocument();
    expect(api.callsTo("GET", TODAY_BUYS)).toHaveLength(1);
  });

  it("ยังไม่ได้เลือกสาขา → ไม่ถามยอด (fail-closed) และบอกให้เลือกสาขา", async () => {
    const api = openHome("staff", { "GET /api/me": () => json(makeMe("staff", [])) });
    const card = await screen.findByRole("region", { name: "ยอดซื้อวันนี้" });

    expect(within(card).getByText("เลือกสาขาจากเมนูผู้ใช้ก่อน จึงจะเห็นยอดของสาขา")).toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.startsWith("/api/buy"))).toEqual([]);
  });
});
