import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type OnNationalId, useSiamIdCapture } from "./use-siam-id-capture";

function Harness({ onNationalId }: { onNationalId: OnNationalId }) {
  const [value, setValue] = useState("");
  const capture = useSiamIdCapture({ value, onValueChange: setValue, onNationalId, idleMs: 50 });
  return (
    <>
      <label>
        เลขบัตร
        <input {...capture.inputProps} />
      </label>
      <label>
        ชื่อ
        <input />
      </label>
      <label>
        ปริมาณ
        <input />
      </label>
    </>
  );
}

describe("useSiamIdCapture", () => {
  it("keeps the 13 digits, swallows the reader's Tab/text/Enter, then moves focus once it goes quiet", async () => {
    const user = userEvent.setup();
    const found = vi.fn<OnNationalId>(() => Promise.resolve(() => screen.getByLabelText("ปริมาณ").focus()));
    render(<Harness onNationalId={found} />);
    await user.click(screen.getByLabelText("เลขบัตร"));

    await user.keyboard("1909900001010{Tab}นายทดสอบ{Tab}01/01/2530{Enter}");
    expect(screen.getByLabelText("เลขบัตร")).toHaveValue("1909900001010");
    expect(screen.getByLabelText("เลขบัตร")).toHaveFocus();
    expect(screen.getByLabelText("ชื่อ")).toHaveValue("");
    expect(found).toHaveBeenCalledExactlyOnceWith("1909900001010");

    await waitFor(() => expect(screen.getByLabelText("ปริมาณ")).toHaveFocus());
  });

  it("stays put when the lookup gives no next field, and leaves short input alone", async () => {
    const user = userEvent.setup();
    const found = vi.fn<OnNationalId>(() => Promise.resolve(null));
    render(<Harness onNationalId={found} />);
    await user.click(screen.getByLabelText("เลขบัตร"));

    await user.keyboard("12345{Tab}");
    expect(screen.getByLabelText("ชื่อ")).toHaveFocus();
    expect(found).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText("เลขบัตร"));
    await user.keyboard("67890123{Tab}");
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(screen.getByLabelText("เลขบัตร")).toHaveFocus();
    expect(found).toHaveBeenCalledExactlyOnceWith("1234567890123");
  });
});
