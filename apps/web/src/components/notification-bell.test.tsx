import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { NotificationBell } from "./notification-bell";

const renderBell = (unread?: number) =>
  render(
    <TooltipProvider>
      <NotificationBell unread={unread} />
    </TooltipProvider>,
  );

describe("กระดิ่งแจ้งเตือน", () => {
  it("อยู่ขวาสุดของหัวหน้า · เปิดด้วยคีย์บอร์ดแล้วเห็นสถานะว่าง · Esc ปิดและโฟกัสกลับกระดิ่ง", async () => {
    fakeApi({ "GET /api/me": () => json(makeMe("staff")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
    renderApp("/");
    const user = userEvent.setup();
    const banner = await screen.findByRole("banner");
    const bell = within(banner).getByRole("button", { name: "การแจ้งเตือน" });
    // ปุ่มสุดท้ายของหัวหน้า (ขวาสุด)
    expect(within(banner).getAllByRole("button").at(-1)).toBe(bell);
    expect(bell.querySelector('[data-slot="notification-badge"]')).toBeNull();

    bell.focus();
    await user.keyboard("{Enter}");
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByRole("heading", { name: "การแจ้งเตือน" })).toBeInTheDocument();
    expect(within(panel).getByText("ยังไม่มีการแจ้งเตือน")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(bell).toHaveFocus());
  });

  it("ยังไม่อ่าน 0 = ไม่มีป้าย · มากกว่า 0 = ป้ายจำนวน + บอกในชื่อปุ่ม · เกิน 99 = 99+", () => {
    const { unmount } = renderBell(0);
    expect(
      screen.getByRole("button", { name: "การแจ้งเตือน" }).querySelector('[data-slot="notification-badge"]'),
    ).toBeNull();
    unmount();

    const again = renderBell(3);
    const bell = screen.getByRole("button", { name: "การแจ้งเตือน (3 รายการใหม่)" });
    expect(bell.querySelector('[data-slot="notification-badge"]')).toHaveTextContent("3");
    again.unmount();

    renderBell(150);
    expect(screen.getByRole("button", { name: "การแจ้งเตือน (150 รายการใหม่)" })).toHaveTextContent("99+");
  });
});
