import { useTranslation } from "react-i18next";

/** ลิงก์แรกของหน้า — ผู้ใช้คีย์บอร์ดข้ามเมนูไปเนื้อหาได้ทันที (WCAG 2.4.1) */
export function SkipLink() {
  const { t } = useTranslation("shell");
  return (
    <a
      href="#main"
      onClick={(event) => {
        // โฟกัส <main> เอง ไม่เปลี่ยน hash ของ URL (router ไม่ต้องทำงาน)
        event.preventDefault();
        document.getElementById("main")?.focus();
      }}
      // not-sr-only ล้าง padding เป็น 0 — ต้องใส่ padding ใต้ focus: ซ้ำ
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:bg-background focus:px-4 focus:py-2 focus:font-medium focus:shadow-lg"
    >
      {t("skipLink")}
    </a>
  );
}
