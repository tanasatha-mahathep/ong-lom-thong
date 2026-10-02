import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { t as buyT } from "@/features/buy/i18n";
import { BILL, VOID_BILL, buyList } from "@/features/bills/test-data";
import { beginBlocking } from "@/lib/blocking";
import type { Branch, Me, Role } from "@/lib/queries";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { makeBill } from "@/test/bill-fixture";
import { METALS, fakeQuote } from "@/test/buy-api";
import type { QuoteBody } from "@/features/buy/types";
import { CUSTOMER_DETAIL, CUSTOMER_ID, CUSTOMER_ROW, EXPIRED_ROW } from "@/test/customers";
import type { CustomerListItem } from "@/features/customers/model";

type Handler = Parameters<typeof fakeApi>[0][string];

interface Options {
  role?: Role;
  me?: Me;
  path?: string;
  customers?: Handler;
  bills?: Handler;
  /** GET /api/buy/:id ของ BILL (หน้าบิล) */
  billDetail?: Handler;
}

const customerList = (items: CustomerListItem[]) => json({ items, page: 1, has_more: false });

/** แอปทั้งก้อน + API ปลอม · me จำสาขาปัจจุบันไว้ (เปลี่ยนจากที่อื่นได้ด้วย changeBranch) */
function setup({ role = "staff", me, path = "/", customers, bills, billDetail }: Options = {}) {
  let current: Me = me ?? makeMe(role);
  const api = fakeApi({
    "GET /api/me": () => json(current),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "GET /api/metals": () => json(METALS),
    "POST /api/buy/quote": ({ body }) => json(fakeQuote(body as QuoteBody, [])),
    "GET /api/customers": customers ?? (() => customerList([CUSTOMER_ROW, EXPIRED_ROW])),
    [`GET /api/customers/${CUSTOMER_ID}`]: () => json(CUSTOMER_DETAIL),
    "GET /api/buy": bills ?? (() => buyList([BILL, VOID_BILL])),
    [`GET /api/buy/${BILL.id}`]: billDetail ?? (() => json(makeBill({ id: BILL.id, doc_no: BILL.doc_no }))),
  });
  const router = renderApp(path);
  const user = userEvent.setup();
  const changeBranch = async (branch: Branch) => {
    current = { ...current, branch };
    await act(() => router.options.context.queryClient.invalidateQueries({ queryKey: ["me"] }));
  };
  return { api, router, user, changeBranch };
}

/** Ctrl+K บนแป้นไทย — ปุ่มเดียวกันได้ key "า" แต่ code ยังเป็น KeyK · คืน false ถ้าถูก preventDefault */
const pressSearchKey = (init: KeyboardEventInit = { ctrlKey: true }) =>
  fireEvent.keyDown(document.activeElement ?? document.body, { key: "า", code: "KeyK", ...init });

const trigger = () => screen.findByRole("button", { name: "ค้นหา…" });
const palette = () => screen.findByRole("dialog", { name: "ค้นหา" });
const queryPalette = () => screen.queryByRole("dialog", { name: "ค้นหา" });
const searchBox = (dialog: HTMLElement) => within(dialog).getByRole("combobox", { name: "คำค้น" });
const optionNames = (group: HTMLElement) =>
  within(group)
    .getAllByRole("option")
    .map((option) => option.textContent?.trim());

/** เปิดด้วยปุ่มลัด แล้วรอให้ช่องค้นได้โฟกัส */
async function openPalette() {
  await trigger();
  pressSearchKey();
  const dialog = await palette();
  await waitFor(() => expect(searchBox(dialog)).toHaveFocus());
  return dialog;
}

/** query string ของคำขอที่มีคำค้น (ไม่นับการ์ดบนหน้าหลักที่ถามรายการของวันนี้) */
const searchRequests = (api: ReturnType<typeof fakeApi>, path: "/api/customers" | "/api/buy") =>
  api
    .callsTo("GET", path)
    .map((call) => Object.fromEntries(new URL(call.path, "http://test.local").searchParams))
    .filter((params) => "q" in params);

/** เกินเวลาหน่วงของช่องค้น (250 ms) — ใช้ยืนยันว่า "ไม่ส่ง" */
const pastDebounce = () => act(() => new Promise((resolve) => setTimeout(resolve, 400)));

