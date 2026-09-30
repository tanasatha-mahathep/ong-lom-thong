/**
 * ข้อมูลจริงของผู้ควบคุมข้อมูล (ร้าน) ที่ข้อกำหนดการใช้บริการและนโยบายความเป็นส่วนตัวอ้างถึง — **ที่เดียว**
 *
 * ค่าที่ขึ้นต้นด้วย "[" คือช่องว่างที่เจ้าของระบบต้องกรอก (ห้ามเดา) — ระหว่างที่ยังเหลือแม้แต่ช่องเดียว
 * กล่องข้อความจะแสดงป้าย "ฉบับร่าง — รอตรวจสอบโดยที่ปรึกษากฎหมาย" ให้เอง (`LEGAL_IS_DRAFT`)
 * เนื้อหาทั้งหมดเป็นฉบับร่าง ต้องให้ทนายความไทยตรวจก่อนใช้งานจริง
 */

/** ค่าที่ต่างกันตามภาษา (ชื่อ · ที่อยู่ · วันที่) — ค่าที่เหมือนกันทุกภาษาใช้ string ตรง ๆ */
export type LocalizedValue = string | { th: string; en: string };

export const LEGAL_CONFIG = {
  /** ชื่อนิติบุคคลตามหนังสือรับรอง (ผู้ควบคุมข้อมูลส่วนบุคคล) */
  companyName: { th: "[ชื่อนิติบุคคล — ต้องกรอก]", en: "[Company legal name — to be completed]" },
  /** ที่ตั้งสำนักงานใหญ่ตามทะเบียน */
  registeredAddress: {
    th: "[ที่อยู่สำนักงานใหญ่ตามทะเบียน — ต้องกรอก]",
    en: "[Registered head office address — to be completed]",
  },
  /** เลขประจำตัวผู้เสียภาษี 13 หลัก */
  taxId: { th: "[เลขประจำตัวผู้เสียภาษี — ต้องกรอก]", en: "[Tax ID — to be completed]" },
  /** อีเมลติดต่อเรื่องข้อมูลส่วนบุคคล / เจ้าหน้าที่คุ้มครองข้อมูลส่วนบุคคล (DPO) */
  privacyEmail: { th: "[อีเมลติดต่อ DPO — ต้องกรอก]", en: "[DPO contact email — to be completed]" },
  /** เบอร์โทรติดต่อเรื่องข้อมูลส่วนบุคคล */
  privacyPhone: { th: "[เบอร์โทรติดต่อ — ต้องกรอก]", en: "[Contact phone — to be completed]" },
  /** วันที่มีผลใช้บังคับ */
  effectiveDate: { th: "[วันที่มีผลบังคับใช้ — ต้องกรอก]", en: "[Effective date — to be completed]" },
  /** ฉบับที่ */
  version: "0.1",
} satisfies Record<string, LocalizedValue>;

export type LegalConfigKey = keyof typeof LEGAL_CONFIG;
export type LegalLanguage = "th" | "en";

/** ค่ายังไม่ได้กรอก = ขึ้นต้นด้วย "[" */
export const isPlaceholder = (value: string) => value.trim().startsWith("[");

const valuesOf = (value: LocalizedValue) => (typeof value === "string" ? [value] : [value.th, value.en]);

/** ยังมีช่องที่ต้องกรอก → แสดงป้ายฉบับร่าง */
export const LEGAL_IS_DRAFT = Object.values(LEGAL_CONFIG as Record<string, LocalizedValue>).some((value) =>
  valuesOf(value).some(isPlaceholder),
);

/** ค่าของช่องตามภาษา */
export function legalValue(key: LegalConfigKey, language: LegalLanguage): string {
  const value: LocalizedValue = LEGAL_CONFIG[key];
  return typeof value === "string" ? value : value[language];
}

/** แทน {{companyName}} ฯลฯ ในเนื้อหาด้วยค่าจาก config · ชื่อที่ไม่รู้จักคงไว้ตามเดิม (เทสต์จับได้) */
export function fillLegal(text: string, language: LegalLanguage): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    key in LEGAL_CONFIG ? legalValue(key as LegalConfigKey, language) : match,
  );
}
