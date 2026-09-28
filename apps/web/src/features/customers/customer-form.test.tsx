import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { CUSTOMER_DETAIL, OTHER_CUSTOMER_ID, pngFile } from "@/test/customers";
import { CustomerForm, type CustomerFormProps } from "./customer-form";
import { type CustomerFormValues, toCustomerFormData, toFormValues } from "./model";

/**
 * สำเนาตรงตัวจาก Work_2026-09-27/03-customer-member.md — ห้าม import จากโค้ด (CLAUDE.md กฎ 6)
 * ช่องที่ 9 (รูป) ไม่ใช่ <label> จึงหาด้วย test id
 */
const LABELS = [
  "เลขประจำตัวประชาชน",
  "ชื่อ - นามสกุล (ภาษาไทย)",
  "ชื่อ - นามสกุล (ภาษาอังกฤษ)",
  "วันเดือนปีเกิด",
  "ศาสนา",
  "ที่อยู่",
  "วันที่ออกบัตร",
  "วันที่บัตรหมดอายุ",
  "รูปภาพ",
  "เบอร์มือถือ",
  "เบอร์โทรติดต่อที่สะดวก",
];
const PAYLOAD_ORDER = [
  "national_id",
  "name_th",
  "name_en",
  "birthday_text",
  "religion",
  "address",
  "card_issue_text",
  "card_expire_text",
  "photo",
  "mobile",
  "phone2",
];

/** ช่องที่ n (1–11) ตามลำดับ Siam ID */
const slot = (n: number): HTMLElement =>
  n === 9 ? screen.getByTestId("photo-zone") : screen.getByLabelText(LABELS[n - 1] ?? "", { exact: true });

const pasteImage = (target: Element, file: File, text = "") =>
  fireEvent.paste(target, {
    clipboardData: { files: [file], items: [], types: ["Files"], getData: () => text },
  });

beforeEach(() => {
  // jsdom ไม่มี object URL — BlobImage ใช้ตอนแสดงรูป
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() });
});

function renderForm(props: Partial<CustomerFormProps> = {}) {
  const onSubmit = vi.fn<(values: CustomerFormValues) => Promise<void>>(() => Promise.resolve());
  const onCancel = vi.fn();
  const view = render(
    <CustomerForm
      mode="create"
      autoFocus
      onSubmit={onSubmit}
      onCancel={onCancel}
      renderDuplicateLink={(id, focusable) => (
        <a href={`/customers/${id}`} tabIndex={focusable ? undefined : -1}>
          เปิดข้อมูลลูกค้าเดิม
        </a>
      )}
      {...props}
    />,
  );
  return { ...view, onSubmit, onCancel, user: userEvent.setup() };
}

