import { readFile } from "node:fs/promises";
import path from "node:path";
import { PAYMENT_METHODS, isPaymentMethod, maskNationalId } from "@ong/core";
import { type ReceiptData, renderIdCardHtml, renderReceiptHtml } from "@ong/core/receipt";
import { type Db, branch, buyLine, buyReceipt, metal, payment } from "@ong/db";
import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Env } from "../env";
import type { BackgroundTasks } from "../lib/background";
import { type PdfAsset, PdfRenderError, type PdfRenderer } from "../lib/gotenberg";
import { PDF_CONTENT_TYPE, idcardPdfKey, receiptPdfKey, sha256Hex } from "../lib/pdfArchive";
import type { BranchRef } from "../lib/scope";
import { ObjectExistsError, type Storage, putNew } from "../lib/storage";

/**
 * PDF เก็บถาวรของบิลซื้อเข้า (spec §9.2 · R15 · CLAUDE.md กฎ 5)
 * - ใบรับซื้อ · สำเนาบัตร (ถ้าลูกค้ามีรูปบัตร) · ฉบับยกเลิก (…_void.pdf) — ไฟล์ละ key ไม่เขียนทับ
 * - บิลหนึ่งใบมีผู้เขียนคนเดียว: advisory lock ต่อบิลครอบทั้ง render + อัปโหลด + อัปเดตสถานะ
 * - render/Gotenberg/bucket ล้ม = สถานะ failed + log เหตุผล — ไม่ทำให้การขายล้ม (retry ภายหลัง)
 */

// ---------- ข้อมูลใบ (แหล่งเดียวของทั้งจอและ PDF) ----------

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;
type ReceiptRow = typeof buyReceipt.$inferSelect;

/** ข้อมูลดิบของบิลจาก DB — ป้อน toReceiptData() */
export interface ReceiptSource {
  receipt: ReceiptRow;
  branch: { code: string; name: string; taxBranchCode: string | null };
  lines: { metalName: string; weightG: string; amount: string }[];
  payments: { method: string; bank: string | null; amount: string }[];
}

export type CompanyInfo = ReceiptData["company"];

/** หัวใบจาก COMPANY_* (ไม่มีโทรสาร = null → ใบพิมพ์ "-") */
export const companyFromEnv = (env: Env): CompanyInfo => ({
  name: env.COMPANY_NAME,
  address: env.COMPANY_ADDRESS,
  tel: env.COMPANY_TEL,
  fax: env.COMPANY_FAX ?? null,
  taxId: env.COMPANY_TAX_ID,
});

export async function loadReceiptSource(db: Queryable, receiptId: string): Promise<ReceiptSource | null> {
  const [row] = await db
    .select({
      receipt: buyReceipt,
      branch: { code: branch.code, name: branch.name, taxBranchCode: branch.taxBranchCode },
    })
    .from(buyReceipt)
    .innerJoin(branch, eq(branch.id, buyReceipt.branchId))
    .where(eq(buyReceipt.id, receiptId))
    .limit(1);
  if (!row) return null;
  const lines = await db
    .select({ metalName: metal.nameTh, weightG: buyLine.weightG, amount: buyLine.amount })
    .from(buyLine)
    .innerJoin(metal, eq(metal.id, buyLine.metalId))
    .where(eq(buyLine.receiptId, receiptId))
    .orderBy(asc(buyLine.lineNo));
  const payments = await db
    .select({ method: payment.method, bank: payment.bank, amount: payment.amount })
    .from(payment)
    .where(eq(payment.receiptId, receiptId))
    // ลำดับเดียวกับ GET /buy/:id — เงินสดก่อน แล้วตามธนาคาร
    .orderBy(asc(payment.method), asc(payment.bank), asc(payment.amount), asc(payment.id));
  return { ...row, lines, payments };
}

/**
 * ReceiptData ของบิล — ฟังก์ชันเดียวที่ทั้ง PDF และ GET /api/buy/:id ใช้ (หน้าตาจอกับไฟล์จึงไม่เพี้ยนกัน)
 * ต่างกันแค่เลขบัตร: PDF พิมพ์เต็ม · API ส่งแบบมาสก์ (R13)
 * status: ค่าเริ่มต้น = สถานะปัจจุบันของบิล · PDF ฉบับเดิมของบิลที่ยกเลิกแล้วส่ง "active"
 */
