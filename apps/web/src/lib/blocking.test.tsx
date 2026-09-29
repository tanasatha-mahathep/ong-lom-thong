import type { NavigateOptions } from "@tanstack/react-router";
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockingOverlay } from "@/components/blocking-overlay";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { page } from "@/lib/app-update";
import {
  BLOCKING_WATCHDOG_MS,
  UNLOAD_GRACE_MS,
  beginBlocking,
  blockingNavigate,
  reloadBlocking,
  runBlocking,
  useIsBlocking,
} from "./blocking";

const navigate = vi.fn<(options: NavigateOptions) => Promise<void>>();
/** useBlockingNavigate = useNavigate ของ router + blockingNavigate — เทสต์ส่วนหลังด้วย navigate ปลอม */
const go = (options: NavigateOptions) => blockingNavigate(navigate, options);

function renderOverlay() {
  return render(
    <ThemeProvider>
      <button type="button">บันทึก</button>
      <BlockingOverlay />
      <Toaster position="top-center" />
    </ThemeProvider>,
  );
}

const overlay = () => screen.queryByRole("dialog", { name: "กำลังทำงาน…" });

describe("ชั้นบังหน้าจอ — ไม่ค้างตลอดไป", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    navigate.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("navigation ค้าง (promise ไม่จบ) → เลิกบังเองเมื่อครบ watchdog + toast error", async () => {
    renderOverlay();
    navigate.mockReturnValue(new Promise(() => undefined));
    act(() => void go({ to: "/buy" }));
    expect(overlay()).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(BLOCKING_WATCHDOG_MS - 1);
    });
    expect(overlay()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(overlay()).not.toBeInTheDocument();
    expect(await screen.findByText(/^ใช้เวลานานผิดปกติ/)).toBeInTheDocument();
  });

  it("navigate ล้มเหลว (reject) → เลิกบังและส่ง error ต่อให้ผู้เรียก", async () => {
    renderOverlay();
    navigate.mockRejectedValue(new Error("loader พัง"));
    await act(async () => {
      await expect(go({ to: "/buy" })).rejects.toThrow("loader พัง");
    });
    expect(overlay()).not.toBeInTheDocument();
  });

  it("reloadDocument / ไป origin อื่น → บังต่อหลัง promise จบ (หน้ากำลังจะหาย) · ยังอยู่เกินเวลา = เลิกบังเงียบ ๆ", async () => {
    renderOverlay();
    navigate.mockResolvedValue(undefined);
    await act(() => go({ to: "/buy", reloadDocument: true }));
    expect(overlay()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(UNLOAD_GRACE_MS);
    });
    expect(overlay()).not.toBeInTheDocument();

    await act(() => go({ href: "https://example.com/elsewhere" }));
    expect(overlay()).toBeInTheDocument();

    // ในแอปเอง = เลิกบังทันทีที่ไปถึง
    act(() => {
      vi.advanceTimersByTime(UNLOAD_GRACE_MS);
    });
    await act(() => go({ href: "/bills" }));
    expect(overlay()).not.toBeInTheDocument();
    expect(screen.queryByText(/^ใช้เวลานานผิดปกติ/)).not.toBeInTheDocument();
  });

  it("reloadBlocking ที่ถูกยกเลิก (beforeunload 'อยู่ต่อ') → เลิกบังหลังช่วงรอ", () => {
    const reload = vi.spyOn(page, "reload").mockImplementation(() => undefined);
    renderOverlay();
    act(() => reloadBlocking());
    expect(reload).toHaveBeenCalledTimes(1);
    expect(overlay()).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(UNLOAD_GRACE_MS);
    });
    expect(overlay()).not.toBeInTheDocument();
  });

  it("จบก่อน watchdog → ไม่มี toast ค้างตามมา", async () => {
    renderOverlay();
    await act(() => runBlocking(() => Promise.resolve()));
    act(() => {
      vi.advanceTimersByTime(BLOCKING_WATCHDOG_MS * 2);
    });
    expect(screen.queryByText(/^ใช้เวลานานผิดปกติ/)).not.toBeInTheDocument();
  });
});

describe("ชั้นบังหน้าจอ — inert", () => {
  it("toaster (portal ที่ body) ไม่ถูกทำ inert — aria-live ยังประกาศ toast ระหว่างบัง", () => {
    const { container } = renderOverlay();
    act(() => void beginBlocking());
    expect(container).toHaveAttribute("inert");
    const host = document.querySelector('[data-slot="toaster-host"]');
    expect(host?.parentElement).toBe(document.body);
    expect(host).not.toHaveAttribute("inert");
  });

  it("overlay ถูก unmount ระหว่างบังอยู่ → inert ถูกถอดคืน", () => {
    const { container, unmount } = renderOverlay();
    const probe = document.createElement("div");
    document.body.append(probe);
    act(() => void beginBlocking());
    expect(probe).toHaveAttribute("inert");

    unmount();
    expect(probe).not.toHaveAttribute("inert");
    expect(container).not.toHaveAttribute("inert");
    probe.remove();
  });

  it("useIsBlocking ติดตามสถานะ", () => {
    const { result } = renderHook(() => useIsBlocking());
    expect(result.current).toBe(false);
    let end = () => undefined as void;
    act(() => {
      end = beginBlocking();
    });
    expect(result.current).toBe(true);
    act(() => end());
    expect(result.current).toBe(false);
  });
});
