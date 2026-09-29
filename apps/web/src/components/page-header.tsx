import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePageMeta } from "@/hooks/use-page-meta";
import { type BackListPath, rememberedSearch } from "@/lib/back-target";

/** ชื่อปุ่มย้อนกลับ (aria-label + tooltip) ตามหน้ารายการปลายทาง */
const BACK_LABEL = { "/customers": "back.customers", "/bills": "back.bills" } as const satisfies Record<
  BackListPath,
  string
>;

/**
 * แถบหัวเรื่องของหน้า (h1 เดียวของหน้า) — [ปุ่มย้อนกลับ] ชื่อ (+ คำอธิบายจาง ๆ) ซ้าย · ปุ่มหลักขวา · เส้นคั่นใต้แถบ
 * ชื่อมาจาก `staticData.title` ของ route (key ใน shell.routes) · `title` ส่งเองได้ถ้าหน้าต้องการชื่ออื่น
 * `back` เฉพาะหน้าย่อย/เอกสาร (หน้าบนสุดของเมนูไม่มี) · เป็นลิงก์ธรรมดา — ไม่ยึด Alt+← หรือ Esc
 * จอแคบ: ปุ่มหลักขึ้นบรรทัดใหม่ (ไม่ล้นแนวนอน) · ปุ่มย้อนกลับอยู่หน้าชื่อเสมอ
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** หน้ารายการที่ย้อนกลับไป — กลับไปพร้อมตัวกรองที่ใช้ล่าสุด (lib/back-target.ts) */
  back?: BackListPath;
}) {
  const { t } = useTranslation("shell");
  const meta = usePageMeta();
  const heading = title ?? (meta.title && t(`routes.${meta.title}`));
  return (
    <div data-slot="page-header" className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b pb-4">
      <div className="flex min-w-0 items-start gap-3">
        {back && <BackButton to={back} label={t(BACK_LABEL[back])} />}
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold break-words">{heading}</h1>
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function BackButton({ to, label }: { to: BackListPath; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* สูงเท่าบรรทัดชื่อ (text-2xl) — กึ่งกลางกับชื่อ */}
        <Button asChild variant="outline" size="icon" className="size-8 shrink-0">
          <Link to={to} search={rememberedSearch(to)} aria-label={label} data-slot="page-back">
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
