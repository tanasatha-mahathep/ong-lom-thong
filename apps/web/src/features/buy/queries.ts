import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { MetalSchema, type QuoteBody, QuoteSchema } from "./types";

/** query key ของบิลซื้อเข้า — สลับสาขาแล้ว invalidate ทั้งหมดอยู่แล้ว จึงไม่ใส่ branch id */
export const buyKeys = {
  all: ["buy"] as const,
  quotes: () => [...buyKeys.all, "quote"] as const,
  /** key = payload ทั้งก้อน: คำตอบที่มาช้าของ payload เก่าลง cache ของมันเอง ไม่มีทางเปิดปุ่มบันทึกผิดบิล */
  quote: (body: QuoteBody) => [...buyKeys.quotes(), body] as const,
  lists: () => [...buyKeys.all, "list"] as const,
};

/**
 * POST /api/buy/quote — ยอด ราคา/กรัม คงเหลือ และ error ต่อช่อง จาก quoteBuy() ตัวเดียวกับตอนบันทึก
 * ตอบ 200 เสมอเมื่อรูป payload ถูก (ok:false + errors) · 400 = รูปผิด · 403 = ไม่มีสาขาที่ทำงาน
 */
export const buyQuoteQuery = (body: QuoteBody) =>
  queryOptions({
    queryKey: buyKeys.quote(body),
    queryFn: ({ signal }) => apiFetch("/api/buy/quote", { json: body, signal, schema: QuoteSchema }),
    staleTime: 10_000,
  });

/** โลหะที่รับซื้อ เรียงตาม dropdown ระบบเดิม (ทอง · นาก · เงิน · แพลตตินั่ม) — แทบไม่เปลี่ยน */
export const metalsQuery = queryOptions({
  queryKey: ["metals"],
  queryFn: ({ signal }) => apiFetch("/api/metals", { signal, schema: z.array(MetalSchema) }),
  staleTime: 60 * 60_000,
});
