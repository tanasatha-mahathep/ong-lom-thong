import { buyListQuery } from "@/features/bills/api";

/**
 * บิลซื้อเข้าของวันนี้ในสาขาหนึ่ง — GET /api/buy?date_from=วันนี้&date_to=วันนี้&branch_id=สาขา
 * การ์ดยอดซื้อวันนี้ (totals) กับการ์ดบิลวันนี้ (items) ใช้ query เดียวกัน: key เดียว ยิงครั้งเดียว
 * totals รวมทุกหน้าเฉพาะบิลที่ยังไม่ยกเลิก — Postgres รวมให้ เป็นข้อความทั้งหมด (ไม่รวมใน browser)
 */
export const todayBuysQueryOptions = (branchId: string, date: string) =>
  buyListQuery({ date_from: date, date_to: date, branch_id: branchId });
