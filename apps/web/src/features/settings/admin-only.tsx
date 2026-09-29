import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useTranslation } from "./i18n";

/**
 * role อื่นเปิด /settings/branches · /settings/users ตรง ๆ หรือ API ตอบ 403 (ถูกลดสิทธิ์ระหว่างเปิดหน้า)
 * เมนูซ่อนไว้แล้ว และ API บังคับจริง (requireRole("admin")) — หน้านี้แค่บอกให้ชัด ไม่ยิง API ของผู้ดูแล
 */
export function AdminOnlyNotice() {
  const { t } = useTranslation("settings");
  return (
    <Alert role="note" className="max-w-2xl">
      <ShieldAlert aria-hidden="true" />
      <AlertTitle>{t("adminOnly.title")}</AlertTitle>
      <AlertDescription>{t("adminOnly.description")}</AlertDescription>
    </Alert>
  );
}
