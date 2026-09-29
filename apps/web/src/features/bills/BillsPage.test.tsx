import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Me } from "@/lib/queries";
import { BRANCH_2, BRANCH_HQ, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { METALS } from "@/test/buy-api";
import { t } from "./i18n";
import { BILL, VOID_BILL, buyList, listRequests } from "./test-data";

type ListHandler = Parameters<typeof fakeApi>[0][string];

function openBills({ me = makeMe("staff"), list }: { me?: Me; list?: ListHandler } = {}) {
  const api = fakeApi({
    "GET /api/me": () => json(me),
    "GET /api/metals": () => json(METALS),
    "GET /api/buy": list ?? (() => buyList([BILL, VOID_BILL])),
  });
  const user = userEvent.setup();
  const router = renderApp("/bills");
  return { api, user, router };
}

const table = () => screen.getByRole("table", { name: t("results.caption") });
const searchBox = () => screen.getByRole("searchbox", { name: t("filters.search") });
const fromBox = () => screen.getByRole("textbox", { name: t("filters.from") });
/** โหลดครั้งแรกทั้งแอป (route · /api/me · รายการ) — เผื่อเครื่องที่รันเทสต์ขนานกันช้า */
const FIRST_LOAD = { timeout: 10_000 };
/** ทั้งแอป + พิมพ์ + รอ debounce หลายรอบในเทสต์เดียว */
const FLOW_TIMEOUT = 30_000;
const waitForRows = () => screen.findByRole("link", { name: BILL.doc_no }, FIRST_LOAD);
/** เกินเวลาหน่วงของช่องค้น (300 ms) — ใช้ยืนยันว่า "ไม่ส่ง" */
const pastDebounce = () => new Promise((resolve) => setTimeout(resolve, 450));

describe("หน้าค้นบิล — ตาราง", { timeout: FLOW_TIMEOUT }, () => {
  it("ไม่มีตัวกรอง = ถามทุกวันที่ ทุกสาขา · แถวแสดงเงินจากข้อความของ API ตรงทุกหลัก · เลขบัตรมาสก์ · ลิงก์ไปหน้าบิล", async () => {
    const { api } = openBills();
    const link = await waitForRows();

    expect(link).toHaveAttribute("href", `/buy/${BILL.id}`);
    const [, row, voidRow] = within(table()).getAllByRole("row");
    if (!row || !voidRow) throw new Error("ต้องมีบิล 2 แถว");
    expect(within(row).getByText("28/09/2569 14:05")).toBeInTheDocument();
    expect(within(row).getByText(BILL.customer.name_th)).toBeInTheDocument();
    expect(within(row).getByText("1 XXXX XXXXX 01 0")).toBeInTheDocument();
    expect(within(row).getByText("15.200")).toBeInTheDocument();
    expect(within(row).getByText("12,345,678,901,234,567.89")).toBeInTheDocument();
    expect(within(row).getByText(BILL.created_by.name)).toBeInTheDocument();
    expect(within(row).getByText(t("pdf.ready"))).toBeInTheDocument();
    expect(within(row).queryByText(t("status.void"))).not.toBeInTheDocument();

    expect(within(voidRow).getByRole("link", { name: VOID_BILL.doc_no })).toHaveAttribute(
      "href",
      `/buy/${VOID_BILL.id}`,
    );
    expect(within(voidRow).getByText(t("status.void"))).toBeInTheDocument();
    expect(within(voidRow).getByText(t("pdf.failed"))).toBeInTheDocument();
    expect(within(voidRow).getByText("5,000.00")).toBeInTheDocument();

    // ผู้ใช้สาขาเดียว — ไม่มีช่องและคอลัมน์สาขา
    expect(screen.queryByRole("combobox", { name: t("filters.branch") })).not.toBeInTheDocument();
    expect(within(table()).queryByRole("columnheader", { name: t("columns.branch") })).not.toBeInTheDocument();
    expect(listRequests(api)).toEqual([{}]);
  });

  it("ยอดท้ายตารางมาจาก totals ของ API (ไม่นับบิลยกเลิก) — ไม่รวมเองจากแถว", async () => {
    openBills();

    expect(
      await screen.findByText(
        t("results.totals", { count: "1,234", weight: "12,345,678,901,234.567", amount: "99,999,999,999,999.99" }),
        {},
        FIRST_LOAD,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("results.totalsNote"))).toBeInTheDocument();
  });

  it("สถานะ PDF ที่ไม่รู้จักแสดงข้อความดิบ", async () => {
    openBills({
      list: () =>
        buyList([
          { ...BILL, pdf_status: "queued" },
          { ...VOID_BILL, pdf_status: "invalid" },
        ]),
    });
    await waitForRows();

    expect(within(table()).getByText("queued")).toBeInTheDocument();
    expect(within(table()).getByText(t("pdf.invalid"))).toBeInTheDocument();
  });

  it("ไม่พบบิล", async () => {
    openBills({ list: () => buyList([], { totals: { count: "0", total_weight: "0.000", total_amount: "0.00" } }) });

    expect(await screen.findByText(t("results.empty"), {}, FIRST_LOAD)).toBeInTheDocument();
  });

  it("หน้าถัดไปส่ง page=2 · เปลี่ยนตัวกรองแล้วกลับหน้า 1", async () => {
    const { api, user } = openBills({
      list: ({ path }) =>
        path.includes("page=2") ? buyList([VOID_BILL], { page: 2 }) : buyList([BILL], { has_more: true }),
    });
    await waitForRows();

    await screen.findByRole("option", { name: "ทอง" });
    await user.click(screen.getByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByRole("link", { name: VOID_BILL.doc_no })).toBeInTheDocument();
    expect(listRequests(api).at(-1)).toEqual({ page: "2" });

    await user.selectOptions(screen.getByRole("combobox", { name: t("filters.metal") }), "ทอง");
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ metal: "gold" }));
  });

  it("API ตอบ error อื่น → กล่องแจ้งพร้อมข้อความของ API", async () => {
    openBills({ list: () => json({ error: "ไม่มีสิทธิ์ดูบิล" }, 403) });

    const alert = await screen.findByRole("alert", {}, FIRST_LOAD);
    expect(alert).toHaveTextContent(t("results.error"));
    expect(alert).toHaveTextContent("ไม่มีสิทธิ์ดูบิล");
    expect(within(alert).getByRole("button", { name: "ลองใหม่" })).toBeInTheDocument();
  });
});

