import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiFetch, decimalString } from "@/lib/api";
import { BranchSchema, GoldPriceTodaySchema } from "@/lib/queries";

/**
 * ราคารับซื้อต่อกรัมของเงิน/แพลตตินั่ม (UAT 30 ก.ย. 2569) — ตั้งที่ราคากลางเท่านั้น ทุกสาขาใช้ร่วม
 * ไม่มีคีย์ = คงค่าเดิมของวันนี้ · null = ล้าง (วันนี้รับซื้อโลหะนั้นไม่ได้) · ข้อความตัวเลข = ตั้งใหม่
 */
export const PER_GRAM_FIELDS = ["silver_per_g", "platinum_per_g"] as const;
export type PerGramField = (typeof PER_GRAM_FIELDS)[number];
export type PerGramBody = Partial<Record<PerGramField, string | null>>;

const GoldPriceQuoteSchema = z.object({
  bar_sell: decimalString,
  bar_buy: decimalString,
  jewelry_buy: decimalString,
  /** มีเฉพาะราคาต่อกรัมที่ส่งไป — รูปมาตรฐาน "45.50" · null = จะล้าง */
  silver_per_g: decimalString.nullable().optional(),
  platinum_per_g: decimalString.nullable().optional(),
  /** ด่านกันพิมพ์ผิด — ราคาห่างจากราคาที่ใช้ครั้งก่อนเกินเกณฑ์ (ข้อความจากเซิร์ฟเวอร์ · หลายราคาต่อกันด้วย " · ") */
  warning: z.string().optional(),
});
export type GoldPriceQuote = z.infer<typeof GoldPriceQuoteSchema>;

/**
 * live preview — POST /api/gold-price/quote ใช้ quoteGoldPrice() ตัวเดียวกับตอนบันทึก (CLAUDE.md กฎ 2 · R8)
 * browser ไม่คำนวณราคาเอง · key = ข้อความที่จะส่ง · ข้อความว่างไม่ถาม
 * `branchId` = กำลังตั้งราคาเฉพาะสาขา — คำเตือนเทียบราคาที่สาขานั้นใช้ครั้งก่อน เหมือนตอนบันทึก
 */
export const goldPriceQuoteQueryOptions = (barSell: string, branchId?: string, perGram: PerGramBody = {}) =>
  queryOptions({
    queryKey: ["gold-price", "quote", barSell, branchId ?? null, perGram],
    queryFn: ({ signal }) =>
      apiFetch("/api/gold-price/quote", {
        json: { bar_sell: barSell, ...(branchId ? { branch_id: branchId } : {}), ...perGram },
        signal,
        schema: GoldPriceQuoteSchema,
      }),
    enabled: barSell !== "",
  });

/** ประกาศของสมาคมที่ใช้เติมช่องราคา */
export interface ReferencePrefill {
  announced_at: string;
  round: number | null;
}

export interface SaveGoldPriceBody extends PerGramBody {
  bar_sell: string;
  /** ยืนยันราคาที่ด่านกันพิมพ์ผิดเตือนไว้ (ส่งหลังได้ 409) */
  confirm_typo?: boolean;
  /**
   * ราคาในช่องมาจากปุ่ม "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" และไม่ได้แก้ — ประกาศที่เติมมา
   * เซิร์ฟเวอร์ลง audit เป็นคำอ้างของ client คู่กับราคาสมาคมที่เซิร์ฟเวอร์เห็นเอง
   */
  from_reference?: ReferencePrefill;
}

/** ตั้งราคากลางของวันนี้ — PUT /api/gold-price/today (manager · admin) · audit ฝั่งเซิร์ฟเวอร์ (R12) */
export const saveGoldPrice = (body: SaveGoldPriceBody) =>
  apiFetch("/api/gold-price/today", { method: "PUT", json: body, schema: GoldPriceTodaySchema });

