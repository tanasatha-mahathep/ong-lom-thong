import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
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
    // ตัวกรองอื่นที่เทสต์ไม่ได้ระบุ (เช่น ระหว่างเลือกโลหะ/สาขา) — ไม่ต่างกันที่ตัวเลข
    "GET /api/reports/purchase": () => json(REPORT),
    ...routes,
  });
  const router = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "รายงานยอดซื้อ" });
  return { api, router, user: userEvent.setup() };
}

const reportCalls = (api: Awaited<ReturnType<typeof open>>["api"]) =>
  api.calls.filter((call) => call.path.startsWith("/api/reports/purchase")).map((call) => call.path);
const csvButton = () => screen.getByRole("button", { name: "ดาวน์โหลด CSV" });
const csvOk = () => new Response("\uFEFFa,b\n", { headers: { "Content-Type": "text/csv" } });

describe("รายงานยอดซื้อ — ตัวกรอง ↔ URL ↔ API", () => {
  it("ไม่มีตัวกรองใน URL = เดือนนี้ (วันที่ 1 ถึงวันนี้ตามเวลาไทย) · ช่องวันที่เป็น วว/ดด/ปปปป พ.ศ.", async () => {
    const { api } = await open("/reports/purchase");

    expect(await screen.findByRole("region", { name: "สรุปยอดซื้อ" })).toBeInTheDocument();
    expect(reportCalls(api)).toEqual([THIS_MONTH]);
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveValue("01/09/2569");
    expect(screen.getByLabelText("ถึงวันที่")).toHaveValue("29/09/2569");
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveAttribute("type", "text");
    // U1: placeholder + คำแนะนำชุดเดียวกับหน้าค้นบิล
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveAttribute("placeholder", "วว/ดด/ปปปป");
    expect(screen.getByLabelText("ตั้งแต่วันที่")).toHaveAccessibleDescription("พ.ศ. เช่น 29/09/2569");
    // วันที่ในข้อความบรรยายใช้รูปตัวเลขเดียวกับตาราง
    expect(screen.getByText("01/09/2569 – 29/09/2569")).toBeInTheDocument();
  });

  it("กรอกวันที่แล้ว Enter → URL เป็น ISO → query ของ API · โลหะ/สาขาใช้ทันทีที่เลือก", async () => {
    const withMetal = `${THIS_MONTH}&metal=gold`;
    const withBranch = `${THIS_MONTH}&metal=gold&branch_id=${BRANCH_2.id}`;
    const filtered = `/api/reports/purchase?date_from=2026-08-15&date_to=2026-08-31&metal=gold&branch_id=${BRANCH_2.id}`;
    const { api, router, user } = await open("/reports/purchase", { [`GET ${filtered}`]: () => json(REPORT) });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    // ตัวเลือก = ใช้ทันที (เหมือนหน้าค้นบิล)
    await user.selectOptions(screen.getByLabelText("ประเภทโลหะ"), "gold");
    await waitFor(() => expect(reportCalls(api)).toEqual([THIS_MONTH, withMetal]));
    await user.selectOptions(screen.getByLabelText("สาขา"), BRANCH_2.id);
    await waitFor(() => expect(reportCalls(api)).toEqual([THIS_MONTH, withMetal, withBranch]));

    // วันที่ที่พิมพ์ = ยังไม่ใช้จนกด Enter (รายงานหนักกว่ารายการ ไม่ยิงทุกครั้งที่ออกจากช่อง)
    const from = screen.getByLabelText("ตั้งแต่วันที่");
    await user.clear(from);
    await user.type(from, "15/8/2569");
    await user.tab();
    expect(from).toHaveValue("15/08/2569"); // จัดรูปหลังออกจากช่อง
    expect(reportCalls(api)).toHaveLength(3);
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
    await waitFor(() => expect(reportCalls(api)).toEqual([THIS_MONTH, withMetal, withBranch, filtered]));
  });

  it("CSV: ขอด้วยตัวกรองที่ใช้แล้วชุดเดียวกับตัวเลข · บันทึกเป็นไฟล์ชื่อไทย · toast สำเร็จ", async () => {
    const save = vi.spyOn(navigation, "saveBlob").mockImplementation(() => undefined);
    const { api, user } = await open("/reports/purchase", { [`GET ${THIS_MONTH}&format=csv`]: csvOk });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    // ค่าที่ยังพิมพ์ค้างในช่องไม่ไปอยู่ใน CSV
    const from = screen.getByLabelText("ตั้งแต่วันที่");
    await user.clear(from);
    await user.type(from, "15/08/2569");
    await user.click(csvButton());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(reportCalls(api)).toEqual([THIS_MONTH, `${THIS_MONTH}&format=csv`]);
    expect(save.mock.calls[0]?.[1]).toBe("รายงานยอดซื้อ_2026-09-01_2026-09-29.csv");
    expect(await screen.findByText("ดาวน์โหลด รายงานยอดซื้อ_2026-09-01_2026-09-29.csv แล้ว")).toBeInTheDocument();
  });

  it("CSV ระหว่างดาวน์โหลด: ปุ่มกดไม่ได้ + หมุน + กดซ้ำไม่ยิงซ้ำ", async () => {
    vi.spyOn(navigation, "saveBlob").mockImplementation(() => undefined);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, user } = await open("/reports/purchase", {
      [`GET ${THIS_MONTH}&format=csv`]: async () => {
        await gate;
        return csvOk();
      },
    });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    await user.click(csvButton());
    const busy = await screen.findByRole("button", { name: "กำลังดาวน์โหลด…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy.querySelector("svg.animate-spin, svg[class*='animate-spin']")).not.toBeNull();
    await user.click(busy);

    release();
    await waitFor(() => expect(csvButton()).toBeEnabled());
    expect(reportCalls(api).filter((path) => path.endsWith("format=csv"))).toHaveLength(1);
  });

  it("CSV ล้มเหลว (API 403) → toast ค้างพร้อมเหตุผล · ไม่บันทึกไฟล์ · ปุ่มกลับมากดได้", async () => {
    const save = vi.spyOn(navigation, "saveBlob").mockImplementation(() => undefined);
    const { user } = await open("/reports/purchase", {
      [`GET ${THIS_MONTH}&format=csv`]: () => json({ error: "forbidden" }, 403),
    });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    await user.click(csvButton());

    expect(await screen.findByText("ดาวน์โหลด CSV ไม่สำเร็จ — ไม่มีสิทธิ์")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปิดการแจ้งเตือน" })).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(csvButton()).toBeEnabled();
  });

  it("ระหว่างโหลดรายงาน ปุ่ม “แสดงรายงาน” กดไม่ได้ + หมุน (U4) · โหลดเสร็จกลับมากดได้", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await open("/reports/purchase", {
      [`GET ${THIS_MONTH}`]: async () => {
        await gate;
        return json(REPORT);
      },
    });

    const loading = await screen.findByRole("button", { name: "กำลังโหลด…" });
    expect(loading).toBeDisabled();
    expect(loading.querySelector("svg[class*='animate-spin']")).not.toBeNull();

    release();
    expect(await screen.findByRole("button", { name: "แสดงรายงาน" })).toBeEnabled();
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

    const message = "วันที่ไม่ถูกต้อง — พิมพ์ วว/ดด/ปปปป (พ.ศ.) เช่น 29/09/2569";
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(from).toHaveAccessibleDescription(`${message} พ.ศ. เช่น 29/09/2569`);
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
    expect(second).toHaveTextContent("03/09/2569 14:05");
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
    // 400 ที่ชี้ช่อง → ข้อความอยู่ใต้ช่อง “ถึงวันที่” (ไม่ซ้ำในกล่องแจ้ง) — U3
    expect(screen.getByText("date_from ต้องไม่เกิน date_to")).toBeInTheDocument();
    expect(screen.getByLabelText("ถึงวันที่")).toHaveAccessibleDescription(/date_from ต้องไม่เกิน date_to/);
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
    expect(screen.queryByRole("button", { name: "ดาวน์โหลด CSV" })).not.toBeInTheDocument();
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

describe("รายงานยอดซื้อ — ไฟล์ CSV", () => {
  const csvWithName = (name: string) => () =>
    new Response("a,b", { headers: { "Content-Type": "text/csv", "Content-Disposition": name } });

  it("ใช้ชื่อไฟล์ของเซิร์ฟเวอร์ (มีรหัสสาขา) — สองสาขาช่วงเดียวกันไม่ชื่อซ้ำ", async () => {
    const save = vi.spyOn(navigation, "saveBlob").mockImplementation(() => undefined);
    const branchUrl = `${THIS_MONTH}&branch_id=${BRANCH_2.id}`;
    const { user } = await open(`/reports/purchase?branch_id=${BRANCH_2.id}`, {
      [`GET ${branchUrl}`]: () => json(REPORT),
      [`GET ${branchUrl}&format=csv`]: csvWithName('attachment; filename="purchase_2026-09-01_2026-09-29_00001.csv"'),
    });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    await user.click(csvButton());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1]).toBe("purchase_2026-09-01_2026-09-29_00001.csv");
  });

  it("ไม่มี Content-Disposition → ชื่อสำรองมีรหัสสาขาและโลหะที่กรอง", async () => {
    const save = vi.spyOn(navigation, "saveBlob").mockImplementation(() => undefined);
    const url = `${THIS_MONTH}&metal=gold&branch_id=${BRANCH_2.id}`;
    const { user } = await open(`/reports/purchase?metal=gold&branch_id=${BRANCH_2.id}`, {
      [`GET ${url}`]: () => json(REPORT),
      [`GET ${url}&format=csv`]: () => new Response("a,b"),
    });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    await user.click(csvButton());

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1]).toBe("รายงานยอดซื้อ_2026-09-01_2026-09-29_00001_gold.csv");
  });

  it("ช่วงวันที่ใน URL กลับด้าน → ปุ่ม CSV กดไม่ได้", async () => {
    await open("/reports/purchase?date_from=2026-09-10&date_to=2026-09-01");

    expect(await screen.findByText("วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด")).toBeInTheDocument();
    expect(csvButton()).toBeDisabled();
  });

  it("session หมดระหว่างดาวน์โหลด (401) → ไปหน้า login พร้อม redirect กลับ (ไม่ใช่แค่ toast)", async () => {
    let signedIn = true;
    const { router, user } = await open("/reports/purchase", {
      "GET /api/me": () =>
        signedIn ? json(makeMe("manager", [BRANCH_HQ, BRANCH_2])) : json({ error: "unauthorized" }, 401),
      [`GET ${THIS_MONTH}&format=csv`]: () => {
        signedIn = false;
        return json({ error: "unauthorized" }, 401);
      },
    });
    await screen.findByRole("region", { name: "สรุปยอดซื้อ" });

    await user.click(csvButton());

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toEqual({ redirect: "/reports/purchase" });
  });
});
