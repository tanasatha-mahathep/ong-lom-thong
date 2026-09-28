import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PAYMENT_METHODS, isPaymentMethod, maskNationalId } from "@ong/core";
import { type ReceiptData, ReceiptDataError, renderIdCardHtml, renderReceiptHtml } from "@ong/core/receipt";
import { type CompanySnapshot, type Db, type PDF_STATUSES, branch, buyLine, buyReceipt, metal, payment } from "@ong/db";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Env } from "../env";
import type { BackgroundTasks } from "../lib/background";
import { type PdfAsset, PdfRenderError, type PdfRenderer } from "../lib/gotenberg";
import { PDF_CONTENT_TYPE, idcardPdfKey, receiptPdfKey, sha256Hex } from "../lib/pdfArchive";
import type { BranchRef } from "../lib/scope";
import { ObjectExistsError, type Storage, type StoredObject, putNew } from "../lib/storage";

/**
 * PDF เก็บถาวรของบิลซื้อเข้า (spec §9.2 · R15 · CLAUDE.md กฎ 5)
 * - ใบรับซื้อ · สำเนาบัตร (ถ้าลูกค้ามีรูปบัตร) · ฉบับยกเลิก (…_void.pdf) — ไฟล์ละ key ไม่เขียนทับ
 * - บิลหนึ่งใบมีผู้เขียนคนเดียว: lease ต่อบิล (จอง/บันทึกผลด้วย UPDATE สั้น ๆ) — ไม่ถือ transaction ระหว่าง
 *   Gotenberg/bucket (connection pool ต้องว่างให้การขาย · ข้อ 9.2 "ไม่บล็อกการขาย")
 * - render/Gotenberg/bucket ล้ม = สถานะ failed + log เหตุผล — ไม่ทำให้การขายล้ม (retry ภายหลัง)
 */

// ---------- ข้อมูลใบ (แหล่งเดียวของทั้งจอและ PDF) ----------

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;
type ReceiptRow = typeof buyReceipt.$inferSelect;

/** สาขาที่หัวใบต้องใช้ (ค่าปัจจุบัน — ใช้ตอนบันทึก snapshot หรือกับบิลเก่าที่ไม่มี snapshot) */
export interface BranchHeader {
  code: string;
  name: string;
  address: string | null;
  tel: string | null;
  taxBranchCode: string | null;
}