const FLOW_TIMEOUT = 30_000;

describe("ปุ่มค้นหาใต้ตัวเลือกสาขา", { timeout: FLOW_TIMEOUT }, () => {
  it("อยู่ถัดจากตัวเลือกสาขาในหัว sidebar · ชื่อ · aria-keyshortcuts · aria-haspopup · ไม่มีป้ายปุ่มลัดบนปุ่ม", async () => {
    setup();
    const sidebar = await screen.findByRole("complementary", { name: "แถบเมนู" });
    const button = within(sidebar).getByRole("button", { name: "ค้นหา…" });
    const branch = within(sidebar).getByRole("link", { name: /^สาขาปัจจุบัน/ });

    expect(branch.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    // เจ้าของขอเอาป้ายปุ่มลัดที่เห็นบนปุ่มออก (30 ก.ย.) — ปุ่มลัดยังใช้ได้ ประกาศผ่าน aria-keyshortcuts เท่านั้น
    expect(button.querySelector("kbd")).not.toBeInTheDocument();
  });

  it("กดปุ่ม → เปิดหน้าค้นหา · Esc → ปิดและโฟกัสกลับที่ปุ่ม", async () => {
    const { user } = setup();
    const button = await trigger();
    await user.click(button);

    const dialog = await palette();
    await waitFor(() => expect(searchBox(dialog)).toHaveFocus());
    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryPalette()).not.toBeInTheDocument());
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("ย่อเป็นแถบไอคอน → tooltip บอกชื่อ", async () => {
    document.cookie = "sidebar_state=false; path=/";
    setup();
    (await trigger()).focus();
    expect(await screen.findByRole("tooltip", { name: "ค้นหา" })).toBeInTheDocument();
  });

  it("มือถือ: กดค้นหาใน sheet เมนู → sheet ปิด หน้าค้นหาเปิด · ปิดแล้วโฟกัสไปปุ่มเมนู", async () => {
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
    const { user } = setup();
    await user.click(await screen.findByRole("button", { name: "แสดง/ซ่อนเมนู" }));
    const sheet = await screen.findByRole("dialog", { name: "เมนู" });
    await user.click(within(sheet).getByRole("button", { name: "ค้นหา…" }));

    const dialog = await palette();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "เมนู" })).not.toBeInTheDocument());
    await waitFor(() => expect(searchBox(dialog)).toHaveFocus());
    // จอเล็กมีปุ่มปิดที่มุม (Esc ไม่มีบนมือถือส่วนใหญ่)
    await user.click(within(dialog).getByRole("button", { name: "ปิด" }));

    await waitFor(() => expect(queryPalette()).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "แสดง/ซ่อนเมนู" })).toHaveFocus());
  });
});

describe("ปุ่มลัด Ctrl/⌘+K", { timeout: FLOW_TIMEOUT }, () => {
  it("ใช้ตำแหน่งปุ่ม (แป้นไทย) · กันช่องค้นหาของ browser · กดซ้ำ = ปิด · ⌘K ก็ได้", async () => {
    setup();
    await trigger();

    expect(pressSearchKey()).toBe(false);
    const dialog = await palette();
    await waitFor(() => expect(searchBox(dialog)).toHaveFocus());
    expect(pressSearchKey()).toBe(false);
    await waitFor(() => expect(queryPalette()).not.toBeInTheDocument());

    pressSearchKey({ metaKey: true });
    expect(await palette()).toBeInTheDocument();
  });

  it("ทำงานขณะพิมพ์อยู่ในช่อง · Esc คืนโฟกัสให้ช่องเดิม", async () => {
    const { user } = setup({ path: "/customers" });
    const field = await screen.findByRole("searchbox", { name: "ค้นหาลูกค้า" });
    await waitFor(() => expect(field).toHaveFocus());

    pressSearchKey();
    const dialog = await palette();
    await waitFor(() => expect(searchBox(dialog)).toHaveFocus());
    await user.keyboard("{Escape}");

    await waitFor(() => expect(queryPalette()).not.toBeInTheDocument());
    await waitFor(() => expect(field).toHaveFocus());
  });

  it("ไม่เปิดทับ alertdialog · dialog/sheet อื่น · ชั้นบังหน้าจอ", async () => {
    setup();
    await trigger();

    for (const role of ["alertdialog", "dialog"]) {
      const layer = document.createElement("div");
      layer.setAttribute("role", role);
      document.body.append(layer);
      try {
        // ไม่ preventDefault = ไม่ได้จับปุ่มนี้
        expect(pressSearchKey()).toBe(true);
      } finally {
        // อยู่นอก React — cleanup ของ Testing Library ไม่ลบให้ (ค้างไปเทสต์ถัดไปถ้าเทสต์นี้ล้ม)
        layer.remove();
      }
    }
    let end = () => {};
    act(() => {
      end = beginBlocking();
    });
    await screen.findByRole("dialog", { name: "กำลังทำงาน…" });
    pressSearchKey();
    act(() => end());

    await pastDebounce();
    expect(queryPalette()).not.toBeInTheDocument();
  });

  it("ไม่นับ Ctrl+Shift+K · Ctrl+Alt+K · กดค้าง", async () => {
    setup();
    await trigger();
    pressSearchKey({ ctrlKey: true, shiftKey: true });
    pressSearchKey({ ctrlKey: true, altKey: true });
    pressSearchKey({ ctrlKey: true, repeat: true });
    await pastDebounce();
    expect(queryPalette()).not.toBeInTheDocument();
  });
});

