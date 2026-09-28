import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AdminUser } from "@/features/settings/api";
import type { Role } from "@/lib/queries";
import {
  BRANCHES,
  BRANCH_2,
  BRANCH_2_ID,
  HQ,
  HQ_ID,
  INACTIVE_MANAGER,
  ME_ADMIN,
  STAFF,
  USERS,
  shellFor,
} from "@/test/admin";
import { fakeApi, json, renderApp } from "@/test/app";

// เพดานต่อเทสต์ (ค่ากลาง 30 วินาที): หลายขั้น (เปิดฟอร์ม → กรอก → บันทึก → dialog) ทั้งแอปที่ load 50+ เกินได้
// เพดานเท่านั้น — เทสต์ที่ผ่านไม่ช้าลง
vi.setConfig({ testTimeout: 45_000 });

/** กรอกทั้งข้อความในครั้งเดียว (เร็วกว่าพิมพ์ทีละตัวบนเครื่องที่โหลดหนัก) — ช่องที่ไม่ได้ทดสอบการพิมพ์ทีละตัว */
async function fill(user: UserEvent, element: HTMLElement, text: string) {
  await user.click(element);
  await user.paste(text);
}

const USERS_PATH = "/api/admin/users";
type Routes = Parameters<typeof fakeApi>[0];
const listed =
  (items: AdminUser[] = USERS) =>
  () =>
    json({ items });

const baseRoutes = (): Routes => ({
  ...shellFor("admin"),
  "GET /api/admin/branches": () => json({ items: BRANCHES }),
  [`GET ${USERS_PATH}`]: listed(),
});

async function openUsers(routes: Routes = {}, path = "/settings/users") {
  const api = fakeApi({ ...baseRoutes(), ...routes });
  const router = renderApp(path);
  await screen.findByRole("button", { name: `${ME_ADMIN.name} — แก้ไข` });
  return { api, router, user: userEvent.setup() };
}

const rowOf = (name: string) => screen.getByRole("button", { name: `${name} — แก้ไข` }).closest("tr");

const NEW_USER: AdminUser = {
  ...STAFF,
  id: "u-new",
  email: "tester-new@local.test",
  name: "ผู้ใช้ทดสอบใหม่",
  role: "manager",
  branch: { id: BRANCH_2_ID, code: BRANCH_2.code, name: BRANCH_2.name },
  allowed_branches: [{ id: HQ_ID, code: HQ.code, name: HQ.name }],
};

