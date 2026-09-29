import { screen, waitFor, within } from "@testing-library/react";
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

function setup() {
  fakeApi({ "GET /api/me": () => json(makeMe("staff")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
  renderApp("/");
}

/** เมนูผู้ใช้ → ธีม (เมนูย่อย) → เลือก — ด้วยคีย์บอร์ดล้วน */
async function chooseTheme(name: string) {
  const user = userEvent.setup();
  (await screen.findByRole("button", { name: /ทดสอบ staff/ })).focus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "ธีม" })).toHaveFocus());
  await user.keyboard("{ArrowRight}");
  const option = await screen.findByRole("menuitemradio", { name });
  await waitFor(() =>
    expect(screen.getAllByRole("menuitemradio").some((item) => item === document.activeElement)).toBe(true),
  );
  await user.click(option);
}

describe("เมนูผู้ใช้ท้าย sidebar (NavUser ของ sidebar-07)", () => {
  it("ปุ่มและหัวเมนู = ชื่อ + ตำแหน่ง (ไม่มีอีเมล) · มีธีม และออกจากระบบอยู่ท้ายสุด", async () => {
    setup();
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: /ทดสอบ staff/ });
    expect(trigger).toHaveTextContent("ทดสอบ staffพนักงาน");
    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveTextContent("ทดสอบ staff");
    expect(menu).toHaveTextContent("พนักงาน");
    // อีเมลไม่แสดงที่ไหนเลย
    expect(screen.queryByText(/staff@ong\.test/)).not.toBeInTheDocument();
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(["ธีม", "ออกจากระบบ"]);
  });

  it("หัวหน้าไม่มีปุ่มธีมและป้ายสาขาแล้ว (ย้ายไปเมนูผู้ใช้/หัว sidebar)", async () => {
    setup();
    const banner = await screen.findByRole("banner");
    expect(await within(banner).findByRole("group", { name: "ราคาทองวันนี้" })).toBeInTheDocument();
    expect(within(banner).queryByRole("button", { name: /ธีม/ })).not.toBeInTheDocument();
    expect(within(banner).queryByText("สาขาปัจจุบัน")).not.toBeInTheDocument();
    expect(within(banner).queryByText("สำนักงานใหญ่ (สาขา 1)")).not.toBeInTheDocument();
  });
});

describe("ธีม (สว่าง · มืด · ตามระบบ)", () => {
  it("ค่าเริ่มต้นตามระบบ · เลือกแล้วใส่ .dark ที่ <html> และจำไว้ใน localStorage", async () => {
    stubSystemDark(false);
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");

    await chooseTheme("มืด");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem("ong.theme")).toBe("dark");

    await chooseTheme("สว่าง");
    await waitFor(() => expect(document.documentElement).not.toHaveClass("dark"));
    expect(localStorage.getItem("ong.theme")).toBe("light");
  });

  it("เปิดใหม่ใช้ธีมที่จำไว้ (ติ๊กในเมนู) · ตามระบบ = ตามโหมดของเครื่อง", async () => {
    stubSystemDark(true);
    localStorage.setItem("ong.theme", "light");
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ทดสอบ staff/ }));
    await user.click(await screen.findByRole("menuitem", { name: "ธีม" }));
    expect(await screen.findByRole("menuitemradio", { name: "สว่าง" })).toHaveAttribute("aria-checked", "true");
    await user.keyboard("{Escape}{Escape}");

    await chooseTheme("ตามระบบ");
    await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    expect(localStorage.getItem("ong.theme")).toBe("system");
  });

  it("เมนูธีม: ไอคอน SunMoon · แต่ละตัวเลือกมีไอคอนของตัวเอง · เช็กชิดขวาเฉพาะตัวที่เลือก (ไม่มีจุดนำหน้า)", async () => {
    stubSystemDark(false);
    localStorage.setItem("ong.theme", "dark");
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ทดสอบ staff/ }));
    const themeItem = await screen.findByRole("menuitem", { name: "ธีม" });
    expect(themeItem.querySelector("svg.lucide-sun-moon")).not.toBeNull();
    await user.click(themeItem);

    const options = await screen.findAllByRole("menuitemradio");
    const icons = { สว่าง: "lucide-sun", มืด: "lucide-moon", ตามระบบ: "lucide-monitor" } as const;
    expect(options.map((o) => o.textContent)).toEqual(["สว่าง", "มืด", "ตามระบบ"]);
    for (const option of options) {
      const label = option.textContent as keyof typeof icons;
      // ไอคอนแรกของแถว = ไอคอนธีม
      expect(option.querySelector("svg")).toHaveClass(icons[label]);
      expect(option.querySelector("svg.lucide-circle")).toBeNull();
    }
    const checked = () => options.map((o) => o.getAttribute("aria-checked"));
    const checks = () => options.map((o) => o.querySelector("svg.lucide-check") !== null);
    expect(checked()).toEqual(["false", "true", "false"]);
    expect(checks()).toEqual([false, true, false]);
    // เช็กอยู่ท้ายแถว (ขวาสุด)
    expect(options[1]?.lastElementChild?.querySelector("svg.lucide-check")).not.toBeNull();

    // คีย์บอร์ดเหมือนเดิม: ↓ ไปตัวถัดไป · Enter เลือก
    (options[1] as HTMLElement).focus();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(localStorage.getItem("ong.theme")).toBe("system"));
    await user.click(screen.getByRole("button", { name: /ทดสอบ staff/ }));
    await user.click(await screen.findByRole("menuitem", { name: "ธีม" }));
    const again = await screen.findAllByRole("menuitemradio");
    expect(again.map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "false", "true"]);
    expect(again.map((o) => o.querySelector("svg.lucide-check") !== null)).toEqual([false, false, true]);
  });

  it("ภาษาไทยเป็นภาษาของหน้า (<html lang>)", () => {
    expect(document.documentElement.lang).toBe("th");
  });
});
