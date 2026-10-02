import { D, ZERO, fmtMoney, fmtWeight, pricePerGram } from "@ong/core";
import { branch, buyLine, buyReceipt, customer, metal, payment, stockMovement } from "@ong/db";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PURCHASE_CSV_HEADER } from "../services/reports";
import { expectMoneyAsStrings } from "../test/assertions";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import { syntheticNationalId, testName } from "../test/synthetic";

const available = await databaseAvailable();
const PW = "correct-horse-battery";
const NO_BRANCH = "00000000-0000-4000-8000-000000000000";

// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const ID_A = "1103700123458";
const ID_B = "3100500987657";
const ID_C = "5109900112237";
// ชื่อที่ Excel จะตีความเป็นสูตร — CSV ต้องกันไว้ (CSV injection)
const FORMULA_NAME = '=HYPERLINK("http://evil.test","คลิก")';

// 10:00 น. วันที่ 5 ต.ค. 2569 เวลาไทย
const NOW = new Date("2026-10-05T03:00:00Z");
const HQ = "สำนักงานใหญ่ (สาขา 1)";

interface MetalAmount {
  metal_code: string;
  name_th: string;
  grams: string;
  amount: string;
}
interface Totals {
  count: string;
  total_weight: string;
  total_amount: string;
  by_metal: MetalAmount[];
}
interface Row {
  no: number;
  id: string;
  date: string;
  time: string;
  doc_no: string;
  branch: { id: string; code: string; name: string };
  customer: { id: string; name_th: string; national_id_masked: string };
  metals: MetalAmount[];
  items: Item[];
  total_weight: string;
  total_amount: string;
  created_by: { id: string; name: string };
}
interface Item {
  label: string;
  grams: string;
  amount: string;
}
interface StockMetal {
  metal_code: string;
  name_th: string;
  grams: string;
}
interface StockRes {
  as_of: string;
  by_branch: { branch: { id: string; code: string; name: string }; by_metal: StockMetal[] }[];
  total: { by_metal: StockMetal[] };
}
interface PurchaseRes {
  date_from: string;
  date_to: string;
  metal: string | null;
  rows: Row[];
  by_branch: (Totals & { branch: { id: string; code: string; name: string } })[];
  total: Totals;
}

/**
 * ราคาที่ระบบคิดของแถว (assessBuyLine · UAT 30 ก.ย. 2569) ตามที่คอลัมน์ numeric เก็บ
 * ไม่ส่ง = บิลก่อนมีค่าบริสุทธิ์ (ราคาพิมพ์เอง) → ทั้ง 5 คอลัมน์เป็น null
 */
interface Assessed {
  /** purity_percent numeric(6,3) เช่น "96.500" */
  purity: string;
  /** deduct_percent numeric(5,2) เช่น "3.00" */
  deduct: string;
  /** base_price — ทอง/นาก = ทองแท่งรับซื้อ (บาทต่อบาททอง) · เงิน/แพลตตินั่ม = บาทต่อกรัม */
  base: string;
  /** assessed_price_per_g */
  unit: string;
  /** assessment_amount (ก่อนหัก %) */
  gross: string;
}
type Line = [metal: string, weight: string, amount: string, assessed?: Assessed];
interface BillSpec {
  code: string;
  date: string;
  docNo: string;
  cust: "A" | "B" | "C";
  lines: Line[];
  by: string;
  /** ยกเลิกแล้ว — สถานะ void + แถวสต็อกติดลบลงวันที่ของบิล (แบบ void ของ PR #54) */
  voided?: boolean;
  /** ชื่อใน snapshot ต่างจากทะเบียนลูกค้า (ลูกค้าถูกแก้ชื่อทีหลัง) */
  snapshotName?: string;
}
interface Fixture {
  t: TestApp;
  metals: Record<string, string>;
  userIds: Record<string, string>;
  nationalIds: Record<BillSpec["cust"], string>;
}

/** บิลหนึ่งใบแบบที่ POST /buy บันทึก: หัวบิล + แถว + ชำระ + สต็อก ในทรานแซกชันเดียว */
async function insertBill(fx: Fixture, s: BillSpec, idempotencyKey: string): Promise<string> {
  const { t, metals, userIds } = fx;
  const weight = s.lines.reduce((sum, [, w]) => sum.plus(D(w)), ZERO);
  const amount = s.lines.reduce((sum, [, , a]) => sum.plus(D(a)), ZERO);
  const nationalId = fx.nationalIds[s.cust];
  const branchId = t.branches[s.code] ?? "";
  return t.db.transaction(async (tx) => {
    const [c] = await tx.select().from(customer).where(eq(customer.nationalId, nationalId));
    if (!c) throw new Error("fixture customer missing");
    const [r] = await tx
      .insert(buyReceipt)
      .values({
        branchId,
        docNo: s.docNo,
        date: s.date,
        time: "10:00",
        customerId: c.id,
        customerSnapshot: {
          national_id: c.nationalId,
          name_th: s.snapshotName ?? c.nameTh,
          name_en: null,
          birthday_text: null,
          religion: null,
          address: null,
          card_issue_text: null,
          card_expire_text: c.cardExpireText,
          mobile: null,
          phone2: null,
          photo_key: null,
        },
        goldPriceSnapshot: "67850",
        totalWeight: fmtWeight(weight),
        totalAmount: fmtMoney(amount),
        createdBy: userIds[s.by] ?? "",
        idempotencyKey,
        ...(s.voided
          ? { status: "void" as const, voidedBy: userIds.mgr0, voidedAt: NOW, voidReason: "ทดสอบยกเลิก" }
          : {}),
      })
      .returning({ id: buyReceipt.id });
    if (!r) throw new Error("insert failed");
    // แทรกแถวกลับด้าน — "ลำดับที่ปรากฏครั้งแรก" ของ items ต้องมาจาก line_no ไม่ใช่ลำดับที่ Postgres เก็บไว้
    await tx.insert(buyLine).values(
      s.lines
        .map(([m, w, a, x], i) => ({
          receiptId: r.id,
          lineNo: i + 1,
          metalId: metals[m] ?? "",
          weightG: w,
          amount: a,
          pricePerG: fmtMoney(pricePerGram(D(a), D(w))),
          purityPercent: x?.purity ?? null,
          deductPercent: x?.deduct ?? null,
          basePrice: x?.base ?? null,
          assessedPricePerG: x?.unit ?? null,
          assessmentAmount: x?.gross ?? null,
        }))
        .reverse(),
    );
    await tx.insert(payment).values({ receiptId: r.id, method: "cash", amount: fmtMoney(amount) });
    const moves = s.lines.map(([m, w]) => ({ branchId, metalId: metals[m] ?? "", sourceReceiptId: r.id, grams: w }));
    await tx.insert(stockMovement).values(moves.map((mv) => ({ ...mv, date: s.date })));
    if (s.voided) {
      await tx
        .insert(stockMovement)
        .values(moves.map((mv) => ({ ...mv, date: s.date, grams: fmtWeight(D(mv.grams).negated()) })));
    }
    return r.id;
  });
}

