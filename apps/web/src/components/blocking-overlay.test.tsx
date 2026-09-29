import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { page } from "@/lib/app-update";
import { beginBlocking, reloadBlocking, runBlocking } from "@/lib/blocking";
import { BlockingOverlay } from "./blocking-overlay";

function renderPage() {
  const onKeyDown = vi.fn();
  const onClick = vi.fn();
  const view = render(
    <>
      <button type="button" onKeyDown={onKeyDown} onClick={onClick}>
        บันทึก
      </button>
      <BlockingOverlay />
    </>,
  );
  return { ...view, onKeyDown, onClick };
}

describe("ชั้นบังหน้าจอ (U6)", () => {
  it("ปกติไม่แสดง", () => {
    renderPage();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("บังอยู่ → dialog aria-busy ชื่อ 'กำลังทำงาน…' ได้โฟกัส · หน้าข้างใต้ inert · คีย์บอร์ดไม่ถึงหน้าข้างใต้", async () => {
    const user = userEvent.setup();
    const { container, onKeyDown } = renderPage();
    const button = screen.getByRole("button", { name: "บันทึก" });
    button.focus();

    let end = () => undefined as void;
    act(() => {
      end = beginBlocking();
    });

    const overlay = screen.getByRole("dialog", { name: "กำลังทำงาน…" });
    expect(overlay).toHaveAttribute("aria-busy", "true");
    expect(overlay).toHaveAttribute("aria-modal", "true");
    expect(overlay).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("กำลังทำงาน…");
    // browser จริง: inert = คลิก/โฟกัสไม่ได้
    expect(container).toHaveAttribute("inert");

    // Tab ไม่หลุดออกไปหน้าข้างใต้
    await user.tab();
    expect(overlay).toHaveFocus();
    await user.tab({ shift: true });
    expect(overlay).toHaveFocus();
    // Enter / Ctrl+Enter ที่ปุ่มข้างใต้ถูกกันไว้
    expect(fireEvent.keyDown(button, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(button, { key: "Enter", ctrlKey: true })).toBe(false);
    expect(onKeyDown).not.toHaveBeenCalled();
    // โฟกัสด้วยโปรแกรมไปที่อื่น → ดึงกลับ
    act(() => button.focus());
    expect(overlay).toHaveFocus();
    // รีโหลดหน้ายังทำได้ (ทางออกถ้าค้าง)
    expect(fireEvent.keyDown(overlay, { key: "F5" })).toBe(true);

    act(() => end());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container).not.toHaveAttribute("inert");
    // ไม่ได้ไปหน้าอื่น → โฟกัสกลับที่เดิม
    expect(button).toHaveFocus();
  });

  it("runBlocking บังระหว่างรอ แล้วเลิกบังแม้งานล้มเหลว", async () => {
    renderPage();
    let finish: (value: string) => void = () => undefined;
    let result: Promise<string> = Promise.resolve("");
    act(() => {
      result = runBlocking(() => new Promise<string>((resolve) => (finish = resolve)));
    });
    expect(screen.getByRole("dialog", { name: "กำลังทำงาน…" })).toBeInTheDocument();
    await act(async () => {
      finish("ok");
      await result;
    });
    await expect(result).resolves.toBe("ok");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      await expect(runBlocking(() => Promise.reject(new Error("พัง")))).rejects.toThrow("พัง");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("บังซ้อนกัน → เลิกบังเมื่อทุกงานจบ · เรียก end ซ้ำไม่นับซ้ำ", () => {
    renderPage();
    let first = () => undefined as void;
    let second = () => undefined as void;
    act(() => {
      first = beginBlocking();
      second = beginBlocking();
    });
    act(() => {
      first();
      first();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => second());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reloadBlocking → บังหน้าจอแล้ว reload", () => {
    const reload = vi.spyOn(page, "reload").mockImplementation(() => undefined);
    renderPage();
    act(() => reloadBlocking());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "กำลังทำงาน…" })).toBeInTheDocument();
  });
});