describe("เนื้อหาหน้าค้นหา", { timeout: FLOW_TIMEOUT }, () => {
  it("คำค้นว่าง: หน้าตาม role · คำแนะนำ 2 ตัวอักษร · ขอบเขตสาขาในคำอธิบายและท้ายหน้า", async () => {
    setup({ role: "staff" });
    const dialog = await openPalette();

    expect(optionNames(within(dialog).getByRole("group", { name: "ไปที่หน้า" }))).toEqual([
      "หน้าหลัก",
      "ซื้อเข้า",
      "ค้นบิล",
      "ลูกค้า",
    ]);
    expect(searchBox(dialog)).toHaveAccessibleDescription(
      "พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นลูกค้าและเลขที่บิลของสาขานี้",
    );
    expect(dialog).toHaveAccessibleDescription(`ค้นหน้า ลูกค้าของทั้งร้าน และบิลของ${BRANCH_HQ.name}`);
    expect(within(dialog).getByText(`บิลเฉพาะ ${BRANCH_HQ.name}`)).toBeInTheDocument();
    expect(within(dialog).getByRole("listbox", { name: "ผลการค้นหา" })).toBeInTheDocument();
  });

  it("ฝ่ายบัญชี: ไม่มีหน้าซื้อเข้า · มีรายงานและส่งบัญชีรายเดือน", async () => {
    setup({ role: "accounting" });
    const dialog = await openPalette();

    const pages = optionNames(within(dialog).getByRole("group", { name: "ไปที่หน้า" }));
    expect(pages).toEqual([
      "หน้าหลัก",
      "ค้นบิล",
      "ลูกค้า",
      "ยอดซื้อ รายงาน",
      "สต็อก รายงาน",
      "ส่งบัญชีรายเดือน รายงาน",
    ]);
  });

  it("1 ตัวอักษร: กรองหน้าในเครื่อง ไม่ถาม API · 2 ตัวอักษร: ถามลูกค้า + บิลของสาขาปัจจุบัน (branch_id)", async () => {
    const { api, user } = setup();
    const dialog = await openPalette();

    await user.keyboard("ล");
    expect(optionNames(within(dialog).getByRole("group", { name: "ไปที่หน้า" }))).toEqual([
      "หน้าหลัก",
      "ค้นบิล",
      "ลูกค้า",
    ]);
    expect(searchBox(dialog)).toHaveAccessibleDescription("พิมพ์อีก 1 ตัวอักษรเพื่อค้นลูกค้าและบิล");
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "พบ 3 รายการ — พิมพ์อีก 1 ตัวอักษรเพื่อค้นลูกค้าและบิล",
    );
    await pastDebounce();
    expect(searchRequests(api, "/api/customers")).toEqual([]);
    expect(searchRequests(api, "/api/buy")).toEqual([]);

    await user.keyboard("ู");
    const customers = await within(dialog).findByRole("group", { name: "ลูกค้า · ทุกสาขา" });
    expect(await within(customers).findByRole("option", { name: /นายทดสอบ ระบบ/ })).toBeInTheDocument();
    expect(searchRequests(api, "/api/customers")).toEqual([{ q: "ลู" }]);
    expect(searchRequests(api, "/api/buy")).toEqual([{ q: "ลู", branch_id: BRANCH_HQ.id }]);
  });

  it("แถวลูกค้า: ชื่อ + เลขบัตรมาสก์ + ป้ายบัตรไม่ปกติ (ไม่แสดงเบอร์) · แถวบิล: เลขที่ วันที่ ลูกค้า ยอด + ป้ายยกเลิก", async () => {
    const { user } = setup();
    const dialog = await openPalette();
    await user.keyboard("นาย");

    const customers = await within(dialog).findByRole("group", { name: "ลูกค้า · ทุกสาขา" });
    const [ok, expired] = await within(customers).findAllByRole("option", { name: /^(นายทดสอบ|นางสาวตัวอย่าง)/ });
    expect(ok).toHaveAccessibleName("นายทดสอบ ระบบ 1 XXXX XXXXX 45 8");
    expect(expired).toHaveAccessibleName("นางสาวตัวอย่าง ใจดี 3 XXXX XXXXX 65 7 บัตรหมดอายุ");
    expect(customers).not.toHaveTextContent(CUSTOMER_ROW.mobile ?? "");

    const bills = within(dialog).getByRole("group", { name: `บิล · ${BRANCH_HQ.name}` });
    const [bill, voided] = within(bills).getAllByRole("option", { name: /^PT-RC/ });
    expect(bill).toHaveAccessibleName(
      "PT-RC6910-0002 28/09/2569 14:05 · นายทดสอบ ซื้อเข้า 12,345,678,901,234,567.89 บาท",
    );
    expect(voided).toHaveAccessibleName("PT-RC6910-0001 ยกเลิก 28/09/2569 09:30 · นางทดสอบ ยกเลิก 5,000.00 บาท");
    expect(within(dialog).getByRole("status")).toHaveTextContent("พบลูกค้า 2 รายการ · บิล 2 รายการ");
  });

  it("กลุ่มที่ค้นไม่สำเร็จแสดงแถวลองใหม่ กลุ่มอื่นยังอยู่ · เลือกแถวนั้น = ถามใหม่", async () => {
    let fail = true;
    const { api, user } = setup({
      customers: () => (fail ? json({ error: "ไม่มีสิทธิ์" }, 403) : customerList([CUSTOMER_ROW])),
    });
    const dialog = await openPalette();
    await user.keyboard("นาย");

    const retry = await within(dialog).findByRole("option", { name: "ค้นลูกค้าไม่สำเร็จ — เลือกเพื่อลองใหม่" });
    expect(within(dialog).getByRole("option", { name: /^PT-RC6910-0002/ })).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("ค้นลูกค้าไม่สำเร็จ");

    fail = false;
    await user.click(retry);
    expect(await within(dialog).findByRole("option", { name: /นายทดสอบ ระบบ/ })).toBeInTheDocument();
    expect(searchRequests(api, "/api/customers")).toHaveLength(2);
  });

  it("ไม่พบอะไรเลย → ข้อความนอก listbox + ประกาศผ่าน status", async () => {
    const { user } = setup({ customers: () => customerList([]), bills: () => buyList([]) });
    const dialog = await openPalette();
    await user.keyboard("zz");

    const status = within(dialog).getByRole("status");
    await waitFor(() => expect(status).toHaveTextContent("ไม่พบผลลัพธ์ที่ตรงกับ “zz”"));
    // ข้อความบนจออยู่นอก listbox (listbox ที่มีแต่ข้อความไม่มี option ผิด ARIA — axe aria-required-children)
    const message = within(dialog).getByText("ไม่พบผลลัพธ์ที่ตรงกับ “zz”", { selector: "p:not([role=status])" });
    expect(within(dialog).getByRole("listbox", { name: "ผลการค้นหา" })).not.toContainElement(message);
    expect(within(dialog).queryAllByRole("option")).toEqual([]);
  });
});

