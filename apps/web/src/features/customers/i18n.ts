import { useTranslation as useNamespace } from "react-i18next";
import i18n from "@/i18n";
import type th from "./locales/th";

/** key แบบจุดของทุกข้อความใน locales/th.ts เช่น "form.save" — ชุดเดียวกับ namespace "customers" ของ i18n กลาง */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type CustomersKey = Leaves<typeof th>;
export type Vars = Record<string, string | number>;
/** ข้อความที่แปลทีหลัง — ฟังก์ชันที่ไม่ใช่ component คืนค่านี้ ให้ component แปลตอนแสดง */
export interface Message {
  key: CustomersKey;
  vars?: Vars;
}

/** key ที่มีข้อความจริง (ปลายทางเป็น string ไม่ใช่กลุ่มย่อย) ใน namespace "customers" */
export const isCustomersKey = (value: unknown): value is CustomersKey =>
  typeof value === "string" && typeof i18n.getResource(i18n.language, "customers", value) === "string";

/** `useTranslation("customers")` ของ react-i18next — คงชื่อเดิมไว้ให้ไฟล์ในโฟลเดอร์นี้ import ที่เดิมได้ */
export function useTranslation(namespace: "customers" = "customers") {
  return useNamespace(namespace);
}
