import type { TFunction } from "i18next";
import { useTranslation as useNamespace } from "react-i18next";
import i18next, { LANGUAGE } from "@/i18n";
import type th from "./locales/th";

/** key แบบจุดของทุกข้อความใน locales/th.ts เช่น "save.saved" · "payments.methods.cash" — namespace "buy" ของ i18n กลาง */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type BuyKey = Leaves<typeof th>;

/** t ของ namespace "buy" (คำกลางใช้ `{ ns: "common" }`) — ส่งเข้า helper ที่ไม่ใช่ component เช่น balanceView() */
export type BuyT = TFunction<"buy">;

/** `useTranslation("buy")` ของ react-i18next — คงชื่อเดิมไว้ให้ไฟล์ในโฟลเดอร์นี้ import ที่เดิมได้ */
export function useTranslation(namespace: "buy" = "buy") {
  return useNamespace(namespace);
}

/** t นอก component (เทสต์ประกอบข้อความยืนยัน) — ผูกกับ resource จริงของแอป ไม่ใช่สำเนาแยก */
export const t: BuyT = i18next.getFixedT(LANGUAGE, "buy");
