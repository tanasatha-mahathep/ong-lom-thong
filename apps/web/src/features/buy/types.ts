import { z } from "zod";
import { decimalString } from "@/lib/api";
import { BranchSchema } from "@/lib/queries";

/**
 * สัญญาของ POST /api/buy/quote และ POST /api/buy (apps/api/src/routes/buy.ts · services/buy.ts)
 * เงิน/น้ำหนักเป็นข้อความเสมอ ทั้งขาไปและขากลับ — หน้าเว็บไม่คำนวณเงินเอง (CLAUDE.md กฎ 1–2)
 */

export interface QuoteLineInput {
  metal_id: string;
  weight_g: string;
  amount: string;
}

/** โอนต้องมีธนาคาร · เงินสดห้ามส่งคีย์ bank (API ตอบ error ต่อแถว) */
export type QuotePaymentInput =
  { method: "cash"; amount: string } | { method: "transfer"; bank: string; amount: string };

/** ช่องที่ว่าง = ไม่ส่งคีย์ (API ถือว่า "" = ไม่ได้กรอกอยู่แล้ว แต่ไม่ส่งชัดกว่า) */
export interface QuoteBody {
  /** ISO ค.ศ. — เฉพาะบิลย้อนหลัง (ไม่ส่ง = วันนี้ตามเวลาไทย) */
  date?: string;
  customer_id?: string;
  /** บังคับเมื่อ date < วันนี้ (5–500 ตัวอักษร) */
  backdate_reason?: string;
  lines: QuoteLineInput[];
  payments: QuotePaymentInput[];
}

export interface SaveBody extends QuoteBody {
  /** "HH:MM" — บิลย้อนหลังต้องมี · ไม่ส่ง = เวลาที่เซิร์ฟเวอร์บันทึก */
  time?: string;
  detail?: string;
  full_tax: false;
  idempotency_key: string;
}

const QuoteErrorSchema = z.object({ field: z.string(), message: z.string() });
export type QuoteError = z.infer<typeof QuoteErrorSchema>;

/** ผล quoteBuy() — errors ชี้ช่องแบบ "lines.0.amount" · lines มีเฉพาะแถวที่ถูก (จับคู่ด้วย index) */
export const QuoteSchema = z.object({
  ok: z.boolean(),
  errors: z.array(QuoteErrorSchema),
  date: z.iso.date(),
  branch: BranchSchema,
  gold_price_snapshot: decimalString.nullable(),
  lines: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      metal_id: z.string(),
      weight_g: decimalString,
      amount: decimalString,
      price_per_g: decimalString,
    }),
  ),
  // แถวชำระรูปมาตรฐาน (ตัดคอมมา · ปัด 2 ตำแหน่ง) — จับคู่กับ state.payments ด้วย index เหมือน lines
  payments: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      method: z.enum(["cash", "transfer"]),
      bank: z.string().nullable(),
      amount: decimalString,
    }),
  ),
  total_weight: decimalString,
  total_amount: decimalString,
  avg_price_per_g: decimalString,
  paid: decimalString,
  balance: decimalString,
});
export type Quote = z.infer<typeof QuoteSchema>;

/** 201 = บิลใหม่ · 200 = ส่งซ้ำด้วย idempotency_key เดิม (ได้บิลเดิม) */
export const SavedBuySchema = z.object({ id: z.string(), doc_no: z.string(), pdf_status: z.string() });
export type SavedBuy = z.infer<typeof SavedBuySchema>;

export const MetalSchema = z.object({ id: z.string(), code: z.string(), name_th: z.string() });
export type Metal = z.infer<typeof MetalSchema>;
