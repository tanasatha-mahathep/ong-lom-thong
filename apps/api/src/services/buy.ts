import {
  D,
  PAYMENT_METHODS,
  type QuoteBuyResult,
  type QuoteError,
  ZERO,
  avgPricePerG,
  businessDate,
  businessTime,
  cardStatus,
  fmtMoney,
  fmtWeight,
  isPaymentMethod,
  maskNationalId,
  quoteBuy,
} from "@ong/core";
import {
  type CustomerSnapshot,
  type Db,
  type Role,
  auditLog,
  branch,
  buyLine,
  buyReceipt,
  type customer,
  metal,
  payment,
  stockMovement,
  user,
} from "@ong/db";
import { type SQL, and, asc, desc, eq, exists, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type BranchRef, type Viewer, currentBranch, forUser } from "../lib/scope";
import { UNUSABLE_CHARS_MSG, isCleanText } from "../lib/text";
import { escapeLike, findCustomer } from "./customers";
import { type CompanyInfo, captureCompanySnapshot } from "./receiptPdf";
import { type TodayPrice, priceForBranch } from "./goldPrice";

export const BUY_API_MSG = {
  noBranch: "ยังไม่ได้เลือกสาขาที่ทำงาน",
  noTaxBranchCode: "สาขานี้ยังไม่ได้ตั้งรหัสสาขาของกรมสรรพากร — ติดต่อผู้ดูแลระบบ",
  futureDate: "วันที่ต้องไม่เกินวันนี้",
  backdateRole: "เปิดบิลย้อนหลังได้เฉพาะผู้จัดการขึ้นไป",
  backdateWindow: "ย้อนหลังได้ไม่เกิน 7 วัน",
  backdateReason: "กรุณาระบุเหตุผลที่บันทึกย้อนหลัง",
  backdateReasonShort: "เหตุผลที่บันทึกย้อนหลังต้องยาวอย่างน้อย 5 ตัวอักษร",
  backdateTime: "บิลย้อนหลังต้องระบุเวลา",
  futureTime: "เวลาต้องไม่เกินเวลาปัจจุบัน",
  unknownMetal: "ไม่พบประเภทโลหะ",
  keyTaken: "idempotency_key นี้ถูกใช้แล้ว",
  keyReused: "idempotency_key นี้ใช้กับบิลอื่นแล้ว",
  docNoTaken: "เลขที่เอกสารชนกับบิลที่มีอยู่แล้ว — แจ้งผู้ดูแลระบบตรวจตัวนับเลขที่ (doc_sequence)",
  noGoldPriceOn: (isoDate: string) => `ยังไม่ได้ตั้งราคาทองของวันที่ ${beDate(isoDate)}`,
} as const;

// บิลย้อนหลัง (คีย์ใบเขียนมือหลังระบบล่ม · spec §11) — เจ้าของกำหนด 28 ก.ย.: ผู้จัดการขึ้นไป · ไม่เกิน 7 วัน · ต้องมีเหตุผล
const BACKDATE_ROLES: readonly Role[] = ["manager", "admin"];
const BACKDATE_MAX_DAYS = 7;
const BACKDATE_REASON_MIN = 5;

/** วันที่ ISO เลื่อนไป n วันตามปฏิทิน */
const shiftDate = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** "2026-09-30" → "30/09/2569" (วันที่แบบที่ร้านใช้ — ใช้ในข้อความเท่านั้น) */
const beDate = (iso: string) => {
  const [y = "", m = "", d = ""] = iso.split("-");
  return `${d}/${m}/${Number(y) + 543}`;
};

/** error ที่ route แปลงเป็น HTTP ได้ตรง ๆ — extra = ข้อมูลเพิ่มใน body (เช่นผล quote ตอน 409) */
export class BuyError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly status: 400 | 403 | 409,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// ---------- body ----------

// เงิน/น้ำหนักรับเป็น string เท่านั้น — ตัวเลข JSON (float) = 400 (CLAUDE.md กฎ 1) · ตรวจค่าต่อใน quoteBuy
const decimalText = z.string({ error: "ต้องส่งเป็นข้อความตัวเลข" }).max(32, "ตัวเลขยาวเกินไป");
const optionalText = (max: number, label: string) =>
  z
    .string({ error: `${label}ต้องเป็นข้อความ` })
    .trim()
    .max(max, `${label}ยาวเกิน ${max} ตัวอักษร`)
    .refine(isCleanText, UNUSABLE_CHARS_MSG)
    .nullish()
    .transform((v) => v || null);

