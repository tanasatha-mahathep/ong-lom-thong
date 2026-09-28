import th from "./locales/th";

/**
 * ชั่วคราวจนกว่า i18n กลาง (#67 feat/web-i18n-theme) จะเข้า dev — รูปเดียวกับ `useTranslation("settings")` ของ
 * react-i18next: key ชุดเดียวกัน · {{ตัวแปร}} · `{ ns: "common" }` สำหรับคำที่ใช้ร่วมทั้งแอป
 * เปลี่ยนเป็น `import { useTranslation } from "react-i18next"` แล้วลบไฟล์นี้ได้เลย
 */

/** namespace `common` ของ #67 เฉพาะ key ที่หน้านี้ใช้ — ข้อความตรงกับ src/i18n/locales/th.ts ของ #67 */
const common = {
  retry: "ลองใหม่",
  saving: "กำลังบันทึก…",
  loadFailed: "โหลด{{what}}ไม่ได้",
  roles: {
    staff: "พนักงาน",
    manager: "ผู้จัดการ",
    accounting: "บัญชี",
    admin: "ผู้ดูแลระบบ",
  },
};

/** key แบบจุดของทุกข้อความ เช่น "users.form.save" */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type SettingsKey = Leaves<typeof th>;
type CommonKey = Leaves<typeof common>;
type Vars = Record<string, string | number>;

function lookup(root: unknown, key: string): string | undefined {
  let node = root;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

export const isSettingsKey = (value: unknown): value is SettingsKey =>
  typeof value === "string" && lookup(th, value) !== undefined;

function t(key: SettingsKey, options?: Vars): string;
function t(key: CommonKey, options: Vars & { ns: "common" }): string;
/** แทน {{ชื่อ}} ด้วยค่า — รูปเดียวกับ interpolation ของ i18next */
function t(key: string, options: Vars = {}): string {
  const { ns, ...vars } = options;
  const template = lookup(ns === "common" ? common : th, key) ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function useTranslation(_namespace: "settings") {
  return { t };
}
