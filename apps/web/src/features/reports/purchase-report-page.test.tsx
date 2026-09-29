import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me, Role } from "@/lib/queries";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

// 10:00 น. 29 ก.ย. 2569 เวลาไทย
const NOW = new Date("2026-09-29T03:00:00Z");
const THIS_MONTH = "/api/reports/purchase?date_from=2026-09-01&date_to=2026-09-29";

const METALS = [
  { id: "m-gold", code: "gold", name_th: "ทองคำ", unit: "gram", assessment_enabled: true },
  { id: "m-silver", code: "silver", name_th: "เงิน", unit: "gram", assessment_enabled: false },
];
const gold = (grams: string, amount: string) => ({ metal_code: "gold", name_th: "ทองคำ", grams, amount });
const silver = (grams: string, amount: string) => ({ metal_code: "silver", name_th: "เงิน", grams, amount });

const ROWS = [
  {
    no: 1,
    id: "r-1",
    date: "2026-09-02",
    time: "10:15",
    doc_no: "RC6909-0001",
    branch: BRANCH_HQ,
    customer: { id: "c-1", name_th: "สมชาย ทดสอบ", national_id_masked: "1 XXXX XXXXX 12 3" },
    metals: [gold("5.860", "20030.00")],
    total_weight: "5.860",
    total_amount: "20030.00",
    created_by: { id: "u-1", name: "พนักงาน ทดสอบ" },
  },
  {
    no: 2,
    id: "r-2",
    date: "2026-09-03",
    time: "14:05",
    doc_no: "RC6909-0002",
    branch: BRANCH_2,
    customer: { id: "c-2", name_th: "สมหญิง ทดสอบ", national_id_masked: "3 XXXX XXXXX 45 6" },
    metals: [gold("1.000", "3500.00"), silver("100.000", "2500.00")],
    total_weight: "101.000",
    total_amount: "6000.00",
    created_by: { id: "u-2", name: "ผู้จัดการ ทดสอบ" },
  },
];

/**
 * ยอดรวมที่ "บวกแถวไม่ได้" โดยตั้งใจ — จอแสดงค่าเหล่านี้ได้ก็ต่อเมื่ออ่านจาก API ตรง ๆ
 * และมีหลักมากกว่าที่ float แทนได้ (ผ่าน Number แล้วเพี้ยน)
 */
const REPORT = {
  date_from: "2026-09-01",
  date_to: "2026-09-29",
  metal: null,
  rows: ROWS,
  by_branch: [
    {
      branch: BRANCH_HQ,
      count: "700",
      total_weight: "12345.678",
      total_amount: "11111111111111.11",
      by_metal: [gold("12345.678", "11111111111111.11"), silver("0.000", "0.00")],
    },
    {
      branch: BRANCH_2,
      count: "534",
      total_weight: "111111.111",
      total_amount: "87654320998765.43",
      by_metal: [gold("11.111", "87654320998765.43"), silver("111100.000", "0.00")],
    },
  ],
  total: {
    count: "1234",
    total_weight: "123456.789",
    total_amount: "98765432109876.54",
    by_metal: [gold("12356.789", "98765432109876.54"), silver("111100.000", "0.00")],
  },
};

const EMPTY = {
  ...REPORT,
  rows: [],
  by_branch: [BRANCH_HQ, BRANCH_2].map((branch) => ({
    branch,
    count: "0",
    total_weight: "0.000",
    total_amount: "0.00",
    by_metal: [gold("0.000", "0.00"), silver("0.000", "0.00")],
  })),
  total: { count: "0", total_weight: "0.000", total_amount: "0.00", by_metal: [gold("0.000", "0.00")] },
};

afterEach(() => {
  vi.useRealTimers();
});

async function open(
  path: string,
  routes: Parameters<typeof fakeApi>[0] = {},
  me: Me = makeMe("manager", [BRANCH_HQ, BRANCH_2]),
) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const api = fakeApi({
    "GET /api/me": () => json(me),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "GET /api/metals": () => json(METALS),
    [`GET ${THIS_MONTH}`]: () => json(REPORT),
    ...routes,
  });
  const router = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "รายงานยอดซื้อ" });
  return { api, router, user: userEvent.setup() };
}