/** วันที่ "YYYY-MM-DD" ที่มีจริงในปฏิทิน ตั้งแต่ปี 2000 — ปี 0000 ผ่านรูปแบบแต่ Postgres ปฏิเสธ (เคยเป็น 500) */
const isoDate = (label: string) =>
  z.iso
    .date(`${label}ต้องเป็นรูปแบบ YYYY-MM-DD`)
    .refine((d) => d >= "2000-01-01", `${label}ต้องตั้งแต่ปี ค.ศ. 2000 (พ.ศ. 2543)`);

/** ช่องที่ฟอร์มส่งมาว่าง ("" · ช่องว่างล้วน · null) = ไม่ได้กรอก — quote ตอบ ok:false ต่อช่อง ไม่ใช่ 400 */
const blankAsAbsent = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === null || (typeof v === "string" && v.trim() === "") ? undefined : v), schema.optional());

const LineBody = z.object({
  // โลหะที่ไม่รู้จักตรวจใน prepareBuy (ตอบเป็น error ของแถว ไม่ใช่ 400)
  metal_id: z.string({ error: "กรุณาเลือกประเภทโลหะ" }).max(64, "metal_id ไม่ถูกต้อง"),
  weight_g: decimalText,
  amount: decimalText,
});

const PaymentBody = z.object({
  // วิธีที่ไม่รู้จักตรวจใน quoteBuy (PAYMENT_METHODS)
  method: z.string({ error: "กรุณาเลือกประเภทเงินที่ชำระ" }).max(32, "กรุณาเลือกประเภทเงินที่ชำระ"),
  bank: optionalText(100, "ชื่อธนาคาร"),
  amount: decimalText,
});

/** payload ของ POST /buy/quote — POST /buy ใช้ตัวนี้ + ช่องของหัวบิล (SaveBody) */
export const QuoteBody = z.object(
  {
    date: blankAsAbsent(isoDate("วันที่")),
    customer_id: blankAsAbsent(z.uuid("customer_id ไม่ถูกต้อง")),
    lines: z.array(LineBody, { error: "ต้องส่ง lines เป็นรายการ" }).max(50, "รายการในบิลเกิน 50 แถว — แยกเป็นหลายบิล"),
    payments: z
      .array(PaymentBody, { error: "ต้องส่ง payments เป็นรายการ" })
      .max(10, "วิธีชำระเงินเกิน 10 รายการต่อบิล"),
    // บังคับเฉพาะบิลย้อนหลัง (ตรวจใน prepareBuy) · บิลวันนี้ไม่ใช้
    backdate_reason: optionalText(500, "เหตุผลที่บันทึกย้อนหลัง"),
  },
  { error: "ต้องส่งข้อมูลเป็น JSON object" },
);
export type QuoteBody = z.infer<typeof QuoteBody>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;

export const SaveBody = QuoteBody.extend({
  time: blankAsAbsent(z.string({ error: "เวลาต้องเป็นรูปแบบ HH:MM" }).regex(TIME, "เวลาต้องเป็นรูปแบบ HH:MM")),
  detail: optionalText(2000, "รายละเอียด"),
  full_tax: z.boolean({ error: "full_tax ต้องเป็น true หรือ false" }).default(false),
  idempotency_key: z
    .string({ error: "ต้องมี idempotency_key" })
    .regex(IDEMPOTENCY_KEY, "idempotency_key ต้องยาว 16–128 ตัวอักษร (A-Z a-z 0-9 _ -)"),
});
export type SaveBody = z.infer<typeof SaveBody>;

// ---------- quote (ฟังก์ชันเดียวกันทั้ง preview และบันทึก) ----------

type CustomerRow = typeof customer.$inferSelect;

export interface PreparedBuy {
  branch: BranchRef;
  /** วันทำการตามเวลาไทย */
  today: string;
  /** วันที่ของบิล (ย้อนหลังได้ · ห้ามเกินวันนี้) */
  date: string;
  price: TodayPrice | null;
  customer: CustomerRow | null;
  quote: QuoteBuyResult;
  errors: QuoteError[];
  ok: boolean;
}

/**
 * ขั้นเดียวที่ทั้ง POST /buy/quote และ POST /buy เรียก (CLAUDE.md กฎ 2) — ตัวเลขทั้งหมดมาจาก quoteBuy() ใน @ong/core
 * ส่วนที่ต้องอ่าน DB (สาขา · ราคาทองของวันบิล · ลูกค้า · โลหะ) ทำที่นี่แล้วต่อ error เข้ากับผลของ quoteBuy
 */
