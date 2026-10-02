import { z } from "zod";
import { decimalString } from "@/lib/api";
import { BranchSchema } from "@/lib/queries";

/**
 * สัญญาของ POST /api/buy/quote และ POST /api/buy (apps/api/src/routes/buy.ts · services/buy.ts)
 * เงิน/น้ำหนักเป็นข้อความเสมอ ทั้งขาไปและขากลับ — หน้าเว็บไม่คำนวณเงินเอง (CLAUDE.md กฎ 1–2)
 */

/**
 * แถวที่พนักงานกรอก — ไม่มีราคา: เซิร์ฟเวอร์คิดจากราคาของวัน × น้ำหนัก × ค่าบริสุทธิ์ แล้วหัก % (UAT 30 ก.ย. 2569)
 * ทุกช่องเป็นข้อความ (API ปฏิเสธตัวเลข JSON)
 */
export interface QuoteLineInput {
  metal_id: string;
  weight_g: string;
  /** ค่าบริสุทธิ์ (%) 1–100 ทศนิยมไม่เกิน 2 ตำแหน่ง */
  purity_percent: string;
  /** หัก % เลขเต็ม "0"–"10" */
  deduct_percent: string;
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

/**
 * ผล quoteBuy() — errors ชี้ช่องแบบ "lines.0.purity_percent" · lines มีเฉพาะแถวที่ถูก (จับคู่ด้วย index)
 * ราคาทุกตัวของแถวคิดที่เซิร์ฟเวอร์ (assessBuyLine ใน @ong/core) — หน้าเว็บแสดงอย่างเดียว
 */
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
      /** รูปมาตรฐาน 2 ตำแหน่ง "96.50" */
      purity_percent: decimalString,
      /** เลขเต็ม "0"–"10" */
      deduct_percent: decimalString,
      /** ราคาตั้งต้นของวัน — ทอง/นาก บาทต่อบาททอง (ทองแท่งรับซื้อ) · เงิน/แพลตตินั่ม บาทต่อกรัม */
      base_price: decimalString,
      /** ราคาต่อกรัมหลังคิดค่าบริสุทธิ์ ก่อนหัก % */
      unit_price: decimalString,
      /** ยอดก่อนหัก % */
      gross_amount: decimalString,
      /** เงินที่หัก % */
      deduct_amount: decimalString,
      /** ยอดที่จ่ายจริงของแถว */
      amount: decimalString,
      /** amount ÷ น้ำหนัก (แสดงเท่านั้น) */
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
