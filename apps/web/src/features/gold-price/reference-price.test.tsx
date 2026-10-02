import { focusManager } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/queries";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

const LABEL = "ราคาทองแท่งขายออก (บาท)";
/** ราคาสมาคมสมมติ — ต่างจากราคาร้าน (GOLD_PRICE 67,850) เพื่อแยกบนจอได้ */
const REFERENCE = {
  source: "classic.goldtraders.or.th",
  announced_at: "2026-09-28T09:31:00+07:00",
  round: 2,
  bar_buy: "68050.00",
  bar_sell: "68250.00",
  ornament_buy: "66683.52",
  ornament_sell: "69050.00",
  fetched_at: "2026-09-28T02:35:00.000Z",
  stale: false,
};
const QUOTE_68250 = { bar_sell: "68250.00", bar_buy: "68050.00", jewelry_buy: "64648" };
const SAVED = { ...GOLD_PRICE, ...QUOTE_68250 };
/** ประกาศที่ส่งไปกับ PUT เมื่อเติมจากราคาสมาคม (คำอ้างของ client — เซิร์ฟเวอร์เทียบเอง) */
const PREFILL = { announced_at: REFERENCE.announced_at, round: REFERENCE.round };
const UNAVAILABLE = { error: "ดึงราคาอ้างอิงไม่ได้", reason: "unavailable" };

function setup(role: Role, routes: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    "GET /api/me": () => json(makeMe(role)),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "GET /api/gold-price/reference": () => json(REFERENCE),
    "POST /api/gold-price/quote": () => json(QUOTE_68250),
    "GET /api/gold-price/today/branches": () => json([]),
    ...routes,
  });
}

const referenceRegion = () => screen.findByRole("region", { name: "ราคาสมาคม (อ้างอิง)" });

