import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { navFor } from "@/lib/nav";
import type { Role } from "@/lib/queries";

const titles = (role: Role) => navFor(role).flatMap((group) => group.items.map((item) => item.title));

describe("เมนูตาม role (spec §10)", () => {
  it.each<[Role, string[]]>([
    ["staff", ["หน้าแรก", "ซื้อเข้า", "ค้นบิล", "ลูกค้า"]],
    ["manager", ["หน้าแรก", "ซื้อเข้า", "ค้นบิล", "ลูกค้า", "ยอดซื้อ", "สต็อก", "ราคาทองวันนี้"]],
    ["accounting", ["หน้าแรก", "ค้นบิล", "ลูกค้า", "ยอดซื้อ", "สต็อก", "ส่งบัญชีรายเดือน"]],
    [
      "admin",
      [
        "หน้าแรก",
        "ซื้อเข้า",
        "ค้นบิล",
        "ลูกค้า",
        "ยอดซื้อ",
        "สต็อก",
        "ส่งบัญชีรายเดือน",
        "ราคาทองวันนี้",
        "สาขา",
        "ผู้ใช้",
      ],
    ],
  ])("%s เห็นเฉพาะเมนูที่ทำได้", (role, expected) => {
    expect(titles(role)).toEqual(expected);
  });

  it("กลุ่มที่ไม่เหลือเมนูถูกซ่อนทั้งกลุ่ม — พนักงานไม่เห็นรายงานและตั้งค่า", () => {
    expect(navFor("staff").map((group) => group.title)).toEqual([undefined]);
    expect(navFor("accounting").map((group) => group.title)).toEqual([undefined, "รายงาน"]);
  });
});

function renderShell(role: Role, branches = [BRANCH_HQ]) {
  let signedIn = true;
  const api = fakeApi({
    "GET /api/me": () => (signedIn ? json(makeMe(role, branches)) : json({ error: "unauthorized" }, 401)),
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

  it("ผู้จัดการมีปุ่มซื้อเข้า (Quick Create) + เมนูซื้อเข้า และตั้งราคาทองได้", async () => {
    renderShell("manager");
    const nav = await screen.findByRole("navigation", { name: "เมนูหลัก" });

    const buyLinks = within(nav).getAllByRole("link", { name: "ซื้อเข้า" });
    expect(buyLinks).toHaveLength(2);
    for (const link of buyLinks) expect(link).toHaveAttribute("href", "/buy");
    expect(within(nav).getByRole("link", { name: "ราคาทองวันนี้" })).toHaveAttribute("href", "/settings/gold-price");
    expect(within(nav).queryByRole("link", { name: "ส่งบัญชีรายเดือน" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "สาขา" })).not.toBeInTheDocument();
  });

  it("หัวหน้าแสดงราคาทองวันนี้ 3 ค่าจากข้อความของ API", async () => {
    renderShell("staff");
    const prices = await screen.findByRole("group", { name: "ราคาทองวันนี้" });

    expect(within(prices).getByText("67,850.00")).toBeInTheDocument();
    expect(within(prices).getByText("67,650.00")).toBeInTheDocument();
    expect(within(prices).getByText("64,268")).toBeInTheDocument();
  });

  it("ยังไม่ตั้งราคาทอง (404) → ป้ายเตือน · ผู้จัดการกดไปหน้าตั้งราคาได้", async () => {
    fakeApi({ "GET /api/me": () => json(makeMe("manager")) });
    renderApp("/");

    // หน้าแรกโหลดทั้งหน้า (ราคา · ยอดวันนี้ · ตารางบิลวันนี้) ก่อนหัวหน้าจะแสดงป้าย — เผื่อเครื่องที่รันเทสต์ขนานกัน
    const warning = await screen.findByRole("link", { name: "ยังไม่ได้ตั้งราคาทองวันนี้" }, { timeout: 10_000 });
    expect(warning).toHaveAttribute("href", "/settings/gold-price");
  });

  it("มีสาขาเดียว → เมนูผู้ใช้ไม่มีสลับสาขา แต่ออกจากระบบได้", async () => {
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

  it("หลายสาขา → สลับสาขาจากเมนูผู้ใช้ด้วยคีย์บอร์ด แล้วโหลดข้อมูลใหม่", async () => {
    const { api } = renderShell("manager", [BRANCH_HQ, BRANCH_2]);
    const user = userEvent.setup();
    (await screen.findByRole("button", { name: /ทดสอบ manager/ })).focus();
    // Enter เปิดเมนู (โฟกัส "สลับสาขา") · → เปิดเมนูย่อย · ↓ ไปสาขา 2 · Enter เลือก
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "สลับสาขา" })).toHaveFocus());
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: /สำนักงานใหญ่/ })).toHaveFocus());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByText("สลับสาขาแล้ว — สาขา 2")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/me/branch").map((c) => c.body)).toEqual([{ branch_id: BRANCH_2.id }]);
    // invalidate ทุก query → ถามผู้ใช้และราคาทองใหม่
    expect(api.callsTo("GET", "/api/me").length).toBeGreaterThanOrEqual(2);
  });
});
