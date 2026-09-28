import type { TFunction } from "i18next";
import { useTranslation as useNamespace } from "react-i18next";
import type th from "./locales/th";

/** key แบบจุดของทุกข้อความใน locales/th.ts เช่น "typo.title" — namespace "goldPrice" ของ i18n กลาง */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type GoldPriceKey = Leaves<typeof th>;

/** t ของ namespace "goldPrice" (คำกลางใช้ `{ ns: "common" }`) — ส่งเข้า helper ที่ไม่ใช่ component */
export type GoldPriceT = TFunction<"goldPrice">;

/** `useTranslation("goldPrice")` ของ react-i18next — คงชื่อเดิมไว้ให้ไฟล์ในโฟลเดอร์นี้ import ที่เดิมได้ */
export function useTranslation(namespace: "goldPrice" = "goldPrice") {
  return useNamespace(namespace);
}
