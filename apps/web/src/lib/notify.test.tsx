import { act, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { fakeApi, json, renderApp } from "@/test/app";
import { TOAST_SUCCESS_MS, notifyError, notifySuccess } from "./notify";

/** Toaster ตัวจริงของแอป (routes/__root.tsx) บนหน้า login */
async function renderRoot() {
  fakeApi({ "GET /api/me": () => json({ error: "unauthorized" }, 401) });
  renderApp("/login");
  await screen.findByRole("heading", { level: 1, name: "เข้าสู่ระบบ" });
}

describe("toast หลังส่งฟอร์ม (U5)", () => {
  it("Toaster ของแอปอยู่บนกลางจอ", async () => {
    await renderRoot();
    act(() => void notifySuccess("บันทึกแล้ว"));

    await screen.findByText("บันทึกแล้ว");
    const toaster = document.querySelector("[data-sonner-toaster]");
    expect(toaster).toHaveAttribute("data-y-position", "top");
    expect(toaster).toHaveAttribute("data-x-position", "center");
  });

  it("error ค้างจนกดปิด (มีปุ่มปิด) · สำเร็จไม่มีปุ่มปิด", async () => {
    await renderRoot();
    act(() => void notifySuccess("บันทึกแล้ว"));
    await screen.findByText("บันทึกแล้ว");
    expect(screen.queryByRole("button", { name: "ปิดการแจ้งเตือน" })).not.toBeInTheDocument();

    act(() => void notifyError("บันทึกไม่สำเร็จ"));
    await screen.findByText("บันทึกไม่สำเร็จ");
    const close = screen.getByRole("button", { name: "ปิดการแจ้งเตือน" });
    act(() => close.click());
    await waitFor(() => expect(screen.queryByText("บันทึกไม่สำเร็จ")).not.toBeInTheDocument());
  });

  it("สำเร็จหายเองใน 4 วินาที · error ไม่มีกำหนดหาย", () => {
    const success = vi.spyOn(toast, "success").mockReturnValue(1);
    const error = vi.spyOn(toast, "error").mockReturnValue(2);
    notifySuccess("ok");
    notifyError("พัง");

    expect(TOAST_SUCCESS_MS).toBe(4000);
    expect(success).toHaveBeenCalledWith("ok", { duration: 4000 });
    expect(error).toHaveBeenCalledWith("พัง", { duration: Number.POSITIVE_INFINITY, closeButton: true });
  });
});
