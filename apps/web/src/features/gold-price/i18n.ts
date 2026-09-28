import th from "./locales/th";

/**
 * คำที่ใช้ร่วมทั้งแอป (namespace `common`) เฉพาะที่หน้านี้ใช้ — สำเนาชั่วคราวจาก src/i18n/locales/th.ts ของ
 * feat/web-i18n-theme (#67) ข้อความตรงกันทุกตัวอักษร · ลบพร้อมไฟล์นี้
 */
const common = {
  retry: "ลองใหม่",
  saving: "กำลังบันทึก…",
  noBranch: "ยังไม่ได้เลือกสาขา",
  loadFailed: "โหลด{{what}}ไม่ได้",
  goldPrice: {
    today: "ราคาทองวันนี้",
    barSell: "ทองแท่งขายออก",
    barBuy: "ทองแท่งรับซื้อ",
    jewelryBuy: "ทองรูปพรรณรับซื้อ",
    source: {
      central: "ราคากลาง",
      branch: "ราคาเฉพาะสาขา",
    },
  },
};

/** key แบบจุดของทุกข้อความใน locales/th.ts เช่น "typo.title" — ชุดเดียวกับ react-i18next (namespace "goldPrice") */
type Leaves<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Leaves<T[K]>}`;
}[keyof T & string];

export type GoldPriceKey = Leaves<typeof th>;
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
 * รูปเดียวกับ t ของ react-i18next: `t("typo.title")` · `t("saving", { ns: "common" })` · แทรกค่า {{ชื่อ}}
 * ไม่พบ key = คืน key (จอฟ้องว่าขาดข้อความ)
 */
function t(key: GoldPriceKey, vars?: Vars): string;
function t(key: CommonKey, options: Vars & { ns: "common" }): string;
function t(key: string, options?: Vars & { ns?: "common" }): string {
  const { ns, ...vars } = options ?? {};
  const template = lookup(ns === "common" ? common : th, key) ?? key;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

export type GoldPriceT = typeof t;

/**
 * ชั่วคราวจนกว่า i18n กลาง (feat/web-i18n-theme · #67) จะเข้า dev — รูปเดียวกับ `useTranslation("goldPrice")` ของ
 * react-i18next (key · `{ ns: "common" }` · {{ตัวแปร}} ชุดเดียวกัน) จึงเปลี่ยนแค่ import แล้วลบไฟล์นี้ได้เลย
 */
export function useTranslation(_namespace: "goldPrice") {
  return { t };
}
