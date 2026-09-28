import th from "./locales/th";

/** key แบบจุดของทุกข้อความใน locales/th.ts เช่น "form.save" — ชุดเดียวกับ react-i18next (namespace "customers") */
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

function lookup(key: string): string | undefined {
  let node: unknown = th;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export const isCustomersKey = (value: unknown): value is CustomersKey =>
  typeof value === "string" && lookup(value) !== undefined;

/** แทน {{ชื่อ}} ด้วยค่า — รูปเดียวกับ interpolation ของ i18next */
function t(key: CustomersKey, vars?: Vars): string {
  const template = lookup(key) ?? key;
  if (!vars) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/**
 * ชั่วคราวจนกว่า i18n กลาง (feat/web-i18n-theme) จะเข้า dev — รูปเดียวกับ `useTranslation("customers")` ของ
 * react-i18next (key และ {{ตัวแปร}} ชุดเดียวกัน) จึงเปลี่ยนแค่ import แล้วลบไฟล์นี้ได้เลย
 */
export function useTranslation(_namespace: "customers") {
  return { t };
}
