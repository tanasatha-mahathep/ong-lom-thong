import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";
import { useTranslation } from "react-i18next";

// ธีมตาม ThemeProvider (สว่าง/มืด/ตามระบบ) · ป้ายสำหรับ screen reader แปลด้วย i18n
// portal ไปที่ <body> ในกล่อง data-slot="toaster-host" — ชั้นบังหน้าจอ (blocking-overlay) ทำ #root เป็น inert
// ถ้า toaster อยู่ใน #root ด้วย aria-live จะไม่ประกาศ toast "บันทึกแล้ว" ระหว่างพาไปหน้าถัดไป
/**
 * ปุ่มปิด toast — ทับสไตล์ของ sonner ([data-close-button] ใน styles ที่ sonner ใส่เอง) ด้วย `!`:
 * ขวาในกล่อง · กึ่งกลางแนวตั้ง · ไม่มีวง/ขอบ · hover/focus ใช้ token ของธีม (สว่าง/มืด)
 */
const CLOSE_BUTTON = [
  "!left-auto !right-3 !top-1/2 ![transform:translateY(-50%)]",
  "!size-7 !rounded-md !border-0 !bg-transparent !text-muted-foreground",
  "hover:!bg-accent hover:!text-accent-foreground",
  "focus-visible:!shadow-none focus-visible:!outline-2 focus-visible:!outline-offset-2 focus-visible:!outline-ring",
].join(" ");

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
        toastOptions={{
          closeButtonAriaLabel: t("closeNotification"),
          classNames: {
            // มีปุ่มปิด = เว้นขวาไว้ให้ปุ่ม ข้อความไทยยาว ๆ ไม่วิ่งไปใต้ปุ่ม
            toast: "has-[[data-close-button]]:!pr-12",
            // ปุ่มปิดของ sonner เป็นวงกลมลอยมุมซ้ายบน — ย้ายเข้ามาในกล่องด้านขวา กึ่งกลางแนวตั้ง ไอคอน X เปล่า ๆ
            closeButton: CLOSE_BUTTON,
          },
        }}
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
          close: <XIcon className="size-4" aria-hidden="true" />,
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
