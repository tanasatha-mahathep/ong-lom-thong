import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import i18next, { readStoredLanguage } from "@/i18n";
import { fakeApi, json, renderApp } from "@/test/app";

/** หน้า login ของคนที่ยังไม่ได้เข้าระบบ */
async function renderLogin() {
  fakeApi({ "GET /api/me": () => json({ error: "unauthorized" }, 401) });
  renderApp("/login");
  await screen.findByRole("heading", { level: 1, name: "เข้าสู่ระบบ" });
  return userEvent.setup();
}

describe("หน้า login — ภาษา · ธีม · เวอร์ชัน", () => {
  it("เวอร์ชันของแอปท้ายหน้า (บรรทัดเดียวกับใต้เมนูผู้ใช้)", async () => {
    await renderLogin();
    const version = document.querySelector('[data-slot="app-version"]');
    expect(version).toHaveTextContent(/^v\d+\.\d+\.\d+/);
    expect(version).toHaveClass("text-center", "text-[11px]");
  });

  it("เลือก English → ป้ายของฟอร์มเป็นภาษาอังกฤษ · <html lang=en> · จำไว้ในเครื่อง · กลับเป็นไทยได้", async () => {
    const user = await renderLogin();
    await user.click(screen.getByRole("button", { name: "ภาษา / Language" }));
    expect(await screen.findByRole("menuitemradio", { name: "ไทย" })).toBeChecked();
    await user.click(screen.getByRole("menuitemradio", { name: "English" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("placeholder", "name@example.com");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("ong.lang")).toBe("en");
    expect(readStoredLanguage()).toBe("en");
    expect(document.title).toBe("Sign in · ONG Lom Thong");

    // ป้ายของปุ่มภาษาเป็นสองภาษา — หาเจอแม้อ่านภาษาปัจจุบันไม่ออก
    await user.click(screen.getByRole("button", { name: "Language / ภาษา" }));
    expect(await screen.findByRole("menuitemradio", { name: "English" })).toBeChecked();
    await user.click(screen.getByRole("menuitemradio", { name: "ไทย" }));
    expect(await screen.findByRole("heading", { level: 1, name: "เข้าสู่ระบบ" })).toBeInTheDocument();
    expect(localStorage.getItem("ong.lang")).toBe("th");
  });

  it("ภาษาที่จำไว้ผิดรูป/ไม่มี = ไทย", () => {
    localStorage.setItem("ong.lang", "fr");
    expect(readStoredLanguage()).toBe("th");
    expect(i18next.language).toBe("th");
  });

  it("ธีม: ปุ่ม SunMoon มุมขวาบน · เลือก มืด → html.dark + จำไว้ · ติ๊กที่ตัวเลือกปัจจุบัน", async () => {
    const user = await renderLogin();
    const button = screen.getByRole("button", { name: "ธีม: ตามระบบ" });
    expect(button.querySelector("svg.lucide-sun-moon")).not.toBeNull();
    await user.click(button);
    expect(await screen.findByRole("menuitemradio", { name: "ตามระบบ" })).toBeChecked();
    await user.click(screen.getByRole("menuitemradio", { name: "มืด" }));

    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem("ong.theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "ธีม: มืด" })).toBeInTheDocument();
  });
});
