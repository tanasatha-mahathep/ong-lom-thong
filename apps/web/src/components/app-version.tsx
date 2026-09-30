import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * เวอร์ชันของแอปใต้เมนูผู้ใช้ (เช่น "v0.4.2 · a1b2c3d") — บอกได้ว่าเครื่องนี้เปิด build ไหนอยู่เวลาแจ้งปัญหา
 * ตัวเล็ก กึ่งกลาง — 11px คือข้อความปกติ (ไม่ใช่ตัวใหญ่) ต้องผ่าน 4.5:1 ตาม WCAG 1.4.3 ไม่ใช่ 3:1
 * muted-foreground เต็มความทึบบนพื้น sidebar: สว่าง 5.28 · มืด 6.91 (ใส่ /80 = 3.49 ตกเกณฑ์ axe จับได้)
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
        "truncate px-2 text-center text-[11px] tracking-wide text-muted-foreground tabular-nums group-data-[collapsible=icon]:hidden",
        className,
      )}
    >
      {label}
    </p>
  );
}
