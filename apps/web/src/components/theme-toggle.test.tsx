import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

function stubSystemDark(dark: boolean) {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media.includes("prefers-color-scheme: dark") ? dark : false,
    media,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

async function chooseTheme(name: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "เปลี่ยนธีม" }));
  await user.click(await screen.findByRole("menuitemradio", { name }));
}

describe("ธีม (สว่าง · มืด · ตามระบบ)", () => {
  it("ค่าเริ่มต้นตามระบบ · เลือกแล้วใส่ .dark ที่ <html> และจำไว้ใน localStorage", async () => {
    stubSystemDark(false);
    fakeApi({ "GET /api/me": () => json(makeMe("staff")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");

    await chooseTheme("มืด");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem("ong.theme")).toBe("dark");

    await chooseTheme("สว่าง");
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
    expect(localStorage.getItem("ong.theme")).toBe("light");
  });

  it("เปิดใหม่ใช้ธีมที่จำไว้ · ตามระบบ = ตามโหมดของเครื่อง", async () => {
    stubSystemDark(true);
    localStorage.setItem("ong.theme", "light");
    fakeApi({ "GET /api/me": () => json(makeMe("staff")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");

    await chooseTheme("ตามระบบ");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem("ong.theme")).toBe("system");
  });

  it("ภาษาไทยเป็นภาษาของหน้า (<html lang>)", () => {
    expect(document.documentElement.lang).toBe("th");
  });
});
