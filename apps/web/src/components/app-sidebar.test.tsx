import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { activeNavPath, navFor } from "@/lib/nav";
import type { Me, Role } from "@/lib/queries";

const titles = (role: Role) => navFor(role).flatMap((group) => group.items.map((item) => item.title));

describe("เมนูตาม role (spec §10)", () => {
  it.each<[Role, string[]]>([
    ["staff", ["home", "buy", "bills", "customers"]],
    ["manager", ["home", "buy", "bills", "customers", "purchase", "stock", "goldPrice"]],
    ["accounting", ["home", "bills", "customers", "purchase", "stock", "export"]],
    ["admin", ["home", "buy", "bills", "customers", "purchase", "stock", "export", "goldPrice", "branches", "users"]],
  ])("%s เห็นเฉพาะเมนูที่ทำได้", (role, expected) => {
    expect(titles(role)).toEqual(expected);
  });

  it("กลุ่มที่ไม่เหลือเมนูถูกซ่อนทั้งกลุ่ม — พนักงานไม่เห็นรายงานและตั้งค่า", () => {
    expect(navFor("staff").map((group) => group.title)).toEqual([undefined]);
    expect(navFor("accounting").map((group) => group.title)).toEqual([undefined, "reports"]);
  });
});

function renderShell(role: Role, branches = [BRANCH_HQ], me: Me = makeMe(role, branches)) {
  let signedIn = true;
  const api = fakeApi({
    "GET /api/me": () => (signedIn ? json(me) : json({ error: "unauthorized" }, 401)),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "POST /api/me/branch": () => json({ branch: BRANCH_2 }),
    "POST /api/auth/sign-out": () => {
      signedIn = false;
      return json({ success: true });
    },
  });
  const router = renderApp("/");
  return { api, router };
}

describe("sidebar ของแอป", () => {
  it("ฝ่ายบัญชีไม่มีปุ่ม/เมนูซื้อเข้า แต่มีส่งบัญชีรายเดือน", async () => {
    renderShell("accounting");
    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });
    // ทั้งแถบ (หัว · เมนู · เมนูผู้ใช้) อยู่ใน landmark เดียว
    const sidebar = screen.getByRole("complementary", { name: "แถบเมนู" });
    expect(sidebar).toContainElement(nav);
    expect(sidebar).toContainElement(screen.getByRole("button", { name: /ทดสอบ accounting/ }));

    expect(within(nav).queryByRole("link", { name: "ซื้อเข้า" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "ส่งบัญชีรายเดือน" })).toHaveAttribute("href", "/reports/export");
    expect(within(nav).queryByRole("link", { name: "ราคาทองวันนี้" })).not.toBeInTheDocument();
  });

  it("ผู้ดูแลระบบจัดการสาขาและผู้ใช้ได้", async () => {
    renderShell("admin");
    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });

    expect(within(nav).getByRole("link", { name: "สาขา" })).toHaveAttribute("href", "/settings/branches");
    expect(within(nav).getByRole("link", { name: "ผู้ใช้" })).toHaveAttribute("href", "/settings/users");
  });

  it("ผู้จัดการมีเมนูซื้อเข้า (ปุ่มสีหลัก ไม่ซ้ำ) และตั้งราคาทองได้", async () => {
    renderShell("manager");
    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });

    // ปุ่มซื้อเข้า (Quick Create เดิม) กับเมนูซื้อเข้าเป็นเมนูเดียว
    const buyLinks = within(nav).getAllByRole("link", { name: "ซื้อเข้า" });
    expect(buyLinks).toHaveLength(1);
    expect(buyLinks[0]).toHaveAttribute("href", "/buy");
    expect(within(nav).getByRole("link", { name: "ราคาทองวันนี้" })).toHaveAttribute("href", "/settings/gold-price");
    expect(within(nav).queryByRole("link", { name: "ส่งบัญชีรายเดือน" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "สาขา" })).not.toBeInTheDocument();
  });

  it.each([
    ["ขยาย", "true"],
    ["ย่อ", "false"],
  ])(
    "หัวหน้า (%s) = ปุ่มย่อ/ขยาย + breadcrumb เท่านั้น — ไม่มีป้ายสาขา ไม่มีราคาทอง/ป้ายเตือนราคา",
    async (_, open) => {
      document.cookie = `sidebar_state=${open}; path=/`;
      fakeApi({ "GET /api/me": () => json(makeMe("manager")) });
      renderApp("/");
      const banner = await screen.findByRole("banner");
      // หน้าแรกยังแสดงป้ายเตือนราคา (ไม่ได้ลบ query) — แต่ไม่อยู่ในหัวหน้า
      expect(await screen.findByText("ยังไม่ได้ตั้งราคาทองวันนี้", {}, { timeout: 10_000 })).toBeInTheDocument();
      expect(within(banner).getByRole("button", { name: "แสดง/ซ่อนเมนู" })).toBeInTheDocument();
      expect(within(banner).getByRole("navigation", { name: "ตำแหน่งของหน้า" })).toBeInTheDocument();
      expect(within(banner).queryByRole("group", { name: "ราคาทองวันนี้" })).not.toBeInTheDocument();
      expect(within(banner).queryByText("ยังไม่ได้ตั้งราคาทองวันนี้")).not.toBeInTheDocument();
      expect(within(banner).queryByText(BRANCH_HQ.name)).not.toBeInTheDocument();
      expect(within(banner).queryByText("สาขาปัจจุบัน")).not.toBeInTheDocument();
    },
  );

  it("เมนูผู้ใช้ออกจากระบบได้", async () => {
    const { api, router } = renderShell("staff");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /ทดสอบ staff/ }));

    expect(screen.queryByRole("menuitem", { name: "สลับสาขา" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "ออกจากระบบ" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "เข้าสู่ระบบ" }, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/auth/sign-out")).toHaveLength(1);
    expect(router.state.location.pathname).toBe("/login");
  });

  it("หลายสาขา → สลับสาขาอยู่ที่หัว sidebar ไม่อยู่ในเมนูผู้ใช้", async () => {
    renderShell("manager", [BRANCH_HQ, BRANCH_2]);
    const user = userEvent.setup();
    const sidebar = await screen.findByRole("complementary", { name: "แถบเมนู" });
    expect(within(sidebar).getByRole("button", { name: /^สาขาปัจจุบัน/ })).toHaveAttribute("aria-haspopup", "menu");
    await user.click(screen.getByRole("button", { name: /ทดสอบ manager/ }));

    expect(await screen.findByRole("menuitem", { name: "ออกจากระบบ" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "สลับสาขา" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitemradio")).not.toBeInTheDocument();
  });
});

describe("เมนูบนมือถือ (sheet)", () => {
  it("เปิดแล้วโฟกัสเมนูแรก · เลือกหน้าแล้วปิดเองและคืนโฟกัสให้ปุ่มเมนู", async () => {
    // จอแคบกว่า md
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: true,
      media,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const { router } = renderShell("accounting");
    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", { name: "แสดง/ซ่อนเมนู" });
    await user.click(trigger);

    const sheet = await screen.findByRole("dialog", { name: "เมนู" });
    await waitFor(() => expect(within(sheet).getByRole("link", { name: "หน้าแรก" })).toHaveFocus());

    within(sheet).getByRole("link", { name: "ลูกค้า" }).focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("heading", { level: 1, name: "ลูกค้า" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "เมนู" })).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/customers");
    await waitFor(() => expect(screen.getByRole("button", { name: "แสดง/ซ่อนเมนู" })).toHaveFocus());
  });
});

