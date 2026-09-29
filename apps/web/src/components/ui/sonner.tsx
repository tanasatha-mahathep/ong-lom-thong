import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";
import { useTranslation } from "react-i18next";

// ธีมตาม ThemeProvider (สว่าง/มืด/ตามระบบ) · ป้ายสำหรับ screen reader แปลด้วย i18n
// portal ไปที่ <body> ในกล่อง data-slot="toaster-host" — ชั้นบังหน้าจอ (blocking-overlay) ทำ #root เป็น inert
// ถ้า toaster อยู่ใน #root ด้วย aria-live จะไม่ประกาศ toast "บันทึกแล้ว" ระหว่างพาไปหน้าถัดไป
const Toaster = ({ ...props }: ToasterProps) => {
  const { t } = useTranslation("shell");
  const { theme } = useTheme();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-slot="toaster-host">
      <Sonner
        theme={theme}
        className="toaster group"
        containerAriaLabel={t("notifications")}
        toastOptions={{ closeButtonAriaLabel: t("closeNotification") }}
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
          } as React.CSSProperties
        }
        {...props}
      />
    </div>,
    document.body,
  );
};

export { Toaster };
