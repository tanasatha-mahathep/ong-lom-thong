import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/queries";
import { BRANCHES, BRANCH_2, BRANCH_2_ID, HQ, HQ_ID, shellFor } from "@/test/admin";
import { fakeApi, json, renderApp } from "@/test/app";

// ทุกเทสต์โหลดทั้งแอป (router + route chunk) — เครื่องที่รันเทสต์ขนานหนัก ๆ ช้าได้ · เพดานเท่านั้น
configure({ asyncUtilTimeout: 10_000 });
// เพดานต่อเทสต์: หลายขั้น (เปิดฟอร์ม → กรอก → บันทึก → dialog) ที่ load 40+ เกิน 15 วินาทีได้ — เทสต์ที่ผ่านไม่ช้าลง
vi.setConfig({ testTimeout: 45_000 });

/** กรอกทั้งข้อความในครั้งเดียว (เร็วกว่าพิมพ์ทีละตัวบนเครื่องที่โหลดหนัก) — ช่องที่ไม่ได้ทดสอบการพิมพ์ทีละตัว */
async function fill(user: UserEvent, element: HTMLElement, text: string) {
  await user.click(element);
  await user.paste(text);
}

const LIST = "GET /api/admin/branches";
type Routes = Parameters<typeof fakeApi>[0];

async function openAsAdmin(routes: Routes = {}) {
  const api = fakeApi({ ...shellFor("admin"), [LIST]: () => json({ items: BRANCHES }), ...routes });
  renderApp("/settings/branches");
  await screen.findByRole("button", { name: `${HQ.name} — แก้ไข` });
  return { api, user: userEvent.setup() };
}

/** แถวข้อมูลของตาราง (ไม่รวมหัวตาราง) */
function dataRows() {
  const [, ...rows] = within(screen.getByRole("table", { name: "สาขาทั้งหมด รวมสาขาที่ปิดแล้ว" })).getAllByRole("row");
  return rows;
}

describe("/settings/branches — สิทธิ์", () => {
  it.each<Role>(["staff", "manager", "accounting"])(
    "%s เปิด URL ตรง ๆ → “ต้องเป็นผู้ดูแลระบบ” และไม่ยิง API ของผู้ดูแล",
    async (role) => {
      const api = fakeApi(shellFor(role));
      renderApp("/settings/branches");

      expect(await screen.findByText("ต้องเป็นผู้ดูแลระบบ")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1, name: "จัดการสาขา" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "เพิ่มสาขา" })).not.toBeInTheDocument();
      expect(api.calls.some((call) => call.path.startsWith("/api/admin"))).toBe(false);
    },
  );

  it("API ตอบ 403 (ถูกลดสิทธิ์ระหว่างเปิดหน้า) → ข้อความเดียวกัน ไม่ใช่ error ทั่วไป", async () => {
    fakeApi({ ...shellFor("admin"), [LIST]: () => json({ error: "forbidden" }, 403) });
    renderApp("/settings/branches");

    expect(await screen.findByText("ต้องเป็นผู้ดูแลระบบ")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เพิ่มสาขา" })).not.toBeInTheDocument();
  });
});

describe("/settings/branches — รายการ", () => {
  it("รหัส · สาขาตามสรรพากร (รหัส + ป้ายบนใบ) · อักษรนำ · สถานะ · มีบิล", async () => {
    await openAsAdmin();
    const [hq, second, closed] = dataRows();

    expect(hq).toHaveTextContent("00000 · สำนักงานใหญ่");
    expect(hq).toHaveTextContent("เปิดอยู่");
    expect(hq).toHaveTextContent("มีบิลแล้ว");
    expect(second).toHaveTextContent("00001 · สาขาที่ 00001");
    expect(second).toHaveTextContent("PT");
    expect(second).toHaveTextContent("ยังไม่มี");
    expect(closed).toHaveTextContent("ยังไม่ได้ตั้ง — ออกใบรับซื้อไม่ได้");
    expect(closed).toHaveTextContent("ปิดแล้ว");
  });
});