const quoteLines = (body: QuoteBody) =>
  body.lines.map((l) => ({ metalId: l.metal_id, weightG: l.weight_g, amount: l.amount }));

export async function prepareBuy(db: Db, viewer: Viewer, body: QuoteBody, now: Date): Promise<PreparedBuy> {
  const where = currentBranch(viewer, await forUser(db, viewer));
  if (!where) throw new BuyError(BUY_API_MSG.noBranch, "branch", 403);

  const today = businessDate(now);
  // ย้อนหลังได้ (คีย์ใบเขียนมือหลังระบบล่ม · spec §11) — ราคาทองของวันนั้นต้องมี · อนาคตไม่ได้
  const date = body.date ?? today;
  const [price, customerRow, metals, [head]] = await Promise.all([
    priceForBranch(db, date, where.id),
    body.customer_id ? findCustomer(db, body.customer_id) : null,
    db.select({ id: metal.id }).from(metal),
    db.select({ taxBranchCode: branch.taxBranchCode }).from(branch).where(eq(branch.id, where.id)),
  ]);

  const quote = quoteBuy({
    lines: quoteLines(body),
    payments: body.payments.map((p) => ({ method: p.method, bank: p.bank, amount: p.amount })),
    // สถานะบัตรคิด ณ วันที่ของบิล — บิลย้อนหลังใช้บัตรที่ยังไม่หมดอายุในวันนั้นได้
    customer: customerRow ? { id: customerRow.id, cardStatus: cardStatus(customerRow.cardExpireText, date) } : null,
    goldPriceSet: price !== null,
  });

  const known = new Set(metals.map((m) => m.id));
  const errors: QuoteError[] = [
    // ไม่มีรหัสสาขาของกรมสรรพากร = ออก PDF เก็บถาวรไม่ได้ตลอดไป (หัวใบถูก snapshot ตอนบันทึก · R15) → ห้ามขายตั้งแต่แรก
    ...(head?.taxBranchCode?.trim() ? [] : [{ field: "branch", message: BUY_API_MSG.noTaxBranchCode }]),
    ...dateErrors(viewer, body, date, today),
    // ข้อความของ core พูดถึง "วันนี้" — บิลย้อนหลังบอกวันที่ที่ขาดราคาให้ชัด
    ...quote.errors.map((e) =>
      e.field === "gold_price" && date !== today ? { ...e, message: BUY_API_MSG.noGoldPriceOn(date) } : e,
    ),
    ...body.lines.flatMap((l, i) =>
      known.has(l.metal_id) ? [] : [{ field: `lines.${i}.metal_id`, message: BUY_API_MSG.unknownMetal }],
    ),
  ];
  return { branch: where, today, date, price, customer: customerRow, quote, errors, ok: errors.length === 0 };
}

/** วันที่ของบิล: อนาคตไม่ได้ · ย้อนหลังได้เฉพาะผู้จัดการขึ้นไป ไม่เกิน 7 วัน และต้องมีเหตุผล (ลง audit) */
function dateErrors(viewer: Viewer, body: QuoteBody, date: string, today: string): QuoteError[] {
  if (date > today) return [{ field: "date", message: BUY_API_MSG.futureDate }];
  if (date === today) return [];
  if (!BACKDATE_ROLES.includes(viewer.role)) return [{ field: "date", message: BUY_API_MSG.backdateRole }];
  const errors: QuoteError[] = [];
  if (date < shiftDate(today, -BACKDATE_MAX_DAYS)) errors.push({ field: "date", message: BUY_API_MSG.backdateWindow });
  const reason = body.backdate_reason;
  if (!reason) errors.push({ field: "backdate_reason", message: BUY_API_MSG.backdateReason });
  else if (reason.length < BACKDATE_REASON_MIN) {
    errors.push({ field: "backdate_reason", message: BUY_API_MSG.backdateReasonShort });
  }
  return errors;
}

/** ผลของ POST /buy/quote (และแนบกับ 409 ของ POST /buy) — เงิน/น้ำหนักเป็น string */
export const quoteJson = (p: PreparedBuy) => ({
  ok: p.ok,
  errors: p.errors,
  date: p.date,
  branch: { id: p.branch.id, code: p.branch.code, name: p.branch.name },
  gold_price_snapshot: p.price?.barSell ?? null,
  lines: p.quote.lines.map((l) => ({
    index: l.index,
    metal_id: l.metalId,
    weight_g: l.weightG,
    amount: l.amount,
    price_per_g: l.pricePerG,
  })),
  total_weight: p.quote.totalWeight,
  total_amount: p.quote.totalAmount,
  avg_price_per_g: p.quote.avgPricePerG,
  paid: p.quote.paid,
  balance: p.quote.balance,
});

