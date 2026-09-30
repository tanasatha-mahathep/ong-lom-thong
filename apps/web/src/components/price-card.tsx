import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * การ์ดราคาแบบ SectionCards ของ dashboard-01 — ป้าย (dt) + ตัวเลขใหญ่ tabular-nums + "บาท" (dd) · ต้องอยู่ใน <dl>
 * ใช้ทั้งกระดานราคาของร้าน (หน้าหลัก) และราคาสมาคม (อ้างอิง) — การ์ดหน้าตาเดียวกัน ราคาสมาคมต่างที่กรอบเส้นประรอบกลุ่ม
 * `value` = ข้อความที่จัดรูปแล้ว (formatBoardPrice / formatInteger) จากข้อความของ API ตรง ๆ — ไม่มีการคำนวณ
 * ขนาดตัวเลขตามความกว้างของการ์ดเอง (@container/card): text-3xl · การ์ด ≥ 16rem → text-4xl
 * `compact`: กลุ่มที่การ์ดแคบได้ถึงราว 10rem (4 ใบต่อแถว · กรอบครึ่งจอ) และค่ามีสตางค์ได้ ("66,683.52")
 * → เพิ่มขั้น text-2xl เมื่อการ์ดแคบกว่า 11rem ให้ตัวเลขกับ "บาท" อยู่บรรทัดเดียวในการ์ด · กว้างกว่านั้นขนาดเท่าการ์ดปกติ
 */
export function PriceCard({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  const { t } = useTranslation("common");
  return (
    <Card className="@container/card gap-2 px-6 py-5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={cn(
            "font-bold tabular-nums @[16rem]/card:text-4xl",
            compact ? "text-2xl @[11rem]/card:text-3xl" : "text-3xl",
          )}
        >
          {value}
        </span>
        <span className="text-muted-foreground">{t("baht")}</span>
      </dd>
    </Card>
  );
}
