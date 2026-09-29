import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { t as buyT } from "@/features/buy/i18n";
import type { Branch, Me, Role } from "@/lib/queries";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { makeBill } from "@/test/bill-fixture";
import { METALS, fakeQuote } from "@/test/buy-api";
import type { QuoteBody } from "@/features/buy/types";

const BRANCH_3: Branch = { id: "b-00002", code: "00002", name: "สาขา 3" };

interface Options {
  role?: Role;
  branches?: Branch[];
  me?: Me;
  /** คำตอบของ POST /api/me/branch (ค่าเริ่มต้น = สลับสำเร็จไปสาขาที่ขอ) */
  switchTo?: (branchId: string) => Response | Promise<Response>;
  /** คุมเวลาตอบของการสลับที่สำเร็จ */
  delay?: Promise<void>;
  path?: string;
}

/** API ที่จำสาขาปัจจุบันไว้ — ราคาทองของแต่ละสาขาต่างกัน (ดูว่าข้อมูลสาขาเดิมหายจริง) */
function setup({ role = "manager", branches = [BRANCH_HQ, BRANCH_2], me, switchTo, delay, path = "/" }: Options = {}) {
  const base = me ?? makeMe(role, branches);
  let current = base.branch;
  const bill = makeBill();
  const api = fakeApi({
    "GET /api/me": () => json({ ...base, branch: current }),
    "GET /api/gold-price/today": () =>
      json(current?.id === BRANCH_HQ.id ? GOLD_PRICE : { ...GOLD_PRICE, bar_sell: "68000.00" }),
    "GET /api/metals": () => json(METALS),
    "POST /api/buy/quote": ({ body }) => json(fakeQuote(body as QuoteBody, [])),
    [`GET /api/buy/${bill.id}`]: () => (current?.id === BRANCH_HQ.id ? json(bill) : json({ error: "not found" }, 404)),
    "POST /api/me/branch": async ({ body }) => {
      const id = (body as { branch_id: string }).branch_id;
      if (switchTo) return switchTo(id);
      await delay;
      current = base.branches.find((b) => b.id === id) ?? null;
      return json({ branch: current });
    },
  });
  const router = renderApp(path.replace("$bill", bill.id));
  const user = userEvent.setup();
  return { api, router, user, bill };
}

const switcher = () => screen.findByRole("button", { name: /^สาขาปัจจุบัน/ });
const switchCalls = (api: ReturnType<typeof setup>["api"]) => api.callsTo("POST", "/api/me/branch").map((c) => c.body);

async function openSwitcher(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await switcher());
  return screen.findByRole("menu");
}

