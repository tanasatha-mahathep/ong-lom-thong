import { Bell, BellOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNotifications } from "@/hooks/use-notifications";

/**
 * กระดิ่งแจ้งเตือนขวาสุดของหัวหน้า — ปุ่มไอคอน (ขนาดเท่าปุ่มย่อ/ขยาย sidebar) + จำนวนที่ยังไม่อ่าน (0 = ไม่แสดง)
 * กดแล้วเปิด popover (Esc ปิด · โฟกัสกลับกระดิ่ง — Radix) · ตอนนี้ยังไม่มี API จึงแสดงสถานะว่างเสมอ
 * `unread` ส่งเองได้ (เทสต์/หน้าที่รู้จำนวนเอง) — ไม่ส่ง = ใช้ค่าจาก useNotifications()
 */
export function NotificationBell({ unread }: { unread?: number }) {
  const { t } = useTranslation("shell");
  const notifications = useNotifications();
  const count = unread ?? notifications.unread;
  const label = count > 0 ? t("bell.labelUnread", { count }) : t("bell.label");

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative size-7" aria-label={label}>
              <Bell aria-hidden="true" />
              {count > 0 && (
                <span
                  data-slot="notification-badge"
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white tabular-nums"
                >
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("bell.label")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{t("bell.title")}</h2>
        </div>
        {notifications.items.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
            <BellOff className="size-6" aria-hidden="true" />
            <p>{t("bell.empty")}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