describe("ขอบเขตสาขา (fail-closed)", { timeout: FLOW_TIMEOUT }, () => {
  it("ยังไม่มีสาขาปัจจุบัน → ไม่ถามบิลเลย · กลุ่มบิลบอกให้เลือกสาขา · ลูกค้ายังค้นได้", async () => {
    const { api, user } = setup({ me: { ...makeMe("staff", [BRANCH_HQ, BRANCH_2]), branch: null } });
    const dialog = await openPalette();
    expect(dialog).toHaveAccessibleDescription("ค้นหน้า และลูกค้าของทั้งร้าน — ยังไม่ได้เลือกสาขา จึงค้นบิลไม่ได้");
    await user.keyboard("นาย");

    expect(await within(dialog).findByRole("option", { name: /นายทดสอบ ระบบ/ })).toBeInTheDocument();
    const info = within(within(dialog).getByRole("group", { name: "บิล" })).getByRole("option");
    expect(info).toHaveTextContent("ยังไม่ได้เลือกสาขา — เลือกสาขาที่หัวเมนูก่อนจึงค้นบิลได้");
    expect(info).toHaveAttribute("aria-disabled", "true");
    await pastDebounce();
    expect(searchRequests(api, "/api/buy")).toEqual([]);
  });

  it("สาขาเปลี่ยนจากที่อื่นระหว่างเปิด → หน้าค้นหาปิดเอง (ผลของสาขาเดิมไม่ค้าง)", async () => {
    const { user, changeBranch } = setup({ role: "manager", me: makeMe("manager", [BRANCH_HQ, BRANCH_2]) });
    const dialog = await openPalette();
    await user.keyboard("นาย");
    await within(dialog).findByRole("group", { name: `บิล · ${BRANCH_HQ.name}` });

    await changeBranch(BRANCH_2);
    await waitFor(() => expect(queryPalette()).not.toBeInTheDocument());
  });
});