describe("ตัวเลือกสาขาที่หัว sidebar", () => {
  it("มีสาขาเดียว → หัวนิ่ง (ลิงก์หน้าแรก) ไม่มีเมนูเลือกสาขา", async () => {
    setup({ role: "staff", branches: [BRANCH_HQ] });
    const header = await screen.findByRole("link", { name: /^สาขาปัจจุบัน/ });

    expect(header).toHaveAttribute("href", "/");
    expect(header).toHaveTextContent(BRANCH_HQ.name);
    expect(header).toHaveTextContent("รหัสสาขา 00000");
    expect(screen.queryByRole("button", { name: /^สาขาปัจจุบัน/ })).not.toBeInTheDocument();
  });

  it("หลายสาขา → เมนู 'สาขา' ติ๊กสาขาปัจจุบัน · ปุ่มลัด Alt+n · ไม่ใช่ผู้ดูแลไม่มีจัดการสาขา", async () => {
    const { user } = setup({ branches: [BRANCH_HQ, BRANCH_2, BRANCH_3] });
    expect(await switcher()).toHaveTextContent(`${BRANCH_HQ.name}รหัสสาขา 00000`);
    const menu = await openSwitcher(user);

    expect(within(menu).getByText("สาขา")).toBeInTheDocument();
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(items.map((item) => item.getAttribute("aria-keyshortcuts"))).toEqual(["Alt+1", "Alt+2", "Alt+3"]);
    expect(items[1]).toHaveTextContent(`${BRANCH_2.name}รหัสสาขา 00001`);
    expect(items[2]).toHaveTextContent("Alt+3");
    expect(within(menu).queryByRole("menuitem", { name: "จัดการสาขา" })).not.toBeInTheDocument();
  });

  it("ผู้ดูแลระบบมี 'จัดการสาขา' ท้ายเมนู → /settings/branches", async () => {
    const { user } = setup({ role: "admin" });
    const menu = await openSwitcher(user);

    const manage = within(menu).getByRole("menuitem", { name: "จัดการสาขา" });
    expect(manage).toHaveAttribute("href", "/settings/branches");
  });

  it("เลือกสาขา → บังหน้าจอระหว่างสลับ · ข้อมูลสาขาเดิมหาย · toast สำเร็จ", async () => {
    let release = () => {};
    const answered = new Promise<void>((resolve) => (release = resolve));
    const { api, user } = setup({ delay: answered });
    expect(await screen.findByText("67,850.00")).toBeInTheDocument();
    const menu = await openSwitcher(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: /สาขา 2/ }));

    expect(await screen.findByRole("dialog", { name: "กำลังทำงาน…" })).toBeInTheDocument();
    // สลับที่เซิร์ฟเวอร์ (ผ่าน fakeApi ที่ยังไม่ตอบ) — ตั้งสาขาจริงหลังตอบ
    release();

    expect(await screen.findByText("เปลี่ยนสาขาเป็น สาขา 2 แล้ว")).toBeInTheDocument();
    expect(switchCalls(api)).toEqual([{ branch_id: BRANCH_2.id }]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "กำลังทำงาน…" })).not.toBeInTheDocument());
    expect(await switcher()).toHaveTextContent(BRANCH_2.name);
  });

  it("สลับสาขา → ราคาของสาขาเดิมไม่ค้างใต้หัวสาขาใหม่ (cache ถูก reset)", async () => {
    const { user } = setup();
    expect(await screen.findByText("67,850.00")).toBeInTheDocument();
    const menu = await openSwitcher(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: /สาขา 2/ }));

    expect(await screen.findByText("68,000.00")).toBeInTheDocument();
    expect(screen.queryByText("67,850.00")).not.toBeInTheDocument();
  });

  it("สลับไม่สำเร็จ → toast error · อยู่สาขาเดิม ข้อมูลเดิมยังอยู่", async () => {
    const { api, user } = setup({ switchTo: () => json({ error: "ไม่มีสิทธิ์ในสาขานี้" }, 403) });
    expect(await screen.findByText("67,850.00")).toBeInTheDocument();
    const menu = await openSwitcher(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: /สาขา 2/ }));

    expect(await screen.findByText(/^เปลี่ยนสาขาไม่สำเร็จ/)).toBeInTheDocument();
    expect(switchCalls(api)).toHaveLength(1);
    expect(await switcher()).toHaveTextContent(BRANCH_HQ.name);
    expect(screen.getByText("67,850.00")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "กำลังทำงาน…" })).not.toBeInTheDocument();
  });

  it("ยังไม่มีสาขาปัจจุบัน (สิทธิ์สาขาเดียว) → เลือกสาขาได้จากหัว sidebar ด้วยคีย์บอร์ด", async () => {
    const { api, user } = setup({ role: "staff", me: { ...makeMe("staff", [BRANCH_2]), branch: null } });
    const trigger = await switcher();
    expect(trigger).toHaveTextContent("ยังไม่ได้เลือกสาขา");
    trigger.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: /สาขา 2/ })).toHaveFocus());
    await user.keyboard("{Enter}");

    await waitFor(() => expect(switchCalls(api)).toEqual([{ branch_id: BRANCH_2.id }]));
  });

  it("อยู่หน้าบิลของสาขาเดิม → สลับแล้วพาไปหน้าค้นบิล บิลเดิมไม่ค้างบนจอ", async () => {
    const { router, user, bill } = setup({ path: "/buy/$bill" });
    expect(await screen.findByText(buyT("bill.title", { docNo: bill.doc_no }))).toBeInTheDocument();
    const menu = await openSwitcher(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: /สาขา 2/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/bills"));
    expect(screen.queryByText(buyT("bill.title", { docNo: bill.doc_no }))).not.toBeInTheDocument();
    expect(await screen.findByText("เปลี่ยนสาขาเป็น สาขา 2 แล้ว")).toBeInTheDocument();
  });
});