describe("/settings/branches — เพิ่มสาขา", () => {
  it("ส่งค่าตามที่กรอก (ช่องว่าง = null · อักษรนำตัวพิมพ์ใหญ่ · ลำดับต่อท้าย) → toast + ตารางอ่านใหม่ + โฟกัสกลับปุ่มเพิ่ม", async () => {
    const created = {
      ...BRANCH_2,
      id: "44444444-4444-4444-8444-444444444444",
      code: "00003",
      name: "สาขาทดสอบ 3",
      tax_branch_code: "00003",
      tax_branch_label: "สาขาที่ 00003",
      doc_prefix: "AB",
      sort_order: 3,
    };
    const { api, user } = await openAsAdmin({ "POST /api/admin/branches": () => json({ branch: created }, 201) });

    await user.click(screen.getByRole("button", { name: "เพิ่มสาขา" }));
    const sheet = await screen.findByRole("dialog", { name: "เพิ่มสาขา" });
    const code = within(sheet).getByLabelText("รหัสสาขา");
    await waitFor(() => expect(code).toHaveFocus());
    await user.type(code, "00003");
    await fill(user, within(sheet).getByLabelText("ชื่อสาขา"), "สาขาทดสอบ 3");
    await user.type(within(sheet).getByLabelText("รหัสสาขาตามสรรพากร"), "00003");
    const prefix = within(sheet).getByLabelText("อักษรนำเลขที่บิล");
    await user.type(prefix, "ab");
    expect(prefix).toHaveValue("AB");
    expect(prefix).toHaveAccessibleDescription("เลขที่บิลของสาขานี้จะขึ้นต้นด้วย AB-RC…");
    expect(within(sheet).getByLabelText("ลำดับการแสดง")).toHaveValue("3");
    await user.click(within(sheet).getByRole("button", { name: "เพิ่มสาขา" }));

    expect(await screen.findByText("เพิ่มสาขา สาขาทดสอบ 3 แล้ว")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/admin/branches").map((call) => call.body)).toEqual([
      {
        code: "00003",
        name: "สาขาทดสอบ 3",
        short_name: null,
        tax_branch_code: "00003",
        address: null,
        tel: null,
        doc_prefix: "AB",
        sort_order: 3,
        is_active: true,
      },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.callsTo("GET", "/api/admin/branches").length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(screen.getByRole("button", { name: "เพิ่มสาขา" })).toHaveFocus());
  });

  it("409 สำนักงานใหญ่ซ้ำ (00000) → ข้อความของ API ใต้ช่องรหัสสรรพากร · โฟกัสช่องนั้น · ฟอร์มยังเปิด (Ctrl+Enter บันทึก)", async () => {
    const conflict = {
      error: `มีสำนักงานใหญ่ (รหัสสรรพากร 00000) แล้ว คือสาขา 00000 ${HQ.name} — ร้านมีสำนักงานใหญ่ได้แห่งเดียว`,
      field: "tax_branch_code",
    };
    const { api, user } = await openAsAdmin({ "POST /api/admin/branches": () => json(conflict, 409) });

    await user.click(screen.getByRole("button", { name: "เพิ่มสาขา" }));
    const sheet = await screen.findByRole("dialog", { name: "เพิ่มสาขา" });
    await user.type(within(sheet).getByLabelText("รหัสสาขา"), "00003");
    await fill(user, within(sheet).getByLabelText("ชื่อสาขา"), "สาขาทดสอบ 3");
    const tax = within(sheet).getByLabelText("รหัสสาขาตามสรรพากร");
    await user.type(tax, "00000");
    await user.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => expect(tax).toHaveAttribute("aria-invalid", "true"));
    expect(tax).toHaveAccessibleDescription(expect.stringContaining(conflict.error));
    expect(tax).toHaveFocus();
    expect(api.callsTo("POST", "/api/admin/branches")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "เพิ่มสาขา" })).toBeInTheDocument();

    // แก้ช่องนั้นแล้ว error ของ API หายทันที
    await user.clear(tax);
    await user.type(tax, "00003");
    expect(tax).not.toHaveAttribute("aria-invalid");
  });

  it("ตรวจก่อนส่ง: รหัส 5 หลัก · ชื่อสาขา — ไม่ยิง API และโฟกัสช่องแรกที่ผิด", async () => {
    const { api, user } = await openAsAdmin();

    await user.click(screen.getByRole("button", { name: "เพิ่มสาขา" }));
    const sheet = await screen.findByRole("dialog", { name: "เพิ่มสาขา" });
    const code = within(sheet).getByLabelText("รหัสสาขา");
    await user.type(code, "12");
    await user.click(within(sheet).getByRole("button", { name: "เพิ่มสาขา" }));

    await waitFor(() =>
      expect(code).toHaveAccessibleDescription(expect.stringContaining("รหัสสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00001")),
    );
    expect(code).toHaveFocus();
    expect(within(sheet).getByLabelText("ชื่อสาขา")).toHaveAccessibleDescription("กรุณากรอกชื่อสาขา");
    expect(api.callsTo("POST", "/api/admin/branches")).toHaveLength(0);
  });
});

