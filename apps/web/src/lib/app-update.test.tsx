import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorPage } from "@/components/status-page";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { isChunkLoadError, listenForAppUpdates, page, reloadOnceForUpdate } from "./app-update";

const CHUNK_ERRORS = [
  "Failed to fetch dynamically imported module: https://ong.example/assets/bills-abc123.js",
  "error loading dynamically imported module: https://ong.example/assets/bills-abc123.js",
  "Importing a module script failed.",
  "Unable to preload CSS for /assets/index-abc123.css",
];

describe("เวอร์ชันใหม่หลัง deploy (chunk เก่าหาย)", () => {
  it.each(CHUNK_ERRORS)("รู้จัก error ของ browser: %s", (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true);
  });

  it("error อื่นไม่ใช่เรื่องเวอร์ชันใหม่", () => {
    expect(isChunkLoadError(new Error("internal error"))).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false);
  });

  it("reload เองได้ครั้งเดียวใน 10 นาที — กัน reload วน", () => {
    const reload = vi.spyOn(page, "reload").mockImplementation(() => undefined);
    const start = Date.UTC(2026, 8, 29, 8, 0);

    expect(reloadOnceForUpdate(start)).toBe(true);
    expect(reloadOnceForUpdate(start + 60_000)).toBe(false);
    expect(reloadOnceForUpdate(start + 10 * 60_000)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("เปลี่ยนหน้าแล้วโหลด chunk ไม่ได้ → บอกว่ามีเวอร์ชันใหม่ · reload ให้เองครั้งเดียว · มีปุ่มรีเฟรช", async () => {
    const reload = vi.spyOn(page, "reload").mockImplementation(() => undefined);
    const error = new TypeError(CHUNK_ERRORS[0]);
    const { rerender } = render(<ErrorPage error={error} reset={() => undefined} />);

    expect(screen.getByRole("heading", { name: "มีเวอร์ชันใหม่ กรุณารีเฟรช" })).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);

    // เจอซ้ำหลัง reload (build ยังเก่าอยู่) — ไม่ reload วน รอให้กดเอง
    rerender(<ErrorPage error={new TypeError(CHUNK_ERRORS[1])} reset={() => undefined} />);
    expect(reload).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "รีเฟรช" }));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("vite:preloadError → แจ้งแบบไม่บังคับพร้อมปุ่มรีเฟรช", async () => {
    const reload = vi.spyOn(page, "reload").mockImplementation(() => undefined);
    render(
      <ThemeProvider>
        <Toaster />
      </ThemeProvider>,
    );
    const stop = listenForAppUpdates();
    window.dispatchEvent(new Event("vite:preloadError"));

    expect(await screen.findByText("มีเวอร์ชันใหม่ กรุณารีเฟรช")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "รีเฟรช" }));
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});
