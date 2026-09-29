import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePageMeta } from "@/hooks/use-page-meta";

/**
 * แถบหัวเรื่องของหน้า (h1 เดียวของหน้า) — ชื่อซ้าย (+ คำอธิบายจาง ๆ ใต้ชื่อ) · ปุ่มหลักขวา · เส้นคั่นใต้แถบ
 * ชื่อมาจาก `staticData.title` ของ route (key ใน shell.routes) · `title` ส่งเองได้ถ้าหน้าต้องการชื่ออื่น
 * จอแคบ: ปุ่มขึ้นบรรทัดใหม่ (ไม่ล้นแนวนอน)
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const { t } = useTranslation("shell");
  const meta = usePageMeta();
  const heading = title ?? (meta.title && t(`routes.${meta.title}`));
  return (
    <div data-slot="page-header" className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b pb-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-bold break-words">{heading}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
