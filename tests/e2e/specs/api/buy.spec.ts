import { randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../../lib/fixtures";
import { FOREIGN_ORIGIN, expectApiError, expectFieldError } from "../../lib/http";
import { A4_PT, fontProblems, inspect } from "../../lib/pdf";
import { syntheticNationalId, thaiName } from "../../lib/synthetic";

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
/** a full 13-digit run = an unmasked national ID (R13) */
const FULL_ID = /\d{13}/;

/** the counter's bill: the real-receipt gold line (5.860 g for 20,030) plus silver, paid in cash */
async function counterBill(staff: APIRequestContext, manager: APIRequestContext) {
  // R7: today's price must exist before a bill opens — the same 67,850 the gold-price journey sets
  expect((await manager.put("/api/gold-price/today", { data: { bar_sell: "67850" } })).status()).toBe(200);

  const metals = (await (await staff.get("/api/metals")).json()) as Metal[];
  const metal = (code: string) => metals.find((m) => m.code === code)?.id ?? "";

  const nationalId = syntheticNationalId();
  const seller = thaiName("ผู้ขาย");
  const created = await staff.post("/api/customers", {
    multipart: { national_id: nationalId, name_th: seller, card_expire_text: "31/12/2574" },
  });
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
    const saved = await test.step("save → 201 with this month's RC number, PDF queued", async () => {
      const res = await staff.post("/api/buy", { data: { ...body, idempotency_key: key, detail: "ทดสอบ e2e" } });
      expect(res.status(), await res.text()).toBe(201);
      const bill = (await res.json()) as Saved;
      expect(bill.doc_no).toMatch(/^RC\d{4}-\d{4}$/);
      expect(bill.pdf_status).toBe("pending");
      return bill;
    });

    await test.step("pressing save again (same key) returns the same bill, not a second one", async () => {
      const res = await staff.post("/api/buy", { data: { ...body, idempotency_key: key } });
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual(saved);
    });

    await test.step("the bill reads back exactly as quoted — masked seller, no-store", async () => {
      const res = await staff.get(`/api/buy/${saved.id}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["cache-control"]).toBe("no-store");
      const text = await res.text();
      expect(text).not.toMatch(FULL_ID);
      const bill = JSON.parse(text) as Bill;
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

/**
 * R15 · CLAUDE.md rule 5 — every bill gets an archived A4 PDF in the private bucket; reprints are the same file,
 * cancelling adds a new file and never deletes the old one. Written against spec §5 (GET /buy/{id}/pdf ·
 * POST /buy/{id}/void) and parked with test.fixme: the api does not render receipts yet — saveBuy leaves
 * pdf_status "pending" and neither route exists. Enabling them is part of the change that wires the pipeline.
 */
const PENDING_PIPELINE = {
  tag: "@pending",
  annotation: {
    type: "pending",
    description:
      "receipt pipeline not wired yet: POST /api/buy leaves pdf_status 'pending'; no GET /api/buy/:id/pdf, " +
      "no POST /api/buy/:id/void (spec §5 · §9.2)",
  },
};

test.describe("receipt PDF — archived, private, immutable (R15 · rule 5 · spec §9.2)", () => {
  test.fixme(
    "the bill's PDF lands in the bucket and downloads through the api only",
    PENDING_PIPELINE,
    async ({ signedIn, anonymous }) => {
      const [staff, manager, other] = await Promise.all([
        signedIn("staff"),
        signedIn("manager"),
        signedIn("otherBranch"),
      ]);
      const { body, seller } = await counterBill(staff, manager);
      const saved = await staff.post("/api/buy", { data: { ...body, idempotency_key: idempotencyKey() } });
      expect(saved.status()).toBe(201);
      const { id, doc_no } = (await saved.json()) as Saved;

      // spec §9.2: pending → ready once Gotenberg rendered it and the file is in the bucket
      await expect
        .poll(async () => ((await (await staff.get(`/api/buy/${id}`)).json()) as Bill).pdf_status, { timeout: 60_000 })
        .toBe("ready");

      const res = await staff.get(`/api/buy/${id}/pdf`);
      expect(res.status()).toBe(200);
      expect(res.headers()).toMatchObject({
        "content-type": "application/pdf",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      const bytes = await res.body();
      const pdf = await inspect(bytes);
      expect(pdf.header).toMatch(/^%PDF-/);
      expect(pdf.mediaBoxes).toHaveLength(1);
      expect(Math.abs((pdf.mediaBoxes[0]?.width ?? 0) - A4_PT.width)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((pdf.mediaBoxes[0]?.height ?? 0) - A4_PT.height)).toBeLessThanOrEqual(0.5);
      expect(fontProblems(pdf.fonts)).toEqual([]);
      // the printed numbers are the api's money strings, formatted for print — and the seller in Thai
      const text = pdf.text.join("\n");
      for (const printed of [doc_no, seller, "5.860", "100.000", "20,030.00", "1,500.00", "21,530.00"]) {
        expect(text, printed).toContain(printed);
      }
      expect(text).toContain("สองหมื่นหนึ่งพันห้าร้อยสามสิบบาทถ้วน");

      // a reprint is the stored file, byte for byte — never a new render
      expect(Buffer.compare(await (await staff.get(`/api/buy/${id}/pdf`)).body(), bytes)).toBe(0);
      // private: no session = 401, another branch = 404, and no route deletes it
      expect((await (await anonymous()).get(`/api/buy/${id}/pdf`)).status()).toBe(401);
      expect((await other.get(`/api/buy/${id}/pdf`)).status()).toBe(404);
      expect((await staff.delete(`/api/buy/${id}/pdf`)).status()).toBeGreaterThanOrEqual(400);
    },
  );

  test.fixme("cancelling adds a stamped PDF and keeps the original", PENDING_PIPELINE, async ({ signedIn }) => {
    const [staff, manager] = await Promise.all([signedIn("staff"), signedIn("manager")]);
    const { body } = await counterBill(staff, manager);
    const saved = (await (
      await staff.post("/api/buy", { data: { ...body, idempotency_key: idempotencyKey() } })
    ).json()) as Saved;
    await expect
      .poll(async () => ((await (await staff.get(`/api/buy/${saved.id}`)).json()) as Bill).pdf_status, {
        timeout: 60_000,
      })
      .toBe("ready");
    const original = await (await staff.get(`/api/buy/${saved.id}/pdf`)).body();

    // spec §10: cancelling is a manager's call
    await expectApiError(await staff.post(`/api/buy/${saved.id}/void`, { data: { reason: "ทดสอบ e2e" } }), 403);
    const voided = await manager.post(`/api/buy/${saved.id}/void`, { data: { reason: "ทดสอบ e2e" } });
    expect(voided.status()).toBe(200);
    await expect
      .poll(async () => ((await (await staff.get(`/api/buy/${saved.id}`)).json()) as Bill).status, { timeout: 60_000 })
      .toBe("void");

    // the void copy is a new file (…_void.pdf) with the stamp and the reason; the original stays in the bucket —
    // no delete exists and putNew refuses to overwrite (apps/api storage tests); spec §5 names no route for it
    const stamped = await (await staff.get(`/api/buy/${saved.id}/pdf`)).body();
    expect(Buffer.compare(stamped, original)).not.toBe(0);
    const text = (await inspect(stamped)).text.join("\n");
    expect(text).toContain("ยกเลิก");
    expect(text).toContain("ทดสอบ e2e");
  });
});
