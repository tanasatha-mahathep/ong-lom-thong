import auth from "@/features/auth/locales/en";
import bills from "@/features/bills/locales/en";
import buy from "@/features/buy/locales/en";
import customers from "@/features/customers/locales/en";
import goldPrice from "@/features/gold-price/locales/en";
import home from "@/features/home/locales/en";
import reports from "@/features/reports/locales/en";
import settings from "@/features/settings/locales/en";
import type { resources } from "./resources";
import app from "./locales/en";

/**
 * ข้อความภาษาอังกฤษทุก namespace — โหลดแยก (dynamic import ใน i18n/index.ts) ไม่อยู่ใน bundle หลัก
 * `satisfies` = namespace ต้องครบเท่าภาษาไทย · key ในแต่ละ namespace ตรวจด้วย `satisfies typeof th` ของไฟล์ en.ts
 */
export const resourcesEn = {
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
} satisfies (typeof resources)["th"];