describe("sidebar ย่อเป็นแถบไอคอน (sidebar-07 collapsible=icon)", () => {
  const sidebarRoot = () => document.querySelector<HTMLElement>('[data-slot="sidebar"]');

  it("cookie ย่อไว้ → แถบไอคอน: เมนูทุกตัวมีไอคอน + tooltip · ตัวเลือกสาขาและเมนูผู้ใช้ยังเปิดได้", async () => {
    document.cookie = "sidebar_state=false; path=/";
    renderShell("admin", [BRANCH_HQ, BRANCH_2]);
    const user = userEvent.setup();
    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });
    expect(sidebarRoot()).toHaveAttribute("data-state", "collapsed");
    expect(sidebarRoot()).toHaveAttribute("data-collapsible", "icon");

    // ทุกเมนูมีไอคอนและยังมีชื่อ (ข้อความถูกตัดด้วย CSS ไม่ได้หายจาก accessibility tree)
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(
      navFor("admin").flatMap((g) => g.items.map((i) => i.to)),
    );
    for (const link of links) expect(link.querySelector("svg")).not.toBeNull();

    // โฟกัสเมนูด้วยคีย์บอร์ด → tooltip ชื่อเมนู
    within(nav).getByRole("link", { name: "ค้นบิล" }).focus();
    expect(await screen.findByRole("tooltip", { name: "ค้นบิล" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^สาขาปัจจุบัน/ }));
    expect(await screen.findByRole("menuitemradio", { name: /สาขา 2/ })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /ทดสอบ admin/ }));
    expect(await screen.findByRole("menuitem", { name: "ออกจากระบบ" })).toBeInTheDocument();
  });

  it("ขยายอยู่ → tooltip ไม่แสดง (ชื่อเมนูเห็นอยู่แล้ว)", async () => {
    renderShell("staff");
    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });
    expect(sidebarRoot()).toHaveAttribute("data-state", "expanded");
    within(nav).getByRole("link", { name: "ค้นบิล" }).focus();
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).toHaveAttribute("hidden"));
  });

  it("Ctrl+B สลับย่อ/ขยาย และจำไว้ใน cookie", async () => {
    renderShell("staff");
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "เมนูหลัก" });

    await user.keyboard("{Control>}b{/Control}");
    await waitFor(() => expect(sidebarRoot()).toHaveAttribute("data-state", "collapsed"));
    expect(document.cookie).toContain("sidebar_state=false");

    // สลับได้ด้วยปุ่ม panel-left ในหัวหน้าเท่านั้น — ไม่มีแถบ rail ที่ขอบ (ไม่มีเส้น/เงาตอน hover)
    expect(document.querySelector('[data-slot="sidebar-rail"]')).toBeNull();
    expect(screen.getAllByRole("button", { name: "แสดง/ซ่อนเมนู" })).toHaveLength(1);
    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "แสดง/ซ่อนเมนู" }));
    await waitFor(() => expect(sidebarRoot()).toHaveAttribute("data-state", "expanded"));
    expect(document.cookie).toContain("sidebar_state=true");

    // แป้นภาษาไทย: ปุ่มเดียวกันได้ key "ิ" — ใช้ตำแหน่งปุ่ม (code KeyB)
    fireEvent.keyDown(document.body, { key: "ิ", code: "KeyB", ctrlKey: true });
    await waitFor(() => expect(sidebarRoot()).toHaveAttribute("data-state", "collapsed"));
  });
});

