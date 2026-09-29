import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
import type { Me } from "@/lib/queries";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

// 10:00 น. 29 ก.ย. 2569 เวลาไทย
const NOW = new Date("2026-09-29T03:00:00Z");
const TODAY = "/api/reports/stock?as_of=2026-09-29";

const cell = (metal_code: string, name_th: string, grams: string) => ({ metal_code, name_th, grams });

/** รวมทุกสาขา "บวกแถวไม่ได้" โดยตั้งใจ — ต้องมาจาก `total` ของ API ตรงตัว · มีค่าติดลบ (ยกเลิกบิล) ได้ */
const STOCK = {
  as_of: "2026-09-29",
  by_branch: [
    {
      branch: BRANCH_HQ,
      by_metal: [cell("gold", "ทองคำ", "1234.560"), cell("nak", "นาก", "0.000"), cell("silver", "เงิน", "-2.500")],
    },
    {
      branch: BRANCH_2,
      by_metal: [cell("gold", "ทองคำ", "10.000"), cell("nak", "นาก", "5.250"), cell("silver", "เงิน", "100.000")],
    },
  ],
  total: {
    by_metal: [cell("gold", "ทองคำ", "987654321.123"), cell("nak", "นาก", "5.250"), cell("silver", "เงิน", "97.500")],
  },
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
    [`GET ${TODAY}`]: () => json(STOCK),
    "GET /api/reports/stock": () => json(STOCK),
    ...routes,
  });
  const router = renderApp(path);
  await screen.findByRole("heading", { level: 1, name: "สต็อกคงเหลือ" });
  return { api, router, user: userEvent.setup() };
}

const stockCalls = (api: Awaited<ReturnType<typeof open>>["api"]) =>
  api.calls.filter((call) => call.path.startsWith("/api/reports/stock")).map((call) => call.path);
const matrix = () => screen.findByRole("table", { name: "สต็อกคงเหลือแยกตามสาขาและประเภทโลหะ หน่วยกรัม" });

