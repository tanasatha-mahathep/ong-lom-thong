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
  /** แทนคำตอบของ POST /api/buy/quote (ค่าเริ่มต้น fakeQuote ที่คำนวณจริงด้วย quoteBuy) */
  quote?: (body: QuoteBody) => Response;
}

function setup({ role = "staff", me, customers = [CUSTOMER_OK, CUSTOMER_EXPIRED], save, quote }: Options = {}) {
  const db = { customers: [...customers] };
  let attempts = 0;
  const api = fakeApi({
    "GET /api/me": () => json(me ?? makeMe(role)),
    "GET /api/gold-price/today": () => json(GOLD_PRICE),
    "GET /api/metals": () => json(METALS),
    "GET /api/customers": ({ path }) => fakeCustomerSearch(path, db.customers),
    "POST /api/buy/quote": ({ body }) =>
      quote ? quote(body as QuoteBody) : json(fakeQuote(body as QuoteBody, db.customers)),
    "POST /api/buy": ({ body }) => (save ? save(body as SaveBody, ++attempts) : json(SAVED, 201)),
  });
  const user = userEvent.setup();
  const router = renderApp("/buy");
  return { api, user, db, router };
}

const idBox = () => screen.getByLabelText(t("customer.idLabel"));
const purity = () => screen.getByLabelText(t("lines.purity"));
const deduct = () => screen.getByLabelText<HTMLSelectElement>(t("lines.deduct"));
const weight = () => screen.getByLabelText(t("lines.weight"));
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

/** ข้อความในแต่ละช่องของแถวในตารางรายการ (ไม่รวมปุ่มลบ) */
const rowCells = (row: HTMLElement) =>
  within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent)
    .slice(0, -1);
/** แถวข้อมูลของตารางรายการ (ไม่รวมหัวตารางและแถวรวม) */
const dataRows = () =>
  within(linesTable())
    .getAllByRole("row")
    .filter((row) => row.closest("tbody") !== null);

/**
 * กรอกแถวด้วยคีย์บอร์ด: ค่าบริสุทธิ์ Enter → หัก % (เลือก) Enter → ปริมาณ Enter
 * ค่าเริ่มต้น ทอง 100% 10 ก. ไม่หัก = 44,370.00 ที่ทองแท่งรับซื้อ 67,650 (⌊67650 × 0.0656⌋ × 10)
 */
