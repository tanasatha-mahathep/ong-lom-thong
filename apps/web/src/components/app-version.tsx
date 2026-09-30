import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * เวอร์ชันของแอปใต้เมนูผู้ใช้ (เช่น "v0.4.2 · a1b2c3d") — บอกได้ว่าเครื่องนี้เปิด build ไหนอยู่เวลาแจ้งปัญหา
 * ตัวเล็ก จาง กึ่งกลาง — muted-foreground 80% เป็นค่าต่ำสุดที่ยังผ่าน 3:1 บนพื้น sidebar (สว่าง 3.13 · มืด 4.87)
 * ซ่อนตอน sidebar ย่อเป็นแถบไอคอน (ไม่มีที่ให้ข้อความ) · หน้า login ใช้บรรทัดเดียวกันท้ายหน้า
 */
export function AppVersion({ className }: { className?: string } = {}) {
  const { t } = useTranslation("shell");
  const label = __APP_COMMIT__
    ? t("appVersion.withCommit", { version: __APP_VERSION__, commit: __APP_COMMIT__ })
    : t("appVersion.plain", { version: __APP_VERSION__ });
  return (
    <p
      data-slot="app-version"
      className={cn(
        "truncate px-2 text-center text-[11px] tracking-wide text-muted-foreground/80 tabular-nums group-data-[collapsible=icon]:hidden",
        className,
      )}
    >
      {label}
    </p>
  );
}