const reportCalls = (api: Awaited<ReturnType<typeof open>>["api"]) =>
  api.calls.filter((call) => call.path.startsWith("/api/reports/purchase")).map((call) => call.path);
const csvLink = () => screen.getByRole("link", { name: "ดาวน์โหลด CSV" });

describe("รายงานยอดซื้อ — ตัวกรอง ↔ URL ↔ API", () => {
  it("ไม่มีตัวกรองใน URL = เดือนนี้ (วันที่ 1 ถึงวันนี้ตามเวลาไทย) · ช่องวันที่เป็น วว/ดด/ปปปป พ.ศ.", async () => {
    const { api } = await open("/reports/purchase");

    expect(await screen.findByRole("region", { name: "สรุปยอดซื้อ" })).toBeInTheDocument();
    expect(reportCalls(api)).toEqual([THIS_MONTH]);
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveValue("01/09/2569");
    expect(screen.getByLabelText("ถึงวันที่")).toHaveValue("29/09/2569");
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveAttribute("type", "text");
    expect(csvLink()).toHaveAttribute("href", `${THIS_MONTH}&format=csv`);
    expect(csvLink()).toHaveAttribute("download", "รายงานยอดซื้อ_2026-09-01_2026-09-29.csv");
  });

  it("กรอกแล้ว Enter → URL เป็น ISO → query ของ API และลิงก์ CSV ชุดเดียวกัน", async () => {
    const filtered = `/api/reports/purchase?date_from=2026-08-15&date_to=2026-08-31&metal=gold&branch_id=${BRANCH_2.id}`;
    const { api, router, user } = await open("/reports/purchase", { [`GET ${filtered}`]: () => json(REPORT) });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    const from = screen.getByLabelText("ตั้งแต่วันที่");
    await user.clear(from);
    await user.type(from, "15/8/2569");
    await user.selectOptions(screen.getByLabelText("ประเภทโลหะ"), "gold");
    await user.selectOptions(screen.getByLabelText("สาขา"), BRANCH_2.id);
    const to = screen.getByLabelText("ถึงวันที่");
    await user.clear(to);
    await user.type(to, "31/08/2569{Enter}");

    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        date_from: "2026-08-15",
        date_to: "2026-08-31",
        metal: "gold",
        branch_id: BRANCH_2.id,
      }),
    );
    await waitFor(() => expect(reportCalls(api)).toEqual([THIS_MONTH, filtered]));
    // ช่องที่พิมพ์แบบย่อถูกจัดรูปหลังออกจากช่อง
    expect(from).toHaveValue("15/08/2569");
    expect(csvLink()).toHaveAttribute("href", `${filtered}&format=csv`);
    expect(csvLink()).toHaveAttribute("download", "รายงานยอดซื้อ_2026-08-15_2026-08-31.csv");
  });

  it("เปิดลิงก์ที่มีตัวกรอง → ช่องแสดงค่าเดิม และ API ได้ค่าเดียวกัน", async () => {
    const filtered = `/api/reports/purchase?date_from=2026-08-01&date_to=2026-08-31&metal=gold&branch_id=${BRANCH_2.id}`;
    const { api } = await open(
      `/reports/purchase?date_from=2026-08-01&date_to=2026-08-31&metal=gold&branch_id=${BRANCH_2.id}`,
      { [`GET ${filtered}`]: () => json(REPORT) },
    );

    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });
    expect(reportCalls(api)).toEqual([filtered]);
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveValue("01/08/2569");
    expect(screen.getByLabelText("ถึงวันที่")).toHaveValue("31/08/2569");
    await waitFor(() => expect(screen.getByLabelText("ประเภทโลหะ")).toHaveValue("gold"));
    expect(screen.getByLabelText("สาขา")).toHaveValue(BRANCH_2.id);
  });

  it("ค่าผิดรูปใน URL ถูกทิ้ง — กลับไปใช้ค่าเริ่มต้น ไม่ส่งค่าเพี้ยนไป API", async () => {
    const { api } = await open("/reports/purchase?date_from=2026-02-30&metal=&branch_id=");

    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });
    expect(reportCalls(api)).toEqual([THIS_MONTH]);
  });

  it("ปุ่มลัด: เดือนที่แล้ว · วันนี้ ใช้ทันที", async () => {
    const lastMonth = "/api/reports/purchase?date_from=2026-08-01&date_to=2026-08-31";
    const today = "/api/reports/purchase?date_from=2026-09-29&date_to=2026-09-29";
    const { api, router, user } = await open("/reports/purchase", {
      [`GET ${lastMonth}`]: () => json(REPORT),
      [`GET ${today}`]: () => json(REPORT),
    });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });
    const presets = screen.getByRole("group", { name: "เลือกช่วงวันที่ด่วน" });

    await user.click(within(presets).getByRole("button", { name: "เดือนที่แล้ว" }));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ date_from: "2026-08-01", date_to: "2026-08-31" }),
    );
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveValue("01/08/2569");
    expect(screen.getByLabelText("ถึงวันที่")).toHaveValue("31/08/2569");

    await user.click(within(presets).getByRole("button", { name: "วันนี้" }));
    await waitFor(() => expect(reportCalls(api)).toEqual([THIS_MONTH, lastMonth, today]));
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveValue("29/09/2569");
  });

  it("วันที่ผิด → error ใต้ช่อง ผูก aria-describedby · โฟกัสที่ช่องนั้น · ไม่เปลี่ยน URL", async () => {
    const { api, router, user } = await open("/reports/purchase");
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    const from = screen.getByLabelText("ตั้งแต่วันที่");
    await user.clear(from);
    await user.type(from, "31/02/2569{Enter}");

    const message = "วันที่ไม่ถูกต้อง — พิมพ์ วัน/เดือน/ปี พ.ศ. เช่น 01/09/2569";
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(from).toHaveAccessibleDescription(new RegExp(`^${message}`));
    expect(from).toHaveFocus();
    expect(router.state.location.search).toEqual({});
    expect(reportCalls(api)).toEqual([THIS_MONTH]);
  });

  it("วันที่เริ่มหลังวันที่สิ้นสุด → error ที่ช่องสิ้นสุด ไม่ส่ง API", async () => {
    const { api, user } = await open("/reports/purchase");
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    const to = screen.getByLabelText("ถึงวันที่");
    await user.clear(to);
    await user.type(to, "31/08/2569{Enter}");

    expect(await screen.findByText("วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด")).toBeInTheDocument();
    expect(to).toHaveFocus();
    expect(reportCalls(api)).toEqual([THIS_MONTH]);
  });
});

