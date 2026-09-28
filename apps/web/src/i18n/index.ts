import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

/** ภาษาเดียวตอนนี้ — เพิ่มภาษาอังกฤษ: resources.en + "en" ใน supportedLngs + ตัวเลือกภาษาในเมนูผู้ใช้ */
export const LANGUAGE = "th";

void i18next.use(initReactI18next).init({
  resources,
  lng: LANGUAGE,
  fallbackLng: LANGUAGE,
  supportedLngs: [LANGUAGE],
  ns: Object.keys(resources[LANGUAGE]),
  defaultNS: "common",
  // React escape ให้แล้ว — escape ซ้ำจะเห็น &amp; บนจอ
  interpolation: { escapeValue: false },
  // resources อยู่ใน bundle แล้ว — init เสร็จทันที ไม่ต้องรอ
  initAsync: false,
});

// <html lang> ตามภาษาที่ใช้อยู่ (screen reader อ่านถูกภาษา · ตัดคำไทยถูก)
const syncHtmlLang = (lng: string) => {
  document.documentElement.lang = lng;
};
syncHtmlLang(i18next.language);
i18next.on("languageChanged", syncHtmlLang);

export default i18next;
