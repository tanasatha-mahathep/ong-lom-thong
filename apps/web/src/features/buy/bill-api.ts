import type { ReceiptData } from "@ong/core/receipt";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiFetch, decimalString } from "@/lib/api";
import { buyKeys } from "./queries";

/**
 * บิลเดียว — GET /api/buy/:id (services/buy.ts `getBuy`) · เลขบัตรมาสก์เสมอ (R13)
 * `receipt` = ข้อมูลใบชุดเดียวกับที่สร้าง PDF (มากับ feat/api-pdf-wiring) · ยังไม่มี = ประกอบเองจากบิล (to-receipt-data)
 * สถานะไฟล์เป็นข้อความอิสระ (pending · ready · failed · invalid · none) — ค่าใหม่ไม่ทำให้หน้าพัง
 */
const ReceiptSchema = z.object({
  company: z.object({
    name: z.string(),
    address: z.string(),
    tel: z.string(),
    fax: z.string().nullable(),
    taxId: z.string(),
  }),
  branch: z.object({ name: z.string(), taxBranchCode: z.string().nullable() }),
  docNo: z.string(),
  date: z.iso.date(),
  time: z.string(),
  customer: z.object({ nameTh: z.string(), address: z.string().nullable(), nationalId: z.string() }),
  // ค่าบริสุทธิ์/หัก % พิมพ์ในชื่อรายการ ("ทอง 96.5% หัก 3%") — ต้องอยู่ใน schema ไม่งั้น zod ตัดทิ้ง ใบบนจอจะต่างจาก PDF
  lines: z.array(
    z.object({
      metalName: z.string(),
      weightG: decimalString,
      amount: decimalString,
      purityPercent: decimalString.nullish(),
      deductPercent: decimalString.nullish(),
    }),
  ),
  detail: z.string().nullable(),
  totalAmount: decimalString,
  payments: z.array(z.object({ label: z.string(), bank: z.string().nullable(), amount: decimalString })),
  status: z.enum(["active", "void"]),
  voidReason: z.string().nullish(),
  /** ลายน้ำของระบบทดสอบ ("ไม่ใช่ใบรับซื้อจริง") — production ไม่ส่ง */
  watermark: z.string().nullish(),
}) satisfies z.ZodType<ReceiptData>;

export const BillSchema = z.object({
  id: z.string(),
  doc_no: z.string(),
  date: z.iso.date(),
  time: z.string(),
  branch: z.object({ id: z.string(), code: z.string(), name: z.string(), tax_branch_code: z.string().nullable() }),
  customer: z.object({
    id: z.string(),
    name_th: z.string(),
    name_en: z.string().nullable(),
    address: z.string().nullable(),
    national_id_masked: z.string(),
  }),
  gold_price_snapshot: decimalString,
  detail: z.string().nullable(),
  lines: z.array(
    z.object({
      line_no: z.number().int(),
      metal: z.object({ id: z.string(), code: z.string(), name_th: z.string() }),
      weight_g: decimalString,
      /**
       * ราคาที่ระบบคิด (UAT 30 ก.ย. 2569) — null ทั้งชุด = บิลก่อนมีสูตรนี้ (ราคาพิมพ์เอง)
       * บริสุทธิ์ "96.50" · หัก % เลขเต็ม "3" · base = ราคาตั้งต้นของวัน · unit = ราคา/กรัมก่อนหัก · gross = ยอดก่อนหัก
       */
      purity_percent: decimalString.nullable(),
      deduct_percent: decimalString.nullable(),
      base_price: decimalString.nullable(),
      unit_price: decimalString.nullable(),
      gross_amount: decimalString.nullable(),
      amount: decimalString,
      price_per_g: decimalString,
    }),
  ),
  payments: z.array(
    z.object({ method: z.string(), method_label: z.string(), bank: z.string().nullable(), amount: decimalString }),
  ),
  total_weight: decimalString,
  total_amount: decimalString,
  avg_price_per_g: decimalString,
  status: z.enum(["active", "void"]),
  pdf_status: z.string(),
  idcard_status: z.string(),
  /** PDF ฉบับยกเลิก (none จนกว่าจะยกเลิกบิล) */
  void_pdf_status: z.string().default("none"),
  created_by: z.object({ id: z.string(), name: z.string() }),
  created_at: z.iso.datetime(),
  voided_at: z.iso.datetime().nullable(),
  void_reason: z.string().nullable(),
  /** ข้อมูลใบที่ API ประกอบให้ (ถ้ามี) — รูปผิด = ไม่ใช้ แล้วประกอบเอง ไม่ทำให้หน้าพัง */
  receipt: ReceiptSchema.nullish().catch(null),
});
export type Bill = z.infer<typeof BillSchema>;

