import { D, ZERO, fmtMoney, thaiDate } from "@ong/core";
import { type Db, type PDF_STATUSES, auditLog, branch, buyReceipt } from "@ong/db";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { CSV_BOM } from "../lib/csv";
import { loggableError } from "../lib/log";
import { isArchiveSegment, sha256Hex } from "../lib/pdfArchive";
import type { BranchRef } from "../lib/scope";
import type { Storage } from "../lib/storage";
import { type ZipWriter, ZipClosedError, createDeterministicZip } from "../lib/zip";
import { purchaseCsv, purchaseReportIn } from "./reports";

/**
 * ส่งบัญชีรายเดือน (spec §9.4 · R13 · R15) — zip ของเดือนหนึ่ง: PDF ใบรับซื้อทุกบิล (รวมบิลที่ยกเลิก + ฉบับยกเลิก)
 * + purchase-report.csv (ฟังก์ชันเดียวกับ /reports/purchase?format=csv) + manifest.json (sha256) + README.txt
 *
 * - บิลของเดือน = buy_receipt.date อยู่ในเดือนนั้น · สาขาจาก reportBranches() (บัญชี/admin อ่านสาขาที่ปิดแล้วได้)
 * - รายการบิล · CSV · audit มาจากทรานแซกชัน repeatable read เดียวกัน — ตัวเลขใน manifest กับ CSV ตรงกันเสมอ
 * - ไฟล์ PDF ดึงจาก bucket ทีละไม่เกิน EXPORT_CONCURRENCY ไฟล์ ใส่ zip ตามลำดับ path เสมอ (ไม่ขึ้นกับว่าไฟล์ไหนมาก่อน)
 *   ทุกไฟล์ตรวจ sha256 กับค่าที่บันทึกตอนสร้างก่อนใส่ — ไม่ตรง/หาไม่พบ = ไม่ใส่ไฟล์ บอกสถานะใน manifest
 * - ไฟล์ที่ยังไม่พร้อม (pending · failed · invalid) อยู่ใน manifest พร้อมสถานะ ไม่มีไฟล์ — ดาวน์โหลดยังสำเร็จ
 * - bucket ล้ม/ช้าเกินงบเวลา = ยกเลิกทั้งไฟล์ (ดาวน์โหลดล้ม) — ไม่มี zip ที่ดูครบแต่ขาดไฟล์เพราะเหตุชั่วคราว
 * - สำเนาบัตรประชาชนไม่อยู่ใน zip นี้ (สิทธิ์แคบกว่า · spec §9.4) · ข้อมูลเดิม = byte เดิม (ไม่มีเวลาที่สร้างในไฟล์)
 */

/** ดึง PDF จาก bucket พร้อมกันได้กี่ไฟล์ — พอสำหรับหลักร้อยบิลต่อเดือน ไม่แย่ง connection กับงานสร้าง PDF */
export const EXPORT_CONCURRENCY = 6;
/**
 * เวลารวมที่ยอมรอ bucket ทั้งไฟล์ (ไม่นับเวลาที่รอฝั่งดาวน์โหลดรับข้อมูล) — ปกติหลักวินาที
 * แต่ละคำสั่งยังมี timeout ของ S3 client เอง (lib/storage.ts)
 */
export const EXPORT_STORAGE_TIMEOUT_MS = 120_000;

export const README_PATH = "README.txt";
export const CSV_PATH = "purchase-report.csv";
export const MANIFEST_PATH = "manifest.json";

// ---------- query ----------

const YEAR_MSG = "year ต้องเป็นปี ค.ศ. 4 หลัก เช่น 2026";
const MONTH_MSG = "month ต้องเป็นเดือน 1–12 เช่น 09";

export const ExportQuery = z.object({
  year: z
    .string({ error: YEAR_MSG })
    .regex(/^\d{4}$/, YEAR_MSG)
    .transform(Number)
    .refine((y) => y >= 2000, "year ต้องตั้งแต่ ค.ศ. 2000 (พ.ศ. 2543)"),
  month: z
    .string({ error: MONTH_MSG })
    .regex(/^(0?[1-9]|1[0-2])$/, MONTH_MSG)
    .transform(Number),
  /** เทียบกับรายการสาขาที่อ่านได้ในหน่วยความจำ — ไม่ส่งเข้า DB */
  branch_id: z.string().max(64, "branch_id ไม่ถูกต้อง").optional(),
});

