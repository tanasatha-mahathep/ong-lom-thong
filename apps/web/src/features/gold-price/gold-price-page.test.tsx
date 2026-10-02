import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/queries";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";

const LABEL = "ราคาทองแท่งขายออก (บาท)";
const WARNING = "ราคาห่างจากครั้งก่อน 4.4% (67,850 → 70,850) — ตรวจสอบก่อนบันทึก";
const QUOTE_70850 = { bar_sell: "70850.00", bar_buy: "70650.00", jewelry_buy: "67118" };
/** ราคาของสาขาหลังตั้งราคากลาง 70,850 */
const SAVED = { ...GOLD_PRICE, ...QUOTE_70850 };
/** 409 ของด่านกันพิมพ์ผิดตามสัญญา #60 — ชี้ confirm_typo และยังมี warning */
const TYPO_CONFLICT = { error: WARNING, field: "confirm_typo", warning: WARNING };

const confirmedTypo = (body: unknown) =>
  typeof body === "object" && body !== null && "confirm_typo" in body && body.confirm_typo === true;

async function openAs(role: Role, routes: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi({
    "GET /api/me": () => json(makeMe(role)),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "POST /api/gold-price/quote": () => json(QUOTE_70850),
    "GET /api/gold-price/today/branches": () => json([]),
    ...routes,
  });
  renderApp("/settings/gold-price");
  await screen.findByRole("heading", { level: 1, name: "ตั้งราคาทองวันนี้" });
  return { api, user: userEvent.setup() };
}

const previewStatus = () => within(screen.getByRole("region", { name: "ราคาที่จะบันทึก" })).getByRole("status");
const putBodies = (api: Awaited<ReturnType<typeof openAs>>["api"]) =>
  api.callsTo("PUT", "/api/gold-price/today").map((call) => call.body);

describe("ตั้งราคาทองวันนี้ — live preview จากเซิร์ฟเวอร์", () => {
  it("ช่องราคาได้โฟกัสเอง · ช่องว่างยังไม่ถามเซิร์ฟเวอร์", async () => {
    const { api } = await openAs("manager");

    expect(screen.getByLabelText(LABEL)).toHaveFocus();
    expect(previewStatus()).toHaveTextContent("กรอกราคาทองแท่งขายออก แล้วระบบจะคำนวณราคารับซื้อให้");
    expect(api.callsTo("POST", "/api/gold-price/quote")).toHaveLength(0);
  });

  it("แสดงราคาที่เซิร์ฟเวอร์ derive ให้ — ส่งข้อความที่พิมพ์ครั้งเดียวหลังหยุดพิมพ์", async () => {
    // bar_buy / jewelry_buy ที่สูตรใดใน browser ก็ให้ไม่ได้ — ถ้าจอแสดงค่านี้ แปลว่ามาจากเซิร์ฟเวอร์
    const { api, user } = await openAs("manager", {
      "POST /api/gold-price/quote": () => json({ bar_sell: "68000.00", bar_buy: "67777.77", jewelry_buy: "64389" }),
    });
    await user.keyboard("68000");

    const status = previewStatus();
    await waitFor(() => expect(status).toHaveTextContent("67,777.77"));
    expect(status).toHaveTextContent("68,000");
    expect(status).toHaveTextContent("64,389");
    expect(status).toHaveAttribute("aria-busy", "false");
    expect(api.callsTo("POST", "/api/gold-price/quote").map((call) => call.body)).toEqual([{ bar_sell: "68000" }]);
  });

  it('".5" / "5." เติม-ตัดเป็น string ก่อนส่ง (API รับเฉพาะรูปเต็ม)', async () => {
    const { api, user } = await openAs("manager");
    await user.keyboard("70850.");

    await waitFor(() => expect(previewStatus()).toHaveTextContent("70,650"));
    expect(api.callsTo("POST", "/api/gold-price/quote").map((call) => call.body)).toEqual([{ bar_sell: "70850" }]);
  });

  it("คำเตือนด่านกันพิมพ์ผิดแสดงตั้งแต่ใน preview", async () => {
    const { user } = await openAs("manager", {
      "POST /api/gold-price/quote": () => json({ ...QUOTE_70850, warning: WARNING }),
    });
    await user.keyboard("70850");

    await waitFor(() => expect(previewStatus()).toHaveTextContent(WARNING));
  });
});

