import { configure, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { CUSTOMER_DETAIL, CUSTOMER_ID, CUSTOMER_ROW, EXPIRED_ROW, PNG_1X1 } from "@/test/customers";

const DETAIL_PATH = `/api/customers/${CUSTOMER_ID}`;
const shell = {
  "GET /api/me": () => json(makeMe("staff")),
  "GET /api/gold-price/today": () => json(GOLD_PRICE),
};
const png = () => new Response(PNG_1X1, { headers: { "Content-Type": "image/png" } });

// ทุกเทสต์ในไฟล์นี้โหลดทั้งแอป (router + route chunk) — เครื่องที่รันเทสต์ขนานหนัก ๆ ใช้เกิน 3 วินาทีได้
// เพดานเท่านั้น: find* คืนทันทีที่เจอ เทสต์ที่ผ่านจึงไม่ช้าลง
configure({ asyncUtilTimeout: 10_000 });

/** query string ของทุกคำขอ GET /api/customers ตามลำดับ */
const listQueries = (api: ReturnType<typeof fakeApi>) =>
  api
    .callsTo("GET", "/api/customers")
    .map((call) => Object.fromEntries(new URL(call.path, "http://test.local").searchParams));

beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() });
});

describe("/customers — รายการและค้นหา", () => {
  it("เลขบัตรมาสก์ · ชื่อเป็นลิงก์ไปหน้าลูกค้า · สถานะบัตร", async () => {
    fakeApi({
      ...shell,
      "GET /api/customers": () => json({ items: [CUSTOMER_ROW, EXPIRED_ROW], page: 1, has_more: false }),
    });
    renderApp("/customers");

    await screen.findByRole("link", { name: CUSTOMER_ROW.name_th });
    const table = screen.getByRole("table", { name: "รายชื่อลูกค้า" });
    const [, first, second] = within(table).getAllByRole("row");
    if (!first || !second) throw new Error("rows missing");
    expect(first).toHaveTextContent("1 XXXX XXXXX 45 8");
    expect(within(first).getByRole("link", { name: CUSTOMER_ROW.name_th })).toHaveAttribute(
      "href",
      `/customers/${CUSTOMER_ID}`,
    );
    expect(first).toHaveTextContent("บัตรใช้ได้");
    expect(second).toHaveTextContent("บัตรหมดอายุ");
    expect(table).not.toHaveTextContent("1103700123458");
    expect(screen.getByLabelText("ค้นหาลูกค้า")).toHaveFocus();
  });

  it("พิมพ์คำค้น → ค้นหลังหยุดพิมพ์ · 1 ตัวอักษรไม่ส่ง · อักขระควบคุมถูกตัด", async () => {
    const api = fakeApi({
      ...shell,
      "GET /api/customers": () => json({ items: [CUSTOMER_ROW], page: 1, has_more: false }),
      "GET /api/customers?q=0812": () => json({ items: [CUSTOMER_ROW], page: 1, has_more: false }),
    });
    const router = renderApp("/customers");
    const user = userEvent.setup();
    const box = await screen.findByLabelText("ค้นหาลูกค้า");

    await user.type(box, "0");
    expect(await screen.findByText("ค้นอย่างน้อย 2 ตัวอักษร")).toBeInTheDocument();
    await user.type(box, "8\u000012");

    await waitFor(() => expect(api.callsTo("GET", "/api/customers?q=0812")).toHaveLength(1));
    expect(router.state.location.search).toEqual({ q: "0812" });
    // 1 ตัวอักษร API ตอบ 400 — ต้องไม่ส่ง
    expect(api.calls.some((c) => c.path === "/api/customers?q=0")).toBe(false);
    expect(await screen.findByRole("table", { name: "ผลค้นหาลูกค้า “0812”" })).toBeInTheDocument();
  });

  it("เลขบัตรเต็ม 13 หลัก: ค้นได้ตามปกติแต่ไม่ลงใน URL · คำค้นปกติทับได้", async () => {
    const api = fakeApi({
      ...shell,
      "GET /api/customers": () => json({ items: [CUSTOMER_ROW], page: 1, has_more: false }),
      "GET /api/customers?q=1103700123458": () => json({ items: [CUSTOMER_ROW], page: 1, has_more: false }),
    });
    const router = renderApp("/customers");
    const user = userEvent.setup();
    const box = await screen.findByLabelText("ค้นหาลูกค้า");

    await user.type(box, "1103700123458{Enter}");

    await waitFor(() => expect(api.callsTo("GET", "/api/customers?q=1103700123458")).toHaveLength(1));
    expect(router.state.location.search).toEqual({});
    expect(box).toHaveValue("1103700123458");

    // คำค้นปกติทับคำค้นที่เป็นเลขบัตรได้ (ไม่ค้างอยู่นอก URL ตลอดไป)
    await user.clear(box);
    await user.type(box, "สมชาย{Enter}");
    await waitFor(() => expect(router.state.location.search).toEqual({ q: "สมชาย" }));
  });

  it.each([
    ["จัดกลุ่มแบบหน้าบัตร", "1 1037 00123 45 8"],
    ["ขีดคั่น", "1-1037-00123-45-8"],
    ["12 หลัก", "110370012345"],
    ["ตามด้วยชื่อ", "1103700123458 สมชาย"],
  ])("เลขบัตรแบบ%s: ค้นได้แต่ไม่ลงใน URL", async (_name, typed) => {
    const api = fakeApi({
      ...shell,
      "GET /api/customers": () => json({ items: [CUSTOMER_ROW], page: 1, has_more: false }),
    });
    const router = renderApp("/customers");
    const user = userEvent.setup();
    const box = await screen.findByLabelText("ค้นหาลูกค้า");

    await user.type(box, `${typed}{Enter}`);

    await waitFor(() => expect(listQueries(api)).toContainEqual({ q: typed }));
    expect(router.state.location.search).toEqual({});
    expect(box).toHaveValue(typed);
  });

  it("เบอร์โทร 10 หลักไม่ใช่เลขบัตร: ลงใน URL ตามเดิม", async () => {
    const api = fakeApi({
      ...shell,
      "GET /api/customers": () => json({ items: [CUSTOMER_ROW], page: 1, has_more: false }),
    });
    const router = renderApp("/customers");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("ค้นหาลูกค้า"), "0812345678{Enter}");

    await waitFor(() => expect(router.state.location.search).toEqual({ q: "0812345678" }));
    expect(listQueries(api)).toContainEqual({ q: "0812345678" });
  });

  it("URL ?q=ตัวเลขล้วน (พิมพ์เอง) ยังค้นได้ · Esc ล้างคำค้น · ไม่พบ → บอกคำค้นที่ใช้", async () => {
    fakeApi({
      ...shell,
      "GET /api/customers": () => json({ items: [CUSTOMER_ROW], page: 1, has_more: false }),
      "GET /api/customers?q=9999": () => json({ items: [], page: 1, has_more: false }),
    });
    renderApp("/customers?q=9999");
    const user = userEvent.setup();

    expect(await screen.findByText("ไม่พบลูกค้าที่ตรงกับ “9999”")).toBeInTheDocument();
    const box = screen.getByLabelText("ค้นหาลูกค้า");
    expect(box).toHaveValue("9999");
    await user.type(box, "{Escape}");
    expect(box).toHaveValue("");
    expect(await screen.findByRole("link", { name: CUSTOMER_ROW.name_th })).toBeInTheDocument();
  });

  it("หน้าถัดไปจาก has_more", async () => {
    const api = fakeApi({
      ...shell,
      "GET /api/customers": () => json({ items: [CUSTOMER_ROW], page: 1, has_more: true }),
      "GET /api/customers?page=2": () => json({ items: [EXPIRED_ROW], page: 2, has_more: false }),
    });
    renderApp("/customers");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "ถัดไป" }));
    expect(await screen.findByRole("link", { name: EXPIRED_ROW.name_th })).toBeInTheDocument();
    expect(api.callsTo("GET", "/api/customers?page=2")).toHaveLength(1);
  });

  it("โหลดไม่สำเร็จ → แจ้งและลองใหม่ได้", async () => {
    let fail = true;
    fakeApi({
      ...shell,
      "GET /api/customers": () =>
        fail ? json({ error: "bad request" }, 400) : json({ items: [CUSTOMER_ROW], page: 1, has_more: false }),
    });
    renderApp("/customers");
    const user = userEvent.setup();

    expect(await screen.findByText("โหลดรายชื่อลูกค้าไม่สำเร็จ")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByRole("link", { name: CUSTOMER_ROW.name_th })).toBeInTheDocument();
  });
});