export interface ExportPeriod {
  year: number;
  month: number;
  /** "YYYY-MM" */
  label: string;
  /** วันแรกของเดือน "YYYY-MM-DD" */
  from: string;
  /** วันสุดท้ายของเดือน "YYYY-MM-DD" (รวมวันนี้) */
  to: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function exportPeriod(year: number, month: number): ExportPeriod {
  // วันที่ 0 ของเดือนถัดไป = วันสุดท้ายของเดือนนี้ (ปฏิทินล้วน ไม่เกี่ยวกับเขตเวลา)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const label = `${year}-${pad2(month)}`;
  return { year, month, label, from: `${label}-01`, to: `${label}-${pad2(lastDay)}` };
}

/** ชื่อไฟล์ดาวน์โหลด — ASCII ล้วน · ส่ง branch_id = มีรหัสสาขาต่อท้าย */
export const exportFilename = (period: ExportPeriod, onlyBranch: BranchRef | null) =>
  `ong-export-${period.label}${onlyBranch ? `-${onlyBranch.code.replace(/[^A-Za-z0-9-]/g, "")}` : ""}.zip`;

// ---------- แผนของไฟล์ (จาก DB — snapshot เดียว) ----------

/** สถานะไฟล์ใน manifest = สถานะใน DB + ผลตรวจตอน export */
export type ExportFileStatus =
  | "none"
  | (typeof PDF_STATUSES)[number]
  /** ไฟล์ใน bucket ไม่ตรงกับ sha256 ที่บันทึกไว้ — ไม่ใส่ใน zip */
  | "sha_mismatch"
  /** DB ว่าพร้อมแต่ไม่มี key/sha256 หรือหาไฟล์ใน bucket ไม่พบ — ไม่ใส่ใน zip */
  | "missing";

interface ExportFile {
  /** ที่อยู่ใน zip */
  path: string;
  /** สถานะใน DB (pdf_status · void_pdf_status) */
  status: ExportFileStatus;
  key: string | null;
  /** sha256 ที่บันทึกไว้ตอนสร้างไฟล์ */
  sha256: string | null;
}

interface ExportBill {
  docNo: string;
  date: string;
  branchCode: string;
  status: "active" | "void";
  totalAmount: string;
  pdf: ExportFile;
  /** เฉพาะบิลที่ยกเลิก */
  voidPdf: ExportFile | null;
}

export interface MonthlyExportPlan {
  period: ExportPeriod;
  branches: BranchRef[];
  /** เรียงตามรหัสสาขา → เลขที่ (ลำดับของไฟล์ใน zip) */
  bills: ExportBill[];
  /** purchase-report.csv — เนื้อเดียวกับ /reports/purchase?format=csv ของเดือนและสาขาเดียวกัน */
  csv: string;
  totals: { total_weight: string; total_amount: string; void_total_amount: string };
}

/** เรียงแบบ byte (ไม่ใช้ collation ของ DB/locale) — ลำดับเดียวกันทุกเครื่อง */
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * อ่านทุกอย่างที่ต้องใช้จาก DB ใน snapshot เดียว + ลง audit export.monthly (ไม่มี PII) ในทรานแซกชันเดียวกัน
 * — ลงไม่ได้ = ไม่ส่งไฟล์ (ใบรับซื้อมีเลขบัตรเต็ม) · scope ต้องมาจาก reportBranches() (fail-closed) และไม่ว่าง
 */
export async function prepareMonthlyExport(
  db: Db,
  scope: BranchRef[],
  period: ExportPeriod,
  userId: string,
): Promise<MonthlyExportPlan> {
  return db.transaction(
    async (tx) => {
      const rows =
        scope.length === 0
          ? []
          : await tx
              .select({
                id: buyReceipt.id,
                docNo: buyReceipt.docNo,
                date: buyReceipt.date,
                branchCode: branch.code,
                status: buyReceipt.status,
                totalAmount: buyReceipt.totalAmount,
                pdfStatus: buyReceipt.pdfStatus,
                pdfKey: buyReceipt.pdfKey,
                pdfSha256: buyReceipt.pdfSha256,
                voidPdfStatus: buyReceipt.voidPdfStatus,
                voidPdfKey: buyReceipt.voidPdfKey,
                voidPdfSha256: buyReceipt.voidPdfSha256,
              })
              .from(buyReceipt)
              .innerJoin(branch, eq(branch.id, buyReceipt.branchId))
              .where(
                and(
                  inArray(
                    buyReceipt.branchId,
                    scope.map((b) => b.id),
                  ),
                  gte(buyReceipt.date, period.from),
                  lte(buyReceipt.date, period.to),
                ),
              );
      const report = await purchaseReportIn(tx, scope, { from: period.from, to: period.to, metal: null });

      const bills = rows
        .map((r): ExportBill => {
          // ชื่อไฟล์ใน zip มาจากรหัสสาขา + เลขที่ — ตรวจด้วยกฎเดียวกับ key ใน bucket (ไม่มีทางเป็น path อื่น)
          if (!isArchiveSegment(r.branchCode) || !isArchiveSegment(r.docNo)) {
            throw new Error(`export: bill ${r.id} has a branch code / doc no that cannot be a file name`);
          }
          const base = `receipts/${r.branchCode}/${r.docNo}`;
          return {
            docNo: r.docNo,
            date: r.date,
            branchCode: r.branchCode,
            status: r.status,
            totalAmount: fmtMoney(D(r.totalAmount)),
            pdf: { path: `${base}.pdf`, status: r.pdfStatus, key: r.pdfKey, sha256: r.pdfSha256 },
            voidPdf:
              r.status === "void"
                ? { path: `${base}_void.pdf`, status: r.voidPdfStatus, key: r.voidPdfKey, sha256: r.voidPdfSha256 }
                : null,
          };
        })
        .sort((a, b) => byCodeUnit(a.branchCode, b.branchCode) || byCodeUnit(a.docNo, b.docNo));

      await tx.insert(auditLog).values({
        userId,
        action: "export.monthly",
        tableName: "buy_receipt",
        rowId: period.label,
        diff: {
          year: period.year,
          month: period.month,
          branch_ids: scope.map((b) => b.id),
          bill_count: bills.length,
        },
      });

      const voided = bills.filter((b) => b.status === "void");
      return {
        period,
        branches: scope,
        bills,
        csv: purchaseCsv(report),
        totals: {
          total_weight: report.total.total_weight,
          total_amount: report.total.total_amount,
          void_total_amount: fmtMoney(voided.reduce((sum, b) => sum.plus(D(b.totalAmount)), ZERO)),
        },
      };
    },
    // เขียนแค่ audit_log (insert) — repeatable read ไม่ชนกับใคร
    { isolationLevel: "repeatable read" },
  );
}

// ---------- เขียน zip ----------

/** เวลารอ bucket เกินงบของทั้งไฟล์ */
export class ExportTimeoutError extends Error {
  override name = "ExportTimeoutError";
}

interface FileResult {
  status: ExportFileStatus;
  /** sha256 ที่บันทึกไว้ (ready = ตรงกับ byte ที่ใส่ใน zip) · null = ยังไม่มี */
  sha256: string | null;
  /** byte ที่ใส่ใน zip — null = ไม่ใส่ */
  body: Uint8Array | null;
}

/** ดึงไฟล์ที่ DB ว่าพร้อม แล้วตรวจ sha256 — error ของ bucket ส่งต่อ (ยกเลิกทั้งไฟล์ ไม่เดาว่าไฟล์หาย) */
async function fetchVerified(storage: Storage, file: ExportFile, log: Pick<Console, "error">): Promise<FileResult> {
  if (file.status !== "ready") return { status: file.status, sha256: file.sha256, body: null };
  if (!file.key || !file.sha256) {
    log.error(`[export] ${file.path}: marked ready without key/sha256 — listed as missing`);
    return { status: "missing", sha256: file.sha256, body: null };
  }
  const object = await storage.get(file.key);
  if (!object) {
    log.error(`[export] !!! ${file.key}: not found in storage — listed as missing`);
    return { status: "missing", sha256: file.sha256, body: null };
  }
  const actual = sha256Hex(object.body);
  if (actual !== file.sha256) {
    log.error(`[export] !!! ${file.key}: sha256 ${actual} ≠ recorded ${file.sha256} — excluded (sha_mismatch)`);
    return { status: "sha_mismatch", sha256: file.sha256, body: null };
  }
  return { status: "ready", sha256: actual, body: object.body };
}

/** งบเวลารอ bucket ของทั้งไฟล์ — นับเฉพาะช่วงที่รอผลจาก bucket (ไม่นับช่วงรอฝั่งดาวน์โหลด) */
function storageBudget(totalMs: number) {
  let left = totalMs;
  return async <T>(pending: Promise<T>): Promise<T> => {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ExportTimeoutError(`storage did not answer within ${totalMs} ms in total`)),
        Math.max(0, left),
      );
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      clearTimeout(timer);
      left -= performance.now() - started;
    }
  };
}