// ---------- บันทึก ----------

export interface SavedBuy {
  id: string;
  doc_no: string;
  pdf_status: string;
}

const snapshotOf = (c: CustomerRow): CustomerSnapshot => ({
  national_id: c.nationalId,
  name_th: c.nameTh,
  name_en: c.nameEn,
  birthday_text: c.birthdayText,
  religion: c.religion,
  address: c.address,
  card_issue_text: c.cardIssueText,
  card_expire_text: c.cardExpireText,
  mobile: c.mobile,
  phone2: c.phone2,
  photo_key: c.photoKey,
});

/** error ของ Postgres (drizzle ห่อไว้ใน cause) */
const pgError = (e: unknown): { code?: string; constraint_name?: string } | null => {
  for (let cur: unknown = e, depth = 0; cur && depth < 3; depth++) {
    const err = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof err.code === "string") return err as { code: string; constraint_name?: string };
    cur = err.cause;
  }
  return null;
};

/**
 * key เดิม + ผู้ใช้คนเดิม + เนื้อบิลเดิมทั้งใบ = คำตอบเดิม (กดซ้ำ/เน็ตหลุด)
 * key ของคนอื่น = 409 (ไม่บอกว่าเป็นบิลไหน) · เนื้อบิลต่าง = 409 พร้อม existing {id, doc_no} ให้จอเปิดบิลที่บันทึกแล้ว
 */
async function findReplay(db: Db, viewer: Viewer, body: SaveBody, now: Date): Promise<SavedBuy | null> {
  const [row] = await db
    .select({
      id: buyReceipt.id,
      docNo: buyReceipt.docNo,
      pdfStatus: buyReceipt.pdfStatus,
      by: buyReceipt.createdBy,
      customerId: buyReceipt.customerId,
      date: buyReceipt.date,
      time: buyReceipt.time,
      detail: buyReceipt.detail,
      fullTax: buyReceipt.fullTax,
    })
    .from(buyReceipt)
    .where(eq(buyReceipt.idempotencyKey, body.idempotency_key))
    .limit(1);
  if (!row) return null;
  if (row.by !== viewer.userId) throw new BuyError(BUY_API_MSG.keyTaken, "idempotency_key", 409);
  const [lines, payments] = await Promise.all([
    db
      .select({ metalId: buyLine.metalId, weightG: buyLine.weightG, amount: buyLine.amount })
      .from(buyLine)
      .where(eq(buyLine.receiptId, row.id))
      .orderBy(asc(buyLine.lineNo)),
    db
      .select({ method: payment.method, bank: payment.bank, amount: payment.amount })
      .from(payment)
      .where(eq(payment.receiptId, row.id)),
  ]);
  if (!sameBill(body, businessDate(now), row, lines, payments)) {
    throw new BuyError(BUY_API_MSG.keyReused, "idempotency_key", 409, { existing: { id: row.id, doc_no: row.docNo } });
  }
  return { id: row.id, doc_no: row.docNo, pdf_status: row.pdfStatus };
}

/** เวลาใน DB "10:00:00" → "10:00" */
const hhmm = (t: string) => t.slice(0, 5);
const lineKey = (metalId: string, weight: string, amount: string) =>
  `${metalId.toLowerCase()}|${fmtWeight(D(weight))}|${fmtMoney(D(amount))}`;
const paymentKey = (method: string, bank: string | null, amount: string) =>
  `${method}|${bank ?? ""}|${fmtMoney(D(amount))}`;
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * เนื้อบิลเดียวกันหรือไม่ — ลูกค้า · แถวตามลำดับ (โลหะ · น้ำหนัก 3 ตำแหน่ง · ราคา 2 ตำแหน่ง)
 * · ชำระแบบไม่สนลำดับ (วิธี · ธนาคาร · จำนวน) · รายละเอียด · ใบกำกับเต็มรูป · วันที่ (ถ้าส่งมา)
 * · เวลา เฉพาะบิลย้อนหลัง (บิลวันนี้จอเติมเวลาใหม่ได้) — ตัวเลขทำเป็นรูปมาตรฐานด้วย quoteBuy ตัวเดียวกับตอนบันทึก
 */