describe("สต็อกคงเหลือ", () => {
  it("ค่าเริ่มต้น ณ วันนี้ · ตาราง สาขา × โลหะ · แถวรวมจาก `total` ของ API · ลิงก์ CSV", async () => {
    const { api } = await open("/reports/stock");

    const table = await matrix();
    expect(stockCalls(api)).toEqual([TODAY]);
    expect(screen.getByLabelText("ณ วันที่")).toHaveValue("29/09/2569");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["สาขา", "ทองคำ (กรัม)", "นาก (กรัม)", "เงิน (กรัม)"]);

    const hq = within(table).getByRole("row", { name: /00000 สำนักงานใหญ่/ });
    expect(within(hq).getByRole("cell", { name: "1,234.560" })).toHaveClass("tabular-nums");
    expect(within(hq).getByRole("cell", { name: "-2.500" })).toBeInTheDocument();
    const total = within(table).getByRole("row", { name: /รวมทุกสาขา/ });
    expect(
      within(total)
        .getAllByRole("cell")
        .map((td) => td.textContent),
    ).toEqual(["987,654,321.123", "5.250", "97.500"]);

    expect(screen.getByText("ณ วันที่ 29/09/2569")).toBeInTheDocument();
    expect(screen.getByLabelText("ณ วันที่")).toHaveAttribute("placeholder", "วว/ดด/ปปปป");
  });

  it("CSV: ขอตามตัวกรองที่ใช้แล้ว → บันทึกไฟล์ชื่อไทย + toast · ล้มเหลว = toast ค้าง ไม่บันทึกไฟล์", async () => {
    const save = vi.spyOn(navigation, "saveBlob").mockImplementation(() => undefined);
    let fail = false;
    const { api, user } = await open("/reports/stock", {
      [`GET ${TODAY}&format=csv`]: () =>
        fail ? json({ error: "forbidden" }, 403) : new Response("a,b", { headers: { "Content-Type": "text/csv" } }),
    });
    await matrix();

    await user.click(screen.getByRole("button", { name: "ดาวน์โหลด CSV" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[1]).toBe("สต็อกคงเหลือ_2026-09-29.csv");
    expect(stockCalls(api)).toEqual([TODAY, `${TODAY}&format=csv`]);
    expect(await screen.findByText("ดาวน์โหลด สต็อกคงเหลือ_2026-09-29.csv แล้ว")).toBeInTheDocument();

    fail = true;
    await user.click(screen.getByRole("button", { name: "ดาวน์โหลด CSV" }));
    expect(await screen.findByText("ดาวน์โหลด CSV ไม่สำเร็จ — ไม่มีสิทธิ์")).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("สาขาใช้ทันที · วันที่ที่พิมพ์ใช้เมื่อกด Enter → URL (ISO) → query ของ API", async () => {
    const filtered = `/api/reports/stock?as_of=2026-08-31&branch_id=${BRANCH_2.id}`;
    const { api, router, user } = await open("/reports/stock", {
      [`GET ${filtered}`]: () => json({ ...STOCK, as_of: "2026-08-31" }),
    });
    await matrix();

    const asOf = screen.getByLabelText("ณ วันที่");
    await user.selectOptions(screen.getByLabelText("สาขา"), BRANCH_2.id);
    const withBranch = `${TODAY}&branch_id=${BRANCH_2.id}`;
    await waitFor(() => expect(stockCalls(api)).toEqual([TODAY, withBranch]));
    await user.clear(asOf);
    await user.type(asOf, "31/8/2569{Enter}");

    await waitFor(() => expect(router.state.location.search).toEqual({ as_of: "2026-08-31", branch_id: BRANCH_2.id }));
    await waitFor(() => expect(stockCalls(api)).toEqual([TODAY, withBranch, filtered]));
    expect(await screen.findByText("ณ วันที่ 31/08/2569")).toBeInTheDocument();
  });

  it("ปุ่มลัดสิ้นเดือนที่แล้ว ใช้ทันที", async () => {
    const endOfAugust = "/api/reports/stock?as_of=2026-08-31";
    const { api, user } = await open("/reports/stock", { [`GET ${endOfAugust}`]: () => json(STOCK) });
    await matrix();

    await user.click(screen.getByRole("button", { name: "สิ้นเดือนที่แล้ว" }));
    await waitFor(() => expect(stockCalls(api)).toEqual([TODAY, endOfAugust]));
    expect(screen.getByLabelText("ณ วันที่")).toHaveValue("31/08/2569");
  });

  it("วันที่ผิด → error ใต้ช่อง ไม่ส่ง API", async () => {
    const { api, user } = await open("/reports/stock");
    await matrix();

    const asOf = screen.getByLabelText("ณ วันที่");
    await user.clear(asOf);
    await user.type(asOf, "{Enter}");

    expect(await screen.findByText("กรอกวันที่")).toBeInTheDocument();
    expect(asOf).toHaveAttribute("aria-invalid", "true");
    expect(stockCalls(api)).toEqual([TODAY]);
  });

  it("400 ที่ชี้ช่อง as_of → ข้อความใต้ช่อง “ณ วันที่” (U3) · ไม่ซ้ำในกล่องแจ้ง", async () => {
    await open("/reports/stock", {
      [`GET ${TODAY}`]: () => json({ error: "as_of ต้องไม่ใช่วันในอนาคต", field: "as_of" }, 400),
    });

    expect(await screen.findByText("โหลดรายงานไม่ได้")).toBeInTheDocument();
    expect(screen.getAllByText("as_of ต้องไม่ใช่วันในอนาคต")).toHaveLength(1);
    expect(screen.getByLabelText("ณ วันที่")).toHaveAccessibleDescription(/as_of ต้องไม่ใช่วันในอนาคต/);
  });

  it("staff (API ตอบ 403) → ไม่มีสิทธิ์ดูรายงาน", async () => {
    await open("/reports/stock", { [`GET ${TODAY}`]: () => json({ error: "forbidden" }, 403) }, makeMe("staff"));

    expect(await screen.findByText("ไม่มีสิทธิ์ดูรายงาน")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ดาวน์โหลด CSV" })).not.toBeInTheDocument();
  });
});
