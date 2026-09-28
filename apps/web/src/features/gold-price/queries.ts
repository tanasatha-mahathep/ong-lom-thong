import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiFetch, decimalString } from "@/lib/api";
import { GoldPriceTodaySchema } from "@/lib/queries";

const GoldPriceQuoteSchema = z.object({
  bar_sell: decimalString,
  bar_buy: decimalString,
  jewelry_buy: decimalString,
  /** ด่านกันพิมพ์ผิด — ราคาห่างจากราคากลางครั้งก่อนเกินเกณฑ์ (ข้อความจากเซิร์ฟเวอร์) */
  warning: z.string().optional(),
});

/**
 * live preview — POST /api/gold-price/quote ใช้ quoteGoldPrice() ตัวเดียวกับตอนบันทึก (CLAUDE.md กฎ 2 · R8)
 * browser ไม่คำนวณราคาเอง · key = ข้อความที่จะส่ง · ข้อความว่างไม่ถาม
 */
export const goldPriceQuoteQueryOptions = (barSell: string) =>
  queryOptions({
    queryKey: ["gold-price", "quote", barSell],
    queryFn: ({ signal }) =>
      apiFetch("/api/gold-price/quote", { json: { bar_sell: barSell }, signal, schema: GoldPriceQuoteSchema }),
    enabled: barSell !== "",
  });

export interface SaveGoldPriceBody {
  bar_sell: string;
  /** ยืนยันราคาที่ด่านกันพิมพ์ผิดเตือนไว้ (ส่งหลังได้ 409) */
  confirm_typo?: boolean;
}

/** ตั้งราคากลางของวันนี้ — PUT /api/gold-price/today (manager · admin) · audit ฝั่งเซิร์ฟเวอร์ (R12) */
export const saveGoldPrice = (body: SaveGoldPriceBody) =>
  apiFetch("/api/gold-price/today", { method: "PUT", json: body, schema: GoldPriceTodaySchema });

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
  return error instanceof ApiError && error.status === 400 && error.field === "bar_sell" ? error.error : null;
}