describe("ตั้งราคาทองวันนี้ — บันทึก", () => {
  it("Enter ในช่องบันทึก → แจ้งผล · ล้างช่อง", async () => {
    let today = GOLD_PRICE;
    const { api, user } = await openAs("manager", {
      "GET /api/gold-price/today": () => json(today),
      "PUT /api/gold-price/today": () => {
        today = SAVED;
        return json(SAVED);
      },
    });
    const before = api.callsTo("GET", "/api/gold-price/today").length;
    await user.keyboard("70850{Enter}");

    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    expect(putBodies(api)).toEqual([{ bar_sell: "70850" }]);
    // ราคาวันนี้ (query ที่หน้าหลักใช้) ถูกถามใหม่ — หัวหน้าไม่แสดงราคาแล้ว
    await waitFor(() => expect(api.callsTo("GET", "/api/gold-price/today").length).toBeGreaterThan(before));
    expect(screen.getByLabelText(LABEL)).toHaveValue("");
  });

  it("409 ด่านกันพิมพ์ผิด → AlertDialog (โฟกัสที่กลับไปแก้ไข) → Tab + Enter ยืนยัน → ส่งซ้ำพร้อม confirm_typo", async () => {
    const { api, user } = await openAs("manager", {
      "PUT /api/gold-price/today": ({ body }) => (confirmedTypo(body) ? json(SAVED) : json(TYPO_CONFLICT, 409)),
    });
    await user.keyboard("70850{Enter}");

    const dialog = await screen.findByRole("alertdialog", { name: "ยืนยันราคาทองวันนี้" });
    expect(dialog).toHaveAccessibleDescription(WARNING);
    // Enter ซ้ำโดยไม่ได้อ่านต้องไม่ผ่านด่าน — โฟกัสเริ่มที่ปุ่มที่ปลอดภัย
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "กลับไปแก้ไข" })).toHaveFocus());
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "ยืนยันบันทึกราคานี้" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(putBodies(api)).toEqual([{ bar_sell: "70850" }, { bar_sell: "70850", confirm_typo: true }]);
  });

  it("Esc ปิดด่านโดยไม่บันทึก แล้วโฟกัสกลับช่องราคาพร้อมตัวเลขเดิมให้แก้", async () => {
    const { api, user } = await openAs("manager", {
      "PUT /api/gold-price/today": () => json(TYPO_CONFLICT, 409),
    });
    await user.keyboard("70850{Enter}");
    await screen.findByRole("alertdialog");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    const input = screen.getByLabelText(LABEL);
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveValue("70850");
    expect(putBodies(api)).toEqual([{ bar_sell: "70850" }]);
    expect(screen.queryByText("บันทึกราคาทองวันนี้แล้ว")).not.toBeInTheDocument();
  });

  it("400 ของเซิร์ฟเวอร์แสดงใต้ช่อง และผูกกับช่องด้วย aria-describedby", async () => {
    const message = "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0";
    const invalid = () => json({ error: message, field: "bar_sell" }, 400);
    const { api, user } = await openAs("manager", {
      "POST /api/gold-price/quote": invalid,
      "PUT /api/gold-price/today": invalid,
    });
    await user.keyboard("abc{Enter}");

    const input = screen.getByLabelText(LABEL);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(new RegExp(`^${message}`));
    expect(putBodies(api)).toEqual([{ bar_sell: "abc" }]);
  });

  it.each([
    [500, "บันทึกราคาไม่สำเร็จ ลองใหม่อีกครั้ง"],
    [403, "บัญชีนี้ตั้งราคาทองไม่ได้ — เฉพาะผู้จัดการและผู้ดูแลระบบ"],
  ])("error ที่ไม่ชี้ช่อง (%i) → ข้อความไทยของฟอร์ม ไม่แสดงข้อความดิบของเซิร์ฟเวอร์", async (status, message) => {
    const { user } = await openAs("manager", {
      "PUT /api/gold-price/today": () => json({ error: "Internal Server Error" }, status),
    });
    await user.keyboard("70850{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText(/Internal Server Error/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(LABEL)).toHaveAccessibleDescription(new RegExp(`^${message}`));
  });

  it("Enter ตอนช่องว่าง → เตือนใต้ช่อง ไม่ส่ง API", async () => {
    const { api, user } = await openAs("manager");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("กรอกราคาทองแท่งขายออก")).toBeInTheDocument();
    expect(screen.getByLabelText(LABEL)).toHaveAttribute("aria-invalid", "true");
    expect(putBodies(api)).toEqual([]);
  });

  it("กันกดซ้ำ — ระหว่างบันทึกปุ่มถูกปิด และ Enter ซ้ำไม่ส่งอีก", async () => {
    let respond: (res: Response) => void = () => undefined;
    const { api, user } = await openAs("manager", {
      "PUT /api/gold-price/today": () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    });
    await user.keyboard("70850{Enter}");

    expect(await screen.findByRole("button", { name: "กำลังบันทึก…" })).toBeDisabled();
    await user.keyboard("{Enter}{Enter}");
    expect(putBodies(api)).toHaveLength(1);

    respond(json(SAVED));
    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
  });
});