describe("ลำดับ Tab = ลำดับ Siam ID", () => {
  it("เปิดหน้ามาโฟกัสช่องที่ 1 · Tab ไล่ 2–11 ตามลำดับ แล้วไปที่ปุ่มเพิ่มข้อมูล", async () => {
    const { user } = renderForm();
    expect(slot(1)).toHaveFocus();
    for (let n = 2; n <= 11; n++) {
      await user.tab();
      expect(slot(n)).toHaveFocus();
    }
    await user.tab();
    expect(screen.getByRole("button", { name: "เพิ่มข้อมูล" })).toHaveFocus();
  });

  it("หน้าแก้ไขที่มีทั้งรูปเดิม รูปใหม่ และ error 409 — ลำดับไม่เปลี่ยน ไม่มีอะไรแทรก", async () => {
    const existing = new Blob([new Uint8Array([1])], { type: "image/png" });
    const { user, onSubmit, container } = renderForm({
      mode: "edit",
      autoFocus: false,
      defaultValues: toFormValues(CUSTOMER_DETAIL),
      existingPhoto: existing,
    });
    onSubmit.mockRejectedValueOnce(
      new ApiError(409, "มีลูกค้าเลขบัตรนี้อยู่แล้ว", "national_id", { existing_id: OTHER_CUSTOMER_ID }),
    );
    pasteImage(slot(9), pngFile());
    await user.keyboard("{Control>}{Enter}{/Control}");
    await screen.findByText(/มีลูกค้าเลขบัตรนี้อยู่แล้ว/);
    expect(document.body).not.toHaveFocus();

    // ไล่จากต้นหน้า: ช่อง 1–11 แล้วปุ่มบันทึก — ปุ่ม/ลิงก์อื่นที่อยู่ระหว่างทาง (อ่านบัตรใหม่ ฯลฯ) ถูกข้ามหมด
    slot(1).blur();
    await user.tab();
    for (let n = 1; n <= 11; n++) {
      expect(slot(n)).toHaveFocus();
      await user.tab();
    }
    expect(screen.getByRole("button", { name: "บันทึกการแก้ไข" })).toHaveFocus();

    const form = container.querySelector("form");
    if (!form) throw new Error("no form");
    for (const button of form.querySelectorAll("button")) expect(button).toHaveAttribute("type", "button");
    for (const el of form.querySelectorAll<HTMLElement>("[tabindex]")) expect(el.tabIndex).toBeLessThanOrEqual(0);

    // ทุก element ที่โฟกัสได้ก่อนปุ่มบันทึกซึ่งไม่ใช่ 11 ช่อง ต้อง tabIndex −1
    const slots = new Set(Array.from({ length: 11 }, (_, i) => slot(i + 1)));
    const save = screen.getByRole("button", { name: "บันทึกการแก้ไข" });
    const focusable = form.querySelectorAll<HTMLElement>("a[href], button, input, textarea, select, [tabindex]");
    for (const el of focusable) {
      if (el === save) break;
      if (!slots.has(el)) expect(el.tabIndex, el.outerHTML.slice(0, 80)).toBe(-1);
    }
    expect(within(form).getAllByRole("link", { name: "เปิดข้อมูลลูกค้าเดิม" })[0]).toHaveAttribute("tabindex", "-1");
  });

  it("ช่องข้อความเป็น input type=text (ที่อยู่เป็น textarea) · autocomplete off · ไม่มี maxlength/name", () => {
    renderForm();
    for (const n of [1, 2, 3, 4, 5, 7, 8, 10, 11]) {
      expect(slot(n).tagName).toBe("INPUT");
      expect(slot(n)).toHaveAttribute("type", "text");
    }
    expect(slot(6).tagName).toBe("TEXTAREA");
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 10, 11]) {
      expect(slot(n)).toHaveAttribute("autocomplete", "off");
      expect(slot(n)).not.toHaveAttribute("maxlength");
      expect(slot(n)).not.toHaveAttribute("name");
    }
    expect(slot(1)).toHaveAttribute("aria-required", "true");
    expect(slot(2)).toHaveAttribute("aria-required", "true");
  });
});