export function toReceiptData(
  src: ReceiptSource,
  company: CompanyInfo,
  opts: { nationalId: "full" | "masked"; status?: "active" | "void" },
): ReceiptData {
  const r = src.receipt;
  const snap = r.customerSnapshot;
  const status = opts.status ?? r.status;
  return {
    company,
    // seed ยังไม่ตั้ง tax_branch_code — ใช้รหัสสาขา (5 หลัก) แทน ไม่งั้นป้าย "(สำนักงานใหญ่)" หาย
    branch: { name: src.branch.name, taxBranchCode: src.branch.taxBranchCode ?? src.branch.code },
    docNo: r.docNo,
    date: r.date,
    time: r.time.slice(0, 5),
    customer: {
      nameTh: snap.name_th,
      address: snap.address,
      nationalId: opts.nationalId === "full" ? snap.national_id : maskNationalId(snap.national_id),
    },
    lines: src.lines.map((l) => ({ metalName: l.metalName, weightG: l.weightG, amount: l.amount })),
    detail: r.detail,
    totalAmount: r.totalAmount,
    payments: src.payments.map((p) => ({
      label: isPaymentMethod(p.method) ? PAYMENT_METHODS[p.method] : p.method,
      bank: p.bank,
      amount: p.amount,
    })),
    status,
    voidReason: status === "void" ? r.voidReason : null,
  };
}

/** `receipt` ใน GET /api/buy/:id — mapper ตัวเดียวกับ PDF แต่เลขบัตรมาสก์ (R13) */
export async function receiptForScreen(db: Db, env: Env, receiptId: string): Promise<ReceiptData | null> {
  const src = await loadReceiptSource(db, receiptId);
  return src ? toReceiptData(src, companyFromEnv(env), { nationalId: "masked" }) : null;
}

// ---------- ฟอนต์ ----------

export const PDF_FONT_FILES = ["Sarabun-Regular.ttf", "Sarabun-Bold.ttf"] as const;

/** อ่าน Sarabun ครั้งเดียวตอนเริ่ม — ไฟล์หาย = หยุด (ใบที่อ้างฟอนต์แต่ไม่แนบจะถูก Gotenberg ปฏิเสธทุกใบ) */
export async function loadPdfFonts(dir: string): Promise<PdfAsset[]> {
  return Promise.all(
    PDF_FONT_FILES.map(async (name) => ({
      name,
      data: await readFile(path.resolve(dir, name)),
      contentType: "font/ttf",
    })),
  );
}

// ---------- สร้าง/เก็บไฟล์ ----------

export type PdfKind = "receipt" | "idcard" | "void";
type FileStatus = "none" | "pending" | "ready" | "failed";

export interface PdfStatuses {
  pdf_status: FileStatus;
  idcard_status: FileStatus;
  void_pdf_status: FileStatus;
}

const statusesOf = (r: Pick<ReceiptRow, "pdfStatus" | "idcardStatus" | "voidPdfStatus">): PdfStatuses => ({
  pdf_status: r.pdfStatus,
  idcard_status: r.idcardStatus,
  void_pdf_status: r.voidPdfStatus,
});

const retryable = (s: FileStatus) => s === "pending" || s === "failed";

/** ไฟล์ที่ยังขาดของบิลนี้ — ready แล้วไม่แตะอีก (immutable) */
export function missingFiles(r: Pick<ReceiptRow, "pdfStatus" | "idcardStatus" | "voidPdfStatus" | "status">) {
  const kinds: PdfKind[] = [];
  if (r.pdfStatus !== "ready") kinds.push("receipt");
  if (retryable(r.idcardStatus)) kinds.push("idcard");
  if (r.status === "void" && retryable(r.voidPdfStatus)) kinds.push("void");
  return kinds;
}

const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

type Outcome = { ok: true; key: string; sha256: string } | { ok: false; reason: string };

const reasonOf = (e: unknown) =>
  e instanceof PdfRenderError
    ? `${e.kind}${e.status ? ` ${e.status}` : ""}: ${e.body || e.message}`
    : e instanceof Error
      ? e.message
      : String(e);

export interface ReceiptPdfDeps {
  db: Db;
  storage: Storage;
  renderer: PdfRenderer;
  company: CompanyInfo;
  fonts: readonly PdfAsset[];
  tasks: BackgroundTasks;
  now: () => Date;
  log?: Pick<Console, "error" | "info">;
}

export interface ArchiveResult extends PdfStatuses {
  /** มีผู้เขียนอื่นถือบิลนี้อยู่ (โหมดไม่รอ) — ไม่ได้ทำอะไร */
  busy: boolean;
}