describe("ราคาสมาคม (อ้างอิง) — หน้าหลัก", () => {
  it("แสดงราคา 4 ค่า + ครั้งที่ + เวลาประกาศ + ที่มา แยกจากกระดานราคาของร้าน", async () => {
    setup("staff");
    renderApp("/");
    const region = await referenceRegion();
    await waitFor(() => expect(region).toHaveTextContent("68,250"));
    expect(region).toHaveTextContent("อ้างอิง");
    expect(region).toHaveTextContent("ครั้งที่ 2");
    expect(region).toHaveTextContent("28 ก.ย. 2569");
    expect(region).toHaveTextContent("09:31");
    expect(region).toHaveTextContent("classic.goldtraders.or.th");
    expect(region).toHaveTextContent("66,683.52");
    expect(region).toHaveTextContent("69,050");
    // กระดานราคาของร้านยังเป็นราคาที่บันทึก (67,850) ไม่ใช่ราคาสมาคม
    const board = screen.getByRole("region", { name: "ราคาทองวันนี้" });
    expect(board).toHaveTextContent("67,850");
    expect(within(region).queryByText("67,850")).not.toBeInTheDocument();
    // หน้าหลักไม่มีปุ่มเติมค่า
    expect(within(region).queryByRole("button")).not.toBeInTheDocument();
  });

  it("การ์ด 4 ใบตามลำดับของเจ้าของร้าน — ป้ายกับตัวเลขของค่าเดียวกันอยู่ในการ์ดเดียวกัน", async () => {
    setup("staff");
    renderApp("/");
    const region = await referenceRegion();
    const terms = await within(region).findAllByRole("term");
    const pairs = terms.map((term) => {
      const card = term.closest<HTMLElement>("[data-slot=card]");
      return [term.textContent, card && within(card).getByRole("definition").textContent];
    });
    expect(pairs).toEqual([
      ["ทองคำแท่ง รับซื้อ", "68,050บาท"],
      ["ทองคำแท่ง ขายออก", "68,250บาท"],
      ["ทองรูปพรรณ รับซื้อ", "66,683.52บาท"],
      ["ทองรูปพรรณ ขายออก", "69,050บาท"],
    ]);
    expect(within(region).getAllByRole("definition")).toHaveLength(4);
    // jsdom ไม่คำนวณ layout — สัญญาของ class: การ์ดต่อแถวตามความกว้างของกรอบเอง (container query) ไม่ใช่ของจอ
    // กรอบนี้อยู่ในการ์ดครึ่งจอของหน้าตั้งราคาด้วย (sm:grid-cols-4 แบบเดิมล้นการ์ดที่จอ 1024–1280 px)
    expect(region).toHaveClass("@container/reference");
    const columns = [...(region.querySelector("dl")?.classList ?? [])].filter((c) => c.includes("grid-cols-"));
    expect(columns).not.toEqual([]);
    expect(columns.filter((c) => !c.includes("/reference:"))).toEqual([]);
  });

  it("ทั้ง 4 ค่าจัดรูปแบบกระดานเดียวกัน — บาทเต็มไม่มี .00 (รวมทองรูปพรรณรับซื้อ) · มีสตางค์แสดงครบ ไม่ปัดทิ้ง", async () => {
    setup("staff", {
      "GET /api/gold-price/reference": () =>
        json({ ...REFERENCE, ornament_buy: "66683.00", ornament_sell: "69050.50" }),
    });
    renderApp("/");
    const region = await referenceRegion();
    const values = (await within(region).findAllByRole("definition")).map((value) => value.textContent);
    expect(values).toEqual(["68,050บาท", "68,250บาท", "66,683บาท", "69,050.50บาท"]);
  });

  it("ระหว่างดึง → aria-busy + ประกาศว่ากำลังดึง · โครงการ์ดใน grid เดียวกับตอนมีข้อมูล (การ์ดไม่กระโดด)", async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = setup("staff", {
      "GET /api/gold-price/reference": () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    renderApp("/");
    const region = await referenceRegion();
    await waitFor(() => expect(api.callsTo("GET", "/api/gold-price/reference")).toHaveLength(1));
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByText("กำลังดึงราคาสมาคม…")).toBeInTheDocument();
    expect(within(region).queryByRole("term")).not.toBeInTheDocument();
    // บรรทัดประกาศ + การ์ด 4 ใบ
    const placeholders = region.querySelectorAll("[data-slot=skeleton]");
    expect(placeholders).toHaveLength(5);
    const loadingGrid = placeholders[1]?.parentElement?.className;

    answer(json(REFERENCE));
    await waitFor(() => expect(region).toHaveAttribute("aria-busy", "false"));
    expect(within(region).getAllByRole("definition")).toHaveLength(4);
    expect(region.querySelector("dl")?.className).toBe(loadingGrid);
    expect(region.querySelector("[data-slot=skeleton]")).not.toBeInTheDocument();
    expect(within(region).queryByText("กำลังดึงราคาสมาคม…")).not.toBeInTheDocument();
  });

  it("stale → คำเตือนว่าอาจไม่ใช่ประกาศล่าสุด", async () => {
    setup("staff", { "GET /api/gold-price/reference": () => json({ ...REFERENCE, stale: true }) });
    renderApp("/");
    const region = await referenceRegion();
    await waitFor(() => expect(region).toHaveTextContent("อาจไม่ใช่ประกาศล่าสุดของวันนี้"));
    // คำเตือนมาก่อนตัวเลข — จอแคบการ์ดเรียงลงมา 4 ใบ คำเตือนท้ายกรอบจะเลื่อนไม่ถึง
    const warning = within(region).getByText(/อาจไม่ใช่ประกาศล่าสุดของวันนี้/);
    const firstValue = within(region).getByText("ทองคำแท่ง รับซื้อ");
    expect(warning.compareDocumentPosition(firstValue) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("503 → 'ดึงราคาอ้างอิงไม่ได้' ไม่มีตัวเลขราคา · กระดานร้านยังแสดงปกติ", async () => {
    const api = setup("staff", { "GET /api/gold-price/reference": () => json(UNAVAILABLE, 503) });
    renderApp("/");
    const region = await referenceRegion();
    await waitFor(() => expect(region).toHaveTextContent("ดึงราคาอ้างอิงไม่ได้"));
    expect(region).not.toHaveTextContent("68,250");
    expect(screen.getByRole("region", { name: "ราคาทองวันนี้" })).toHaveTextContent("67,850");
    // ไม่ลองซ้ำเอง (เซิร์ฟเวอร์ cache/พักการดึงอยู่แล้ว)
    expect(api.callsTo("GET", "/api/gold-price/reference")).toHaveLength(1);
  });

  it("ปิดไว้ (reason disabled) → บอกว่ายังไม่ได้เปิดใช้", async () => {
    setup("staff", {
      "GET /api/gold-price/reference": () => json({ error: "ดึงราคาอ้างอิงไม่ได้", reason: "disabled" }, 503),
    });
    renderApp("/");
    const region = await referenceRegion();
    await waitFor(() => expect(region).toHaveTextContent("ยังไม่ได้เปิดใช้การดึงราคาสมาคม"));
  });

  it("ร้านยังไม่ตั้งราคาวันนี้ → ผู้จัดการเห็นลิงก์ไปตั้งราคา · ราคาสมาคมยังแสดงแยก", async () => {
    setup("manager", { "GET /api/gold-price/today": () => json({ error: "ยังไม่ได้ตั้งราคาทองของวันนี้" }, 404) });
    renderApp("/");
    expect(await screen.findByRole("link", { name: "ตั้งราคาทองวันนี้" })).toHaveAttribute(
      "href",
      "/settings/gold-price",
    );
    await waitFor(async () => expect(await referenceRegion()).toHaveTextContent("68,250"));
  });
});

describe("ราคาสมาคม (อ้างอิง) — /settings/gold-price", () => {
  async function open(routes: Parameters<typeof fakeApi>[0] = {}) {
    const api = setup("manager", routes);
    renderApp("/settings/gold-price");
    await screen.findByRole("heading", { level: 1, name: "ตั้งราคาทองวันนี้" });
    return { api, user: userEvent.setup() };
  }
  const putBodies = (api: ReturnType<typeof setup>) =>
    api.callsTo("PUT", "/api/gold-price/today").map((call) => call.body);

  it("ปุ่ม 'ใช้ราคาสมาคมเป็นค่าเริ่มต้น' เติมช่องแต่ไม่บันทึก · บันทึกเมื่อกดเองพร้อม from_reference", async () => {
    const { api, user } = await open({ "PUT /api/gold-price/today": () => json(SAVED) });
    // วันนี้มีราคาแล้ว → ไม่เติมเอง
    expect(screen.getByLabelText(LABEL)).toHaveValue("");
    await user.click(await screen.findByRole("button", { name: "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" }));

    expect(screen.getByLabelText(LABEL)).toHaveValue("68250.00");
    expect(screen.getByLabelText(LABEL)).toHaveFocus();
    expect(screen.getByText(/ยังไม่ได้บันทึก/)).toBeInTheDocument();
    // live preview มาจากเซิร์ฟเวอร์ แต่ยังไม่มี PUT
    await waitFor(() => expect(api.callsTo("POST", "/api/gold-price/quote")).not.toHaveLength(0));
    expect(putBodies(api)).toEqual([]);

    await user.keyboard("{Enter}");
    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    expect(putBodies(api)).toEqual([{ bar_sell: "68250.00", from_reference: PREFILL }]);
    expect(screen.queryByText(/ยังไม่ได้บันทึก/)).not.toBeInTheDocument();
  });

  it("เติมแล้วพิมพ์แก้ → ไม่นับว่ามาจากราคาสมาคม (ไม่ส่ง from_reference)", async () => {
    const { api, user } = await open({ "PUT /api/gold-price/today": () => json(SAVED) });
    await user.click(await screen.findByRole("button", { name: "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" }));
    await user.clear(screen.getByLabelText(LABEL));
    await user.keyboard("68300{Enter}");
    await screen.findByText("บันทึกราคาทองวันนี้แล้ว");
    expect(putBodies(api)).toEqual([{ bar_sell: "68300" }]);
  });

  it("วันนี้ยังไม่มีราคา → เติมราคาสมาคมให้เอง + 'ยังไม่ได้บันทึก' · ไม่บันทึกจนกด", async () => {
    const { api } = await open({
      "GET /api/gold-price/today": () => json({ error: "ยังไม่ได้ตั้งราคาทองของวันนี้" }, 404),
    });
    await waitFor(() => expect(screen.getByLabelText(LABEL)).toHaveValue("68250.00"));
    expect(screen.getByText(/ยังไม่ได้บันทึก/)).toBeInTheDocument();
    expect(putBodies(api)).toEqual([]);
  });

  it("ราคาสมาคม stale → ไม่เติมเอง และไม่มีปุ่มเติม (ต้องกรอกเองจากประกาศล่าสุด)", async () => {
    await open({
      "GET /api/gold-price/today": () => json({ error: "ยังไม่ได้ตั้งราคาทองของวันนี้" }, 404),
      "GET /api/gold-price/reference": () => json({ ...REFERENCE, stale: true }),
    });
    const region = await referenceRegion();
    await waitFor(() => expect(region).toHaveTextContent("เติมเป็นค่าเริ่มต้นไม่ได้"));
    expect(screen.queryByRole("button", { name: "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(LABEL)).toHaveValue("");
  });

  describe("ประกาศใหม่มาหลังเติมค่า", () => {
    afterEach(() => {
      vi.useRealTimers();
      focusManager.setFocused(undefined);
    });

    /** ให้ query ราคาสมาคมเก่ากว่า staleTime (5 นาที) แล้วกลับมาที่หน้าต่าง → TanStack Query ดึงใหม่ */
    function refetchReference() {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 6 * 60_000);
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    }

    it("ราคาใหม่ต่างจากค่าในช่อง → เตือน · บันทึกโดยไม่ส่ง from_reference", async () => {
      let current = REFERENCE;
      const { api, user } = await open({
        "GET /api/gold-price/reference": () => json(current),
        "PUT /api/gold-price/today": () => json(SAVED),
      });
      await user.click(await screen.findByRole("button", { name: "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" }));
      expect(screen.getByText(/ยังไม่ได้บันทึก/)).toBeInTheDocument();

      current = {
        ...REFERENCE,
        announced_at: "2026-09-28T10:15:00+07:00",
        round: 3,
        bar_sell: "68400.00",
        bar_buy: "68200.00",
      };
      refetchReference();
      expect(await screen.findByText(/มีประกาศใหม่ของสมาคมหลังเติมค่า/)).toBeInTheDocument();
      expect(screen.queryByText(/ยังไม่ได้บันทึก/)).not.toBeInTheDocument();

      screen.getByLabelText(LABEL).focus();
      await user.keyboard("{Enter}");
      await screen.findByText("บันทึกราคาทองวันนี้แล้ว");
      expect(putBodies(api)).toEqual([{ bar_sell: "68250.00" }]);
    });

    it("ประกาศใหม่แต่ราคาเท่าเดิม → ยังนับว่ามาจากราคาสมาคม (ประกาศที่เติมมา)", async () => {
      let current = REFERENCE;
      const { api, user } = await open({
        "GET /api/gold-price/reference": () => json(current),
        "PUT /api/gold-price/today": () => json(SAVED),
      });
      await user.click(await screen.findByRole("button", { name: "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" }));
      current = { ...REFERENCE, announced_at: "2026-09-28T10:15:00+07:00", round: 3 };
      refetchReference();
      await waitFor(() => expect(api.callsTo("GET", "/api/gold-price/reference")).toHaveLength(2));
      expect(screen.getByText(/ยังไม่ได้บันทึก/)).toBeInTheDocument();
      screen.getByLabelText(LABEL).focus();
      await user.keyboard("{Enter}");
      await screen.findByText("บันทึกราคาทองวันนี้แล้ว");
      expect(putBodies(api)).toEqual([{ bar_sell: "68250.00", from_reference: PREFILL }]);
    });
  });

  it("ดึงราคาสมาคมไม่ได้ → แจ้ง · ไม่มีปุ่มเติม · ฟอร์มกรอกเองได้ตามเดิม", async () => {
    const { api, user } = await open({
      "GET /api/gold-price/reference": () => json(UNAVAILABLE, 503),
      "PUT /api/gold-price/today": () => json(SAVED),
    });
    const region = await referenceRegion();
    await waitFor(() => expect(region).toHaveTextContent("ดึงราคาอ้างอิงไม่ได้"));
    expect(screen.queryByRole("button", { name: "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" })).not.toBeInTheDocument();
    await user.keyboard("68250{Enter}");
    await screen.findByText("บันทึกราคาทองวันนี้แล้ว");
    expect(putBodies(api)).toEqual([{ bar_sell: "68250" }]);
  });

  it("เติมแล้วโดนด่านกันพิมพ์ผิด → ยืนยันแล้วส่ง confirm_typo + from_reference", async () => {
    const warning = "ราคาห่างจากครั้งก่อน 5.0% — ตรวจสอบก่อนบันทึก";
    const { api, user } = await open({
      "PUT /api/gold-price/today": ({ body }) =>
        (body as { confirm_typo?: boolean }).confirm_typo
          ? json(SAVED)
          : json({ error: warning, field: "confirm_typo", warning }, 409),
    });
    await user.click(await screen.findByRole("button", { name: "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" }));
    await user.keyboard("{Enter}");
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "ยืนยันบันทึกราคานี้" }));
    await screen.findByText("บันทึกราคาทองวันนี้แล้ว");
    expect(putBodies(api)).toEqual([
      { bar_sell: "68250.00", from_reference: PREFILL },
      { bar_sell: "68250.00", confirm_typo: true, from_reference: PREFILL },
    ]);
  });

  it("การ์ด 4 ใบเหมือนหน้าหลัก · ปุ่มเติมค่า (action) อยู่ในกรอบเดียวกัน ใต้การ์ด", async () => {
    await open();
    const region = await referenceRegion();
    const button = await within(region).findByRole("button", { name: "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" });
    const values = within(region).getAllByRole("definition");
    expect(values.map((value) => value.textContent)).toEqual(["68,050บาท", "68,250บาท", "66,683.52บาท", "69,050บาท"]);
    const cards = region.querySelector("dl");
    expect(cards && cards.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });
});