/** ไฟล์ที่ยังรอสร้าง — หน้าบิลถามสถานะซ้ำเป็นระยะ */
export const isFilePending = (status: string) => status === "pending";

const POLL_MS = 3_000;
/** ถามสถานะ PDF ต่อได้นานเท่านี้หลังเริ่มสร้างไฟล์ — เกินแล้วให้ผู้ใช้กดตรวจเอง */
export const PDF_POLL_WINDOW_MS = 2 * 60_000;

/**
 * ยังควรถามสถานะไฟล์ซ้ำไหม — ใบต้นฉบับ/สำเนาบัตรนับหน้าต่าง 2 นาทีจาก created_at
 * ใบฉบับยกเลิกนับจาก voided_at แทน เพราะมักยกเลิกหลังสร้างบิลนานเกิน 2 นาทีไปแล้ว
 * นับจาก created_at เหมือนกันจะถือว่าเลยเวลาทันทีที่ยกเลิกเสร็จ ทั้งที่เพิ่งเริ่มสร้างไฟล์
 */
export const awaitingFilePoll = (
  bill: Pick<Bill, "pdf_status" | "idcard_status" | "void_pdf_status" | "created_at" | "voided_at">,
  updatedAt: number,
): boolean => {
  const withinWindow = (since: string) => updatedAt - Date.parse(since) < PDF_POLL_WINDOW_MS;
  const original = isFilePending(bill.pdf_status) || isFilePending(bill.idcard_status);
  const voidFile = isFilePending(bill.void_pdf_status);
  return (original && withinWindow(bill.created_at)) || (voidFile && withinWindow(bill.voided_at ?? bill.created_at));
};

export const billKeys = { detail: (id: string) => [...buyKeys.all, "detail", id] as const };

/** GET /api/buy/:id — 404 (ไม่มี/ไม่มีสิทธิ์ดู) = null · ไฟล์ยังรอสร้าง = ถามซ้ำทุก 3 วินาทีไม่เกิน 2 นาที */
export const billQuery = (id: string) =>
  queryOptions({
    queryKey: billKeys.detail(id),
    queryFn: async ({ signal }): Promise<Bill | null> => {
      try {
        return await apiFetch(`/api/buy/${encodeURIComponent(id)}`, { signal, schema: BillSchema });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    refetchInterval: (query) => {
      const bill = query.state.data;
      if (!bill) return false;
      return awaitingFilePoll(bill, query.state.dataUpdatedAt) ? POLL_MS : false;
    },
  });

/** POST /api/buy/:id/pdf/retry (ผู้จัดการขึ้นไป) — สร้างไฟล์ที่ล้มเหลว/ข้อมูลไม่ครบใหม่ */
export const retryPdf = (id: string) =>
  apiFetch(`/api/buy/${encodeURIComponent(id)}/pdf/retry`, { method: "POST", json: {}, schema: z.unknown() });

/** POST /api/buy/:id/void (ผู้จัดการขึ้นไป) — ยกเลิกบิล · เหตุผลบังคับ · ได้บิลที่ยกเลิกแล้วกลับมา */
export const voidBill = (id: string, reason: string) =>
  apiFetch(`/api/buy/${encodeURIComponent(id)}/void`, { method: "POST", json: { reason }, schema: BillSchema });