describe("เลือกผลค้น", { timeout: FLOW_TIMEOUT }, () => {
  it("Enter เปิดลูกค้า · คำค้นเป็นเลขบัตร → ไม่มี 'ดูทั้งหมด' และ URL ไม่มีเลขบัตร", async () => {
    const { router, user } = setup();
    const dialog = await openPalette();
    await user.keyboard("1103700123458");

    expect(await within(dialog).findByRole("option", { name: /นายทดสอบ ระบบ/ })).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("พบลูกค้า"));
    expect(within(dialog).queryByRole("option", { name: /ดูทั้งหมด/ })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(router.state.location.pathname).toBe(`/customers/${CUSTOMER_ID}`));
    expect(queryPalette()).not.toBeInTheDocument();
    expect(router.state.location.href).not.toMatch(/\d{12}/);
  });

  it("aria-activedescendant ของช่องค้นชี้แถวที่เลือกอยู่เสมอ — ตอนเปิด · หลังพิมพ์ · หลังลบ (cmdk ไม่อัปเดตเอง)", async () => {
    const { user } = setup();
    const dialog = await openPalette();
    const box = searchBox(dialog);
    const selectedOption = () => within(dialog).getAllByRole("option", { selected: true })[0];

    await waitFor(() => expect(box).toHaveAttribute("aria-activedescendant", selectedOption()?.id));
    expect(selectedOption()).toHaveTextContent("หน้าหลัก");

    await user.keyboard("นาย");
    const customer = await within(dialog).findByRole("option", { name: /นายทดสอบ ระบบ/ });
    await waitFor(() => expect(customer).toHaveAttribute("aria-selected", "true"));
    await waitFor(() => expect(box).toHaveAttribute("aria-activedescendant", customer.id));

    await user.keyboard("{Backspace}{Backspace}{Backspace}");
    await waitFor(() => expect(selectedOption()).toHaveTextContent("หน้าหลัก"));
    await waitFor(() => expect(box).toHaveAttribute("aria-activedescendant", selectedOption()?.id));
  });

  it("บิลตอบก่อนลูกค้า → พอลูกค้ามา แถวบนสุด (ลูกค้า) ถูกเลือก · Enter เปิดลูกค้า ไม่ใช่บิลที่เคยถูกเลือกไว้", async () => {
    let answerCustomers = () => {};
    const customersAnswered = new Promise<void>((resolve) => (answerCustomers = resolve));
    const { router, user } = setup({
      customers: async () => {
        await customersAnswered;
        return customerList([CUSTOMER_ROW]);
      },
    });
    const dialog = await openPalette();
    await user.keyboard("นาย");
    const bill = await within(dialog).findByRole("option", { name: /^PT-RC6910-0002/ });
    await waitFor(() => expect(bill).toHaveAttribute("aria-selected", "true"));

    answerCustomers();
    const customer = await within(dialog).findByRole("option", { name: /นายทดสอบ ระบบ/ });
    await waitFor(() => expect(customer).toHaveAttribute("aria-selected", "true"));
    expect(searchBox(dialog)).toHaveAttribute("aria-activedescendant", customer.id);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(router.state.location.pathname).toBe(`/customers/${CUSTOMER_ID}`));
  });

  it("ลูกศรลงไปบิลแล้ว Enter → หน้าบิล (/buy/$id)", async () => {
    const { router, user } = setup();
    const dialog = await openPalette();
    await user.keyboard("PT");
    const bill = await within(dialog).findByRole("option", { name: /^PT-RC6910-0002/ });
    // ลูกค้า 2 แถว + ดูทั้งหมด → บิลแรกอยู่ลำดับที่ 4
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    await waitFor(() => expect(bill).toHaveAttribute("aria-selected", "true"));
    expect(searchBox(dialog)).toHaveAttribute("aria-activedescendant", bill.id);
    await user.keyboard("{Enter}");

    await waitFor(() => expect(router.state.location.pathname).toBe(`/buy/${BILL.id}`));
  });

  it("เปิดบิลแล้วกด Ctrl+K ค้นต่อระหว่างบิลยังโหลด — หน้าบิลไม่แย่งโฟกัส คำค้นที่พิมพ์ไม่ถูกแทน", async () => {
    let answerBill = () => {};
    const billAnswered = new Promise<void>((resolve) => (answerBill = resolve));
    const { router, user } = setup({
      billDetail: async () => {
        await billAnswered;
        return json(makeBill({ id: BILL.id, doc_no: BILL.doc_no }));
      },
    });
    let dialog = await openPalette();
    await user.keyboard("PT");
    const bill = await within(dialog).findByRole("option", { name: /^PT-RC6910-0002/ });
    await user.click(bill);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/buy/${BILL.id}`));

    dialog = await openPalette();
    await user.keyboard("นา");
    answerBill();
    // หน้าบิลโหลดเสร็จข้างหลัง (ปกติโฟกัสไป "ซื้อเข้าบิลใหม่") — โฟกัสต้องยังอยู่ที่ช่องค้น ไม่ถูกดึงแล้วเลือกข้อความทั้งช่อง
    // หน้าบิลอยู่หลัง modal (aria-hidden) — ค้นแบบรวมส่วนที่ซ่อนจาก screen reader
    expect(await screen.findByRole("link", { name: buyT("bill.newBill"), hidden: true })).toBeInTheDocument();
    await user.keyboard("ย");
    expect(searchBox(dialog)).toHaveFocus();
    expect(searchBox(dialog)).toHaveValue("นาย");
  });

  it("'ดูทั้งหมด' → หน้าลูกค้าพร้อมคำค้น · หน้าค้นบิลพร้อมคำค้นและสาขาปัจจุบัน", async () => {
    const { router, user } = setup();
    let dialog = await openPalette();
    await user.keyboard("นาย");
    await user.click(await within(dialog).findByRole("option", { name: "ดูทั้งหมด ในหน้าลูกค้า" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/customers"));
    expect(router.state.location.search).toEqual({ q: "นาย" });

    dialog = await openPalette();
    await user.keyboard("นาย");
    await user.click(await within(dialog).findByRole("option", { name: "ดูทั้งหมด ในหน้าค้นบิล" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/bills"));
    expect(router.state.location.search).toEqual({ q: "นาย", branch: BRANCH_HQ.id });
  });

  it("เลือกหน้าที่เปิดอยู่ → แค่ปิด คืนโฟกัส · Home/End ไปแถวแรก/สุดท้าย", async () => {
    const { router, user } = setup();
    const button = await trigger();
    await user.click(button);
    const dialog = await palette();
    await waitFor(() => expect(searchBox(dialog)).toHaveFocus());

    await user.keyboard("{End}");
    await waitFor(() =>
      expect(within(dialog).getByRole("option", { name: "ลูกค้า" })).toHaveAttribute("aria-selected", "true"),
    );
    await user.keyboard("{Home}");
    const first = within(dialog).getByRole("option", { name: "หน้าหลัก" });
    await waitFor(() => expect(first).toHaveAttribute("aria-selected", "true"));

    await user.click(within(dialog).getByRole("option", { name: "หน้าหลัก" }));
    await waitFor(() => expect(queryPalette()).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/");
    await waitFor(() => expect(button).toHaveFocus());
  });

  it("กำลังบันทึกอยู่ → ไม่เปลี่ยนหน้า แจ้งให้รอ", async () => {
    const { router, user } = setup();
    await trigger();
    const queryClient = router.options.context.queryClient;
    void queryClient
      .getMutationCache()
      .build(queryClient, { mutationKey: ["buy-save"], mutationFn: () => new Promise(() => {}) })
      .execute(undefined);

    const dialog = await openPalette();
    await user.click(within(dialog).getByRole("option", { name: "ค้นบิล" }));

    expect(await screen.findByText("กำลังบันทึก… รอให้เสร็จก่อนเปิดหน้าอื่น")).toBeInTheDocument();
    expect(queryPalette()).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  });

  it("บิลกรอกค้างใน /buy → ถามก่อน · อยู่ต่อ = ไม่ไป ข้อมูลอยู่ โฟกัสกลับช่องเดิม · ทิ้งข้อมูล = ไป", async () => {
    const { router, user } = setup({ path: "/buy" });
    const idBox = await screen.findByLabelText(buyT("customer.idLabel"));
    await user.type(idBox, "1909");

    let dialog = await openPalette();
    await user.keyboard("นาย");
    await within(dialog).findByRole("option", { name: /นายทดสอบ ระบบ/ });
    await user.keyboard("{Enter}");

    const confirm = await screen.findByRole("alertdialog", { name: "ข้อมูลในหน้านี้ยังไม่ได้บันทึก" });
    expect(confirm).toHaveTextContent("ถ้าไปที่ “นายทดสอบ ระบบ” ข้อมูลที่กรอกค้างไว้จะหายไป");
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "อยู่ต่อ" })).toHaveFocus());
    await user.keyboard("{Enter}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/buy");
    expect(idBox).toHaveValue("1 909"); // จัดกลุ่มแบบหน้าบัตรขณะพิมพ์
    await waitFor(() => expect(idBox).toHaveFocus());

    dialog = await openPalette();
    await user.keyboard("นาย");
    await within(dialog).findByRole("option", { name: /นายทดสอบ ระบบ/ });
    await user.keyboard("{Enter}");
    await user.click(await screen.findByRole("button", { name: "ทิ้งข้อมูลและไปต่อ" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/customers/${CUSTOMER_ID}`));
  });

  it("Ctrl+Enter ในหน้าค้นหาไม่ถึงปุ่มลัดบันทึกของฟอร์มลูกค้าข้างหลัง", async () => {
    const { api, user } = setup({ path: "/customers/new" });
    const id = await screen.findByLabelText("เลขประจำตัวประชาชน");
    // ฟอร์มที่บันทึกได้จริง (เลขบัตร + ชื่อ) — ถ้า Ctrl+Enter หลุดถึงฟอร์ม จะมี POST
    await user.type(id, "1103700123458");
    await user.type(screen.getByLabelText("ชื่อ - นามสกุล (ภาษาไทย)"), "นายทดสอบ ระบบ");

    await openPalette();
    await user.keyboard("{Control>}{Enter}{/Control}");

    // Enter เลือก "หน้าหลัก" → ฟอร์มยังไม่บันทึก → ถามยืนยัน · ฟอร์มลูกค้าไม่ถูกส่ง
    expect(await screen.findByRole("alertdialog", { name: "ข้อมูลในหน้านี้ยังไม่ได้บันทึก" })).toBeInTheDocument();
    await user.keyboard("{Control>}{Enter}{/Control}");
    await pastDebounce();
    expect(api.callsTo("POST", "/api/customers")).toEqual([]);
  });
});
