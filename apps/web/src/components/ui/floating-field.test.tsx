import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FloatingInput, FloatingSelect, FloatingTextarea } from "./floating-field";
import { NativeSelectOption } from "./native-select";

describe("floating label (U0–U1)", () => {
  it("ป้ายเป็น <label for> จริง — ชื่อของช่อง · คลิกป้ายแล้วโฟกัสช่อง", async () => {
    const user = userEvent.setup();
    render(<FloatingInput label="เบอร์มือถือ" placeholder="081-234-5678" />);
    const input = screen.getByLabelText("เบอร์มือถือ");
    const label = screen.getByText("เบอร์มือถือ");

    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", input.id);
    expect(input).toHaveAccessibleName("เบอร์มือถือ");
    // placeholder คือตัวอย่างรูปแบบ (โปร่งใสจนโฟกัส — CSS) ไม่ใช่ชื่อช่อง
    expect(input).toHaveAttribute("placeholder", "081-234-5678");

    await user.click(label);
    expect(input).toHaveFocus();
  });

  it("ไม่มี placeholder ก็ยังใช้ :placeholder-shown ได้ (ใส่ช่องว่างให้)", () => {
    render(<FloatingInput label="ชื่อ" />);
    expect(screen.getByLabelText("ชื่อ")).toHaveAttribute("placeholder", " ");
  });

  it("ลำดับ Tab เหมือนช่องธรรมดา — ป้ายไม่รับโฟกัส", async () => {
    const user = userEvent.setup();
    render(
      <>
        <FloatingInput label="ช่องแรก" />
        <FloatingTextarea label="ที่อยู่" />
        <FloatingSelect label="สาขา" placeholder="— เลือก —">
          <NativeSelectOption value="1">สาขา 1</NativeSelectOption>
        </FloatingSelect>
      </>,
    );
    await user.tab();
    expect(screen.getByLabelText("ช่องแรก")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("ที่อยู่")).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("สาขา")).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "สาขา" })).toHaveDisplayValue("— เลือก —");
  });

  it("error → aria-invalid + ข้อความใต้ช่องผูก aria-describedby (ต่อจาก describedby เดิม)", () => {
    render(
      <>
        <p id="extra">คำใบ้ภายนอก</p>
        <FloatingInput
          id="dob"
          label="วันเกิด"
          placeholder="วว/ดด/ปปปป"
          description="ปี พ.ศ."
          error="วันที่ไม่ถูกต้อง"
          aria-describedby="extra"
        />
      </>,
    );
    const input = screen.getByLabelText("วันเกิด");
    expect(input).toHaveAttribute("type", "text");
    expect(input).toBeInvalid();
    expect(input).toHaveAttribute("aria-describedby", "extra dob-description dob-error");
    expect(input).toHaveAccessibleDescription("คำใบ้ภายนอก ปี พ.ศ. วันที่ไม่ถูกต้อง");
    expect(screen.getByRole("alert")).toHaveTextContent("วันที่ไม่ถูกต้อง");
  });

  it("ไม่มี error → ไม่มี aria-invalid และไม่มีข้อความใต้ช่อง", () => {
    render(<FloatingTextarea label="หมายเหตุ" />);
    const textarea = screen.getByLabelText("หมายเหตุ");
    expect(textarea).not.toHaveAttribute("aria-invalid");
    expect(textarea).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("size=compact ติดไว้ที่ช่องและกล่อง (ให้ CSS ความสูงน้อยลง)", () => {
    render(<FloatingInput label="น้ำหนัก" size="compact" inputMode="decimal" />);
    const input = screen.getByLabelText("น้ำหนัก");
    expect(input).toHaveAttribute("data-size", "compact");
    expect(input.closest("[data-slot=floating-field]")).toHaveAttribute("data-size", "compact");
    expect(input).not.toHaveAttribute("size");
  });

  it("ส่ง role=combobox ได้ (ช่องค้นหาแบบ autocomplete)", () => {
    render(<FloatingInput label="ค้นหาลูกค้า" role="combobox" aria-expanded={false} aria-controls="list" />);
    expect(screen.getByRole("combobox", { name: "ค้นหาลูกค้า" })).toBeInTheDocument();
  });
});
