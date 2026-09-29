import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

describe("guard ของหน้าในแอป", () => {
  it("ยังไม่ login → ไปหน้า login พร้อมจำหน้าที่ขอไว้", async () => {
    fakeApi({ "GET /api/me": () => json({ error: "unauthorized" }, 401) });
    const router = renderApp("/bills");

    expect(await screen.findByRole("heading", { level: 1, name: "เข้าสู่ระบบ" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
    expect(router.state.location.search).toEqual({ redirect: "/bills" });
  });

  it("session หมดอายุระหว่างใช้งาน (401 จาก query ใดก็ได้) → กลับหน้า login", async () => {
    let meCalls = 0;
    fakeApi({
      // ครั้งแรกยังใช้ได้ หลังจากนั้น session หมดอายุ
      "GET /api/me": () => (meCalls++ === 0 ? json(makeMe("staff")) : json({ error: "unauthorized" }, 401)),
      "GET /api/customers": () => json({ error: "unauthorized" }, 401),
    });
    const router = renderApp("/customers");

    expect(await screen.findByRole("heading", { level: 1, name: "เข้าสู่ระบบ" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ redirect: "/customers" });
  });
});

describe("ชื่อหน้าจาก staticData", () => {
  it("หัวหน้า · breadcrumb · document.title ใช้ชื่อไทยของ route", async () => {
    fakeApi({ "GET /api/me": () => json(makeMe("staff")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
    renderApp("/customers/new");

    expect(await screen.findByRole("heading", { level: 1, name: "เพิ่มลูกค้า" })).toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", { name: "ตำแหน่งของหน้า" });
    expect(within(breadcrumb).getByRole("link", { name: "ลูกค้า" })).toHaveAttribute("href", "/customers");
    expect(within(breadcrumb).getByText("เพิ่มลูกค้า")).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(document.title).toBe("เพิ่มลูกค้า · โอเอ็นจี หลอมทอง"));
  });

  it.each([
    ["ยังไม่ login", "/no-such-page", false],
    ["login แล้ว", "/no-such-page", true],
    ["login แล้ว · ใต้ route ที่มีจริง", "/customers/abc/def", true],
  ])("URL ที่ไม่มีหน้า (%s: %s) → 404 ภาษาไทย มี main และ h1 เดียว", async (_, path, signedIn) => {
    fakeApi({
      "GET /api/me": () => (signedIn ? json(makeMe("staff")) : json({ error: "unauthorized" }, 401)),
      "GET /api/gold-price/today": () => json(GOLD_PRICE),
    });
    renderApp(path);

    expect(await screen.findByRole("heading", { level: 1, name: "ไม่พบหน้านี้" })).toBeInTheDocument();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "กลับหน้าแรก" })).toHaveAttribute("href", "/");
  });
});
