import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigation } from "@/lib/navigation";
import type { Me } from "@/lib/queries";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

// 10:00 น. 29 ก.ย. 2569 เวลาไทย — เดือนก่อนหน้า = ส.ค. 2569
const NOW = new Date("2026-09-29T03:00:00Z");
const DEFAULT_URL = "/api/reports/export?year=2026&month=08";

afterEach(() => {
  vi.useRealTimers();
});

async function open(routes: Parameters<typeof fakeApi>[0] = {}, me: Me = makeMe("accounting", [BRANCH_HQ, BRANCH_2])) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const api = fakeApi({
    "GET /api/me": () => json(me),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    ...routes,
  });
  const router = renderApp("/reports/export");
  await screen.findByRole("heading", { level: 1, name: "ส่งบัญชีรายเดือน" });
  return { api, router, user: userEvent.setup() };
}

const exportCalls = (api: Awaited<ReturnType<typeof open>>["api"]) =>
  api.calls.filter((call) => call.path.startsWith("/api/reports/export"));

const download = () => screen.getByRole("button", { name: "ดาวน์โหลด" });

describe("ส่งบัญชีรายเดือน", () => {
  it("ค่าเริ่มต้น = เดือนก่อนหน้าตามเวลาไทย · อธิบายไฟล์ในซิป · คำแนะนำลองใหม่เมื่อดาวน์โหลดไม่สำเร็จ", async () => {
    await open();

    const year = screen.getByLabelText("ปี");
    const month = screen.getByLabelText("เดือน");
    expect(year).toHaveValue("2026");
    expect(month).toHaveValue("08");
    expect(within(year).getByRole("option", { name: "พ.ศ. 2569" }).getAttribute("value")).toBe("2026");
    expect(within(month).getByRole("option", { name: "สิงหาคม" }).getAttribute("value")).toBe("08");

    expect(screen.getByText(/manifest\.json/)).toBeInTheDocument();
    expect(screen.getByText(/ไม่มีสำเนาบัตรประชาชน/)).toBeInTheDocument();
    expect(screen.getByText("หากดาวน์โหลดไม่สำเร็จ ให้ลองใหม่")).toBeInTheDocument();
  });

  it("ส่ง HEAD เช็คก่อนด้วยปี ค.ศ. + เดือน + สาขาที่เลือก · 2xx ค่อย navigate ไปดาวน์โหลดจริง (ไม่ fetch ตัวไฟล์)", async () => {
    const otherUrl = `/api/reports/export?year=2025&month=03&branch_id=${BRANCH_2.id}`;
    const { api, user } = await open({
      [`HEAD ${DEFAULT_URL}`]: () => new Response(null, { status: 200 }),
      [`HEAD ${otherUrl}`]: () => new Response(null, { status: 200 }),
    });
    vi.spyOn(navigation, "downloadAt").mockImplementation(() => undefined);

    await user.click(download());
    await waitFor(() => expect(navigation.downloadAt).toHaveBeenCalledWith(DEFAULT_URL));
    expect(exportCalls(api).map((c) => `${c.method} ${c.path}`)).toEqual([`HEAD ${DEFAULT_URL}`]);
    expect(download()).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("ปี"), "2025");
    await user.selectOptions(screen.getByLabelText("เดือน"), "03");
    await user.selectOptions(screen.getByLabelText("สาขา"), BRANCH_2.id);
    await user.click(download());
    await waitFor(() => expect(navigation.downloadAt).toHaveBeenCalledWith(otherUrl));
  });

  it.each([
    [400 as const, { error: "month ต้องเป็นเดือน 1–12 เช่น 09", field: "month" }, "month ต้องเป็นเดือน 1–12 เช่น 09"],
    [403 as const, { error: "forbidden" }, "ไม่มีสิทธิ์"],
    [404 as const, { error: "not found" }, "ไม่พบข้อมูล"],
  ])("HEAD %i → แจ้ง error ที่แมปแล้ว ไม่ navigate ไปดาวน์โหลด", async (status, body, expectedText) => {
    const { user } = await open({ [`HEAD ${DEFAULT_URL}`]: () => json(body, status) });
    vi.spyOn(navigation, "downloadAt").mockImplementation(() => undefined);

    await user.click(download());
    expect(await screen.findByText(expectedText)).toBeInTheDocument();
    expect(navigation.downloadAt).not.toHaveBeenCalled();
    if (status === 400) expect(screen.getByLabelText("เดือน")).toHaveFocus();
    else expect(download()).toHaveFocus();
  });

  it.each(["staff", "manager"] as const)("role %s เห็นสถานะไม่มีสิทธิ์แทนฟอร์ม ไม่เรียก API export", async (role) => {
    const { api } = await open({}, makeMe(role, [BRANCH_HQ]));
    expect(await screen.findByText("ไม่มีสิทธิ์ส่งบัญชีรายเดือน")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ดาวน์โหลด" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ปี")).not.toBeInTheDocument();
    expect(exportCalls(api)).toEqual([]);
  });
});
