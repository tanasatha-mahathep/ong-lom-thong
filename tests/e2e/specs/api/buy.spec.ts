import { randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../lib/fixtures";
import { FOREIGN_ORIGIN, expectApiError, expectFieldError } from "../../lib/http";
import { A4_PT, fontProblems, inspect } from "../../lib/pdf";
import { PNG_1X1, syntheticNationalId, thaiName } from "../../lib/synthetic";

interface Metal {
  id: string;
  code: string;
}
interface Saved {
  id: string;
  doc_no: string;
  pdf_status: string;
}
interface Bill {
  id: string;
  doc_no: string;
  date: string;
  branch: { code: string; tax_branch_code: string | null };
  customer: { id: string; name_th: string; national_id_masked: string };
  gold_price_snapshot: string;
  lines: { line_no: number; metal: { code: string }; weight_g: string; amount: string; price_per_g: string }[];
  payments: { method: string; method_label: string; bank: string | null; amount: string }[];
  total_weight: string;
  total_amount: string;
  avg_price_per_g: string;
  status: string;
  pdf_status: string;
  /** the receipt as the screen shows it — same data as the PDF, seller ID masked */
  receipt?: { company: { taxId: string }; customer: { nationalId: string } };
}
interface BillList {
  items: { id: string; doc_no: string; customer: { national_id_masked: string }; total_amount: string }[];
  totals: { count: string; total_weight: string; total_amount: string };
}

/** the shop's business day is Thai time (Asia/Bangkok) */
const thaiDate = (at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(at);
/** RC<yy><mm>-NNNN with the Buddhist-era year (R9) — worked out here independently of @ong/core */
const docNoPattern = (isoDate: string) => {
  const [y = "0", m = "00"] = isoDate.split("-");
  return new RegExp(`^RC${String((Number(y) + 543) % 100).padStart(2, "0")}${m}-\\d{4}$`);
};
const idempotencyKey = () => `e2e-${randomBytes(12).toString("hex")}`;
/** a 13-digit run — an unmasked national ID, unless it is the shop's own tax ID (R13) */
const FULL_ID = /\d{13}/g;

/** the counter's bill: the real-receipt gold line (5.860 g for 20,030) plus silver, paid in cash */
async function counterBill(staff: APIRequestContext, manager: APIRequestContext, options: { photo?: boolean } = {}) {
  // R7: today's price must exist before a bill opens — the same 67,850 the gold-price journey sets
  expect((await manager.put("/api/gold-price/today", { data: { bar_sell: "67850" } })).status()).toBe(200);

  const metals = (await (await staff.get("/api/metals")).json()) as Metal[];
  const metal = (code: string) => metals.find((m) => m.code === code)?.id ?? "";

  const nationalId = syntheticNationalId();
  const seller = thaiName("ผู้ขาย");
  const fields = { national_id: nationalId, name_th: seller, card_expire_text: "31/12/2574" };
  const photo = { name: "card.png", mimeType: "image/png", buffer: PNG_1X1 };
  const created = await staff.post("/api/customers", { multipart: options.photo ? { ...fields, photo } : fields });
  expect(created.status()).toBe(201);
  const customerId = ((await created.json()) as { id: string }).id;

  return {
    nationalId,
    seller,
    body: {
      customer_id: customerId,
      lines: [
        { metal_id: metal("gold"), weight_g: "5.860", amount: "20030" },
        { metal_id: metal("silver"), weight_g: "100", amount: "1500" },
      ],
      payments: [{ method: "cash", amount: "21530" }],
    },
  };
}

test.describe("buy-in — quote, save, read back, scoped (R1–R5 · R7 · R9 · R13 · spec §5)", () => {
  test("quote → save → replay → read back as strings → other branches see nothing", async ({ signedIn }) => {
    const [staff, manager, other, accounting] = await Promise.all([
      signedIn("staff"),
      signedIn("manager"),
      signedIn("otherBranch"),
      signedIn("accounting"),
    ]);
    const { nationalId, body } = await counterBill(staff, manager);
    const masked = `${nationalId[0]} XXXX XXXXX ${nationalId.slice(10, 12)} ${nationalId[12]}`;
    const today = thaiDate();

    await test.step("the quote is exact to the satang, as strings (rules 1–3)", async () => {
      const res = await staff.post("/api/buy/quote", { data: body });
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        errors: [],
        branch: { code: "00000" },
        gold_price_snapshot: "67850.00",
        lines: [
          { index: 0, weight_g: "5.860", amount: "20030.00", price_per_g: "3418.09" },
          { index: 1, weight_g: "100.000", amount: "1500.00", price_per_g: "15.00" },
        ],
        total_weight: "105.860",
        total_amount: "21530.00",
        avg_price_per_g: "203.38",
        paid: "21530.00",
        balance: "0.00",
      });
    });

    const key = idempotencyKey();
    const saveBody = { ...body, idempotency_key: key, detail: "ทดสอบ e2e" };
    const saved = await test.step("save → 201 with this month's RC number, PDF queued", async () => {
      const res = await staff.post("/api/buy", { data: saveBody });
      expect(res.status(), await res.text()).toBe(201);
      const bill = (await res.json()) as Saved;
      expect(bill.doc_no).toMatch(/^RC\d{4}-\d{4}$/);
      expect(bill.pdf_status).toBe("pending");
      return bill;
    });

    await test.step("pressing save again (same key, same bill) returns that bill, not a second one", async () => {
      const res = await staff.post("/api/buy", { data: saveBody });
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual(saved);
    });

    await test.step("the same key with a different bill is a 409 that points at the saved one", async () => {
      const changed = { ...saveBody, detail: "ทดสอบ e2e แก้แล้ว" };
      const res = await staff.post("/api/buy", { data: changed });
      const error = await expectFieldError(res, 409, "idempotency_key", ["existing"]);
      expect((error as { existing?: unknown }).existing).toEqual({ id: saved.id, doc_no: saved.doc_no });
    });

    await test.step("the bill reads back exactly as quoted — masked seller, no-store", async () => {
      const res = await staff.get(`/api/buy/${saved.id}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toBe("no-store");
      const text = await res.text();
      const bill = JSON.parse(text) as Bill;
      // R13: the seller's ID never leaves the api in full — the only 13-digit run allowed is the shop's own tax ID,
      // which the receipt preview (bill.receipt) prints on every receipt
      expect(text).not.toContain(nationalId);
      const shopTaxId = bill.receipt?.company.taxId;
      expect((text.match(FULL_ID) ?? []).filter((run) => run !== shopTaxId)).toEqual([]);
      expect(bill.receipt?.customer.nationalId, "the receipt preview masks the seller too").toBe(masked);
      // the business day of the save (a run across midnight, Thai time, may see either) sets the RC period
      expect([today, thaiDate()]).toContain(bill.date);
      expect(bill.doc_no).toMatch(docNoPattern(bill.date));
      expect(bill).toMatchObject({
        id: saved.id,
        doc_no: saved.doc_no,
        branch: { code: "00000", tax_branch_code: "00000" },
        customer: { national_id_masked: masked },
        gold_price_snapshot: "67850.00",
        total_weight: "105.860",
        total_amount: "21530.00",
        avg_price_per_g: "203.38",
        status: "active",
      });
      expect(bill.lines.map((l) => [l.line_no, l.metal.code, l.weight_g, l.amount, l.price_per_g])).toEqual([
        [1, "gold", "5.860", "20030.00", "3418.09"],
        [2, "silver", "100.000", "1500.00", "15.00"],
      ]);
      expect(bill.payments).toEqual([{ method: "cash", method_label: "เงินสด", bank: null, amount: "21530.00" }]);

      const list = await staff.get(`/api/buy?q=${encodeURIComponent(saved.doc_no)}`);
      const found = (await list.json()) as BillList;
      expect(found.items.map((i) => [i.id, i.customer.national_id_masked, i.total_amount])).toEqual([
        [saved.id, masked, "21530.00"],
      ]);
    });

    await test.step("accounting of the same branch reads it but may not open bills", async () => {
      expect((await accounting.get(`/api/buy/${saved.id}`)).status()).toBe(200);
      const res = await accounting.post("/api/buy", { data: { ...body, idempotency_key: idempotencyKey() } });
      await expectApiError(res, 403);
    });

    await test.step("a user of another branch gets 404 and an empty search (fail-closed, rule 4)", async () => {
      expect((await expectApiError(await other.get(`/api/buy/${saved.id}`), 404)).error).toBe("not found");
      const search = (await (await other.get(`/api/buy?q=${encodeURIComponent(saved.doc_no)}`)).json()) as BillList;
      expect(search.items).toEqual([]);
      expect(search.totals).toEqual({ count: "0", total_weight: "0.000", total_amount: "0.00" });
    });
  });

  test("payments must equal the bill (R4): 409 with the quote attached, nothing saved", async ({ signedIn }) => {
    const [staff, manager] = await Promise.all([signedIn("staff"), signedIn("manager")]);
    const { body, seller } = await counterBill(staff, manager);
    const res = await staff.post("/api/buy", {
      data: { ...body, payments: [{ method: "cash", amount: "21000" }], idempotency_key: idempotencyKey() },
    });
    const quoteKeys = ["ok", "errors", "date", "branch", "gold_price_snapshot", "lines"];
    const error = await expectFieldError(res, 409, "payments", [
      ...quoteKeys,
      "total_weight",
      "total_amount",
      "avg_price_per_g",
      "paid",
      "balance",
    ]);
    expect(error).toMatchObject({ ok: false, paid: "21000.00", balance: "530.00" });
    const search = (await (await staff.get(`/api/buy?q=${encodeURIComponent(seller)}`)).json()) as BillList;
    expect(search.items).toEqual([]);
  });

  test("money and weight travel as strings — JSON numbers are a 400 naming the field", async ({ signedIn }) => {
    const [staff, manager] = await Promise.all([signedIn("staff"), signedIn("manager")]);
    const { body } = await counterBill(staff, manager);
    const [first] = body.lines;
    const asNumber = { ...body, lines: [{ ...first, weight_g: 5.86 }] };
    await expectFieldError(await staff.post("/api/buy/quote", { data: asNumber }), 400, "lines.0.weight_g");
  });

  test("CSRF: a signed-in browser cannot open a bill from another site", async ({ signedIn }) => {
    const [staff, manager] = await Promise.all([signedIn("staff"), signedIn("manager")]);
    const { body, seller } = await counterBill(staff, manager);
    const res = await staff.post("/api/buy", {
      headers: { origin: FOREIGN_ORIGIN },
      data: { ...body, idempotency_key: idempotencyKey() },
    });
    expect((await expectApiError(res, 403)).error).toBe("forbidden origin");

    // and no bill exists for that seller behind the refusal
    const search = (await (await staff.get(`/api/buy?q=${encodeURIComponent(seller)}`)).json()) as BillList;
    expect(search.items).toEqual([]);
  });
});

/** file states the api reports while it renders in the background (spec §9.2) */
type FileField = "pdf_status" | "idcard_status" | "void_pdf_status";

/** poll the bill until a background-rendered file leaves "pending"; returns where it settled */
async function settled(client: APIRequestContext, id: string, field: FileField): Promise<string> {
  let status = "";
  await expect
    .poll(
      async () => {
        const bill = (await (await client.get(`/api/buy/${id}`)).json()) as Record<string, unknown>;
        status = String(bill[field]);
        return status;
      },
      { message: `${field} of bill ${id}`, timeout: 90_000, intervals: [500, 1_000, 2_000] },
    )
    .not.toBe("pending");
  return status;
}

/** "21530.00" → "21,530.00": how the receipt prints the api's strings (thousands grouping, nothing else) */
const printed = (value: string) => {
  const [whole = "", fraction] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+$)/g, ",")}${fraction === undefined ? "" : `.${fraction}`}`;
};

/** GET a stored file: private (no-store · nosniff · inline) and a well-formed A4 PDF embedding only Sarabun */
async function downloadPdf(client: APIRequestContext, path: string, filename: string) {
  const res = await client.get(path);
  expect(res.status(), `${path} → ${(await res.body()).toString("utf8", 0, 200)}`).toBe(200);
  expect(res.headers()).toMatchObject({
    "content-type": "application/pdf",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="${filename}"`,
  });
  const bytes = await res.body();
  const pdf = await inspect(bytes);
  expect(pdf.header).toMatch(/^%PDF-/);
  expect(pdf.eofTail).not.toBeNull();
  for (const box of pdf.mediaBoxes) {
    expect(Math.abs(box.width - A4_PT.width), "A4 width (ISO 216)").toBeLessThanOrEqual(0.5);
    expect(Math.abs(box.height - A4_PT.height), "A4 height (ISO 216)").toBeLessThanOrEqual(0.5);
  }
  expect(fontProblems(pdf.fonts), "Sarabun only, embedded").toEqual([]);
  return { bytes, pdf, text: pdf.text.join("\n") };
}

/** what a non-production receipt must carry (.railway/railway.ts · stack RECEIPT_WATERMARK) */
const WATERMARK = "ตัวอย่าง — ระบบทดสอบ ไม่ใช่ใบรับซื้อจริง";

test.describe("receipt PDF — archived, private, immutable (R15 · rule 5 · R13 · spec §9.2)", () => {
  test("a saved bill gets its A4 receipt and ID card copy in the bucket, served only through the api", async ({
    signedIn,
    anonymous,
  }) => {
    test.setTimeout(180_000); // two background renders through Gotenberg
    const [staff, manager, accounting, other] = await Promise.all([
      signedIn("staff"),
      signedIn("manager"),
      signedIn("accounting"),
      signedIn("otherBranch"),
    ]);
    const { body, seller, nationalId } = await counterBill(staff, manager, { photo: true });
    const saved = await staff.post("/api/buy", {
      data: { ...body, idempotency_key: idempotencyKey(), detail: "ทดสอบ e2e ใบรับซื้อ" },
    });
    expect(saved.status()).toBe(201);
    const { id, doc_no, pdf_status } = (await saved.json()) as Saved;
    expect(pdf_status).toBe("pending"); // the sale does not wait for Gotenberg

    expect(await settled(staff, id, "pdf_status")).toBe("ready");
    expect(await settled(staff, id, "idcard_status")).toBe("ready");
    const detailText = await (await staff.get(`/api/buy/${id}`)).text();
    const bill = JSON.parse(detailText) as Bill;
    // no public URL, no bucket key, no full national ID in what the browser gets (R13)
    expect(detailText).not.toMatch(/https?:\/\/|receipts\/|idcards\/|X-Amz-/);
    expect(detailText).not.toContain(nationalId);

    const receipt = await test.step("the receipt: A4, Thai, the api's numbers as printed", async () => {
      const file = await downloadPdf(staff, `/api/buy/${id}/pdf`, `${doc_no}.pdf`);
      expect(file.pdf.pageCount).toBe(1);
      const expected = [
        "ใบรับซื้อของเก่า/ใบสำคัญจ่าย",
        doc_no,
        `ชื่อผู้ขาย : ${seller}`,
        nationalId, // the archived tax document is the one place with the full ID (R13)
        "รายละเอียด (ถ้ามี): ทดสอบ e2e ใบรับซื้อ",
        "สองหมื่นหนึ่งพันห้าร้อยสามสิบบาทถ้วน", // 21,530.00 in words
        WATERMARK,
        ...bill.lines.flatMap((l) => [printed(l.weight_g), printed(l.price_per_g), printed(l.amount)]),
        ...bill.payments.map((p) => printed(p.amount)),
      ];
      for (const text of expected) expect(file.text, text).toContain(text);
      expect(file.text).not.toContain("ยกเลิก");
      return file;
    });

    await test.step("a reprint is the stored file, byte for byte", async () => {
      const again = await staff.get(`/api/buy/${id}/pdf`);
      expect(Buffer.compare(await again.body(), receipt.bytes)).toBe(0);
    });

    await test.step("private: no session 401 · another branch 404 · no route deletes it", async () => {
      await expectApiError(await (await anonymous()).get(`/api/buy/${id}/pdf`), 401);
      await expectApiError(await other.get(`/api/buy/${id}/pdf`), 404);
      await expectApiError(await staff.delete(`/api/buy/${id}/pdf`), 404);
    });

    await test.step("the ID card copy is a separate file only accounting and admin open (rule 5)", async () => {
      await expectApiError(await staff.get(`/api/buy/${id}/idcard`), 403);
      const copy = await downloadPdf(accounting, `/api/buy/${id}/idcard`, `${doc_no}_idcard.pdf`);
      expect(Buffer.compare(copy.bytes, receipt.bytes)).not.toBe(0);
      expect(copy.text).toContain(doc_no);
      expect(copy.text).toContain(WATERMARK);
    });
  });

  test("cancelling adds a stamped PDF and keeps the original byte for byte", async ({ signedIn }) => {
    test.setTimeout(180_000);
    const [staff, manager] = await Promise.all([signedIn("staff"), signedIn("manager")]);
    const { body } = await counterBill(staff, manager);
    const saved = (await (
      await staff.post("/api/buy", { data: { ...body, idempotency_key: idempotencyKey() } })
    ).json()) as Saved;
    expect(await settled(staff, saved.id, "pdf_status")).toBe("ready");
    const original = await downloadPdf(staff, `/api/buy/${saved.id}/pdf`, `${saved.doc_no}.pdf`);

    const reason = "ทดสอบ e2e ยกเลิกบิล";
    await test.step("only a manager or admin cancels, with a reason", async () => {
      await expectApiError(await staff.post(`/api/buy/${saved.id}/void`, { data: { reason } }), 403);
      await expectFieldError(await manager.post(`/api/buy/${saved.id}/void`, { data: {} }), 400, "reason");
      const voided = await manager.post(`/api/buy/${saved.id}/void`, { data: { reason } });
      expect(voided.status(), await voided.text()).toBe(200);
      expect(await voided.json()).toMatchObject({ id: saved.id, status: "void", void_reason: reason });
      await expectFieldError(await manager.post(`/api/buy/${saved.id}/void`, { data: { reason } }), 409, "status");
    });

    expect(await settled(staff, saved.id, "void_pdf_status")).toBe("ready");

    await test.step("the bill now opens as a new, stamped file", async () => {
      const stamped = await downloadPdf(staff, `/api/buy/${saved.id}/pdf`, `${saved.doc_no}_void.pdf`);
      expect(Buffer.compare(stamped.bytes, original.bytes)).not.toBe(0);
      for (const text of ["ยกเลิก", `ใบรับซื้อฉบับนี้ถูกยกเลิก · เหตุผล: ${reason}`, saved.doc_no]) {
        expect(stamped.text, text).toContain(text);
      }
      const explicit = await staff.get(`/api/buy/${saved.id}/pdf?version=void`);
      expect(Buffer.compare(await explicit.body(), stamped.bytes)).toBe(0);
    });

    await test.step("the original is still there, unchanged — never deleted or overwritten", async () => {
      const kept = await downloadPdf(staff, `/api/buy/${saved.id}/pdf?version=original`, `${saved.doc_no}.pdf`);
      expect(Buffer.compare(kept.bytes, original.bytes)).toBe(0);
    });

    await test.step("the list keeps the bill but its totals leave it out", async () => {
      const found = (await (await staff.get(`/api/buy?q=${encodeURIComponent(saved.doc_no)}`)).json()) as BillList;
      expect(found.items.map((i) => i.id)).toEqual([saved.id]);
      expect(found.totals).toEqual({ count: "0", total_weight: "0.000", total_amount: "0.00" });
    });
  });
});
