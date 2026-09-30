import { act, screen, waitFor, within } from "@testing-library/react";
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

/** กล่องของ toast (portal ที่ body นอก #root) */
const toasts = () => document.querySelector<HTMLElement>('[data-slot="toaster-host"]') ?? document.body;

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
    [429, { message: "Too many requests. Please try again later." }, "พยายามเข้าสู่ระบบบ่อยเกินไป รอสักครู่"],
    [403, { error: "forbidden origin" }, /BETTER_AUTH_URL.*http:\/\/localhost/],
    [401, { code: "FAILED_TO_CREATE_SESSION", message: "Failed to create session" }, "บัญชีนี้ถูกปิดใช้งาน"],
  ])("sign-in ตอบ %i → แสดงข้อความภาษาไทยและอยู่หน้าเดิม", async (status, body, message) => {
    signInServer(makeMe("staff"), () => json(body, status));
    const router = renderApp("/login");
    await submitCredentials();

    // ข้อความอยู่ใน toast บนกลางจออย่างเดียว — ไม่มีกล่องเตือนในฟอร์ม
    await waitFor(() => expect(toasts()).toHaveTextContent(message));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("อีเมล")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("รหัสผ่าน")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("อีเมล")).not.toHaveAccessibleDescription(expect.stringMatching(message));
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
    // หัว sidebar แสดงสาขาที่เพิ่งเลือก
    expect(screen.getByRole("button", { name: /^สาขาปัจจุบัน/ })).toHaveTextContent(BRANCH_2.name);
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
    expect(screen.getByRole("link", { name: /^สาขาปัจจุบัน/ })).toHaveTextContent(BRANCH_2.name);
  });

  it("login อยู่แล้ว → เปิด /login แล้วเข้าแอปเลย", async () => {
    fakeApi({ "GET /api/me": () => json(makeMe("staff")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
    const router = renderApp("/login");

    expect(await screen.findByRole("heading", { level: 1, name: "หน้าแรก" })).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});

describe("หน้า login — กฎฟอร์ม U0–U6", () => {
  it("ป้ายเหนือช่อง + placeholder ตัวอย่าง · ป้ายเป็น <label for>", async () => {
    signInServer(makeMe("staff"));
    renderApp("/login");
    const email = await screen.findByLabelText("อีเมล");
    const password = screen.getByLabelText("รหัสผ่าน");

    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("placeholder", "name@example.com");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("placeholder");
    expect(screen.getByText("อีเมล", { selector: "label" })).toHaveAttribute("for", email.id);
  });

  it("รหัสผ่าน: ปุ่มแสดง/ซ่อน · โฟกัสอยู่ในช่อง · Enter ยังส่งฟอร์ม · ส่งแล้วกลับเป็นซ่อน (U7)", async () => {
    const api = signInServer(makeMe("staff"), () =>
      json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid" }, 401),
    );
    renderApp("/login");
    const user = userEvent.setup();
    await screen.findByLabelText("อีเมล");
    await user.keyboard(CREDENTIALS.email);
    await user.tab();
    const password = screen.getByLabelText("รหัสผ่าน");
    expect(password).toHaveFocus();
    expect(password).toHaveAttribute("autocomplete", "current-password");
    await user.keyboard(CREDENTIALS.password);

    const toggle = screen.getByRole("button", { name: "แสดงรหัสผ่าน" });
    await user.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(password).toHaveFocus();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.callsTo("POST", "/api/auth/sign-in/email")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/auth/sign-in/email")[0]?.body).toEqual(CREDENTIALS);
    expect(screen.getByLabelText("รหัสผ่าน")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "แสดงรหัสผ่าน" })).toHaveAttribute("aria-pressed", "false");
  });

  it("อีเมลผิดรูปแบบ → บอกตอนออกจากช่อง ไม่ใช่ระหว่างพิมพ์ · แก้แล้วหายทันที", async () => {
    signInServer(makeMe("staff"));
    renderApp("/login");
    const user = userEvent.setup();
    const email = await screen.findByLabelText("อีเมล");

    await user.keyboard("staff");
    expect(email).not.toHaveAttribute("aria-invalid");
    await user.tab();
    expect(email).toHaveAccessibleDescription("รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com");

    await user.click(email);
    await user.keyboard("@ong.test");
    expect(email).not.toHaveAttribute("aria-invalid");
  });

  it("ระหว่างส่ง: ฟอร์มปิด · ปุ่มหมุน · Enter ซ้ำไม่ส่งซ้ำ → สำเร็จ toast + ชั้นบังหน้าจอจนหน้าปลายทางโหลดเสร็จ", async () => {
    let releaseSignIn: () => void = () => undefined;
    let releaseMetals: () => void = () => undefined;
    let signedIn = false;
    const api = fakeApi({
      "GET /api/me": () => (signedIn ? json(makeMe("staff")) : json({ error: "unauthorized" }, 401)),
      [SIGN_IN]: () =>
        new Promise<Response>((resolve) => {
          releaseSignIn = () => {
            signedIn = true;
            resolve(json({ redirect: false }));
          };
        }),
      // หน้าซื้อเข้ามี loader (โลหะ) — ค้างไว้ให้เห็นชั้นบังหน้าจอระหว่างนำทาง
      "GET /api/metals": () => new Promise<Response>((resolve) => (releaseMetals = () => resolve(json([])))),
      "GET /api/gold-price/today": () => json(GOLD_PRICE),
    });
    const router = renderApp("/login?redirect=%2Fbuy");
    const user = await submitCredentials();

    const button = await screen.findByRole("button", { name: "กำลังเข้าสู่ระบบ…" });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText("อีเมล")).toBeDisabled();
    expect(screen.getByLabelText("รหัสผ่าน")).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(api.callsTo("POST", "/api/auth/sign-in/email")).toHaveLength(1);

    act(() => releaseSignIn());
    const overlay = await screen.findByRole("dialog", { name: "กำลังทำงาน…" });
    expect(overlay).toHaveAttribute("aria-busy", "true");
    const welcome = await screen.findByText("ยินดีต้อนรับ ทดสอบ staff");
    // toast อยู่นอกส่วนที่ถูกทำ inert — aria-live ยังประกาศได้ระหว่างบังหน้าจอ
    expect(welcome.closest("[inert]")).toBeNull();
    expect(welcome.closest('[data-slot="toaster-host"]')).not.toBeNull();

    act(() => releaseMetals());
    await waitFor(() => expect(router.state.location.pathname).toBe("/buy"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "กำลังทำงาน…" })).not.toBeInTheDocument());
  });

  it("ขั้นเลือกสาขา: บันทึกสาขาไม่สำเร็จ → toast + ข้อความในฟอร์ม · อยู่ขั้นเดิม เลือกใหม่ได้ · ไม่มีชั้นบัง", async () => {
    const me = makeMe("manager", [BRANCH_HQ, BRANCH_2]);
    let signedIn = false;
    const api = fakeApi({
      "GET /api/me": () => (signedIn ? json(me) : json({ error: "unauthorized" }, 401)),
      [SIGN_IN]: () => {
        signedIn = true;
        return json({ redirect: false });
      },
      "POST /api/me/branch": () => json({ error: "internal error" }, 500),
    });
    const router = renderApp("/login");
    const user = await submitCredentials();
    await screen.findByRole("heading", { level: 1, name: "เลือกสาขาที่ทำงาน" });
    await user.keyboard("{Enter}");

    const message = "บันทึกสาขาไม่สำเร็จ — เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง";
    expect(await within(toasts()).findByText(message)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "ปิดการแจ้งเตือน" })).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/me/branch")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: "สำนักงานใหญ่ (สาขา 1)" })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "เข้าใช้งาน" })).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("รหัสผิด → toast ค้าง (มีปุ่มปิด) อย่างเดียว · ฟอร์มเปิดให้แก้ · ไม่มีชั้นบังหน้าจอ", async () => {
    signInServer(makeMe("staff"), () => json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid" }, 401));
    renderApp("/login");
    await submitCredentials();

    expect(await screen.findByRole("button", { name: "ปิดการแจ้งเตือน" })).toBeInTheDocument();
    expect(screen.getAllByText("อีเมลหรือรหัสผ่านไม่ถูกต้อง")).toHaveLength(1);
    await waitFor(() => expect(screen.getByLabelText("รหัสผ่าน")).toHaveFocus());
    expect(screen.getByLabelText("รหัสผ่าน")).toBeEnabled();
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeEnabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
