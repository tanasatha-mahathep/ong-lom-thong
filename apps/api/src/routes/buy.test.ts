import { randomUUID } from "node:crypto";
import { BUY_MSG, ZERO, fmtMoney, fmtWeight } from "@ong/core";
import {
  auditLog,
  branch,
  buyLine,
  buyReceipt,
  customer,
  docSequence,
  goldPrice,
  metal,
  payment,
  session,
  stockMovement,
  user,
} from "@ong/db";
import { type SQL, and, asc, eq, ne, sql } from "drizzle-orm";
import { format } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BUY_API_MSG } from "../services/buy";
import { expectApiError, expectMoneyAsStrings } from "../test/assertions";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";
import { expectNoNationalId } from "../test/pii";
import { cardFormat, syntheticNationalId, testName } from "../test/synthetic";

const available = await databaseAvailable();
const PW = "correct-horse-battery";

// เลขบัตรสมมติที่ checksum ถูก — ห้ามใช้ข้อมูลลูกค้าจริง (CLAUDE.md กฎ 8)
const ID_A = "1103700123458";
const ID_B = "3100500987657";
const ID_C = "5109900112237";
const ID_D = "3101200456789";

// 10:00 น. วันที่ 5 ต.ค. 2569 เวลาไทย → งวดเลขที่ 6910
const NOW = new Date("2026-10-05T03:00:00Z");
const TODAY = "2026-10-05";
const NO_UUID = "00000000-0000-4000-8000-000000000000";

interface QuoteLine {
  index: number;
  metal_id: string;
  weight_g: string;
  purity_percent: string;
  deduct_percent: string;
  base_price: string;
  unit_price: string;
  gross_amount: string;
  deduct_amount: string;
  amount: string;
  price_per_g: string;
}
interface QuoteRes {
  ok: boolean;
  errors: { field: string; message: string }[];
  date: string;
  branch: { id: string; code: string; name: string };
  gold_price_snapshot: string | null;
  lines: QuoteLine[];
  payments: { index: number; method: string; bank: string | null; amount: string }[];
  total_weight: string;
  total_amount: string;
  avg_price_per_g: string;
  paid: string;
  balance: string;
}
interface SavedRes {
  id: string;
  doc_no: string;
  pdf_status: string;
}
/** แถวของ GET /api/buy/:id — ราคาที่ระบบคิดเป็น null ทั้งชุดสำหรับบิลก่อนมีค่าบริสุทธิ์ */
interface DetailLine {
  line_no: number;
  metal: { id: string; code: string; name_th: string };
  weight_g: string;
  purity_percent: string | null;
  deduct_percent: string | null;
  base_price: string | null;
  unit_price: string | null;
  gross_amount: string | null;
  amount: string;
  price_per_g: string;
}
interface DetailRes {
  id: string;
  doc_no: string;
  date: string;
  time: string;
  branch: { id: string; code: string; name: string; tax_branch_code: string | null };
  customer: { id: string; name_th: string; name_en: string | null; address: string | null; national_id_masked: string };
  gold_price_snapshot: string;
  detail: string | null;
  full_tax: boolean;
  lines: DetailLine[];
  payments: { method: string; method_label: string; bank: string | null; amount: string }[];
  total_weight: string;
  total_amount: string;
  avg_price_per_g: string;
  status: string;
  pdf_status: string;
  idcard_status: string;
  created_by: { id: string; name: string };
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}
interface ListItem {
  id: string;
  doc_no: string;
  date: string;
  time: string;
  branch: { id: string; code: string; name: string };
  customer: { id: string; name_th: string; national_id_masked: string };
  total_weight: string;
  total_amount: string;
  status: string;
  pdf_status: string;
  created_by: { id: string; name: string };
}
interface Totals {
  count: string;
  total_weight: string;
  total_amount: string;
}
interface ListRes {
  items: ListItem[];
  page: number;
  has_more: boolean;
  totals: Totals;
}
const ZERO_TOTALS: Totals = { count: "0", total_weight: "0.000", total_amount: "0.00" };

/**
 * แถวมาตรฐานของ bill(): ทอง 96.5% · 5.860 กรัม · ไม่หัก — ราคาคิดจากทองแท่งรับซื้อของวันบิล (assessBuyLine)
 * คิดมือ: ราคา/กรัม = ⌊ฐาน × 0.0656 × 0.965⌋ · ยอด = ⌊ราคา/กรัม × 5.86⌋
 *   67,650 (กลางวันนี้)   → ⌊4282.5156⌋ = 4282 × 5.86 = 25092.52 → 25,092 · 25092 ÷ 5.86 = 4281.911… → 4,281.91
 *   67,800 (สาขา 00001)  → ⌊4292.0112⌋ = 4292 × 5.86 = 25151.12 → 25,151
 *   66,800 (30 ก.ย.)     → ⌊4228.7072⌋ = 4228 × 5.86 = 24776.08 → 24,776
 *   66,300 (28 ก.ย.)     → ⌊4197.0552⌋ = 4197 × 5.86 = 24594.42 → 24,594
 */
const PAY = { today: "25092", branch1: "25151", sep30: "24776", sep28: "24594" } as const;
const cash = (amount: string) => [{ method: "cash", amount }];
/** บิลย้อนหลัง 30 ก.ย. หนึ่งใบ (ราคาของวันนั้น) */
const SEP30_BILL: Totals = { count: "1", total_weight: "5.860", total_amount: "24776.00" };
/** บิลของสาขา 00001 หนึ่งใบ (ราคาเฉพาะสาขา) */
const BRANCH1_BILL: Totals = { count: "1", total_weight: "5.860", total_amount: "25151.00" };