function sameBill(
  body: SaveBody,
  today: string,
  row: { customerId: string; date: string; time: string; detail: string | null; fullTax: boolean },
  lines: { metalId: string; weightG: string; amount: string }[],
  payments: { method: string; bank: string | null; amount: string }[],
): boolean {
  const q = quoteBuy({
    lines: quoteLines(body),
    payments: body.payments.map((p) => ({ method: p.method, bank: p.bank, amount: p.amount })),
    customer: null,
    goldPriceSet: true,
  });
  // แถวที่ผิดรูป/ซ้ำถูกข้ามใน quoteBuy — จำนวนไม่เท่ากับที่ส่งมา = ไม่ใช่บิลเดิม
  if (q.lines.length !== body.lines.length || q.payments.length !== body.payments.length) return false;
  const backdated = body.date !== undefined && body.date < today;
  return (
    row.customerId === body.customer_id?.toLowerCase() &&
    sameList(
      q.lines.map((l) => lineKey(l.metalId, l.weightG, l.amount)),
      lines.map((l) => lineKey(l.metalId, l.weightG, l.amount)),
    ) &&
    sameList(
      q.payments.map((p) => paymentKey(p.method, p.bank, p.amount)).sort(),
      payments.map((p) => paymentKey(p.method, p.bank, p.amount)).sort(),
    ) &&
    (body.detail ?? null) === row.detail &&
    body.full_tax === row.fullTax &&
    (body.date === undefined || body.date === row.date) &&
    (!backdated || body.time === hhmm(row.time))
  );
}

async function insertBuy(
  db: Db,
  viewer: Viewer,
  p: PreparedBuy,
  body: SaveBody,
  time: string,
  company: CompanyInfo,
): Promise<SavedBuy> {
  const buyer = p.customer;
  const price = p.price;
  if (!p.ok || !buyer || !price) throw new Error("insertBuy: quote ไม่ผ่าน");
  return db.transaction(async (tx) => {
    // ออกเลขในทรานแซกชันเดียวกัน — rollback แล้วเลขคืน ไม่มีเลขหาย · ล็อกแถวตัวนับกันเลขชน (R9)
    const [seq] = await tx.execute<{ doc_no: string }>(
      sql`select next_doc_no(${p.branch.id}::uuid, 'RC', ${p.date}::date) as doc_no`,
    );
    if (!seq) throw new Error("next_doc_no returned nothing");
    // อักษรนำของสาขา (แบบ Django Branch.doc_prefix): PT-RC6910-0001 · ตัวนับยังเป็นของสาขา/RC/งวด ตัวเดิม
    const [head] = await tx.select({ prefix: branch.docPrefix }).from(branch).where(eq(branch.id, p.branch.id));
    const docNo = head?.prefix ? `${head.prefix}-${seq.doc_no}` : seq.doc_no;
    // หัวใบ ณ วันขาย (R15) — PDF ทุกฉบับของบิลนี้ (รวมฉบับยกเลิก) ใช้ชุดนี้ ไม่ใช่ค่าปัจจุบัน
    const companySnapshot = await captureCompanySnapshot(tx, p.branch.id, company);
    const [receipt] = await tx
      .insert(buyReceipt)
      .values({
        branchId: p.branch.id,
        docNo,
        date: p.date,
        time,
        customerId: buyer.id,
        customerSnapshot: snapshotOf(buyer),
        companySnapshot,
        goldPriceSnapshot: price.barSell,
        detail: body.detail,
        fullTax: body.full_tax,
        totalWeight: p.quote.totalWeight,
        totalAmount: p.quote.totalAmount,
        pdfStatus: "pending",
        idcardStatus: buyer.photoKey ? "pending" : "none",
        createdBy: viewer.userId,
        idempotencyKey: body.idempotency_key,
      })
      .returning({ id: buyReceipt.id, docNo: buyReceipt.docNo, pdfStatus: buyReceipt.pdfStatus });
    if (!receipt) throw new Error("insert buy_receipt returned nothing");

    await tx.insert(buyLine).values(
      p.quote.lines.map((l, i) => ({
        receiptId: receipt.id,
        lineNo: i + 1,
        metalId: l.metalId,
        weightG: l.weightG,
        amount: l.amount,
        pricePerG: l.pricePerG,
      })),
    );
    await tx
      .insert(payment)
      .values(
        p.quote.payments.map((x) => ({ receiptId: receipt.id, method: x.method, bank: x.bank, amount: x.amount })),
      );
    // R11 — ของเข้าสต็อกของสาขา ณ วันที่ของบิล
    await tx.insert(stockMovement).values(
      p.quote.lines.map((l) => ({
        branchId: p.branch.id,
        metalId: l.metalId,
        date: p.date,
        grams: l.weightG,
        sourceReceiptId: receipt.id,
      })),
    );
    if (p.date < p.today) {
      await tx.insert(auditLog).values({
        userId: viewer.userId,
        action: "buy.backdate",
        tableName: "buy_receipt",
        rowId: receipt.id,
        diff: { doc_no: receipt.docNo, date: p.date, time, entered_on: p.today, reason: body.backdate_reason },
      });
    }
    // Σชำระ = ยอดบิล ตรวจซ้ำตอน commit โดย deferred trigger check_receipt_paid (ตาข่ายชั้นสุดท้าย)
    return { id: receipt.id, doc_no: receipt.docNo, pdf_status: receipt.pdfStatus };
  });
}