/**
 * ทำ run() กับทุกตัว พร้อมกันไม่เกิน limit แต่คืนผลตามลำดับเดิมเสมอ (ลำดับไฟล์ใน zip ไม่ขึ้นกับว่าใครเสร็จก่อน)
 * ถือผลค้างไว้ไม่เกิน limit ตัว — ไม่ดึงทั้งเดือนมากองในหน่วยความจำ
 */
async function* inOrder<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
  wait: (pending: Promise<R>) => Promise<R>,
): AsyncGenerator<{ item: T; result: R }> {
  const window: { item: T; pending: Promise<R> }[] = [];
  let next = 0;
  const fill = () => {
    while (window.length < limit && next < items.length) {
      const item = items[next++] as T;
      const pending = run(item);
      // รอตามลำดับข้างล่าง — ตัวที่ล้มก่อนถึงคิวต้องไม่กลายเป็น unhandled rejection
      pending.catch(() => undefined);
      window.push({ item, pending });
    }
  };
  fill();
  for (let head = window.shift(); head; head = window.shift()) {
    const result = await wait(head.pending);
    fill();
    yield { item: head.item, result };
  }
}

const utf8 = (text: string) => new TextEncoder().encode(text);

const fileEntry = (file: ExportFile, r: FileResult) => ({
  path: r.body ? file.path : null,
  sha256: r.sha256,
  status: r.status,
});