describe.skipIf(!available)("ซื้อเข้าหน้าร้าน (R1–R5 · R7 · R9 · R11 · R13 · R15) — /api/buy", () => {
  let t: TestApp;
  let clock = NOW;
  const cookies: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  let metals: Record<string, string> = {};
  let custA = "";
  let custB = "";
  let custC = "";
  let custD = "";
  let keySeq = 0;

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock });
    const accounts = [
      { who: "staff", branch: "00000" },
      { who: "staff1", branch: "00001" },
      { who: "staff2", branch: "00002" },
      { who: "acct", branch: "00000", role: "accounting" as const },
      { who: "mgr", branch: "00000", role: "manager" as const }, // บิลย้อนหลังได้เฉพาะผู้จัดการขึ้นไป
      { who: "boss", role: "admin" as const, viewAll: true }, // เห็นทุกสาขา แต่ยังไม่ได้เลือกสาขาที่ทำงาน
      { who: "mgrall", role: "manager" as const, viewAll: true }, // เห็นทุกสาขาที่เปิดอยู่ (ไม่ใช่ role อ่านย้อนหลัง)
      { who: "acct2", branch: "00002", role: "accounting" as const },
      { who: "mgr2", branch: "00002", role: "manager" as const },
      { who: "nobranch" },
    ];
    for (const a of accounts) {
      const created = await t.createUser({ email: `${a.who}@ong.test`, password: PW, ...a });
      userIds[a.who] = created.id;
      cookies[a.who] = await t.login(`${a.who}@ong.test`, PW);
    }
    metals = Object.fromEntries((await t.db.select().from(metal)).map((m) => [m.code, m.id]));
    // seed ตั้งรหัสสาขาสรรพากรให้เฉพาะสำนักงานใหญ่ — สาขาอื่นต้องมีรหัสก่อนขายได้ (ดูเทสต์รหัสสาขาข้างล่าง)
    for (const code of ["00001", "00002"]) {
      await t.db.update(branch).set({ taxBranchCode: code }).where(eq(branch.code, code));
    }

    // ราคากลางของวันนี้และของวันย้อนหลัง · สาขา 00001 มีราคาของตัวเองวันนี้ · 3 ต.ค. ไม่มีราคา
    // เงินรับซื้อ 45 บาท/กรัม เฉพาะวันนี้ (ราคากลาง ทุกสาขาใช้ร่วม) · แพลตตินั่มไม่ได้ตั้ง
    await t.db.insert(goldPrice).values([
      { date: TODAY, barSell: "67850", barBuy: "67650", jewelryBuy: "64268", silverPerG: "45.00" },
      { date: "2026-09-30", barSell: "67000", barBuy: "66800", jewelryBuy: "63460" },
      { date: "2026-09-28", barSell: "66500", barBuy: "66300", jewelryBuy: "62985" }, // ย้อนหลัง 7 วันพอดี
      { branchId: t.branches["00001"], date: TODAY, barSell: "68000", barBuy: "67800", jewelryBuy: "64410" },
    ]);

    const [a, b, c] = await t.db
      .insert(customer)
      .values([
        {
          nationalId: ID_A,
          nameTh: "นายทดสอบ ซื้อทอง",
          nameEn: "Mr. Test Buyer",
          birthdayText: "01/01/2530",
          religion: "พุทธ",
          address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
          cardIssueText: "01/01/2565",
          cardExpireText: "31/12/2574",
          mobile: "0812345678",
          photoKey: "photos/a/card.png",
        },
        // บัตรหมดอายุ 1 ต.ค. 2569 — วันนี้ใช้ไม่ได้ แต่บิลย้อนหลังวันที่ 30 ก.ย. ใช้ได้
        { nationalId: ID_B, nameTh: "นางสาวบัตร หมดอายุ", cardExpireText: "01/10/2569" },
        { nationalId: ID_C, nameTh: "นายไม่มี วันหมดอายุ" },
      ])
      .returning({ id: customer.id });
    custA = a?.id ?? "";
    custB = b?.id ?? "";
    custC = c?.id ?? "";
  });
  afterAll(async () => {
    await t?.close();
  });

  /** แถวที่พนักงานกรอก: โลหะ · น้ำหนัก · ค่าบริสุทธิ์ · หัก % (ไม่ส่ง = 0) — ราคาคิดที่เซิร์ฟเวอร์ */
  const line = (code: string, weight_g: string, purity_percent: string, deduct_percent?: string) => ({
    metal_id: metals[code],
    weight_g,
    purity_percent,
    ...(deduct_percent === undefined ? {} : { deduct_percent }),
  });
  const bill = (over: Record<string, unknown> = {}) => ({
    customer_id: custA,
    lines: [line("gold", "5.860", "96.5")],
    payments: cash(PAY.today),
    ...over,
  });
  /** bill() ที่ชำระตามราคาเฉพาะสาขา 00001 (ทองแท่งรับซื้อ 67,800) */
  const bill1 = (over: Record<string, unknown> = {}) => bill({ payments: cash(PAY.branch1), ...over });
  /** เหตุผลของบิลย้อนหลัง (บังคับ · ลง audit) */
  const REASON = { backdate_reason: "ระบบล่ม คีย์ใบเขียนมือ" };
  const newKey = () => `test-key-${String(++keySeq).padStart(8, "0")}`;
  // async = คืน Promise เสมอ (app.request อาจคืน Response ตรง ๆ) — ใช้กับ Promise.all ได้
  const quote = async (body: unknown, who = "staff") => t.request("/api/buy/quote", { cookie: cookies[who], body });
  const save = async (body: Record<string, unknown>, who = "staff") =>
    t.request("/api/buy", { cookie: cookies[who], body: { idempotency_key: newKey(), ...body } });
  const saveWithKey = async (key: string, who = "staff") =>
    t.request("/api/buy", { cookie: cookies[who], body: { ...bill(), idempotency_key: key } });
  const get = async (path: string, who = "staff") => t.request(`/api/buy${path}`, { cookie: cookies[who] });
  const list = async (qs = "", who = "staff") => {
    const res = await get(qs ? `?${qs}` : "", who);
    expect(res.status).toBe(200);
    return (await res.json()) as ListRes;
  };
  /** ยอดที่ควรได้ คิดจากแถวใน DB ด้วย decimal.js — เฉพาะบิลที่ยังไม่ยกเลิก */
  const expectedTotals = async (where?: SQL): Promise<Totals> => {
    const rows = await t.db
      .select({ weight: buyReceipt.totalWeight, amount: buyReceipt.totalAmount })
      .from(buyReceipt)
      .where(and(where, eq(buyReceipt.status, "active")));
    return {
      count: String(rows.length),
      total_weight: fmtWeight(rows.reduce((sum, r) => sum.plus(r.weight), ZERO)),
      total_amount: fmtMoney(rows.reduce((sum, r) => sum.plus(r.amount), ZERO)),
    };
  };
  const receiptCount = async () => (await t.db.select({ id: buyReceipt.id }).from(buyReceipt)).length;
  /** เลขที่ของสาขาในงวด เรียงจากน้อยไปมาก */
  const docNos = async (code: string, period: string) =>
    (
      await t.db
        .select({ docNo: buyReceipt.docNo })
        .from(buyReceipt)
        .where(eq(buyReceipt.branchId, t.branches[code] ?? ""))
        .orderBy(asc(buyReceipt.docNo))
    )
      .map((r) => r.docNo)
      .filter((d) => d.startsWith(`RC${period}-`));
  const running = (period: string, from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `RC${period}-${String(from + i).padStart(4, "0")}`);

  // ---------- สิทธิ์ ----------

  it("ต้อง login ทุก endpoint", async () => {
    expect((await t.request("/api/buy")).status).toBe(401);
    expect((await t.request(`/api/buy/${NO_UUID}`)).status).toBe(401);
    expect((await t.request("/api/buy/quote", { body: bill() })).status).toBe(401);
    expect((await t.request("/api/buy", { body: { ...bill(), idempotency_key: newKey() } })).status).toBe(401);
  });

  it("ไม่มีสิทธิ์สาขาใดเลย = 403 ทั้งอ่านและเขียน (fail-closed)", async () => {
    expect((await get("", "nobranch")).status).toBe(403);
    expect((await get(`/${NO_UUID}`, "nobranch")).status).toBe(403);
    expect((await quote(bill(), "nobranch")).status).toBe(403);
    expect((await save(bill(), "nobranch")).status).toBe(403);
  });

  it("accounting อ่านได้ แต่เปิดบิลไม่ได้ (403)", async () => {
    expect((await save(bill(), "acct")).status).toBe(403);
    expect((await get("", "acct")).status).toBe(200);
    expect(await receiptCount()).toBe(0);
  });

  it("ยังไม่ได้เลือกสาขาที่ทำงาน = 403 ชี้ branch (เห็นทุกสาขาก็เปิดบิลลอย ๆ ไม่ได้)", async () => {
    for (const res of [await quote(bill(), "boss"), await save(bill(), "boss")]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "ยังไม่ได้เลือกสาขาที่ทำงาน", field: "branch" });
    }
  });

  it("CSRF: origin อื่นเปิดบิล/quote ไม่ได้", async () => {
    const evil = { cookie: cookies.staff, origin: "https://evil.test" };
    expect((await t.request("/api/buy", { ...evil, body: { ...bill(), idempotency_key: newKey() } })).status).toBe(403);
    expect((await t.request("/api/buy/quote", { ...evil, body: bill() })).status).toBe(403);
    expect(await receiptCount()).toBe(0);
  });

  // ---------- รูปแบบ payload ----------

  it.each([
    [{ lines: [{ metal_id: "x", weight_g: 5.86, purity_percent: "96.5" }] }, "lines.0.weight_g"],
    [{ lines: [{ metal_id: "x", weight_g: "5.86", purity_percent: 96.5 }] }, "lines.0.purity_percent"],
    [
      { lines: [{ metal_id: "x", weight_g: "5.86", purity_percent: "96.5", deduct_percent: 3 }] },
      "lines.0.deduct_percent",
    ],
    [
      { lines: [{ metal_id: "x", weight_g: "5.86", purity_percent: "96.5", deduct_percent: 0 }] },
      "lines.0.deduct_percent",
    ],
    [{ lines: [{ metal_id: "x", weight_g: "5.86", purity_percent: true }] }, "lines.0.purity_percent"],
    [{ lines: [{ metal_id: "x", weight_g: "5.86", purity_percent: "9".repeat(33) }] }, "lines.0.purity_percent"],
    [{ payments: [{ method: "cash", amount: 25092 }] }, "payments.0.amount"],
    [{ lines: "gold" }, "lines"],
    [{ payments: undefined }, "payments"],
    [{ date: "2026-02-30" }, "date"],
    [{ date: "0000-01-01" }, "date"], // เคยเป็น 500 (Postgres ไม่มีปี 0)
    [{ date: "1999-12-31" }, "date"],
    [{ customer_id: "not-a-uuid" }, "customer_id"],
    [{ lines: Array.from({ length: 51 }, () => ({ metal_id: "x", weight_g: "1", purity_percent: "96.5" })) }, "lines"],
  ])("payload ผิดรูป %j → 400 ชี้ %s (ตัวเลข JSON ถูกปฏิเสธ — ต้องเป็น string)", async (over, field) => {
    const body = bill(over);
    for (const res of [await quote(body), await save(body)]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ field });
    }
  });

  it.each([
    [{ idempotency_key: undefined }, "idempotency_key"],
    [{ idempotency_key: "short" }, "idempotency_key"],
    [{ idempotency_key: "has space in the key!!" }, "idempotency_key"],
    [{ time: "24:00" }, "time"],
    [{ time: "9:5" }, "time"],
    [{ detail: "ก".repeat(2001) }, "detail"],
    [{ full_tax: "yes" }, "full_tax"],
  ])("POST /buy ช่องหัวบิลผิด %j → 400 ชี้ %s", async (over, field) => {
    const res = await t.request("/api/buy", {
      cookie: cookies.staff,
      body: { ...bill(), idempotency_key: newKey(), ...over },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field });
  });

  it.each([
    [{ detail: "สร้อย\u0000ขาด" }, "detail"],
    [{ detail: "bell\u0007" }, "detail"],
    [{ payments: [{ method: "transfer", bank: "KBANK\u0001", amount: PAY.today }] }, "payments.0.bank"],
    [{ detail: "สร้อย\uD800ขาด" }, "detail"], // surrogate เดี่ยว (UTF-16 ไม่สมบูรณ์)
    [{ date: "2026-09-30", time: "16:30", backdate_reason: "ระบบล่ม\uDC00คีย์ใบเขียนมือ" }, "backdate_reason"],
  ])("อักขระที่ใช้ไม่ได้ในข้อความ %j → 400 ชี้ %s", async (over, field) => {
    const res = await save(bill(over));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "มีอักขระที่ใช้ไม่ได้", field });
  });

  it("tab · ขึ้นบรรทัดใหม่ ในรายละเอียดใช้ได้ (ผ่านการตรวจ ไปติดที่ quote แทน)", async () => {
    const res = await save(bill({ customer_id: null, detail: "สร้อย\tขาด\r\nแหวนเงิน\n" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ field: "customer_id" });
  });

  it("บิลย้อนหลังต้องระบุเวลา (400 ชี้ time) · ไม่บันทึก", async () => {
    // ชำระตรงยอดของวันนั้น (ราคา 30 ก.ย.) — ไม่งั้นติด quote (409) ก่อนถึงด่านเวลา
    const res = await save(bill({ date: "2026-09-30", ...REASON, payments: cash(PAY.sep30) }), "mgr");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "บิลย้อนหลังต้องระบุเวลา", field: "time" });
    expect(await receiptCount()).toBe(0);
  });

  it("บิลวันนี้: เวลาล่วงหน้าเกิน 5 นาที = 400 ชี้ time", async () => {
    const res = await save(bill({ time: "10:06" })); // ตอนนี้ 10:00
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "เวลาต้องไม่เกินเวลาปัจจุบัน", field: "time" });
    expect(await receiptCount()).toBe(0);
  });

  it('ช่องว่าง = ไม่ได้กรอก: customer_id "" → quote 200 ok:false (ไม่ใช่ 400) · POST 409', async () => {
    for (const customer_id of ["", "  ", null]) {
      const q = await quote(bill({ customer_id }));
      expect(q.status).toBe(200);
      expect(((await q.json()) as QuoteRes).errors[0]).toEqual({ field: "customer_id", message: BUY_MSG.noCustomer });
    }
    // time "" ก็ไม่ใช่ 400 — ไปติด quote (ไม่มีลูกค้า) = 409
    const res = await save(bill({ customer_id: "", time: "" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ field: "customer_id" });
  });

  it('ช่องว่าง = ไม่ได้กรอก: date "" / null → วันนี้', async () => {
    for (const date of ["", null]) {
      const q = (await (await quote(bill({ date }))).json()) as QuoteRes;
      expect(q).toMatchObject({ ok: true, date: TODAY });
    }
  });

  it("body ไม่ใช่ JSON / ไม่ใช่ object = 400", async () => {
    const raw = await t.app.request("/api/buy/quote", {
      method: "POST",
      headers: { cookie: cookies.staff ?? "", origin: "http://localhost:8787", "content-type": "application/json" },
      body: "{not json",
    });
    expect(raw.status).toBe(400);
    expect((await quote("gold")).status).toBe(400);
    expect(await receiptCount()).toBe(0);
  });

  it("F12: content-type text/plain ถูกปฏิเสธ (415) ทั้ง quote และบันทึก — ไม่มีอะไรถูกบันทึก · JSON ปกติยังทำงาน", async () => {
    const raw = async (path: string, body: unknown) =>
      t.app.request(path, {
        method: "POST",
        headers: { cookie: cookies.staff ?? "", origin: "http://localhost:8787", "content-type": "text/plain" },
        body: JSON.stringify(body),
      });
    const q = await raw("/api/buy/quote", bill());
    expect(q.status).toBe(415);
    expect(await q.json()).toEqual({ error: "ต้องส่งเป็น application/json" });

    const s = await raw("/api/buy", { ...bill(), idempotency_key: newKey() });
    expect(s.status).toBe(415);
    expect(await receiptCount()).toBe(0);

    // multipart ก็ไม่ได้ — endpoint นี้ไม่มีไฟล์แนบ (multipart อนุญาตเฉพาะฟอร์มลูกค้า)
    const form = new FormData();
    form.set("customer_id", custA);
    const multipart = await t.app.request("/api/buy", {
      method: "POST",
      headers: { cookie: cookies.staff ?? "", origin: "http://localhost:8787" },
      body: form,
    });
    expect(multipart.status).toBe(415);
    expect(await receiptCount()).toBe(0);
    // JSON ปกติยัง quote ได้เหมือนเดิม (gate ไม่ได้บล็อกของถูก) — ไม่บันทึกจริงที่นี่ เพราะเลขที่บิลใบแรกผูกกับ
    // เทสต์ "บันทึกใบแรก → RC6910-0001" ด้านล่าง (ต้องเป็นบิลที่หนึ่งของงวดจริง ๆ)
    expect((await quote(bill())).status).toBe(200);
  });

  // ---------- quote ----------

  it("quote: ทอง 96.5% 5.860 กรัม ไม่หัก → ⌊67,650 × 0.0656 × 0.965⌋ = 4,282/กรัม · ⌊4,282 × 5.86⌋ = 25,092 · snapshot ราคาทองของวันนี้", async () => {
    const res = await quote(bill());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      errors: [],
      date: TODAY,
      branch: { id: t.branches["00000"], code: "00000", name: "สำนักงานใหญ่ (สาขา 1)" },
      gold_price_snapshot: "67850.00",
      lines: [
        {
          index: 0,
          metal_id: metals.gold,
          weight_g: "5.860",
          purity_percent: "96.50",
          deduct_percent: "0",
          base_price: "67650.00",
          unit_price: "4282.00",
          gross_amount: "25092.00",
          deduct_amount: "0.00",
          amount: "25092.00",
          price_per_g: "4281.91", // 25092 ÷ 5.86 = 4281.911… (แสดงเท่านั้น R3)
        },
      ],
      payments: [{ index: 0, method: "cash", bank: null, amount: "25092.00" }],
      total_weight: "5.860",
      total_amount: "25092.00",
      avg_price_per_g: "4281.91",
      paid: "25092.00",
      balance: "0.00",
    });
  });

  it("quote ตามตัวอย่างในสัญญา: ทอง 96.5% 10 ก. หัก 3 · ทอง 100% 10 ก. · เงิน 92.5% 271.56 ก. (45 บาท/กรัม) — ปัดลงทุกขั้น", async () => {
    const res = await quote(
      bill({
        lines: [line("gold", "10", "96.5", "3"), line("gold", "10.000", "100", "0"), line("silver", "271.56", "92.5")],
        // 41,535 + 44,370 + 11,133 = 97,038
        payments: cash("97038"),
      }),
    );
    const q = (await res.json()) as QuoteRes;
    expect(q.errors).toEqual([]);
    expect(q.lines).toEqual([
      {
        index: 0,
        metal_id: metals.gold,
        weight_g: "10.000",
        purity_percent: "96.50",
        deduct_percent: "3",
        base_price: "67650.00",
        unit_price: "4282.00", // ⌊4437.84 × 0.965 = 4282.5156⌋
        gross_amount: "42820.00", // 4282 × 10
        deduct_amount: "1285.00", // 42820 − 41535
        amount: "41535.00", // ⌊42820 × 0.97 = 41535.4⌋
        price_per_g: "4153.50",
      },
      {
        index: 1,
        metal_id: metals.gold,
        weight_g: "10.000",
        purity_percent: "100.00",
        deduct_percent: "0",
        base_price: "67650.00",
        unit_price: "4437.00", // ⌊4437.84⌋
        gross_amount: "44370.00",
        deduct_amount: "0.00",
        amount: "44370.00",
        price_per_g: "4437.00",
      },
      {
        index: 2,
        metal_id: metals.silver,
        weight_g: "271.560",
        purity_percent: "92.50",
        deduct_percent: "0",
        base_price: "45.00", // ราคาเงินต่อกรัมของวัน (ไม่คูณ 0.0656)
        unit_price: "41.00", // ⌊45 × 0.925 = 41.625⌋
        gross_amount: "11133.00", // ⌊41 × 271.56 = 11133.96⌋
        deduct_amount: "0.00",
        amount: "11133.00",
        price_per_g: "41.00", // 11133 ÷ 271.56 = 40.996… → 41.00
      },
    ]);
    // 97038 ÷ 291.56 = 332.823…
    expect(q).toMatchObject({ ok: true, total_weight: "291.560", total_amount: "97038.00", avg_price_per_g: "332.82" });
    expectMoneyAsStrings(q, "POST /api/buy/quote (ตัวอย่างในสัญญา)");
  });

  it("quote หลายแถว: index ชี้แถวที่กรอก แม้แถวก่อนหน้าผิด · เฉลี่ย/กรัม · ยอดคงเหลือ", async () => {
    const res = await quote(
      bill({
        lines: [line("gold", "5.860", "96.5"), line("silver", "0", "92.5"), line("silver", "100", "92.5")],
        payments: cash("29000"),
      }),
    );
    const q = (await res.json()) as QuoteRes;
    expect(q.ok).toBe(false);
    expect(q.lines.map((l) => l.index)).toEqual([0, 2]);
    // 25,092 + ⌊41 × 100⌋ = 29,192 · 29192 ÷ 105.86 = 275.760…
    expect(q).toMatchObject({ total_weight: "105.860", total_amount: "29192.00", avg_price_per_g: "275.76" });
    expect(q).toMatchObject({ paid: "29000.00", balance: "192.00" });
    expect(q.errors).toEqual([
      { field: "lines.1.weight_g", message: BUY_MSG.weightPositive },
      { field: "payments", message: BUY_MSG.unbalanced("192.00") },
    ]);
  });

  it("quote ยังไม่กรอกอะไร = 200 ok:false (ไม่ใช่ 400) — ใช้เป็น live preview ได้ตั้งแต่เปิดหน้า", async () => {
    const res = await quote({ lines: [], payments: [] });
    expect(res.status).toBe(200);
    const q = (await res.json()) as QuoteRes;
    expect(q.ok).toBe(false);
    expect(q.errors.map((e) => e.field)).toEqual(["customer_id", "lines"]);
    expect(q).toMatchObject({ total_amount: "0.00", avg_price_per_g: "0.00", gold_price_snapshot: "67850.00" });
  });

  // override เป็นฟังก์ชัน — id ลูกค้า/โลหะ มีค่าหลัง beforeAll
  // [ชื่อ · override · field · ข้อความ · ผู้ใช้ (ค่าเริ่มต้น staff)]
  const cases: [string, () => Record<string, unknown>, string, string, string?][] = [
    ["ไม่มีลูกค้า (R1)", () => ({ customer_id: null }), "customer_id", BUY_MSG.noCustomer],
    ["ลูกค้าที่ไม่มีอยู่", () => ({ customer_id: NO_UUID }), "customer_id", BUY_MSG.noCustomer],
    ["บัตรหมดอายุ ณ วันที่บิล (R2)", () => ({ customer_id: custB }), "customer_id", "บัตรประชาชนหมดอายุแล้ว"],
    ["ไม่มีวันหมดอายุบัตร (R2)", () => ({ customer_id: custC }), "customer_id", "ยังไม่ได้กรอกวันที่บัตรหมดอายุ"],
    [
      "ไม่มีราคาทองของวันบิล (R7)",
      () => ({ date: "2026-10-03", ...REASON }),
      "gold_price",
      "ยังไม่ได้ตั้งราคาทองของวันที่ 03/10/2569",
      "mgr",
    ],
    [
      "staff เปิดบิลย้อนหลัง",
      () => ({ date: "2026-10-04", ...REASON }),
      "date",
      "เปิดบิลย้อนหลังได้เฉพาะผู้จัดการขึ้นไป",
    ],
    ["ย้อนหลังเกิน 7 วัน", () => ({ date: "2026-09-27", ...REASON }), "date", "ย้อนหลังได้ไม่เกิน 7 วัน", "mgr"],
    [
      "ย้อนหลังไม่มีเหตุผล",
      () => ({ date: "2026-09-30" }),
      "backdate_reason",
      "กรุณาระบุเหตุผลที่บันทึกย้อนหลัง",
      "mgr",
    ],
    [
      "เหตุผลสั้นเกินไป",
      () => ({ date: "2026-09-30", backdate_reason: " ล่ม " }),
      "backdate_reason",
      "เหตุผลที่บันทึกย้อนหลังต้องยาวอย่างน้อย 5 ตัวอักษร",
      "mgr",
    ],
    [
      "ชำระไม่ครบ (R4)",
      () => ({ payments: cash("25000") }),
      "payments",
      BUY_MSG.unbalanced("92.00"), // 25,092 − 25,000
    ],
    ["ชำระเกิน (R4)", () => ({ payments: cash("25093") }), "payments", BUY_MSG.overpaid],
    [
      "วิธีชำระซ้ำ (R5)",
      () => ({
        payments: [
          { method: "cash", amount: "10000" },
          { method: "cash", amount: "15092" },
        ],
      }),
      "payments.1.method",
      BUY_MSG.paymentDup,
    ],
    [
      "วิธีชำระที่ไม่รู้จัก",
      () => ({ payments: [{ method: "cheque", amount: PAY.today }] }),
      "payments.0.method",
      "กรุณาเลือกประเภทเงินที่ชำระ",
    ],
    [
      "โอนเงินไม่ระบุธนาคาร",
      () => ({ payments: [{ method: "transfer", bank: "", amount: PAY.today }] }),
      "payments.0.bank",
      "กรุณาเลือกธนาคาร",
    ],
    [
      "เงินสดระบุธนาคาร",
      () => ({ payments: [{ method: "cash", bank: "KBANK", amount: PAY.today }] }),
      "payments.0.bank",
      "เงินสดไม่ต้องระบุธนาคาร",
    ],
    [
      "โลหะที่ไม่รู้จัก",
      () => ({ lines: [{ metal_id: NO_UUID, weight_g: "5.860", purity_percent: "96.5" }] }),
      "lines.0.metal_id",
      "ไม่พบประเภทโลหะ",
    ],
    [
      "แพลตตินั่มที่ยังไม่ได้ตั้งราคาต่อกรัมของวันนี้",
      () => ({ lines: [line("platinum", "2.500", "95")] }),
      "lines.0.metal_id",
      "ยังไม่ได้ตั้งราคาแพลตตินั่มของวันนี้",
    ],
    [
      "เงินในบิลย้อนหลังวันที่ไม่ได้ตั้งราคาเงิน (ข้อความบอกวันที่)",
      () => ({ lines: [line("silver", "100", "92.5")], date: "2026-09-30", ...REASON }),
      "lines.0.metal_id",
      "ยังไม่ได้ตั้งราคาเงินของวันที่ 30/09/2569",
      "mgr",
    ],
    ["วันที่ในอนาคต", () => ({ date: "2026-10-06" }), "date", "วันที่ต้องไม่เกินวันนี้"],
    ["ไม่มีรายการ", () => ({ lines: [], payments: [] }), "lines", BUY_MSG.noLines],
    [
      "น้ำหนักว่าง (R3)",
      () => ({ lines: [line("gold", "", "96.5")], payments: [] }),
      "lines.0.weight_g",
      BUY_MSG.badNumber,
    ],
    [
      "น้ำหนักใส่จุลภาค (5,860 ที่ตั้งใจพิมพ์ 5.860)",
      () => ({ lines: [line("gold", "5,860", "96.5")], payments: [] }),
      "lines.0.weight_g",
      "น้ำหนักห้ามใส่จุลภาค — เช่น 5.860 หรือ 1250.500",
    ],
    [
      "เลขบัตรหลุดลงช่องน้ำหนัก",
      () => ({ lines: [line("gold", ID_A, "96.5")], payments: [] }),
      "lines.0.weight_g",
      BUY_MSG.weightMax,
    ],
    [
      "เลขบัตรหลุดลงช่องค่าบริสุทธิ์",
      () => ({ lines: [line("gold", "5.860", ID_A)], payments: [] }),
      "lines.0.purity_percent",
      "ค่าบริสุทธิ์ต้องเป็นตัวเลข 1–100 ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 96.5",
    ],
    [
      "ไม่กรอกค่าบริสุทธิ์",
      () => ({ lines: [line("gold", "5.860", "")] }),
      "lines.0.purity_percent",
      "กรุณากรอกค่าบริสุทธิ์ (%)",
    ],
    [
      "หัก % เกิน 10",
      () => ({ lines: [line("gold", "5.860", "96.5", "11")] }),
      "lines.0.deduct_percent",
      "หัก % ต้องเป็นเลขจำนวนเต็ม 0–10",
    ],
    [
      // ⌊⌊4437.84 × 0.01⌋ × 0.001⌋ = ⌊44 × 0.001⌋ = 0
      "ราคาที่คิดได้เป็น 0 บาท",
      () => ({ lines: [line("gold", "0.001", "1")], payments: [] }),
      "lines.0.weight_g",
      "ราคาที่คิดได้เป็น 0 บาท — ตรวจน้ำหนักและค่าบริสุทธิ์",
    ],
    [
      // 4,437 × 30,000 = 133,110,000 > 99,999,999.99 (น้ำหนักยังไม่เกินเพดาน 999,999.999)
      "ราคาที่คิดได้เกินเพดานต่อแถว",
      () => ({ lines: [line("gold", "30000", "100")], payments: [] }),
      "lines.0.weight_g",
      "ราคาที่คิดได้เกิน 99,999,999.99 บาท — ตรวจน้ำหนักอีกครั้ง",
    ],
  ];

  it.each(cases)("%s → quote ok:false · POST 409 ไม่บันทึก", async (_name, over, field, message, who = "staff") => {
    const body = bill(over());
    const before = await receiptCount();

    const q = await quote(body, who);
    expect(q.status).toBe(200);
    const qBody = (await q.json()) as QuoteRes;
    expect(qBody.ok).toBe(false);
    expect(qBody.errors[0]).toEqual({ field, message });

    const res = await save({ time: "09:00", ...body }, who);
    expect(res.status).toBe(409);
    // 409 แนบผล quote ทั้งก้อน (ตัวเดียวกับ /quote) ให้จอแสดง error ต่อช่องได้
    expect(await res.json()).toMatchObject({ error: message, field, ok: false, errors: qBody.errors });
    expect(await receiptCount()).toBe(before);
  });

  it("บัตรคิด ณ วันที่ของบิล: บัตรหมดอายุ 1 ต.ค. ใช้กับบิลย้อนหลัง 30 ก.ย. ได้", async () => {
    const res = await quote(
      bill({ customer_id: custB, date: "2026-09-30", ...REASON, payments: cash(PAY.sep30) }),
      "mgr",
    );
    const q = (await res.json()) as QuoteRes;
    expect(q).toMatchObject({ ok: true, date: "2026-09-30", gold_price_snapshot: "67000.00" });
  });

  it("ย้อนหลัง 7 วันพอดีได้ (ผู้จัดการ + เหตุผล) · ราคาคิดจากทองแท่งรับซื้อของวันนั้น · บิลวันนี้ไม่ต้องมีเหตุผล", async () => {
    const q = (await (
      await quote(bill({ date: "2026-09-28", ...REASON, payments: cash(PAY.sep28) }), "mgr")
    ).json()) as QuoteRes;
    expect(q).toMatchObject({
      ok: true,
      date: "2026-09-28",
      gold_price_snapshot: "66500.00",
      total_amount: "24594.00",
    });
    // ⌊66,300 × 0.0656 × 0.965 = 4197.0552⌋ = 4197 · ⌊4197 × 5.86 = 24594.42⌋
    expect(q.lines[0]).toMatchObject({ base_price: "66300.00", unit_price: "4197.00", amount: "24594.00" });
    expect(((await (await quote(bill())).json()) as QuoteRes).ok).toBe(true);
  });

  it("R7: ไม่มีราคาทองของวันบิล → แจ้งที่ gold_price ครั้งเดียว ไม่ซ้ำทุกแถวทอง/นาก · เงินที่ไม่มีราคาแจ้งที่แถว (บอกวันที่)", async () => {
    const q = (await (
      await quote(
        bill({
          date: "2026-10-03",
          ...REASON,
          lines: [line("gold", "5.860", "96.5"), line("nak", "3.000", "75"), line("silver", "100", "92.5")],
          payments: [],
        }),
        "mgr",
      )
    ).json()) as QuoteRes;
    expect(q.errors).toEqual([
      { field: "gold_price", message: "ยังไม่ได้ตั้งราคาทองของวันที่ 03/10/2569" },
      { field: "lines.2.metal_id", message: "ยังไม่ได้ตั้งราคาเงินของวันที่ 03/10/2569" },
    ]);
    // แถวที่คิดราคาไม่ได้ไม่ถูกนับในยอด
    expect(q).toMatchObject({ ok: false, lines: [], total_weight: "0.000", total_amount: "0.00" });
  });

  it("Siam ID พิมพ์วันหมดอายุเป็นชื่อเดือนไทย ('31 ธันวาคม 2574') → เพิ่มลูกค้าแล้วเปิดบิลได้ (สถานะบัตร ok)", async () => {
    const form = new FormData();
    form.append("national_id", ID_D);
    form.append("name_th", "นายสยาม ไอดี");
    form.append("card_expire_text", "31 ธันวาคม 2574");
    const created = await t.request("/api/customers", { cookie: cookies.staff, body: form });
    expect(created.status).toBe(201);
    custD = ((await created.json()) as { id: string }).id;
    const detail = await t.request(`/api/customers/${custD}`, { cookie: cookies.staff });
    expect(await detail.json()).toMatchObject({ card_status: "ok", card_expire_date: "2031-12-31" });

    const q = (await (await quote(bill({ customer_id: custD }))).json()) as QuoteRes;
    expect(q).toMatchObject({ ok: true, errors: [], total_amount: "25092.00" });
  });

  // ลูกค้าระบบเดิมย้ายมาพร้อมข้อความตามที่พิมพ์ไว้ — สถานะบัตรคิดจากข้อความ ณ วันที่ของบิล (5 ต.ค. 2569)
  it.each([
    ["1 ม.ค. 2570", null],
    ["5 Oct. 2026", null], // หมดอายุวันนี้ยังใช้ได้
    ["LIFELONG", null],
    ["99999999", null], // บัตรตลอดชีพ ค่าดิบจากชิป
    ["4 ต.ค. 2569", "บัตรประชาชนหมดอายุแล้ว"],
    ["1 มกรา 2570", "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง"],
  ])("วันหมดอายุ %j → quote ผ่าน / บล็อกด้วย %s (R2)", async (cardExpireText, message) => {
    await t.db.update(customer).set({ cardExpireText }).where(eq(customer.id, custD));
    const q = (await (await quote(bill({ customer_id: custD }))).json()) as QuoteRes;
    expect(q.errors).toEqual(message ? [{ field: "customer_id", message }] : []);
    expect(q.ok).toBe(message === null);
  });

  // ---------- บันทึก ----------

  let firstId = "";

  it("บันทึกใบแรก → 201 RC6910-0001 · หัวบิล/แถว/ชำระ/สต็อก ลงครบ (R9 · R11)", async () => {
    const res = await save(bill());
    expect(res.status).toBe(201);
    const saved = (await res.json()) as SavedRes;
    expect(Object.keys(saved).sort()).toEqual(["doc_no", "id", "pdf_status"]);
    expect(saved).toMatchObject({ doc_no: "RC6910-0001", pdf_status: "pending" });
    firstId = saved.id;

    const [r] = await t.db.select().from(buyReceipt).where(eq(buyReceipt.id, firstId));
    expect(r).toMatchObject({
      branchId: t.branches["00000"],
      docNo: "RC6910-0001",
      date: TODAY,
      time: "10:00:00", // ไม่ส่งเวลา = เวลาไทยตอนบันทึก
      customerId: custA,
      goldPriceSnapshot: "67850.00",
      detail: null,
      fullTax: false,
      totalWeight: "5.860",
      totalAmount: "25092.00",
      status: "active",
      pdfStatus: "pending",
      idcardStatus: "pending", // ลูกค้ามีรูปบัตร → รอสร้างสำเนาบัตร
      createdBy: userIds.staff,
    });
    expect(r?.customerSnapshot).toEqual({
      national_id: ID_A,
      name_th: "นายทดสอบ ซื้อทอง",
      name_en: "Mr. Test Buyer",
      birthday_text: "01/01/2530",
      religion: "พุทธ",
      address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
      card_issue_text: "01/01/2565",
      card_expire_text: "31/12/2574",
      mobile: "0812345678",
      phone2: null,
      photo_key: "photos/a/card.png",
    });

    // ราคาที่ระบบคิดลงแถวครบ (ตรวจย้อนหลังได้ว่าคิดจากอะไร) — numeric ของ DB: บริสุทธิ์ (6,3) · หัก % (5,2)
    expect(await t.db.select().from(buyLine).where(eq(buyLine.receiptId, firstId))).toEqual([
      expect.objectContaining({
        lineNo: 1,
        metalId: metals.gold,
        weightG: "5.860",
        purityPercent: "96.500",
        deductPercent: "0.00",
        basePrice: "67650.00",
        assessedPricePerG: "4282.00",
        assessmentAmount: "25092.00",
        amount: "25092.00",
        pricePerG: "4281.91",
      }),
    ]);
    expect(await t.db.select().from(payment).where(eq(payment.receiptId, firstId))).toEqual([
      expect.objectContaining({ method: "cash", bank: null, amount: "25092.00" }),
    ]);
    expect(await t.db.select().from(stockMovement).where(eq(stockMovement.sourceReceiptId, firstId))).toEqual([
      expect.objectContaining({ branchId: t.branches["00000"], metalId: metals.gold, date: TODAY, grams: "5.860" }),
    ]);
    // บิลวันนี้ไม่ใช่บิลย้อนหลัง — ไม่มี audit
    expect(await t.db.select().from(auditLog).where(eq(auditLog.rowId, firstId))).toHaveLength(0);
  });

  it("ตัวเลขที่บันทึก = ตัวเลขที่ quote (ฟังก์ชันเดียวกัน) · หลายแถว หลายโลหะ หลาย % · หลายวิธีชำระ · คอมมาถูกตัด", async () => {
    const body = bill({
      lines: [line("gold", "15.2", "90", "2"), line("nak", "3.333", "75"), line("silver", "250.5", "92.5", "5")],
      payments: [
        { method: "transfer", bank: " KBANK ", amount: "50,000" },
        { method: "cash", amount: "30,341.00" },
      ],
    });
    const q = (await (await quote(body)).json()) as QuoteRes;
    // ทอง 90% หัก 2: ⌊4437.84 × 0.9 = 3994.056⌋ = 3994 · ⌊3994 × 15.2 = 60708.8⌋ = 60708 · ⌊60708 × 0.98 = 59493.84⌋ = 59493
    // นาก 75% (คิดแบบทอง): ⌊3328.38⌋ = 3328 · ⌊3328 × 3.333 = 11092.224⌋ = 11092
    // เงิน 92.5% หัก 5: ⌊45 × 0.925⌋ = 41 · ⌊41 × 250.5 = 10270.5⌋ = 10270 · ⌊10270 × 0.95 = 9756.5⌋ = 9756
    // รวม 59493 + 11092 + 9756 = 80341 · 80341 ÷ 269.033 = 298.630…
    expect(q).toMatchObject({ ok: true, total_weight: "269.033", total_amount: "80341.00", avg_price_per_g: "298.63" });
    expect(
      q.lines.map((l) => [
        l.purity_percent,
        l.deduct_percent,
        l.base_price,
        l.unit_price,
        l.gross_amount,
        l.deduct_amount,
        l.amount,
        l.price_per_g,
      ]),
    ).toEqual([
      ["90.00", "2", "67650.00", "3994.00", "60708.00", "1215.00", "59493.00", "3914.01"],
      ["75.00", "0", "67650.00", "3328.00", "11092.00", "0.00", "11092.00", "3327.93"],
      ["92.50", "5", "45.00", "41.00", "10270.00", "514.00", "9756.00", "38.95"],
    ]);
    // payments รูปมาตรฐาน (คอมมาถูกตัด · ธนาคารตัดช่องว่าง) ตามลำดับที่กรอก — จอใช้แทนค่าที่พิมพ์เอง
    expect(q.payments).toEqual([
      { index: 0, method: "transfer", bank: "KBANK", amount: "50000.00" },
      { index: 1, method: "cash", bank: null, amount: "30341.00" },
    ]);

    const res = await save({ ...body, time: "09:15", detail: "  สร้อยขาด 1 เส้น แหวนเงิน  ", full_tax: true });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as SavedRes;
    expect(saved.doc_no).toBe("RC6910-0002");

    const detail = (await (await get(`/${saved.id}`)).json()) as DetailRes;
    expect(detail).toMatchObject({
      doc_no: "RC6910-0002",
      date: TODAY,
      time: "09:15",
      detail: "สร้อยขาด 1 เส้น แหวนเงิน",
      full_tax: true,
      gold_price_snapshot: q.gold_price_snapshot,
      total_weight: q.total_weight,
      total_amount: q.total_amount,
      avg_price_per_g: q.avg_price_per_g,
    });
    // แถวที่บันทึก = แถวที่ quote ทุกช่อง (GET ไม่มี deduct_amount — คิดได้จาก gross − amount)
    expect(
      detail.lines.map((l) => ({
        line_no: l.line_no,
        metal_id: l.metal.id,
        weight_g: l.weight_g,
        purity_percent: l.purity_percent,
        deduct_percent: l.deduct_percent,
        base_price: l.base_price,
        unit_price: l.unit_price,
        gross_amount: l.gross_amount,
        amount: l.amount,
        price_per_g: l.price_per_g,
      })),
    ).toEqual(
      q.lines.map((l) => ({
        line_no: l.index + 1,
        metal_id: l.metal_id,
        weight_g: l.weight_g,
        purity_percent: l.purity_percent,
        deduct_percent: l.deduct_percent,
        base_price: l.base_price,
        unit_price: l.unit_price,
        gross_amount: l.gross_amount,
        amount: l.amount,
        price_per_g: l.price_per_g,
      })),
    );
    expect(detail.lines.map((l) => [l.metal.code, l.metal.name_th])).toEqual([
      ["gold", "ทอง"],
      ["nak", "นาก"],
      ["silver", "เงิน"],
    ]);
    // คอลัมน์ใน DB (numeric ของ Postgres) — ค่าที่ตรวจสอบย้อนหลังได้ทุกช่อง
    const stored = await t.db
      .select({
        purity: buyLine.purityPercent,
        deduct: buyLine.deductPercent,
        base: buyLine.basePrice,
        unit: buyLine.assessedPricePerG,
        gross: buyLine.assessmentAmount,
        amount: buyLine.amount,
        perG: buyLine.pricePerG,
      })
      .from(buyLine)
      .where(eq(buyLine.receiptId, saved.id))
      .orderBy(asc(buyLine.lineNo));
    expect(stored).toEqual([
      {
        purity: "90.000",
        deduct: "2.00",
        base: "67650.00",
        unit: "3994.00",
        gross: "60708.00",
        amount: "59493.00",
        perG: "3914.01",
      },
      {
        purity: "75.000",
        deduct: "0.00",
        base: "67650.00",
        unit: "3328.00",
        gross: "11092.00",
        amount: "11092.00",
        perG: "3327.93",
      },
      {
        purity: "92.500",
        deduct: "5.00",
        base: "45.00",
        unit: "41.00",
        gross: "10270.00",
        amount: "9756.00",
        perG: "38.95",
      },
    ]);
    // เงินสดก่อน แล้วโอน · ธนาคารตัดช่องว่าง
    expect(detail.payments).toEqual([
      { method: "cash", method_label: "เงินสด", bank: null, amount: "30341.00" },
      { method: "transfer", method_label: "โอนเงิน", bank: "KBANK", amount: "50000.00" },
    ]);
    const stock = await t.db
      .select()
      .from(stockMovement)
      .where(eq(stockMovement.sourceReceiptId, saved.id))
      .orderBy(asc(stockMovement.grams));
    expect(stock.map((s) => [s.metalId, s.grams, s.date])).toEqual([
      [metals.nak, "3.333", TODAY],
      [metals.gold, "15.200", TODAY],
      [metals.silver, "250.500", TODAY],
    ]);
  });

  it("เลขที่นับแยกสาขา: สาขา 00001 เริ่ม RC6910-0001 ของตัวเอง · คิดราคาจากทองแท่งรับซื้อเฉพาะสาขา (67,800)", async () => {
    // ชำระด้วยยอดของสาขาหลัก (ราคากลาง) = ไม่ตรง → ราคาเฉพาะสาขาถูกใช้จริงตอนคิด ไม่ใช่แค่ใน snapshot
    const wrong = await save(bill(), "staff1");
    expect(wrong.status).toBe(409);
    expect(await wrong.json()).toMatchObject({ field: "payments", total_amount: "25151.00" });

    const res = await save(bill({ payments: cash(PAY.branch1) }), "staff1");
    expect(res.status).toBe(201);
    const saved = (await res.json()) as SavedRes;
    expect(saved.doc_no).toBe("RC6910-0001");
    const detail = (await (await get(`/${saved.id}`, "staff1")).json()) as DetailRes;
    expect(detail).toMatchObject({
      branch: { code: "00001" },
      gold_price_snapshot: "68000.00",
      idcard_status: "pending",
      total_amount: "25151.00",
    });
    // ⌊67,800 × 0.0656 × 0.965 = 4292.0112⌋ = 4292 · ⌊4292 × 5.86 = 25151.12⌋ = 25151
    expect(detail.lines[0]).toMatchObject({ base_price: "67800.00", unit_price: "4292.00", gross_amount: "25151.00" });
  });

  it("สาขาที่มีราคาทองของตัวเอง ยังใช้ราคาเงินต่อกรัมของราคากลาง (ตั้งได้ที่ราคากลางเท่านั้น)", async () => {
    const q = (await (
      await quote(bill({ lines: [line("silver", "100", "92.5")], payments: cash("4100") }), "staff1")
    ).json()) as QuoteRes;
    expect(q.errors).toEqual([]);
    expect(q.lines[0]).toMatchObject({ base_price: "45.00", unit_price: "41.00", amount: "4100.00" });
  });

  let backdatedId = "";
  const backKey = "test-key-backdated-0001";

  it("บิลย้อนหลังข้ามเดือน → เลขงวดของวันบิล RC6909-0001 · ราคาของวันนั้น · สต็อกลงวันบิล · audit", async () => {
    const res = await save(
      bill({
        customer_id: custB,
        date: "2026-09-30",
        time: "16:30",
        ...REASON,
        payments: cash(PAY.sep30),
        idempotency_key: backKey,
      }),
      "mgr",
    );
    expect(res.status).toBe(201);
    const saved = (await res.json()) as SavedRes;
    expect(saved.doc_no).toBe("RC6909-0001");
    backdatedId = saved.id;

    const detail = (await (await get(`/${saved.id}`)).json()) as DetailRes;
    expect(detail).toMatchObject({
      date: "2026-09-30",
      time: "16:30",
      gold_price_snapshot: "67000.00",
      total_amount: "24776.00",
    });
    // ราคาของวันบิล (ทองแท่งรับซื้อ 30 ก.ย. = 66,800) ไม่ใช่ราคาวันนี้
    expect(detail.lines[0]).toMatchObject({ base_price: "66800.00", unit_price: "4228.00", amount: "24776.00" });
    expect(detail.idcard_status).toBe("none"); // ลูกค้าไม่มีรูปบัตร
    const [stock] = await t.db.select().from(stockMovement).where(eq(stockMovement.sourceReceiptId, saved.id));
    expect(stock?.date).toBe("2026-09-30");

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.rowId, saved.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      userId: userIds.mgr,
      action: "buy.backdate",
      tableName: "buy_receipt",
      diff: {
        doc_no: "RC6909-0001",
        date: "2026-09-30",
        time: "16:30",
        entered_on: TODAY,
        reason: "ระบบล่ม คีย์ใบเขียนมือ",
      },
    });
  });

  it("เปิดบิลพร้อมกัน 10 ใบ → เลขไม่ซ้ำ ไม่ข้าม (next_doc_no ล็อกแถวตัวนับ)", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => save(bill())));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    const nos = (await Promise.all(results.map(async (r) => ((await r.json()) as SavedRes).doc_no))).sort();
    expect(nos).toEqual(running("6910", 3, 12));
    expect(await docNos("00000", "6910")).toEqual(running("6910", 1, 12));
  });

  it("idempotency: ส่งซ้ำด้วย key เดิม = 200 บิลเดิม ไม่สร้างใหม่ · แม้ข้ามเที่ยงคืนแล้ว quote จะไม่ผ่าน", async () => {
    const key = newKey();
    const first = await saveWithKey(key);
    expect(first.status).toBe(201);
    const saved = (await first.json()) as SavedRes;
    expect(saved.doc_no).toBe("RC6910-0013");

    const again = await saveWithKey(key);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(saved);

    clock = new Date("2026-10-05T17:30:00Z"); // 00:30 น. วันที่ 6 — ยังไม่มีราคาทองของวันใหม่
    try {
      const late = await saveWithKey(key);
      expect(late.status).toBe(200);
      expect(await late.json()).toEqual(saved);
    } finally {
      clock = NOW;
    }
    expect(await t.db.select().from(buyReceipt).where(eq(buyReceipt.idempotencyKey, key))).toHaveLength(1);
  });

  it("idempotency: key ของคนอื่น = 409 ชี้ idempotency_key", async () => {
    const key = newKey();
    expect((await saveWithKey(key)).status).toBe(201);
    const res = await saveWithKey(key, "staff1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "idempotency_key นี้ถูกใช้แล้ว", field: "idempotency_key" });
    expect(await docNos("00001", "6910")).toEqual(running("6910", 1, 1));
  });

  it("idempotency: ส่ง key เดียวกันพร้อมกัน 5 ครั้ง → บิลเดียว · ทุกคำตอบชี้บิลเดียวกัน · เลขไม่ข้าม", async () => {
    const key = newKey();
    const results = await Promise.all(Array.from({ length: 5 }, () => saveWithKey(key)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 201]);
    const bodies = (await Promise.all(results.map((r) => r.json()))) as SavedRes[];
    expect(new Set(bodies.map((b) => b.id)).size).toBe(1);
    expect(await t.db.select().from(buyReceipt).where(eq(buyReceipt.idempotencyKey, key))).toHaveLength(1);

    // ตัวที่แพ้ rollback แล้วเลขคืน → ใบถัดไปได้เลขต่อกันพอดี
    const next = (await (await save(bill())).json()) as SavedRes;
    expect(await docNos("00000", "6910")).toEqual(running("6910", 1, 16));
    expect(next.doc_no).toBe("RC6910-0016");
    const [counter] = await t.db
      .select()
      .from(docSequence)
      .where(and(eq(docSequence.branchId, t.branches["00000"] ?? ""), eq(docSequence.period, "6910")));
    expect(counter?.lastNo).toBe(16);
  });

  it("idempotency ผูกกับเนื้อบิลทั้งใบ: key เดิมแต่เนื้อต่างทุกมิติ = 409 พร้อมบิลที่บันทึกแล้ว", async () => {
    const key = newKey();
    const first = await saveWithKey(key);
    expect(first.status).toBe(201);
    const saved = (await first.json()) as SavedRes;
    const other: [string, Record<string, unknown>][] = [
      // ⌊4437.84 × 0.9651 = 4282.959…⌋ = 4282 → ยอด 25,092 เท่าเดิม แต่ค่าบริสุทธิ์ที่บันทึกต่าง = คนละบิล
      ["ค่าบริสุทธิ์ต่าง ยอดที่คิดได้เท่าเดิม", bill({ lines: [line("gold", "5.860", "96.51")] })],
      ["ค่าบริสุทธิ์ต่าง", bill({ lines: [line("gold", "5.860", "90")] })],
      // หัก 1%: ⌊25092 × 0.99 = 24841.08⌋ = 24,841
      ["หัก % ต่าง", bill({ lines: [line("gold", "5.860", "96.5", "1")], payments: cash("24841") })],
      ["น้ำหนักต่าง", bill({ lines: [line("gold", "5.861", "96.5")], payments: cash("25096") })],
      ["ลูกค้าต่าง", bill({ customer_id: custB })],
      ["ไม่มีลูกค้า", bill({ customer_id: null })],
      [
        "โลหะต่าง น้ำหนัก/ค่าบริสุทธิ์เท่าเดิม",
        bill({ lines: [line("silver", "5.860", "96.5")], payments: cash("251") }),
      ],
      // 2 × ⌊4282 × 2.93 = 12546.26⌋ = 25,092 เท่าเดิม
      ["แบ่งแถวต่าง ยอดรวมเท่าเดิม", bill({ lines: [line("gold", "2.930", "96.5"), line("gold", "2.930", "96.5")] })],
      ["แถวผิดรูป", bill({ lines: [line("gold", "5.860", "abc")] })],
      // ทศนิยม 4 ตำแหน่ง ปัดเป็น 3 ตำแหน่งแล้วเท่าน้ำหนักเดิม — แต่ quote ปฏิเสธแถวนี้ จึงห้ามถือเป็นบิลเดิม
      ["น้ำหนักทศนิยม 4 ตำแหน่ง (ปัดแล้วเท่าเดิม)", bill({ lines: [line("gold", "5.8601", "96.5")] })],
      ["น้ำหนัก 0", bill({ lines: [line("gold", "0", "96.5")] })],
      [
        "แบ่งชำระต่าง ยอดรวมเท่าเดิม",
        bill({
          payments: [
            { method: "cash", amount: "15092" },
            { method: "transfer", bank: "KBANK", amount: "10000" },
          ],
        }),
      ],
      ["รายละเอียดต่าง", bill({ detail: "สร้อยขาด 1 เส้น" })],
      ["ใบกำกับเต็มรูปต่าง", bill({ full_tax: true })],
      ["ส่งวันที่ต่าง", bill({ date: "2026-10-04", time: "10:00", ...REASON })],
    ];
    for (const [name, body] of other) {
      const res = await t.request("/api/buy", { cookie: cookies.staff, body: { ...body, idempotency_key: key } });
      expect({ name, status: res.status }).toEqual({ name, status: 409 });
      expect(await res.json()).toEqual({
        error: "idempotency_key นี้ใช้กับบิลอื่นแล้ว",
        field: "idempotency_key",
        existing: { id: saved.id, doc_no: saved.doc_no },
      });
    }
    expect(await t.db.select().from(buyReceipt).where(eq(buyReceipt.idempotencyKey, key))).toHaveLength(1);
  });

  it("idempotency: เนื้อเดิมทุกอย่าง = บิลเดิม (200) แม้เขียนตัวเลขคนละรูป · ส่งวันที่วันนี้ · เวลาบิลวันนี้ไม่เทียบ", async () => {
    const key = newKey();
    const saved = (await (await saveWithKey(key)).json()) as SavedRes;
    // น้ำหนัก "5.86" = "5.860" · บริสุทธิ์ " 96.50" = "96.5" · หัก "0" = ไม่ส่ง · amount ที่แนบมาถูกเมิน (ราคาคิดที่เซิร์ฟเวอร์)
    for (const sameLine of [
      { ...line("gold", "5.86", " 96.50", "0"), amount: "1.00" },
      { ...line("gold", "5.860", "96.5"), deduct_percent: null },
      { ...line("gold", "5.860", "96.5"), deduct_percent: "" },
    ]) {
      const exact = await t.request("/api/buy", {
        cookie: cookies.staff,
        body: { ...bill({ lines: [sameLine], date: TODAY, time: "09:59" }), idempotency_key: key },
      });
      expect({ sameLine, status: exact.status }).toEqual({ sameLine, status: 200 });
      expect(await exact.json()).toEqual(saved);
    }

    // ชำระหลายแถว: เทียบแบบไม่สนลำดับ
    const key2 = newKey();
    const split = [
      { method: "cash", amount: "15092" },
      { method: "transfer", bank: "KBANK", amount: "10000" },
    ];
    const created = await t.request("/api/buy", {
      cookie: cookies.staff,
      body: { ...bill({ payments: split }), idempotency_key: key2 },
    });
    expect(created.status).toBe(201);
    const reordered = await t.request("/api/buy", {
      cookie: cookies.staff,
      body: { ...bill({ payments: [split[1], { method: "cash", amount: "15,092.00" }] }), idempotency_key: key2 },
    });
    expect(reordered.status).toBe(200);
    expect(await reordered.json()).toEqual(await created.json());
  });

  it("idempotency บิลย้อนหลัง: เทียบวันที่และเวลา · ส่งบิลวันนี้ซ้ำเป็นบิลย้อนหลัง = 409", async () => {
    const backdated = bill({
      customer_id: custB,
      date: "2026-09-30",
      time: "16:30",
      ...REASON,
      payments: cash(PAY.sep30),
    });
    const replay = async (over: Record<string, unknown>) =>
      t.request("/api/buy", { cookie: cookies.mgr, body: { ...backdated, ...over, idempotency_key: backKey } });
    const exact = await replay({});
    expect(exact.status).toBe(200);
    expect(((await exact.json()) as SavedRes).id).toBe(backdatedId);
    for (const over of [{ time: "16:31" }, { time: undefined }, { date: "2026-09-29" }]) {
      const res = await replay(over);
      expect({ over, status: res.status }).toEqual({ over, status: 409 });
      expect(await res.json()).toMatchObject({ existing: { id: backdatedId, doc_no: "RC6909-0001" } });
    }

    const key = newKey();
    const today = await t.request("/api/buy", { cookie: cookies.mgr, body: { ...bill(), idempotency_key: key } });
    expect(today.status).toBe(201);
    const saved = (await today.json()) as SavedRes;
    const asBackdated = await t.request("/api/buy", {
      cookie: cookies.mgr,
      body: { ...bill({ date: "2026-09-30", time: "16:30", ...REASON }), idempotency_key: key },
    });
    expect(asBackdated.status).toBe(409);
    expect(await asBackdated.json()).toMatchObject({ existing: { id: saved.id, doc_no: saved.doc_no } });
  });

  it("idempotency: session ที่เสียสาขาปัจจุบันไปแล้วยังได้บิลเดิม · บิลใหม่ยังต้องเลือกสาขา", async () => {
    const key = newKey();
    const first = await saveWithKey(key);
    expect(first.status).toBe(201);
    const saved = (await first.json()) as SavedRes;
    const mine = eq(session.userId, userIds.staff ?? "");
    await t.db.update(session).set({ currentBranchId: null }).where(mine);
    try {
      const again = await saveWithKey(key);
      expect(again.status).toBe(200);
      expect(await again.json()).toEqual(saved);
      const fresh = await save(bill());
      expect(fresh.status).toBe(403);
      expect(await fresh.json()).toEqual({ error: "ยังไม่ได้เลือกสาขาที่ทำงาน", field: "branch" });
    } finally {
      await t.db.update(session).set({ currentBranchId: t.branches["00000"] }).where(mine);
    }
  });

  it("R15: snapshot ลูกค้าไม่เปลี่ยนเมื่อแก้ข้อมูลลูกค้าทีหลัง · บิลใหม่ใช้ข้อมูลใหม่", async () => {
    await t.db
      .update(customer)
      .set({ nameTh: "นายเปลี่ยน ชื่อใหม่", address: "99 ที่อยู่ใหม่" })
      .where(eq(customer.id, custA));
    try {
      const detail = (await (await get(`/${firstId}`)).json()) as DetailRes;
      expect(detail.customer).toEqual({
        id: custA,
        name_th: "นายทดสอบ ซื้อทอง",
        name_en: "Mr. Test Buyer",
        address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
        national_id_masked: "1 XXXX XXXXX 45 8",
      });
      const [row] = await t.db.select().from(buyReceipt).where(eq(buyReceipt.id, firstId));
      expect(row?.customerSnapshot.name_th).toBe("นายทดสอบ ซื้อทอง");

      const res = await save(bill());
      const fresh = (await (await get(`/${((await res.json()) as SavedRes).id}`)).json()) as DetailRes;
      expect(fresh.customer).toMatchObject({ name_th: "นายเปลี่ยน ชื่อใหม่", address: "99 ที่อยู่ใหม่" });
    } finally {
      await t.db
        .update(customer)
        .set({ nameTh: "นายทดสอบ ซื้อทอง", address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น" })
        .where(eq(customer.id, custA));
    }
  });

  // ---------- อ่าน · scoping ----------

  it("GET /:id — ครบทุกช่อง · no-store · เลขบัตรมาสก์ ไม่มีเลขเต็มใน response (R13)", async () => {
    const res = await get(`/${firstId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain(ID_A);
    const { created_at, ...detail } = JSON.parse(text) as DetailRes;
    expect(created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(detail).toEqual({
      id: firstId,
      doc_no: "RC6910-0001",
      date: TODAY,
      time: "10:00",
      branch: { id: t.branches["00000"], code: "00000", name: "สำนักงานใหญ่ (สาขา 1)", tax_branch_code: "00000" },
      customer: {
        id: custA,
        name_th: "นายทดสอบ ซื้อทอง",
        name_en: "Mr. Test Buyer",
        address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
        national_id_masked: "1 XXXX XXXXX 45 8",
      },
      gold_price_snapshot: "67850.00",
      detail: null,
      full_tax: false,
      lines: [
        {
          line_no: 1,
          metal: { id: metals.gold, code: "gold", name_th: "ทอง" },
          weight_g: "5.860",
          // รูปเดียวกับคำตอบของ quote: บริสุทธิ์ 2 ตำแหน่ง · หัก % เลขเต็ม (DB เก็บ "96.500" / "0.00")
          purity_percent: "96.50",
          deduct_percent: "0",
          base_price: "67650.00",
          unit_price: "4282.00",
          gross_amount: "25092.00",
          amount: "25092.00",
          price_per_g: "4281.91",
        },
      ],
      payments: [{ method: "cash", method_label: "เงินสด", bank: null, amount: "25092.00" }],
      total_weight: "5.860",
      total_amount: "25092.00",
      avg_price_per_g: "4281.91",
      status: "active",
      pdf_status: "pending",
      idcard_status: "pending",
      void_pdf_status: "none",
      created_by: { id: userIds.staff, name: "staff" },
      voided_at: null,
      void_reason: null,
      // ข้อมูลใบเดียวกับ PDF (เลขบัตรมาสก์) — ตรวจละเอียดใน buyPdf.test.ts
      receipt: expect.objectContaining({ docNo: "RC6910-0001", status: "active" }) as unknown,
    });
  });

  it("GET /:id — uuid ผิดรูป / ไม่มี = 404", async () => {
    expect((await get("/not-a-uuid")).status).toBe(404);
    expect((await get(`/${NO_UUID}`)).status).toBe(404);
  });

  it("scoping: สาขาอื่นเห็นรายการว่าง และเปิดบิลข้ามสาขาได้ 404 (ไม่บอกว่ามีอยู่)", async () => {
    const mine = await list("", "staff1");
    expect(mine.items.length).toBe(1);
    expect(mine.items.every((i) => i.branch.code === "00001")).toBe(true);
    expect((await get(`/${firstId}`, "staff1")).status).toBe(404);

    const own = await list("", "staff");
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.every((i) => i.branch.code === "00000")).toBe(true);
    // ขอสาขาที่ไม่มีสิทธิ์ = ว่าง (ไม่ใช่ 403 และไม่ใช่ทุกสาขา) · id มั่ว ๆ ก็ว่าง
    expect(await list(`branch_id=${t.branches["00001"]}`, "staff")).toEqual({
      items: [],
      page: 1,
      has_more: false,
      totals: ZERO_TOTALS,
    });
    expect((await list("branch_id=nonsense", "staff")).items).toEqual([]);
    expect((await list(`branch_id=${t.branches["00000"]}`, "staff")).items.length).toBe(own.items.length);
  });

  it("accounting เห็นบิลของสาขาตัวเอง (อ่านอย่างเดียว)", async () => {
    expect((await list("", "acct")).items.every((i) => i.branch.code === "00000")).toBe(true);
    expect((await get(`/${firstId}`, "acct")).status).toBe(200);
  });

  it("can_view_all เห็นทุกสาขา · กรองสาขาได้ · สาขาที่ถูกปิดหายจากรายการและหน้าบิลของ role ทั่วไป", async () => {
    const res = await save(bill(), "staff2");
    expect(res.status).toBe(201); // ราคากลางใช้ได้ทุกสาขา
    const closedId = ((await res.json()) as SavedRes).id;

    const all = await list("", "mgrall");
    expect(new Set(all.items.map((i) => i.branch.code))).toEqual(new Set(["00000", "00001", "00002"]));
    expect((await list(`branch_id=${t.branches["00001"]}`, "mgrall")).items.map((i) => i.branch.code)).toEqual([
      "00001",
    ]);
    expect((await get(`/${closedId}`, "mgrall")).status).toBe(200);

    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      expect((await list("", "mgrall")).items.some((i) => i.branch.code === "00002")).toBe(false);
      expect((await get(`/${closedId}`, "mgrall")).status).toBe(404);
      for (const who of ["staff2", "mgr2"]) {
        expect((await get("", who)).status).toBe(403);
        expect((await get(`/${closedId}`, who)).status).toBe(403);
        expect((await save(bill(), who)).status).toBe(403);
      }
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
    }
  });

  it("สาขาที่ถูกปิด: accounting/admin ยังอ่านบิลเดิมได้ (อ่านอย่างเดียว) · ไม่มีใครเปิดบิลที่นั่นได้", async () => {
    const b2 = t.branches["00002"] ?? "";
    const [old] = await t.db.select().from(buyReceipt).where(eq(buyReceipt.branchId, b2)).limit(1);
    const closedId = old?.id ?? "";
    // admin กำลังทำงานที่สาขา 00002 อยู่ตอนสาขาถูกปิด
    expect((await t.request("/api/me/branch", { cookie: cookies.boss, body: { branch_id: b2 } })).status).toBe(200);
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      for (const who of ["acct2", "boss"]) {
        const l = await list(`branch_id=${b2}`, who);
        expect(l.items.map((i) => i.id)).toContain(closedId);
        expect(l.items.every((i) => i.branch.code === "00002")).toBe(true);
        expect(l.totals).toEqual(await expectedTotals(eq(buyReceipt.branchId, b2)));
        const d = await get(`/${closedId}`, who);
        expect(d.status).toBe(200);
        expect(((await d.json()) as DetailRes).branch.code).toBe("00002");
      }
      // เขียนไม่ได้: สาขาที่ทำงานต้องยังเปิดอยู่ · เลือกสาขาที่ปิดเป็นสาขาที่ทำงานไม่ได้
      // ทั้งคู่มีสิทธิ์สาขานี้มาก่อน (acct2 = สาขาหลัก · boss = canViewAll) → ข้อความบอกว่า "ปิดแล้ว" ไม่ใช่ "ยังไม่ได้เลือก"
      for (const who of ["acct2", "boss"]) {
        const q = await quote(bill(), who);
        expect(q.status).toBe(403);
        expect(await q.json()).toEqual({ error: "สาขาที่เลือกไว้ถูกปิดแล้ว — กรุณาเลือกสาขาอื่น", field: "branch" });
      }
      const savedBoss = await save(bill(), "boss");
      expect(savedBoss.status).toBe(403);
      expect(await savedBoss.json()).toEqual({
        error: "สาขาที่เลือกไว้ถูกปิดแล้ว — กรุณาเลือกสาขาอื่น",
        field: "branch",
      });
      expect((await save(bill(), "acct2")).status).toBe(403); // accounting อ่านอย่างเดียว — ติด role ก่อนถึงสาขา
      expect((await t.request("/api/me/branch", { cookie: cookies.boss, body: { branch_id: b2 } })).status).toBe(404);
      expect(await t.db.select().from(buyReceipt).where(eq(buyReceipt.branchId, b2))).toHaveLength(1);
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
      await t.db
        .update(session)
        .set({ currentBranchId: null })
        .where(eq(session.userId, userIds.boss ?? ""));
    }
  });

  it("scoping: currentBranchId ชี้สาขาที่ไม่เคยมีสิทธิ์แล้วถูกปิด — เหมือนยังไม่ได้เลือก ไม่ใช่ 'ปิดแล้ว' (ไม่รั่วว่าสาขานั้นมีอยู่)", async () => {
    const mine = eq(session.userId, userIds.staff ?? "");
    // staff มีสิทธิ์แค่ 00000 — จำลอง session ที่หลุดไปชี้สาขาอื่นที่ไม่เคยมีสิทธิ์ (ทำตรง ๆ ผ่าน DB เหมือนเทสต์ข้างบน)
    await t.db.update(session).set({ currentBranchId: t.branches["00002"] }).where(mine);
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      for (const res of [await quote(bill(), "staff"), await save(bill(), "staff")]) {
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "ยังไม่ได้เลือกสาขาที่ทำงาน", field: "branch" });
      }
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
      await t.db.update(session).set({ currentBranchId: t.branches["00000"] }).where(mine);
    }
  });

  it("รายการ: ลูกค้าจาก snapshot · เลขบัตรมาสก์ · no-store · ไม่มีเลขเต็มใน response", async () => {
    const res = await get("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    for (const id of [ID_A, ID_B]) expect(text).not.toContain(id);
    const body = JSON.parse(text) as ListRes;
    const first = body.items.find((i) => i.id === firstId);
    expect(first).toEqual({
      id: firstId,
      doc_no: "RC6910-0001",
      date: TODAY,
      time: "10:00",
      branch: { id: t.branches["00000"], code: "00000", name: "สำนักงานใหญ่ (สาขา 1)" },
      customer: { id: custA, name_th: "นายทดสอบ ซื้อทอง", national_id_masked: "1 XXXX XXXXX 45 8" },
      total_weight: "5.860",
      total_amount: "25092.00",
      status: "active",
      pdf_status: "pending",
      void_pdf_status: "none",
      created_by: { id: userIds.staff, name: "staff" },
    });
    expect(body.items.find((i) => i.id === backdatedId)?.customer.national_id_masked).toBe("3 XXXX XXXXX 65 7");
  });

  it("รายการ: เรียงวันที่ → เวลา → เลขที่ ใหม่ก่อน", async () => {
    const { items } = await list();
    const key = (i: ListItem) => `${i.date} ${i.time} ${i.doc_no}`;
    expect(items.map(key)).toEqual([...items.map(key)].sort().reverse());
    expect(items.at(-1)?.id).toBe(backdatedId);
  });

  it.each([
    ["date_from=2026-09-30&date_to=2026-09-30", ["RC6909-0001"]],
    ["date_to=2026-10-04", ["RC6909-0001"]],
    ["date_from=2026-10-06", []],
    ["metal=nak", ["RC6910-0002"]],
    ["metal=silver&date_from=2026-10-05", ["RC6910-0002"]],
    ["metal=platinum", []],
    ["metal=unknown", []],
    ["q=rc6909", ["RC6909-0001"]], // เลขที่ ไม่สนตัวพิมพ์
    ["q=6910-0002", ["RC6910-0002"]],
    [`q=${encodeURIComponent("บัตร หมด")}`, ["RC6909-0001"]], // ชื่อจาก snapshot
    ["q=00987", ["RC6909-0001"]], // เลขบัตรบางส่วน
    [`q=${encodeURIComponent("3-1005-00987")}`, ["RC6909-0001"]], // เลขบัตรมีขีด
    ["q=%25%25", []], // wildcard ถูก escape
    ["q=__", []],
  ])("กรอง %s → %j", async (qs, expected) => {
    expect((await list(qs)).items.map((i) => i.doc_no)).toEqual(expected);
  });

  it("ช่องค้นที่ส่งมาว่าง = ไม่กรอง (ไม่ใช่ 400)", async () => {
    const all = await list();
    expect(await list("date_from=&date_to=&metal=&q=&branch_id=&page=")).toEqual(all);
  });

  it("กรองตามชื่ออังกฤษใน snapshot ได้", async () => {
    const { items } = await list(`q=${encodeURIComponent("test buyer")}`);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.customer.id === custA)).toBe(true);
  });

  it.each([
    ["q=%00%00", "q"],
    ["q=ab%1B", "q"],
    ["metal=gold%00", "metal"],
    ["q=ก", "q"],
    ["page=0", "page"],
    ["date_from=2026-13-01", "date_from"],
    ["date_from=0000-01-01", "date_from"],
    ["date_to=1999-12-31", "date_to"],
    ["date_to=yesterday", "date_to"],
  ])("query ผิด %s → 400 ชี้ %s", async (qs, field) => {
    const res = await get(`?${qs}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ field });
  });

  it("แบ่งหน้าละ 50 · has_more · ไม่มีบิลซ้ำข้ามหน้า", async () => {
    for (let round = 0; round < 4; round++) {
      const results = await Promise.all(Array.from({ length: 10 }, () => save(bill())));
      expect(results.every((r) => r.status === 201)).toBe(true);
    }
    const total = (
      await t.db
        .select()
        .from(buyReceipt)
        .where(eq(buyReceipt.branchId, t.branches["00000"] ?? ""))
    ).length;
    expect(total).toBeGreaterThan(50);
    const p1 = await list("page=1");
    const p2 = await list("page=2");
    expect([p1.items.length, p1.has_more, p2.items.length, p2.has_more]).toEqual([50, true, total - 50, false]);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(total);
    const p3 = await list("page=3");
    expect([p3.items, p3.has_more]).toEqual([[], false]);
    expect(p3.totals).toEqual(p1.totals); // ยอดรวมครอบทุกหน้า ไม่ใช่เฉพาะหน้าที่ขอ
    // เลขที่ของงวดยังต่อเนื่องหลังเปิดบิลพร้อมกันอีก 40 ใบ
    const nos = await docNos("00000", "6910");
    expect(nos).toEqual(running("6910", 1, nos.length));
  });

  // ---------- totals (การ์ด "ยอดซื้อวันนี้" · หน้าค้นบิล) ----------

  it("totals = ผลรวมของบิลทุกหน้าตามตัวกรองเดียวกับรายการ (ตรงกับ DB และกับผลรวมของรายการ)", async () => {
    const own = await expectedTotals(eq(buyReceipt.branchId, t.branches["00000"] ?? ""));
    const p1 = await list();
    const p2 = await list("page=2");
    expect(p1.totals).toEqual(own);
    expect(p2.totals).toEqual(own);
    const items = [...p1.items, ...p2.items];
    expect({
      count: String(items.length),
      total_weight: fmtWeight(items.reduce((sum, i) => sum.plus(i.total_weight), ZERO)),
      total_amount: fmtMoney(items.reduce((sum, i) => sum.plus(i.total_amount), ZERO)),
    }).toEqual(p1.totals);

    // การ์ดหน้าหลัก: ?date_from=วันนี้&date_to=วันนี้&branch_id=สาขาปัจจุบัน
    const card = await list(`date_from=${TODAY}&date_to=${TODAY}&branch_id=${t.branches["00000"]}`);
    expect(card.totals).toEqual(
      await expectedTotals(and(eq(buyReceipt.branchId, t.branches["00000"] ?? ""), eq(buyReceipt.date, TODAY))),
    );
  });

  it.each([
    ["date_from=2026-09-30&date_to=2026-09-30", SEP30_BILL],
    ["q=rc6909", SEP30_BILL],
    [`q=${encodeURIComponent("บัตร หมด")}`, SEP30_BILL],
    ["metal=nak", { count: "1", total_weight: "269.033", total_amount: "80341.00" }], // ยอดทั้งบิลที่มีนาก
    ["date_from=2026-10-06", ZERO_TOTALS],
    ["metal=platinum", ZERO_TOTALS],
  ])("totals ตามตัวกรอง %s → %j", async (qs, totals) => {
    expect((await list(qs)).totals).toEqual(totals);
  });

  it("totals ไม่นับบิลที่ยกเลิก — บิลยังอยู่ในรายการ", async () => {
    const qs = "date_from=2026-09-30&date_to=2026-09-30";
    await t.db.update(buyReceipt).set({ status: "void" }).where(eq(buyReceipt.id, backdatedId));
    try {
      const res = await list(qs);
      expect(res.items.map((i) => [i.doc_no, i.status])).toEqual([["RC6909-0001", "void"]]);
      expect(res.totals).toEqual(ZERO_TOTALS);
    } finally {
      await t.db.update(buyReceipt).set({ status: "active" }).where(eq(buyReceipt.id, backdatedId));
    }
    expect((await list(qs)).totals).toEqual(SEP30_BILL);
  });

  it("totals ตามสิทธิ์สาขา: สาขาอื่นไม่ถูกนับ · branch_id ที่ไม่มีสิทธิ์ = ศูนย์ · สาขาที่ปิดไม่นับ (role ทั่วไป)", async () => {
    const b1 = t.branches["00001"] ?? "";
    expect((await list("", "staff1")).totals).toEqual(BRANCH1_BILL);
    expect((await list(`branch_id=${t.branches["00000"]}`, "staff1")).totals).toEqual(ZERO_TOTALS);
    expect((await list(`branch_id=${b1}`, "staff")).totals).toEqual(ZERO_TOTALS);
    expect((await list("", "boss")).totals).toEqual(await expectedTotals());
    expect((await list(`branch_id=${b1}`, "boss")).totals).toEqual(BRANCH1_BILL);

    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00002"));
    try {
      expect((await list("", "mgrall")).totals).toEqual(
        await expectedTotals(ne(buyReceipt.branchId, t.branches["00002"] ?? "")),
      );
      // admin อ่านย้อนหลังได้ → ยอดรวมยังนับสาขาที่ปิด
      expect((await list("", "boss")).totals).toEqual(await expectedTotals());
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00002"));
    }
  });

  it("เวลาในบิลวันนี้: ล่วงหน้าได้ไม่เกิน 5 นาที · ช่วงก่อนเที่ยงคืนเลือกเวลาท้ายวันได้", async () => {
    expect((await save(bill({ time: "10:05" }))).status).toBe(201);
    clock = new Date("2026-10-05T16:58:00Z"); // 23:58 น. — อีก 5 นาทีข้ามวันแล้ว
    try {
      expect((await save(bill({ time: "23:59" }))).status).toBe(201);
    } finally {
      clock = NOW;
    }
  });

  it("query ที่ล้มไม่พาข้อมูลลูกค้าลง log — เห็นแค่ SQL + code ของ Postgres (PDPA)", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(format(...args));
    });
    // บังคับให้ insert หัวบิลล้ม — params ของ query นั้นมี snapshot ลูกค้าทั้งก้อน
    await t.db.execute(sql`alter table buy_receipt add constraint test_reject_all check (false) not valid`);
    try {
      const res = await save(bill());
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal error" });
    } finally {
      await t.db.execute(sql`alter table buy_receipt drop constraint test_reject_all`);
      spy.mockRestore();
    }
    const text = logged.join("\n");
    expect(text).toContain('insert into "buy_receipt"');
    expect(text).toContain("23514");
    for (const pii of [ID_A, "0812345678", "นายทดสอบ ซื้อทอง", "Mr. Test Buyer", "photos/a/card.png"]) {
      expect(text).not.toContain(pii);
    }
  });

  it("สาขาที่ยังไม่มีรหัสสาขาสรรพากร ขายไม่ได้ (quote ok:false · POST 409) · ตั้งรหัสแล้วขายได้ · สำนักงานใหญ่ขายได้", async () => {
    const b1 = eq(branch.code, "00001");
    const message = "สาขานี้ยังไม่ได้ตั้งรหัสสาขาของกรมสรรพากร — ติดต่อผู้ดูแลระบบ";
    expect(((await (await quote(bill())).json()) as QuoteRes).ok).toBe(true); // 00000 (seed มีรหัส)
    await t.db.update(branch).set({ taxBranchCode: null }).where(b1);
    try {
      const q = (await (await quote(bill1(), "staff1")).json()) as QuoteRes;
      expect(q.ok).toBe(false);
      expect(q.errors[0]).toEqual({ field: "branch", message });
      const before = await receiptCount();
      const res = await save(bill1(), "staff1");
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: message, field: "branch" });
      expect(await receiptCount()).toBe(before);
    } finally {
      await t.db.update(branch).set({ taxBranchCode: "00001" }).where(b1);
    }
    expect(((await (await quote(bill1(), "staff1")).json()) as QuoteRes).ok).toBe(true);
  });

  it("customer_snapshot เก็บเป็น jsonb object (ค้นด้วย ->> ได้ ไม่ใช่ string ซ้อน)", async () => {
    const rows = await t.db.execute<{ kind: string }>(
      sql`select distinct jsonb_typeof(${buyReceipt.customerSnapshot}) as kind from ${buyReceipt}`,
    );
    expect(rows.map((r) => r.kind)).toEqual(["object"]);
  });

  it("อักษรนำเลขที่ของสาขา: PT-RC6910-0002 · ตัวนับเดิมของสาขา · ค้นเจอ · (สาขา, เลขที่) ยังห้ามซ้ำ", async () => {
    const b1 = t.branches["00001"] ?? "";
    const setPrefix = (docPrefix: string | null) => t.db.update(branch).set({ docPrefix }).where(eq(branch.id, b1));
    await setPrefix("PT");
    try {
      const res = await save(bill1(), "staff1");
      expect(res.status).toBe(201);
      expect(((await res.json()) as SavedRes).doc_no).toBe("PT-RC6910-0002"); // ต่อจาก RC6910-0001 ของสาขา
      for (const q of ["PT-RC6910", "pt-rc6910-0002"]) {
        expect((await list(`q=${q}`, "staff1")).items.map((i) => i.doc_no)).toEqual(["PT-RC6910-0002"]);
      }
      // สาขาอื่นไม่มีอักษรนำ
      const other = (await (await save(bill())).json()) as SavedRes;
      expect(other.doc_no).toMatch(/^RC6910-\d{4}$/);

      // ตัวนับถูกตั้งถอยหลัง (ใช้ runbook ผิด) → เลขชน → 409 ไม่บันทึกซ้ำ
      const counter = and(eq(docSequence.branchId, b1), eq(docSequence.prefix, "RC"), eq(docSequence.period, "6910"));
      await t.db.update(docSequence).set({ lastNo: 1 }).where(counter);
      const dup = await save(bill1(), "staff1");
      expect(dup.status).toBe(409);
      expect(await dup.json()).toMatchObject({ field: "doc_no" });
      const [after] = await t.db.select().from(docSequence).where(counter);
      expect(after?.lastNo).toBe(1); // rollback คืนเลข
      await t.db.update(docSequence).set({ lastNo: 2 }).where(counter);
    } finally {
      await setPrefix(null);
    }
    const plain = await save(bill1(), "staff1");
    expect(((await plain.json()) as SavedRes).doc_no).toBe("RC6910-0003");
    expect(await docNos("00001", "6910")).toEqual(["RC6910-0001", "RC6910-0003"]);
  });
});