describe("หน้าค้นบิล — ช่องค้นหา", { timeout: FLOW_TIMEOUT }, () => {
  it("1 ตัวอักษร: แนะนำให้พิมพ์เพิ่ม ไม่ส่งคำค้น · 2 ตัวขึ้นไป: ส่งครั้งเดียวหลังหยุดพิมพ์", async () => {
    const { api, user, router } = openBills();
    await waitForRows();

    await user.type(searchBox(), "ก");
    expect(searchBox()).toHaveAccessibleDescription(t("filters.searchTooShort"));
    await pastDebounce();
    expect(listRequests(api)).toEqual([{}]);
    expect(router.state.location.search).toEqual({});

    await user.type(searchBox(), "ข 69");
    // ยังไม่ครบเวลาหน่วง — ยังไม่ยิง
    expect(listRequests(api)).toEqual([{}]);
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: "กข 69" }));
    expect(listRequests(api)).toEqual([{}, { q: "กข 69" }]);
    expect(searchBox()).not.toHaveAccessibleDescription(t("filters.searchTooShort"));
    expect(searchBox()).toHaveValue("กข 69");
  });

  it("Enter ส่งทันที · ลบจนว่างเลิกกรอง (กลับไปใช้ผลที่ไม่กรองใน cache)", async () => {
    const { api, user, router } = openBills();
    await waitForRows();

    await user.type(searchBox(), "RC6910{Enter}");
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: "RC6910" }));
    expect(router.state.location.search).toEqual({ q: "RC6910" });

    await user.clear(searchBox());
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it("เลขบัตรประชาชนเต็ม 13 หลัก: ค้นได้ตามปกติแต่ไม่ลงใน URL (nit)", async () => {
    const { api, user, router } = openBills();
    await waitForRows();

    await user.type(searchBox(), "1234567890123");
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: "1234567890123" }));
    expect(router.state.location.search).toEqual({});
    expect(searchBox()).toHaveValue("1234567890123");

    // คำค้นปกติทับคำค้นที่เป็นเลขบัตรได้ตามเดิม (ไม่ค้างอยู่นอก URL ตลอดไป)
    await user.clear(searchBox());
    await user.type(searchBox(), "สมชาย{Enter}");
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: "สมชาย" }));
    expect(router.state.location.search).toEqual({ q: "สมชาย" });
  });

  it.each([
    ["จัดกลุ่มแบบหน้าบัตร", "1 1037 00123 45 8"],
    ["ขีดคั่น", "1-1037-00123-45-8"],
    ["12 หลัก", "110370012345"],
    ["ตามด้วยชื่อ", "1103700123458 สมชาย"],
  ])("เลขบัตรแบบ%s: ค้นได้แต่ไม่ลงใน URL", async (_name, typed) => {
    const { api, user, router } = openBills();
    await waitForRows();

    await user.type(searchBox(), `${typed}{Enter}`);

    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: typed }));
    expect(router.state.location.search).toEqual({});
    expect(searchBox()).toHaveValue(typed);
  });

  it.each([
    ["ติดกัน", "11037001234", "58"],
    ["จัดกลุ่มแบบหน้าบัตร", "1 1037 00123 4", "5 8"],
  ])("พิมพ์เลขบัตรไม่ครบจนลง URL แล้วพิมพ์ต่อจนครบ (%s): ส่วนที่ค้างใน URL ถูกล้าง", async (_name, partial, rest) => {
    const { api, user, router } = openBills();
    await waitForRows();

    // 11 หลัก: ยังไม่ถือเป็นเลขบัตร จึงลง URL หลังหน่วงเวลาตามปกติ
    await user.type(searchBox(), partial);
    await waitFor(() => expect(router.state.location.search).toEqual({ q: partial }));

    // หยุดพักแล้วพิมพ์ต่อจนครบ — เลขที่พิมพ์ไปแล้วต้องไม่ค้างใน URL (รีโหลด/แชร์/redirect หลัง 401 จะพาไปด้วย)
    await user.type(searchBox(), rest);
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: `${partial}${rest}` }));
    expect(router.state.location.search).toEqual({});
    expect(searchBox()).toHaveValue(`${partial}${rest}`);
    await pastDebounce();
    expect(router.state.location.search).toEqual({});
  });

  it("ตัวกรองอื่นหลังค้นด้วยเลขบัตร: เลขบัตรยังใช้อยู่ · มีแต่คำค้นปกติที่ทับ", async () => {
    const { api, user, router } = openBills();
    await waitForRows();
    await user.type(searchBox(), "1103700123458{Enter}");
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: "1103700123458" }));

    // โลหะ · ช่วงวันที่สำเร็จรูป: ต้องไปพร้อมเลขบัตร ไม่ใช่ตกไปเป็นผลของลูกค้าทุกคนขณะที่ช่องยังโชว์เลขบัตร
    await screen.findByRole("option", { name: "ทอง" });
    await user.selectOptions(screen.getByRole("combobox", { name: t("filters.metal") }), "ทอง");
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: "1103700123458", metal: "gold" }));
    expect(router.state.location.search).toEqual({ metal: "gold" });
    expect(searchBox()).toHaveValue("1103700123458");

    await user.click(screen.getByRole("button", { name: t("presets.allDates") }));
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: "1103700123458", metal: "gold" }));
    expect(router.state.location.search).toEqual({ metal: "gold" });

    // คำค้นปกติทับเลขบัตร (โลหะที่เลือกไว้อยู่ต่อ)
    await user.clear(searchBox());
    await user.type(searchBox(), "สมชาย{Enter}");
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ q: "สมชาย", metal: "gold" }));
    expect(router.state.location.search).toEqual({ q: "สมชาย", metal: "gold" });
  });

  it("ล้างตัวกรองล้างเลขบัตรที่ค้างในหน้านี้ด้วย", async () => {
    const { user, router } = openBills({
      list: ({ path }) => (path.includes("q=") ? buyList([BILL]) : buyList([BILL, VOID_BILL])),
    });
    await waitForRows();
    await user.type(searchBox(), "1103700123458{Enter}");
    await waitFor(() => expect(screen.queryByRole("link", { name: VOID_BILL.doc_no })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: t("filters.clear") }));

    expect(await screen.findByRole("link", { name: VOID_BILL.doc_no })).toBeInTheDocument();
    expect(searchBox()).toHaveValue("");
    expect(router.state.location.search).toEqual({});
  });

  it("เบอร์โทร 10 หลักและเลขที่บิลไม่ใช่เลขบัตร: ลงใน URL ตามเดิม", async () => {
    const { user, router } = openBills();
    await waitForRows();

    await user.type(searchBox(), "0812345678{Enter}");
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "0812345678" }));

    await user.clear(searchBox());
    await user.type(searchBox(), "RC6910-0001{Enter}");
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "RC6910-0001" }));
  });

  it("400 ที่ชี้ช่องคำค้น แสดงใต้ช่องนั้น ไม่ใช่กล่องแจ้งรวม", async () => {
    const { user } = openBills({
      list: ({ path }) =>
        path.includes("q=") ? json({ error: "มีอักขระที่ใช้ไม่ได้", field: "q" }, 400) : buyList([BILL]),
    });
    await waitForRows();

    await user.type(searchBox(), "ab{Enter}");

    expect(await screen.findByText("มีอักขระที่ใช้ไม่ได้")).toBeInTheDocument();
    expect(searchBox()).toHaveAttribute("aria-invalid", "true");
    expect(searchBox()).toHaveAccessibleDescription("มีอักขระที่ใช้ไม่ได้");
    expect(screen.queryByText(t("results.error"))).not.toBeInTheDocument();
  });
});