describe("ตั้งราคาทองวันนี้ — role และราคาที่ใช้อยู่", () => {
  it.each<Role>(["manager", "admin"])("%s ตั้งราคาได้", async (role) => {
    await openAs(role);

    expect(screen.getByLabelText(LABEL)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกราคา" })).toBeInTheDocument();
  });

  it.each<Role>(["staff", "accounting"])("%s เปิด URL ตรง ๆ ได้แค่ดูราคา — ไม่มีฟอร์ม", async (role) => {
    await openAs(role);

    expect(screen.getByText("ตั้งราคาทองได้เฉพาะผู้จัดการและผู้ดูแลระบบ")).toBeInTheDocument();
    expect(screen.queryByLabelText(LABEL)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกราคา" })).not.toBeInTheDocument();
    const card = screen.getByRole("region", { name: "ราคาที่สาขานี้ใช้เปิดบิลวันนี้" });
    expect(await within(card).findByText("64,268")).toBeInTheDocument();
  });

  it("การ์ดราคาที่ใช้อยู่: 3 ค่าแบบกระดาน · ที่มา · วันที่ไทย", async () => {
    await openAs("manager", {
      "GET /api/gold-price/today": () => json({ ...GOLD_PRICE, source: "branch" }),
    });
    const card = screen.getByRole("region", { name: "ราคาที่สาขานี้ใช้เปิดบิลวันนี้" });

    expect(await within(card).findByText("67,850")).toBeInTheDocument();
    expect(within(card).getByText("67,650")).toBeInTheDocument();
    expect(within(card).getByText("64,268")).toBeInTheDocument();
    expect(within(card).getByText("ราคาเฉพาะสาขา")).toBeInTheDocument();
    expect(card).toHaveTextContent("28 กันยายน 2569");
    expect(card).toHaveTextContent("ราคากลางที่บันทึกจากหน้านี้ไม่เปลี่ยนราคาของสาขานี้");
  });

  it("ยังไม่ได้ตั้งราคา (404) → การ์ดบอกว่าเปิดบิลไม่ได้", async () => {
    await openAs("manager", {
      "GET /api/gold-price/today": () => json({ error: "ยังไม่ได้ตั้งราคาทองของวันนี้", date: "2026-09-28" }, 404),
    });
    const card = screen.getByRole("region", { name: "ราคาที่สาขานี้ใช้เปิดบิลวันนี้" });

    expect(
      await within(card).findByText("ยังไม่ได้ตั้งราคาทองวันนี้ — เปิดบิลซื้อเข้าไม่ได้จนกว่าจะตั้งราคา"),
    ).toBeInTheDocument();
  });
});

const SILVER = "ราคาเงิน (บาท/กรัม)";
const PLATINUM = "ราคาแพลตตินั่ม (บาท/กรัม)";

describe("ตั้งราคาทองวันนี้ — ราคาเงิน/แพลตตินั่มต่อกรัม (ราคากลาง)", () => {
  it("เติมราคาของวันนี้ไว้ในช่อง · ไม่แตะ = ไม่ส่ง (API คงค่าเดิม ไม่ล้างราคาที่ตั้งไว้)", async () => {
    const { api, user } = await openAs("manager", { "PUT /api/gold-price/today": () => json(SAVED) });
    await waitFor(() => expect(screen.getByLabelText(SILVER)).toHaveValue("45.00"));
    expect(screen.getByLabelText(PLATINUM)).toHaveValue("");
    expect(screen.getByLabelText(SILVER)).toHaveAccessibleDescription(/ทุกสาขาใช้ราคานี้/);

    await user.keyboard("70850{Enter}");
    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    expect(putBodies(api)).toEqual([{ bar_sell: "70850" }]);
  });

  it("Tab ไปช่องราคาต่อกรัม → ส่งเฉพาะช่องที่เปลี่ยน ทั้ง quote และบันทึก · ล้างช่อง = null", async () => {
    const { api, user } = await openAs("manager", {
      "POST /api/gold-price/quote": ({ body }) =>
        json({
          ...QUOTE_70850,
          ...(body && typeof body === "object" && "platinum_per_g" in body ? { platinum_per_g: "1200.00" } : {}),
          ...(body && typeof body === "object" && "silver_per_g" in body ? { silver_per_g: null } : {}),
        }),
      "PUT /api/gold-price/today": () => json(SAVED),
    });
    await waitFor(() => expect(screen.getByLabelText(SILVER)).toHaveValue("45.00"));
    await user.keyboard("70850");
    await user.tab();
    expect(screen.getByLabelText(SILVER)).toHaveFocus();
    await user.clear(screen.getByLabelText(SILVER));
    await user.tab();
    expect(screen.getByLabelText(PLATINUM)).toHaveFocus();
    await user.keyboard("1200");

    // preview แสดงค่าที่เซิร์ฟเวอร์ตอบ (รูปมาตรฐาน) — ไม่ใช่ข้อความที่พิมพ์
    await waitFor(() => expect(previewStatus()).toHaveTextContent("1,200.00"));
    expect(previewStatus()).toHaveTextContent("ยังไม่ได้ตั้ง");
    expect(api.callsTo("POST", "/api/gold-price/quote").at(-1)?.body).toEqual({
      bar_sell: "70850",
      silver_per_g: null,
      platinum_per_g: "1200",
    });

    await user.keyboard("{Enter}");
    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    expect(putBodies(api)).toEqual([{ bar_sell: "70850", silver_per_g: null, platinum_per_g: "1200" }]);
  });

  it("400 ที่ชี้ช่องราคาเงิน → ข้อความใต้ช่องนั้น + โฟกัสช่องนั้น (ไม่ใช่ error ของทั้งฟอร์ม)", async () => {
    const message = "ราคาเงินต่อกรัมต้องเป็นตัวเลขมากกว่า 0";
    const { api, user } = await openAs("manager", {
      "PUT /api/gold-price/today": () => json({ error: message, field: "silver_per_g" }, 400),
    });
    await waitFor(() => expect(screen.getByLabelText(SILVER)).toHaveValue("45.00"));
    await user.clear(screen.getByLabelText(SILVER));
    await user.keyboard("0");
    await user.click(screen.getByLabelText(LABEL));
    await user.keyboard("70850{Enter}");

    const silver = screen.getByLabelText(SILVER);
    await waitFor(() => expect(silver).toHaveFocus());
    expect(silver).toHaveAttribute("aria-invalid", "true");
    expect(silver).toHaveAccessibleDescription(new RegExp(`^${message}`));
    expect(screen.getByLabelText(LABEL)).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("บันทึกราคาไม่สำเร็จ ลองใหม่อีกครั้ง")).not.toBeInTheDocument();
    expect(putBodies(api)).toEqual([{ bar_sell: "70850", silver_per_g: "0" }]);
  });

  it("409 ที่มีหลายคำเตือน (ทอง · เงิน) → ยืนยันแล้วส่งซ้ำพร้อมราคาต่อกรัมชุดเดิม", async () => {
    const warning = `${WARNING} · ราคาเงินห่างจากครั้งก่อน 12.2% (45 → 50.50) — ตรวจสอบก่อนบันทึก`;
    const { api, user } = await openAs("manager", {
      "PUT /api/gold-price/today": ({ body }) =>
        confirmedTypo(body) ? json(SAVED) : json({ error: warning, field: "confirm_typo", warning }, 409),
    });
    await waitFor(() => expect(screen.getByLabelText(SILVER)).toHaveValue("45.00"));
    await user.clear(screen.getByLabelText(SILVER));
    await user.keyboard("50.50");
    await user.click(screen.getByLabelText(LABEL));
    await user.keyboard("70850{Enter}");

    const dialog = await screen.findByRole("alertdialog", { name: "ยืนยันราคาทองวันนี้" });
    expect(dialog).toHaveAccessibleDescription(warning);
    await user.click(within(dialog).getByRole("button", { name: "ยืนยันบันทึกราคานี้" }));

    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    expect(putBodies(api)).toEqual([
      { bar_sell: "70850", silver_per_g: "50.50" },
      { bar_sell: "70850", silver_per_g: "50.50", confirm_typo: true },
    ]);
  });

  it("ยังไม่รู้ราคาของวันนี้ (โหลดไม่ได้) → ไม่ส่ง null ไปล้างราคา · ส่งเฉพาะช่องที่พิมพ์", async () => {
    const { api, user } = await openAs("manager", {
      "GET /api/gold-price/today": () => json({ error: "Internal Server Error" }, 500),
      "PUT /api/gold-price/today": () => json(SAVED),
    });
    expect(screen.getByLabelText(SILVER)).toHaveValue("");
    await user.keyboard("70850{Enter}");
    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    expect(putBodies(api)).toEqual([{ bar_sell: "70850" }]);
  });

  it("การ์ดราคาที่ใช้อยู่: ราคาเงินต่อกรัม · แพลตตินั่มยังไม่ได้ตั้ง = บอกว่ารับซื้อไม่ได้", async () => {
    await openAs("staff");
    const card = screen.getByRole("region", { name: "ราคาที่สาขานี้ใช้เปิดบิลวันนี้" });

    expect(await within(card).findByText("45.00")).toBeInTheDocument();
    expect(within(card).getByText(SILVER)).toBeInTheDocument();
    expect(within(card).getByText(PLATINUM).nextElementSibling).toHaveTextContent("ยังไม่ได้ตั้ง");
    expect(card).toHaveTextContent(
      "ยังไม่ได้ตั้งราคาแพลตตินั่มของวันนี้ — รับซื้อแพลตตินั่มไม่ได้จนกว่าผู้จัดการจะตั้งราคาที่ราคากลาง",
    );
  });

  it("ตั้งครบทั้งสองโลหะ → ไม่มีข้อความเตือน", async () => {
    await openAs("staff", {
      "GET /api/gold-price/today": () => json({ ...GOLD_PRICE, platinum_per_g: "1200.00" }),
    });
    const card = screen.getByRole("region", { name: "ราคาที่สาขานี้ใช้เปิดบิลวันนี้" });
    expect(await within(card).findByText("1,200.00")).toBeInTheDocument();
    expect(card).not.toHaveTextContent("ยังไม่ได้ตั้ง");
  });
});

describe("ตั้งราคาทองวันนี้ — กรอบราคาสมาคมเต็มแถวบน ไม่ซ้อนในการ์ดฟอร์ม", () => {
  it("กรอบมาก่อนฟอร์มใน DOM · เต็มแถว (lg:col-span-2) · หัวข้อเป็น h2 (ไม่ข้ามระดับจาก h1 ของหน้า)", async () => {
    await openAs("manager");

    const region = screen.getByRole("region", { name: "ราคาสมาคม (อ้างอิง)" });
    expect(region).toHaveClass("lg:col-span-2");
    expect(screen.getByRole("heading", { level: 2, name: "ราคาสมาคม (อ้างอิง)" })).toBeInTheDocument();
    // เดิมกรอบนี้ซ้อนอยู่ในการ์ดฟอร์ม (หลังช่องกรอกราคาใน DOM) — ย้ายออกมาเต็มแถวบนสุดแล้วต้องมาก่อนช่องกรอกราคา
    const input = screen.getByLabelText(LABEL);
    expect(region.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
