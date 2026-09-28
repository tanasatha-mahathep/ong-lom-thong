/**
 * 11 ช่องของฟอร์มลูกค้า — **ลำดับ = ลำดับที่ Siam ID พิมพ์** (CLAUDE.md กฎ 6 · Work_2026-09-27/03-customer-member.md)
 * ลำดับในอาร์เรย์ = ลำดับ DOM = ลำดับ Tab ห้ามสลับ · ป้ายและ placeholder อยู่ใน locales/th.ts (`fields.<name>`)
 * - `name` = ชื่อช่องของ API (POST/PUT /api/customers) · ช่องที่ 9 คือรูป ส่งเป็นไฟล์แยก
 * - `id` เป็นชื่อกลาง ๆ (ไม่มีคำว่า address/tel) กัน autofill ของ Chrome เปิด dropdown แย่ง Tab
 * - `important` = ป้าย "*สำคัญ" ของระบบเดิม · `required` = ช่องที่ API บังคับจริง (มีแค่ 1 และ 2)
 */
export const SIAM_ID_FIELDS = [
  { name: "national_id", id: "siam-1", kind: "text", important: true, required: true },
  { name: "name_th", id: "siam-2", kind: "text", important: true, required: true },
  { name: "name_en", id: "siam-3", kind: "text", important: false, required: false },
  { name: "birthday_text", id: "siam-4", kind: "text", important: false, required: false },
  { name: "religion", id: "siam-5", kind: "text", important: false, required: false },
  { name: "address", id: "siam-6", kind: "textarea", important: true, required: false },
  { name: "card_issue_text", id: "siam-7", kind: "text", important: false, required: false },
  { name: "card_expire_text", id: "siam-8", kind: "text", important: false, required: false },
  { name: "photo", id: "siam-9", kind: "photo", important: false, required: false },
  { name: "mobile", id: "siam-10", kind: "text", important: true, required: false },
  { name: "phone2", id: "siam-11", kind: "text", important: false, required: false },
] as const;

export type SiamIdField = (typeof SIAM_ID_FIELDS)[number];
export type FieldName = SiamIdField["name"];
/** 10 ช่องข้อความ (ทุกช่องยกเว้นรูป) */
export type TextFieldName = Exclude<FieldName, "photo">;
export type TextField = Extract<SiamIdField, { name: TextFieldName }>;

export const isTextField = (field: SiamIdField): field is TextField => field.kind !== "photo";

/** 10 ช่องข้อความตามลำดับ Siam ID */
export const TEXT_FIELDS: readonly TextField[] = SIAM_ID_FIELDS.filter(isTextField);

/** ช่องที่ Siam ID พิมพ์จากบัตร (1–8) — ปุ่ม "อ่านบัตรใหม่" ล้างชุดนี้ */
export const CARD_FIELDS: readonly TextFieldName[] = SIAM_ID_FIELDS.slice(0, 8)
  .filter(isTextField)
  .map((f) => f.name);

export const isFieldName = (value: unknown): value is FieldName => SIAM_ID_FIELDS.some((f) => f.name === value);

/** id ของ element ของช่อง (input · textarea · โซนรูป) — ใช้ย้ายโฟกัสไปช่องที่มี error */
export function fieldElementId(name: FieldName): string {
  const field = SIAM_ID_FIELDS.find((f) => f.name === name);
  if (!field) throw new Error(`unknown customer field: ${name}`);
  return field.id;
}
