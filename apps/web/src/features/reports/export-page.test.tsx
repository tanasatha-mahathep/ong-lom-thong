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
  ])(
    "HEAD %i → แจ้ง error ที่แมปแล้ว (toast ค้าง + ในฟอร์ม) ไม่ navigate ไปดาวน์โหลด",
    async (status, body, expectedText) => {
      const { user } = await open({ [`HEAD ${DEFAULT_URL}`]: () => json(body, status) });
      vi.spyOn(navigation, "downloadAt").mockImplementation(() => undefined);

      await user.click(download());
      // ข้อความอยู่ทั้งใน toast (ค้างจนกดปิด — U5) และในฟอร์ม (ใต้ช่องที่ API ชี้ หรือกล่องแจ้ง — U3)
      expect((await screen.findAllByText(expectedText)).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole("button", { name: "ปิดการแจ้งเตือน" })).toBeInTheDocument();
      expect(navigation.downloadAt).not.toHaveBeenCalled();
      if (status === 400) {
        expect(screen.getByLabelText("เดือน")).toHaveFocus();
        expect(screen.getByLabelText("เดือน")).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByLabelText("เดือน")).toHaveAccessibleDescription(expectedText);
      } else expect(download()).toHaveFocus();
      expect(download()).toBeEnabled();
    },
  );

  it("เลือกเดือนที่ยังไม่ถึง → error ใต้ช่องเดือนก่อนส่ง (U2) ไม่ยิง HEAD · เลือกเดือนที่ถึงแล้วส่งได้", async () => {
    const { api, user } = await open({
      [`HEAD ${DEFAULT_URL}`]: () => new Response(null, { status: 200 }),
    });
    vi.spyOn(navigation, "downloadAt").mockImplementation(() => undefined);

    await user.selectOptions(screen.getByLabelText("ปี"), "2026");
    await user.selectOptions(screen.getByLabelText("เดือน"), "12");
    await user.click(download());

    expect(await screen.findByText("ยังไม่ถึงเดือนนี้ — เลือกได้ถึงเดือนปัจจุบัน")).toBeInTheDocument();
    expect(screen.getByLabelText("เดือน")).toHaveFocus();
    expect(exportCalls(api)).toEqual([]);
    expect(navigation.downloadAt).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("เดือน"), "08");
    await user.click(download());
    await waitFor(() => expect(navigation.downloadAt).toHaveBeenCalledWith(DEFAULT_URL));
    expect(screen.queryByText("ยังไม่ถึงเดือนนี้ — เลือกได้ถึงเดือนปัจจุบัน")).not.toBeInTheDocument();
  });

  it("ระหว่างตรวจ HEAD: ฟอร์มปิด + ปุ่มหมุน (U4) · กดซ้ำไม่ยิงซ้ำ · เสร็จแล้ว toast “เริ่มดาวน์โหลด” (U5) ไม่มีชั้นบังหน้าจอ (U6)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, user } = await open({
      [`HEAD ${DEFAULT_URL}`]: async () => {
        await gate;
        return new Response(null, { status: 200 });
      },
    });
    vi.spyOn(navigation, "downloadAt").mockImplementation(() => undefined);

    await user.click(download());
    const busy = await screen.findByRole("button", { name: "กำลังตรวจสอบ…" });
    expect(busy).toBeDisabled();
    expect(busy.querySelector("svg[class*='animate-spin']")).not.toBeNull();
    expect(screen.getByLabelText("ปี")).toBeDisabled();
    expect(screen.getByLabelText("เดือน")).toBeDisabled();
    expect(screen.getByRole("form", { name: "เลือกเดือนที่ต้องการส่งบัญชี" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("กำลังทำงาน…")).not.toBeInTheDocument();

    release();
    await waitFor(() => expect(navigation.downloadAt).toHaveBeenCalledWith(DEFAULT_URL));
    expect(await screen.findByText("เริ่มดาวน์โหลดไฟล์แล้ว — ดูในโฟลเดอร์ดาวน์โหลดของเบราว์เซอร์")).toBeInTheDocument();
    expect(exportCalls(api)).toHaveLength(1);
    expect(download()).toBeEnabled();
    expect(screen.getByLabelText("ปี")).toBeEnabled();
  });

  it("session หมดระหว่างเช็ค (401) → ไปหน้า login พร้อม redirect กลับ", async () => {
    let signedIn = true;
    const { router, user } = await open({
      "GET /api/me": () =>
        signedIn ? json(makeMe("accounting", [BRANCH_HQ, BRANCH_2])) : json({ error: "unauthorized" }, 401),
      [`HEAD ${DEFAULT_URL}`]: () => {
        signedIn = false;
        return json({ error: "unauthorized" }, 401);
      },
    });
    vi.spyOn(navigation, "downloadAt").mockImplementation(() => undefined);

    await user.click(download());

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toEqual({ redirect: "/reports/export" });
    expect(navigation.downloadAt).not.toHaveBeenCalled();
  });

  it.each(["staff", "manager"] as const)("role %s เห็นสถานะไม่มีสิทธิ์แทนฟอร์ม ไม่เรียก API export", async (role) => {
    const { api } = await open({}, makeMe(role, [BRANCH_HQ]));
    expect(await screen.findByText("ไม่มีสิทธิ์ส่งบัญชีรายเดือน")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ดาวน์โหลด" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ปี")).not.toBeInTheDocument();
    expect(exportCalls(api)).toEqual([]);
  });
});