describe("หน้าค้นบิล — วันที่", { timeout: FLOW_TIMEOUT }, () => {
  it("พิมพ์ พ.ศ. + Enter → date_from เป็น ISO ค.ศ. และจัดรูปข้อความในช่อง", async () => {
    const { api, user, router } = openBills();
    await waitForRows();

    await user.type(fromBox(), "28/9/2569{Enter}");

    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ date_from: "2026-09-28" }));
    expect(fromBox()).toHaveValue("28/09/2569");
    expect(router.state.location.search).toEqual({ from: "2026-09-28" });
  });

  it("วันที่อ่านไม่ได้ → error ใต้ช่อง ไม่ยิงคำขอใหม่ และ URL ไม่เปลี่ยน", async () => {
    const { api, user, router } = openBills();
    await waitForRows();

    await user.type(fromBox(), "31/02/2569{Enter}");

    expect(await screen.findByText(t("filters.dateInvalid"))).toBeInTheDocument();
    expect(fromBox()).toHaveAttribute("aria-invalid", "true");
    expect(fromBox()).toHaveAccessibleDescription(t("filters.dateInvalid"));
    await user.tab();
    await pastDebounce();
    expect(listRequests(api)).toEqual([{}]);
    expect(router.state.location.search).toEqual({});

    // แก้แล้ว error หายตอนพิมพ์
    await user.type(fromBox(), "{Backspace}");
    expect(screen.queryByText(t("filters.dateInvalid"))).not.toBeInTheDocument();
  });

  it("ปุ่ม “วันนี้” ใช้วันตามเวลาไทย (01:30 น. วันที่ 28 = 27 ใน UTC)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-27T18:30:00Z"));
      const { api, user, router } = openBills();
      await waitForRows();

      await user.click(screen.getByRole("button", { name: t("presets.today") }));

      await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ date_from: "2026-09-28", date_to: "2026-09-28" }));
      expect(fromBox()).toHaveValue("28/09/2569");
      expect(screen.getByRole("textbox", { name: t("filters.to") })).toHaveValue("28/09/2569");
      expect(screen.getByRole("button", { name: t("presets.today") })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: t("presets.allDates") })).toHaveAttribute("aria-pressed", "false");

      await user.click(screen.getByRole("button", { name: t("presets.allDates") }));
      await waitFor(() => expect(router.state.location.search).toEqual({}));
      expect(fromBox()).toHaveValue("");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("หน้าค้นบิล — โลหะ · สาขา · ล้างตัวกรอง", { timeout: FLOW_TIMEOUT }, () => {
  it("เลือกโลหะส่ง code ของโลหะ", async () => {
    const { api, user } = openBills();
    await waitForRows();
    await screen.findByRole("option", { name: "นาก" });

    await user.selectOptions(screen.getByRole("combobox", { name: t("filters.metal") }), "นาก");

    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ metal: "nak" }));
  });

  it("ผู้ใช้หลายสาขา: เลือกสาขาได้ · ทุกสาขามีคอลัมน์สาขา · เลือกสาขาเดียวแล้วคอลัมน์หาย", async () => {
    const { api, user } = openBills({ me: makeMe("manager", [BRANCH_HQ, BRANCH_2]) });
    await waitForRows();
    expect(within(table()).getByRole("columnheader", { name: t("columns.branch") })).toBeInTheDocument();
    expect(within(table()).getAllByText(BRANCH_HQ.name)).toHaveLength(2);

    await user.selectOptions(screen.getByRole("combobox", { name: t("filters.branch") }), BRANCH_2.name);

    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ branch_id: BRANCH_2.id }));
    await waitFor(() =>
      expect(within(table()).queryByRole("columnheader", { name: t("columns.branch") })).not.toBeInTheDocument(),
    );
  });

  it("ล้างตัวกรอง: ช่องว่างทั้งหมดและถามใหม่แบบไม่กรอง", async () => {
    const { api, user, router } = openBills();
    await waitForRows();
    await user.type(fromBox(), "01/09/2569{Enter}");
    await user.type(searchBox(), "สมชาย{Enter}");
    await waitFor(() => expect(listRequests(api).at(-1)).toEqual({ date_from: "2026-09-01", q: "สมชาย" }));

    await user.click(screen.getByRole("button", { name: t("filters.clear") }));

    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(searchBox()).toHaveValue("");
    expect(fromBox()).toHaveValue("");
    // ผลแบบไม่กรองมีใน cache อยู่แล้ว — ไม่ต้องถามซ้ำ
    expect(listRequests(api)).toEqual([{}, { date_from: "2026-09-01" }, { date_from: "2026-09-01", q: "สมชาย" }]);
  });
});