describe("/settings/branches — แก้สาขา", () => {
  it("รหัสแก้ไม่ได้ · อักษรนำปิดเมื่อมีบิล (ไม่ส่ง code/doc_prefix) · 400 ชี้ช่อง → ใต้ช่องนั้น แล้วบันทึกซ้ำได้", async () => {
    let attempt = 0;
    const { api, user } = await openAsAdmin({
      [`PUT /api/admin/branches/${HQ_ID}`]: () =>
        ++attempt === 1
          ? json({ error: "ที่อยู่ยาวเกิน 500 ตัวอักษร", field: "address" }, 400)
          : json({ branch: { ...HQ, tel: "02-111-1111" }, affected_users: [] }),
    });

    await user.click(screen.getByRole("button", { name: `${HQ.name} — แก้ไข` }));
    const sheet = await screen.findByRole("dialog", { name: "แก้ไขสาขา 00000" });
    await waitFor(() => expect(within(sheet).getByLabelText("ชื่อสาขา")).toHaveFocus());
    const code = within(sheet).getByLabelText("รหัสสาขา");
    expect(code).toHaveValue("00000");
    expect(code).toHaveAttribute("readonly");
    expect(code).toHaveAccessibleDescription(expect.stringContaining("รหัสสาขาแก้ไม่ได้"));
    const prefix = within(sheet).getByLabelText("อักษรนำเลขที่บิล");
    expect(prefix).toHaveAttribute("readonly");
    expect(prefix).toHaveAccessibleDescription(expect.stringContaining("สาขานี้มีบิลแล้ว"));

    const tel = within(sheet).getByLabelText("เบอร์โทร");
    await user.clear(tel);
    await fill(user, tel, "02-111-1111");
    await user.click(within(sheet).getByRole("button", { name: "บันทึกการแก้ไข" }));

    const address = within(sheet).getByLabelText("ที่อยู่");
    await waitFor(() =>
      expect(address).toHaveAccessibleDescription(expect.stringContaining("ที่อยู่ยาวเกิน 500 ตัวอักษร")),
    );
    expect(address).toHaveFocus();

    await user.click(within(sheet).getByRole("button", { name: "บันทึกการแก้ไข" }));
    expect(await screen.findByText(`บันทึกสาขา ${HQ.name} แล้ว`)).toBeInTheDocument();
    const bodies = api.callsTo("PUT", `/api/admin/branches/${HQ_ID}`).map((call) => call.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual({
      name: HQ.name,
      short_name: HQ.short_name,
      tax_branch_code: "00000",
      address: HQ.address,
      tel: "02-111-1111",
      sort_order: 0,
      is_active: true,
    });
  });

  it("ปิดสาขาที่มีบิล → ยืนยันก่อน · ยกเลิก = ไม่ส่ง · ยืนยัน = ส่ง is_active false + แจ้งผู้ใช้ที่ยังผูกอยู่", async () => {
    const affected = [
      {
        id: "u-staff-1",
        email: "tester-staff@local.test",
        name: "สมชาย ทดสอบ",
        role: "staff",
        via: "main",
        becomes_branchless: true,
      },
    ];
    const { api, user } = await openAsAdmin({
      [`PUT /api/admin/branches/${HQ_ID}`]: () =>
        json({ branch: { ...HQ, is_active: false }, affected_users: affected }),
    });
    const puts = () => api.callsTo("PUT", `/api/admin/branches/${HQ_ID}`);

    await user.click(screen.getByRole("button", { name: `${HQ.name} — แก้ไข` }));
    const sheet = await screen.findByRole("dialog", { name: "แก้ไขสาขา 00000" });
    await user.click(within(sheet).getByRole("checkbox", { name: "เปิดใช้งานสาขา" }));
    const save = within(sheet).getByRole("button", { name: "บันทึกการแก้ไข" });
    await user.click(save);

    let confirm = await screen.findByRole("alertdialog", { name: `ปิดสาขา ${HQ.name}?` });
    expect(confirm).toHaveAccessibleDescription(
      expect.stringContaining("บิลและใบรับซื้อเดิมยังเปิดดูและดาวน์โหลดได้ตามปกติ"),
    );
    // ปุ่มปลอดภัยได้โฟกัสก่อน — Enter ซ้ำโดยไม่ได้อ่านไม่ปิดสาขา
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "กลับไปแก้ไข" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(puts()).toHaveLength(0);
    await waitFor(() => expect(save).toHaveFocus());

    await user.click(save);
    confirm = await screen.findByRole("alertdialog", { name: `ปิดสาขา ${HQ.name}?` });
    await user.click(within(confirm).getByRole("button", { name: "ปิดสาขา" }));

    expect(await screen.findByText(`ปิดสาขา ${HQ.name} แล้ว — ยังมีผู้ใช้ 1 คนผูกกับสาขานี้`)).toBeInTheDocument();
    expect(puts().map((call) => call.body)).toEqual([expect.objectContaining({ is_active: false })]);
    expect(screen.getByText("สมชาย ทดสอบ (tester-staff@local.test) · สาขาหลัก")).toBeInTheDocument();
    expect(screen.getByText("ไม่เหลือสาขาที่ทำงานได้ — ต้องผูกสาขาใหม่")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "จัดการผู้ใช้ของสาขานี้" })).toHaveAttribute(
      "href",
      `/settings/users?branch=${HQ_ID}`,
    );
  });

  it("ปิดสาขาที่ยังไม่มีบิล → บันทึกเลย · อักษรนำยังแก้ได้ (ส่ง doc_prefix)", async () => {
    const { api, user } = await openAsAdmin({
      [`PUT /api/admin/branches/${BRANCH_2_ID}`]: () =>
        json({ branch: { ...BRANCH_2, is_active: false, doc_prefix: "PK" }, affected_users: [] }),
    });

    await user.click(screen.getByRole("button", { name: `${BRANCH_2.name} — แก้ไข` }));
    const sheet = await screen.findByRole("dialog", { name: "แก้ไขสาขา 00001" });
    const prefix = within(sheet).getByLabelText("อักษรนำเลขที่บิล");
    expect(prefix).not.toHaveAttribute("readonly");
    await user.clear(prefix);
    await user.type(prefix, "pk");
    await user.click(within(sheet).getByRole("checkbox", { name: "เปิดใช้งานสาขา" }));
    await user.click(within(sheet).getByRole("button", { name: "บันทึกการแก้ไข" }));

    expect(await screen.findByText(`บันทึกสาขา ${BRANCH_2.name} แล้ว`)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.callsTo("PUT", `/api/admin/branches/${BRANCH_2_ID}`).map((call) => call.body)).toEqual([
      expect.objectContaining({ is_active: false, doc_prefix: "PK" }),
    ]);
    expect(screen.queryByText(/ยังมีผู้ใช้/)).not.toBeInTheDocument();
  });
});
