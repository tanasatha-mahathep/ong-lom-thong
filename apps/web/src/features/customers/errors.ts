import { ApiError } from "@/lib/api";
import { type FieldName, isFieldName } from "./fields";
import type { CustomersKey, Message } from "./i18n";

/** error จากการบันทึก ในรูปที่ฟอร์มแสดง — มี `field` = แสดงใต้ช่องนั้น · ไม่มี = แสดงรวมท้ายฟอร์ม */
export interface ServerError extends Message {
  field?: FieldName;
  /** 409 เลขบัตรซ้ำ — id ของลูกค้าเดิม (ไม่มีเมื่อชนกันพร้อมกันสองเครื่อง) */
  existingId?: string;
}

/**
 * ข้อความของ API ลูกค้า (apps/api: services/customers.ts · lib/text.ts · routes/customers.ts) → key ของ locale
 * ข้อความที่ไม่รู้จัก (รวมข้อความอังกฤษ default ของ zod) ใช้ข้อความกลางของช่องแทน — ไม่แสดงข้อความดิบของเซิร์ฟเวอร์
 */
const KNOWN = new Map<string, CustomersKey>([
  ["มีลูกค้าเลขบัตรนี้อยู่แล้ว", "errors.duplicate"],
  ["กรุณากรอกเลขบัตรประชาชน", "validation.nationalIdRequired"],
  ["เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก · ตรวจหลักสุดท้ายไม่ผ่าน)", "validation.nationalIdInvalid"],
  ["กรุณากรอกชื่อ-นามสกุล", "validation.nameRequired"],
  ["มีอักขระที่ใช้ไม่ได้ (อักขระควบคุม)", "errors.controlChars"],
  ["รูปใหญ่เกิน 5 MB", "photo.tooLarge"],
  ["รับเฉพาะรูป JPEG · PNG · WebP", "photo.wrongType"],
]);
const TOO_LONG = /^ยาวเกิน (\d+) ตัวอักษร$/;

function messageOf(text: string, fallback: CustomersKey): Message {
  const known = KNOWN.get(text);
  if (known) return { key: known };
  const tooLong = TOO_LONG.exec(text);
  return tooLong ? { key: "errors.tooLong", vars: { max: tooLong[1] ?? "" } } : { key: fallback };
}

const existingIdOf = (body: unknown): string | undefined =>
  typeof body === "object" && body !== null && "existing_id" in body && typeof body.existing_id === "string"
    ? body.existing_id
    : undefined;

/** error จาก POST/PUT /api/customers → ข้อความ (key) และช่องที่ต้องแก้ */
export function mapServerError(error: unknown): ServerError {
  if (!(error instanceof ApiError)) return { key: "errors.unexpected" };
  const { status, field } = error;
  if (status === 0) return { key: "errors.network" };
  if (status === 401) return { key: "errors.sessionExpired" };
  if (status === 403) return { key: "errors.forbidden" };
  if (status === 404) return { key: "errors.notFound" };
  if (status >= 500) return { key: "errors.serverFailure" };
  if (status === 409) return { field: "national_id", key: "errors.duplicate", existingId: existingIdOf(error.body) };
  if (status === 413) return { field: "photo", key: "photo.tooLarge" };
  if (isFieldName(field)) return { field, ...messageOf(error.error, "errors.invalidField") };
  return messageOf(error.error, "errors.unexpected");
}
