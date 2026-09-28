import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OnNationalId, SIAM_ID_BURST_IDLE_MS, useSiamIdCapture } from "./use-siam-id-capture";

function Harness({ onNationalId }: { onNationalId: OnNationalId }) {
  const [value, setValue] = useState("");
  const capture = useSiamIdCapture({ value, onValueChange: setValue, onNationalId });
  return (
    <>
      <label>
        เลขบัตร
        <input {...capture.inputProps} />
      </label>
      <label>
        ปริมาณ
        <input />
      </label>
    </>
  );
}

// จับเวลาด้วยนาฬิกาปลอม (เฉพาะ setTimeout) + event แบบ sync — จังหวะ burst ไม่ขึ้นกับความเร็วเครื่องที่รันเทสต์
beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

const idBox = () => screen.getByLabelText<HTMLInputElement>("เลขบัตร");
/** กดปุ่มแล้วดูว่าช่องกลืนไว้ไหม (fireEvent คืน false เมื่อ preventDefault) */
const swallowed = (key: string) => !fireEvent.keyDown(idBox(), { key });

describe("useSiamIdCapture", () => {
  it("keeps the 13 digits, swallows the reader's Tab/text/Enter, then moves focus once it goes quiet", async () => {
    const found = vi.fn<OnNationalId>(() => Promise.resolve(() => screen.getByLabelText("ปริมาณ").focus()));
    render(<Harness onNationalId={found} />);
    idBox().focus();

    fireEvent.change(idBox(), { target: { value: "1909900001010" } });
    expect(found).toHaveBeenCalledExactlyOnceWith("1909900001010");
    // ส่วนที่ Siam ID พิมพ์ตามมา: Tab · ชื่อ · Enter — ไม่มีอะไรหลุดออกจากช่อง
    expect(swallowed("Tab")).toBe(true);
    expect(swallowed("น")).toBe(true);
    fireEvent.change(idBox(), { target: { value: "1909900001010นาย" } });
    expect(swallowed("Enter")).toBe(true);
    expect(idBox()).toHaveValue("1909900001010");

    // ยังไม่เงียบครบ = ยังไม่ย้าย · ครบแล้ว = ไปช่องที่ผลค้นบอก
    await act(() => vi.advanceTimersByTimeAsync(SIAM_ID_BURST_IDLE_MS - 1));
    expect(idBox()).toHaveFocus();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(screen.getByLabelText("ปริมาณ")).toHaveFocus();
    // จบ burst แล้ว ปุ่มกลับมาทำงานตามปกติ
    expect(swallowed("Tab")).toBe(false);
  });

  it("stays put when the lookup gives no next field, and leaves short input alone", async () => {
    const found = vi.fn<OnNationalId>(() => Promise.resolve(null));
    render(<Harness onNationalId={found} />);
    idBox().focus();

    fireEvent.change(idBox(), { target: { value: "12345" } });
    expect(swallowed("Tab")).toBe(false);
    expect(found).not.toHaveBeenCalled();

    // เลขบัตร 13 หลักที่หลักตรวจสอบถูกต้อง (ต่างจากเลขที่ใช้เจอในเทสต์อื่น)
    fireEvent.change(idBox(), { target: { value: "1909900001028" } });
    expect(swallowed("Tab")).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(SIAM_ID_BURST_IDLE_MS));
    expect(idBox()).toHaveFocus();
    expect(found).toHaveBeenCalledExactlyOnceWith("1909900001028");
  });

  it("reports a bad checksum but does not swallow keys for it, so Backspace fixes the digits right away", () => {
    const found = vi.fn<OnNationalId>(() => Promise.resolve(null));
    render(<Harness onNationalId={found} />);
    idBox().focus();

    // "1234567890123" หลักตรวจสอบไม่ผ่าน (ไม่ใช่ Siam ID จริง พิมพ์เองพลาด) — แจ้งผลแต่ต้องไม่ล็อกปุ่ม
    fireEvent.change(idBox(), { target: { value: "1234567890123" } });
    expect(found).toHaveBeenCalledExactlyOnceWith("1234567890123");
    expect(swallowed("Backspace")).toBe(false);
    expect(swallowed("Tab")).toBe(false);
  });
});
