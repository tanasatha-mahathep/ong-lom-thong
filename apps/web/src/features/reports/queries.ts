import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch, decimalString } from "@/lib/api";
import { BranchSchema } from "@/lib/queries";

/** จำนวนเต็มที่ API ส่งเป็นข้อความ (เช่น จำนวนบิล) */
const countString = z.string().regex(/^\d+$/, "ต้องเป็นข้อความจำนวนเต็ม");

const MetalAmountSchema = z.object({
  metal_code: z.string(),
  name_th: z.string(),
  /** Σ น้ำหนัก 3 ตำแหน่ง */
  grams: decimalString,
  /** Σ ราคารับซื้อ 2 ตำแหน่ง */
  amount: decimalString,
});

const PurchaseTotalsSchema = z.object({
  count: countString,
  total_weight: decimalString,
  total_amount: decimalString,
  by_metal: z.array(MetalAmountSchema),
});

const PurchaseRowSchema = z.object({
  no: z.number().int(),
  id: z.string(),
  date: z.iso.date(),
  time: z.string(),
  doc_no: z.string(),
  branch: BranchSchema,
  /** ชื่อจาก snapshot ตอนเปิดบิล · เลขบัตรมาสก์จากเซิร์ฟเวอร์เสมอ (R13) */
  customer: z.object({ id: z.string(), name_th: z.string(), national_id_masked: z.string() }),
  metals: z.array(MetalAmountSchema),
  total_weight: decimalString,
  total_amount: decimalString,
  created_by: z.object({ id: z.string(), name: z.string() }),
});
export type PurchaseRow = z.infer<typeof PurchaseRowSchema>;

/**
 * GET /api/reports/purchase — ยอดทุกตัว (ต่อบิล · ต่อสาขา · ต่อโลหะ · รวมทั้งสิ้น) เป็น SUM ของ numeric ใน Postgres
 * จาก snapshot เดียวกัน · browser แสดงอย่างเดียว ไม่รวมเอง (CLAUDE.md กฎ 1–2)
 */
const PurchaseReportSchema = z.object({
  date_from: z.iso.date(),
  date_to: z.iso.date(),
  metal: z.string().nullable(),
  rows: z.array(PurchaseRowSchema),
  by_branch: z.array(PurchaseTotalsSchema.extend({ branch: BranchSchema })),
  total: PurchaseTotalsSchema,
});
export type PurchaseReport = z.infer<typeof PurchaseReportSchema>;

/** ตัวกรองที่ส่ง API — วันที่ครบเสมอ (ค่าเริ่มต้นคิดที่หน้า) · โลหะ/สาขาไม่ส่ง = ทั้งหมดที่มีสิทธิ์ */
export interface PurchaseParams {
  date_from: string;
  date_to: string;
  metal?: string;
  branch_id?: string;
}

/** query string ลำดับคงที่ — ตัวเดียวกันทั้ง fetch (JSON) และลิงก์ CSV จึงได้ตัวเลขชุดเดียวกันเสมอ */
function purchaseQuery(p: PurchaseParams, format?: "csv"): string {
  const query = new URLSearchParams({ date_from: p.date_from, date_to: p.date_to });
  if (p.metal) query.set("metal", p.metal);
  if (p.branch_id) query.set("branch_id", p.branch_id);
  if (format) query.set("format", format);
  return query.toString();
}

/** ลิงก์ดาวน์โหลด CSV (UTF-8 + BOM) — origin เดียวกัน cookie session ไปเอง · ไม่มี public URL */
export const purchaseCsvHref = (p: PurchaseParams) => `/api/reports/purchase?${purchaseQuery(p, "csv")}`;

export const purchaseReportQueryOptions = (p: PurchaseParams) =>
  queryOptions({
    queryKey: ["reports", "purchase", p],
    queryFn: ({ signal }) =>
      apiFetch(`/api/reports/purchase?${purchaseQuery(p)}`, { signal, schema: PurchaseReportSchema }),
  });

const MetalSchema = z.object({
  id: z.string(),
  code: z.string(),
  name_th: z.string(),
  unit: z.string(),
  assessment_enabled: z.boolean(),
});

/** โลหะที่รับซื้อ ตามลำดับของร้าน — GET /api/metals (แทบไม่เปลี่ยน) */
export const metalsQueryOptions = queryOptions({
  queryKey: ["metals"],
  queryFn: ({ signal }) => apiFetch("/api/metals", { signal, schema: z.array(MetalSchema) }),
  staleTime: 30 * 60_000,
});
