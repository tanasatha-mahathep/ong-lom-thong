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

/** รอ chunk ภาษานานสุดเท่านี้ — เกินแล้วถือว่าโหลดไม่ได้ (ใช้ภาษาไทยต่อ · หน้าไม่ค้างรอ) */
export const LANGUAGE_LOAD_TIMEOUT_MS = 3_000;

/** ที่มาของข้อความแต่ละภาษานอกจากไทย — แยกเป็น object ให้เทสต์แทนตัวโหลดได้ (chunk ค้าง/หาย) */
export const languageLoaders: Record<Exclude<Language, "th">, () => Promise<Record<string, object>>> = {
  en: () => import("./resources.en").then((module) => module.resourcesEn),
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`language chunk timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** โหลดข้อความของภาษานั้นเข้า i18next (ภาษาอังกฤษ = chunk แยก โหลดครั้งเดียว · ค้างเกิน 3 วินาที = reject) */
export async function loadLanguage(language: Language): Promise<void> {
  // ไทยอยู่ใน bundle หลักเสมอ
  if (language === "th" || i18next.hasResourceBundle(language, "common")) return;
  const bundles = await withTimeout(languageLoaders[language](), LANGUAGE_LOAD_TIMEOUT_MS);
  for (const [ns, bundle] of Object.entries(bundles)) {
    i18next.addResourceBundle(language, ns, bundle, true, true);
  }
}

/** ลำดับคำขอเปลี่ยนภาษา — คำขอเก่าที่โหลดเสร็จช้ากว่าต้องไม่ทับตัวเลือกล่าสุด */
let languageRequest = 0;

/**
 * เปลี่ยนภาษาของ UI และจำไว้ในเครื่องนี้ (localStorage `ong.lang`)
 * โหลดไม่ได้/เกินเวลา = reject และภาษาเดิมยังอยู่ · เลือกซ้อนกัน = ตัวเลือกล่าสุดชนะเสมอ
 */
export async function setLanguage(language: Language): Promise<void> {
  const request = ++languageRequest;
  await loadLanguage(language);
  if (request !== languageRequest) return;
  await i18next.changeLanguage(language);
  storeLanguage(language);
}

/**
 * ภาษาที่จำไว้ในเครื่อง — main.tsx รอ promise นี้ก่อน render ครั้งแรก (ไม่กะพริบไทย→อังกฤษ)
 * โหลดภาษาอังกฤษไม่ได้หรือเกิน 3 วินาที (chunk หาย/เน็ตหลุด) = เริ่มด้วยภาษาไทย — หน้าไม่ค้าง
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
