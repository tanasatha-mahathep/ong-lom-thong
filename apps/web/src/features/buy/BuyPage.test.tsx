import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import {
  CUSTOMER_EXPIRED,
  CUSTOMER_OK,
  type FakeCustomer,
  METALS,
  fakeCustomerSearch,
  fakeQuote,
} from "@/test/buy-api";
import type { Me, Role } from "@/lib/queries";
import { t } from "./i18n";
import type { QuoteBody, SaveBody } from "./types";

const SAVED = { id: "7f1c2d3e-0000-4000-8000-000000000001", doc_no: "RC6909-0001", pdf_status: "pending" };

interface Options {
  role?: Role;
  me?: Me;
  customers?: FakeCustomer[];
  /** แทนคำตอบของ POST /api/buy (ค่าเริ่มต้น 201 + SAVED) — คืน Promise ได้เพื่อคุมเวลาตอบเอง (ดู defer()) */
  save?: (body: SaveBody, attempt: number) => Response | Promise<Response>;
}

function setup({ role = "staff", me, customers = [CUSTOMER_OK, CUSTOMER_EXPIRED], save }: Options = {}) {
  const db = { customers: [...customers] };
  let attempts = 0;
  const api = fakeApi({
    "GET /api/me": () => json(me ?? makeMe(role)),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "GET /api/metals": () => json(METALS),
    "GET /api/customers": ({ path }) => fakeCustomerSearch(path, db.customers),
    "POST /api/buy/quote": ({ body }) => json(fakeQuote(body as QuoteBody, db.customers)),
    "POST /api/buy": ({ body }) => (save ? save(body as SaveBody, ++attempts) : json(SAVED, 201)),
  });
  const user = userEvent.setup();
  const router = renderApp("/buy");
  return { api, user, db, router };
}

const idBox = () => screen.getByLabelText(t("customer.idLabel"));
const weight = () => screen.getByLabelText(t("lines.weight"));
const amount = () => screen.getByLabelText(t("lines.amount"));
const payAmount = () => screen.getByLabelText(t("payments.amount"));
const saveButton = () => screen.getByRole("button", { name: /^บันทึก/ });
const linesTable = () => screen.getByRole("table", { name: t("lines.table") });
const quotes = (api: ReturnType<typeof fakeApi>) => api.callsTo("POST", "/api/buy/quote");
const saves = (api: ReturnType<typeof fakeApi>) => api.callsTo("POST", "/api/buy");

/** เสียบบัตร: เลข 13 หลัก — รอให้ระบบเลือกลูกค้าและย้ายโฟกัสหลังจบ burst ของ Siam ID */
async function insertCard(user: ReturnType<typeof userEvent.setup>, nationalId: string) {
  await waitFor(() => expect(idBox()).toHaveFocus());
  await user.keyboard(nationalId);
}

async function addLine(user: ReturnType<typeof userEvent.setup>, w: string, a: string) {
  await user.click(weight());
  await user.keyboard(`${w}{Enter}${a}{Enter}`);
}

