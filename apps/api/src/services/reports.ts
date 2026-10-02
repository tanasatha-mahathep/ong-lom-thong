import { D, type ReceiptLine, fmtMoney, fmtWeight, groupLinesByMetal, maskNationalId } from "@ong/core";
import { type Db, branch, buyLine, buyReceipt, metal, stockMovement, user } from "@ong/db";
import { and, asc, eq, exists, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { csvText, toCsv } from "../lib/csv";
import { type BranchRef, type Viewer, forUserHistory } from "../lib/scope";

/** ทรานแซกชันที่เปิดอยู่ของ drizzle — ให้ผู้เรียกรวมรายงานไว้ใน snapshot เดียวกับงานของตัวเอง */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * ชุดสาขาของรายงานทุกตัว — จุดเดียวที่เลือก (fail-closed: ไม่มีสิทธิ์ = [] → route ตอบ 403 ไม่ใช่ทุกสาขา)
 * = forUserHistory: accounting/admin อ่านย้อนหลังของสาขาที่ปิดแล้วได้ (เอกสารภาษีเก็บ ≥ 5 ปี) · role อื่น = forUser
 */
export const reportBranches = (db: Db, viewer: Viewer): Promise<BranchRef[]> => forUserHistory(db, viewer);

/** branch_id ที่ส่งมา = เฉพาะสาขานั้น ถ้าอ่านได้ · อ่านไม่ได้/ไม่มีจริง = [] (รายงานว่าง ไม่ใช่ทุกสาขา) */
export const scopeTo = (readable: BranchRef[], branchId: string | undefined): BranchRef[] =>
  branchId === undefined ? readable : readable.filter((b) => b.id === branchId);

// ---------- query ----------

/** วันที่ "YYYY-MM-DD" ที่มีจริง ตั้งแต่ปี 2000 — ปี 0000 ผ่านรูปแบบแต่ Postgres ปฏิเสธ (จะกลายเป็น 500) */
const isoDate = (label: string) =>
  z.iso
    .date(`${label} ต้องเป็นรูปแบบ YYYY-MM-DD`)
    .refine((d) => d >= "2000-01-01", `${label} ต้องตั้งแต่ปี ค.ศ. 2000 (พ.ศ. 2543)`);

const Format = z.enum(["json", "csv"], { error: "format ต้องเป็น json หรือ csv" }).default("json");
/** เทียบกับรายการสาขาที่อ่านได้ในหน่วยความจำ — ไม่ส่งเข้า DB */
const BranchId = z.string().max(64, "branch_id ไม่ถูกต้อง").optional();

export const PurchaseQuery = z.object({
  /** ไม่ส่ง = วันแรกของเดือนนี้ (ตามเวลาไทย · ค่าเริ่มต้นของ finance_report3 คือเดือนปัจจุบัน) */
  date_from: isoDate("date_from").optional(),
  /** ไม่ส่ง = วันนี้ (ตามเวลาไทย) */
  date_to: isoDate("date_to").optional(),
  /** code ของโลหะ (gold · nak · silver · platinum) — นับเฉพาะแถวของโลหะนั้น */
  metal: z.string().trim().max(32, "metal ไม่ถูกต้อง").optional(),
  branch_id: BranchId,
  format: Format,
});
export type PurchaseQuery = z.infer<typeof PurchaseQuery>;

export const StockQuery = z.object({
  /** ไม่ส่ง = วันนี้ (ตามเวลาไทย) · นับความเคลื่อนไหวถึงวันนี้รวมวันนั้น */
  as_of: isoDate("as_of").optional(),
  branch_id: BranchId,
  format: Format,
});
export type StockQuery = z.infer<typeof StockQuery>;

// ---------- รูปคำตอบ (เงิน/น้ำหนักเป็น string ทั้งหมด) ----------

export interface MetalAmount {
  metal_code: string;
  name_th: string;
  /** Σ น้ำหนัก 3 ตำแหน่ง */
  grams: string;
  /** Σ ราคารับซื้อ 2 ตำแหน่ง */
  amount: string;
}

export interface PurchaseTotals {
  /** จำนวนบิล (ที่มีแถวตรงตัวกรองอย่างน้อยหนึ่งแถว) */
  count: string;
  total_weight: string;
  total_amount: string;
  /** ทุกโลหะตามลำดับของร้าน (มีตัวกรองโลหะ = โลหะนั้นตัวเดียว) · ไม่มีรายการ = 0 */
  by_metal: MetalAmount[];
}

export interface PurchaseItem {
  label: string;
  grams: string;
  amount: string;
}

/** แถวของรายงาน = หนึ่งบิล — คอลัมน์ตาม finance_report3 ของระบบเดิม + สาขา · เลขบัตร (มาสก์) · ผู้บันทึก */
export interface PurchaseRow {
  /** ลำดับ */
  no: number;
  id: string;
  /** วัน เดือน ปีใบรับซื้อของเก่า */
  date: string;
  time: string;
  /** เล่มที่/เลขที่ใบรับซื้อของเก่า */
  doc_no: string;
  branch: BranchRef;
  /** ชื่อ-สกุล จาก snapshot ตอนเปิดบิล · เลขบัตรมาสก์เสมอ (R13) */
  customer: { id: string; name_th: string; national_id_masked: string };
  /** รายการสินค้า — เฉพาะโลหะที่มีในบิล (หลังตัวกรอง) */
  metals: MetalAmount[];
  /**
   * รายการตามที่พิมพ์บนใบรับซื้อ (groupLinesByMetal ตัวเดียวกับ PDF) — หนึ่งแถวต่อ (โลหะ · ค่าบริสุทธิ์ · หัก %)
   * เช่น "ทอง 96.5% หัก 3%" · บิลก่อนมีค่าบริสุทธิ์ = ชื่อโลหะ (UAT 30 ก.ย. 2569: แสดง % ในรายงานยอดซื้อ)
   */
  items: PurchaseItem[];
  /** จำนวน(กรัม) */
  total_weight: string;
  /** รวมจำนวนเงิน */
  total_amount: string;
  created_by: { id: string; name: string };
}

export interface PurchaseReport {
  date_from: string;
  date_to: string;
  metal: string | null;
  rows: PurchaseRow[];
  by_branch: (PurchaseTotals & { branch: BranchRef })[];
  /** รวมทั้งสิ้น — ทุกสาขาในขอบเขต */
  total: PurchaseTotals;
}

export interface PurchaseFilter {
  from: string;
  to: string;
  metal: string | null;
}

type MetalRow = { id: string; code: string; nameTh: string };
type Sum = { count?: string; grams: string; amount: string };

const hhmm = (t: string) => t.slice(0, 5);
const metalAmount = (m: MetalRow, s: Sum | undefined): MetalAmount => ({
  metal_code: m.code,
  name_th: m.nameTh,
  grams: fmtWeight(D(s?.grams ?? "0")),
  amount: fmtMoney(D(s?.amount ?? "0")),
});
const totalsOf = (metals: MetalRow[], all: Sum | undefined, perMetal: (m: MetalRow) => Sum | undefined) => ({
  count: all?.count ?? "0",
  total_weight: fmtWeight(D(all?.grams ?? "0")),
  total_amount: fmtMoney(D(all?.amount ?? "0")),
  by_metal: metals.map((m) => metalAmount(m, perMetal(m))),
});

/** โลหะตามลำดับของร้าน (ทอง · นาก · เงิน · แพลตตินั่ม) */
const allMetals = (db: Db | Tx): Promise<MetalRow[]> =>
  db
    .select({ id: metal.id, code: metal.code, nameTh: metal.nameTh })
    .from(metal)
    .orderBy(asc(metal.sortOrder), asc(metal.code));

/**
 * รายงานยอดซื้อ (finance_report3) — บิล active ในช่วงวันที่ของสาขาในขอบเขต · บิลยกเลิกไม่นับ
 * ยอดทุกตัวเป็น SUM ของ numeric ใน Postgres (แม่นตรง ไม่ผ่าน float) และมาจากแถวรายการ (buy_line) ชุดเดียวกัน:
 * แถวของบิล · ต่อสาขา · ต่อโลหะ · รวมทั้งสิ้น จึงรวมกันลงตัวเสมอ · ทุกคำสั่งอยู่ใน snapshot เดียว (repeatable read)
 * ตัวกรองโลหะ = นับเฉพาะแถวของโลหะนั้น (บิลที่มีทองกับเงิน กรองทอง → เห็นเฉพาะส่วนของทอง)
 */
export function purchaseReport(db: Db, scope: BranchRef[], f: PurchaseFilter): Promise<PurchaseReport> {
  return db.transaction((tx) => purchaseReportIn(tx, scope, f), {
    isolationLevel: "repeatable read",
    accessMode: "read only",
  });
}

/**
 * ตัวเดียวกับ purchaseReport() แต่รันในทรานแซกชันของผู้เรียก — export รายเดือน (§9.4) ได้ CSV จาก snapshot
 * เดียวกับรายการบิลใน manifest · ผู้เรียกต้องเปิดทรานแซกชันแบบ repeatable read เอง (ไม่งั้นแต่ละคำสั่งเห็นคนละ snapshot)
 */
export async function purchaseReportIn(tx: Tx, scope: BranchRef[], f: PurchaseFilter): Promise<PurchaseReport> {
  const metals = (await allMetals(tx)).filter((m) => f.metal === null || m.code === f.metal);
  const head = { date_from: f.from, date_to: f.to, metal: f.metal };
  if (scope.length === 0 || metals.length === 0) {
    const zero = totalsOf(metals, undefined, () => undefined);
    return { ...head, rows: [], by_branch: scope.map((b) => ({ branch: b, ...zero })), total: zero };
  }

  const metalIds = metals.map((m) => m.id);
  const billWhere = and(
    inArray(
      buyReceipt.branchId,
      scope.map((b) => b.id),
    ),
    eq(buyReceipt.status, "active"),
    gte(buyReceipt.date, f.from),
    lte(buyReceipt.date, f.to),
  );
  const lineWhere = and(billWhere, inArray(buyLine.metalId, metalIds));

  const bills = await tx
    .select({
      id: buyReceipt.id,
      docNo: buyReceipt.docNo,
      date: buyReceipt.date,
      time: buyReceipt.time,
      branchId: buyReceipt.branchId,
      branchCode: branch.code,
      branchName: branch.name,
      customerId: buyReceipt.customerId,
      snapshot: buyReceipt.customerSnapshot,
      createdBy: buyReceipt.createdBy,
      createdByName: user.name,
    })
    .from(buyReceipt)
    .innerJoin(branch, eq(branch.id, buyReceipt.branchId))
    .innerJoin(user, eq(user.id, buyReceipt.createdBy))
    .where(
      and(
        billWhere,
        exists(
          tx
            .select({ one: sql`1` })
            .from(buyLine)
            .where(and(eq(buyLine.receiptId, buyReceipt.id), inArray(buyLine.metalId, metalIds))),
        ),
      ),
    )
    .orderBy(asc(buyReceipt.date), asc(branch.code), asc(buyReceipt.docNo), asc(buyReceipt.id));
  // แถวสินค้าของทุกบิล (หลังตัวกรองโลหะ) → รายการแบบเดียวกับที่พิมพ์บนใบ
  const lineRows = await tx
    .select({
      receiptId: buyLine.receiptId,
      metalName: metal.nameTh,
      weightG: buyLine.weightG,
      amount: buyLine.amount,
      purityPercent: buyLine.purityPercent,
      deductPercent: buyLine.deductPercent,
    })
    .from(buyLine)
    .innerJoin(buyReceipt, eq(buyReceipt.id, buyLine.receiptId))
    .innerJoin(metal, eq(metal.id, buyLine.metalId))
    .where(lineWhere)
    .orderBy(asc(buyLine.receiptId), asc(buyLine.lineNo));
  const linesOf = new Map<string, ReceiptLine[]>();
  for (const { receiptId, ...l } of lineRows) {
    const list = linesOf.get(receiptId);
    if (list) list.push(l);
    else linesOf.set(receiptId, [l]);
  }
  // ต่อบิลต่อโลหะ + ต่อบิล ในคำสั่งเดียว (grouping sets)
  const perBill = await tx
    .select({
      receiptId: buyLine.receiptId,
      metalId: sql<string | null>`${buyLine.metalId}`,
      allMetals: sql<number>`grouping(${buyLine.metalId})`,
      grams: sql<string>`sum(${buyLine.weightG})::text`,
      amount: sql<string>`sum(${buyLine.amount})::text`,
    })
    .from(buyLine)
    .innerJoin(buyReceipt, eq(buyReceipt.id, buyLine.receiptId))
    .where(lineWhere)
    .groupBy(sql`grouping sets ((${buyLine.receiptId}, ${buyLine.metalId}), (${buyLine.receiptId}))`);
  // ต่อสาขาต่อโลหะ · ต่อสาขา · ต่อโลหะ · รวมทั้งสิ้น ในคำสั่งเดียว
  const sums = await tx
    .select({
      branchId: sql<string | null>`${buyReceipt.branchId}`,
      metalId: sql<string | null>`${buyLine.metalId}`,
      allBranches: sql<number>`grouping(${buyReceipt.branchId})`,
      allMetals: sql<number>`grouping(${buyLine.metalId})`,
      count: sql<string>`count(distinct ${buyReceipt.id})::text`,
      grams: sql<string>`sum(${buyLine.weightG})::text`,
      amount: sql<string>`sum(${buyLine.amount})::text`,
    })
    .from(buyLine)
    .innerJoin(buyReceipt, eq(buyReceipt.id, buyLine.receiptId))
    .where(lineWhere)
    .groupBy(
      sql`grouping sets ((${buyReceipt.branchId}, ${buyLine.metalId}), (${buyReceipt.branchId}), (${buyLine.metalId}), ())`,
    );

  const key = (a: string | null, b: string | null) => `${a ?? "*"}|${b ?? "*"}`;
  const billSum = new Map(perBill.map((s) => [key(s.receiptId, s.allMetals ? null : s.metalId), s]));
  const sum = new Map(sums.map((s) => [key(s.allBranches ? null : s.branchId, s.allMetals ? null : s.metalId), s]));

  const rows = bills.map((b, i): PurchaseRow => ({
    no: i + 1,
    id: b.id,
    date: b.date,
    time: hhmm(b.time),
    doc_no: b.docNo,
    branch: { id: b.branchId, code: b.branchCode, name: b.branchName },
    customer: {
      id: b.customerId,
      name_th: b.snapshot.name_th,
      national_id_masked: maskNationalId(b.snapshot.national_id),
    },
    metals: metals.flatMap((m) => {
      const s = billSum.get(key(b.id, m.id));
      return s ? [metalAmount(m, s)] : [];
    }),
    items: groupLinesByMetal(linesOf.get(b.id) ?? []).map((g) => ({
      label: g.label,
      grams: g.weightG,
      amount: g.amount,
    })),
    total_weight: fmtWeight(D(billSum.get(key(b.id, null))?.grams ?? "0")),
    total_amount: fmtMoney(D(billSum.get(key(b.id, null))?.amount ?? "0")),
    created_by: { id: b.createdBy, name: b.createdByName },
  }));
  return {
    ...head,
    rows,
    by_branch: scope.map((b) => ({
      branch: b,
      ...totalsOf(metals, sum.get(key(b.id, null)), (m) => sum.get(key(b.id, m.id))),
    })),
    total: totalsOf(metals, sum.get(key(null, null)), (m) => sum.get(key(null, m.id))),
  };
}

// ---------- CSV ----------

const branchLabel = (b: BranchRef) => `${b.code} ${b.name}`;

/** หัวคอลัมน์ — ป้ายตาม finance_report3 ของระบบเดิม (+ เวลา · สาขา · เลขบัตรมาสก์ · ผู้บันทึก) */
export const PURCHASE_CSV_HEADER = [
  "ลำดับ",
  "วัน เดือน ปีใบรับซื้อของเก่า",
  "เวลา",
  "เล่มที่/เลขที่ใบรับซื้อของเก่า",
  "สาขา",
  "ชื่อ-สกุล",
  "เลขบัตรประชาชน (ปิดบัง)",
  "รายการสินค้า",
  "จำนวน(กรัม)",
  "รวมจำนวนเงิน",
  "ผู้บันทึก",
] as const;

/**
 * รายงานยอดซื้อเป็น CSV — หนึ่งแถวต่อบิล แล้วต่อด้วยแถวสรุป: "รวม" ต่อสาขา (ต่อโลหะ + ทุกประเภท)
 * และ "รวมทั้งสิ้น" ทุกสาขา (ต่อโลหะ + ทุกประเภท) · ตัวเลขชุดเดียวกับ JSON
 */
export function purchaseCsv(r: PurchaseReport): string {
  const bills = r.rows.map((x) => [
    String(x.no),
    x.date,
    x.time,
    csvText(x.doc_no),
    csvText(branchLabel(x.branch)),
    csvText(x.customer.name_th),
    csvText(x.customer.national_id_masked),
    // ป้ายเดียวกับบนใบรับซื้อ เช่น "ทอง 96.5% หัก 3%, เงิน 92.5%" · บิลเก่า = ชื่อโลหะเหมือนเดิม
    csvText(x.items.map((m) => m.label).join(", ")),
    x.total_weight,
    x.total_amount,
    csvText(x.created_by.name),
  ]);
  const summary = (label: string, where: string, t: PurchaseTotals) => [
    ...t.by_metal.map((m) => [label, "", "", "", where, "", "", csvText(m.name_th), m.grams, m.amount, ""]),
    [label, "", "", "", where, "", "", `ทุกประเภท (${t.count} ใบ)`, t.total_weight, t.total_amount, ""],
  ];
  return toCsv([
    PURCHASE_CSV_HEADER,
    ...bills,
    ...r.by_branch.flatMap((b) => summary("รวม", csvText(branchLabel(b.branch)), b)),
    ...summary("รวมทั้งสิ้น", "ทุกสาขา", r.total),
  ]);
}

// ---------- สต็อกคงเหลือ (stock_show) ----------

export interface StockMetal {
  metal_code: string;
  name_th: string;
  /** กรัมคงเหลือ 3 ตำแหน่ง */
  grams: string;
}

export interface StockReport {
  as_of: string;
  /** ทุกสาขาในขอบเขต · ทุกโลหะตามลำดับของร้าน (ไม่มีความเคลื่อนไหว = 0.000) */
  by_branch: { branch: BranchRef; by_metal: StockMetal[] }[];
  /** รวมทุกสาขาในขอบเขต ต่อโลหะ — ไม่รวมกรัมข้ามโลหะ (ระบบเดิมเว้นช่อง "รวมทั้งสิ้น" ว่าง) */
  total: { by_metal: StockMetal[] };
}

/**
 * สต็อกคงเหลือ ณ วันที่ — Σ stock_movement.grams ที่ date ≤ as_of ต่อสาขาต่อโลหะ และรวมทุกสาขาต่อโลหะ
 * รับซื้อ/ยอดยกมาเป็นบวก · ยกเลิกบิล = แถวติดลบ (ลงวันที่ของบิล) — รวมทุกแถวตามวันที่ของแถวเอง จึงหักกันเองโดยไม่ต้องดูสถานะบิล
 * SUM ของ numeric ใน Postgres คำสั่งเดียว (grouping sets) — ยอดต่อสาขากับรวมทุกสาขามาจาก snapshot เดียวกัน
 */
export async function stockReport(db: Db, scope: BranchRef[], asOf: string): Promise<StockReport> {
  const metals = await allMetals(db);
  const sums =
    scope.length === 0
      ? []
      : await db
          .select({
            branchId: sql<string | null>`${stockMovement.branchId}`,
            metalId: stockMovement.metalId,
            allBranches: sql<number>`grouping(${stockMovement.branchId})`,
            grams: sql<string>`sum(${stockMovement.grams})::text`,
          })
          .from(stockMovement)
          .where(
            and(
              inArray(
                stockMovement.branchId,
                scope.map((b) => b.id),
              ),
              lte(stockMovement.date, asOf),
            ),
          )
          .groupBy(
            sql`grouping sets ((${stockMovement.branchId}, ${stockMovement.metalId}), (${stockMovement.metalId}))`,
          );
  const grams = new Map(sums.map((s) => [`${s.allBranches ? "*" : s.branchId}|${s.metalId}`, s.grams]));
  const byMetal = (branchId: string | null): StockMetal[] =>
    metals.map((m) => ({
      metal_code: m.code,
      name_th: m.nameTh,
      grams: fmtWeight(D(grams.get(`${branchId ?? "*"}|${m.id}`) ?? "0")),
    }));
  return {
    as_of: asOf,
    by_branch: scope.map((b) => ({ branch: b, by_metal: byMetal(b.id) })),
    total: { by_metal: byMetal(null) },
  };
}

/**
 * สต็อกเป็น CSV แบบตาราง (ตาม stock_show: ชื่อสินค้า · คงเหลือ) — หนึ่งแถวต่อโลหะ · หนึ่งคอลัมน์ต่อสาขา
 * · คอลัมน์ท้าย "รวมทั้งสิ้น" = ทุกสาขา · หน่วยกรัมอยู่ที่หัวคอลัมน์ ช่องเป็นตัวเลขล้วน
 */
export function stockCsv(r: StockReport): string {
  const header = [
    "ชื่อสินค้า",
    ...r.by_branch.map((b) => csvText(`คงเหลือ ${branchLabel(b.branch)} (กรัม)`)),
    "รวมทั้งสิ้น (กรัม)",
  ];
  const rows = r.total.by_metal.map((m, i) => [
    csvText(m.name_th),
    ...r.by_branch.map((b) => b.by_metal[i]?.grams ?? "0.000"),
    m.grams,
  ]);
  return toCsv([header, ...rows]);
}
