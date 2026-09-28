import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import type { Me } from "@/lib/queries";

const SIGN_IN = "POST /api/auth/sign-in/email";
const CREDENTIALS = { email: "staff@ong.test", password: "correct-horse-battery" };

/** เซิร์ฟเวอร์ปลอม: ยังไม่ login จนกว่า sign-in จะสำเร็จ */
function signInServer(me: Me, signIn: () => Response = () => json({ redirect: false })) {
  let signedIn = false;
  return fakeApi({
    "GET /api/me": () => (signedIn ? json(me) : json({ error: "unauthorized" }, 401)),
    [SIGN_IN]: () => {
      const res = signIn();
      signedIn = res.ok;
      return res;
    },
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "POST /api/me/branch": ({ body }) => {
      const target = me.branches.find((b) => body instanceof Object && "branch_id" in body && b.id === body.branch_id);
      return target ? json({ branch: target }) : json({ error: "not found", field: "branch_id" }, 404);
    },
  });
}

async function submitCredentials() {
  const user = userEvent.setup();
  const email = await screen.findByLabelText("อีเมล");
  // คีย์บอร์ดล้วน: ช่องอีเมลได้โฟกัสเอง · Enter ส่งฟอร์ม
  expect(email).toHaveFocus();
  await user.keyboard(CREDENTIALS.email);
  await user.tab();
  await user.keyboard(`${CREDENTIALS.password}{Enter}`);
  return user;
}