describe("/settings/users — สิทธิ์", () => {
  it.each<Role>(["staff", "manager", "accounting"])(
    "%s เปิด URL ตรง ๆ → “ต้องเป็นผู้ดูแลระบบ” และไม่ยิง API ของผู้ดูแล",
    async (role) => {
      const api = fakeApi(shellFor(role));
      renderApp("/settings/users?role=admin");

      expect(await screen.findByText("ต้องเป็นผู้ดูแลระบบ")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1, name: "จัดการผู้ใช้" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "เพิ่มผู้ใช้" })).not.toBeInTheDocument();
      expect(api.calls.some((call) => call.path.startsWith("/api/admin"))).toBe(false);
    },
  );

  it("API ตอบ 403 → ข้อความ “ต้องเป็นผู้ดูแลระบบ” แทนตาราง", async () => {
    fakeApi({ ...baseRoutes(), [`GET ${USERS_PATH}`]: () => json({ error: "forbidden" }, 403) });
    renderApp("/settings/users");

    expect(await screen.findByText("ต้องเป็นผู้ดูแลระบบ")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("/settings/users — รายการและตัวกรอง", () => {
  it("บทบาทภาษาไทย · สาขาหลัก/ที่อนุญาต (สาขาที่ปิดมีป้าย) · ทำงานได้ทุกสาขา · สถานะ · ป้าย “คุณ” · คลิกแถว = แก้ไข", async () => {
    const { user } = await openUsers();
    expect(screen.getByRole("table", { name: "รายชื่อผู้ใช้" })).toBeInTheDocument();

    const me = rowOf(ME_ADMIN.name);
    expect(me).toHaveTextContent("คุณ");
    expect(me).toHaveTextContent("ผู้ดูแลระบบ");
    expect(me).toHaveTextContent("ใช่");
    const staff = rowOf(STAFF.name);
    expect(staff).toHaveTextContent("พนักงาน");
    expect(staff).toHaveTextContent("00001 สาขาทดสอบ 2");
    expect(staff).toHaveTextContent("00002 สาขาทดสอบปิด (ปิดแล้ว)");
    expect(staff).toHaveTextContent("ใช้งานอยู่");
    expect(staff).not.toHaveTextContent("คุณ");
    const old = rowOf(INACTIVE_MANAGER.name);
    expect(old).toHaveTextContent("ผู้จัดการ");
    expect(old).toHaveTextContent("ปิดแล้ว");

    // คลิกที่แถว (เมาส์) = ทางลัดเปิดฟอร์มแก้ไข · ปิดแล้วโฟกัสกลับปุ่มชื่อของแถวนั้น
    await user.click(screen.getByText(STAFF.email));
    const sheet = await screen.findByRole("dialog", { name: "แก้ไขผู้ใช้" });
    expect(within(sheet).getByLabelText("อีเมล")).toHaveValue(STAFF.email);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: `${STAFF.name} — แก้ไข` })).toHaveFocus());
  });

  it("ตัวกรอง → URL (q · สาขา · บทบาท · สถานะ) และ API ได้ตัวกรองเดียวกัน · ล้างตัวกรอง", async () => {
    const filtered = `${USERS_PATH}?q=tester-staff&branch_id=${BRANCH_2_ID}&role=staff`;
    const { api, router, user } = await openUsers({
      [`GET ${USERS_PATH}?q=tester-staff`]: listed([STAFF]),
      [`GET ${USERS_PATH}?q=tester-staff&role=staff`]: listed([STAFF]),
      [`GET ${filtered}`]: listed([STAFF]),
      [`GET ${filtered}&active=true`]: listed([STAFF]),
    });
    const paths = () => api.calls.map((call) => call.path);

    await user.type(screen.getByLabelText("ค้นหา"), "tester-staff");
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "tester-staff" }));
    await waitFor(() => expect(paths()).toContain(`${USERS_PATH}?q=tester-staff`));

    await user.selectOptions(screen.getByLabelText("บทบาท"), "staff");
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "tester-staff", role: "staff" }));
    await user.selectOptions(screen.getByLabelText("สาขา"), BRANCH_2_ID);
    await user.selectOptions(screen.getByLabelText("สถานะ"), "true");
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        q: "tester-staff",
        role: "staff",
        branch: BRANCH_2_ID,
        active: true,
      }),
    );
    await waitFor(() => expect(paths()).toContain(`${filtered}&active=true`));
    expect(await screen.findByRole("table", { name: "รายชื่อผู้ใช้ตามตัวกรอง" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: `${ME_ADMIN.name} — แก้ไข` })).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "ล้างตัวกรอง" }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.getByLabelText("ค้นหา")).toHaveValue("");
    expect(screen.getByLabelText("บทบาท")).toHaveValue("");
    expect(await screen.findByRole("button", { name: `${ME_ADMIN.name} — แก้ไข` })).toBeInTheDocument();
  });

  it("เปิดลิงก์ที่มีตัวกรอง (เช่น จากหน้าสาขา) → ช่องกรองตาม URL · ค่าผิดรูปไม่กรอง", async () => {
    const api = fakeApi({
      ...baseRoutes(),
      [`GET ${USERS_PATH}?branch_id=${HQ_ID}&active=false`]: listed([INACTIVE_MANAGER]),
    });
    renderApp(`/settings/users?branch=${HQ_ID}&role=boss&active=false`);

    expect(await screen.findByRole("button", { name: `${INACTIVE_MANAGER.name} — แก้ไข` })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("สาขา")).toHaveValue(HQ_ID));
    expect(screen.getByLabelText("บทบาท")).toHaveValue("");
    expect(screen.getByLabelText("สถานะ")).toHaveValue("false");
    expect(api.calls.map((call) => call.path)).toContain(`${USERS_PATH}?branch_id=${HQ_ID}&active=false`);
    expect(api.calls.some((call) => call.path.includes("role="))).toBe(false);
  });
});