const sumOf = (values: string[]) => values.reduce((s, v) => s.plus(D(v)), ZERO);
const gram = (code: string, grams: string, amount: string): MetalAmount => ({
  metal_code: code,
  name_th: { gold: "ทอง", nak: "นาก", silver: "เงิน", platinum: "แพลตตินั่ม" }[code] ?? "",
  grams,
  amount,
});
const item = (label: string, grams: string, amount: string): Item => ({ label, grams, amount });
/** CSV เป็น byte — Response.text() ตัด BOM ทิ้ง จึงต้องดู byte จริง */
const csvOf = async (res: Response) => {
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, text: new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) };
};
/** items มาจากแถวรายการชุดเดียวกับยอดของบิล (หลังตัวกรองโลหะ) — Σ กรัม · Σ บาท ต้องเท่ายอดของแถวพอดี */
function expectItemsAddUp(rows: Row[]) {
  for (const x of rows) {
    expect(fmtWeight(sumOf(x.items.map((i) => i.grams))), `${x.doc_no} grams`).toBe(x.total_weight);
    expect(fmtMoney(sumOf(x.items.map((i) => i.amount))), `${x.doc_no} amount`).toBe(x.total_amount);
  }
}

describe.skipIf(!available)("รายงาน (M3.6 · finance_report3 · stock_show) — /api/reports", () => {
  let t: TestApp;
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const custIds: Record<string, string> = {};
  const bills: Record<string, string> = {};
  let metals: Record<string, string> = {};
  let keySeq = 0;

  const ref = (code: string) => ({
    id: t.branches[code] ?? "",
    code,
    name: code === "00000" ? HQ : code === "00001" ? "สาขา 2" : "สาขา 3",
  });

  const addBill = (s: BillSpec) =>
    insertBill(
      { t, metals, userIds, nationalIds: { A: ID_A, B: ID_B, C: ID_C } },
      s,
      `report-fixture-${String(++keySeq).padStart(6, "0")}`,
    );

  beforeAll(async () => {
    t = await startTestApp({ now: () => NOW });
    const accounts = [
      { who: "staff0", branch: "00000" },
      { who: "staff1", branch: "00001" },
      { who: "mgr0", role: "manager" as const, branch: "00000" },
      { who: "mgr1", role: "manager" as const, branch: "00001" },
      { who: "mgr2", role: "manager" as const, branch: "00002" },
      { who: "acct", role: "accounting" as const, branch: "00000", viewAll: true },
      { who: "acct2", role: "accounting" as const, branch: "00002" }, // บัญชีที่ดูแลเฉพาะสาขา 00002
      { who: "admin", role: "admin" as const, viewAll: true },
      { who: "nobranch", role: "manager" as const },
    ];
    for (const a of accounts) {
      const created = await t.createUser({ email: `${a.who}@ong.test`, password: PW, ...a });
      userIds[a.who] = created.id;
      cookies[a.who] = await t.login(`${a.who}@ong.test`, PW);
    }
    metals = Object.fromEntries((await t.db.select().from(metal)).map((m) => [m.code, m.id]));
    const rows = await t.db
      .insert(customer)
      .values([
        { nationalId: ID_A, nameTh: "นายทดสอบ ซื้อทอง", cardExpireText: "31/12/2574" },
        { nationalId: ID_B, nameTh: "นางสาวบี ทดสอบ", cardExpireText: "31/12/2574" },
        { nationalId: ID_C, nameTh: "นายซี ทดสอบ", cardExpireText: "31/12/2574" },
      ])
      .returning();
    for (const r of rows) custIds[{ [ID_A]: "A", [ID_B]: "B", [ID_C]: "C" }[r.nationalId] ?? ""] = r.id;

    // ต.ค. 2569 — 00000: 3 บิล (1 ใบยกเลิก) · 00001: 2 บิล · 00002: 1 บิล · 30 ก.ย. = นอกช่วงเดือน
    bills.b1 = await addBill({
      code: "00000",
      date: "2026-10-01",
      docNo: "RC6910-0001",
      cust: "A",
      lines: [["gold", "5.860", "20030.00"]],
      by: "staff0",
    });
    bills.b2 = await addBill({
      code: "00000",
      date: "2026-10-02",
      docNo: "RC6910-0002",
      cust: "B",
      lines: [
        ["gold", "10.000", "30000.00"],
        ["silver", "100.000", "1500.00"],
      ],
      by: "staff0",
    });
    bills.b3 = await addBill({
      code: "00000",
      date: "2026-10-03",
      docNo: "RC6910-0003",
      cust: "A",
      lines: [["silver", "50.500", "800.50"]],
      by: "staff0",
      voided: true,
    });
    bills.b4 = await addBill({
      code: "00000",
      date: "2026-09-30",
      docNo: "RC6909-0001",
      cust: "A",
      lines: [["gold", "1.000", "3000.00"]],
      by: "staff0",
    });
    bills.b5 = await addBill({
      code: "00001",
      date: "2026-10-01",
      docNo: "RC6910-0001",
      cust: "C",
      lines: [["nak", "3.250", "5000.00"]],
      by: "staff1",
      snapshotName: FORMULA_NAME,
    });
    bills.b6 = await addBill({
      code: "00001",
      date: "2026-10-05",
      docNo: "RC6910-0002",
      cust: "B",
      lines: [
        ["platinum", "2.000", "2400.00"],
        ["gold", "0.500", "1500.25"],
      ],
      by: "staff1",
    });
    bills.b7 = await addBill({
      code: "00002",
      date: "2026-10-04",
      docNo: "RC6910-0001",
      cust: "A",
      lines: [["gold", "7.777", "25555.55"]],
      by: "mgr2",
    });
    // ยอดยกมา (ไม่มีบิลต้นทาง) — เข้าสต็อก ไม่เข้ารายงานยอดซื้อ
    await t.db.insert(stockMovement).values([
      { branchId: t.branches["00000"] ?? "", metalId: metals.platinum ?? "", date: "2026-09-15", grams: "4.990" },
      { branchId: t.branches["00002"] ?? "", metalId: metals.silver ?? "", date: "2026-09-15", grams: "18169.697" },
    ]);
  });
  afterAll(async () => {
    await t?.close();
  });

  const get = async (path: string, who: string) => t.request(`/api/reports${path}`, { cookie: cookies[who] });
  const purchase = async (qs: string, who = "acct") => {
    const res = await get(`/purchase${qs ? `?${qs}` : ""}`, who);
    expect(res.status).toBe(200);
    return (await res.json()) as PurchaseRes;
  };

  describe("รายงานยอดซื้อ /purchase", () => {
    it("ต้อง login · staff = 403 · manager ที่ไม่มีสาขา = 403 (fail-closed)", async () => {
      expect((await t.request("/api/reports/purchase")).status).toBe(401);
      expect((await get("/purchase", "staff0")).status).toBe(403);
      expect((await get("/purchase?format=csv", "staff0")).status).toBe(403);
      expect((await get("/purchase", "nobranch")).status).toBe(403);
      for (const who of ["mgr0", "acct", "admin"]) expect((await get("/purchase", who)).status).toBe(200);
    });

    it("รูปคำตอบ: แถวละบิล (ลำดับ · วันที่ · เลขที่ · ชื่อ · เลขบัตรมาสก์ · โลหะ · รายการ · กรัม · บาท · ผู้บันทึก) + ต่อสาขา + รวม", async () => {
      const res = await get("/purchase", "mgr0");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body: unknown = await res.json();
      expectMoneyAsStrings(body, "GET /reports/purchase");
      expect(JSON.stringify(body)).not.toMatch(/\d{13}/);
      // บิลก่อนมีค่าบริสุทธิ์ (purity_percent = null): items = ชื่อโลหะ หนึ่งรายการต่อโลหะ เหมือนใบที่พิมพ์ไว้แล้ว
      expect(body).toEqual({
        date_from: "2026-10-01",
        date_to: "2026-10-05",
        metal: null,
        rows: [
          {
            no: 1,
            id: bills.b1,
            date: "2026-10-01",
            time: "10:00",
            doc_no: "RC6910-0001",
            branch: ref("00000"),
            customer: { id: custIds.A, name_th: "นายทดสอบ ซื้อทอง", national_id_masked: "1 XXXX XXXXX 45 8" },
            metals: [gram("gold", "5.860", "20030.00")],
            items: [item("ทอง", "5.860", "20030.00")],
            total_weight: "5.860",
            total_amount: "20030.00",
            created_by: { id: userIds.staff0, name: "staff0" },
          },
          {
            no: 2,
            id: bills.b2,
            date: "2026-10-02",
            time: "10:00",
            doc_no: "RC6910-0002",
            branch: ref("00000"),
            customer: { id: custIds.B, name_th: "นางสาวบี ทดสอบ", national_id_masked: "3 XXXX XXXXX 65 7" },
            metals: [gram("gold", "10.000", "30000.00"), gram("silver", "100.000", "1500.00")],
            items: [item("ทอง", "10.000", "30000.00"), item("เงิน", "100.000", "1500.00")],
            total_weight: "110.000",
            total_amount: "31500.00",
            created_by: { id: userIds.staff0, name: "staff0" },
          },
        ],
        by_branch: [
          {
            branch: ref("00000"),
            count: "2",
            total_weight: "115.860",
            total_amount: "51530.00",
            by_metal: [
              gram("gold", "15.860", "50030.00"),
              gram("nak", "0.000", "0.00"),
              gram("silver", "100.000", "1500.00"),
              gram("platinum", "0.000", "0.00"),
            ],
          },
        ],
        total: {
          count: "2",
          total_weight: "115.860",
          total_amount: "51530.00",
          by_metal: [
            gram("gold", "15.860", "50030.00"),
            gram("nak", "0.000", "0.00"),
            gram("silver", "100.000", "1500.00"),
            gram("platinum", "0.000", "0.00"),
          ],
        },
      });
    });

    it("ทุกสาขา: เรียงวันที่ → สาขา → เลขที่ · ยอดรวม = Σ แถว = Σ ยอดบิลใน DB · Σ ต่อสาขา = รวม", async () => {
      const r = await purchase("");
      expect(r.rows.map((x) => [x.no, x.date, x.branch.code, x.doc_no])).toEqual([
        [1, "2026-10-01", "00000", "RC6910-0001"],
        [2, "2026-10-01", "00001", "RC6910-0001"],
        [3, "2026-10-02", "00000", "RC6910-0002"],
        [4, "2026-10-04", "00002", "RC6910-0001"],
        [5, "2026-10-05", "00001", "RC6910-0002"],
      ]);
      expect(r.total).toEqual({
        count: "5",
        total_weight: "129.387",
        total_amount: "85985.80",
        by_metal: [
          gram("gold", "24.137", "77085.80"),
          gram("nak", "3.250", "5000.00"),
          gram("silver", "100.000", "1500.00"),
          gram("platinum", "2.000", "2400.00"),
        ],
      });

      // บิลเก่าทั้งหมด: items = ชื่อโลหะ ลำดับตาม line_no · Σ items = ยอดของแถว
      expect(r.rows.map((x) => x.items.map((i) => i.label))).toEqual([
        ["ทอง"],
        ["นาก"],
        ["ทอง", "เงิน"],
        ["ทอง"],
        ["แพลตตินั่ม", "ทอง"],
      ]);
      expectItemsAddUp(r.rows);
      // Σ แถว (decimal.js) = รวมทั้งสิ้น
      expect(fmtWeight(sumOf(r.rows.map((x) => x.total_weight)))).toBe(r.total.total_weight);
      expect(fmtMoney(sumOf(r.rows.map((x) => x.total_amount)))).toBe(r.total.total_amount);
      // แถวของบิล = ยอดบนหัวบิล (ไม่มีตัวกรองโลหะ) · Σ ยอดหัวบิล active ในช่วง = รวมทั้งสิ้น
      const heads = await t.db
        .select()
        .from(buyReceipt)
        .where(
          and(eq(buyReceipt.status, "active"), gte(buyReceipt.date, "2026-10-01"), lte(buyReceipt.date, "2026-10-05")),
        );
      expect(heads).toHaveLength(r.rows.length);
      for (const x of r.rows) {
        const h = heads.find((b) => b.id === x.id);
        expect([x.total_weight, x.total_amount]).toEqual([h?.totalWeight, h?.totalAmount]);
      }
      expect(fmtMoney(sumOf(heads.map((h) => h.totalAmount)))).toBe(r.total.total_amount);
      // Σ ต่อสาขา = รวม · Σ ต่อโลหะ = รวม
      expect(r.by_branch.map((b) => [b.branch.code, b.count, b.total_weight, b.total_amount])).toEqual([
        ["00000", "2", "115.860", "51530.00"],
        ["00001", "2", "5.750", "8900.25"],
        ["00002", "1", "7.777", "25555.55"],
      ]);
      expect(fmtMoney(sumOf(r.by_branch.map((b) => b.total_amount)))).toBe(r.total.total_amount);
      expect(String(r.by_branch.reduce((n, b) => n + Number(b.count), 0))).toBe(r.total.count);
      expect(fmtWeight(sumOf(r.total.by_metal.map((m) => m.grams)))).toBe(r.total.total_weight);
      expect(fmtMoney(sumOf(r.total.by_metal.map((m) => m.amount)))).toBe(r.total.total_amount);
      r.total.by_metal.forEach((m, i) => {
        expect(fmtMoney(sumOf(r.by_branch.map((b) => b.by_metal[i]?.amount ?? "0")))).toBe(m.amount);
        expect(fmtWeight(sumOf(r.by_branch.map((b) => b.by_metal[i]?.grams ?? "0")))).toBe(m.grams);
      });
    });

    it("บิลที่ยกเลิกไม่นับ ทั้งแถวและยอดรวม", async () => {
      const [voided] = await t.db
        .select()
        .from(buyReceipt)
        .where(eq(buyReceipt.id, bills.b3 ?? ""));
      expect(voided).toMatchObject({ status: "void", date: "2026-10-03" });
      const r = await purchase("date_from=2026-10-03&date_to=2026-10-03");
      expect(r.rows).toEqual([]);
      expect(r.total).toMatchObject({ count: "0", total_weight: "0.000", total_amount: "0.00" });
      expect((await purchase("")).rows.map((x) => x.id)).not.toContain(bills.b3);
    });

    it("ช่วงวันที่รวมวันต้นและวันท้าย · ไม่ส่งวันที่ = เดือนนี้ถึงวันนี้ (เวลาไทย)", async () => {
      expect((await purchase("date_from=2026-10-02&date_to=2026-10-04")).rows.map((x) => x.id)).toEqual([
        bills.b2,
        bills.b7,
      ]);
      expect((await purchase("date_from=2026-09-30&date_to=2026-09-30")).rows.map((x) => x.id)).toEqual([bills.b4]);
      expect((await purchase("date_from=2026-09-01&date_to=2026-10-01")).rows.map((x) => x.id)).toEqual([
        bills.b4,
        bills.b1,
        bills.b5,
      ]);
      const r = await purchase("date_from=&date_to=");
      expect([r.date_from, r.date_to]).toEqual(["2026-10-01", "2026-10-05"]);
      expect(r.rows).toHaveLength(5);
    });

    it("กรองโลหะ = นับเฉพาะแถวของโลหะนั้น (บิลที่มีหลายโลหะเห็นเฉพาะส่วนนั้น)", async () => {
      const r = await purchase("metal=gold");
      expect(r.metal).toBe("gold");
      expect(r.rows.map((x) => [x.doc_no, x.branch.code, x.total_weight, x.total_amount])).toEqual([
        ["RC6910-0001", "00000", "5.860", "20030.00"],
        ["RC6910-0002", "00000", "10.000", "30000.00"],
        ["RC6910-0001", "00002", "7.777", "25555.55"],
        ["RC6910-0002", "00001", "0.500", "1500.25"],
      ]);
      expect(r.rows[1]?.metals).toEqual([gram("gold", "10.000", "30000.00")]);
      // items ก็กรองตามโลหะด้วย — เงินของ RC6910-0002 · แพลตตินั่มของ 00001/RC6910-0002 ไม่ติดมา
      expect(r.rows[1]?.items).toEqual([item("ทอง", "10.000", "30000.00")]);
      expect(r.rows[3]?.items).toEqual([item("ทอง", "0.500", "1500.25")]);
      expectItemsAddUp(r.rows);
      expect(r.total).toEqual({
        count: "4",
        total_weight: "24.137",
        total_amount: "77085.80",
        by_metal: [gram("gold", "24.137", "77085.80")],
      });
      expect(r.by_branch.map((b) => [b.branch.code, b.count, b.total_amount])).toEqual([
        ["00000", "2", "50030.00"],
        ["00001", "1", "1500.25"],
        ["00002", "1", "25555.55"],
      ]);
      const none = await purchase("metal=unobtanium");
      expect(none.rows).toEqual([]);
      expect(none.total).toEqual({ count: "0", total_weight: "0.000", total_amount: "0.00", by_metal: [] });
    });

    it("scoping: manager เห็นเฉพาะสาขาตัวเอง · branch_id ของสาขาอื่น = ว่าง ไม่ใช่ทุกสาขา", async () => {
      const own = await purchase("", "mgr1");
      expect(own.rows.map((x) => x.id)).toEqual([bills.b5, bills.b6]);
      expect(own.rows.every((x) => x.branch.code === "00001")).toBe(true);
      expect(own.by_branch.map((b) => b.branch.code)).toEqual(["00001"]);
      expect(own.total).toMatchObject({ count: "2", total_weight: "5.750", total_amount: "8900.25" });

      for (const qs of [`branch_id=${t.branches["00000"]}`, "branch_id=not-a-uuid", `branch_id=${NO_BRANCH}`]) {
        const other = await purchase(qs, "mgr1");
        expect(other.rows).toEqual([]);
        expect(other.by_branch).toEqual([]);
        expect(other.total).toMatchObject({ count: "0", total_weight: "0.000", total_amount: "0.00" });
      }
      const csv = await get(`/purchase?format=csv&branch_id=${t.branches["00000"]}`, "mgr1");
      expect((await csvOf(csv)).text).not.toContain("RC6910-0001,00000");
    });

    it("branch_id ของสาขาที่อ่านได้ = เฉพาะสาขานั้น", async () => {
      const r = await purchase(`branch_id=${t.branches["00002"]}`);
      expect(r.rows.map((x) => x.id)).toEqual([bills.b7]);
      expect(r.by_branch.map((b) => b.branch.code)).toEqual(["00002"]);
      expect(r.total).toMatchObject({ count: "1", total_amount: "25555.55" });
    });

    it("สาขาที่ปิดแล้ว: manager ของสาขานั้น = 403 · accounting/admin ยังอ่านย้อนหลังได้ (forUserHistory)", async () => {
      await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
      try {
        expect((await get("/purchase", "mgr2")).status).toBe(403);
        for (const who of ["acct", "admin"]) {
          const r = await purchase("", who);
          expect(r.by_branch.map((b) => b.branch.code)).toEqual(["00000", "00001", "00002"]);
          expect(r.rows.map((x) => x.id)).toContain(bills.b7);
          expect(r.total).toMatchObject({ count: "5", total_amount: "85985.80" });
        }
        // บัญชีที่มีสิทธิ์เฉพาะสาขาที่ปิด: ยังเห็นเฉพาะสาขานั้น ไม่ใช่ทุกสาขา
        const own = await purchase("", "acct2");
        expect(own.rows.map((x) => x.id)).toEqual([bills.b7]);
        expect(own.by_branch.map((b) => b.branch.code)).toEqual(["00002"]);
        // manager สาขาอื่นไม่เห็นสาขาที่ปิด
        expect((await purchase("", "mgr1")).by_branch.map((b) => b.branch.code)).toEqual(["00001"]);
      } finally {
        await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
      }
    });

    it("เลขบัตรมาสก์เสมอ — เลขเต็มไม่หลุดทั้ง JSON และ CSV (R13)", async () => {
      for (const path of ["/purchase", "/purchase?format=csv"]) {
        const res = await get(path, "acct");
        const { text } = await csvOf(res);
        for (const id of [ID_A, ID_B, ID_C]) expect(text).not.toContain(id);
        expect(text).toContain("1 XXXX XXXXX 45 8");
      }
    });

    it.each([
      ["date_from=2026-13-01", "date_from"],
      ["date_from=0000-01-01", "date_from"],
      ["date_to=05/10/2569", "date_to"],
      ["date_from=2026-10-05&date_to=2026-10-01", "date_to"],
      ["format=xlsx", "format"],
      [`metal=${"x".repeat(33)}`, "metal"],
    ])("query ผิด %s → 400 ชี้ %s", async (qs, field) => {
      const res = await get(`/purchase?${qs}`, "acct");
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field });
    });

    it("CSV: UTF-8 + BOM · หัวคอลัมน์ตาม finance_report3 · แถวละบิล · สรุปต่อสาขา + รวมทั้งสิ้น ตรงกับ JSON", async () => {
      const res = await get("/purchase?format=csv", "acct");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="purchase_2026-10-01_2026-10-05.csv"');
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { bytes, text } = await csvOf(res);
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

      const lines = text.slice(1).split("\r\n");
      expect(lines.at(-1)).toBe(""); // จบด้วย CRLF
      expect(lines[0]).toBe(PURCHASE_CSV_HEADER.join(","));
      expect(lines[1]).toBe(
        `1,2026-10-01,10:00,RC6910-0001,00000 ${HQ},นายทดสอบ ซื้อทอง,1 XXXX XXXXX 45 8,ทอง,5.860,20030.00,staff0`,
      );
      // ชื่อที่เป็นสูตร Excel ถูกนำหน้าด้วย ' และใส่ "…" เพราะมี , กับ "
      expect(lines[2]).toBe(
        `2,2026-10-01,10:00,RC6910-0001,00001 สาขา 2,"'=HYPERLINK(""http://evil.test"",""คลิก"")",5 XXXX XXXXX 23 7,นาก,3.250,5000.00,staff1`,
      );
      expect(lines[3]).toContain(",RC6910-0002,00000 ");
      expect(lines[3]).toContain(',"ทอง, เงิน",110.000,31500.00,');
      // 5 บิล + 3 สาขา × (4 โลหะ + ทุกประเภท) + รวมทั้งสิ้น (4 โลหะ + ทุกประเภท)
      expect(lines).toHaveLength(1 + 5 + 3 * 5 + 5 + 1);
      expect(lines.slice(6, 11)).toEqual([
        `รวม,,,,00000 ${HQ},,,ทอง,15.860,50030.00,`,
        `รวม,,,,00000 ${HQ},,,นาก,0.000,0.00,`,
        `รวม,,,,00000 ${HQ},,,เงิน,100.000,1500.00,`,
        `รวม,,,,00000 ${HQ},,,แพลตตินั่ม,0.000,0.00,`,
        `รวม,,,,00000 ${HQ},,,ทุกประเภท (2 ใบ),115.860,51530.00,`,
      ]);
      expect(lines.slice(-6, -1)).toEqual([
        "รวมทั้งสิ้น,,,,ทุกสาขา,,,ทอง,24.137,77085.80,",
        "รวมทั้งสิ้น,,,,ทุกสาขา,,,นาก,3.250,5000.00,",
        "รวมทั้งสิ้น,,,,ทุกสาขา,,,เงิน,100.000,1500.00,",
        "รวมทั้งสิ้น,,,,ทุกสาขา,,,แพลตตินั่ม,2.000,2400.00,",
        "รวมทั้งสิ้น,,,,ทุกสาขา,,,ทุกประเภท (5 ใบ),129.387,85985.80,",
      ]);
    });

    it("CSV กรองสาขาเดียว → ชื่อไฟล์มีรหัสสาขา", async () => {
      const res = await get(`/purchase?format=csv&branch_id=${t.branches["00001"]}`, "mgr1");
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="purchase_2026-10-01_2026-10-05_00001.csv"',
      );
    });
  });

  describe("สต็อกคงเหลือ /stock", () => {
    const stock = async (qs: string, who = "acct") => {
      const res = await get(`/stock${qs ? `?${qs}` : ""}`, who);
      expect(res.status).toBe(200);
      return (await res.json()) as StockRes;
    };
    const g = (code: string, grams: string) => ({
      metal_code: code,
      name_th: { gold: "ทอง", nak: "นาก", silver: "เงิน", platinum: "แพลตตินั่ม" }[code] ?? "",
      grams,
    });
    /** กรัมต่อโลหะของสาขาเดียว เรียง ทอง · นาก · เงิน · แพลตตินั่ม */
    const gramsOf = (r: StockRes, code: string) =>
      r.by_branch.find((b) => b.branch.code === code)?.by_metal.map((m) => m.grams);

    it("ต้อง login · staff = 403 · manager ที่ไม่มีสาขา = 403 (fail-closed)", async () => {
      expect((await t.request("/api/reports/stock")).status).toBe(401);
      expect((await get("/stock", "staff0")).status).toBe(403);
      expect((await get("/stock?format=csv", "staff0")).status).toBe(403);
      expect((await get("/stock", "nobranch")).status).toBe(403);
      for (const who of ["mgr0", "acct", "admin"]) expect((await get("/stock", who)).status).toBe(200);
    });

    it("รูปคำตอบ: ณ วันนี้ (ค่าเริ่มต้น) · ทุกโลหะต่อสาขา + รวม · ยอดยกมานับด้วย", async () => {
      const res = await get("/stock", "mgr1");
      expect(res.headers.get("cache-control")).toBe("no-store");
      const byMetal = [g("gold", "0.500"), g("nak", "3.250"), g("silver", "0.000"), g("platinum", "2.000")];
      expect(await res.json()).toEqual({
        as_of: "2026-10-05",
        by_branch: [{ branch: ref("00001"), by_metal: byMetal }],
        total: { by_metal: byMetal },
      });
    });

    it("ต่อสาขา = Σ ความเคลื่อนไหวใน DB · รวม = Σ ต่อสาขา · ยกเลิกบิลหักด้วยแถวติดลบ", async () => {
      const r = await stock("");
      expect(r.by_branch.map((b) => [b.branch.code, b.by_metal.map((m) => m.grams)])).toEqual([
        ["00000", ["16.860", "0.000", "100.000", "4.990"]],
        ["00001", ["0.500", "3.250", "0.000", "2.000"]],
        ["00002", ["7.777", "0.000", "18169.697", "0.000"]],
      ]);
      expect(r.total.by_metal).toEqual([
        g("gold", "25.137"),
        g("nak", "3.250"),
        g("silver", "18269.697"),
        g("platinum", "6.990"),
      ]);
      const db = await t.db
        .select({
          branchId: stockMovement.branchId,
          metalId: stockMovement.metalId,
          grams: sql<string>`sum(${stockMovement.grams})::text`,
        })
        .from(stockMovement)
        .where(lte(stockMovement.date, "2026-10-05"))
        .groupBy(stockMovement.branchId, stockMovement.metalId);
      for (const b of r.by_branch) {
        for (const m of b.by_metal) {
          const row = db.find((x) => x.branchId === b.branch.id && x.metalId === metals[m.metal_code]);
          expect(m.grams).toBe(fmtWeight(D(row?.grams ?? "0")));
        }
      }
      r.total.by_metal.forEach((m, i) => {
        expect(fmtWeight(sumOf(r.by_branch.map((b) => b.by_metal[i]?.grams ?? "0")))).toBe(m.grams);
      });
    });

    it("ณ วันที่: รวมความเคลื่อนไหวของวันนั้น · หลังวันนั้นไม่นับ · บิลยกเลิกหักกันหมด (แถวติดลบวันที่เดียวกับบิล)", async () => {
      // บิลเงิน 50.500 ของ 00000 (3 ต.ค.) ถูกยกเลิก: +50.500 และ −50.500 ลงวันที่ 3 ต.ค. ทั้งคู่
      const moves = await t.db
        .select()
        .from(stockMovement)
        .where(eq(stockMovement.sourceReceiptId, bills.b3 ?? ""));
      expect(moves.map((m) => [m.date, m.grams]).sort()).toEqual([
        ["2026-10-03", "-50.500"],
        ["2026-10-03", "50.500"],
      ]);
      const oct2 = await stock("as_of=2026-10-02");
      const oct3 = await stock("as_of=2026-10-03");
      // ทอง 00000 = 30 ก.ย. 1.000 + 1 ต.ค. 5.860 + 2 ต.ค. 10.000
      expect(gramsOf(oct2, "00000")).toEqual(["16.860", "0.000", "100.000", "4.990"]);
      expect(gramsOf(oct3, "00000")).toEqual(["16.860", "0.000", "100.000", "4.990"]);
      expect(gramsOf(oct3, "00001")).toEqual(["0.000", "3.250", "0.000", "0.000"]);
      expect(gramsOf(oct3, "00002")).toEqual(["0.000", "0.000", "18169.697", "0.000"]);
      // 4 ต.ค. รวมบิลของวันนั้น (as_of รวมวันท้าย) · 00001 ยังไม่มีบิลวันที่ 5
      const oct4 = await stock("as_of=2026-10-04");
      expect(gramsOf(oct4, "00002")).toEqual(["7.777", "0.000", "18169.697", "0.000"]);
      expect(gramsOf(oct4, "00001")).toEqual(["0.000", "3.250", "0.000", "0.000"]);
      // 30 ก.ย. รวมบิลวันที่ 30 · 29 ก.ย. ไม่รวม · ก่อนยอดยกมา = 0 ทั้งหมด
      expect(gramsOf(await stock("as_of=2026-09-30"), "00000")).toEqual(["1.000", "0.000", "0.000", "4.990"]);
      expect(gramsOf(await stock("as_of=2026-09-29"), "00000")).toEqual(["0.000", "0.000", "0.000", "4.990"]);
      const before = await stock("as_of=2026-09-14");
      expect(before.as_of).toBe("2026-09-14");
      for (const m of before.total.by_metal) expect(m.grams).toBe("0.000");
    });

    it("scoping: manager เห็นเฉพาะสาขาตัวเอง · branch_id ของสาขาอื่น = ว่าง ไม่ใช่ทุกสาขา", async () => {
      expect((await stock("", "mgr0")).by_branch.map((b) => b.branch.code)).toEqual(["00000"]);
      for (const qs of [`branch_id=${t.branches["00000"]}`, "branch_id=not-a-uuid", `branch_id=${NO_BRANCH}`]) {
        const other = await stock(qs, "mgr1");
        expect(other.by_branch).toEqual([]);
        for (const m of other.total.by_metal) expect(m.grams).toBe("0.000");
      }
      const one = await stock(`branch_id=${t.branches["00002"]}`);
      expect(one.by_branch.map((b) => b.branch.code)).toEqual(["00002"]);
      expect(one.total.by_metal.map((m) => m.grams)).toEqual(["7.777", "0.000", "18169.697", "0.000"]);
      // ยอดของสาขาอื่นไม่ปนมากับรวม
      const sums = await t.db
        .select({ grams: sql<string>`sum(${stockMovement.grams})::text` })
        .from(stockMovement)
        .where(inArray(stockMovement.branchId, [t.branches["00001"] ?? ""]));
      const own = await stock("", "mgr1");
      expect(fmtWeight(sumOf(own.total.by_metal.map((m) => m.grams)))).toBe(fmtWeight(D(sums[0]?.grams ?? "0")));
    });

    it("สาขาที่ปิดแล้ว: manager ของสาขานั้น = 403 · accounting ยังเห็นสต็อกของสาขานั้น (forUserHistory)", async () => {
      await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
      try {
        expect((await get("/stock", "mgr2")).status).toBe(403);
        const r = await stock("");
        expect(r.by_branch.map((b) => b.branch.code)).toEqual(["00000", "00001", "00002"]);
        expect(r.total.by_metal.map((m) => m.grams)).toEqual(["25.137", "3.250", "18269.697", "6.990"]);
        const own = await stock("", "acct2");
        expect(own.by_branch.map((b) => b.branch.code)).toEqual(["00002"]);
        expect(own.total.by_metal.map((m) => m.grams)).toEqual(["7.777", "0.000", "18169.697", "0.000"]);
      } finally {
        await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
      }
    });

    it.each([
      ["as_of=2026-02-30", "as_of"],
      ["as_of=1999-12-31", "as_of"],
      ["as_of=05/10/2569", "as_of"],
      ["format=pdf", "format"],
    ])("query ผิด %s → 400 ชี้ %s", async (qs, field) => {
      const res = await get(`/stock?${qs}`, "acct");
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field });
    });

    it("CSV: UTF-8 + BOM · แถวละโลหะ · คอลัมน์ละสาขา + รวมทั้งสิ้น · ตัวเลขชุดเดียวกับ JSON", async () => {
      const res = await get("/stock?format=csv", "acct");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe('attachment; filename="stock_2026-10-05.csv"');
      expect(res.headers.get("cache-control")).toBe("no-store");
      const { bytes, text } = await csvOf(res);
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(text.slice(1).split("\r\n")).toEqual([
        `ชื่อสินค้า,คงเหลือ 00000 ${HQ} (กรัม),คงเหลือ 00001 สาขา 2 (กรัม),คงเหลือ 00002 สาขา 3 (กรัม),รวมทั้งสิ้น (กรัม)`,
        "ทอง,16.860,0.500,7.777,25.137",
        "นาก,0.000,3.250,0.000,3.250",
        "เงิน,100.000,0.000,18169.697,18269.697",
        "แพลตตินั่ม,4.990,2.000,0.000,6.990",
        "",
      ]);

      const one = await get(`/stock?format=csv&as_of=2026-10-03&branch_id=${t.branches["00001"]}`, "mgr1");
      expect(one.headers.get("content-disposition")).toBe('attachment; filename="stock_2026-10-03_00001.csv"');
      expect((await csvOf(one)).text.slice(1).split("\r\n")).toEqual([
        "ชื่อสินค้า,คงเหลือ 00001 สาขา 2 (กรัม),รวมทั้งสิ้น (กรัม)",
        "ทอง,0.000,0.000",
        "นาก,3.250,3.250",
        "เงิน,0.000,0.000",
        "แพลตตินั่ม,0.000,0.000",
        "",
      ]);
    });
  });
});

