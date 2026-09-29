import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SelectField, TextField, TextareaField } from "./form-field";
import { NativeSelectOption } from "./native-select";

describe("ช่องกรอก — ป้ายเหนือช่อง (U0–U3)", () => {
  it("ป้ายเป็น <label for> จริงอยู่ก่อนช่อง · placeholder แสดงตลอด · คลิกป้ายแล้วโฟกัสช่อง", async () => {
    const user = userEvent.setup();
    render(<TextField label="เบอร์มือถือ" placeholder="081-234-5678" />);
    const input = screen.getByLabelText("เบอร์มือถือ");
    const label = screen.getByText("เบอร์มือถือ");

    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", input.id);
    // ป้ายอยู่เหนือช่อง: มาก่อนช่องใน DOM และไม่ได้วางทับ (ไม่ absolute)
    expect(label.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label).not.toHaveClass("absolute");
    expect(input).toHaveAttribute("placeholder", "081-234-5678");
    expect(input).not.toHaveClass("placeholder:text-transparent");

    await user.click(label);
    expect(input).toHaveFocus();
  });

  it("ค่าเริ่มต้น type=text (ช่องวันที่ Siam ID ไม่เป็น date picker)", () => {
    render(<TextField label="วันเกิด" placeholder="วว/ดด/ปปปป" />);
    expect(screen.getByLabelText("วันเกิด")).toHaveAttribute("type", "text");
  });

  it("placeholder บังคับใน type (U1) — ลืมใส่ = typecheck ไม่ผ่าน", () => {
    // @ts-expect-error — placeholder (ตัวอย่าง/รูปแบบ) เป็น prop บังคับ
    render(<TextField label="ลืม placeholder" />);
    // @ts-expect-error — textarea ก็บังคับเหมือนกัน
    render(<TextareaField label="ลืม placeholder ที่อยู่" />);
    expect(screen.getByLabelText("ลืม placeholder")).toBeInTheDocument();
  });

  it("required → ดอกจันสีแดง (ประดับ aria-hidden) · ชื่อช่องไม่มีดอกจัน · ช่องเป็น required", () => {
    render(<TextField label="ชื่อ-นามสกุล" placeholder="สมชาย ใจดี" required />);
    const input = screen.getByRole("textbox", { name: "ชื่อ-นามสกุล" });
    expect(input).toBeRequired();
    const star = screen.getByText("*");
    expect(star).toHaveAttribute("aria-hidden", "true");
    expect(star).toHaveClass("text-destructive");
  });

  it("ลำดับ Tab เหมือนช่องธรรมดา — ป้ายไม่รับโฟกัส", async () => {
    const user = userEvent.setup();
    render(
      <>
        <TextField label="ช่องแรก" placeholder="สมชาย" />
        <TextareaField label="ที่อยู่" placeholder="99/1 ถ.สุขุมวิท" />
        <SelectField label="สาขา" placeholder="— เลือก —">
          <NativeSelectOption value="1">สาขา 1</NativeSelectOption>
        </SelectField>
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
        <TextField
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
    expect(input).toBeInvalid();
    expect(input).toHaveAttribute("aria-describedby", "extra dob-description dob-error");
    expect(input).toHaveAccessibleDescription("คำใบ้ภายนอก ปี พ.ศ. วันที่ไม่ถูกต้อง");
    expect(screen.getByRole("alert")).toHaveTextContent("วันที่ไม่ถูกต้อง");
    expect(input.closest("[data-slot=form-field]")).toHaveAttribute("data-invalid", "true");
  });

  it("ไม่มี error → ไม่มี aria-invalid และไม่มีข้อความใต้ช่อง", () => {
    render(<TextareaField label="หมายเหตุ" placeholder="" />);
    const textarea = screen.getByLabelText("หมายเหตุ");
    expect(textarea).not.toHaveAttribute("aria-invalid");
    expect(textarea).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("size=compact ติดไว้ที่ช่องและกล่อง (ช่องเตี้ยลง ป้ายขนาดปกติ)", () => {
    render(<TextField label="น้ำหนัก" placeholder="0.000" size="compact" inputMode="decimal" />);
    const input = screen.getByLabelText("น้ำหนัก");
    expect(input).toHaveAttribute("data-size", "compact");
    expect(input).toHaveClass("h-8");
    expect(input.closest("[data-slot=form-field]")).toHaveAttribute("data-size", "compact");
    expect(input).not.toHaveAttribute("size");
    expect(screen.getByText("น้ำหนัก", { selector: "label" })).toHaveClass("text-sm");
  });

  it("ส่ง role=combobox ได้ (ช่องค้นหาแบบ autocomplete)", () => {
    render(
      <TextField
        label="ค้นหาลูกค้า"
        placeholder="ชื่อ · เลขบัตร"
        role="combobox"
        aria-expanded={false}
        aria-controls="list"
      />,
    );
    expect(screen.getByRole("combobox", { name: "ค้นหาลูกค้า" })).toBeInTheDocument();
  });
});