/** ข้อมูลดิบของบิลจาก DB — ป้อน toReceiptData() */
export interface ReceiptSource {
  receipt: ReceiptRow;
  branch: BranchHeader;
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

const branchHeader = {
  code: branch.code,
  name: branch.name,
  address: branch.address,
  tel: branch.tel,
  taxBranchCode: branch.taxBranchCode,
};

/**
 * หัวใบตามกติกาเดียวทั้งระบบ: ที่อยู่/โทรของสาขา (ถ้าตั้งไว้) ไม่งั้นของกิจการ · ชื่อ/โทรสาร/เลขผู้เสียภาษีจาก COMPANY_*
 * รหัสสาขาสรรพากรตามที่ตั้งไว้ ไม่เดาแทน (null = PDF ไม่ออก — ReceiptDataError)
 */
export function companySnapshotOf(company: CompanyInfo, b: BranchHeader): CompanySnapshot {
  // ช่องว่าง/เว้นวรรคล้วนของสาขา = ไม่ได้ตั้ง → ใช้ของกิจการ
  const filled = (v: string | null) => (v?.trim() ? v.trim() : null);
  return {
    name: company.name,
    address: filled(b.address) ?? company.address,
    tel: filled(b.tel) ?? company.tel,
    fax: company.fax,
    tax_id: company.taxId,
    branch_name: b.name,
    branch_code: b.code,
    tax_branch_code: b.taxBranchCode,
  };
}

/** POST /buy เรียกในทรานแซกชันเดียวกับ insert — หัวใบของบิลแช่แข็ง ณ วันขาย (R15) */
export async function captureCompanySnapshot(
  db: Queryable,
  branchId: string,
  company: CompanyInfo,
): Promise<CompanySnapshot> {
  const [b] = await db.select(branchHeader).from(branch).where(eq(branch.id, branchId)).limit(1);
  if (!b) throw new Error(`branch ${branchId} not found`);
  return companySnapshotOf(company, b);
}

/** หัวใบของบิล — snapshot ตอนบันทึก · บิลที่บันทึกก่อนมี snapshot ใช้ค่าปัจจุบันด้วยกติกาเดียวกัน */
export const headerOf = (src: ReceiptSource, company: CompanyInfo): CompanySnapshot =>
  src.receipt.companySnapshot ?? companySnapshotOf(company, src.branch);

export async function loadReceiptSource(db: Queryable, receiptId: string): Promise<ReceiptSource | null> {
  const [row] = await db
    .select({ receipt: buyReceipt, branch: branchHeader })
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
  opts: { nationalId: "full" | "masked"; status?: "active" | "void"; watermark?: string },
): ReceiptData {
  const r = src.receipt;
  const snap = r.customerSnapshot;
  const status = opts.status ?? r.status;
  const h = headerOf(src, company);
  return {
    // null ใน snapshot = ว่างบนจอ · PDF ตรวจหัวใบให้ครบก่อนพิมพ์ (assertCompleteHeader)
    company: { name: h.name, address: h.address ?? "", tel: h.tel ?? "", fax: h.fax, taxId: h.tax_id ?? "" },
    // ส่งตามที่ตั้งไว้ ไม่เดาแทน — ไม่มีรหัสสาขาสรรพากร = PDF ออกไม่ได้ (ReceiptDataError ใน @ong/core/receipt)
    branch: { name: h.branch_name, taxBranchCode: h.tax_branch_code },
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
    ...(opts.watermark ? { watermark: opts.watermark } : {}),
  };
}

/** `receipt` ใน GET /api/buy/:id — mapper ตัวเดียวกับ PDF แต่เลขบัตรมาสก์ (R13) · ลายน้ำเดียวกับ PDF */
export async function receiptForScreen(db: Db, env: Env, receiptId: string): Promise<ReceiptData | null> {
  const src = await loadReceiptSource(db, receiptId);
  return src
    ? toReceiptData(src, companyFromEnv(env), { nationalId: "masked", watermark: env.RECEIPT_WATERMARK })
    : null;
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
type FileStatus = "none" | (typeof PDF_STATUSES)[number];

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

const autoRetry = (s: FileStatus) => s === "pending" || s === "failed";
const manualRetry = (s: FileStatus) => autoRetry(s) || s === "invalid";

/**
 * ไฟล์ที่ยังขาดของบิลนี้ — ready แล้วไม่แตะอีก (immutable)
 * invalid (ข้อมูลพิมพ์ไม่ได้) ทำซ้ำเองไม่หาย — ลองใหม่เฉพาะเมื่อคนสั่ง retry หลังแก้ข้อมูล (includeInvalid)
 */
export function missingFiles(
  r: Pick<ReceiptRow, "pdfStatus" | "idcardStatus" | "voidPdfStatus" | "status">,
  { includeInvalid = false } = {},
) {
  const wanted = includeInvalid ? manualRetry : autoRetry;
  const kinds: PdfKind[] = [];
  if (wanted(r.pdfStatus)) kinds.push("receipt");
  if (wanted(r.idcardStatus)) kinds.push("idcard");
  if (r.status === "void" && wanted(r.voidPdfStatus)) kinds.push("void");
  return kinds;
}

const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

type Outcome = { ok: true; key: string; sha256: string } | { ok: false; reason: string; permanent: boolean };

/** ล้มแบบลองใหม่ก็ไม่หาย (ข้อมูลบิล/ไฟล์ผิด) — สถานะ invalid ไม่เข้า retry อัตโนมัติ */
class PermanentPdfError extends Error {
  override name = "PermanentPdfError";
}

/** ReceiptDataError ของ @ong/core/receipt (ข้อมูลใบไม่ครบ/ขัดกัน) · RangeError จาก key = ข้อมูลผิด */
const isPermanent = (e: unknown) =>
  e instanceof PermanentPdfError || e instanceof ReceiptDataError || e instanceof RangeError;

/** เอกสารภาษีต้องมีหัวใบครบ — snapshot ที่ขาดช่อง = พิมพ์ไม่ได้ (ไม่เติมจากค่าปัจจุบัน) */
function assertCompleteHeader(h: CompanySnapshot, docNo: string): void {
  const missing = (["address", "tel", "tax_id"] as const).filter((k) => !h[k]?.trim());
  if (missing.length > 0) throw new ReceiptDataError(`ใบรับซื้อ ${docNo}: หัวใบไม่ครบ (${missing.join(", ")})`);
}

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
  /** RECEIPT_WATERMARK — ทุก environment ยกเว้น production */
  watermark?: string;
  log?: Pick<Console, "error" | "info">;
}

export interface ArchiveResult extends PdfStatuses {
  /** มีผู้เขียนอื่นถือ lease ของบิลนี้อยู่ — ไม่ได้ทำอะไร */
  busy: boolean;
}

export interface ReceiptPdfService {
  /** หลังบันทึก/ยกเลิกบิล — เข้าคิวเบื้องหลัง (พร้อมกันไม่เกินที่คิวกำหนด) request ไม่รอ */
  enqueue(receiptId: string): void;
  /**
   * สร้างไฟล์ที่ยังขาดของบิล — ผู้เขียนคนเดียวต่อบิลด้วย lease · มีคนถือ lease อยู่ = busy · ไม่มีบิล = null
   * manual (retry ที่คนสั่ง): ลองไฟล์ invalid ด้วย และไม่รอ backoff
   */
  archive(receiptId: string, opts?: { manual?: boolean }): Promise<ArchiveResult | null>;
  /** เข้าคิวบิลที่ค้าง pending/failed (พ้น backoff · ไม่มี lease · เก่ากว่า olderThanMs) — คืนจำนวนที่เข้าคิว */
  retryDue(opts?: { olderThanMs?: number; limit?: number }): Promise<number>;
}

/**
 * lease ต้องนานกว่างานหนึ่งรอบ (≤ 3 ไฟล์ × Gotenberg 30 วินาที + bucket) — ผู้ถือตาย/ค้าง lease หมดเอง ผู้อื่นทำต่อได้
 * ไฟล์ที่ผู้ถือเดิมอัปโหลดไปแล้วถูกรับมาใช้ (receipt-id + sha256 ตรง) ไม่ render ทับ
 */
const LEASE = sql`now() + interval '3 minutes'`;
/** ล้มชั่วคราวติดกัน: รอ 2 · 4 · 8 … นาที สูงสุด 1 ชั่วโมง — แถวที่เสียถาวรไม่แย่งคิว retry รอบละ 10 ใบ */
export const backoffMs = (attempts: number) => Math.min(60 * 60_000, 2 * 60_000 * 2 ** Math.max(0, attempts - 1));

export function createReceiptPdfService(deps: ReceiptPdfDeps): ReceiptPdfService {
  const { db, storage, renderer, company, fonts, tasks, now, watermark } = deps;
  const log = deps.log ?? console;

  async function render(kind: PdfKind, src: ReceiptSource): Promise<Uint8Array<ArrayBuffer>> {
    const { docNo, date } = src.receipt;
    const header = headerOf(src, company);
    if (kind === "idcard") {
      const photoKey = src.receipt.customerSnapshot.photo_key;
      const photo = photoKey ? await storage.get(photoKey) : null;
      if (!photo) throw new PermanentPdfError("customer ID card photo not found in storage");
      const ext = PHOTO_EXT[photo.contentType];
      if (!ext) throw new PermanentPdfError(`unsupported photo type ${photo.contentType}`);
      const name = `card.${ext}`;
      const html = renderIdCardHtml(
        { docNo, date, companyName: header.name, photoSrc: name, watermark },
        { fontBaseUrl: "" },
      );
      const files = [...fonts, { name, data: photo.body, contentType: photo.contentType }];
      return renderer.htmlToPdf({ html, files, trace: `${docNo}-idcard` });
    }
    assertCompleteHeader(header, docNo);
    // ฉบับเดิมพิมพ์เป็นบิลปกติเสมอ (แม้ถูกยกเลิกไปแล้ว) · ฉบับยกเลิกมีตรา + เหตุผล
    const data = toReceiptData(src, company, {
      nationalId: "full",
      status: kind === "void" ? "void" : "active",
      watermark,
    });
    const html = renderReceiptHtml(data, { fontBaseUrl: "" });
    return renderer.htmlToPdf({ html, files: fonts, trace: kind === "void" ? `${docNo}-void` : docNo });
  }

  const invalid = (reason: string, detail: string): Outcome => {
    log.error(`[pdf] !!! ${reason}: ${detail} — marked invalid, nothing overwritten`);
    return { ok: false, permanent: true, reason };
  };

  /**
   * ไฟล์ที่มีอยู่แล้วใน bucket = ของรอบก่อน (อัปโหลดแล้วแต่บันทึกผลไม่ทัน) — รับมาใช้ ไม่ render ทับ
   * เฉพาะเมื่อเป็นของบิลนี้ (receipt-id) และ byte ตรงกับ sha256 ที่เขียนไว้ตอนอัปโหลด — DB ที่ถูก restore
   * แต่ bucket ยังอยู่อาจมีเลขที่เอกสารซ้ำกับไฟล์ของบิลเก่า
   */
  function adopt(key: string, object: StoredObject, src: ReceiptSource): Outcome {
    const owner = object.metadata["receipt-id"];
    if (owner !== src.receipt.id) {
      return invalid(
        "archive key belongs to another bill",
        `${key} belongs to another bill (receipt-id ${owner ?? "missing"}, this bill ${src.receipt.id}) · ` +
          "check doc numbering / a database restore",
      );
    }
    const actual = sha256Hex(object.body);
    const written = object.metadata.sha256;
    if (written !== undefined && written !== actual) {
      return invalid("stored bytes do not match their sha256", `${key}: bytes ${actual} ≠ metadata ${written}`);
    }
    if (Buffer.from(object.body.subarray(0, 5)).toString("latin1") !== "%PDF-") {
      return invalid("stored object is not a PDF", `${key} is not a PDF`);
    }
    return { ok: true, key, sha256: actual };
  }

  async function produce(kind: PdfKind, src: ReceiptSource): Promise<Outcome> {
    // รหัสสาขาใน key มาจาก snapshot — key ของบิลคงที่ตลอดอายุเอกสาร
    const where = { branchCode: headerOf(src, company).branch_code, date: src.receipt.date, docNo: src.receipt.docNo };
    try {
      const key = kind === "idcard" ? idcardPdfKey(where) : receiptPdfKey({ ...where, void: kind === "void" });
      const stored = await storage.get(key);
      if (stored) return adopt(key, stored, src);
      const pdf = await render(kind, src);
      let sha256: string;
      try {
        ({ sha256 } = await putNew(storage, key, pdf, PDF_CONTENT_TYPE, { "receipt-id": src.receipt.id, kind }));
      } catch (e) {
        if (!(e instanceof ObjectExistsError)) throw e;
        const winner = await storage.get(key);
        if (!winner) throw e;
        return adopt(key, winner, src);
      }
      // ยืนยันหลังเขียน: object ที่ bucket มีตอนนี้ต้องเป็นของเราจริง (ผู้เขียนที่ lease หลุดอาจเขียนตัดหน้า
      // บน bucket ที่ไม่รองรับ If-None-Match) — ไม่ตรง = invalid ไม่บันทึก sha ที่ไม่ตรงกับไฟล์จริง
      const head = await storage.exists(key);
      if (head?.metadata["receipt-id"] !== src.receipt.id || head.metadata.sha256 !== sha256) {
        return invalid(
          "archive object changed right after upload",
          `${key}: expected receipt-id ${src.receipt.id} sha256 ${sha256}, bucket has ` +
            `${head?.metadata["receipt-id"] ?? "none"} / ${head?.metadata.sha256 ?? "none"}`,
        );
      }
      return { ok: true, key, sha256 };
    } catch (e) {
      const reason = reasonOf(e);
      const permanent = isPermanent(e);
      log.error(
        `[pdf] ${src.receipt.docNo} ${kind} ${permanent ? "invalid (fix data, then retry)" : "failed"}: ${reason}`,
      );
      return { ok: false, reason, permanent };
    }
  }

  function columnsFor(kind: PdfKind, out: Outcome, at: Date): PgUpdateSetSource<typeof buyReceipt> {
    if (kind === "receipt") {
      return out.ok
        ? { pdfKey: out.key, pdfSha256: out.sha256, pdfStatus: "ready", pdfGeneratedAt: at }
        : { pdfStatus: out.permanent ? "invalid" : "failed" };
    }
    if (kind === "idcard") {
      return out.ok
        ? { idcardPdfKey: out.key, idcardSha256: out.sha256, idcardStatus: "ready" }
        : { idcardStatus: out.permanent ? "invalid" : "failed" };
    }
    return out.ok
      ? { voidPdfKey: out.key, voidPdfSha256: out.sha256, voidPdfStatus: "ready", voidPdfGeneratedAt: at }
      : { voidPdfStatus: out.permanent ? "invalid" : "failed" };
  }

  const statusColumns = {
    pdfStatus: buyReceipt.pdfStatus,
    idcardStatus: buyReceipt.idcardStatus,
    voidPdfStatus: buyReceipt.voidPdfStatus,
  };

  async function archive(receiptId: string, { manual = false } = {}): Promise<ArchiveResult | null> {
    if (!z.uuid().safeParse(receiptId).success) return null;
    const wanted = manual ? (["pending", "failed", "invalid"] as const) : (["pending", "failed"] as const);
    const token = randomUUID();

    // (1) จอง — UPDATE เดียว atomic: ต้องมีงานจริง · ไม่มีใครถือ lease · งานอัตโนมัติต้องพ้น backoff
    const [claimed] = await db
      .update(buyReceipt)
      .set({ pdfLeaseToken: token, pdfLeaseUntil: LEASE })
      .where(
        and(
          eq(buyReceipt.id, receiptId),
          or(isNull(buyReceipt.pdfLeaseUntil), lt(buyReceipt.pdfLeaseUntil, sql`now()`)),
          or(
            inArray(buyReceipt.pdfStatus, wanted),
            inArray(buyReceipt.idcardStatus, wanted),
            and(eq(buyReceipt.status, "void"), inArray(buyReceipt.voidPdfStatus, wanted)),
          ),
          manual ? undefined : or(isNull(buyReceipt.pdfRetryAfter), lte(buyReceipt.pdfRetryAfter, sql`now()`)),
        ),
      )
      .returning({ id: buyReceipt.id });
    if (!claimed) {
      const [row] = await db
        .select({ ...statusColumns, leased: sql<boolean | null>`${buyReceipt.pdfLeaseUntil} > now()` })
        .from(buyReceipt)
        .where(eq(buyReceipt.id, receiptId))
        .limit(1);
      return row ? { ...statusesOf(row), busy: row.leased === true } : null;
    }

    const release = () =>
      db
        .update(buyReceipt)
        .set({ pdfLeaseToken: null, pdfLeaseUntil: null })
        .where(and(eq(buyReceipt.id, receiptId), eq(buyReceipt.pdfLeaseToken, token)));
    try {
      // (2) render + อัปโหลด — นอก transaction ใด ๆ
      const src = await loadReceiptSource(db, receiptId);
      if (!src) {
        await release();
        return null;
      }
      const set: PgUpdateSetSource<typeof buyReceipt> = {};
      let transient = false;
      for (const kind of missingFiles(src.receipt, { includeInvalid: manual })) {
        const out = await produce(kind, src);
        Object.assign(set, columnsFor(kind, out, now()));
        if (!out.ok && !out.permanent) transient = true;
      }
      const attempts = transient ? src.receipt.pdfAttempts + 1 : 0;
      Object.assign(set, {
        pdfAttempts: attempts,
        pdfRetryAfter: transient ? sql`now() + ${`${backoffMs(attempts) / 1000} seconds`}::interval` : null,
        pdfLeaseToken: null,
        pdfLeaseUntil: null,
      });

      // (3) บันทึกผล — เฉพาะเมื่อยังถือ lease อยู่ (หมดอายุแล้วมีผู้อื่นทำต่อ = ห้ามเขียนทับผลของเขา)
      const [recorded] = await db
        .update(buyReceipt)
        .set(set)
        .where(and(eq(buyReceipt.id, receiptId), eq(buyReceipt.pdfLeaseToken, token)))
        .returning(statusColumns);
      if (!recorded) {
        log.error(`[pdf] !!! ${src.receipt.docNo}: lease expired before recording — another writer took over`);
        const [row] = await db.select(statusColumns).from(buyReceipt).where(eq(buyReceipt.id, receiptId));
        return row ? { ...statusesOf(row), busy: true } : null;
      }
      return { ...statusesOf(recorded), busy: false };
    } catch (e) {
      // DB/อื่น ๆ ล้มกลางทาง — ปล่อย lease (ถ้ายังเป็นของเรา) รอบหน้าไม่ต้องรอ 3 นาที
      await release().catch(() => undefined);
      throw e;
    }
  }

  async function retryDue({ olderThanMs = 2 * 60_000, limit = 10 } = {}): Promise<number> {
    const cutoff = new Date(now().getTime() - olderThanMs);
    const waiting = ["pending", "failed"] as const;
    const due = await db
      .select({ id: buyReceipt.id })
      .from(buyReceipt)
      .where(
        and(
          or(
            and(inArray(buyReceipt.pdfStatus, waiting), lte(buyReceipt.createdAt, cutoff)),
            and(inArray(buyReceipt.idcardStatus, waiting), lte(buyReceipt.createdAt, cutoff)),
            and(inArray(buyReceipt.voidPdfStatus, waiting), lte(buyReceipt.voidedAt, cutoff)),
          ),
          or(isNull(buyReceipt.pdfRetryAfter), lte(buyReceipt.pdfRetryAfter, sql`now()`)),
          or(isNull(buyReceipt.pdfLeaseUntil), lt(buyReceipt.pdfLeaseUntil, sql`now()`)),
        ),
      )
      .orderBy(asc(buyReceipt.createdAt))
      .limit(limit);
    // ผ่านคิวเดียวกับงานหลังบันทึก — เคารพเพดานงานพร้อมกัน · บิลที่อยู่ในคิวแล้วไม่เข้าซ้ำ
    let queued = 0;
    for (const { id } of due) if (tasks.run(`pdf retry ${id}`, () => archive(id), id)) queued++;
    return queued;
  }

  return {
    enqueue: (receiptId) => void tasks.run(`pdf ${receiptId}`, () => archive(receiptId), receiptId),
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
      const queued = await pdf.retryDue({ olderThanMs, limit });
      if (queued > 0) log.info(`[pdf] retry: queued ${queued} receipt(s)`);
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
