import { createFileRoute } from "@tanstack/react-router";
import { StockReportPage } from "@/features/reports/stock-report-page";
import { StockSearchSchema } from "@/features/reports/search";

export const Route = createFileRoute("/_app/reports/stock")({
  staticData: { title: "stock", crumbs: [{ title: "reports" }] },
  // ตัวกรองอยู่ใน URL — ค่าผิดรูปถูกทิ้ง (ไม่ throw) · ชื่อเดียวกับ query ของ API
  validateSearch: (search: Record<string, unknown>) => StockSearchSchema.parse(search),
  component: StockReportPage,
});
