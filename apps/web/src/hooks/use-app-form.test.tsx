import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppForm, SubmitButton } from "@/components/app-form";
import { ThemeProvider } from "@/components/theme-provider";
import { FloatingInput } from "@/components/ui/floating-field";
import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api";
import { useAppForm } from "./use-app-form";

interface Values {
  name: string;
  mobile: string;
}

function DemoForm({
  submit,
  onSuccess,
}: {
  submit: (values: Values) => Promise<string>;
  onSuccess?: (result: string) => void;
}) {
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, "กรอกชื่อ"),
        mobile: z.string().regex(/^0\d{2}-?\d{3}-?\d{4}$/, "เบอร์มือถือไม่ถูกต้อง"),
      }),
    [],
  );
  const f = useAppForm({
    defaultValues: { name: "", mobile: "" },
    schema,
    submit,
    onSuccess,
    successMessage: (result) => `บันทึกแล้ว ${result}`,
  });
  return (
    <ThemeProvider>
      <AppForm form={f} aria-label="ลูกค้า">
        <f.form.Field name="name">
          {(field) => <FloatingInput label="ชื่อ" placeholder="สมชาย ใจดี" {...f.bind(field)} />}
        </f.form.Field>
        <f.form.Field name="mobile">
          {(field) => <FloatingInput label="มือถือ" placeholder="081-234-5678" {...f.bind(field)} />}
        </f.form.Field>
        <SubmitButton form={f}>บันทึก</SubmitButton>
      </AppForm>
      <Toaster position="top-center" />
    </ThemeProvider>
  );
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const name = () => screen.getByLabelText("ชื่อ");
const mobile = () => screen.getByLabelText("มือถือ");

describe("useAppForm — ตรวจก่อนส่ง (U2)", () => {
  it("ยังไม่ออกจากช่อง = ไม่แสดง error · ออกจากช่อง = แสดง · แก้แล้วหายทันทีตอนพิมพ์", async () => {
    const user = userEvent.setup();
    render(<DemoForm submit={vi.fn()} />);

    await user.click(mobile());
    await user.keyboard("08");
    expect(mobile()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("เบอร์มือถือไม่ถูกต้อง")).not.toBeInTheDocument();

    await user.tab();
    expect(mobile()).toBeInvalid();
    expect(mobile()).toHaveAccessibleDescription("เบอร์มือถือไม่ถูกต้อง");

    // หลัง blur ครั้งแรก ตรวจทุกครั้งที่พิมพ์
    await user.click(mobile());
    await user.keyboard("1-234-5678");
    expect(mobile()).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("เบอร์มือถือไม่ถูกต้อง")).not.toBeInTheDocument();
    await user.keyboard("{Backspace}");
    expect(mobile()).toHaveAccessibleDescription("เบอร์มือถือไม่ถูกต้อง");
  });

  it("Tab ผ่านช่องว่างที่บังคับ → error ใต้ช่องนั้นเท่านั้น", async () => {
    const user = userEvent.setup();
    render(<DemoForm submit={vi.fn()} />);
    await user.click(name());
    await user.tab();
    expect(name()).toHaveAccessibleDescription("กรอกชื่อ");
    expect(mobile()).not.toHaveAttribute("aria-invalid");
  });

  it("กดบันทึกทั้งที่ผิด → error ทุกช่อง · โฟกัสช่องแรกที่ผิด · ไม่ส่ง", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    render(<DemoForm submit={submit} />);
    await user.type(mobile(), "0812345678");
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(name()).toHaveFocus());
    expect(name()).toHaveAccessibleDescription("กรอกชื่อ");
    expect(mobile()).not.toHaveAttribute("aria-invalid");
    expect(submit).not.toHaveBeenCalled();

    // ช่องที่สองผิด (ช่องแรกถูกแล้ว) → โฟกัสช่องที่สอง
    await user.type(name(), "สมชาย");
    await user.clear(mobile());
    await user.type(mobile(), "12");
    await user.click(name());
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(mobile()).toHaveFocus());
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("useAppForm — ระหว่างส่งและหลังส่ง (U3–U5)", () => {
  it("ระหว่างส่ง: ทั้งฟอร์มปิด · ปุ่มหมุน 'กำลังบันทึก…' · ส่งซ้ำไม่ได้ → สำเร็จ toast + onSuccess", async () => {
    const user = userEvent.setup();
    const pending = deferred<string>();
    const submit = vi.fn(() => pending.promise);
    const onSuccess = vi.fn();
    render(<DemoForm submit={submit} onSuccess={onSuccess} />);
    await user.type(name(), "สมชาย");
    await user.type(mobile(), "081-234-5678");
    await user.keyboard("{Enter}");

    const button = await screen.findByRole("button", { name: "กำลังบันทึก…" });
    expect(button).toBeDisabled();
    expect(name()).toBeDisabled();
    expect(mobile()).toBeDisabled();
    expect(screen.getByRole("form", { name: "ลูกค้า" })).toHaveAttribute("aria-busy", "true");

    // Enter / Ctrl+Enter / คลิกซ้ำ ไม่ส่งซ้ำ
    await user.click(button);
    fireEvent.submit(screen.getByRole("form"));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ name: "สมชาย", mobile: "081-234-5678" });

    await act(async () => {
      pending.resolve("B-0001");
      await pending.promise;
    });
    expect(await screen.findByText("บันทึกแล้ว B-0001")).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledWith("B-0001", { name: "สมชาย", mobile: "081-234-5678" });
    await waitFor(() => expect(screen.getByRole("button", { name: "บันทึก" })).toBeEnabled());
  });

  it("API ชี้ช่อง → error ใต้ช่อง + โฟกัสช่อง + toast ค้าง (มีปุ่มปิด) · แก้ช่องแล้ว error หาย", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.reject(new ApiError(400, "เบอร์นี้มีลูกค้าใช้แล้ว", "mobile", null)));
    render(<DemoForm submit={submit} />);
    await user.type(name(), "สมชาย");
    await user.type(mobile(), "0812345678");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(mobile()).toHaveFocus());
    expect(mobile()).toHaveAccessibleDescription("เบอร์นี้มีลูกค้าใช้แล้ว");
    expect(mobile()).toBeEnabled();
    // toast error ค้างจนกดปิด
    expect(await screen.findByRole("button", { name: "ปิดการแจ้งเตือน" })).toBeInTheDocument();
    expect(screen.getAllByText("เบอร์นี้มีลูกค้าใช้แล้ว")).toHaveLength(2);

    // โฟกัสแล้วเลือกข้อความทั้งช่องไว้ (พิมพ์ทับได้เลย) — แก้ตัวท้ายแทน
    expect(mobile()).toHaveProperty("selectionStart", 0);
    await user.keyboard("{End}{Backspace}9");
    expect(mobile()).toHaveValue("0812345679");
    expect(mobile()).not.toHaveAttribute("aria-invalid");
  });

  it("error ไม่ชี้ช่อง → toast + โฟกัสปุ่มบันทึก", async () => {
    const user = userEvent.setup();
    render(<DemoForm submit={() => Promise.reject(new ApiError(0, "network", undefined, null))} />);
    await user.type(name(), "สมชาย");
    await user.type(mobile(), "0812345678");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "บันทึก" })).toHaveFocus());
    expect(name()).not.toHaveAttribute("aria-invalid");
  });
});