/**
 * POST /buy — quote ด้วยขั้นเดียวกับ /buy/quote แล้วบันทึกทั้งบิลในทรานแซกชันเดียว
 * replay = key เดิมของผู้ใช้คนเดิม เนื้อบิลเดิม (ตอบ 200 ด้วยบิลเดิม ไม่สร้างใหม่)
 */
export async function saveBuy(
  db: Db,
  viewer: Viewer,
  body: SaveBody,
  now: Date,
  /** หัวใบ (COMPANY_*) — แช่แข็งลง company_snapshot ของบิล */
  company: CompanyInfo,
): Promise<{ replay: boolean; receipt: SavedBuy }> {
  // ตรวจ key ก่อนทุกอย่าง — กดซ้ำหลังบันทึกไปแล้ว (ข้ามเที่ยงคืน · session เสียสาขาปัจจุบัน) ต้องได้บิลเดิม
  const existing = await findReplay(db, viewer, body, now);
  if (existing) return { replay: true, receipt: existing };
  const prepared = await prepareBuy(db, viewer, body, now);
  const first = prepared.errors[0];
  if (first) throw new BuyError(first.message, first.field, 409, quoteJson(prepared));
  const time = billTime(body.time, prepared, now);
  try {
    return { replay: false, receipt: await insertBuy(db, viewer, prepared, body, time, company) };
  } catch (e) {
    const pg = pgError(e);
    if (pg?.code === "23505" && pg.constraint_name === "buy_receipt_idempotency_key_unique") {
      // ส่งพร้อมกันด้วย key เดียวกัน — ตัวที่ commit ก่อนชนะ ตัวที่เหลือได้บิลนั้น
      const winner = await findReplay(db, viewer, body, now);
      if (winner) return { replay: true, receipt: winner };
    }
    if (pg?.code === "23505" && pg.constraint_name === "buy_receipt_branch_doc_no") {
      throw new BuyError(BUY_API_MSG.docNoTaken, "doc_no", 409);
    }
    throw e;
  }
}

/** นาทีที่ยอมให้เวลาในบิลล่วงหน้านาฬิกาเซิร์ฟเวอร์ (นาฬิกาเครื่องหน้าร้านเดินไม่ตรง) */
const FUTURE_TIME_GRACE_MS = 5 * 60_000;

/** เวลาของบิล: ย้อนหลังต้องระบุเอง · วันนี้ไม่ระบุ = เวลาตอนบันทึก · วันนี้ห้ามล่วงหน้าเกิน 5 นาที */
function billTime(time: string | undefined, p: PreparedBuy, now: Date): string {
  if (!time) {
    if (p.date < p.today) throw new BuyError(BUY_API_MSG.backdateTime, "time", 400);
    return businessTime(now);
  }
  const limit = new Date(now.getTime() + FUTURE_TIME_GRACE_MS);
  // 5 นาทีนั้นข้ามเที่ยงคืนไปแล้ว = ทุกเวลาของวันนี้ยังไม่เกิน
  if (p.date === p.today && businessDate(limit) === p.today && time > businessTime(limit)) {
    throw new BuyError(BUY_API_MSG.futureTime, "time", 400);
  }
  return time;
}

// ---------- อ่าน (scoped ตามสาขาที่อ่านได้) ----------

export const LIST_PAGE_SIZE = 50;

export const ListQuery = z.object({
  date_from: isoDate("date_from ").optional(),
  date_to: isoDate("date_to ").optional(),
  /** code ของโลหะ (gold · nak · silver · platinum) — บิลที่มีโลหะนั้นอย่างน้อยหนึ่งแถว */
  metal: z.string().trim().max(32, "metal ไม่ถูกต้อง").refine(isCleanText, UNUSABLE_CHARS_MSG).optional(),
  q: z
    .string()
    .trim()
    .max(100, "คำค้นยาวเกิน 100 ตัวอักษร")
    .refine(isCleanText, UNUSABLE_CHARS_MSG)
    .refine((q) => q.length === 0 || q.length >= 2, "ค้นอย่างน้อย 2 ตัวอักษร")
    .default(""),
  branch_id: z.string().max(64, "branch_id ไม่ถูกต้อง").optional(),
  page: z.coerce
    .number("page ต้องเป็นตัวเลข")
    .int("page ต้องเป็นจำนวนเต็ม")
    .min(1, "page เริ่มที่ 1")
    .max(10_000)
    .default(1),
});
export type ListQuery = z.infer<typeof ListQuery>;

