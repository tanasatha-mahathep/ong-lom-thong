import { useTranslation as useNamespace } from "react-i18next";

/** `useTranslation("reports")` ของ react-i18next — คงชื่อเดิมไว้ให้ไฟล์ในโฟลเดอร์นี้ import ที่เดิมได้ */
export function useTranslation(namespace: "reports" = "reports") {
  return useNamespace(namespace);
}
