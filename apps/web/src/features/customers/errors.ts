import { ApiError } from "@/lib/api";
import { type FieldName, isFieldName } from "./fields";

/** error จากการบันทึก ในรูปที่ฟอร์มแสดง — มี `field` = แสดงใต้ช่องนั้น · ไม่มี = แสดงรวมท้ายฟอร์ม */
export interface ServerError {
  field?: FieldName;
  message: string;
  /** 409 เลขบัตรซ้ำ — id ของลูกค้าเดิม (ไม่มีเมื่อชนกันพร้อมกันสองเครื่อง) */
  existingId?: string;
}

export const DUPLICATE_MESSAGE = "มีลูกค้าเลขบัตรนี้อยู่แล้ว";
export const NETWORK_MESSAGE = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ข้อมูลยังอยู่ในฟอร์ม กดบันทึกอีกครั้ง";
export const SERVER_FAILURE_MESSAGE = "เซิร์ฟเวอร์ขัดข้อง บันทึกไม่สำเร็จ — ข้อมูลยังอยู่ในฟอร์ม กดบันทึกอีกครั้ง";
export const UNEXPECTED_MESSAGE = "บันทึกไม่สำเร็จ — ข้อมูลยังอยู่ในฟอร์ม กดบันทึกอีกครั้ง";
export const INVALID_FIELD_MESSAGE = "ข้อมูลในช่องนี้ไม่ถูกต้อง";

/** ข้อความของ API เป็นไทยเกือบทั้งหมด — ที่ยังเป็นอังกฤษ (ข้อความ default ของ zod) ไม่แสดงให้พนักงาน */
const THAI = /[฀-๿]/;
const thaiOr = (message: string, fallback: string) => (THAI.test(message) ? message : fallback);

const existingIdOf = (body: unknown): string | undefined =>
  typeof body === "object" && body !== null && "existing_id" in body && typeof body.existing_id === "string"
    ? body.existing_id
    : undefined;

/** error จาก POST/PUT /api/customers → ข้อความภาษาไทยและช่องที่ต้องแก้ */
export function mapServerError(error: unknown): ServerError {
  if (!(error instanceof ApiError)) return { message: UNEXPECTED_MESSAGE };
  const { status, field } = error;
  if (status === 0) return { message: NETWORK_MESSAGE };
  if (status === 401) return { message: "หมดเวลาเข้าระบบ — เข้าสู่ระบบใหม่แล้วบันทึกอีกครั้ง" };
  if (status === 403) return { message: "บัญชีนี้ไม่มีสิทธิ์บันทึกข้อมูลลูกค้า" };
  if (status === 404) return { message: "ไม่พบลูกค้ารายนี้" };
  if (status >= 500) return { message: SERVER_FAILURE_MESSAGE };
  if (status === 409) {
    return {
      field: "national_id",
      message: thaiOr(error.error, DUPLICATE_MESSAGE),
      existingId: existingIdOf(error.body),
    };
  }
  if (status === 413) return { field: "photo", message: thaiOr(error.error, "รูปใหญ่เกิน 5 MB") };
  if (isFieldName(field)) return { field, message: thaiOr(error.error, INVALID_FIELD_MESSAGE) };
  return { message: thaiOr(error.error, UNEXPECTED_MESSAGE) };
}
