import th from "./locales/th";

/**
 * คำที่ใช้ร่วมทั้งแอป (namespace `common`) เฉพาะที่หน้ารายงานใช้ — สำเนาชั่วคราวจาก src/i18n/locales/th.ts ของ
 * feat/web-i18n-theme (#67) ข้อความตรงกันทุกตัวอักษร · ลบพร้อมไฟล์นี้
 */
const common = {
  retry: "ลองใหม่",
  loadFailed: "โหลด{{what}}ไม่ได้",
};

/** key แบบจุดของทุกข้อความใน locales/th.ts เช่น "filters.apply" — ชุดเดียวกับ react-i18next (namespace "reports") */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type ReportsKey = Leaves<typeof th>;
type CommonKey = Leaves<typeof common>;
type Vars = Readonly<Record<string, string | number>>;

interface Messages {
  readonly [key: string]: string | Messages;
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: string | Messages | undefined = messages;
  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * รูปเดียวกับ t ของ react-i18next: `t("filters.apply")` · `t("retry", { ns: "common" })` · แทรกค่า {{ชื่อ}}
 * ไม่พบ key = คืน key (จอฟ้องว่าขาดข้อความ)
 */
function t(key: ReportsKey, vars?: Vars): string;
function t(key: CommonKey, options: Vars & { ns: "common" }): string;
function t(key: string, options?: Vars & { ns?: "common" }): string {
  const { ns, ...vars } = options ?? {};
  const template = lookup(ns === "common" ? common : th, key) ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export type ReportsT = typeof t;

/**
 * ชั่วคราวจนกว่า i18n กลาง (feat/web-i18n-theme · #67) จะเข้า dev — รูปเดียวกับ `useTranslation("reports")` ของ
 * react-i18next (key · `{ ns: "common" }` · {{ตัวแปร}} ชุดเดียวกัน) จึงเปลี่ยนแค่ import แล้วลบไฟล์นี้ได้เลย
 */
export function useTranslation(_namespace: "reports") {
  return { t };
}