// ─── สัญญาที่ยังขาดของ /api/buy (รายการบังคับของสกิล api-endpoint) ───────────────────────────────────────
// สาขาปัจจุบันถูกปิด/ถูกถอนสิทธิ์ระหว่าง session (ด่านที่ /gold-price/today พลาด — F3) · mass assignment ของบิลเงิน ·
// PII + เงินเป็น string ของ quote · 201 · 409 · ค้นด้วยเลขบัตรเต็ม · audit บิลย้อนหลังระบุผู้ทำและไม่มีเลขบัตรเต็ม
// database แยกจากชุดบน · ข้อมูลสมมติ: ชื่อขึ้นต้น "ทดสอบ" · เลขบัตรจาก syntheticNationalId() เท่านั้น
// OWASP ASVS 4.0.3 V4.1.5 · V4.2.1 · V5.1.2 · V7.1.4 · API1/API3/API5:2023 · CLAUDE.md กฎ 1 · 4 · 7

describe.skipIf(!available)("ซื้อเข้า — สัญญาที่ยังขาด: สาขาปิด/ถอนสิทธิ์ · mass assignment · PII · audit", () => {
  const TODAY_BE = "2026-10-05"; // 10:00 น. เวลาไทย → งวด RC6910
  const BACKDATE = "2026-10-01";
  const NO_BRANCH = { error: BUY_API_MSG.noBranch, field: "branch" };
  // สาขาปัจจุบันถูกปิด ≠ ยังไม่ได้เลือก (dev 59779b4) — ยังเป็น 403 ชี้ field branch และไม่เขียนอะไร
  const BRANCH_CLOSED = { error: BUY_API_MSG.branchClosed, field: "branch" };
  let t: TestApp;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  let gold = "";
  let buyer = { id: "", nid: "", name: "" };
  let expired = "";
  const knownIds: string[] = [];

  /** มาสก์ที่คาดตาม R13 — เขียนจากนิยาม ไม่เรียก maskNationalId ของ core (oracle อิสระ) */
  const masked = (id: string) => `${id.slice(0, 1)} XXXX XXXXX ${id.slice(10, 12)} ${id.slice(12)}`;
  // ทอง 96.5% 5.860 กรัม — ยอดตามราคาของวัน/สาขา (คิดมือที่ PAY ในชุดบน): กลาง 25,092 · 00001 25,151 · 1 ต.ค. 24,776
  const bill = (over: Record<string, unknown> = {}) => ({
    customer_id: buyer.id,
    lines: [{ metal_id: gold, weight_g: "5.860", purity_percent: "96.5" }],
    payments: cash(PAY.today),
    ...over,
  });
  const quote = (body: unknown, cookie?: string) => t.request("/api/buy/quote", { cookie, body });
  const save = (body: Record<string, unknown>, cookie?: string) =>
    t.request("/api/buy", { cookie, body: { idempotency_key: `buy-gap-${randomUUID()}`, ...body } });
  const switchTo = async (cookie: string, code: string) => {
    const res = await t.request("/api/me/branch", { cookie, body: { branch_id: t.branches[code] } });
    expect(res.status, `สลับไป ${code}`).toBe(200);
  };
  /** ทุกอย่างที่บันทึกบิลเขียน — request ที่ถูกปฏิเสธต้องไม่แตะเลย (รวมตัวนับเลขที่ R9) */
  const writes = async () => ({
    receipts: await t.db.select().from(buyReceipt).orderBy(buyReceipt.id),
    lines: await t.db.select().from(buyLine).orderBy(buyLine.id),
    payments: await t.db.select().from(payment).orderBy(payment.id),
    stock: await t.db.select().from(stockMovement).orderBy(stockMovement.id),
    sequences: await t.db.select().from(docSequence),
    audits: await t.db.select().from(auditLog).orderBy(auditLog.id),
  });

  beforeAll(async () => {
    t = await startTestApp({ now: () => new Date(`${TODAY_BE}T03:00:00Z`) });
    const accounts = [
      { who: "multi", branch: "00000", allow: ["00001"] }, // สาขาหลัก 00000 + มีสิทธิ์ 00001
      { who: "staff", branch: "00000" },
      { who: "staff2", branch: "00002" },
      { who: "manager2", role: "manager" as const, branch: "00002" }, // บิลย้อนหลังได้เฉพาะผู้จัดการขึ้นไป
    ];
    for (const { who, ...a } of accounts) {
      ids[who] = (await t.createUser({ email: `gap-${who}@ong.test`, password: PW, ...a })).id;
      cookies[who] = await t.login(`gap-${who}@ong.test`, PW);
    }
    // ใบรับซื้อต้องมีรหัสสาขาของกรมสรรพากร (ไม่งั้นบันทึกไม่ได้ — BUY_API_MSG.noTaxBranchCode) · รหัสสมมติตาม code
    for (const code of ["00001", "00002"]) {
      await t.db.update(branch).set({ taxBranchCode: code }).where(eq(branch.code, code));
    }
    const [g] = await t.db.select({ id: metal.id }).from(metal).where(eq(metal.code, "gold"));
    gold = g?.id ?? "";
    await t.db.insert(goldPrice).values([
      { date: TODAY_BE, barSell: "67850", barBuy: "67650", jewelryBuy: "64268" },
      { date: BACKDATE, barSell: "67000", barBuy: "66800", jewelryBuy: "63460" },
      { branchId: t.branches["00001"], date: TODAY_BE, barSell: "68000", barBuy: "67800", jewelryBuy: "64410" },
    ]);
    const nid = syntheticNationalId();
    const expiredNid = syntheticNationalId();
    knownIds.push(nid, expiredNid);
    const [a, b] = await t.db
      .insert(customer)
      .values([
        { nationalId: nid, nameTh: testName("ผู้ขายทอง"), cardExpireText: "31/12/2574" },
        { nationalId: expiredNid, nameTh: testName("บัตรหมดอายุ"), cardExpireText: "01/01/2560" }, // R2 บล็อก
      ])
      .returning({ id: customer.id, nameTh: customer.nameTh });
    buyer = { id: a?.id ?? "", nid, name: a?.nameTh ?? "" };
    expired = b?.id ?? "";
  });
  afterAll(async () => {
    await t?.close();
  });

  it("สาขาปัจจุบันถูกปิดระหว่าง session: quote และบันทึก = 403 ชี้ branch · ไม่มีอะไรถูกเขียน (เลขที่ไม่ถูกกิน) · เปิดคืนแล้วบันทึกได้ที่สาขานั้น", async () => {
    const cookie = await t.login("gap-multi@ong.test", PW);
    await switchTo(cookie, "00001");
    const before = await writes();
    await t.db.update(branch).set({ isActive: false }).where(eq(branch.code, "00001"));
    try {
      for (const [what, res] of [
        ["quote", await quote(bill(), cookie)],
        ["บันทึก", await save(bill(), cookie)],
      ] as const) {
        expect(await expectApiError(res, 403, `${what} ตอนสาขาปิด`)).toEqual(BRANCH_CLOSED);
      }
    } finally {
      await t.db.update(branch).set({ isActive: true }).where(eq(branch.code, "00001"));
    }
    expect(await writes()).toEqual(before);

    // positive control: เปิดคืนแล้วบันทึกได้ — ลงสาขา 00001 ด้วยราคาเฉพาะสาขา และได้เลขแรกของงวด (ไม่มีเลขหาย)
    const res = await save(bill({ payments: cash(PAY.branch1) }), cookie);
    expect(res.status).toBe(201);
    const { id, doc_no } = (await res.json()) as { id: string; doc_no: string };
    expect(doc_no).toBe("RC6910-0001");
    const [row] = await t.db.select().from(buyReceipt).where(eq(buyReceipt.id, id));
    expect(row).toMatchObject({ branchId: t.branches["00001"], goldPriceSnapshot: "68000.00", createdBy: ids.multi });
  });

  it("ถูกถอนสิทธิ์สาขาปัจจุบันระหว่าง session: quote และบันทึก = 403 ชี้ branch ทันที · ไม่มีอะไรถูกเขียน", async () => {
    const cookie = await t.login("gap-multi@ong.test", PW);
    await switchTo(cookie, "00001");
    const before = await writes();
    await t.db
      .update(user)
      .set({ allowedBranchIds: [] })
      .where(eq(user.id, ids.multi ?? ""));
    try {
      expect(await expectApiError(await quote(bill(), cookie), 403, "quote หลังถอนสิทธิ์")).toEqual(NO_BRANCH);
      expect(await expectApiError(await save(bill(), cookie), 403, "บันทึกหลังถอนสิทธิ์")).toEqual(NO_BRANCH);
    } finally {
      await t.db
        .update(user)
        .set({ allowedBranchIds: [t.branches["00001"] ?? ""] })
        .where(eq(user.id, ids.multi ?? ""));
    }
    expect(await writes()).toEqual(before);
  });

  it("mass assignment (API3:2023 · ASVS V5.1.2): ช่องที่เซิร์ฟเวอร์กำหนดเอง (สาขา · เลขที่ · ยอด · สถานะ · ผู้บันทึก · PDF · snapshot · ราคาของแถวทุกช่อง) ส่งมาก็ถูกเมิน", async () => {
    const res = await save(
      bill({
        branch_id: t.branches["00002"],
        doc_no: "RC0000-9999",
        total_weight: "0.001",
        total_amount: "1.00",
        status: "void",
        created_by: ids.staff2,
        pdf_status: "ready",
        pdf_key: "receipts/forged.pdf",
        gold_price_snapshot: "1.00",
        customer_snapshot: { national_id: syntheticNationalId(), name_th: testName("ปลอม") },
        // ราคาไม่ได้ส่งมาแล้ว — ยอด/ราคาตั้งต้น/ราคาต่อกรัมที่แนบมาต้องถูกเมิน ระบบคิดจากราคาของวันเอง
        lines: [
          {
            metal_id: gold,
            weight_g: "5.860",
            purity_percent: "96.5",
            amount: "1.00",
            base_price: "1.00",
            unit_price: "1.00",
            gross_amount: "1.00",
            deduct_amount: "25091.00",
            assessed_price_per_g: "1.00",
            assessment_amount: "1.00",
            price_per_g: "1.00",
            line_no: 99,
          },
        ],
      }),
      cookies.staff,
    );
    expect(res.status).toBe(201);
    const { id, doc_no } = (await res.json()) as { id: string; doc_no: string };
    expect(doc_no).toMatch(/^RC6910-\d{4}$/);
    const [row] = await t.db.select().from(buyReceipt).where(eq(buyReceipt.id, id));
    expect(row).toMatchObject({
      branchId: t.branches["00000"],
      docNo: doc_no,
      totalWeight: "5.860",
      totalAmount: "25092.00",
      status: "active",
      createdBy: ids.staff,
      pdfStatus: "pending",
      pdfKey: null,
      goldPriceSnapshot: "67850.00",
    });
    expect(row?.customerSnapshot).toMatchObject({ national_id: buyer.nid, name_th: buyer.name });
    expect(await t.db.select().from(buyLine).where(eq(buyLine.receiptId, id))).toMatchObject([
      {
        lineNo: 1,
        weightG: "5.860",
        purityPercent: "96.500",
        deductPercent: "0.00",
        basePrice: "67650.00",
        assessedPricePerG: "4282.00",
        assessmentAmount: "25092.00",
        amount: "25092.00",
        pricePerG: "4281.91",
      },
    ]);
  });

  it("PII (R13) + เงินเป็น string (กฎ 1): quote · 201 · 409 · ค้นด้วยเลขบัตรเต็ม (ติดกัน · เว้นวรรค · ขีด) · บิลเดี่ยว — ไม่มีเลขบัตรเต็มเลย", async () => {
    const cookie = cookies.staff;
    const preview = await quote(bill(), cookie);
    expect(preview.status).toBe(200);
    const previewText = await preview.text();
    expectNoNationalId(previewText, "POST /api/buy/quote", knownIds);
    expectMoneyAsStrings(JSON.parse(previewText), "POST /api/buy/quote");

    const created = await save(bill(), cookie);
    expect(created.status).toBe(201);
    const createdText = await created.text();
    expectNoNationalId(createdText, "POST /api/buy 201", knownIds);
    const { id } = JSON.parse(createdText) as { id: string };

    const blocked = await expectApiError(await save(bill({ customer_id: expired }), cookie), 409, "บัตรหมดอายุ");
    expectNoNationalId(JSON.stringify(blocked), "POST /api/buy 409", knownIds);
    expectMoneyAsStrings(blocked, "POST /api/buy 409");

    for (const form of [buyer.nid, cardFormat(buyer.nid, " "), cardFormat(buyer.nid, "-")]) {
      const res = await t.request(`/api/buy?q=${encodeURIComponent(form)}`, { cookie });
      expect(res.status, form).toBe(200);
      const text = await res.text();
      expectNoNationalId(text, `GET /api/buy?q=${form}`, knownIds);
      const { items } = JSON.parse(text) as { items: { id: string; customer: { national_id_masked: string } }[] };
      expect(
        items.map((i) => i.id),
        form,
      ).toContain(id);
      for (const item of items) expect(item.customer.national_id_masked, form).toBe(masked(buyer.nid));
    }

    const detail = await t.request(`/api/buy/${id}`, { cookie });
    expect(detail.status).toBe(200);
    const detailText = await detail.text();
    // เลขผู้เสียภาษีของร้าน (นิติบุคคล) มากับบิลใน snapshot ของกิจการ — ไม่ใช่เลขบัตรของบุคคล (PR #68)
    expectNoNationalId(detailText, "GET /api/buy/:id", knownIds, [t.env.COMPANY_TAX_ID]);
    expectMoneyAsStrings(JSON.parse(detailText), "GET /api/buy/:id");
  });

  it("audit (R12): บิลย้อนหลังโดยผู้จัดการพร้อมเหตุผล → buy.backdate แถวเดียว · user_id คือคนเปิดบิล · เหตุผลอยู่ใน diff · audit_log ทั้งตารางไม่มีเลขบัตรเต็ม", async () => {
    const reason = "ทดสอบ ระบบล่ม คีย์ใบเขียนมือ";
    const res = await save(
      bill({ date: BACKDATE, time: "16:30", backdate_reason: reason, payments: cash(PAY.sep30) }), // 1 ต.ค. ราคาเท่า 30 ก.ย. (66,800)
      cookies.manager2,
    );
    expect(res.status).toBe(201);
    const { id, doc_no } = (await res.json()) as { id: string; doc_no: string };
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.rowId, id));
    expect(rows).toEqual([
      expect.objectContaining({ action: "buy.backdate", tableName: "buy_receipt", userId: ids.manager2 }),
    ]);
    expect(rows[0]?.diff).toMatchObject({ doc_no, date: BACKDATE, time: "16:30", entered_on: TODAY_BE, reason });
    const all = await t.db.select().from(auditLog);
    expectNoNationalId(JSON.stringify(all), "audit_log ทั้งตาราง", knownIds);
  });

  // F14 — แก้แล้วใน dev (PR #53 · fix(core): reject thousands separators in weights): quoteBuy ใช้ parser เข้มตัวเดียวกับ F6
  // น้ำหนักรับเฉพาะตัวเลขล้วน ("5,860" ที่ตั้งใจพิมพ์ 5.860 เคยถูกอ่านเป็น 5,860 กรัม) · เดิมเป็น it.fails ("0x5" กรัม = 5 กรัม)
  // ราคาไม่ได้พิมพ์แล้ว (UAT 30 ก.ย. 2569) — ค่าบริสุทธิ์ / หัก % ใช้ parser เข้มแบบเดียวกัน · ยอดชำระยังคั่นหลักพันได้
  it("F14 (แก้แล้ว) — /api/buy/quote: น้ำหนัก · ค่าบริสุทธิ์ · หัก % รับเฉพาะตัวเลขล้วน · ยอดชำระคั่นหลักพันได้ · รูปแบบอื่นถูกปฏิเสธที่ช่องนั้น", async () => {
    const quoteLine = async (
      weight_g: string,
      purity_percent: string,
      deduct_percent = "0",
      paid: string = PAY.today,
    ) => {
      const res = await quote(
        bill({ lines: [{ metal_id: gold, weight_g, purity_percent, deduct_percent }], payments: cash(paid) }),
        cookies.staff,
      );
      const where = `${weight_g} / ${purity_percent} / ${deduct_percent} / ${paid}`;
      expect(res.status, where).toBe(200);
      return {
        where,
        q: (await res.json()) as {
          ok: boolean;
          errors: { field: string }[];
          total_weight: string;
          total_amount: string;
        },
      };
    };
    const rejected: [string, string, string, string][] = [
      ...["0x5", "0b101", "5.86e0", "5_860", "5,860", ".5", "5."].map((w): [string, string, string, string] => [
        "lines.0.weight_g",
        w,
        "96.5",
        "0",
      ]),
      ...["0x60", "9.65e1", "96,5", "96_5", "96.", ".965", "+96.5", "٩٦.٥", "96.5%"].map(
        (p): [string, string, string, string] => ["lines.0.purity_percent", "5.860", p, "0"],
      ),
      ...["0x3", "3e0", "3.0", "+3", "-0", "3%", "๓"].map((d): [string, string, string, string] => [
        "lines.0.deduct_percent",
        "5.860",
        "96.5",
        d,
      ]),
    ];
    for (const [field, weight, purity, deduct] of rejected) {
      const { where, q } = await quoteLine(weight, purity, deduct);
      expect(q.ok, where).toBe(false);
      expect(
        q.errors.map((e) => e.field),
        where,
      ).toContain(field);
      expect(q.total_amount, where).toBe("0.00"); // แถวที่ผิดไม่ถูกนับ
    }
    for (const [purity, paid] of [
      ["96.5", "25092"],
      [" 96.5 ", "25,092"],
      ["96.50", "25,092.00"],
    ] as const) {
      const { where, q } = await quoteLine("5.860", purity, "0", paid);
      expect(q, where).toMatchObject({ ok: true, errors: [], total_weight: "5.860", total_amount: "25092.00" });
    }
  });

  // F15 — routes/buy.ts readJson (c.req.json()) ไม่ดู Content-Type → body JSON ที่ส่งเป็น text/plain (ชนิดที่ฟอร์ม HTML ข้ามเว็บ
  // ส่งได้โดยไม่มี preflight) ถูกรับเหมือน application/json และบันทึกบิลได้จริง · ด่าน Origin (lib/origin.ts) ยังกันข้ามเว็บอยู่
  // จึงเป็นชั้นป้องกันซ้อน (ASVS 4.0.3 V13.2.5 · RFC 9110 §15.5.16) — แบบเดียวกับ F12 ของ /gold-price
  // แก้: ตอบ 415 เมื่อ content-type ไม่ใช่ application/json (แบบ routes/customers.ts ที่ตอบ 415 เมื่อไม่ใช่ multipart)
  // เดิมเป็น it.fails — แก้ใน PR #89 (dev 7d8436e) · ตอนนี้ตรึงพฤติกรรมที่ถูกไว้
  it("F15 — /api/buy/quote และ POST /api/buy ที่ Content-Type ไม่ใช่ application/json (text/plain) → 415", async () => {
    const send = (path: string, body: unknown) =>
      t.app.request(path, {
        method: "POST",
        headers: { cookie: cookies.staff ?? "", origin: "http://localhost:8787", "content-type": "text/plain" },
        body: JSON.stringify(body),
      });
    await expectApiError(await send("/api/buy/quote", bill()), 415, "POST /api/buy/quote text/plain");
    const key = `buy-gap-${randomUUID()}`;
    await expectApiError(await send("/api/buy", { ...bill(), idempotency_key: key }), 415, "POST /api/buy text/plain");
  });
});