describe("จำลอง Siam ID", () => {
  it("พิมพ์ 8 ช่องคั่นด้วย Tab → วางรูป → เบอร์ 2 ช่อง → Ctrl+Enter ส่งครั้งเดียวด้วยค่าดิบ", async () => {
    const { user, onSubmit } = renderForm();
    await user.keyboard(
      "1103700123458{Tab}นายทดสอบ ระบบ{Tab}Mr. Test System{Tab}1 มกราคม 2530{Tab}พุทธ{Tab}" +
        "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น{Tab}01/01/2565{Tab}31/12/2600{Tab}",
    );
    expect(slot(9)).toHaveFocus();
    const photo = pngFile();
    pasteImage(slot(9), photo);
    expect(await screen.findByRole("img", { name: "รูปใหม่ที่วางไว้" })).toBeInTheDocument();

    await user.keyboard("{Tab}0812345678{Tab}021234567{Control>}{Enter}{/Control}");

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const values = onSubmit.mock.calls[0]?.[0];
    expect(values).toEqual({
      national_id: "1103700123458",
      name_th: "นายทดสอบ ระบบ",
      name_en: "Mr. Test System",
      birthday_text: "1 มกราคม 2530",
      religion: "พุทธ",
      address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
      card_issue_text: "01/01/2565",
      card_expire_text: "31/12/2600",
      photo,
      mobile: "0812345678",
      phone2: "021234567",
    });
    if (!values) throw new Error("no values");
    expect([...toCustomerFormData(values).keys()]).toEqual(PAYLOAD_ORDER);
  });

  it("Enter ไม่บันทึก — ทุกช่อง · ท้ายช่องที่ 8 (Siam ID บางรุ่น) · กรอบรูป · ปุ่มบันทึก", async () => {
    const { user, onSubmit } = renderForm();
    await user.keyboard("1103700123458{Enter}");
    expect(slot(1)).toHaveFocus();
    for (const n of [2, 3, 4, 5, 7, 8, 10, 11]) {
      await user.click(slot(n));
      await user.keyboard("ก{Enter}");
      expect(slot(n)).toHaveFocus();
    }
    await user.click(slot(8));
    await user.keyboard("31/12/2600{Enter}");
    expect(slot(8)).toHaveFocus();
    slot(9).focus();
    await user.keyboard("{Enter}");
    screen.getByRole("button", { name: "เพิ่มข้อมูล" }).focus();
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Enter ในที่อยู่ขึ้นบรรทัดใหม่", async () => {
    const { user, onSubmit } = renderForm();
    await user.click(slot(6));
    await user.keyboard("บ้านเลขที่ 1{Enter}ต.ในเมือง");
    expect(slot(6)).toHaveValue("บ้านเลขที่ 1\nต.ในเมือง");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter สองครั้งระหว่างกำลังส่ง = ส่งครั้งเดียว · ปุ่มบอกว่ากำลังบันทึก", async () => {
    let finish = () => {};
    const { user, onSubmit } = renderForm();
    onSubmit.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    await user.keyboard("1103700123458{Tab}นายทดสอบ ระบบ");
    await user.keyboard("{Control>}{Enter}{/Control}{Control>}{Enter}{/Control}");
    const busy = await screen.findByRole("button", { name: /กำลังบันทึก/ });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    await user.click(busy);
    expect(onSubmit).toHaveBeenCalledOnce();
    finish();
    expect(await screen.findByRole("button", { name: "เพิ่มข้อมูล" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("ตรวจหลังออกจากช่องเท่านั้น", () => {
  it("เลขบัตร 12 หลักไม่เตือนจนกว่าจะออกจากช่อง", async () => {
    const { user } = renderForm();
    await user.keyboard("110370012345");
    expect(screen.queryByText(/เลขบัตรประชาชนไม่ถูกต้อง/)).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText("เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก · ตรวจหลักสุดท้ายไม่ผ่าน)")).toBeInTheDocument();
    expect(slot(1)).toHaveAttribute("aria-invalid", "true");
  });

  it("ไม่กรอกชื่อแล้ว Ctrl+Enter → เตือนใต้ช่องชื่อและโฟกัสช่องนั้น ไม่ส่ง", async () => {
    const { user, onSubmit } = renderForm();
    await user.keyboard("1103700123458{Control>}{Enter}{/Control}");
    expect(await screen.findByText("กรุณากรอกชื่อ-นามสกุล")).toBeInTheDocument();
    expect(slot(2)).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("แก้เลขบัตรให้ถูกแล้ว Ctrl+Enter ได้เลยโดยไม่ต้องออกจากช่อง", async () => {
    const { user, onSubmit } = renderForm();
    await user.keyboard("110370012345{Tab}นายทดสอบ ระบบ");
    await user.click(slot(1));
    await user.keyboard("{End}8{Control>}{Enter}{/Control}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  });

  it.each([
    ["31/12/2600", "บัตรใช้ได้ถึง 31 ธันวาคม 2600"],
    ["1 มกราคม 2600", "บัตรใช้ได้ถึง 1 มกราคม 2600"],
    ["ตลอดชีพ", "บัตรตลอดชีพ"],
    ["01/01/2500", "บัตรประชาชนหมดอายุแล้ว — ซื้อเข้าไม่ได้จนกว่าจะแก้ไข"],
    ["abc", "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง — ซื้อเข้าไม่ได้จนกว่าจะแก้ไข (อ่านได้ เช่น 31/12/2574)"],
    ["", "ยังไม่ได้กรอกวันที่บัตรหมดอายุ — ซื้อเข้าไม่ได้จนกว่าจะแก้ไข"],
  ])("วันหมดอายุ %j → แจ้งสถานะบัตรหลังออกจากช่อง (ไม่บล็อกการบันทึก)", async (text, message) => {
    const { user } = renderForm();
    await user.click(slot(8));
    if (text) await user.keyboard(text);
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    await user.tab();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(slot(8)).not.toHaveAttribute("aria-invalid");
  });
});

describe("รูป (ช่องที่ 9)", () => {
  it("PDF และรูปใหญ่เกิน 5 MB → ข้อความเดียวกับ API ไม่ตั้งเป็นรูป", async () => {
    renderForm();
    pasteImage(slot(9), new File(["%PDF"], "scan.pdf", { type: "application/pdf" }));
    expect(await screen.findByText("รับเฉพาะรูป JPEG · PNG · WebP")).toBeInTheDocument();
    expect(slot(9)).toHaveAttribute("aria-invalid", "true");
    pasteImage(slot(9), new File([new Uint8Array(6 * 1024 * 1024)], "big.png", { type: "image/png" }));
    expect(await screen.findByText("รูปใหญ่เกิน 5 MB")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("คลิปบอร์ดไม่มีรูป → บอกให้คัดลอกรูปจาก Siam ID ก่อน", () => {
    renderForm();
    fireEvent.paste(slot(9), { clipboardData: { files: [], items: [], types: ["text/plain"], getData: () => "x" } });
    expect(screen.getByText(/คลิปบอร์ดไม่มีรูป/)).toBeInTheDocument();
  });

  it("วางรูปขณะโฟกัสอยู่ช่องเบอร์มือถือ (Siam ID Tab เกิน) → ได้รูป ค่าในช่องไม่เปลี่ยน", async () => {
    const { user } = renderForm();
    await user.click(slot(10));
    await user.keyboard("0812345678");
    pasteImage(slot(10), pngFile());
    expect(await screen.findByRole("img", { name: "รูปใหม่ที่วางไว้" })).toBeInTheDocument();
    expect(slot(10)).toHaveValue("0812345678");
  });

  it("วางข้อความในช่องข้อความเป็นปกติ", async () => {
    const { user } = renderForm();
    await user.click(slot(10));
    await user.paste("0899999999");
    expect(slot(10)).toHaveValue("0899999999");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("ปุ่มเลือกไฟล์ · Delete ที่กรอบเอารูปใหม่ออก", async () => {
    const { user } = renderForm();
    await user.upload(screen.getByTestId("photo-file"), pngFile("from-disk.png"));
    expect(await screen.findByRole("img", { name: "รูปใหม่ที่วางไว้" })).toBeInTheDocument();
    slot(9).focus();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("img", { name: "รูปใหม่ที่วางไว้" })).not.toBeInTheDocument();
  });
});

describe("error จากเซิร์ฟเวอร์", () => {
  async function typeValidCustomer(user: ReturnType<typeof userEvent.setup>) {
    await user.keyboard("1103700123458{Tab}นายทดสอบ ระบบ");
  }

  it("409 เลขบัตรซ้ำ → ใต้ช่องที่ 1 พร้อมลิงก์ลูกค้าเดิม (ไม่แทรก Tab) · โฟกัสช่องที่ 1 · พิมพ์แล้ว error หาย", async () => {
    const { user, onSubmit } = renderForm();
    onSubmit.mockRejectedValueOnce(
      new ApiError(409, "มีลูกค้าเลขบัตรนี้อยู่แล้ว", "national_id", {
        error: "มีลูกค้าเลขบัตรนี้อยู่แล้ว",
        field: "national_id",
        existing_id: OTHER_CUSTOMER_ID,
      }),
    );
    await typeValidCustomer(user);
    await user.keyboard("{Control>}{Enter}{/Control}");

    const error = await screen.findByText(/มีลูกค้าเลขบัตรนี้อยู่แล้ว/);
    expect(slot(1)).toHaveFocus();
    expect(slot(1)).toHaveAttribute("aria-describedby", expect.stringContaining(error.id));
    const [inline, inRow] = screen.getAllByRole("link", { name: "เปิดข้อมูลลูกค้าเดิม" });
    expect(inline).toHaveAttribute("href", `/customers/${OTHER_CUSTOMER_ID}`);
    expect(inline).toHaveAttribute("tabindex", "-1");
    // คีย์บอร์ดไปถึงลิงก์ได้จากแถวปุ่มท้ายฟอร์ม
    expect(inRow).not.toHaveAttribute("tabindex");

    await user.keyboard("1");
    expect(screen.queryByText(/มีลูกค้าเลขบัตรนี้อยู่แล้ว/)).not.toBeInTheDocument();
  });

  it("409 ที่ไม่มี existing_id → ข้อความอย่างเดียว", async () => {
    const { user, onSubmit } = renderForm();
    onSubmit.mockRejectedValueOnce(new ApiError(409, "มีลูกค้าเลขบัตรนี้อยู่แล้ว", "national_id", {}));
    await typeValidCustomer(user);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("มีลูกค้าเลขบัตรนี้อยู่แล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("400 ที่ชี้ช่องวันหมดอายุ → ใต้ช่องที่ 8 · 500 → ข้อความรวมท้ายฟอร์ม ข้อมูลยังอยู่", async () => {
    const { user, onSubmit } = renderForm();
    onSubmit
      .mockRejectedValueOnce(new ApiError(400, "มีอักขระที่ใช้ไม่ได้ (อักขระควบคุม)", "card_expire_text", {}))
      .mockRejectedValueOnce(new ApiError(500, "internal error", undefined, {}));
    await typeValidCustomer(user);
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText("มีอักขระที่ใช้ไม่ได้ (อักขระควบคุม)")).toBeInTheDocument();
    expect(slot(8)).toHaveFocus();
    expect(slot(8)).toHaveAttribute("aria-invalid", "true");

    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(await screen.findByText(/เซิร์ฟเวอร์ขัดข้อง/)).toBeInTheDocument();
    expect(screen.queryByText("มีอักขระที่ใช้ไม่ได้ (อักขระควบคุม)")).not.toBeInTheDocument();
    expect(slot(2)).toHaveValue("นายทดสอบ ระบบ");
  });
});

describe("อ่านบัตรใหม่ (หน้าแก้ไข)", () => {
  it("ล้างช่อง 1–8 และรูปใหม่ โฟกัสช่องที่ 1 · เบอร์โทรยังอยู่ · หน้าแก้ไขไม่โฟกัสเอง", async () => {
    const { user } = renderForm({ mode: "edit", autoFocus: false, defaultValues: toFormValues(CUSTOMER_DETAIL) });
    expect(slot(1)).not.toHaveFocus();
    pasteImage(slot(9), pngFile());
    await screen.findByRole("img", { name: "รูปใหม่ที่วางไว้" });

    await user.click(screen.getByRole("button", { name: /อ่านบัตรใหม่/ }));

    for (let n = 1; n <= 8; n++) expect(slot(n)).toHaveValue("");
    expect(screen.queryByRole("img", { name: "รูปใหม่ที่วางไว้" })).not.toBeInTheDocument();
    expect(slot(10)).toHaveValue(CUSTOMER_DETAIL.mobile);
    expect(slot(1)).toHaveFocus();
  });

  it("ยกเลิก", async () => {
    const { user, onCancel } = renderForm();
    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("กันข้อมูลหาย", () => {
  it("มีข้อมูลที่ยังไม่บันทึก → เตือนก่อนปิด/รีโหลดแท็บ", async () => {
    const { user } = renderForm();
    const unload = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await user.keyboard("1");
    expect(unload()).toBe(true);
  });
});
