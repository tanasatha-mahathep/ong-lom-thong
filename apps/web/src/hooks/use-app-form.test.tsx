import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppForm, SubmitButton } from "@/components/app-form";
import { ThemeProvider } from "@/components/theme-provider";
import { TextField } from "@/components/ui/form-field";
import { Toaster } from "@/components/ui/sonner";
import { ApiError } from "@/lib/api";
import { toFieldName, useAppForm } from "./use-app-form";

interface Values {
  name: string;
  mobile: string;
}

function DemoForm({
  submit,
  onSuccess,
  submitOnEnter,
  distinct = false,
}: {
  submit: (values: Values) => Promise<string>;
  onSuccess?: (result: string) => void | Promise<void>;
  submitOnEnter?: boolean;
  /** เพิ่ม refine ระดับฟอร์ม (ไม่มี path) */
  distinct?: boolean;
}) {
  const schema = useMemo(() => {
    const base = z.object({
      name: z.string().trim().min(1, "กรอกชื่อ"),
      mobile: z.string().regex(/^0\d{2}-?\d{3}-?\d{4}$/, "เบอร์มือถือไม่ถูกต้อง"),
    });
    return distinct ? base.refine((v) => !v.mobile.endsWith("0000"), "เบอร์นี้ใช้ทดสอบเท่านั้น") : base;
  }, [distinct]);
  const f = useAppForm({
    defaultValues: { name: "", mobile: "" },
    schema,
    submit,
    onSuccess,
    submitOnEnter,
    successMessage: (result) => `บันทึกแล้ว ${result}`,
  });
  return (
    <ThemeProvider>
      <AppForm form={f} aria-label="ลูกค้า">
        <f.form.Field name="name">
          {(field) => <TextField label="ชื่อ" placeholder="สมชาย ใจดี" {...f.bind(field)} />}
        </f.form.Field>
        <f.form.Field name="mobile">
          {(field) => <TextField label="มือถือ" placeholder="081-234-5678" {...f.bind(field)} />}
        </f.form.Field>
        {f.formError && <p data-testid="form-error">{f.formError}</p>}
        <SubmitButton form={f}>บันทึก</SubmitButton>
      </AppForm>
      <button type="button" onClick={f.reset}>
        เริ่มใหม่
      </button>
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

describe("useAppForm — Enter ของฟอร์ม Siam ID", () => {
  it("submitOnEnter=false → Enter ในช่องไม่ส่ง · Ctrl+Enter ส่ง", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve("B-0002"));
    render(<DemoForm submit={submit} submitOnEnter={false} />);
    await user.type(name(), "สมชาย");
    await user.type(mobile(), "0812345678{Enter}");
    expect(submit).not.toHaveBeenCalled();

    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
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

    expect(
      await screen.findByText("ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่", { selector: "[data-title]" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "บันทึก" })).toHaveFocus());
    expect(name()).not.toHaveAttribute("aria-invalid");
  });
});

/** ฟอร์มที่มีรายการ (array) — ชื่อช่องแบบ TanStack `lines[0].weight` */
function LinesForm({ submit }: { submit: () => Promise<void> }) {
  const f = useAppForm({ defaultValues: { lines: [{ weight: "1.000" }, { weight: "2.500" }] }, submit });
  return (
    <ThemeProvider>
      <AppForm form={f}>
        {[0, 1].map((i) => (
          <f.form.Field key={i} name={`lines[${i}].weight`}>
            {(field) => <TextField label={`น้ำหนักแถว ${i + 1}`} placeholder="0.000" {...f.bind(field)} />}
          </f.form.Field>
        ))}
        {f.formError && <p data-testid="form-error">{f.formError}</p>}
        <SubmitButton form={f}>บันทึก</SubmitButton>
      </AppForm>
      <Toaster position="top-center" />
    </ThemeProvider>
  );
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(name(), "  สมชาย  ");
  await user.type(mobile(), "081-234-5678");
}