describe("/settings/users — เพิ่มผู้ใช้", () => {
  it("ไม่ตั้งรหัส → รหัสชั่วคราวแสดงครั้งเดียว · คัดลอกได้ · ปิดแล้วหายจากจอ แคช storage และ log", async () => {
    const TEMP = "Tmp7xQ9rZk2mWp4VhN8c";
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
    const { api, router, user } = await openUsers({
      [`POST ${USERS_PATH}`]: () => json({ user: NEW_USER, temporary_password: TEMP }, 201),
    });

    await user.click(screen.getByRole("button", { name: "เพิ่มผู้ใช้" }));
    const sheet = await screen.findByRole("dialog", { name: "เพิ่มผู้ใช้" });
    const name = within(sheet).getByLabelText("ชื่อ");
    await waitFor(() => expect(name).toHaveFocus());
    expect(within(sheet).getByText(/ยังไม่ได้ผูกสาขา/)).toBeInTheDocument();
    await fill(user, name, NEW_USER.name);
    await fill(user, within(sheet).getByLabelText("อีเมล"), NEW_USER.email);
    await user.click(within(sheet).getByRole("radio", { name: "ผู้จัดการ" }));
    await user.selectOptions(within(sheet).getByLabelText("สาขาหลัก"), BRANCH_2_ID);
    // สาขาหลักติ๊กไว้และปิดในรายการสาขาที่อนุญาต · สาขาที่ปิดแล้วไม่อยู่ในรายการ
    const mainBox = within(sheet).getByRole("checkbox", { name: "00001 สาขาทดสอบ 2" });
    expect(mainBox).toBeChecked();
    expect(mainBox).toBeDisabled();
    expect(within(sheet).queryByRole("checkbox", { name: "00002 สาขาทดสอบปิด" })).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/ยังไม่ได้ผูกสาขา/)).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("checkbox", { name: "00000 สำนักงานใหญ่ทดสอบ" }));
    await user.click(within(sheet).getByRole("button", { name: "เพิ่มผู้ใช้" }));

    const dialog = await screen.findByRole("alertdialog", { name: `รหัสผ่านชั่วคราวของ ${NEW_USER.name}` });
    expect(api.callsTo("POST", USERS_PATH).map((call) => call.body)).toEqual([
      {
        email: NEW_USER.email,
        name: NEW_USER.name,
        role: "manager",
        branch_id: BRANCH_2_ID,
        allowed_branch_ids: [HQ_ID],
        can_view_all: false,
      },
    ]);
    expect(within(dialog).getByText("แสดงครั้งเดียว — ส่งให้ผู้ใช้ทางช่องทางที่ปลอดภัย")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("รหัสผ่านชั่วคราว")).toHaveValue(TEMP);
    const copy = within(dialog).getByRole("button", { name: "คัดลอกรหัสผ่าน" });
    await waitFor(() => expect(copy).toHaveFocus());

    await user.click(copy);
    expect(await navigator.clipboard.readText()).toBe(TEMP);
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("คัดลอกแล้ว"));
    // toast อยู่นอก dialog — ข้อความเดียวกันทั้งสองที่
    await waitFor(() => expect(screen.getAllByText("คัดลอกแล้ว")).toHaveLength(2));

    await user.click(within(dialog).getByRole("button", { name: "ปิด" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(TEMP)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(TEMP);
    await waitFor(() => expect(screen.getByRole("button", { name: "เพิ่มผู้ใช้" })).toHaveFocus());

    // ไม่เก็บที่ไหนเลย: query/mutation cache · localStorage/sessionStorage · console
    const { queryClient } = router.options.context;
    const cached = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      queryClient
        .getMutationCache()
        .getAll()
        .map((mutation) => [mutation.state.data, mutation.state.variables]),
    ]);
    expect(cached).not.toContain(TEMP);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(TEMP);
    for (const log of logs) expect(log.mock.calls.flat().map(String).join(" ")).not.toContain(TEMP);
  });

  it("ตั้งรหัสผ่านเอง → ไม่มีหน้าต่างรหัสชั่วคราว · ส่ง password · สั้นเกินเตือนก่อนส่ง", async () => {
    const { api, user } = await openUsers({
      [`POST ${USERS_PATH}`]: () => json({ user: NEW_USER, temporary_password: null }, 201),
    });

    await user.click(screen.getByRole("button", { name: "เพิ่มผู้ใช้" }));
    const sheet = await screen.findByRole("dialog", { name: "เพิ่มผู้ใช้" });
    await fill(user, within(sheet).getByLabelText("ชื่อ"), NEW_USER.name);
    await fill(user, within(sheet).getByLabelText("อีเมล"), NEW_USER.email);
    const password = within(sheet).getByLabelText("รหัสผ่าน");
    expect(password).toHaveAttribute("type", "password");
    await user.type(password, "short");
    await user.click(within(sheet).getByRole("button", { name: "เพิ่มผู้ใช้" }));
    await waitFor(() =>
      expect(password).toHaveAccessibleDescription(expect.stringContaining("รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร")),
    );
    expect(password).toHaveFocus();
    expect(api.callsTo("POST", USERS_PATH)).toHaveLength(0);

    await user.clear(password);
    await fill(user, password, "short-horse-battery");
    await user.click(within(sheet).getByRole("button", { name: "เพิ่มผู้ใช้" }));

    expect(
      await screen.findByText(`เพิ่มผู้ใช้ ${NEW_USER.name} แล้ว — ใช้รหัสผ่านที่ตั้งไว้เข้าระบบได้เลย`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.callsTo("POST", USERS_PATH).map((call) => call.body)).toEqual([
      expect.objectContaining({ email: NEW_USER.email, role: "staff", password: "short-horse-battery" }),
    ]);
  });

  it("409 อีเมลซ้ำ → ข้อความของ API ใต้ช่องอีเมล · โฟกัสช่องนั้น", async () => {
    const { user } = await openUsers({
      [`POST ${USERS_PATH}`]: () => json({ error: "มีบัญชีที่ใช้อีเมลนี้แล้ว", field: "email" }, 409),
    });

    await user.click(screen.getByRole("button", { name: "เพิ่มผู้ใช้" }));
    const sheet = await screen.findByRole("dialog", { name: "เพิ่มผู้ใช้" });
    await fill(user, within(sheet).getByLabelText("ชื่อ"), NEW_USER.name);
    const email = within(sheet).getByLabelText("อีเมล");
    await fill(user, email, STAFF.email);
    await user.click(within(sheet).getByRole("button", { name: "เพิ่มผู้ใช้" }));

    await waitFor(() =>
      expect(email).toHaveAccessibleDescription(expect.stringContaining("มีบัญชีที่ใช้อีเมลนี้แล้ว")),
    );
    expect(email).toHaveFocus();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("/settings/users — แก้ไขและกันตัวเอง", () => {
  it("บัญชีตัวเอง: บทบาทและเปิดใช้งานถูกปิดพร้อมเหตุผล · ไม่ส่ง role/is_active · ตั้งรหัสใหม่ให้ตัวเองไม่ได้", async () => {
    const reason = "นี่คือบัญชีของคุณ — เปลี่ยนบทบาทหรือปิดบัญชีตัวเองไม่ได้ ให้ผู้ดูแลระบบคนอื่นทำ";
    const { api, user } = await openUsers({
      [`PUT ${USERS_PATH}/${ME_ADMIN.id}`]: () =>
        json({ user: { ...ME_ADMIN, name: "ทดสอบ admin ใหม่" }, sessions_revoked: 0 }),
    });

    const myRow = rowOf(ME_ADMIN.name);
    if (!myRow) throw new Error("row missing");
    const resetOwn = within(myRow).getByRole("button", { name: `ตั้งรหัสผ่านใหม่ให้ ${ME_ADMIN.name}` });
    expect(resetOwn).toHaveAttribute("aria-disabled", "true");
    expect(resetOwn).toHaveAccessibleDescription(expect.stringContaining("ตั้งรหัสผ่านใหม่ให้ตัวเองที่หน้านี้ไม่ได้"));
    await user.click(resetOwn);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: `${ME_ADMIN.name} — แก้ไข` }));
    const sheet = await screen.findByRole("dialog", { name: "แก้ไขผู้ใช้" });
    expect(within(sheet).getByText(reason)).toBeInTheDocument();
    expect(within(sheet).getByRole("radiogroup", { name: "บทบาท" })).toHaveAccessibleDescription(reason);
    for (const radio of within(sheet).getAllByRole("radio")) expect(radio).toBeDisabled();
    const active = within(sheet).getByRole("checkbox", { name: "เปิดใช้งานบัญชี" });
    expect(active).toBeDisabled();
    expect(active).toHaveAccessibleDescription(expect.stringContaining(reason));
    expect(within(sheet).getByLabelText("อีเมล")).toHaveAttribute("readonly");

    const name = within(sheet).getByLabelText("ชื่อ");
    await user.clear(name);
    await fill(user, name, "ทดสอบ admin ใหม่");
    await user.click(within(sheet).getByRole("button", { name: "บันทึกการแก้ไข" }));

    expect(await screen.findByText("บันทึกผู้ใช้ ทดสอบ admin ใหม่ แล้ว")).toBeInTheDocument();
    expect(api.callsTo("PUT", `${USERS_PATH}/${ME_ADMIN.id}`).map((call) => call.body)).toEqual([
      { name: "ทดสอบ admin ใหม่", branch_id: HQ_ID, allowed_branch_ids: [], can_view_all: true },
    ]);
  });

  it("409 ของ API (admin คนสุดท้าย) → ใต้ช่องบทบาท · โฟกัสตัวที่เลือก · ฟอร์มยังเปิด", async () => {
    const lastAdmin = { error: "ต้องมีผู้ดูแลระบบ (admin) ที่ใช้งานได้อย่างน้อย 1 คน", field: "role" };
    const { api, user } = await openUsers({
      [`PUT ${USERS_PATH}/u-admin-2`]: () => json(lastAdmin, 409),
    });

    await user.click(screen.getByRole("button", { name: "ผู้ดูแลทดสอบ 2 — แก้ไข" }));
    const sheet = await screen.findByRole("dialog", { name: "แก้ไขผู้ใช้" });
    expect(within(sheet).queryByText(/นี่คือบัญชีของคุณ/)).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("radio", { name: "พนักงาน" }));
    await user.click(within(sheet).getByRole("button", { name: "บันทึกการแก้ไข" }));

    const group = within(sheet).getByRole("radiogroup", { name: "บทบาท" });
    await waitFor(() => expect(group).toHaveAccessibleDescription(lastAdmin.error));
    expect(within(sheet).getByRole("radio", { name: "พนักงาน" })).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "แก้ไขผู้ใช้" })).toBeInTheDocument();
    expect(api.callsTo("PUT", `${USERS_PATH}/u-admin-2`).map((call) => call.body)).toEqual([
      expect.objectContaining({ role: "staff", is_active: true }),
    ]);
  });

  it("ปิดบัญชีผู้อื่น → ส่ง is_active false · แจ้งจำนวนเครื่องที่ถูกออกจากระบบ", async () => {
    const { api, user } = await openUsers({
      [`PUT ${USERS_PATH}/${STAFF.id}`]: () => json({ user: { ...STAFF, is_active: false }, sessions_revoked: 3 }),
    });

    await user.click(screen.getByRole("button", { name: `${STAFF.name} — แก้ไข` }));
    const sheet = await screen.findByRole("dialog", { name: "แก้ไขผู้ใช้" });
    // สาขาที่ปิดแล้วแต่ยังผูกอยู่ แสดงและเอาออกได้
    expect(within(sheet).getByRole("checkbox", { name: "00002 สาขาทดสอบปิด" })).toBeChecked();
    await user.click(within(sheet).getByRole("checkbox", { name: "เปิดใช้งานบัญชี" }));
    await user.click(within(sheet).getByRole("button", { name: "บันทึกการแก้ไข" }));

    expect(await screen.findByText(`บันทึกผู้ใช้ ${STAFF.name} แล้ว`)).toBeInTheDocument();
    expect(screen.getByText("ผู้ใช้ถูกออกจากระบบ 3 เครื่อง")).toBeInTheDocument();
    expect(api.callsTo("PUT", `${USERS_PATH}/${STAFF.id}`).map((call) => call.body)).toEqual([
      {
        name: STAFF.name,
        role: "staff",
        branch_id: BRANCH_2_ID,
        allowed_branch_ids: [HQ_ID, STAFF.allowed_branches[1]?.id],
        can_view_all: false,
        is_active: false,
      },
    ]);
  });
});

