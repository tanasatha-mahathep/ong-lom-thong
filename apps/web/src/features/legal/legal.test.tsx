import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { setLanguage } from "@/i18n";
import { fakeApi, json, renderApp } from "@/test/app";
import en from "./content/en";
import th from "./content/th";
import type { LegalDocument } from "./content/types";
import { LEGAL_CONFIG, LEGAL_IS_DRAFT, fillLegal, isPlaceholder } from "./legal-config";

async function renderLogin() {
  fakeApi({ "GET /api/me": () => json({ error: "unauthorized" }, 401) });
  renderApp("/login");
  await screen.findByRole("heading", { level: 1 });
  return userEvent.setup();
}

const textsOf = (doc: LegalDocument) => [
  doc.title,
  doc.subtitle,
  ...doc.sections.flatMap((s) => [s.heading, ...s.body.flatMap((b) => (typeof b === "string" ? [b] : b.list))]),
];

describe("ข้อกำหนดการใช้บริการ · นโยบายความเป็นส่วนตัว บนหน้า login", () => {
  it("ประโยคยอมรับใต้ปุ่มเข้าสู่ระบบ — สองวลีเป็นปุ่มเปิดกล่อง", async () => {
    await renderLogin();
    const terms = screen.getByRole("button", { name: "ข้อกำหนดการใช้บริการ" });
    const privacy = screen.getByRole("button", { name: "นโยบายความเป็นส่วนตัว" });
    expect(terms.parentElement).toHaveTextContent(
      "การคลิกเข้าใช้งานถือว่าคุณยอมรับ ข้อกำหนดการใช้บริการ และ นโยบายความเป็นส่วนตัว",
    );
    expect(terms).toHaveAttribute("type", "button");
    expect(privacy).toHaveAttribute("type", "button");
  });

  it("เปิดข้อกำหนด → หัวเรื่อง · คำอธิบาย · เนื้อหาเลื่อนได้ · ป้ายฉบับร่าง · Esc ปิดแล้วโฟกัสกลับที่ลิงก์", async () => {
    const user = await renderLogin();
    const trigger = screen.getByRole("button", { name: "ข้อกำหนดการใช้บริการ" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "ข้อกำหนดการใช้บริการ" });
    expect(await within(dialog).findByRole("heading", { name: "1. ขอบเขตและการยอมรับ" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "6. การตรวจสอบและบันทึกการใช้งาน" })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(/ฉบับที่ 0\.1/);
    expect(within(dialog).getByRole("note")).toHaveTextContent("ฉบับร่าง — รอตรวจสอบโดยที่ปรึกษากฎหมาย");
    const region = within(dialog).getByRole("region", { name: "ข้อกำหนดการใช้บริการ" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-y-auto");
    expect(within(dialog).getByRole("button", { name: "ปิด" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("นโยบายความเป็นส่วนตัว: PDPA · ส่งข้อมูลไปสิงคโปร์ · สิทธิร้องเรียน สคส. · ช่องที่ยังไม่กรอกแสดงเป็น [ … ]", async () => {
    const user = await renderLogin();
    await user.click(screen.getByRole("button", { name: "นโยบายความเป็นส่วนตัว" }));
    const dialog = await screen.findByRole("dialog", { name: "นโยบายความเป็นส่วนตัว" });
    expect(
      await within(dialog).findByRole("heading", { name: "7. การส่งหรือโอนข้อมูลไปต่างประเทศ" }),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent("สิงคโปร์");
    expect(dialog).toHaveTextContent("สำนักงานคณะกรรมการคุ้มครองข้อมูลส่วนบุคคล");
    expect(dialog).toHaveTextContent("[ชื่อนิติบุคคล — ต้องกรอก]");
    expect(within(dialog).getByRole("note")).toBeInTheDocument();
  });

  it("ภาษาอังกฤษ: ประโยคยอมรับ · Terms of Use · Privacy Notice · ป้าย Draft", async () => {
    const user = await renderLogin();
    await act(() => setLanguage("en"));
    await user.click(await screen.findByRole("button", { name: "Terms of Use" }));
    const terms = await screen.findByRole("dialog", { name: "Terms of Use" });
    expect(await within(terms).findByRole("heading", { name: "1. Scope and acceptance" })).toBeInTheDocument();
    expect(within(terms).getByRole("note")).toHaveTextContent("Draft — pending legal review");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Privacy Notice" }));
    const privacy = await screen.findByRole("dialog", { name: "Privacy Notice" });
    expect(await within(privacy).findByRole("heading", { name: "10. Your rights" })).toBeInTheDocument();
    expect(privacy).toHaveTextContent("[Company legal name — to be completed]");
  });
});

describe("legal-config · เนื้อหา", () => {
  it("ยังมีช่องที่ต้องกรอก = ฉบับร่าง · ค่าที่กรอกแล้วแทนในเนื้อหา", () => {
    expect(LEGAL_IS_DRAFT).toBe(true);
    expect(isPlaceholder(LEGAL_CONFIG.companyName.th)).toBe(true);
    expect(fillLegal("ฉบับที่ {{version}} · {{unknown}}", "th")).toBe("ฉบับที่ 0.1 · {{unknown}}");
    expect(fillLegal("{{companyName}}", "en")).toBe(LEGAL_CONFIG.companyName.en);
  });

  it.each(["terms", "privacy"] as const)("%s: ไทยและอังกฤษมีหัวข้อตรงกันทุกข้อ · ตัวแปรทุกตัวอยู่ใน config", (key) => {
    const thDoc = th[key];
    const enDoc = en[key];
    expect(enDoc.sections.map((s) => s.heading.split(".")[0])).toEqual(
      thDoc.sections.map((s) => s.heading.split(".")[0]),
    );
    expect(enDoc.sections.map((s) => s.body.length)).toEqual(thDoc.sections.map((s) => s.body.length));
    for (const [doc, lang] of [
      [thDoc, "th"],
      [enDoc, "en"],
    ] as const) {
      for (const text of textsOf(doc)) expect(fillLegal(text, lang)).not.toMatch(/\{\{\w+\}\}/);
    }
  });
});