export interface ReceiptPdfService {
  /** หลังบันทึก/ยกเลิกบิล — เริ่มเบื้องหลัง request ไม่รอ */
  enqueue(receiptId: string): void;
  /** สร้างไฟล์ที่ยังขาดของบิล (ผู้เขียนคนเดียวต่อบิล) · wait=false: มีคนทำอยู่ = busy ไม่รอ · ไม่มีบิล = null */
  archive(receiptId: string, opts?: { wait?: boolean }): Promise<ArchiveResult | null>;
  /** บิลที่ค้าง pending/failed นานกว่า olderThanMs — ทีละใบ ข้ามใบที่มีคนทำอยู่ · คืนจำนวนที่ทำ */
  retryDue(opts?: { olderThanMs?: number; limit?: number }): Promise<number>;
}

export function createReceiptPdfService(deps: ReceiptPdfDeps): ReceiptPdfService {
  const { db, storage, renderer, company, fonts, tasks, now } = deps;
  const log = deps.log ?? console;

  async function render(kind: PdfKind, src: ReceiptSource): Promise<Uint8Array<ArrayBuffer>> {
    const { docNo, date } = src.receipt;
    if (kind === "idcard") {
      const photoKey = src.receipt.customerSnapshot.photo_key;
      const photo = photoKey ? await storage.get(photoKey) : null;
      if (!photo) throw new Error("customer ID card photo not found in storage");
      const ext = PHOTO_EXT[photo.contentType];
      if (!ext) throw new Error(`unsupported photo type ${photo.contentType}`);
      const name = `card.${ext}`;
      const html = renderIdCardHtml({ docNo, date, companyName: company.name, photoSrc: name }, { fontBaseUrl: "" });
      const files = [...fonts, { name, data: photo.body, contentType: photo.contentType }];
      return renderer.htmlToPdf({ html, files, trace: `${docNo}-idcard` });
    }
    // ฉบับเดิมพิมพ์เป็นบิลปกติเสมอ (แม้ถูกยกเลิกไปแล้ว) · ฉบับยกเลิกมีตรา + เหตุผล
    const data = toReceiptData(src, company, { nationalId: "full", status: kind === "void" ? "void" : "active" });
    const html = renderReceiptHtml(data, { fontBaseUrl: "" });
    return renderer.htmlToPdf({ html, files: fonts, trace: kind === "void" ? `${docNo}-void` : docNo });
  }

  /** ไฟล์ที่มีอยู่แล้วใน bucket = ของรอบก่อน (อัปโหลดแล้วแต่อัปเดต DB ไม่ทัน) — รับมาใช้ ไม่ render ทับ */
  function adopt(key: string, body: Uint8Array): Outcome {
    if (Buffer.from(body.subarray(0, 5)).toString("latin1") !== "%PDF-") {
      return { ok: false, reason: `object at ${key} is not a PDF — needs manual check (never overwritten)` };
    }
    return { ok: true, key, sha256: sha256Hex(body) };
  }

  async function produce(kind: PdfKind, src: ReceiptSource): Promise<Outcome> {
    const where = { branchCode: src.branch.code, date: src.receipt.date, docNo: src.receipt.docNo };
    try {
      const key = kind === "idcard" ? idcardPdfKey(where) : receiptPdfKey({ ...where, void: kind === "void" });
      const stored = await storage.get(key);
      if (stored) return adopt(key, stored.body);
      const pdf = await render(kind, src);
      try {
        await putNew(storage, key, pdf, PDF_CONTENT_TYPE);
      } catch (e) {
        if (!(e instanceof ObjectExistsError)) throw e;
        const winner = await storage.get(key);
        if (!winner) throw e;
        return adopt(key, winner.body);
      }
      return { ok: true, key, sha256: sha256Hex(pdf) };
    } catch (e) {
      const reason = reasonOf(e);
      log.error(`[pdf] ${src.receipt.docNo} ${kind} failed: ${reason}`);
      return { ok: false, reason };
    }
  }

  function columnsFor(kind: PdfKind, out: Outcome, at: Date): Partial<typeof buyReceipt.$inferInsert> {
    if (kind === "receipt") {
      return out.ok
        ? { pdfKey: out.key, pdfSha256: out.sha256, pdfStatus: "ready", pdfGeneratedAt: at }
        : { pdfStatus: "failed" };
    }
    if (kind === "idcard") {
      return out.ok
        ? { idcardPdfKey: out.key, idcardSha256: out.sha256, idcardStatus: "ready" }
        : { idcardStatus: "failed" };
    }
    return out.ok
      ? { voidPdfKey: out.key, voidPdfSha256: out.sha256, voidPdfStatus: "ready", voidPdfGeneratedAt: at }
      : { voidPdfStatus: "failed" };
  }

  async function archive(receiptId: string, { wait = true } = {}): Promise<ArchiveResult | null> {
    if (!z.uuid().safeParse(receiptId).success) return null;
    return db.transaction(async (tx) => {
      // ผู้เขียนคนเดียวต่อบิล — ล็อกหลุดเองเมื่อทรานแซกชันจบ (commit/rollback/connection หลุด)
      const lockKey = sql`hashtextextended(${`buy_receipt_pdf:${receiptId}`}, 0)`;
      if (wait) {
        await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
      } else {
        const [got] = await tx.execute<{ locked: boolean }>(
          sql`select pg_try_advisory_xact_lock(${lockKey}) as locked`,
        );
        if (!got?.locked) {
          const [row] = await tx.select().from(buyReceipt).where(eq(buyReceipt.id, receiptId)).limit(1);
          return row ? { ...statusesOf(row), busy: true } : null;
        }
      }
      // อ่านหลังได้ล็อก — ผู้เขียนก่อนหน้าอาจทำเสร็จไปแล้ว
      const src = await loadReceiptSource(tx, receiptId);
      if (!src) return null;
      const set: Partial<typeof buyReceipt.$inferInsert> = {};
      // render ให้ครบก่อน แล้วอัปเดตครั้งเดียวท้ายสุด — ล็อกแถวสั้นที่สุด (การยกเลิกบิลไม่ต้องรอ Gotenberg)
      for (const kind of missingFiles(src.receipt))
        Object.assign(set, columnsFor(kind, await produce(kind, src), now()));
      if (Object.keys(set).length > 0) await tx.update(buyReceipt).set(set).where(eq(buyReceipt.id, receiptId));
      return { ...statusesOf({ ...src.receipt, ...set }), busy: false };
    });
  }

  async function retryDue({ olderThanMs = 2 * 60_000, limit = 10 } = {}): Promise<number> {
    const cutoff = new Date(now().getTime() - olderThanMs);
    const waiting = ["pending", "failed"] as const;
    const due = await db
      .select({ id: buyReceipt.id })
      .from(buyReceipt)
      .where(
        or(
          and(inArray(buyReceipt.pdfStatus, waiting), lte(buyReceipt.createdAt, cutoff)),
          and(inArray(buyReceipt.idcardStatus, waiting), lte(buyReceipt.createdAt, cutoff)),
          and(inArray(buyReceipt.voidPdfStatus, waiting), lte(buyReceipt.voidedAt, cutoff)),
        ),
      )
      .orderBy(asc(buyReceipt.createdAt))
      .limit(limit);
    let done = 0;
    for (const { id } of due) {
      const result = await archive(id, { wait: false });
      if (result && !result.busy) done++;
    }
    return done;
  }

  return {
    enqueue: (receiptId) => tasks.run(`pdf ${receiptId}`, () => archive(receiptId)),
    archive,
    retryDue,
  };
}

