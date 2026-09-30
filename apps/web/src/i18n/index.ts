import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { resources } from "./resources";

/**
 * ภาษาของ UI — ไทยเป็นค่าเริ่มต้น (อยู่ใน bundle หลัก) · อังกฤษโหลดแยก (lazy chunk) ตอนเลือกครั้งแรก
 * แปลเฉพาะ UI (ป้าย · ข้อความ · เมนู) — รูปแบบทางธุรกิจเป็นไทยเสมอทุกภาษา: เงิน (format.ts th-TH) · วันที่ พ.ศ.
 * และช่องพิมพ์ วว/ดด/ปปปป · ลำดับ/กฎ 11 ช่องของ Siam ID · ใบรับซื้อและ PDF (เอกสารภาษี จาก @ong/core / api)
 * ข้อความ error ภาษาไทยที่ API ส่งมาแสดงตามที่ได้รับ (lib/api.ts errorMessage)
 */
export const LANGUAGES = ["th", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "th";
/** ภาษาไทยตายตัว — `getFixedT(LANGUAGE, ns)` ของเทสต์ที่ประกอบข้อความยืนยันเป็นภาษาไทย */
export const LANGUAGE = DEFAULT_LANGUAGE;
/** ชื่อภาษาเป็นภาษานั้นเอง (endonym) — ไม่แปล ให้คนที่อ่านภาษาปัจจุบันไม่ออกยังหาภาษาของตัวเองเจอ */
export const LANGUAGE_NAMES: Record<Language, string> = { th: "ไทย", en: "English" };
export const LANGUAGE_STORAGE_KEY = "ong.lang";

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

/** localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว / ถูกบล็อก) — ใช้ภาษาไทย */
export function readStoredLanguage(): Language {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function storeLanguage(language: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // เก็บไม่ได้ก็ยังใช้ภาษานี้ได้จนปิดหน้า
  }
}

void i18next.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: [...LANGUAGES],
  // ภาษาอังกฤษเพิ่มทีหลังด้วย addResourceBundle (lazy) — ไม่ต้องมีครบทุกภาษาตอน init
  partialBundledLanguages: true,
  ns: Object.keys(resources[DEFAULT_LANGUAGE]),
  defaultNS: "common",
  // React escape ให้แล้ว — escape ซ้ำจะเห็น &amp; บนจอ
  interpolation: { escapeValue: false },
  // ภาษาไทยอยู่ใน bundle แล้ว — init เสร็จทันที ไม่ต้องรอ
  initAsync: false,
});

/** โหลดข้อความของภาษานั้นเข้า i18next (ภาษาอังกฤษ = chunk แยก โหลดครั้งเดียว) */
export async function loadLanguage(language: Language): Promise<void> {
  if (language === DEFAULT_LANGUAGE || i18next.hasResourceBundle(language, "common")) return;
  const { resourcesEn } = await import("./resources.en");
  for (const [ns, bundle] of Object.entries(resourcesEn)) {
    i18next.addResourceBundle(language, ns, bundle, true, true);
  }
}

/** เปลี่ยนภาษาของ UI และจำไว้ในเครื่องนี้ (localStorage `ong.lang`) */
export async function setLanguage(language: Language): Promise<void> {
  await loadLanguage(language);
  await i18next.changeLanguage(language);
  storeLanguage(language);
}

/**
 * ภาษาที่จำไว้ในเครื่อง — main.tsx รอ promise นี้ก่อน render ครั้งแรก (ไม่กะพริบไทย→อังกฤษ)
 * โหลดภาษาอังกฤษไม่ได้ (chunk หาย/เน็ตหลุด) = ใช้ภาษาไทยไปก่อน
 */
export const i18nReady: Promise<void> =
  readStoredLanguage() === DEFAULT_LANGUAGE
    ? Promise.resolve()
    : setLanguage(readStoredLanguage()).catch(() => undefined);

// <html lang> ตามภาษาที่ใช้อยู่ (screen reader อ่านถูกภาษา · ตัดคำไทยถูก)
const syncHtmlLang = (lng: string) => {
  document.documentElement.lang = lng;
};
syncHtmlLang(i18next.language);
i18next.on("languageChanged", syncHtmlLang);

export default i18next;
