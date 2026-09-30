import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";

/**
 * การ์ดราคาแบบ SectionCards ของ dashboard-01 — ป้าย (dt) + ตัวเลขใหญ่ tabular-nums + "บาท" (dd) · ต้องอยู่ใน <dl>
 * `value` = ข้อความที่จัดรูปแล้ว (formatBoardPrice / formatInteger) จากข้อความของ API ตรง ๆ — ไม่มีการคำนวณ
 * ขนาดตัวเลขตามความกว้างของการ์ดเอง (@container/card): text-3xl · การ์ด ≥ 16rem → text-4xl
 */
export function PriceCard({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation("common");
  return (
    <Card className="@container/card gap-2 px-6 py-5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-3xl font-bold tabular-nums @[16rem]/card:text-4xl">{value}</span>
        <span className="text-muted-foreground">{t("baht")}</span>
      </dd>
    </Card>
  );
}
