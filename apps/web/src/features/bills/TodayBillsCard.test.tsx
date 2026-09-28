import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Me, Role } from "@/lib/queries";
import { BRANCH_2, BRANCH_HQ, GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { t } from "./i18n";
import { BILL, VOID_BILL, buyList } from "./test-data";

// 01:30 น. วันที่ 28 เวลาไทย แต่ยังเป็นวันที่ 27 ใน UTC — "วันนี้" ของร้านต้องเป็นวันตามเวลาไทย
const NOW = new Date("2026-09-27T18:30:00Z");
const TODAY_BUYS = `/api/buy?date_from=2026-09-28&date_to=2026-09-28&branch_id=${BRANCH_HQ.id}`;
/** โหลดครั้งแรกทั้งแอป — เผื่อเครื่องที่รันเทสต์ขนานกันช้า */
const FIRST_LOAD = { timeout: 10_000 };

afterEach(() => {
  vi.useRealTimers();
});

function openHome({
  me = makeMe("staff"),
  list = () => buyList([BILL, VOID_BILL]),
}: {
  me?: Me;
  list?: () => Response;
}) {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const api = fakeApi({
    "GET /api/me": () => json(me),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    [`GET ${TODAY_BUYS}`]: list,
  });
  renderApp("/");
  return api;
}

const findCard = () => screen.findByRole("region", { name: t("today.title") }, FIRST_LOAD);

describe("หน้าแรก — บิลซื้อเข้าวันนี้", { timeout: 30_000 }, () => {
  it("ใช้คำขอเดียวกับการ์ดยอดซื้อวันนี้ · แถวแสดงเวลา ยอด และลิงก์ไปหน้าบิล · ไม่แสดงยอดรวมซ้ำ", async () => {
    const api = openHome({});
    const card = await findCard();

    const link = await within(card).findByRole("link", { name: BILL.doc_no }, FIRST_LOAD);
    expect(link).toHaveAttribute("href", `/buy/${BILL.id}`);
    expect(within(card).getByRole("columnheader", { name: t("columns.time") })).toBeInTheDocument();
    expect(within(card).getByText("14:05")).toBeInTheDocument();
    expect(within(card).getByText("12,345,678,901,234,567.89")).toBeInTheDocument();
    expect(within(card).getByText("1 XXXX XXXXX 01 0")).toBeInTheDocument();
    // การ์ดไม่มีคอลัมน์ผู้บันทึก/สถานะ — บิลยกเลิกติดป้ายข้างเลขที่แทน
    expect(within(card).queryByRole("columnheader", { name: t("columns.createdBy") })).not.toBeInTheDocument();
    expect(within(card).queryByRole("columnheader", { name: t("columns.status") })).not.toBeInTheDocument();
    expect(within(card).getByText(t("status.void"))).toBeInTheDocument();

    const totals = screen.getByRole("region", { name: "ยอดซื้อวันนี้" });
    expect(await within(totals).findByText("99,999,999,999,999.99")).toBeInTheDocument();
    expect(within(card).queryByText("99,999,999,999,999.99")).not.toBeInTheDocument();
    expect(api.callsTo("GET", "/api/buy")).toHaveLength(1);
    expect(api.callsTo("GET", TODAY_BUYS)).toHaveLength(1);

    expect(within(card).getByRole("link", { name: t("today.viewAll") })).toHaveAttribute(
      "href",
      "/bills?from=2026-09-28&to=2026-09-28",
    );
    expect(within(card).queryByText(t("today.latestOnly", { count: "50" }))).not.toBeInTheDocument();
  });

  it("เกิน 50 ใบ → บอกว่าแสดงเฉพาะใบล่าสุด", async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      ...BILL,
      id: `7f1c2d3e-0000-4000-8000-${String(i).padStart(12, "0")}`,
      doc_no: `RC6909-${String(i + 1).padStart(4, "0")}`,
    }));
    openHome({ list: () => buyList(items, { has_more: true }) });
    const card = await findCard();

    expect(await within(card).findByText(t("today.latestOnly", { count: "50" }), {}, FIRST_LOAD)).toBeInTheDocument();
    expect(within(card).getAllByRole("row")).toHaveLength(51);
  });

  it("ผู้ใช้หลายสาขา: ดูทั้งหมดส่งสาขาปัจจุบันไปหน้าค้นบิลด้วย (ชุดเดียวกับการ์ด)", async () => {
    openHome({ me: makeMe("manager", [BRANCH_HQ, BRANCH_2]) });
    const card = await findCard();

    expect(await within(card).findByRole("link", { name: t("today.viewAll") }, FIRST_LOAD)).toHaveAttribute(
      "href",
      `/bills?from=2026-09-28&to=2026-09-28&branch=${BRANCH_HQ.id}`,
    );
  });

  it.each<[Role, boolean]>([
    ["staff", true],
    ["manager", true],
    ["accounting", false],
  ])("วันนี้ยังไม่มีบิล — %s เห็นปุ่มซื้อเข้า: %s", async (role, canBuy) => {
    openHome({ me: makeMe(role), list: () => buyList([]) });
    const card = await findCard();

    expect(await within(card).findByText(t("today.empty"), {}, FIRST_LOAD)).toBeInTheDocument();
    expect(within(card).queryByRole("table")).not.toBeInTheDocument();
    const buy = within(card).queryByRole("link", { name: t("today.buy") });
    if (canBuy) expect(buy).toHaveAttribute("href", "/buy");
    else expect(buy).not.toBeInTheDocument();
  });

  it("ยังไม่ได้เลือกสาขา → บอกให้เลือก และไม่ถาม API (fail-closed)", async () => {
    const api = openHome({ me: makeMe("staff", []) });
    const card = await findCard();

    expect(within(card).getByText(t("today.noBranch"))).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: t("today.viewAll") })).not.toBeInTheDocument();
    expect(api.calls.filter((call) => call.path.startsWith("/api/buy"))).toEqual([]);
  });

  it("โหลดไม่ได้ → แจ้งพร้อมปุ่มลองใหม่", async () => {
    openHome({ list: () => json({ error: "ไม่มีสิทธิ์" }, 403) });
    const card = await findCard();

    expect(await within(card).findByText(t("today.loadError"), {}, FIRST_LOAD)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: t("retry") })).toBeInTheDocument();
  });
});
