/**
 * 11 ช่องของฟอร์มลูกค้า — **ลำดับ = ลำดับที่ Siam ID พิมพ์** (CLAUDE.md กฎ 6 · Work_2026-09-27/03-customer-member.md)
 * ลำดับในอาร์เรย์ = ลำดับ DOM = ลำดับ Tab ห้ามสลับ · ป้ายตรงกับระบบเดิมทุกตัวอักษร · placeholder จาก cust_add.html
 * - `name` = ชื่อช่องของ API (POST/PUT /api/customers) · ช่องที่ 9 คือรูป ส่งเป็นไฟล์แยก
 * - `id` เป็นชื่อกลาง ๆ (ไม่มีคำว่า address/tel) กัน autofill ของ Chrome เปิด dropdown แย่ง Tab
 * - `important` = ป้าย "*สำคัญ" ของระบบเดิม · `required` = ช่องที่ API บังคับจริง (มีแค่ 1 และ 2)
 */
export const SIAM_ID_FIELDS = [
  {
    name: "national_id",
    label: "เลขประจำตัวประชาชน",
    id: "siam-1",
    kind: "text",
    placeholder: "เลขบัตร 13 หลัก",
    important: true,
    required: true,
  },
  {
    name: "name_th",
    label: "ชื่อ - นามสกุล (ภาษาไทย)",
    id: "siam-2",
    kind: "text",
    placeholder: "ชื่อ - นามสกุล (ภาษาไทย)",
    important: true,
    required: true,
  },
  {
    name: "name_en",
    label: "ชื่อ - นามสกุล (ภาษาอังกฤษ)",
    id: "siam-3",
    kind: "text",
    placeholder: "ชื่อ - นามสกุล (ภาษาอังกฤษ)",
    important: false,
    required: false,
  },
  {
    name: "birthday_text",
    label: "วันเดือนปีเกิด",
    id: "siam-4",
    kind: "text",
    placeholder: "ตัวอย่าง 1 มกราคม 2540",
    important: false,
    required: false,
  },
  {
    name: "religion",
    label: "ศาสนา",
    id: "siam-5",
    kind: "text",
    placeholder: "ศาสนา",
    important: false,
    required: false,
  },
  {
    name: "address",
    label: "ที่อยู่",
    id: "siam-6",
    kind: "textarea",
    placeholder: "ที่อยู่",
    important: true,
    required: false,
  },
  {
    name: "card_issue_text",
    label: "วันที่ออกบัตร",
    id: "siam-7",
    kind: "text",
    placeholder: "วันที่ออกบัตร",
    important: false,
    required: false,
  },
  {
    name: "card_expire_text",
    label: "วันที่บัตรหมดอายุ",
    id: "siam-8",
    kind: "text",
    placeholder: "วันที่บัตรหมดอายุ",
    important: false,
    required: false,
  },
  {
    name: "photo",
    label: "รูปภาพ",
    id: "siam-9",
    kind: "photo",
    placeholder: "",
    important: false,
    required: false,
  },
  {
    name: "mobile",
    label: "เบอร์มือถือ",
    id: "siam-10",
    kind: "text",
    placeholder: "เบอร์มือถือ",
    important: true,
    required: false,
  },
  {
    name: "phone2",
    label: "เบอร์โทรติดต่อที่สะดวก",
    id: "siam-11",
    kind: "text",
    placeholder: "เบอร์โทรติดต่อที่สะดวก",
    important: false,
    required: false,
  },
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
