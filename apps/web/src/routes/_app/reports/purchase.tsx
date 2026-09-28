import { createFileRoute } from "@tanstack/react-router";
import { PurchaseReportPage } from "@/features/reports/purchase-report-page";
import { PurchaseSearchSchema } from "@/features/reports/search";

export const Route = createFileRoute("/_app/reports/purchase")({
  staticData: { title: "purchase", crumbs: [{ title: "reports" }] },
  // ตัวกรองอยู่ใน URL — ค่าผิดรูปถูกทิ้ง (ไม่ throw) · ชื่อเดียวกับ query ของ API
  validateSearch: (search: Record<string, unknown>) => PurchaseSearchSchema.parse(search),
  component: PurchaseReportPage,
});
