import auth from "@/features/auth/locales/th";
import bills from "@/features/bills/locales/th";
import buy from "@/features/buy/locales/th";
import customers from "@/features/customers/locales/th";
import goldPrice from "@/features/gold-price/locales/th";
import home from "@/features/home/locales/th";
import reports from "@/features/reports/locales/th";
import settings from "@/features/settings/locales/th";
import app from "./locales/th";

/**
 * ทุก namespace ลงทะเบียนที่นี่ (import หนึ่งบรรทัด + key หนึ่งตัว) — key คือชื่อที่ใช้ใน useTranslation("<ns>")
 * ภาษาอังกฤษภายหลัง: import en.ts ของแต่ละ namespace แล้วเพิ่ม `en: { … }` คู่กับ `th` และเพิ่ม "en" ใน supportedLngs
 */
export const resources = {
  th: {
    common: app.common,
    shell: app.shell,
    auth,
    home,
    goldPrice,
    customers,
    buy,
    bills,
    reports,
    settings,
  },
};

export type Namespace = keyof (typeof resources)["th"];
