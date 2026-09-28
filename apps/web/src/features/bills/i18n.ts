import th from "./locales/th";

/**
 * ตัวอ่านข้อความชั่วคราวของ namespace "bills" จนกว่า i18next (feat/web-i18n-theme) จะเข้า dev —
 * เรียกแบบเดียวกับ react-i18next ทุกอย่าง: `const { t } = useTranslation("bills"); t("results.totals", { count })`
 * ตอนสลับ: เปลี่ยน import เป็น "react-i18next" แล้วลงทะเบียน locales/th.ts เป็น resource ของ namespace "bills"
 */

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** key ของข้อความ เช่น "filters.search" · "pdf.ready" */
export type BillsKey = Leaves<typeof th>;
export type TVars = Record<string, string | number>;
export type BillsT = (key: BillsKey, vars?: TVars) => string;

function lookup(key: string): string {
  let node: unknown = th;
  for (const part of key.split(".")) {
    node = typeof node === "object" && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }
  return typeof node === "string" ? node : key;
}

/** ข้อความภาษาไทย + แทรกค่า {{ชื่อ}} (ภาษาเดียวจนกว่าจะมี i18next) — เทสต์ใช้ตัวนี้ตรง ๆ */
export const t: BillsT = (key, vars) =>
  lookup(key).replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) =>
    vars && name in vars ? String(vars[name]) : whole,
  );

/** รูปเดียวกับ react-i18next — ตอนสลับเปลี่ยนแค่ import เป็น "react-i18next" */
export function useTranslation(_ns: "bills"): { t: BillsT } {
  return { t };
}