/** ราคาวันนี้ของหนึ่งสาขา — null ทั้งแถว = ยังไม่มีทั้งราคาเฉพาะสาขาและราคากลาง */
const BranchGoldPriceSchema = z.object({
  branch: BranchSchema,
  bar_sell: decimalString.nullable(),
  bar_buy: decimalString.nullable(),
  jewelry_buy: decimalString.nullable(),
  /** "branch" = ราคาเฉพาะสาขา · "central" = ใช้ราคากลาง · null = ยังไม่ได้ตั้ง */
  source: z.enum(["branch", "central"]).nullable(),
});
export type BranchGoldPrice = z.infer<typeof BranchGoldPriceSchema>;

/**
 * ราคาวันนี้ของทุกสาขาที่บัญชีนี้จัดการได้ — GET /api/gold-price/today/branches
 * key อยู่ใต้ ["gold-price", "today"] (key ของ goldPriceTodayQueryOptions) — บันทึกราคากลาง/ราคาสาขาแล้ว
 * invalidate key นั้นครั้งเดียว ได้ทั้งราคาบนหัวหน้า การ์ดราคาที่ใช้อยู่ และตารางนี้
 */
export const goldPriceBranchesQueryOptions = queryOptions({
  queryKey: ["gold-price", "today", "branches"],
  queryFn: ({ signal }) =>
    apiFetch("/api/gold-price/today/branches", { signal, schema: z.array(BranchGoldPriceSchema) }),
});

const branchPricePath = (branchId: string) => `/api/gold-price/today/branches/${encodeURIComponent(branchId)}` as const;

/** ตั้งราคาเฉพาะสาขาของวันนี้ — PUT (manager · admin) · ด่านกันพิมพ์ผิดเหมือนราคากลาง */
export const saveBranchGoldPrice = ({ branchId, ...body }: SaveGoldPriceBody & { branchId: string }) =>
  apiFetch(branchPricePath(branchId), { method: "PUT", json: body, schema: BranchGoldPriceSchema });

/** ยกเลิกราคาเฉพาะสาขาของวันนี้ → สาขากลับไปใช้ราคากลาง — DELETE (ไม่มีให้ลบก็ได้ 200) */
export const clearBranchGoldPrice = (branchId: string) =>
  apiFetch(branchPricePath(branchId), { method: "DELETE", schema: BranchGoldPriceSchema });

const TypoConflictSchema = z.object({ warning: z.string().min(1) });

/**
 * 409 ของด่านกันพิมพ์ผิด → ข้อความเตือนจากเซิร์ฟเวอร์ · error อื่น = null
 * สัญญา (#60): `{error, field: "confirm_typo", warning}` — ใช้ `warning` ก่อน ไม่มีจึงใช้ `error` (ข้อความเดียวกัน)
 */
export function typoWarningOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const conflict = TypoConflictSchema.safeParse(error.body);
  if (conflict.success) return conflict.data.warning;
  return error.field === "confirm_typo" && error.error ? error.error : null;
}

/** 400 ที่ชี้ช่อง bar_sell → ข้อความใต้ช่องราคา · error อื่น = null */
export function barSellErrorOf(error: unknown): string | null {
  return fieldErrorOf(error, "bar_sell");
}

/** 400 ที่ชี้ช่องนั้นพอดี (bar_sell · silver_per_g · platinum_per_g) → ข้อความไทยของเซิร์ฟเวอร์ · อื่น ๆ = null */
export function fieldErrorOf(error: unknown, field: "bar_sell" | PerGramField): string | null {
  return error instanceof ApiError && error.status === 400 && error.field === field ? error.error : null;
}

/** 400 ที่ชี้ช่องราคาต่อกรัมช่องใดช่องหนึ่ง → ชื่อช่อง · อื่น ๆ = null */
export function perGramFieldOf(error: unknown): PerGramField | null {
  return PER_GRAM_FIELDS.find((field) => fieldErrorOf(error, field) !== null) ?? null;
}