/** manifest.json — ลำดับ key คงที่ · เงินเป็น string · ไม่มีเวลาที่สร้าง (ข้อมูลเดิม = byte เดิม) */
function manifestJson(plan: MonthlyExportPlan, results: Map<ExportFile, FileResult>, csvSha256: string): string {
  const resultOf = (file: ExportFile) => {
    const r = results.get(file);
    if (!r) throw new Error(`export: no result for ${file.path}`);
    return r;
  };
  const files = plan.bills.flatMap((b) => (b.voidPdf ? [b.pdf, b.voidPdf] : [b.pdf]));
  const included = files.filter((f) => resultOf(f).body !== null).length;
  const voided = plan.bills.filter((b) => b.status === "void").length;
  const manifest = {
    manifest_version: 1,
    year: plan.period.year,
    month: plan.period.month,
    generated_for: { branches: plan.branches.map((b) => ({ id: b.id, code: b.code, name: b.name })) },
    purchase_report: { path: CSV_PATH, sha256: csvSha256 },
    bills: plan.bills.map((b) => ({
      doc_no: b.docNo,
      date: b.date,
      branch_code: b.branchCode,
      status: b.status,
      total_amount: b.totalAmount,
      pdf: fileEntry(b.pdf, resultOf(b.pdf)),
      void_pdf: b.voidPdf ? fileEntry(b.voidPdf, resultOf(b.voidPdf)) : null,
    })),
    counts: {
      bills: plan.bills.length,
      active: plan.bills.length - voided,
      void: voided,
      pdf_expected: files.length,
      pdf_included: included,
      pdf_not_included: files.length - included,
    },
    totals: plan.totals,
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** README.txt ภาษาไทย — UTF-8 + BOM + CRLF (Notepad บน Windows อ่านไทยถูก) */
function readmeText(plan: MonthlyExportPlan): string {
  const { period } = plan;
  const lines = [
    "ไฟล์ส่งฝ่ายบัญชีประจำเดือน — ระบบซื้อเข้าหน้าร้าน โอเอ็นจี หลอมทอง",
    `งวด ${period.label}: บิลที่ลงวันที่ ${thaiDate(period.from)} ถึง ${thaiDate(period.to)}`,
    `สาขา: ${plan.branches.map((b) => `${b.code} ${b.name}`).join(", ")}`,
    "",
    "ในไฟล์นี้มีอะไร",
    "1. receipts/<รหัสสาขา>/<เลขที่>.pdf",
    "   ใบรับซื้อของเก่าฉบับที่ระบบเก็บถาวรไว้ตอนบันทึกบิล (ไฟล์เดียวกับที่เปิดจากหน้าบิล ไม่ได้สร้างใหม่)",
    "   มีทุกบิลของเดือน ทั้งบิลปกติและบิลที่ยกเลิกแล้ว",
    "2. receipts/<รหัสสาขา>/<เลขที่>_void.pdf",
    '   ฉบับยกเลิก (มีตรา "ยกเลิก" และเหตุผล) — เฉพาะบิลที่ยกเลิก คู่กับฉบับเดิมในข้อ 1',
    "3. purchase-report.csv",
    "   รายงานยอดซื้อของเดือน ชุดเดียวกับปุ่มดาวน์โหลด CSV ในหน้ารายงานยอดซื้อ — นับเฉพาะบิลที่ไม่ถูกยกเลิก",
    "   เปิดด้วย Excel ได้ภาษาไทย (UTF-8) · เลขบัตรประชาชนปิดบังไว้",
    "4. manifest.json",
    "   รายการบิลทุกใบของเดือน (เรียงตามสาขาแล้วเลขที่): เลขที่ · วันที่ · สาขา · สถานะบิล · ยอดเงิน · ไฟล์ PDF",
    "   และค่า sha256 ของแต่ละไฟล์",
    "   counts = จำนวนบิลและไฟล์ (pdf_not_included ต้องเป็น 0 จึงครบทุกไฟล์)",
    '   totals = ยอดรวม: total_weight / total_amount = บิลปกติ ตรงกับแถว "รวมทั้งสิ้น" ใน CSV',
    "            void_total_amount = ยอดของบิลที่ยกเลิก (ไม่นับในรายงาน)",
    "",
    "สถานะไฟล์ใน manifest.json (status)",
    "- ready         มีไฟล์ใน zip และตรวจแล้วว่า sha256 ตรงกับที่ระบบบันทึกไว้ตอนสร้างไฟล์",
    "- pending       ระบบยังสร้าง PDF ไม่เสร็จ — ไม่มีไฟล์ใน zip · ดาวน์โหลดใหม่ภายหลัง",
    "- failed        สร้าง PDF ไม่สำเร็จชั่วคราว ระบบลองใหม่เอง — ไม่มีไฟล์ใน zip · ดาวน์โหลดใหม่ภายหลัง",
    "- invalid       ข้อมูลบิลพิมพ์เป็น PDF ไม่ได้ ต้องให้ผู้ดูแลระบบแก้ — ไม่มีไฟล์ใน zip",
    "- sha_mismatch  ไฟล์ที่เก็บไว้ไม่ตรงกับ sha256 ที่บันทึกไว้ (อาจถูกแก้หรือเสียหาย) — ไม่ใส่ใน zip · แจ้งผู้ดูแลระบบทันที",
    "- missing       ระบบบันทึกว่ามีไฟล์ แต่หาไฟล์ในที่เก็บไม่พบ — ไม่มีไฟล์ใน zip · แจ้งผู้ดูแลระบบทันที",
    "path = ตำแหน่งไฟล์ใน zip (null = ไม่มีไฟล์ใน zip) · sha256 = ค่าที่ระบบบันทึกไว้ (null = ยังไม่มีไฟล์)",
    "บิลที่ไม่มีไฟล์ยังอยู่ใน manifest เสมอ พร้อมสถานะ",
    "",
    "วิธีตรวจว่าไฟล์ไม่ถูกแก้ไข (sha256)",
    "คำนวณ sha256 ของไฟล์ แล้วเทียบกับค่า sha256 ของไฟล์นั้นใน manifest.json — ต้องตรงกันทุกตัวอักษร",
    "- Windows (PowerShell):      Get-FileHash .\\receipts\\<รหัสสาขา>\\<เลขที่>.pdf -Algorithm SHA256",
    "                             (แสดงเป็นตัวพิมพ์ใหญ่ — เทียบโดยไม่สนตัวพิมพ์เล็ก/ใหญ่)",
    "- Windows (Command Prompt):  certutil -hashfile receipts\\<รหัสสาขา>\\<เลขที่>.pdf SHA256",
    "- macOS:                     shasum -a 256 receipts/<รหัสสาขา>/<เลขที่>.pdf",
    "- Linux:                     sha256sum receipts/<รหัสสาขา>/<เลขที่>.pdf",
    "purchase-report.csv ตรวจแบบเดียวกันกับค่า purchase_report.sha256 ใน manifest.json",
    "",
    "หมายเหตุ",
    "- ดาวน์โหลดเดือนเดิมซ้ำโดยข้อมูลไม่เปลี่ยน จะได้ไฟล์ zip เหมือนเดิมทุก byte",
    "  (เวลาของไฟล์ใน zip ตั้งเป็นวันที่ 1 ของเดือน 00:00 ทุกไฟล์ ไม่ใช่เวลาที่ดาวน์โหลด)",
    "- สำเนาบัตรประชาชนไม่อยู่ในไฟล์นี้ (สิทธิ์เข้าถึงแคบกว่า) — ขอแยกต่างหาก",
    "- ใบรับซื้อใน receipts/ มีเลขบัตรประชาชนเต็มของลูกค้า — เก็บเป็นความลับตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล",
  ];
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

export interface ExportStreamOptions {
  concurrency?: number;
  storageTimeoutMs?: number;
  log?: Pick<Console, "error" | "warn">;
}

async function writeExport(
  zip: ZipWriter,
  plan: MonthlyExportPlan,
  storage: Storage,
  { concurrency, storageTimeoutMs, log }: Required<ExportStreamOptions>,
): Promise<void> {
  const csv = utf8(plan.csv);
  await zip.add(README_PATH, utf8(readmeText(plan)));
  await zip.add(CSV_PATH, csv);

  // ใบเดิมก่อนฉบับยกเลิกของบิลเดียวกัน — ตรงกับลำดับ path (".pdf" < "_void.pdf")
  const files = plan.bills.flatMap((b) => (b.voidPdf ? [b.pdf, b.voidPdf] : [b.pdf]));
  const results = new Map<ExportFile, FileResult>();
  const wait = storageBudget(storageTimeoutMs);
  for await (const { item, result } of inOrder(files, concurrency, (f) => fetchVerified(storage, f, log), wait)) {
    if (result.body) await zip.add(item.path, result.body);
    results.set(item, result);
  }
  // manifest ท้ายสุด — เขียนหลังตรวจทุกไฟล์แล้ว จึงบอกตรงกับสิ่งที่อยู่ใน zip จริง
  await zip.add(MANIFEST_PATH, utf8(manifestJson(plan, results, sha256Hex(csv))));
  zip.end();
}

/**
 * zip ของแผนนี้เป็น stream — เริ่มไหลทันที ไม่รอดึงไฟล์ครบ · ล้มกลางทาง = stream error (ดาวน์โหลดล้ม ไฟล์ขาดท้าย)
 * ผู้เรียกลง audit ไว้แล้วใน prepareMonthlyExport()
 */
export function streamMonthlyExport(
  plan: MonthlyExportPlan,
  storage: Storage,
  opts: ExportStreamOptions = {},
): ReadableStream<Uint8Array> {
  const log = opts.log ?? console;
  const zip = createDeterministicZip({ date: plan.period.from });
  writeExport(zip, plan, storage, {
    concurrency: opts.concurrency ?? EXPORT_CONCURRENCY,
    storageTimeoutMs: opts.storageTimeoutMs ?? EXPORT_STORAGE_TIMEOUT_MS,
    log,
  }).catch((e: unknown) => {
    if (e instanceof ZipClosedError) {
      log.warn(`[export] ${plan.period.label}: download closed before the archive was complete`);
      return;
    }
    log.error(`[export] !!! ${plan.period.label} aborted:`, loggableError(e));
    zip.abort(e instanceof Error ? e : new Error(String(e)));
  });
  return zip.body;
}