/** ยอดรวมของทุกหน้าตามตัวกรอง — string ทั้งหมด (จำนวนบิล · กรัม 3 ตำแหน่ง · บาท 2 ตำแหน่ง) */
export interface ListTotals {
  count: string;
  total_weight: string;
  total_amount: string;
}
const totalsOf = (count: string, weight: string, amount: string): ListTotals => ({
  count,
  total_weight: fmtWeight(D(weight)),
  total_amount: fmtMoney(D(amount)),
});
const NO_TOTALS = totalsOf("0", ZERO.toString(), ZERO.toString());

/**
 * ค้นบิลย้อนหลัง — เฉพาะสาขาที่อ่านได้ (fail-closed): branch_id ที่ไม่มีสิทธิ์ = รายการว่าง ยอดศูนย์ ไม่ใช่ทุกสาขา
 * ลูกค้าแสดงจาก snapshot ตอนเปิดบิล · เลขบัตรมาสก์ (R13)
 * totals = ยอดของบิลที่ยังไม่ยกเลิกทุกหน้าตามตัวกรองเดียวกัน (การ์ด "ยอดซื้อวันนี้" · หน้าค้นบิล)
 */
export async function listBuys(db: Db, readable: BranchRef[], query: ListQuery) {
  const scope = query.branch_id ? readable.filter((b) => b.id === query.branch_id) : readable;
  if (scope.length === 0) return { items: [], hasMore: false, totals: NO_TOTALS };
  const branches = new Map(scope.map((b) => [b.id, { id: b.id, code: b.code, name: b.name }]));

  const conditions: SQL[] = [
    inArray(
      buyReceipt.branchId,
      scope.map((b) => b.id),
    ),
  ];
  if (query.date_from) conditions.push(gte(buyReceipt.date, query.date_from));
  if (query.date_to) conditions.push(lte(buyReceipt.date, query.date_to));
  if (query.metal) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(buyLine)
          .innerJoin(metal, eq(metal.id, buyLine.metalId))
          .where(and(eq(buyLine.receiptId, buyReceipt.id), eq(metal.code, query.metal))),
      ),
    );
  }
  if (query.q) {
    const text = `%${escapeLike(query.q)}%`;
    const snap = buyReceipt.customerSnapshot;
    const any: SQL[] = [
      ilike(buyReceipt.docNo, text),
      sql`${snap}->>'name_th' ilike ${text}`,
      sql`${snap}->>'name_en' ilike ${text}`,
    ];
    const digits = query.q.replace(/\D/g, "");
    if (digits.length >= 2) any.push(sql`${snap}->>'national_id' like ${`%${digits}%`}`);
    const match = or(...any);
    if (match) conditions.push(match);
  }

  const where = and(...conditions);
  const [rows, [sums]] = await Promise.all([
    db
      .select({
        id: buyReceipt.id,
        docNo: buyReceipt.docNo,
        date: buyReceipt.date,
        time: buyReceipt.time,
        branchId: buyReceipt.branchId,
        customerId: buyReceipt.customerId,
        snapshot: buyReceipt.customerSnapshot,
        totalWeight: buyReceipt.totalWeight,
        totalAmount: buyReceipt.totalAmount,
        status: buyReceipt.status,
        pdfStatus: buyReceipt.pdfStatus,
        createdBy: buyReceipt.createdBy,
        createdByName: user.name,
      })
      .from(buyReceipt)
      .innerJoin(user, eq(user.id, buyReceipt.createdBy))
      .where(where)
      .orderBy(desc(buyReceipt.date), desc(buyReceipt.time), desc(buyReceipt.docNo), desc(buyReceipt.id))
      .limit(LIST_PAGE_SIZE + 1)
      .offset((query.page - 1) * LIST_PAGE_SIZE),
    // SUM ของ numeric ใน Postgres (แม่นตรง) ส่งออกมาเป็นข้อความ — ไม่ผ่าน float · บิลยกเลิกไม่นับ
    db
      .select({
        count: sql<string>`count(*)::text`,
        weight: sql<string>`coalesce(sum(${buyReceipt.totalWeight}), 0)::text`,
        amount: sql<string>`coalesce(sum(${buyReceipt.totalAmount}), 0)::text`,
      })
      .from(buyReceipt)
      .where(and(where, eq(buyReceipt.status, "active"))),
  ]);

  const items = rows.slice(0, LIST_PAGE_SIZE).map((r) => ({
    id: r.id,
    doc_no: r.docNo,
    date: r.date,
    time: hhmm(r.time),
    branch: branches.get(r.branchId) ?? null,
    customer: {
      id: r.customerId,
      name_th: r.snapshot.name_th,
      national_id_masked: maskNationalId(r.snapshot.national_id),
    },
    total_weight: r.totalWeight,
    total_amount: r.totalAmount,
    status: r.status,
    pdf_status: r.pdfStatus,
    created_by: { id: r.createdBy, name: r.createdByName },
  }));
  const totals = sums ? totalsOf(sums.count, sums.weight, sums.amount) : NO_TOTALS;
  return { items, hasMore: rows.length > LIST_PAGE_SIZE, totals };
}

