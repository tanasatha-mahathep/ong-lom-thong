import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch, decimalString } from "@/lib/api";

/** ยอดรวมทุกหน้าตามตัวกรอง เฉพาะบิลที่ยังไม่ยกเลิก — Postgres รวมให้ เป็นข้อความทั้งหมด (ไม่รวมใน browser) */
const BuyTotalsSchema = z.object({
  count: z.string().regex(/^\d+$/, "ต้องเป็นข้อความจำนวนเต็ม"),
  total_weight: decimalString,
  total_amount: decimalString,
});
export type BuyTotals = z.infer<typeof BuyTotalsSchema>;

/** หน้าแรกใช้แค่ totals — ตารางบิลวันนี้เพิ่ม `items` ใน schema นี้แล้วใช้ query เดียวกันได้ (ไม่ยิงซ้ำ) */
const TodayBuysSchema = z.object({ totals: BuyTotalsSchema });

/** บิลซื้อเข้าของวันนี้ในสาขาหนึ่ง — GET /api/buy?date_from=วันนี้&date_to=วันนี้&branch_id=สาขา */
export const todayBuysQueryOptions = (branchId: string, date: string) =>
  queryOptions({
    queryKey: ["buy", "list", { date_from: date, date_to: date, branch_id: branchId }],
    queryFn: ({ signal }) => {
      const search = new URLSearchParams({ date_from: date, date_to: date, branch_id: branchId });
      return apiFetch(`/api/buy?${search.toString()}`, { signal, schema: TodayBuysSchema });
    },
  });