async function addLine(
  user: ReturnType<typeof userEvent.setup>,
  { p = "100", d = "0", w = "10" }: { p?: string; d?: string; w?: string } = {},
) {
  await user.click(purity());
  await user.keyboard(`${p}{Enter}`);
  if (d !== "0") await user.selectOptions(deduct(), d);
  deduct().focus();
  await user.keyboard(`{Enter}${w}{Enter}`);
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
  it("walks the counter flow by keyboard: card → purity → deduct → weight → full payment → Ctrl+Enter", async () => {
    const { api, user, router } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(purity()).toHaveFocus());
    expect(screen.getByText(CUSTOMER_OK.name_th)).toBeInTheDocument();
    expect(screen.getByText("1 XXXX XXXXX 01 0")).toBeInTheDocument();
    // ไม่มีช่องราคาให้พิมพ์แล้ว — เซิร์ฟเวอร์คิดให้
    expect(screen.queryByLabelText("ราคาจริงที่รับซื้อ (บาท)")).not.toBeInTheDocument();
    expect(deduct()).toHaveValue("0");

    await user.keyboard("96.5{Enter}");
    expect(deduct()).toHaveFocus();
    await user.selectOptions(deduct(), "3");
    deduct().focus();
    await user.keyboard("{Enter}");
    expect(weight()).toHaveFocus();
    await user.keyboard("10{Enter}");

    // ทุกตัวเลขของแถวมาจาก quote: ⌊67650 × 0.0656 × 96.5%⌋ = 4,282/ก. → 42,820 → หัก 3% 1,285 → 41,535
    await waitFor(() => expect(dataRows()).toHaveLength(1));
    expect(rowCells(dataRows()[0] as HTMLElement)).toEqual([
      "1",
      "ทอง",
      "96.5%",
      "3%",
      "10.000",
      "4,282.00",
      "42,820.00",
      "1,285.00",
      "41,535.00",
    ]);
    // ช่องกรอกว่าง หัก % กลับเป็น 0 · โฟกัสกลับที่ค่าบริสุทธิ์ · โลหะเดิมยังเลือกอยู่
    expect(purity()).toHaveValue("");
    expect(weight()).toHaveValue("");
    expect(deduct()).toHaveValue("0");
    expect(purity()).toHaveFocus();
    expect(screen.getByRole("radio", { name: "ทอง" })).toBeChecked();

    // Enter ในแถวว่าง (มีรายการแล้ว) = จบรายการ ไปช่องรายละเอียด
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText(t("lines.detail"))).toHaveFocus();

    await user.click(screen.getByRole("button", { name: t("payments.payFull") }));
    expect(await screen.findByText(t("payments.balanced"))).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).toHaveFocus());
    expect(saveButton()).toHaveAttribute("aria-disabled", "false");

    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(router.state.location.pathname).toBe(`/buy/${SAVED.id}`));
    expect(saves(api)).toHaveLength(1);
    const body = saves(api)[0]?.body as SaveBody;
    // แถวไม่มีราคา — ส่งแค่โลหะ · ปริมาณ · ค่าบริสุทธิ์ · หัก % เป็นข้อความ
    expect(body).toEqual({
      customer_id: CUSTOMER_OK.id,
      lines: [{ metal_id: "m-gold", weight_g: "10", purity_percent: "96.5", deduct_percent: "3" }],
      payments: [{ method: "cash", amount: "41535.00" }],
      full_tax: false,
      idempotency_key: expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/) as string,
    });
  });

  it("shows the server's price per row with the footer totals, for several metals", async () => {
    const { user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
    await waitFor(() => expect(dataRows()).toHaveLength(1));

    // เงิน: ราคาต่อกรัมที่ร้านตั้ง 45 × 92.5% = ⌊41.625⌋ = 41 → 271.56 ก. = 11,133.00
    await user.click(screen.getByRole("radio", { name: "เงิน" }));
    await user.keyboard("{Enter}");
    expect(purity()).toHaveFocus();
    await user.keyboard("92.5{Enter}{Enter}271.56{Enter}");
    await waitFor(() => expect(dataRows()).toHaveLength(2));
    expect(rowCells(dataRows()[1] as HTMLElement)).toEqual([
      "2",
      "เงิน",
      "92.5%",
      "0%",
      "271.560",
      "41.00",
      "11,133.00",
      "0.00",
      "11,133.00",
    ]);
    const footer = within(linesTable()).getAllByRole("row").at(-1) as HTMLElement;
    expect(footer).toHaveTextContent("281.560");
    expect(footer).toHaveTextContent("55,503.00");
  });

  it("points at the metal when its price for the day is not set", async () => {
    const { user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(purity()).toHaveFocus());
    // แพลตตินั่มยังไม่ได้ตั้งราคาต่อกรัมของวันนี้ (GOLD_PRICE.platinum_per_g = null)
    await user.click(screen.getByRole("radio", { name: "แพลตตินั่ม" }));
    await addLine(user, { p: "95" });

    const message = "ยังไม่ได้ตั้งราคาแพลตตินั่มของวันนี้";
    expect(await screen.findByText(message)).toBeInTheDocument();
    const platinum = screen.getByRole("radio", { name: "แพลตตินั่ม" });
    // โฟกัสตัวที่เลือกอยู่ (ไม่ใช่ตัวแรกของกลุ่ม — ไม่งั้นโลหะเปลี่ยนเป็นทองเองและ error หาย)
    expect(platinum).toHaveFocus();
    expect(platinum).toBeChecked();
    expect(platinum.closest('[role="radiogroup"]')).toHaveAccessibleDescription(message);
    expect(within(linesTable()).getByText(t("lines.empty"))).toBeInTheDocument();
    // ค่าที่กรอกยังอยู่ — ตั้งราคาแล้วกด Enter ใหม่ได้
    expect(purity()).toHaveValue("95");
  });

  it("puts a server error on the deduct dropdown and focuses it", async () => {
    const message = "หัก % ต้องเป็นเลขจำนวนเต็ม 0–10";
    const { user } = setup({
      quote: (body) => {
        const q = fakeQuote(body, [CUSTOMER_OK]);
        const i = body.lines.length - 1;
        return json({
          ...q,
          ok: false,
          lines: q.lines.filter((l) => l.index !== i),
          errors: [...q.errors, { field: `lines.${i}.deduct_percent`, message }],
        });
      },
    });
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user, { p: "96.5", d: "3" });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(deduct()).toHaveFocus();
    expect(deduct()).toHaveAttribute("aria-invalid", "true");
    expect(deduct()).toHaveAccessibleDescription(message);
  });

  it("lands on the purity field after a card read, with nothing typed into other fields", async () => {
    const { user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    // ปุ่มที่ Siam ID ส่งตามมาระหว่าง burst ถูกกลืน — ทดสอบด้วยนาฬิกาปลอมใน use-siam-id-capture.test.tsx
    // (เทสต์ทั้งแอปพิมพ์ช้าบนเครื่องที่งานเยอะ จังหวะ 800 ms จึงเชื่อไม่ได้)
    await waitFor(() => expect(purity()).toHaveFocus());
    expect(purity()).toHaveValue("");
    expect(weight()).toHaveValue("");
    expect(screen.getByLabelText(t("customer.searchLabel"))).toHaveValue("");
    expect(screen.getByText(CUSTOMER_OK.name_th)).toBeInTheDocument();
  });

  it("keeps DOM order = Tab order from the ID box to the save bar", async () => {
    const { user } = setup();
    await waitFor(() => expect(idBox()).toHaveFocus());
    const names: string[] = [];
    for (let i = 0; i < 12; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      const label =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
          ? el.labels?.[0]
          : null;
      names.push((el.getAttribute("role") === "radio" ? el.closest("label") : (label ?? el))?.textContent ?? "");
    }
    // แถวสินค้า: โลหะ → ค่าบริสุทธิ์ → หัก % → ปริมาณ (ปุ่มเพิ่มรายการเป็นของเมาส์ ไม่อยู่ในลำดับ Tab)
    expect(names).toEqual([
      t("customer.searchLabel"),
      `${t("customer.newCustomer")}${t("customer.opensInNewTab")}`,
      "ทอง",
      t("lines.purity"),
      t("lines.deduct"),
      t("lines.weight"),
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
    await waitFor(() => expect(purity()).toHaveFocus());

    // ค่าบริสุทธิ์ว่าง: Enter แจ้งที่ช่องทันที ไม่ข้ามไปช่องถัดไป
    await user.keyboard("{Enter}");
    expect(await screen.findByText(t("lines.missingPurity"))).toBeInTheDocument();
    expect(purity()).toHaveFocus();
    expect(purity()).toHaveAccessibleDescription(expect.stringContaining(t("lines.missingPurity")));

    await user.keyboard("96.5{Enter}{Enter}5,860{Enter}");
    expect(await screen.findByText("น้ำหนักห้ามใส่จุลภาค — เช่น 5.860 หรือ 1250.500")).toBeInTheDocument();
    expect(weight()).toHaveAttribute("aria-invalid", "true");
    expect(weight()).toHaveFocus();

    // ค่าบริสุทธิ์นอกช่วง — ข้อความของเซิร์ฟเวอร์ใต้ช่องค่าบริสุทธิ์ (ช่องแรกที่ผิดตามลำดับที่กรอก ก่อนน้ำหนัก)
    await user.clear(purity());
    await user.type(purity(), "150");
    await user.click(weight());
    await user.keyboard("{Enter}");
    const invalidPurity = "ค่าบริสุทธิ์ต้องเป็นตัวเลข 1–100 ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 96.5";
    expect(await screen.findByText(invalidPurity)).toBeInTheDocument();
    expect(purity()).toHaveFocus();
    expect(purity()).toHaveAttribute("aria-invalid", "true");
    expect(within(linesTable()).getByText(t("lines.empty"))).toBeInTheDocument();

    // Esc ล้างเฉพาะแถวที่กำลังกรอก — หัก % กลับเป็น 0 · โลหะคงเดิม
    await user.selectOptions(deduct(), "5");
    purity().focus();
    await user.keyboard("{Escape}");
    expect(purity()).toHaveValue("");
    expect(weight()).toHaveValue("");
    expect(deduct()).toHaveValue("0");
    expect(purity()).toHaveFocus();
    expect(screen.getByRole("radio", { name: "ทอง" })).toBeChecked();
  });

  it("checks payments before adding them: bank for transfers, duplicates and overpaying", async () => {
    const { api, user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
    await within(linesTable()).findAllByText("44,370.00");

    expect(screen.queryByLabelText(t("payments.bank"))).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "โอนเงิน" }));
    await user.click(payAmount());
    await user.keyboard("100{Enter}");
    expect(await screen.findByText(t("payments.missingBank"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("payments.bank"))).toHaveFocus();

    await user.click(screen.getByRole("radio", { name: "เงินสด" }));
    await user.click(payAmount());
    await user.keyboard("50000{Enter}");
    expect(await screen.findByText(t("payments.overpaid"))).toBeInTheDocument();
    expect(screen.getByText(t("payments.empty"))).toBeInTheDocument();

    await user.clear(payAmount());
    await user.keyboard("44000{Enter}");
    expect(await screen.findByText(t("payments.balanceDue", { amount: "370.00" }))).toBeInTheDocument();
    const before = quotes(api).length;
    await user.keyboard("370{Enter}");
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
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
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
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
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

  it("tells a closed working branch apart from never having picked one", async () => {
    const { api } = setup({
      me: { ...makeMe("staff"), branch: null, branch_closed: { id: "b-old", code: "00002", name: "สาขา 3" } },
    });
    expect(await screen.findByText(t("access.branchClosedTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("access.branchClosedBody", { name: "สาขา 3" }))).toBeInTheDocument();
    expect(screen.queryByText(t("access.noBranchTitle"))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(t("customer.idLabel"))).not.toBeInTheDocument();
    expect(quotes(api)).toHaveLength(0);
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
      await waitFor(() => expect(purity()).toHaveFocus());
      await user.keyboard("100{Enter}{Enter}10{Enter}");
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
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));
    expect(saveButton()).toHaveAttribute("aria-disabled", "false");

    // พิมพ์ปริมาณของแถวใหม่ไว้แต่ยังไม่ได้กด Enter เพิ่มเข้ารายการ — พาไปช่องที่ยังขาด (ค่าบริสุทธิ์)
    await user.click(weight());
    await user.keyboard("1");
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
    expect(saveButton()).toHaveAccessibleDescription(t("save.unsavedEntry"));
    const before = saves(api).length;
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(purity()).toHaveFocus();
    expect(saves(api)).toHaveLength(before);

    // ค่าบริสุทธิ์ครบแล้ว → พาไปช่องปริมาณ ที่ Enter = เพิ่มแถว
    await user.keyboard("90");
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(weight()).toHaveFocus();
    expect(saves(api)).toHaveLength(before);

    // หัก % อย่างเดียว (ไม่มีข้อความที่จะหาย) ไม่นับเป็นแถวค้าง
    await user.clear(weight());
    await user.clear(purity());
    await user.selectOptions(deduct(), "2");
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
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));

    // จับ element ไว้ก่อนกด — ข้อความในปุ่มเปลี่ยนเป็น "กำลังบันทึก…" ระหว่างรอ ทำให้ query ด้วยชื่อ "บันทึก" หาไม่เจอ
    const save = saveButton();
    await user.click(save);
    // ปุ่มบันทึกมีโฟกัสจากการคลิกอยู่แล้ว — ย้ายโฟกัสออกไปนอก fieldset ก่อน (เมนูข้างที่ไม่ได้อยู่ใต้ fieldset ที่ปิด)
    // แล้วค่อยลองย้ายกลับมาที่ปุ่ม เพื่อพิสูจน์ว่า .focus() ตรง ๆ ระหว่างรอคำตอบใช้ไม่ได้จริง (ไม่ใช่แค่ปุ่มยังมีโฟกัสเดิมค้างอยู่)
    const homeLink = screen.getByRole("link", { name: "หน้าหลัก" });
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
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));

    await user.click(saveButton());
    // เช่นเดียวกับเทสต์ข้างบน — ระหว่างรอคำตอบ .focus() ตรง ๆ บนช่องจำนวนเงินทำอะไรไม่ได้เพราะ fieldset ปิดอยู่
    payAmount().focus();
    expect(payAmount()).not.toHaveFocus();

    const q = fakeQuote(
      {
        customer_id: CUSTOMER_OK.id,
        lines: [{ metal_id: "m-gold", weight_g: "10", purity_percent: "100", deduct_percent: "0" }],
        payments: [],
      },
      [CUSTOMER_OK],
    );
    pending.resolve(json({ error: "ยอดชำระไม่ตรงกับยอดบิล", field: "payments", ...q }, 409));
    await waitFor(() => expect(payAmount()).toHaveFocus());
  });

  it("removes a line or payment row with the keyboard, not just the mouse (S3)", async () => {
    const { user } = setup();
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
    await within(linesTable()).findAllByText("44,370.00");
    const removeLine = screen.getByRole("button", { name: t("lines.remove", { n: 1 }) });
    removeLine.focus();
    expect(removeLine).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(within(linesTable()).getByText(t("lines.empty"))).toBeInTheDocument();

    await addLine(user);
    await user.click(await screen.findByRole("button", { name: t("payments.payFull") }));
    await screen.findByText(t("payments.balanced"));
    const removePayment = screen.getByRole("button", { name: t("payments.remove", { n: 1 }) });
    removePayment.focus();
    expect(removePayment).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText(t("payments.empty"))).toBeInTheDocument();
  });

  it("shows a payment's amount from the fresh quote by index, like lines' price_per_g (#77)", async () => {
    const { user } = setup({
      quote: (body) => {
        const q = fakeQuote(body, [CUSTOMER_OK]);
        // จงใจให้ยอดที่ quote ตอบต่างจากตัวเลขที่พิมพ์ ("100" → "100.50") พิสูจน์ว่าตารางอ่านจาก quote ไม่ใช่ข้อความที่พิมพ์เอง
        return json({ ...q, payments: q.payments.map((p) => (p.index === 0 ? { ...p, amount: "100.50" } : p)) });
      },
    });
    await insertCard(user, CUSTOMER_OK.national_id);
    await waitFor(() => expect(purity()).toHaveFocus());
    await addLine(user);
    await user.click(payAmount());
    await user.keyboard("100{Enter}");
    expect(await screen.findByText("100.50")).toBeInTheDocument();
  });
});