describe("/customers/new → /customers/$id", () => {
  it("บันทึกแล้วไปหน้าลูกค้า พร้อมข้อความยืนยันและเลขบัตรเต็ม", async () => {
    const api = fakeApi({
      ...shell,
      "POST /api/customers": () => json({ id: CUSTOMER_ID }, 201),
      [`GET ${DETAIL_PATH}`]: () => json(CUSTOMER_DETAIL),
    });
    const router = renderApp("/customers/new?from=buy");
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByLabelText("เลขประจำตัวประชาชน")).toHaveFocus());
    expect(screen.getByText("เปิดจากหน้าซื้อเข้า — บันทึกแล้วกลับไปที่แท็บซื้อเข้าได้เลย")).toBeInTheDocument();
    await user.keyboard("1103700123458{Tab}นายทดสอบ ระบบ{Control>}{Enter}{/Control}");

    const banner = await screen.findByRole("status", { name: "" });
    expect(banner).toHaveTextContent("เพิ่มข้อมูลลูกค้าเรียบร้อย");
    expect(banner).toHaveTextContent("กลับไปที่แท็บซื้อเข้าได้เลย");
    expect(banner).toHaveFocus();
    expect(screen.getByText("1 1037 00123 45 8")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/customers/${CUSTOMER_ID}`);
    expect(router.state.location.search).toEqual({ saved: "created", from: "buy" });

    const [post] = api.callsTo("POST", "/api/customers");
    expect(post?.body).toBeInstanceOf(FormData);
    expect((post?.body as FormData).get("national_id")).toBe("1103700123458");
  });

  it("ปิดแท็บไม่ได้ (ไม่ได้เปิดด้วยสคริปต์) → บอกให้กด Ctrl+W", async () => {
    fakeApi({ ...shell, [`GET ${DETAIL_PATH}`]: () => json(CUSTOMER_DETAIL) });
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined);
    renderApp(`/customers/${CUSTOMER_ID}?saved=updated&from=buy`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "ปิดแท็บนี้" }));
    expect(close).toHaveBeenCalledOnce();
    expect(await screen.findByText(/กด Ctrl\+W/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ปิดข้อความ" }));
    expect(screen.queryByText("บันทึกการแก้ไขเรียบร้อย")).not.toBeInTheDocument();
  });
});

describe("/customers/$id — ดูและแก้ไข", () => {
  it("เลขบัตรเต็ม · รูป · บัตรหมดอายุ = บล็อกซื้อเข้า พร้อมปุ่มแก้ไขข้อมูลบัตร", async () => {
    const expired = {
      ...CUSTOMER_DETAIL,
      card_expire_text: "01/01/2560",
      card_expire_date: "2017-01-01",
      card_status: "expired",
      has_photo: true,
    };
    const api = fakeApi({
      ...shell,
      [`GET ${DETAIL_PATH}`]: () => json(expired),
      [`GET ${DETAIL_PATH}/photo`]: png,
    });
    const router = renderApp(`/customers/${CUSTOMER_ID}`);
    const user = userEvent.setup();

    expect(await screen.findByText("1 1037 00123 45 8")).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "รูปลูกค้า" })).toBeInTheDocument();
    expect(api.callsTo("GET", `${DETAIL_PATH}/photo`)).toHaveLength(1);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("บัตรประชาชนหมดอายุแล้ว");
    expect(alert).toHaveTextContent("ซื้อเข้าไม่ได้จนกว่าจะแก้ไขข้อมูลบัตร");

    await user.click(within(alert).getByRole("button", { name: "แก้ไขข้อมูลบัตร" }));
    expect(router.state.location.search).toEqual({ mode: "edit" });
    expect(await screen.findByRole("form", { name: "แก้ไขข้อมูลลูกค้า" })).toBeInTheDocument();
    expect(screen.getByLabelText("เลขประจำตัวประชาชน")).not.toHaveFocus();
  });

  it("แก้ไขแล้วบันทึก → PUT ครบ 10 ช่อง (ไม่มีรูปใหม่) → หน้าดูแสดงเลขบัตรเต็มจาก GET ใหม่ ไม่ใช่เลขมาสก์จาก PUT", async () => {
    let saved = CUSTOMER_DETAIL;
    const api = fakeApi({
      ...shell,
      [`GET ${DETAIL_PATH}`]: () => json(saved),
      [`PUT ${DETAIL_PATH}`]: ({ body }) => {
        const name = (body as FormData).get("name_th");
        saved = { ...saved, name_th: typeof name === "string" ? name : "", updated_at: "2026-09-29T02:00:00.000Z" };
        // API ใหม่ตอบเลขบัตรแบบมาสก์ — ห้ามนำไปแสดงเป็นเลขเต็ม
        return json({ ...saved, national_id: "1 XXXX XXXXX 45 8" });
      },
    });
    const router = renderApp(`/customers/${CUSTOMER_ID}?mode=edit`);
    const user = userEvent.setup();

    const name = await screen.findByLabelText("ชื่อ - นามสกุล (ภาษาไทย)");
    expect(name).toHaveValue(CUSTOMER_DETAIL.name_th);
    await user.clear(name);
    await user.type(name, "นายแก้ไข แล้ว");
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(await screen.findByText("บันทึกการแก้ไขเรียบร้อย")).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ saved: "updated" });
    expect(screen.getByRole("heading", { name: "นายแก้ไข แล้ว" })).toBeInTheDocument();
    expect(screen.getByText("1 1037 00123 45 8")).toBeInTheDocument();
    expect(screen.queryByText("1 XXXX XXXXX 45 8")).not.toBeInTheDocument();

    const [put] = api.callsTo("PUT", DETAIL_PATH);
    const keys = [...(put?.body as FormData).keys()];
    expect(keys).toHaveLength(10);
    expect(keys).not.toContain("photo");
    // GET ใหม่หลัง PUT (ก่อนกลับหน้าดู)
    expect(api.callsTo("GET", DETAIL_PATH).length).toBeGreaterThanOrEqual(2);
  });

  it("ยกเลิกการแก้ไข → กลับหน้าดูโดยไม่บันทึก", async () => {
    const api = fakeApi({ ...shell, [`GET ${DETAIL_PATH}`]: () => json(CUSTOMER_DETAIL) });
    const router = renderApp(`/customers/${CUSTOMER_ID}?mode=edit`);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "ยกเลิก" }));
    expect(await screen.findByRole("button", { name: "แก้ไข" })).toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
    expect(api.callsTo("PUT", DETAIL_PATH)).toEqual([]);
  });

  it("ไม่พบลูกค้า (404) → บอกและมีทางกลับไปรายการ", async () => {
    fakeApi({ ...shell });
    renderApp("/customers/no-such-id");

    expect(await screen.findByText("ไม่พบลูกค้า")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "กลับไปรายการลูกค้า" })).toHaveAttribute("href", "/customers");
  });
});