/**
 * retry เบื้องหลังทุก 5 นาที (spec §9.2) — เริ่มใน index.ts เท่านั้น ไม่ใช่ใน createApp (เทสต์ไม่มี timer ค้าง)
 * รอบแรกหลัง start 30 วินาที (เก็บงานที่ค้างจาก deploy ก่อน) · รอบซ้อนกันไม่ได้
 */
export function startPdfRetryLoop(
  pdf: ReceiptPdfService,
  { intervalMs = 5 * 60_000, firstRunMs = 30_000, olderThanMs = 2 * 60_000, limit = 10, log = console } = {},
): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const done = await pdf.retryDue({ olderThanMs, limit });
      if (done > 0) log.info(`[pdf] retry: processed ${done} receipt(s)`);
    } catch (e) {
      log.error("[pdf] retry loop failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), firstRunMs);
  const every = setInterval(() => void tick(), intervalMs);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

/** บิลที่ผู้ใช้อ่านได้ (fail-closed) — uuid ผิดรูป / ไม่มี / สาขาอื่น = null → route ตอบ 404 เหมือนกันหมด */
export async function findReadableReceipt(db: Db, readable: BranchRef[], id: string): Promise<ReceiptRow | null> {
  if (!z.uuid().safeParse(id).success || readable.length === 0) return null;
  const [row] = await db
    .select()
    .from(buyReceipt)
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
  return row ?? null;
}