describe("รายงานยอดซื้อ — ตัวเลขจาก API", () => {
  it("การ์ดสรุป · แยกสาขา · แยกโลหะ: ยอดรวมจาก `total` ตรงทุกหลัก — ไม่บวกแถวใน browser", async () => {
    await open("/reports/purchase");

    const summary = await screen.findByRole("region", { name: "สรุปยอดซื้อ" });
    expect(within(summary).getByText("1,234")).toHaveClass("tabular-nums");
    expect(within(summary).getByText("123,456.789")).toBeInTheDocument();
    expect(within(summary).getByText("98,765,432,109,876.54")).toBeInTheDocument();

    const byBranch = screen.getByRole("table", { name: "ยอดซื้อแยกตามสาขา" });
    const hq = within(byBranch).getByRole("row", { name: /00000 สำนักงานใหญ่/ });
    expect(hq).toHaveTextContent("700");
    expect(within(hq).getByRole("cell", { name: "11,111,111,111,111.11" })).toHaveClass("tabular-nums");
    const branchTotal = within(byBranch).getByRole("row", { name: /รวมทุกสาขา/ });
    expect(within(branchTotal).getByRole("cell", { name: "1,234" })).toBeInTheDocument();
    expect(within(branchTotal).getByRole("cell", { name: "123,456.789" })).toBeInTheDocument();
    expect(within(branchTotal).getByRole("cell", { name: "98,765,432,109,876.54" })).toBeInTheDocument();

    const byMetal = screen.getByRole("table", { name: "ยอดซื้อแยกตามประเภทโลหะ" });
    expect(within(byMetal).getByRole("row", { name: /ทองคำ/ })).toHaveTextContent("12,356.789");
    expect(within(byMetal).getByRole("row", { name: /^เงิน / })).toHaveTextContent("111,100.000");
    expect(within(byMetal).getByRole("row", { name: /รวมทุกประเภท/ })).toHaveTextContent("98,765,432,109,876.54");
  });

  it("รายการบิล: เลขที่ใบเป็นลิงก์ไปหน้าบิล · เลขบัตรมาสก์ · น้ำหนัก/เงินต่อโลหะ · ผู้บันทึก", async () => {
    await open("/reports/purchase");

    const rows = await screen.findByRole("table", { name: "รายการบิลซื้อเข้าในช่วงวันที่" });
    expect(within(rows).getByRole("link", { name: "RC6909-0001" })).toHaveAttribute("href", "/buy/r-1");
    const second = within(rows).getByRole("row", { name: /RC6909-0002/ });
    expect(second).toHaveTextContent("3 ก.ย. 2569 14:05 น.");
    expect(second).toHaveTextContent("สาขา 2");
    expect(second).toHaveTextContent("สมหญิง ทดสอบ");
    expect(second).toHaveTextContent("3 XXXX XXXXX 45 6");
    expect(second).toHaveTextContent("ทองคำ 1.000 ก. · 3,500.00 บาท");
    expect(second).toHaveTextContent("เงิน 100.000 ก. · 2,500.00 บาท");
    expect(within(second).getByRole("cell", { name: "101.000" })).toHaveClass("tabular-nums");
    expect(within(second).getByRole("cell", { name: "6,000.00" })).toBeInTheDocument();
    expect(second).toHaveTextContent("ผู้จัดการ ทดสอบ");
  });

  it("ไม่มีบิลในช่วงนี้ → ข้อความว่าง และยอดเป็นศูนย์จาก API", async () => {
    await open("/reports/purchase", { [`GET ${THIS_MONTH}`]: () => json(EMPTY) });

    expect(await screen.findByText("ไม่มีบิลซื้อเข้าในช่วงวันที่ที่เลือก")).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "สรุปยอดซื้อ" });
    expect(within(summary).getByText("0.000")).toBeInTheDocument();
    expect(within(summary).getByText("0.00")).toBeInTheDocument();
  });

  it("API ตอบ error (4xx ไม่ลองซ้ำเอง) → โหลดรายงานไม่ได้ + ข้อความไทยจาก API + ลองใหม่", async () => {
    let fail = true;
    const { user } = await open("/reports/purchase", {
      [`GET ${THIS_MONTH}`]: () =>
        fail ? json({ error: "date_from ต้องไม่เกิน date_to", field: "date_to" }, 400) : json(REPORT),
    });

    expect(await screen.findByText("โหลดรายงานไม่ได้")).toBeInTheDocument();
    expect(screen.getByText("date_from ต้องไม่เกิน date_to")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByRole("region", { name: "สรุปยอดซื้อ" })).toBeInTheDocument();
  });
});

