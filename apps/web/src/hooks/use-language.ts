import { useTranslation } from "react-i18next";
import { DEFAULT_LANGUAGE, type Language, isLanguage } from "@/i18n";

/** ภาษาปัจจุบันของ UI (ภาษาที่ i18next ใช้อยู่ · ค่าที่ไม่รู้จัก = ไทย) — เปลี่ยนแล้ว component render ใหม่เอง */
export function useLanguage(): Language {
  const { i18n } = useTranslation();
  return isLanguage(i18n.resolvedLanguage) ? i18n.resolvedLanguage : DEFAULT_LANGUAGE;
}