describe("/settings/users — ตั้งรหัสผ่านใหม่", () => {
  const RESET_PATH = `${USERS_PATH}/${STAFF.id}/reset-password`;

  it("ยืนยันก่อน (ยกเลิก = ไม่ส่ง) → รหัสใหม่แสดงครั้งเดียว + จำนวนเครื่องที่ถูกออก → ปิดแล้วหาย · โฟกัสกลับปุ่มเดิม", async () => {
    const TEMP = "Rst4Tn8kPq2wXz6Ym3Hb";
    const { api, user } = await openUsers({
      [`POST ${RESET_PATH}`]: () => json({ temporary_password: TEMP, sessions_revoked: 2 }),
    });
    const trigger = screen.getByRole("button", { name: `ตั้งรหัสผ่านใหม่ให้ ${STAFF.name}` });

    await user.click(trigger);
    let confirm = await screen.findByRole("alertdialog", { name: `ตั้งรหัสผ่านใหม่ให้ ${STAFF.name}?` });
    expect(confirm).toHaveAccessibleDescription(expect.stringContaining("ผู้ใช้จะถูกออกจากระบบทุกเครื่อง"));
    await user.click(within(confirm).getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(api.callsTo("POST", RESET_PATH)).toHaveLength(0);

    await user.click(trigger);
    confirm = await screen.findByRole("alertdialog", { name: `ตั้งรหัสผ่านใหม่ให้ ${STAFF.name}?` });
    await user.click(within(confirm).getByRole("button", { name: "ตั้งรหัสผ่านใหม่" }));

    const dialog = await screen.findByRole("alertdialog", { name: `รหัสผ่านชั่วคราวของ ${STAFF.name}` });
    expect(within(dialog).getByLabelText("รหัสผ่านชั่วคราว")).toHaveValue(TEMP);
    expect(within(dialog).getByText("ผู้ใช้ถูกออกจากระบบแล้ว 2 เครื่อง")).toBeInTheDocument();
    expect(within(dialog).getByText("แสดงครั้งเดียว — ส่งให้ผู้ใช้ทางช่องทางที่ปลอดภัย")).toBeInTheDocument();
    expect(api.callsTo("POST", RESET_PATH).map((call) => call.body)).toEqual([{}]);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(document.body).not.toHaveTextContent(TEMP);
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("403 ระหว่างตั้งรหัส → บอกว่าต้องเป็นผู้ดูแลระบบ · หน้าต่างยืนยันยังเปิด ไม่มีรหัสแสดง", async () => {
    const { user } = await openUsers({ [`POST ${RESET_PATH}`]: () => json({ error: "forbidden" }, 403) });

    await user.click(screen.getByRole("button", { name: `ตั้งรหัสผ่านใหม่ให้ ${STAFF.name}` }));
    const confirm = await screen.findByRole("alertdialog", { name: `ตั้งรหัสผ่านใหม่ให้ ${STAFF.name}?` });
    await user.click(within(confirm).getByRole("button", { name: "ตั้งรหัสผ่านใหม่" }));

    expect(await within(confirm).findByText(/ต้องเป็นผู้ดูแลระบบ — บัญชีนี้บันทึกไม่ได้แล้ว/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog", { name: /รหัสผ่านชั่วคราว/ })).not.toBeInTheDocument();
  });
});