/** promise ที่คุมเวลาตอบเอง — ใช้จำลองช่วงที่ POST /api/buy ยัง pending จริง (fieldset ปิดค้างอยู่จริง ไม่ใช่ผ่านไปเร็วจนไม่มีใครเห็น) */
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("/buy", () => {
  it("walks the counter flow by keyboard: card → lines → full payment → Ctrl+Enter", async () => {
    const { api, user, router } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());
    expect(screen.getByText(CUSTOMER_OK.name_th)).toBeInTheDocument();
    expect(screen.getByText("1 XXXX XXXXX 01 0")).toBeInTheDocument();

    await user.keyboard("5.86{Enter}");
    expect(amount()).toHaveFocus();
    await user.keyboard("20030{Enter}");
    // แถวใหม่ได้ราคา/กรัมจาก API · ช่องกรอกว่าง โฟกัสกลับที่ปริมาณ · โลหะเดิมยังเลือกอยู่
    expect(await within(linesTable()).findAllByText("3,418.09")).toHaveLength(2); // ราคาต่อหน่วย + เฉลี่ย/กรัม
    expect(weight()).toHaveValue("");
    expect(weight()).toHaveFocus();
    expect(screen.getByRole("radio", { name: "ทอง" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: t("payments.payFull") }));
    expect(await screen.findByText(t("payments.balanced"))).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toHaveFocus());
    expect(saveButton()).toHaveAttribute("aria-disabled", "false");

    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/buy/${SAVED.id}`));
    expect(saves(api)).toHaveLength(1);
    const body = saves(api)[0]?.body as SaveBody;
    expect(body).toEqual({
      customer_id: CUSTOMER_OK.id,
      lines: [{ metal_id: "m-gold", weight_g: "5.86", amount: "20030" }],
      payments: [{ method: "cash", amount: "20030.00" }],
      full_tax: false,
      idempotency_key: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/) as string,
    });
  });

  it("lands on the weight field after a card read, with nothing typed into other fields", async () => {
    const { user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    // ปุ่มที่ Siam ID ส่งตามมาระหว่าง burst ถูกกลืน — ทดสอบด้วยนาฬิกาปลอมใน use-siam-id-capture.test.tsx
    // (เทสต์ทั้งแอปพิมพ์ช้าบนเครื่องที่งานเยอะ จังหวะ 800 ms จึงเชื่อไม่ได้)
    await waitFor(() => expect(weight()).toHaveFocus());
    expect(weight()).toHaveValue("");
    expect(screen.getByLabelText(t("customer.searchLabel"))).toHaveValue("");
    expect(screen.getByText(CUSTOMER_OK.name_th)).toBeInTheDocument();
  });

  it("keeps DOM order = Tab order from the ID box to the save bar", async () => {
    const { user } = setup();
    await waitFor(() => expect(idBox()).toHaveFocus());
    const names: string[] = [];
    for (let i = 0; i < 11; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      const label = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.labels?.[0] : null;
      names.push((el.getAttribute("role") === "radio" ? el.closest("label") : (label ?? el))?.textContent ?? "");
    }
    expect(names).toEqual([
      t("customer.searchLabel"),
      `${t("customer.newCustomer")}${t("customer.opensInNewTab")}`,
      "ทอง",
      t("lines.weight"),
      t("lines.amount"),
      t("lines.detail"),
      "เงินสด",
      t("payments.amount"),
      t("payments.payFull"),
      `${t("save.button")}CtrlEnter`,
      t("save.clear"),
    ]);
  });

  it("does not add a line the API rejects, and shows why under the field", async () => {
    const { user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());

    await user.keyboard("5,860{Enter}20030{Enter}");
    expect(await screen.findByText("น้ำหนักห้ามใส่จุลภาค — เช่น 5.860 หรือ 1250.500")).toBeInTheDocument();
    expect(weight()).toHaveAttribute("aria-invalid", "true");
    expect(weight()).toHaveFocus();

    await user.clear(weight());
    await user.keyboard("5.86{Enter}1234567890123{Enter}");
    expect(await screen.findByText("ราคาเกิน 99,999,999.99 บาท — ตรวจตัวเลขอีกครั้ง")).toBeInTheDocument();
    expect(within(linesTable()).getByText(t("lines.empty"))).toBeInTheDocument();

    // Esc ล้างเฉพาะแถวที่กำลังกรอก
    await user.keyboard("{Escape}");
    expect(weight()).toHaveValue("");
    expect(amount()).toHaveValue("");
    expect(weight()).toHaveFocus();
  });

  it("checks payments before adding them: bank for transfers, duplicates and overpaying", async () => {
    const { api, user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());
    await addLine(user, "5.86", "20030");
    await within(linesTable()).findAllByText("3,418.09");

    expect(screen.queryByLabelText(t("payments.bank"))).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "โอนเงิน" }));
    await user.click(payAmount());
    await user.keyboard("100{Enter}");
    expect(await screen.findByText(t("payments.missingBank"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("payments.bank"))).toHaveFocus();

    await user.click(screen.getByRole("radio", { name: "เงินสด" }));
    await user.click(payAmount());
    await user.keyboard("30000{Enter}");
    expect(await screen.findByText(t("payments.overpaid"))).toBeInTheDocument();
    expect(screen.getByText(t("payments.empty"))).toBeInTheDocument();

    await user.clear(payAmount());
    await user.keyboard("20000{Enter}");
    expect(await screen.findByText(t("payments.balanceDue", { amount: "30.00" }))).toBeInTheDocument();
    const before = quotes(api).length;
    await user.keyboard("30{Enter}");
    expect(await screen.findByText(t("payments.duplicate"))).toBeInTheDocument();
    expect(quotes(api)).toHaveLength(before);
  });

  it("blocks an expired card, links to the edit page, and re-checks when staff come back", async () => {
    const { user, db } = setup();
    await insertCard(user, CUSTOMER_EXPIRED.national_id);
    const alert = await screen.findByText(t("customer.blockedTitle"));
    expect(alert.closest("[role=alert]")).toHaveTextContent("บัตรประชาชนหมดอายุแล้ว");
    const edit = screen.getByRole("link", { name: new RegExp(t("customer.edit")) });
    expect(edit).toHaveAttribute("href", `/customers/${CUSTOMER_EXPIRED.id}?mode=edit&from=buy`);
    expect(edit).toHaveAttribute("target", "_blank");
    await waitFor(() => expect(edit).toHaveFocus());
    expect(screen.getByRole("link", { name: new RegExp(t("customer.newCustomer")) })).toHaveAttribute(
      "href",
      "/customers/new?from=buy",
    );

    // แก้บัตรในแท็บอื่นแล้วกลับมา
    db.customers = [CUSTOMER_OK, { ...CUSTOMER_EXPIRED, card_status: "ok" }];
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByText(t("customer.blockedTitle"))).not.toBeInTheDocument());
    expect(screen.getByText(t("customer.cardBadge.ok"))).toBeInTheDocument();
  });

  it("does not save an unfinished bill: Ctrl+Enter goes to the first thing to fix", async () => {
    const { api, user } = setup();
    await waitFor(() => expect(saveButton()).toHaveAccessibleDescription(/ต้องระบุลูกค้าก่อนบันทึก/));
    await user.click(weight());
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(idBox()).toHaveFocus();
    expect(saves(api)).toHaveLength(0);
  });

  it("reuses the key after a failed save and offers the saved bill on a 409 conflict", async () => {
    const keys: string[] = [];
    const { api, user } = setup({
      save: (body, attempt) => {
        keys.push(body.idempotency_key);
        if (attempt === 1) return json({ error: "ติดต่อฐานข้อมูลไม่ได้" }, 503);
        if (attempt === 2) {
          return json(
            {
              error: "idempotency_key นี้ใช้กับบิลอื่นแล้ว — สร้าง key ใหม่ต่อบิล",
              field: "idempotency_key",
              existing: { id: SAVED.id, doc_no: "PT-RC6909-0007" },
            },
            409,
          );
        }
        return json(SAVED, 201);
      },
    });
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());
    await addLine(user, "5.86", "20030");
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));

    // 503 ลองซ้ำเองด้วย key เดิม แล้ว 409 (key นี้บันทึกบิลอื่นไปแล้ว) → เลือกบันทึกเป็นบิลใหม่ = key ใหม่
    await user.click(saveButton());
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      t("save.conflictTitle", { docNo: "PT-RC6909-0007" }),
    );
    expect(new Set(keys).size).toBe(1);

    await user.click(screen.getByRole("button", { name: t("save.conflictSaveNew") }));
    await waitFor(() => expect(saves(api)).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
    expect(await screen.findByRole("heading", { level: 1, name: "ดูบิล" })).toBeInTheDocument();
  });

  it("shows a 409 validation error in place and keeps the same key for the next attempt", async () => {
    const keys: string[] = [];
    const { user } = setup({
      save: (body, attempt) => {
        keys.push(body.idempotency_key);
        if (attempt === 1) {
          const quote = fakeQuote(body, [{ ...CUSTOMER_OK, card_status: "expired" }]);
          return json({ error: "บัตรประชาชนหมดอายุแล้ว", field: "customer_id", ...quote }, 409);
        }
        return json(SAVED, 201);
      },
    });
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());
    await addLine(user, "5.86", "20030");
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));

    await user.click(saveButton());
    expect(await screen.findByText(t("save.failed", { error: "บัตรประชาชนหมดอายุแล้ว" }))).toBeInTheDocument();
    expect(await screen.findByText(t("customer.blockedTitle"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: new RegExp(t("customer.edit")) })).toHaveFocus();

    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByText(t("customer.blockedTitle"))).not.toBeInTheDocument());
    await user.click(saveButton());
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
  });

  it("does not open the form for accounting, and asks for no quote", async () => {
    const { api } = setup({ role: "accounting" });
    expect(await screen.findByText(t("access.accountingTitle"))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("access.toBills") })).toHaveAttribute("href", "/bills");
    expect(screen.queryByLabelText(t("customer.idLabel"))).not.toBeInTheDocument();
    expect(quotes(api)).toHaveLength(0);
    expect(api.callsTo("GET", "/api/metals")).toHaveLength(0);
  });

  it("asks for a working branch instead of opening the form", async () => {
    const { api } = setup({ me: { ...makeMe("staff"), branch: null } });
    expect(await screen.findByText(t("access.noBranchTitle"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("customer.idLabel"))).not.toBeInTheDocument();
    expect(quotes(api)).toHaveLength(0);
    expect(api.callsTo("GET", "/api/metals")).toHaveLength(0);
  });

  it("hides backdating from staff", async () => {
    setup();
    await waitFor(() => expect(idBox()).toHaveFocus());
    expect(screen.queryByRole("switch", { name: t("backdate.toggle") })).not.toBeInTheDocument();
  });

  it("lets a manager backdate with a BE date, a time and a reason", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T05:00:00Z")); // 12:00 เวลาไทย
    try {
      const { api, user } = setup({ role: "manager" });
      await waitFor(() => expect(idBox()).toHaveFocus());
      await user.click(screen.getByRole("switch", { name: t("backdate.toggle") }));
      const date = screen.getByLabelText(t("backdate.date"));
      expect(date).toHaveFocus();
      expect(date).toHaveValue("29/09/2569");

      await user.clear(date);
      await user.keyboard("1/9/2569{Enter}");
      await waitFor(() => expect(date).toHaveAccessibleDescription(new RegExp(t("backdate.errors.tooOld"))));
      expect(date).toHaveAttribute("aria-invalid", "true");

      await user.clear(date);
      await user.keyboard("27/9/2569{Enter}");
      expect(date).toHaveValue("27/09/2569");
      expect(screen.getByLabelText(t("backdate.time"))).toHaveFocus();
      await user.keyboard("14:05{Enter}คีย์ใบเขียนมือหลังไฟดับ{Enter}");
      expect(idBox()).toHaveFocus();
      await waitFor(() =>
        expect(quotes(api).at(-1)?.body).toMatchObject({
          date: "2026-09-27",
          backdate_reason: "คีย์ใบเขียนมือหลังไฟดับ",
        }),
      );

      await user.keyboard(CUSTOMER_OK.national_id);
      await waitFor(() => expect(weight()).toHaveFocus());
      await user.keyboard("5.86{Enter}20030{Enter}");
      await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
      await screen.findByText(t("payments.balanced"));
      await user.keyboard("{Control>}{Enter}{/Control}");
      await waitFor(() => expect(saves(api)).toHaveLength(1));
      expect(saves(api)[0]?.body).toMatchObject({
        date: "2026-09-27",
        time: "14:05",
        backdate_reason: "คีย์ใบเขียนมือหลังไฟดับ",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks Ctrl+Enter while a backdate change is typed but not confirmed (B1)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T05:00:00Z")); // 12:00 เวลาไทย
    try {
      const { api, user } = setup({ role: "manager" });
      await waitFor(() => expect(idBox()).toHaveFocus());
      await user.click(screen.getByRole("switch", { name: t("backdate.toggle") }));
      const date = screen.getByLabelText(t("backdate.date"));

      // ยืนยันวันที่ 22 ก่อน
      await user.clear(date);
      await user.keyboard("22/9/2569{Enter}");
      expect(date).toHaveValue("22/09/2569");
      await waitFor(() => expect(quotes(api).at(-1)?.body).toMatchObject({ date: "2026-09-22" }));

      // กลับไปแก้เป็นวันที่ 23 โดยยังไม่กด Enter/ออกจากช่อง
      await user.click(date);
      await user.clear(date);
      await user.keyboard("23/09/2569");
      expect(date).toHaveValue("23/09/2569");

      const before = saves(api).length;
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(date).toHaveFocus();
      expect(saves(api)).toHaveLength(before);
      expect(saveButton()).toHaveAccessibleDescription(new RegExp(t("backdate.errors.dateNotConfirmed")));

      // กด Enter ยืนยันแล้วค่อยบันทึกได้ ด้วยวันที่ใหม่ (23) ไม่ใช่วันที่เดิม (22)
      await user.keyboard("{Enter}");
      await waitFor(() => expect(quotes(api).at(-1)?.body).toMatchObject({ date: "2026-09-23" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks save while a typed line or payment entry has not been added yet (S1)", async () => {
    const { api, user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());
    await addLine(user, "5.86", "20030");
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));
    expect(saveButton()).toHaveAttribute("aria-disabled", "false");

    // พิมพ์ปริมาณของแถวใหม่ไว้แต่ยังไม่ได้กด Enter เพิ่มเข้ารายการ
    await user.click(weight());
    await user.keyboard("1");
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
    expect(saveButton()).toHaveAccessibleDescription(t("save.unsavedEntry"));
    const before = saves(api).length;
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(weight()).toHaveFocus();
    expect(saves(api)).toHaveLength(before);

    await user.clear(weight());
    expect(saveButton()).toHaveAttribute("aria-disabled", "false");

    // ช่องชำระเงินก็เช่นกัน
    await user.click(payAmount());
    await user.keyboard("5");
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(payAmount()).toHaveFocus();
    expect(saves(api)).toHaveLength(before);
  });

  it("returns focus to Save once the fieldset re-enables, not while it is still disabled (S2)", async () => {
    const pending = defer<Response>();
    const { user } = setup({ save: () => pending.promise });
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());
    await addLine(user, "5.86", "20030");
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));

    // จับ element ไว้ก่อนกด — ข้อความในปุ่มเปลี่ยนเป็น "กำลังบันทึก…" ระหว่างรอ ทำให้ query ด้วยชื่อ "บันทึก" หาไม่เจอ
    const save = saveButton();
    await user.click(save);
    // ปุ่มบันทึกมีโฟกัสจากการคลิกอยู่แล้ว — ย้ายโฟกัสออกไปนอก fieldset ก่อน (เมนูข้างที่ไม่ได้อยู่ใต้ fieldset ที่ปิด)
    // แล้วค่อยลองย้ายกลับมาที่ปุ่ม เพื่อพิสูจน์ว่า .focus() ตรง ๆ ระหว่างรอคำตอบใช้ไม่ได้จริง (ไม่ใช่แค่ปุ่มยังมีโฟกัสเดิมค้างอยู่)
    const homeLink = screen.getByRole("link", { name: "หน้าแรก" });
    homeLink.focus();
    expect(homeLink).toHaveFocus();
    save.focus();
    expect(save).not.toHaveFocus();

    // ตอบ 409 แบบไม่มี existing (key ชนแต่ parse ไม่ออก) → คืน key ใหม่ + โฟกัสปุ่มบันทึกอีกครั้ง
    pending.resolve(json({ error: "idempotency_key นี้ถูกใช้แล้ว", field: "idempotency_key" }, 409));
    await waitFor(() => expect(save).toHaveFocus());
  });

  it("returns focus to the payment amount once the fieldset re-enables, after a 409 on payments (S2)", async () => {
    const pending = defer<Response>();
    const { user } = setup({ save: () => pending.promise });
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());
    await addLine(user, "5.86", "20030");
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));

    await user.click(saveButton());
    // เช่นเดียวกับเทสต์ข้างบน — ระหว่างรอคำตอบ .focus() ตรง ๆ บนช่องจำนวนเงินทำอะไรไม่ได้เพราะ fieldset ปิดอยู่
    payAmount().focus();
    expect(payAmount()).not.toHaveFocus();

    const q = fakeQuote(
      { customer_id: CUSTOMER_OK.id, lines: [{ metal_id: "m-gold", weight_g: "5.86", amount: "20030" }], payments: [] },
      [CUSTOMER_OK],
    );
    pending.resolve(json({ error: "ยอดชำระไม่ตรงกับยอดบิล", field: "payments", ...q }, 409));
    await waitFor(() => expect(payAmount()).toHaveFocus());
  });

  it("removes a line or payment row with the keyboard, not just the mouse (S3)", async () => {
    const { user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(weight()).toHaveFocus());
    await addLine(user, "5.86", "20030");
    await within(linesTable()).findAllByText("3,418.09");
    const removeLine = screen.getByRole("button", { name: t("lines.remove", { n: 1 }) });
    removeLine.focus();
    expect(removeLine).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(within(linesTable()).getByText(t("lines.empty"))).toBeInTheDocument();

    await addLine(user, "5.86", "20030");
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));
    const removePayment = screen.getByRole("button", { name: t("payments.remove", { n: 1 }) });
    removePayment.focus();
    expect(removePayment).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText(t("payments.empty"))).toBeInTheDocument();
  });
});
