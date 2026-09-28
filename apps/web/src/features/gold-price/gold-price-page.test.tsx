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
  it("Enter ในช่องบันทึก → หัวหน้าอ่านราคาใหม่ · แจ้งผล · ล้างช่อง", async () => {
    let today = GOLD_PRICE;
    const { api, user } = await openAs("manager", {
      "GET /api/gold-price/today": () => json(today),
      "PUT /api/gold-price/today": () => {
        today = SAVED;
        return json(SAVED);
      },
    });
    await user.keyboard("70850{Enter}");

    expect(await screen.findByText("บันทึกราคาทองวันนี้แล้ว")).toBeInTheDocument();
    expect(putBodies(api)).toEqual([{ bar_sell: "70850" }]);
    await waitFor(() => expect(screen.getByRole("group", { name: "ราคาทองวันนี้" })).toHaveTextContent("70,850.00"));
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