describe("รายงานยอดซื้อ — สิทธิ์และช่องสาขา", () => {
  it("staff (API ตอบ 403) → ไม่มีสิทธิ์ดูรายงาน · ไม่มีตารางและลิงก์ CSV", async () => {
    await open(
      "/reports/purchase",
      { [`GET ${THIS_MONTH}`]: () => json({ error: "forbidden" }, 403) },
      makeMe("staff"),
    );

    expect(await screen.findByText("ไม่มีสิทธิ์ดูรายงาน")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ดาวน์โหลด CSV" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(screen.queryByText(/forbidden/)).not.toBeInTheDocument();
  });

  it("สาขาเดียว → ไม่มีช่องสาขา", async () => {
    await open("/reports/purchase", {}, makeMe("manager", [BRANCH_HQ]));

    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });
    expect(screen.queryByLabelText("สาขา")).not.toBeInTheDocument();
  });

  it.each<[string, Role, boolean]>([
    ["ดูได้ทุกสาขา (view-all) แม้มีสาขาเดียวในรายการ", "accounting", true],
    ["หลายสาขา", "admin", false],
  ])("%s → มีช่องสาขา: ทุกสาขา + สาขาที่มีสิทธิ์", async (_label, role, viewAll) => {
    const branches = viewAll ? [BRANCH_HQ] : [BRANCH_HQ, BRANCH_2];
    await open("/reports/purchase", {}, { ...makeMe(role, branches), can_view_all: viewAll });

    const select = await screen.findByLabelText("สาขา");
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["ทุกสาขา", ...branches.map((branch) => `${branch.code} ${branch.name}`)]);
  });
});