describe("useAppForm — หลังรีวิว PR #91", () => {
  it("submit ได้ค่าที่ผ่าน schema.parse แล้ว (trim)", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve("B-1"));
    render(<DemoForm submit={submit} />);
    await fillValid(user);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(submit).toHaveBeenCalledWith({ name: "สมชาย", mobile: "081-234-5678" }));
  });

  it("ส่งซ้ำพร้อมกันบนฟอร์มที่ยังเปิดอยู่ (Enter · Ctrl+Enter · submit ซ้ำ) → ส่งครั้งเดียว", async () => {
    const user = userEvent.setup();
    const pending = deferred<string>();
    const submit = vi.fn(() => pending.promise);
    render(<DemoForm submit={submit} />);
    await fillValid(user);

    // ยิงทั้งหมดใน tick เดียวกัน ก่อน React render ฟอร์มเป็น disabled
    const form = screen.getByRole("form", { name: "ลูกค้า" });
    act(() => {
      fireEvent.keyDown(mobile(), { key: "Enter", ctrlKey: true });
      fireEvent.keyDown(mobile(), { key: "Enter", metaKey: true });
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "กำลังบันทึก…" })).toBeDisabled();
    await act(async () => {
      pending.resolve("B-2");
      await pending.promise;
    });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("บันทึกสำเร็จแต่ onSuccess ล้ม → ไม่นับเป็นบันทึกไม่สำเร็จ · ฟอร์มล็อก · บันทึกซ้ำไม่ได้ · reset ปลดล็อก", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve("B-3"));
    const onSuccess = vi.fn(() => Promise.reject(new Error("navigation failed")));
    render(<DemoForm submit={submit} onSuccess={onSuccess} />);
    await fillValid(user);
    await user.keyboard("{Enter}");

    expect(await screen.findByText(/^บันทึกแล้ว แต่เปิดหน้าถัดไปไม่ได้/)).toBeInTheDocument();
    // ไม่ใช่ error ของการบันทึก: ไม่มีข้อความรวม · ไม่มี error ใต้ช่อง
    expect(screen.queryByTestId("form-error")).not.toBeInTheDocument();
    expect(name()).not.toHaveAttribute("aria-invalid");
    // ล็อกค้าง — กดบันทึกซ้ำ (บิลซ้ำ) ไม่ได้
    expect(name()).toBeDisabled();
    expect(screen.getByRole("button", { name: "กำลังบันทึก…" })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "ลูกค้า" }));
    fireEvent.keyDown(name(), { key: "Enter", ctrlKey: true });
    expect(submit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "เริ่มใหม่" }));
    expect(name()).toBeEnabled();
    expect(name()).toHaveValue("");
  });

  it("error ของทั้งฟอร์ม (refine ไม่มี path) → ข้อความรวม + toast + โฟกัสปุ่มบันทึก · ไม่ส่ง", async () => {
    const user = userEvent.setup();
    const submit = vi.fn(() => Promise.resolve("B-4"));
    render(<DemoForm submit={submit} distinct />);
    await user.type(name(), "สมชาย");
    await user.type(mobile(), "081-234-0000");
    await user.keyboard("{Enter}");

    expect(await screen.findByTestId("form-error")).toHaveTextContent("เบอร์นี้ใช้ทดสอบเท่านั้น");
    expect(await screen.findByRole("button", { name: "ปิดการแจ้งเตือน" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "บันทึก" })).toHaveFocus());
    expect(submit).not.toHaveBeenCalled();
  });

  it("toast error ของฟอร์มเดียวกันไม่กองกัน · ส่งใหม่สำเร็จ = toast error หาย", async () => {
    const user = userEvent.setup();
    const submit = vi
      .fn<(values: Values) => Promise<string>>()
      .mockRejectedValueOnce(new ApiError(500, "boom", undefined, null))
      .mockRejectedValueOnce(new ApiError(500, "boom", undefined, null))
      .mockResolvedValueOnce("B-5");
    render(<DemoForm submit={submit} />);
    await fillValid(user);

    await user.keyboard("{Enter}");
    await screen.findByText("เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง", { selector: "[data-title]" });
    await waitFor(() => expect(screen.getByRole("button", { name: "บันทึก" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "บันทึก" })).toHaveFocus());
    expect(screen.getAllByText("เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง", { selector: "[data-title]" })).toHaveLength(1);

    await user.keyboard("{Enter}");
    expect(await screen.findByText("บันทึกแล้ว B-5")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง", { selector: "[data-title]" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("API ชี้ path แบบมีจุด (lines.1.weight) → error ใต้ช่อง lines[1].weight + โฟกัส", async () => {
    const user = userEvent.setup();
    render(
      <LinesForm submit={() => Promise.reject(new ApiError(400, "น้ำหนักต้องมากกว่า 0", "lines.1.weight", null))} />,
    );
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    const second = screen.getByLabelText("น้ำหนักแถว 2");
    await waitFor(() => expect(second).toHaveFocus());
    expect(second).toHaveAccessibleDescription("น้ำหนักต้องมากกว่า 0");
    expect(screen.getByLabelText("น้ำหนักแถว 1")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByTestId("form-error")).not.toBeInTheDocument();
  });

  it("API ชี้ path ที่ฟอร์มไม่มี → ข้อความรวม + โฟกัสปุ่มบันทึก (ไม่หลุดไป body)", async () => {
    const user = userEvent.setup();
    render(<LinesForm submit={() => Promise.reject(new ApiError(400, "แถวนี้ไม่มีแล้ว", "lines.7.weight", null))} />);
    await user.click(screen.getByRole("button", { name: "บันทึก" }));

    expect(await screen.findByTestId("form-error")).toHaveTextContent("แถวนี้ไม่มีแล้ว");
    await waitFor(() => expect(screen.getByRole("button", { name: "บันทึก" })).toHaveFocus());
  });
});

describe("toFieldName", () => {
  it.each([
    ["mobile", "mobile"],
    ["lines.1.weight_g", "lines[1].weight_g"],
    ["allowed_branch_ids.1", "allowed_branch_ids[1]"],
    ["a.0.b.2", "a[0].b[2]"],
  ])("%s → %s", (path, name) => expect(toFieldName(path)).toBe(name));
});
