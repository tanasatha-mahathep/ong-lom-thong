import { type CardStatus, normalizeNationalId } from "@ong/core";
import { z } from "zod";
import { SIAM_ID_FIELDS, type TextFieldName } from "./fields";

/** สถานะบัตรที่ API คิดจากข้อความวันหมดอายุทุกครั้งที่อ่าน (`cardStatus` ใน @ong/core) */
export const CARD_STATUSES = ["ok", "expired", "missing", "invalid"] as const satisfies readonly CardStatus[];

const CardStatusSchema = z.enum(CARD_STATUSES);
const optionalText = z.string().nullable();

/** แถวของ GET /api/customers — เลขบัตรมาสก์เสมอ (R13) */
export const CustomerListItemSchema = z.object({
  id: z.string(),
  national_id_masked: z.string(),
  name_th: z.string(),
  mobile: optionalText,
  address: optionalText,
  card_status: CardStatusSchema,
});
export type CustomerListItem = z.infer<typeof CustomerListItemSchema>;

/** GET /api/customers?q=&page= — หน้าละ 20 แถว ไม่มียอดรวม (แบ่งหน้าด้วย has_more) */
export const CustomerListSchema = z.object({
  items: z.array(CustomerListItemSchema),
  page: z.number().int().positive(),
  has_more: z.boolean(),
});
export type CustomerList = z.infer<typeof CustomerListSchema>;

/** GET /api/customers/:id — ที่เดียวที่มีเลขบัตรเต็ม (R13) · วันที่บัตรเป็นข้อความตามที่ Siam ID พิมพ์ */
export const CustomerDetailSchema = z.object({
  id: z.string(),
  national_id: z.string(),
  name_th: z.string(),
  name_en: optionalText,
  birthday_text: optionalText,
  religion: optionalText,
  address: optionalText,
  card_issue_text: optionalText,
  card_expire_text: optionalText,
  /** วันหมดอายุที่ parse ได้ตอนบันทึก (ISO ค.ศ.) · บัตรตลอดชีพหรืออ่านไม่ได้ = null */
  card_expire_date: z.iso.date().nullable(),
  card_status: CardStatusSchema,
  mobile: optionalText,
  phone2: optionalText,
  has_photo: z.boolean(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});
export type CustomerDetail = z.infer<typeof CustomerDetailSchema>;

/** ค่าในฟอร์ม — ข้อความดิบตามที่พิมพ์ (ไม่ trim ไม่แปลง) · รูปใหม่ = File (ไม่เลือก = null ใช้รูปเดิม) */
export type CustomerFormValues = Record<TextFieldName, string> & { photo: File | null };

export const EMPTY_CUSTOMER: CustomerFormValues = {
  national_id: "",
  name_th: "",
  name_en: "",
  birthday_text: "",
  religion: "",
  address: "",
  card_issue_text: "",
  card_expire_text: "",
  photo: null,
  mobile: "",
  phone2: "",
};

/** ลูกค้าที่มีอยู่ → ค่าเริ่มต้นของฟอร์มแก้ไข (null = ช่องว่าง) */
export function toFormValues(customer: CustomerDetail): CustomerFormValues {
  return {
    national_id: customer.national_id,
    name_th: customer.name_th,
    name_en: customer.name_en ?? "",
    birthday_text: customer.birthday_text ?? "",
    religion: customer.religion ?? "",
    address: customer.address ?? "",
    card_issue_text: customer.card_issue_text ?? "",
    card_expire_text: customer.card_expire_text ?? "",
    photo: null,
    mobile: customer.mobile ?? "",
    phone2: customer.phone2 ?? "",
  };
}

/**
 * body ของ POST/PUT /api/customers ตามลำดับ Siam ID (รูปอยู่ลำดับที่ 9)
 * - ส่งครบ 10 ช่องข้อความเสมอ แม้ว่าง — PUT แทนทั้งแถว ("" = ล้างค่า)
 * - ค่าดิบตามที่พิมพ์ — เซิร์ฟเวอร์ตัดช่องว่าง/ขีดของเลขบัตรและ parse วันที่เอง
 * - รูปส่งเฉพาะเมื่อเลือกรูปใหม่ — ไม่ส่ง = ใช้รูปเดิม
 */
export function toCustomerFormData(values: CustomerFormValues): FormData {
  const form = new FormData();
  for (const field of SIAM_ID_FIELDS) {
    if (field.kind === "photo") {
      if (values.photo) form.append("photo", values.photo, values.photo.name || "photo");
    } else {
      form.append(field.name, values[field.name]);
    }
  }
  return form;
}

/**
 * เลขบัตรเต็มจัดกลุ่มแบบหน้าบัตร 1-4-5-2-1: "1103700123458" → "1 1037 00123 45 8"
 * ใช้เฉพาะหน้าลูกค้าเดี่ยว (R13) · รูปไม่ครบ 13 หลักแสดงตามเดิม
 */
export function formatNationalId(nationalId: string): string {
  const parts = /^(\d)(\d{4})(\d{5})(\d{2})(\d)$/.exec(normalizeNationalId(nationalId));
  return parts ? parts.slice(1).join(" ") : nationalId;
}

/** คำค้นของ GET /api/customers: ว่าง หรือ 2–100 ตัวอักษร (สั้นกว่านั้น API ตอบ 400) */
export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

/** อักขระควบคุม (C0 และ DEL) — API ตอบ 400 เมื่อ q มีตัวเหล่านี้ */
const isControlChar = (char: string) => {
  const code = char.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
};

/**
 * ทำคำค้นให้ส่งได้: ตัดอักขระควบคุม (มักติดมากับการวาง) และช่องว่างหัวท้าย
 * ใช้กับช่องค้นเท่านั้น — ช่อง Siam ID ห้ามแก้ค่าที่พิมพ์ (ส่งดิบ ให้ API ชี้ช่องที่ผิดเอง)
 */
export function normalizeQuery(raw: string): string {
  return Array.from(raw)
    .filter((char) => !isControlChar(char))
    .join("")
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .trim();
}