describe("ปุ่มลัด Alt+1…9", () => {
  it("Alt+2 สลับไปสาขาที่ 2 · Alt+1 (สาขาปัจจุบัน) ไม่ทำอะไร", async () => {
    const { api, user } = setup();
    await switcher();
    await user.keyboard("{Alt>}1{/Alt}");
    expect(switchCalls(api)).toEqual([]);

    await user.keyboard("{Alt>}2{/Alt}");
    await waitFor(() => expect(switchCalls(api)).toEqual([{ branch_id: BRANCH_2.id }]));
    expect(await screen.findByText("เปลี่ยนสาขาเป็น สาขา 2 แล้ว")).toBeInTheDocument();
  });

  it("ไม่ทำงานขณะพิมพ์ในช่อง และไม่ลงทะเบียนสำหรับผู้ที่มีสาขาเดียว", async () => {
    const { api, user } = setup();
    await switcher();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await user.keyboard("{Alt>}2{/Alt}");
    input.remove();
    expect(switchCalls(api)).toEqual([]);
  });

  it("สาขาเดียว → Alt+1 ไม่ส่งคำขอ", async () => {
    const { api, user } = setup({ role: "staff", branches: [BRANCH_HQ] });
    await screen.findByRole("link", { name: /^สาขาปัจจุบัน/ });
    await user.keyboard("{Alt>}1{/Alt}");
    expect(switchCalls(api)).toEqual([]);
  });
});

describe("ฟอร์มที่ยังไม่บันทึก", () => {
  it("บิลที่กรอกค้างใน /buy → ถามยืนยันก่อนสลับ · อยู่ต่อ = ไม่สลับ · ยืนยัน = สลับและล้างบิล", async () => {
    const { api, user } = setup({ path: "/buy" });
    const idBox = await screen.findByLabelText(buyT("customer.idLabel"));
    await user.type(idBox, "1909");

    let menu = await openSwitcher(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: /สาขา 2/ }));
    const confirm = await screen.findByRole("alertdialog", { name: "ข้อมูลในหน้านี้ยังไม่ได้บันทึก" });
    expect(confirm).toHaveTextContent("ถ้าเปลี่ยนเป็น สาขา 2 ข้อมูลที่กรอกค้างไว้จะหายไป");
    // ปุ่มแรกที่ได้โฟกัสคือ "อยู่ต่อ" — Enter พลาดไม่ทิ้งข้อมูล
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "อยู่ต่อ" })).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(switchCalls(api)).toEqual([]);
    expect(screen.getByLabelText(buyT("customer.idLabel"))).toHaveValue("1909");

    menu = await openSwitcher(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: /สาขา 2/ }));
    await user.click(await screen.findByRole("button", { name: "ทิ้งข้อมูลและเปลี่ยนสาขา" }));

    expect(await screen.findByText("เปลี่ยนสาขาเป็น สาขา 2 แล้ว")).toBeInTheDocument();
    expect(switchCalls(api)).toEqual([{ branch_id: BRANCH_2.id }]);
    await waitFor(() => expect(screen.getByLabelText(buyT("customer.idLabel"))).toHaveValue(""));
  });

  it("/buy ที่ยังไม่ได้กรอกอะไร → สลับทันทีไม่ถาม", async () => {
    const { api, user } = setup({ path: "/buy" });
    await screen.findByLabelText(buyT("customer.idLabel"));
    const menu = await openSwitcher(user);
    await user.click(within(menu).getByRole("menuitemradio", { name: /สาขา 2/ }));

    await waitFor(() => expect(switchCalls(api)).toEqual([{ branch_id: BRANCH_2.id }]));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
