import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { buyKeys } from "@/features/buy/queries";
import { apiFetch, decimalString } from "@/lib/api";
import { BranchSchema } from "@/lib/queries";

/**
 * สัญญาของ GET /api/buy (apps/api/src/routes/buy.ts · services/buy.ts `listBuys`)
 * อ่านเฉพาะสาขาที่มีสิทธิ์ (fail-closed) · หน้าละ 50 ใบ ใหม่สุดก่อน · เลขบัตรมาสก์มาจาก API แล้ว (R13)
 * status / pdf_status เป็นข้อความอิสระ — ค่าใหม่จาก API ต้องไม่ทำให้ทั้งหน้าพัง (คอลัมน์แสดงข้อความดิบแทน)
 */
const BillSchema = z.object({
  id: z.string(),
  /** อาจมีคำนำหน้าของสาขา เช่น "PT-RC6910-0002" */
  doc_no: z.string(),
  date: z.iso.date(),
  /** "HH:MM" เวลาไทย */
  time: z.string(),
  branch: BranchSchema.nullable(),
  customer: z.object({ id: z.string(), name_th: z.string(), national_id_masked: z.string() }),
  total_weight: decimalString,
  total_amount: decimalString,
  /** active · void */
  status: z.string(),
  /** pending · ready · failed · invalid */
  pdf_status: z.string(),
  created_by: z.object({ id: z.string(), name: z.string() }),
});
export type Bill = z.infer<typeof BillSchema>;

const BillListSchema = z.object({
  items: z.array(BillSchema),
  page: z.number().int(),
  has_more: z.boolean(),
  /** ยอดของทุกหน้าตามตัวกรองเดียวกัน เฉพาะบิลที่ยังไม่ยกเลิก — รวมใน SQL · หน้าเว็บแสดงอย่างเดียว ห้ามรวมเอง */
  totals: z.object({
    count: z.string().regex(/^\d+$/, "ต้องเป็นจำนวนเต็ม"),
    total_weight: decimalString,
    total_amount: decimalString,
  }),
});
export type BillListTotals = z.infer<typeof BillListSchema>["totals"];

/** ตัวกรองของ GET /api/buy — ไม่ใส่ = ไม่กรอง · ไม่มี branch_id = ทุกสาขาที่อ่านได้ · ไม่มี page = หน้า 1 */
export interface BuyListParams {
  /** ISO ค.ศ. */
  date_from?: string;
  date_to?: string;
  /** code ของโลหะ (gold · nak · silver · platinum) */
  metal?: string;
  /** ว่าง หรือยาว ≥ 2 ตัวอักษร (1 ตัว = 400) */
  q?: string;
  branch_id?: string;
  page?: number;
}

const FILTER_KEYS = ["date_from", "date_to", "metal", "q", "branch_id"] as const;

/**
 * เฉพาะตัวกรองที่ใช้จริง เรียงตามลำดับเดียวกันเสมอ — ค่าว่างไม่ใส่ · หน้า 1 ไม่ใส่ page
 * key จึงตรงกันทุกที่ที่ถามชุดเดียวกัน: การ์ดยอดซื้อวันนี้กับการ์ดบิลวันนี้ใช้ cache ก้อนเดียว (ยิงครั้งเดียว)
 */
function activeFilters(params: BuyListParams): BuyListParams {
  const filters: BuyListParams = {};
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (value) filters[key] = value;
  }
  if (params.page !== undefined && params.page > 1) filters.page = params.page;
  return filters;
}

function listPath(filters: BuyListParams): `/api/${string}` {
  const search = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value) search.set(key, value);
  }
  if (filters.page) search.set("page", String(filters.page));
  const query = search.toString();
  return query ? `/api/buy?${query}` : "/api/buy";
}

/**
 * รายการบิล + ยอดรวมทั้งตัวกรอง — แหล่งเดียวของ GET /api/buy (หน้าค้นบิล · การ์ดบิลวันนี้ · การ์ดยอดซื้อวันนี้)
 * key ขึ้นต้นด้วย buyKeys.lists(): บันทึกบิลใหม่แล้ว invalidate ["buy","list"] ทุกรายการโหลดใหม่เอง
 * placeholderData ไม่ใส่ที่นี่ — หน้าค้นบิลค้างผลเดิมระหว่างโหลดได้ แต่การ์ดยอดของสาขาห้ามโชว์ยอดของสาขา/วันก่อน
 */
export const buyListQuery = (params: BuyListParams) => {
  const filters = activeFilters(params);
  return queryOptions({
    queryKey: [...buyKeys.lists(), filters] as const,
    queryFn: ({ signal }) => apiFetch(listPath(filters), { signal, schema: BillListSchema }),
    staleTime: 15_000,
  });
};