/** บิลเดียว — uuid ผิดรูป / ไม่มี / สาขาอ่านไม่ได้ = null (route ตอบ 404 เหมือนกันหมด ไม่บอกว่ามีอยู่) */
export async function getBuy(db: Db, readable: BranchRef[], id: string) {
  if (!z.uuid().safeParse(id).success || readable.length === 0) return null;
  const [row] = await db
    .select({
      receipt: buyReceipt,
      branch: { id: branch.id, code: branch.code, name: branch.name, taxBranchCode: branch.taxBranchCode },
      createdByName: user.name,
    })
    .from(buyReceipt)
    .innerJoin(branch, eq(branch.id, buyReceipt.branchId))
    .innerJoin(user, eq(user.id, buyReceipt.createdBy))
    .where(
      and(
        eq(buyReceipt.id, id),
        inArray(
          buyReceipt.branchId,
          readable.map((b) => b.id),
        ),
      ),
    )
    .limit(1);
  if (!row) return null;

  const [lines, payments] = await Promise.all([
    db
      .select({
        lineNo: buyLine.lineNo,
        weightG: buyLine.weightG,
        amount: buyLine.amount,
        pricePerG: buyLine.pricePerG,
        metalId: metal.id,
        metalCode: metal.code,
        metalName: metal.nameTh,
      })
      .from(buyLine)
      .innerJoin(metal, eq(metal.id, buyLine.metalId))
      .where(eq(buyLine.receiptId, id))
      .orderBy(asc(buyLine.lineNo)),
    db
      .select()
      .from(payment)
      .where(eq(payment.receiptId, id))
      // payment ไม่มีลำดับแถว — เรียงให้คงที่: เงินสดก่อน แล้วตามธนาคาร
      .orderBy(asc(payment.method), asc(payment.bank), asc(payment.amount), asc(payment.id)),
  ]);

  const r = row.receipt;
  const snap = r.customerSnapshot;
  return {
    id: r.id,
    doc_no: r.docNo,
    date: r.date,
    time: hhmm(r.time),
    branch: {
      id: row.branch.id,
      code: row.branch.code,
      name: row.branch.name,
      tax_branch_code: row.branch.taxBranchCode,
    },
    customer: {
      id: r.customerId,
      name_th: snap.name_th,
      name_en: snap.name_en,
      address: snap.address,
      national_id_masked: maskNationalId(snap.national_id),
    },
    gold_price_snapshot: r.goldPriceSnapshot,
    detail: r.detail,
    full_tax: r.fullTax,
    lines: lines.map((l) => ({
      line_no: l.lineNo,
      metal: { id: l.metalId, code: l.metalCode, name_th: l.metalName },
      weight_g: l.weightG,
      amount: l.amount,
      price_per_g: l.pricePerG,
    })),
    payments: payments.map((p) => ({
      method: p.method,
      method_label: isPaymentMethod(p.method) ? PAYMENT_METHODS[p.method] : p.method,
      bank: p.bank,
      amount: p.amount,
    })),
    total_weight: r.totalWeight,
    total_amount: r.totalAmount,
    avg_price_per_g: avgPricePerG(r.totalAmount, r.totalWeight),
    status: r.status,
    pdf_status: r.pdfStatus,
    idcard_status: r.idcardStatus,
    created_by: { id: r.createdBy, name: row.createdByName },
    created_at: r.createdAt.toISOString(),
    voided_at: r.voidedAt?.toISOString() ?? null,
    void_reason: r.voidReason,
  };
}
