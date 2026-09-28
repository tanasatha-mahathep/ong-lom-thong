import { type CardStatus, parseThaiDate } from "@ong/core";
import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { validUntil } from "./card";
import { useTranslation } from "./i18n";

/**
 * ป้ายสถานะบัตร (ตารางลูกค้า · หัวข้อลูกค้า) — ใช้ได้: ขอบปกติ + ไอคอนถูก · ไม่ได้ (ซื้อเข้าไม่ได้): สี destructive + ไอคอนเตือน
 * แยกด้วยไอคอนและข้อความด้วย ไม่ใช้สีอย่างเดียว (WCAG 1.4.1) · สีจาก token จึงถูกทั้งโหมดสว่าง/มืด
 */
export function CardStatusBadge({ status, className }: { status: CardStatus; className?: string }) {
  const { t } = useTranslation("customers");
  const ok = status === "ok";
  const Icon = ok ? CircleCheck : CircleAlert;
  return (
    <Badge variant="outline" className={cn(!ok && "border-destructive text-destructive", className)}>
      <Icon aria-hidden="true" />
      {t(`card.status.${status}`)}
    </Badge>
  );
}

/**
 * สถานะบัตรในหน้าลูกค้า — ใช้ได้: บรรทัดวันหมดอายุ · ไม่ได้: กล่องเตือนว่าซื้อเข้าไม่ได้ พร้อมข้อความที่บันทึกไว้
 * @param action ปุ่มไปแก้ข้อมูลบัตร (หน้าเป็นคนให้ — คอมโพเนนต์นี้ไม่ผูกกับ router)
 */
export function CardStatusNotice({
  status,
  expireText,
  expireDate,
  action,
}: {
  status: CardStatus;
  expireText: string | null;
  expireDate: string | null;
  action?: ReactNode;
}) {
  const { t } = useTranslation("customers");
  if (status === "ok") {
    const { key, vars } = validUntil(expireDate ?? parseThaiDate(expireText));
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleCheck className="size-4" aria-hidden="true" />
        {t(key, vars)}
      </p>
    );
  }
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{t(`card.reason.${status}`)}</AlertTitle>
      <AlertDescription className="text-destructive">
        {expireText && <p>{t("card.savedExpireText", { text: expireText })}</p>}
        <p>{t("card.blocked")}</p>
        {action}
      </AlertDescription>
    </Alert>
  );
}