// ─── ค่าบริสุทธิ์ · หัก % · ราคาเงิน/แพลตตินั่มต่อกรัม (UAT 30 ก.ย. 2569 · อนุมัติ 2 ต.ค. 2569) ─────────────────────────────
// พนักงานไม่พิมพ์ราคาแล้ว: แถว = โลหะ + ค่าบริสุทธิ์ + หัก % + น้ำหนัก → assessBuyLine ใน @ong/core คิดราคา (ปัดลงทุกขั้น)
// ราคาเงินต่อกรัมตั้งผ่าน PUT /api/gold-price/today (ราคากลาง) จริง ไม่ยัดลง DB · database แยกจากชุดบน
// ตัวเลขทุกตัวคิดมือจากสูตรในสัญญา — ไม่ใช้คำตอบของเซิร์ฟเวอร์เป็นคำเฉลย

describe.skipIf(!available)("ซื้อเข้า — ค่าบริสุทธิ์ · หัก % · ราคาเงิน/แพลตตินั่มต่อกรัม", () => {
  const DAY = "2026-10-05"; // 10:00 น. เวลาไทย
  const AT_10 = new Date(`${DAY}T03:00:00Z`);
  let clock = AT_10;
  let t: TestApp;
  const cookies: Record<string, string> = {};
  const metalIds: Record<string, string> = {};
  let buyer = "";
  const knownIds: string[] = [];
  const INVALID_PURITY = "ค่าบริสุทธิ์ต้องเป็นตัวเลข 1–100 ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 96.5";
  const NO_PURITY = "กรุณากรอกค่าบริสุทธิ์ (%)";
  const INVALID_DEDUCT = "หัก % ต้องเป็นเลขจำนวนเต็ม 0–10";

  const row = (code: string, weight_g: string, purity_percent?: unknown, deduct_percent?: unknown) => ({
    metal_id: metalIds[code],
    weight_g,
    ...(purity_percent === undefined ? {} : { purity_percent }),
    ...(deduct_percent === undefined ? {} : { deduct_percent }),
  });
  const body = (lines: unknown[], payments: unknown[] = []) => ({ customer_id: buyer, lines, payments });
  const quote = async (b: unknown, who = "staff") => {
    const res = await t.request("/api/buy/quote", { cookie: cookies[who], body: b });
    expect(res.status).toBe(200);
    return (await res.json()) as QuoteRes;
  };
  const save = async (b: Record<string, unknown>, key = `pd-${randomUUID()}`, who = "staff") =>
    t.request("/api/buy", { cookie: cookies[who], body: { idempotency_key: key, ...b } });
  const detail = async (id: string, who = "staff") => t.request(`/api/buy/${id}`, { cookie: cookies[who] });
  /** ตั้งราคากลางของวันนี้ผ่าน API จริง (ผู้จัดการ) — bar_sell 67,850 → ทองแท่งรับซื้อ 67,650 */
  const setPrice = async (perGram: Record<string, string | null>) => {
    const res = await t.request("/api/gold-price/today", {
      method: "PUT",
      cookie: cookies.mgr,
      body: { bar_sell: "67850", ...perGram },
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as { bar_buy: string; silver_per_g: string | null; platinum_per_g: string | null };
  };

  beforeAll(async () => {
    t = await startTestApp({ now: () => clock });
    for (const [who, a] of [
      ["staff", { branch: "00000" }],
      ["staff2", { branch: "00002" }],
      ["mgr", { branch: "00000", role: "manager" as const }],
    ] as const) {
      await t.createUser({ email: `pd-${who}@ong.test`, password: PW, ...a });
      cookies[who] = await t.login(`pd-${who}@ong.test`, PW);
    }
    for (const m of await t.db.select().from(metal)) metalIds[m.code] = m.id;
    // วันก่อนหน้ามีราคาทอง (ด่านกันพิมพ์ผิดเทียบได้) แต่ไม่มีราคาเงิน
    await t.db.insert(goldPrice).values({ date: "2026-10-01", barSell: "67000", barBuy: "66800", jewelryBuy: "63460" });
    const set = await setPrice({ silver_per_g: "45" });
    expect(set).toMatchObject({ bar_buy: "67650.00", silver_per_g: "45.00", platinum_per_g: null });
    const nid = syntheticNationalId();
    knownIds.push(nid);
    const [c] = await t.db
      .insert(customer)
      .values({ nationalId: nid, nameTh: testName("ผู้ขายเงิน"), cardExpireText: "31/12/2574" })
      .returning({ id: customer.id });
    buyer = c?.id ?? "";
  });
  afterAll(async () => {
    await t?.close();
  });

  // ---------- ตรวจทีละช่อง ----------

  it.each([
    ["ว่าง", "", NO_PURITY],
    ["ช่องว่างล้วน", "   ", NO_PURITY],
    ["null", null, NO_PURITY],
    ["ไม่ส่ง", undefined, NO_PURITY],
    ["0", "0", INVALID_PURITY],
    ["0.99 (ต่ำกว่า 1)", "0.99", INVALID_PURITY],
    ["100.01", "100.01", INVALID_PURITY],
    ["101", "101", INVALID_PURITY],
    ["ทศนิยม 3 ตำแหน่ง", "96.555", INVALID_PURITY],
    ["ติดลบ", "-96.5", INVALID_PURITY],
    ["ตัวอักษร", "abc", INVALID_PURITY],
    ["จุลภาคแทนจุด", "96,5", INVALID_PURITY],
    ["เลขยกกำลัง", "1e2", INVALID_PURITY],
  ])("ค่าบริสุทธิ์%s → แจ้งที่ lines.0.purity_percent แถวไม่ถูกนับ", async (_name, purity, message) => {
    const q = await quote(body([row("gold", "5.860", purity)]));
    expect(q.errors).toEqual([{ field: "lines.0.purity_percent", message }]);
    expect(q).toMatchObject({ ok: false, lines: [], total_amount: "0.00" });
  });

  it.each([
    ["11", "11"],
    ["ทศนิยม", "10.5"],
    ["3.0 (ต้องเป็นเลขเต็มล้วน)", "3.0"],
    ["ติดลบ", "-1"],
    ["100", "100"],
    ["ตัวอักษร", "abc"],
  ])("หัก % %s → แจ้งที่ lines.0.deduct_percent แถวไม่ถูกนับ", async (_name, deduct) => {
    const q = await quote(body([row("gold", "5.860", "96.5", deduct)]));
    expect(q.errors).toEqual([{ field: "lines.0.deduct_percent", message: INVALID_DEDUCT }]);
    expect(q).toMatchObject({ ok: false, lines: [], total_amount: "0.00" });
  });

  // ทอง 96.5% 5.860 กรัม ⌊4282 × 5.86⌋ = 25,092 ก่อนหัก
  it.each([
    ["ไม่ส่ง", undefined, "0", "0.00", "25092.00"],
    ["null", null, "0", "0.00", "25092.00"],
    ["ว่าง", "", "0", "0.00", "25092.00"],
    ["0", "0", "0", "0.00", "25092.00"],
    ["1", "1", "1", "251.00", "24841.00"], // ⌊25092 × 0.99 = 24841.08⌋
    ["3 มีช่องว่าง", " 3 ", "3", "753.00", "24339.00"], // ⌊25092 × 0.97 = 24339.24⌋
    ["03", "03", "3", "753.00", "24339.00"],
    ["10 (สูงสุด)", "10", "10", "2510.00", "22582.00"], // ⌊25092 × 0.9 = 22582.8⌋
  ])("หัก % %s → %s · หัก %s · สุทธิ %s", async (_name, deduct, shown, deducted, amount) => {
    const q = await quote(body([row("gold", "5.860", "96.5", deduct)], cash(amount)));
    expect(q.errors).toEqual([]);
    expect(q.lines[0]).toMatchObject({
      deduct_percent: shown,
      gross_amount: "25092.00",
      deduct_amount: deducted,
      amount,
    });
  });

  it.each([
    ["1 (ต่ำสุด)", "1", "1.00", "44.00", "257.00"], // ⌊4437.84 × 0.01 = 44.3784⌋ · ⌊44 × 5.86 = 257.84⌋
    ["100 (สูงสุด)", "100", "100.00", "4437.00", "26000.00"], // ⌊4437 × 5.86 = 26000.82⌋
    ["96.55 (2 ตำแหน่ง)", "96.55", "96.55", "4284.00", "25104.00"], // ⌊4284.73452⌋ · ⌊4284 × 5.86 = 25104.24⌋
    ["96.50", "96.50", "96.50", "4282.00", "25092.00"],
  ])("ค่าบริสุทธิ์ %s ใช้ได้ → %s%", async (_name, purity, shown, unit, amount) => {
    const q = await quote(body([row("gold", "5.860", purity)], cash(amount)));
    expect(q.errors).toEqual([]);
    expect(q.lines[0]).toMatchObject({ purity_percent: shown, unit_price: unit, amount });
  });

  it("แถวผิดหลายช่อง: แจ้งทุกช่องพร้อมกันตามลำดับ (โลหะ · น้ำหนัก · บริสุทธิ์ · หัก %) · แถวที่ถูกยังคิดยอด", async () => {
    const q = await quote(
      body(
        [{ metal_id: NO_UUID, weight_g: "0", purity_percent: "", deduct_percent: "11" }, row("gold", "5.860", "96.5")],
        cash(PAY.today),
      ),
    );
    expect(q.errors).toEqual([
      { field: "lines.0.metal_id", message: BUY_MSG.unknownMetal },
      { field: "lines.0.weight_g", message: BUY_MSG.weightPositive },
      { field: "lines.0.purity_percent", message: NO_PURITY },
      { field: "lines.0.deduct_percent", message: INVALID_DEDUCT },
    ]);
    expect(q.lines.map((l) => [l.index, l.amount])).toEqual([[1, "25092.00"]]);
    expect(q).toMatchObject({ total_weight: "5.860", total_amount: "25092.00", balance: "0.00" });

    // POST ตอบ 409 ด้วย error แรก + ผล quote ทั้งก้อน · ไม่บันทึก
    const before = (await t.db.select({ id: buyReceipt.id }).from(buyReceipt)).length;
    const res = await save(
      body(
        [{ metal_id: NO_UUID, weight_g: "0", purity_percent: "", deduct_percent: "11" }, row("gold", "5.860", "96.5")],
        cash(PAY.today),
      ),
    );
    expect(await expectApiError(res, 409, "POST /api/buy แถวผิด")).toMatchObject({
      field: "lines.0.metal_id",
      errors: q.errors,
    });
    expect((await t.db.select({ id: buyReceipt.id }).from(buyReceipt)).length).toBe(before);
  });

  // ---------- ราคาเงิน/แพลตตินั่มต่อกรัม ----------

  it('เงิน/แพลตตินั่ม: ราคาต่อกรัมจาก PUT /gold-price/today · ไม่ส่ง = คงค่าเดิม · null/"" = ล้าง → แถวคิดราคาไม่ได้', async () => {
    // เงิน 45 บาท/กรัม (ตั้งใน beforeAll): ⌊45 × 0.925 = 41.625⌋ = 41 · ⌊41 × 271.56 = 11133.96⌋ = 11,133
    const silver = await quote(body([row("silver", "271.56", "92.5")], cash("11133")));
    expect(silver.errors).toEqual([]);
    expect(silver.lines[0]).toMatchObject({ base_price: "45.00", unit_price: "41.00", amount: "11133.00" });

    const platinumLine = body([row("platinum", "2.5", "95", "2")], cash("2327"));
    expect((await quote(platinumLine)).errors).toEqual([
      { field: "lines.0.metal_id", message: "ยังไม่ได้ตั้งราคาแพลตตินั่มของวันนี้" },
      { field: "payments", message: BUY_MSG.overpaid }, // แถวคิดไม่ได้ = ยอด 0 แต่จ่ายมา 2,327
    ]);

    // ตั้งแพลตตินั่ม (ไม่ส่งเงิน = เงินคงเดิม)
    expect(await setPrice({ platinum_per_g: "1000.50" })).toMatchObject({
      silver_per_g: "45.00",
      platinum_per_g: "1000.50",
    });
    // ⌊1000.50 × 0.95 = 950.475⌋ = 950 · ⌊950 × 2.5⌋ = 2375 · ⌊2375 × 0.98 = 2327.5⌋ = 2327 · 2327 ÷ 2.5 = 930.80
    const platinum = await quote(platinumLine);
    expect(platinum.errors).toEqual([]);
    expect(platinum.lines).toEqual([
      {
        index: 0,
        metal_id: metalIds.platinum,
        weight_g: "2.500",
        purity_percent: "95.00",
        deduct_percent: "2",
        base_price: "1000.50",
        unit_price: "950.00",
        gross_amount: "2375.00",
        deduct_amount: "48.00",
        amount: "2327.00",
        price_per_g: "930.80",
      },
    ]);

    // ล้าง: null (แพลตตินั่ม) · "" (เงิน) → แถวของโลหะนั้นคิดไม่ได้อีก
    expect(await setPrice({ platinum_per_g: null, silver_per_g: "" })).toMatchObject({
      silver_per_g: null,
      platinum_per_g: null,
    });
    const cleared = await quote(body([row("silver", "271.56", "92.5"), row("platinum", "2.5", "95", "2")]));
    expect(cleared.errors).toEqual([
      { field: "lines.0.metal_id", message: "ยังไม่ได้ตั้งราคาเงินของวันนี้" },
      { field: "lines.1.metal_id", message: "ยังไม่ได้ตั้งราคาแพลตตินั่มของวันนี้" },
    ]);
    expect(cleared).toMatchObject({ lines: [], total_amount: "0.00" });

    expect(await setPrice({ silver_per_g: "45.00" })).toMatchObject({ silver_per_g: "45.00", platinum_per_g: null });
  });

  it("วันที่ยังไม่มีราคาของวันเลย: ทอง/นากแจ้งที่ gold_price ครั้งเดียว (ไม่มี error ต่อแถว) · เงิน/แพลตตินั่มแจ้งที่แถว", async () => {
    clock = new Date("2026-10-06T03:00:00Z"); // วันใหม่ ยังไม่มีใครตั้งราคา
    try {
      const q = await quote(
        body([
          row("gold", "5.860", "96.5"),
          row("nak", "3.000", "75"),
          row("silver", "100", "92.5"),
          row("platinum", "1", "95"),
        ]),
      );
      expect(q.errors).toEqual([
        { field: "gold_price", message: BUY_MSG.noGoldPrice },
        { field: "lines.2.metal_id", message: "ยังไม่ได้ตั้งราคาเงินของวันนี้" },
        { field: "lines.3.metal_id", message: "ยังไม่ได้ตั้งราคาแพลตตินั่มของวันนี้" },
      ]);
      expect(q).toMatchObject({ ok: false, gold_price_snapshot: null, lines: [], total_amount: "0.00" });
    } finally {
      clock = AT_10;
    }
  });

  // ---------- บันทึก · อ่าน ----------

  it("บันทึก: คอลัมน์ราคาที่ระบบคิดลง buy_line ครบ · GET /:id คืนรูปเดียวกับ quote · ราคาของวันเปลี่ยนทีหลังไม่กระทบบิลเดิม", async () => {
    // ทอง 96.5% 10 ก. หัก 3 = 41,535 · เงิน 92.5% 271.56 ก. = 11,133 → 52,668
    const b = body([row("gold", "10", "96.5", "3"), row("silver", "271.56", "92.5")], cash("52668"));
    const q = await quote(b);
    expect(q).toMatchObject({ ok: true, total_weight: "281.560", total_amount: "52668.00", avg_price_per_g: "187.06" });

    const res = await save(b);
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as SavedRes;
    const stored = await t.db
      .select({
        lineNo: buyLine.lineNo,
        weightG: buyLine.weightG,
        purityPercent: buyLine.purityPercent,
        deductPercent: buyLine.deductPercent,
        basePrice: buyLine.basePrice,
        assessedPricePerG: buyLine.assessedPricePerG,
        assessmentAmount: buyLine.assessmentAmount,
        amount: buyLine.amount,
        pricePerG: buyLine.pricePerG,
      })
      .from(buyLine)
      .where(eq(buyLine.receiptId, id))
      .orderBy(asc(buyLine.lineNo));
    expect(stored).toEqual([
      {
        lineNo: 1,
        weightG: "10.000",
        purityPercent: "96.500",
        deductPercent: "3.00",
        basePrice: "67650.00",
        assessedPricePerG: "4282.00",
        assessmentAmount: "42820.00",
        amount: "41535.00",
        pricePerG: "4153.50",
      },
      {
        lineNo: 2,
        weightG: "271.560",
        purityPercent: "92.500",
        deductPercent: "0.00",
        basePrice: "45.00",
        assessedPricePerG: "41.00",
        assessmentAmount: "11133.00",
        amount: "11133.00",
        pricePerG: "41.00",
      },
    ]);
    const [receipt] = await t.db.select().from(buyReceipt).where(eq(buyReceipt.id, id));
    expect(receipt).toMatchObject({ totalWeight: "281.560", totalAmount: "52668.00" });

    const expectedLines = [
      {
        line_no: 1,
        metal: { id: metalIds.gold, code: "gold", name_th: "ทอง" },
        weight_g: "10.000",
        purity_percent: "96.50",
        deduct_percent: "3",
        base_price: "67650.00",
        unit_price: "4282.00",
        gross_amount: "42820.00",
        amount: "41535.00",
        price_per_g: "4153.50",
      },
      {
        line_no: 2,
        metal: { id: metalIds.silver, code: "silver", name_th: "เงิน" },
        weight_g: "271.560",
        purity_percent: "92.50",
        deduct_percent: "0",
        base_price: "45.00",
        unit_price: "41.00",
        gross_amount: "11133.00",
        amount: "11133.00",
        price_per_g: "41.00",
      },
    ];
    const first = await detail(id);
    expect(first.status).toBe(200);
    const text = await first.text();
    expectNoNationalId(text, "GET /api/buy/:id", knownIds, [t.env.COMPANY_TAX_ID]);
    const parsed = JSON.parse(text) as DetailRes;
    expectMoneyAsStrings(parsed, "GET /api/buy/:id");
    expect(parsed.lines).toEqual(expectedLines);
    expect(parsed).toMatchObject({ total_weight: "281.560", total_amount: "52668.00", avg_price_per_g: "187.06" });

    // ร้านแก้ราคาเงินของวันนี้หลังบันทึก — บิลเดิมยังเป็นราคาที่คิดตอนบันทึก (ราคาตั้งต้นติดแถวไว้)
    await setPrice({ silver_per_g: "46.00" });
    try {
      // บิลใหม่ใช้ราคาใหม่: ⌊46 × 0.925 = 42.55⌋ = 42 · ⌊42 × 271.56 = 11405.52⌋ = 11,405
      expect((await quote(body([row("silver", "271.56", "92.5")], cash("11405")))).lines[0]).toMatchObject({
        base_price: "46.00",
        amount: "11405.00",
      });
      expect(((await (await detail(id)).json()) as DetailRes).lines).toEqual(expectedLines);
    } finally {
      await setPrice({ silver_per_g: "45.00" });
    }

    // scoping: ผู้ใช้สาขาอื่นเปิดบิลนี้ไม่ได้ (404 ไม่บอกว่ามีอยู่)
    expect((await detail(id, "staff2")).status).toBe(404);
  });

  it("บิลก่อนมีค่าบริสุทธิ์ (แถวเก่าไม่มีคอลัมน์ใหม่) → GET คืน null ทั้งชุด · ยอดเดิมไม่เปลี่ยน · กดซ้ำด้วย key เดิม = 409 พร้อมบิลเดิม", async () => {
    const key = `pd-legacy-${randomUUID()}`;
    const b = body([row("gold", "5.860", "96.5")], cash(PAY.today));
    const res = await save(b, key);
    expect(res.status).toBe(201);
    const saved = (await res.json()) as SavedRes;
    // แถวที่ย้ายมาจากระบบเดิม / บันทึกก่อน migration 0007 = คอลัมน์ราคาที่ระบบคิดเป็น null ทั้งหมด
    await t.db
      .update(buyLine)
      .set({
        purityPercent: null,
        deductPercent: null,
        basePrice: null,
        assessedPricePerG: null,
        assessmentAmount: null,
      })
      .where(eq(buyLine.receiptId, saved.id));

    const d = (await (await detail(saved.id)).json()) as DetailRes;
    expect(d.lines).toEqual([
      {
        line_no: 1,
        metal: { id: metalIds.gold, code: "gold", name_th: "ทอง" },
        weight_g: "5.860",
        purity_percent: null,
        deduct_percent: null,
        base_price: null,
        unit_price: null,
        gross_amount: null,
        amount: "25092.00",
        price_per_g: "4281.91",
      },
    ]);
    expect(d).toMatchObject({ total_amount: "25092.00" });
    expectMoneyAsStrings(d, "GET /api/buy/:id (บิลเก่า)");

    // แถวเก่าไม่มีค่าบริสุทธิ์ให้เทียบ → เนื้อบิลใหม่ไม่มีทางตรง = 409 (ไม่สร้างบิลซ้ำ ไม่ตอบ 200 มั่ว)
    const again = await save(b, key);
    expect(await expectApiError(again, 409, "กดซ้ำบิลเก่า")).toEqual({
      error: BUY_API_MSG.keyReused,
      field: "idempotency_key",
      existing: { id: saved.id, doc_no: saved.doc_no },
    });
    expect(await t.db.select().from(buyReceipt).where(eq(buyReceipt.idempotencyKey, key))).toHaveLength(1);
    expect((await detail(saved.id, "staff2")).status).toBe(404);
  });

  it("idempotency เทียบค่าบริสุทธิ์และหัก % (ไม่ใช่ยอด): ส่งซ้ำ % เดิม = 200 · % ต่าง = 409 พร้อมบิลเดิม", async () => {
    const key = `pd-replay-${randomUUID()}`;
    const first = await save(body([row("gold", "10", "96.5", "3")], cash("41535")), key);
    expect(first.status).toBe(201);
    const saved = (await first.json()) as SavedRes;

    const same = await save(body([row("gold", "10.000", "96.50", "3")], cash("41,535.00")), key);
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual(saved);

    for (const [name, line] of [
      ["บริสุทธิ์ต่าง", row("gold", "10", "96.51", "3")], // ⌊4282.959⌋ = 4282 → ยอดเท่าเดิม 41,535
      ["หัก % ต่าง", row("gold", "10", "96.5", "2")],
      ["ไม่หัก", row("gold", "10", "96.5")],
    ] as const) {
      const res = await save(body([line], cash("41535")), key);
      expect({ name, status: res.status }).toEqual({ name, status: 409 });
      expect(await res.json()).toEqual({
        error: BUY_API_MSG.keyReused,
        field: "idempotency_key",
        existing: { id: saved.id, doc_no: saved.doc_no },
      });
    }
    expect(await t.db.select().from(buyReceipt).where(eq(buyReceipt.idempotencyKey, key))).toHaveLength(1);
  });
});
