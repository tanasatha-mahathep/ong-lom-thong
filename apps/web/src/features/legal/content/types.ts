/**
 * โครงของเอกสารกฎหมายบนหน้า login — ข้อความอยู่ใน content/th.ts · content/en.ts (โหลดแยกเมื่อเปิดกล่อง)
 * `{{companyName}}` ฯลฯ ถูกแทนด้วยค่าจาก legal-config.ts ตอนแสดง
 */
export type LegalBlock = string | { list: string[] };

export interface LegalSection {
  heading: string;
  body: LegalBlock[];
}

export interface LegalDocument {
  title: string;
  subtitle: string;
  sections: LegalSection[];
}

export interface LegalContent {
  terms: LegalDocument;
  privacy: LegalDocument;
}
