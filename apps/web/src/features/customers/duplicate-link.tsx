import { Link } from "@tanstack/react-router";
import { useTranslation } from "./i18n";

/**
 * ลิงก์ไปลูกค้าเดิมเมื่อเลขบัตรซ้ำ (409) — ส่งให้ `CustomerForm.renderDuplicateLink`
 * ใต้ช่องที่ 1 ต้องไม่รับ Tab (ห้ามแทรกลำดับ Siam ID) · ตัวในแถวปุ่มท้ายฟอร์มให้คีย์บอร์ดไปถึงได้
 */
export function DuplicateLink({ id, focusable }: { id: string; focusable: boolean }) {
  const { t } = useTranslation("customers");
  return (
    <Link
      to="/customers/$id"
      params={{ id }}
      tabIndex={focusable ? undefined : -1}
      className="font-medium underline underline-offset-4"
    >
      {t("form.duplicateLink")}
    </Link>
  );
}