/**
 * รายการตามใบรับซื้อ (UAT 30 ก.ย. 2569) — rows[].items = groupLinesByMetal ตัวเดียวกับ PDF:
 * หนึ่งรายการต่อ (โลหะ · ค่าบริสุทธิ์ · หัก %) เรียงตามที่ปรากฏครั้งแรกในบิล · ป้าย "ทอง 96.5% หัก 3%" (หัก 0 ไม่พิมพ์)
 * แถวเก่า (purity null) = ชื่อโลหะ · database แยกของตัวเอง — ตัวเลขของชุดบนไม่เปลี่ยน
 */
describe.skipIf(!available)("รายงานยอดซื้อ — รายการตามใบรับซื้อ (ค่าบริสุทธิ์ · หัก %)", () => {
  let t: TestApp;
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  const bills: Record<string, string> = {};
  let metals: Record<string, string> = {};
  let keySeq = 0;
  // ลูกค้าสมมติ — เลขบัตรจากตัวช่วย synthetic (หลัก 2–3 = 99 ไม่ชนเลขของคนจริง) · ชื่อขึ้นต้น "ทดสอบ"
  const IDS = { A: syntheticNationalId(9101), B: syntheticNationalId(9102), C: syntheticNationalId(9103) };
  const NAMES = { A: testName("ผู้ขาย ก"), B: testName("ผู้ขาย ข"), C: testName("ผู้ขาย ค") };
  /** รูปมาสก์ของ R13: หลักแรก + 3 หลักท้าย */
  const masked = (id: string) => `${id.slice(0, 1)} XXXX XXXXX ${id.slice(10, 12)} ${id.slice(12)}`;

  // ราคาคิดมือตามสูตร assessBuyLine ในสัญญา API — ทองแท่งรับซื้อ 67,650 · เงิน 45.00/ก. · แพลตตินั่ม 900.00/ก.
  // ราคา/กรัม = ⌊ฐาน (× 0.0656 ถ้าทอง/นาก) × บริสุทธิ์ ÷ 100⌋ · ยอด = ⌊ราคา/กรัม × กรัม⌋ · สุทธิ = ⌊ยอด × (100 − หัก) ÷ 100⌋
  /** ทอง 96.5%: ⌊67650 × 0.0656 × 0.965⌋ = ⌊4282.5156⌋ */
  const G965 = { base: "67650.00", purity: "96.500", unit: "4282.00" };
  /** เงิน 92.5%: ⌊45 × 0.925⌋ = ⌊41.625⌋ */
  const S925 = { base: "45.00", purity: "92.500", unit: "41.00" };

  const addBill = (s: BillSpec) =>
    insertBill({ t, metals, userIds, nationalIds: IDS }, s, `purity-fixture-${String(++keySeq).padStart(6, "0")}`);
  const get = async (path: string, who: string) => t.request(`/api/reports${path}`, { cookie: cookies[who] });
  const purchase = async (qs: string, who = "acct") => {
    const res = await get(`/purchase${qs ? `?${qs}` : ""}`, who);
    expect(res.status).toBe(200);
    return (await res.json()) as PurchaseRes;
  };
  const labels = (r: PurchaseRes) => r.rows.map((x) => [x.id, x.items.map((i) => i.label)]);

  beforeAll(async () => {
    t = await startTestApp({ now: () => NOW });
    const accounts = [
      { who: "staff0", branch: "00000" },
      { who: "staff1", branch: "00001" },
      { who: "mgr0", role: "manager" as const, branch: "00000" },
      { who: "mgr1", role: "manager" as const, branch: "00001" },
      { who: "acct", role: "accounting" as const, branch: "00000", viewAll: true },
    ];
    for (const a of accounts) {
      const created = await t.createUser({ email: `${a.who}@ong.test`, password: PW, ...a });
      userIds[a.who] = created.id;
      cookies[a.who] = await t.login(`${a.who}@ong.test`, PW);
    }
    metals = Object.fromEntries((await t.db.select().from(metal)).map((m) => [m.code, m.id]));
    await t.db
      .insert(customer)
      .values(
        (["A", "B", "C"] as const).map((k) => ({ nationalId: IDS[k], nameTh: NAMES[k], cardExpireText: "31/12/2574" })),
      );

    // 00000 — บรรทัด 1 + 3 = ทอง 96.5% หัก 3 (รวมเป็นรายการเดียว) · เงินบรรทัด 2 มาก่อนทอง 96.5% ไม่หัก (บรรทัด 4)
    bills.p1 = await addBill({
      code: "00000",
      date: "2026-10-01",
      docNo: "RC6910-0001",
      cust: "A",
      lines: [
        ["gold", "10.000", "41535.00", { ...G965, deduct: "3.00", gross: "42820.00" }], // anchor ของสัญญา
        ["silver", "271.560", "11133.00", { ...S925, deduct: "0.00", gross: "11133.00" }],
        ["gold", "5.000", "20767.00", { ...G965, deduct: "3.00", gross: "21410.00" }],
        ["gold", "2.345", "10041.00", { ...G965, deduct: "0.00", gross: "10041.00" }],
        // ⌊4437.84 × 0.90⌋ = 3994 · ⌊3994 × 3.21⌋ = 12820 · ⌊12820 × 0.95⌋ = 12179
        [
          "gold",
          "3.210",
          "12179.00",
          { base: "67650.00", purity: "90.000", unit: "3994.00", deduct: "5.00", gross: "12820.00" },
        ],
      ],
      by: "staff0",
    });
    // 00000 — แถวเก่า (ไม่มีค่าบริสุทธิ์) ปนกับแถวใหม่ในบิลเดียว · ตัดศูนย์ท้าย 100.000 · หัก 10.00 · 99.990
    bills.p2 = await addBill({
      code: "00000",
      date: "2026-10-02",
      docNo: "RC6910-0002",
      cust: "B",
      lines: [
        ["gold", "1.000", "3000.00"],
        ["gold", "4.000", "16614.00", { ...G965, deduct: "3.00", gross: "17128.00" }],
        ["gold", "0.500", "1500.25"],
        [
          "gold",
          "2.000",
          "7986.00",
          { base: "67650.00", purity: "100.000", unit: "4437.00", deduct: "10.00", gross: "8874.00" },
        ],
        [
          "gold",
          "1.000",
          "4437.00",
          { base: "67650.00", purity: "99.990", unit: "4437.00", deduct: "0.00", gross: "4437.00" },
        ],
      ],
      by: "staff0",
    });
    // 00001 — เงิน 92.5% หัก 2 · แพลตตินั่ม 95% (⌊900 × 0.95⌋ = 855 · ⌊855 × 1.5⌋ = 1282)
    bills.p3 = await addBill({
      code: "00001",
      date: "2026-10-03",
      docNo: "RC6910-0001",
      cust: "C",
      lines: [
        ["silver", "100.000", "4018.00", { ...S925, deduct: "2.00", gross: "4100.00" }],
        [
          "platinum",
          "1.500",
          "1282.00",
          { base: "900.00", purity: "95.000", unit: "855.00", deduct: "0.00", gross: "1282.00" },
        ],
      ],
      by: "staff1",
    });
    // 00000 — ยกเลิกแล้ว: นาก 75% หัก 1 ต้องไม่โผล่ที่ไหนเลย (⌊4437.84 × 0.75⌋ = 3328 · ⌊3328 × 0.99⌋ = 3294)
    bills.p4 = await addBill({
      code: "00000",
      date: "2026-10-04",
      docNo: "RC6910-0003",
      cust: "A",
      lines: [
        [
          "nak",
          "1.000",
          "3294.00",
          { base: "67650.00", purity: "75.000", unit: "3328.00", deduct: "1.00", gross: "3328.00" },
        ],
      ],
      by: "staff0",
      voided: true,
    });
  });
  afterAll(async () => {
    await t?.close();
  });

  it("items: หนึ่งรายการต่อ (โลหะ · บริสุทธิ์ · หัก %) · ชิ้นที่ % เดียวกันรวมกัน · เรียงตามที่ปรากฏครั้งแรก · Σ = ยอดบิล", async () => {
    const res = await get("/purchase", "acct");
    expect(res.status).toBe(200);
    const body = (await res.json()) as PurchaseRes;
    expectMoneyAsStrings(body, "GET /reports/purchase (ค่าบริสุทธิ์)");
    expect(body.rows.map((x) => [x.id, x.items])).toEqual([
      [
        bills.p1,
        [
          // บรรทัด 1 + 3: 10.000 + 5.000 ก. · 41,535 + 20,767 บาท
          item("ทอง 96.5% หัก 3%", "15.000", "62302.00"),
          // เรียงตามที่ปรากฏ ไม่ใช่จัดกลุ่มตามโลหะ — เงิน (บรรทัด 2) มาก่อนทอง 96.5% ไม่หัก (บรรทัด 4)
          item("เงิน 92.5%", "271.560", "11133.00"),
          // หัก 0 = ไม่พิมพ์ "หัก" และเป็นคนละรายการกับหัก 3
          item("ทอง 96.5%", "2.345", "10041.00"),
          item("ทอง 90% หัก 5%", "3.210", "12179.00"),
        ],
      ],
      [
        bills.p2,
        [
          // แถวเก่าบรรทัด 1 + 3 = ชื่อโลหะ รวมกันเอง ไม่ปนกับแถวที่มีค่าบริสุทธิ์
          item("ทอง", "1.500", "4500.25"),
          item("ทอง 96.5% หัก 3%", "4.000", "16614.00"),
          // ตัดศูนย์ท้าย: 100.000 → 100 · หัก 10.00 → 10 (ไม่ใช่ 1) · 99.990 → 99.99
          item("ทอง 100% หัก 10%", "2.000", "7986.00"),
          item("ทอง 99.99%", "1.000", "4437.00"),
        ],
      ],
      [bills.p3, [item("เงิน 92.5% หัก 2%", "100.000", "4018.00"), item("แพลตตินั่ม 95%", "1.500", "1282.00")]],
    ]);
    expect(body.rows.map((x) => [x.doc_no, x.branch.code, x.total_weight, x.total_amount])).toEqual([
      ["RC6910-0001", "00000", "292.115", "95655.00"],
      ["RC6910-0002", "00000", "8.500", "33537.25"],
      ["RC6910-0001", "00001", "101.500", "5300.00"],
    ]);
    // metals ยังรวมต่อโลหะเหมือนเดิม (items เป็นอีกมุมมองของแถวชุดเดียวกัน)
    expect(body.rows[0]?.metals).toEqual([gram("gold", "20.555", "84522.00"), gram("silver", "271.560", "11133.00")]);
    expectItemsAddUp(body.rows);
    expect(body.total).toEqual({
      count: "3",
      total_weight: "402.115",
      total_amount: "134492.25",
      by_metal: [
        gram("gold", "29.055", "118059.25"),
        gram("nak", "0.000", "0.00"),
        gram("silver", "371.560", "15151.00"),
        gram("platinum", "1.500", "1282.00"),
      ],
    });
    // บิลยกเลิก (นาก 75% หัก 1%) ไม่อยู่ในรายงาน · เลขบัตรเต็มไม่หลุด
    const text = JSON.stringify(body);
    expect(text).not.toContain("นาก 75%");
    expect(text).not.toMatch(/\d{13}/);
  });

  it("กรองโลหะ: items เหลือเฉพาะรายการของโลหะนั้น — รายการอื่นของบิลเดียวกันไม่ติดมา · ลำดับเดิม", async () => {
    const silver = await purchase("metal=silver");
    expect(silver.rows.map((x) => [x.id, x.items, x.total_weight, x.total_amount])).toEqual([
      [bills.p1, [item("เงิน 92.5%", "271.560", "11133.00")], "271.560", "11133.00"],
      [bills.p3, [item("เงิน 92.5% หัก 2%", "100.000", "4018.00")], "100.000", "4018.00"],
    ]);
    expect(silver.total).toMatchObject({ count: "2", total_weight: "371.560", total_amount: "15151.00" });

    const gold = await purchase("metal=gold");
    expect(labels(gold)).toEqual([
      [bills.p1, ["ทอง 96.5% หัก 3%", "ทอง 96.5%", "ทอง 90% หัก 5%"]],
      [bills.p2, ["ทอง", "ทอง 96.5% หัก 3%", "ทอง 100% หัก 10%", "ทอง 99.99%"]],
    ]);
    expect(gold.rows[0]?.items[0]).toEqual(item("ทอง 96.5% หัก 3%", "15.000", "62302.00"));
    expect(gold.rows.map((x) => [x.total_weight, x.total_amount])).toEqual([
      ["20.555", "84522.00"],
      ["8.500", "33537.25"],
    ]);
    expectItemsAddUp(gold.rows);

    expect((await purchase("metal=platinum")).rows.map((x) => [x.id, x.items])).toEqual([
      [bills.p3, [item("แพลตตินั่ม 95%", "1.500", "1282.00")]],
    ]);
    // นากมีแค่ในบิลที่ยกเลิก → ไม่มีแถว
    expect((await purchase("metal=nak")).rows).toEqual([]);

    // CSV ที่กรองแล้ว: ช่องเดียวไม่มี , จึงไม่ใส่ "…"
    const csv = (await csvOf(await get("/purchase?format=csv&metal=silver", "acct"))).text.slice(1).split("\r\n");
    expect(csv.slice(1, 3)).toEqual([
      `1,2026-10-01,10:00,RC6910-0001,00000 ${HQ},${NAMES.A},${masked(IDS.A)},เงิน 92.5%,271.560,11133.00,staff0`,
      `2,2026-10-03,10:00,RC6910-0001,00001 สาขา 2,${NAMES.C},${masked(IDS.C)},เงิน 92.5% หัก 2%,100.000,4018.00,staff1`,
    ]);
  });

  it('CSV: รายการสินค้า = ป้ายตามใบรับซื้อคั่นด้วย ", " (ช่องมี , จึงอยู่ใน "…") · แถวสรุปยังเป็นต่อโลหะ', async () => {
    const res = await get("/purchase?format=csv", "acct");
    expect(res.status).toBe(200);
    const lines = (await csvOf(res)).text.slice(1).split("\r\n");
    expect(lines.slice(0, 4)).toEqual([
      PURCHASE_CSV_HEADER.join(","),
      `1,2026-10-01,10:00,RC6910-0001,00000 ${HQ},${NAMES.A},${masked(IDS.A)},"ทอง 96.5% หัก 3%, เงิน 92.5%, ทอง 96.5%, ทอง 90% หัก 5%",292.115,95655.00,staff0`,
      `2,2026-10-02,10:00,RC6910-0002,00000 ${HQ},${NAMES.B},${masked(IDS.B)},"ทอง, ทอง 96.5% หัก 3%, ทอง 100% หัก 10%, ทอง 99.99%",8.500,33537.25,staff0`,
      `3,2026-10-03,10:00,RC6910-0001,00001 สาขา 2,${NAMES.C},${masked(IDS.C)},"เงิน 92.5% หัก 2%, แพลตตินั่ม 95%",101.500,5300.00,staff1`,
    ]);
    // 3 บิล + 3 สาขา × (4 โลหะ + ทุกประเภท) + รวมทั้งสิ้น (4 โลหะ + ทุกประเภท)
    expect(lines).toHaveLength(1 + 3 + 3 * 5 + 5 + 1);
    expect(lines.slice(-6, -1)).toEqual([
      "รวมทั้งสิ้น,,,,ทุกสาขา,,,ทอง,29.055,118059.25,",
      "รวมทั้งสิ้น,,,,ทุกสาขา,,,นาก,0.000,0.00,",
      "รวมทั้งสิ้น,,,,ทุกสาขา,,,เงิน,371.560,15151.00,",
      "รวมทั้งสิ้น,,,,ทุกสาขา,,,แพลตตินั่ม,1.500,1282.00,",
      "รวมทั้งสิ้น,,,,ทุกสาขา,,,ทุกประเภท (3 ใบ),402.115,134492.25,",
    ]);
    expect(lines.join("\n")).not.toContain("นาก 75%");
  });

  it("scoping: manager เห็นรายการของสาขาตัวเองเท่านั้น · branch_id สาขาอื่น = ว่าง — ป้ายของสาขาอื่นไม่หลุดทั้ง JSON และ CSV", async () => {
    const hqLabels = ["ทอง 96.5% หัก 3%", "ทอง 96.5%", "ทอง 90% หัก 5%", "ทอง 100% หัก 10%", "ทอง 99.99%"];

    const own1 = await purchase("", "mgr1");
    expect(own1.rows.map((x) => [x.id, x.items])).toEqual([
      [bills.p3, [item("เงิน 92.5% หัก 2%", "100.000", "4018.00"), item("แพลตตินั่ม 95%", "1.500", "1282.00")]],
    ]);
    const text1 = JSON.stringify(own1);
    for (const l of hqLabels) expect(text1).not.toContain(l);
    expect(text1).not.toContain('"label":"เงิน 92.5%"'); // ของ 00000 (ไม่หัก) — ไม่ใช่ "เงิน 92.5% หัก 2%" ของตัวเอง
    const csv1 = (await csvOf(await get("/purchase?format=csv", "mgr1"))).text;
    expect(csv1).toContain(',"เงิน 92.5% หัก 2%, แพลตตินั่ม 95%",101.500,5300.00,staff1\r\n');
    for (const l of ["96.5%", "90%", "100%", "99.99%"]) expect(csv1).not.toContain(l);

    const own0 = await purchase("", "mgr0");
    expect(labels(own0)).toEqual([
      [bills.p1, ["ทอง 96.5% หัก 3%", "เงิน 92.5%", "ทอง 96.5%", "ทอง 90% หัก 5%"]],
      [bills.p2, ["ทอง", "ทอง 96.5% หัก 3%", "ทอง 100% หัก 10%", "ทอง 99.99%"]],
    ]);
    for (const l of ["แพลตตินั่ม 95%", "หัก 2%"]) expect(JSON.stringify(own0)).not.toContain(l);

    // สาขาอื่น / ไม่มีจริง / ผิดรูป = ว่าง ไม่ใช่ทุกสาขา — ทั้ง JSON และ CSV ไม่มีป้ายของ 00000 เลย
    for (const qs of [`branch_id=${t.branches["00000"]}`, `branch_id=${NO_BRANCH}`, "branch_id=not-a-uuid"]) {
      const other = await purchase(qs, "mgr1");
      expect(other.rows).toEqual([]);
      expect(other.total).toMatchObject({ count: "0", total_weight: "0.000", total_amount: "0.00" });
      const csv = (await csvOf(await get(`/purchase?format=csv&${qs}`, "mgr1"))).text;
      expect(csv).not.toContain("%");
    }
  });
});
