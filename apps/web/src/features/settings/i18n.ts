import { useTranslation as useNamespace } from "react-i18next";
import i18n from "@/i18n";
import type th from "./locales/th";

/** key แบบจุดของทุกข้อความใน locales/th.ts เช่น "users.form.save" — namespace "settings" ของ i18n กลาง */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type SettingsKey = Leaves<typeof th>;

/** key ที่มีข้อความจริง (ปลายทางเป็น string ไม่ใช่กลุ่มย่อย) ใน namespace "settings" */
export const isSettingsKey = (value: unknown): value is SettingsKey =>
  typeof value === "string" && typeof i18n.getResource(i18n.language, "settings", value) === "string";

/** `useTranslation("settings")` ของ react-i18next — คงชื่อเดิมไว้ให้ไฟล์ในโฟลเดอร์นี้ import ที่เดิมได้ */
export function useTranslation(namespace: "settings" = "settings") {
  return useNamespace(namespace);
}