describe("เมนูที่เลือกอยู่ตามหน้า (มีได้เมนูเดียว)", () => {
  it.each([
    ["/", "/"],
    ["/buy", "/buy"],
    ["/buy/7f1c2d3e-0000-4000-8000-000000000001", "/bills"],
    ["/bills", "/bills"],
    ["/customers", "/customers"],
    ["/customers/new", "/customers"],
    ["/customers/abc", "/customers"],
    ["/reports/purchase", "/reports/purchase"],
    ["/reports/stock", "/reports/stock"],
    ["/reports/export", "/reports/export"],
    ["/settings/gold-price", "/settings/gold-price"],
    ["/settings/branches", "/settings/branches"],
    ["/settings/users/", "/settings/users"],
  ])("%s → %s", (pathname, expected) => {
    expect(activeNavPath(pathname, "admin")).toBe(expected);
  });

  it.each([
    ["/bills", "ค้นบิล"],
    ["/buy/7f1c2d3e-0000-4000-8000-000000000001", "ค้นบิล"],
    ["/customers/new", "ลูกค้า"],
    ["/buy", "ซื้อเข้า"],
  ])("เปิด %s → เมนู %s เท่านั้นที่ active + aria-current (ซื้อเข้าไม่ติดสีค้าง)", async (path, label) => {
    fakeApi({ "GET /api/me": () => json(makeMe("manager")), "GET /api/gold-price/today": () => json(GOLD_PRICE) });
    renderApp(path);
    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });
    await waitFor(() => expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page"));
    const links = within(nav).getAllByRole("link");
    expect(links.filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(links.filter((link) => link.getAttribute("data-active") === "true").map((l) => l.textContent)).toEqual([
      label,
    ]);
    const buy = within(nav).getByRole("link", { name: "ซื้อเข้า" });
    // ซื้อเข้าเป็นเมนูธรรมดา — ไม่มีพื้นสีหลักถาวร
    expect(buy.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
    // สไตล์ที่เลือกอยู่ = พื้นนุ่ม (sidebar-accent) น้ำหนักตัวอักษรเท่าเดิม ไม่มีแถบซ้าย · hover เมนูอื่นอ่อนกว่า
    const active = within(nav).getByRole("link", { name: label });
    expect(active).toHaveClass("data-[active=true]:bg-sidebar-accent", "data-[active=true]:font-normal");
    expect(active).toHaveClass("hover:bg-sidebar-accent/60");
    expect(active.className).not.toMatch(/font-semibold|inset_3px|data-\[active=true\]:font-medium/);
  });
});

describe("เวอร์ชันใต้เมนูผู้ใช้", () => {
  it("แสดง v<เวอร์ชัน> · <commit> ใต้ปุ่มผู้ใช้ใน sidebar · ซ่อนตอนย่อเป็นแถบไอคอน", async () => {
    renderShell("staff");
    const sidebar = await screen.findByRole("complementary", { name: "แถบเมนู" });
    const version = within(sidebar).getByText("v0.4.2 · a1b2c3d");
    const userButton = within(sidebar).getByRole("button", { name: /ทดสอบ staff/ });
    // อยู่ถัดจากเมนูผู้ใช้ (ท้าย sidebar)
    expect(userButton.compareDocumentPosition(version) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(version).toHaveClass("group-data-[collapsible=icon]:hidden");
    // เล็ก จาง กึ่งกลาง (80% = ค่าต่ำสุดที่ผ่าน 3:1 ทั้งสองธีม)
    expect(version).toHaveClass("text-center", "text-[11px]", "tabular-nums", "text-muted-foreground/80");
  });
});