describe("หน้า login", () => {
  it("login สำเร็จ (สาขาเดียว) → ส่งอีเมล/รหัสผ่าน แล้วเข้าหน้าแรก", async () => {
    const api = signInServer(makeMe("staff"));
    const router = renderApp("/login");
    await submitCredentials();

    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/auth/sign-in/email").map((c) => c.body)).toEqual([CREDENTIALS]);
    expect(api.callsTo("POST", "/api/me/branch")).toHaveLength(0);
    expect(router.state.location.pathname).toBe("/");
  });

  it("กลับไปหน้าที่ขอไว้ใน ?redirect=", async () => {
    signInServer(makeMe("staff"));
    const router = renderApp("/login?redirect=%2Fcustomers");
    await submitCredentials();

    expect(await screen.findByRole("heading", { level: 1, name: "ลูกค้า" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/customers");
  });

  it.each(["%2F%2Fevil.example", "%2F%09%2Fevil.example", "%2F.%2F%2Fevil.example", "%22%2F%5Ct%2Fevil.example%22"])(
    "?redirect=%s ไปเว็บอื่นไม่ได้ (กัน open redirect) — ไปหน้าแรกแทน",
    async (redirect) => {
      signInServer(makeMe("staff"));
      const router = renderApp(`/login?redirect=${redirect}`);
      await submitCredentials();

      expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
      expect(router.state.location.href).toBe("/");
    },
  );

  it("login อยู่แล้วแต่ ?redirect= มีอักขระควบคุม → ไปหน้าแรก ไม่ error", async () => {
    fakeApi({ "GET /api/me": () => json(makeMe("staff")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
    const router = renderApp("/login?redirect=%2F%0A%2Fevil.example");

    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    expect(router.state.location.href).toBe("/");
  });

  it.each([
    [401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, "อีเมลหรือรหัสผ่านไม่ถูกต้อง"],
    [429, { message: "Too many requests. Please try again later." }, "ลองใหม่อีกครั้งในอีกสักครู่"],
    [403, { error: "forbidden origin" }, /BETTER_AUTH_URL.*http:\/\/localhost/],
    [401, { code: "FAILED_TO_CREATE_SESSION", message: "Failed to create session" }, "บัญชีนี้ถูกปิดใช้งาน"],
  ])("sign-in ตอบ %i → แสดงข้อความภาษาไทยและอยู่หน้าเดิม", async (status, body, message) => {
    signInServer(makeMe("staff"), () => json(body, status));
    const router = renderApp("/login");
    await submitCredentials();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(screen.getByLabelText("อีเมล")).toHaveAccessibleDescription(expect.stringMatching(message));
    // พร้อมพิมพ์รหัสผ่านใหม่ทันที
    expect(screen.getByLabelText("รหัสผ่าน")).toHaveFocus();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("ช่องว่างไม่ส่งไปเซิร์ฟเวอร์ — บอกใต้ช่องและโฟกัสช่องแรกที่ผิด", async () => {
    const api = signInServer(makeMe("staff"));
    renderApp("/login");
    const user = userEvent.setup();
    await screen.findByLabelText("อีเมล");
    await user.keyboard("{Enter}");

    expect(screen.getByLabelText("อีเมล")).toHaveAccessibleDescription("กรอกอีเมล");
    expect(screen.getByLabelText("รหัสผ่าน")).toHaveAccessibleDescription("กรอกรหัสผ่าน");
    expect(screen.getByLabelText("อีเมล")).toHaveFocus();
    expect(api.callsTo("POST", "/api/auth/sign-in/email")).toHaveLength(0);
  });

  it("หลายสาขา → ขั้นที่ 2 เลือกสาขา (ค่าเริ่มต้น = สาขาปัจจุบัน) บันทึกแล้วไปหน้าที่ขอ", async () => {
    const api = signInServer(makeMe("manager", [BRANCH_HQ, BRANCH_2]));
    const router = renderApp("/login?redirect=%2Fbills");
    const user = await submitCredentials();

    expect(await screen.findByRole("heading", { level: 1, name: "เลือกสาขาที่ทำงาน" })).toBeInTheDocument();
    const current = screen.getByRole("radio", { name: "สำนักงานใหญ่ (สาขา 1)" });
    expect(current).toBeChecked();
    expect(current).toHaveFocus();

    // Radix เลือกตามโฟกัสเฉพาะตอนลูกศรยังกดอยู่ (ย้ายโฟกัสใน tick ถัดไป) — กดค้างแล้วค่อยปล่อย
    await user.keyboard("{ArrowDown>}");
    await waitFor(() => expect(screen.getByRole("radio", { name: "สาขา 2" })).toBeChecked());
    await user.keyboard("{/ArrowDown}{Enter}");

    expect(await screen.findByRole("heading", { level: 1, name: "ค้นบิล" })).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/me/branch").map((c) => c.body)).toEqual([{ branch_id: BRANCH_2.id }]);
    expect(router.state.location.pathname).toBe("/bills");
    // หัวหน้าแสดงสาขาที่เพิ่งเลือก
    expect(screen.getByText("สาขาปัจจุบัน").parentElement).toHaveTextContent(BRANCH_2.name);
  });

  it("หลายสาขาแต่ยังไม่มีสาขาปัจจุบัน → ขั้นเลือกสาขา ค่าเริ่มต้นเป็นสาขาแรก", async () => {
    const api = signInServer({ ...makeMe("staff", [BRANCH_HQ, BRANCH_2]), branch: null });
    renderApp("/login");
    const user = await submitCredentials();

    expect(await screen.findByRole("heading", { level: 1, name: "เลือกสาขาที่ทำงาน" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "สำนักงานใหญ่ (สาขา 1)" })).toBeChecked();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/me/branch").map((c) => c.body)).toEqual([{ branch_id: BRANCH_HQ.id }]);
  });

  it("สาขาเดียวแต่ยังไม่มีสาขาปัจจุบัน → ตั้งสาขานั้นให้เองโดยไม่ถาม", async () => {
    const api = signInServer({ ...makeMe("staff", [BRANCH_2]), branch: null });
    renderApp("/login");
    await submitCredentials();

    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "เลือกสาขาที่ทำงาน" })).not.toBeInTheDocument();
    expect(api.callsTo("POST", "/api/me/branch").map((c) => c.body)).toEqual([{ branch_id: BRANCH_2.id }]);
    expect(screen.getByText("สาขาปัจจุบัน").parentElement).toHaveTextContent(BRANCH_2.name);
  });

  it("login อยู่แล้ว → เปิด /login แล้วเข้าแอปเลย", async () => {
    fakeApi({ "GET /api/me": () => json(makeMe("staff")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
    const router = renderApp("/login");

    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});
