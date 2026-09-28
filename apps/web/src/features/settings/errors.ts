import { ApiError, errorMessage } from "@/lib/api";

/** error จากการบันทึก ในรูปที่ฟอร์มแสดง — มี `field` = ใต้ช่องนั้น · ไม่มี = ข้อความรวมท้ายฟอร์ม */
export interface SaveError {
  /** ช่องที่ API ชี้ (`allowed_branch_ids.2` → `allowed_branch_ids`) — เฉพาะช่องที่ฟอร์มนี้มี */
  field?: string;
  /** 403 — บัญชีไม่ใช่ผู้ดูแลระบบแล้ว (ถูกเปลี่ยนสิทธิ์ระหว่างเปิดหน้า) ฟอร์มแสดงข้อความของหน้านี้แทน */
  forbidden: boolean;
  /** errorMessage(): ข้อความไทยของ API (ชี้ช่อง · 409 สำนักงานใหญ่ซ้ำ ฯลฯ) หรือคำแปลตาม status */
  message: string;
}

/** 400/409 ของ /api/admin/* ตอบ `{error, field?}` — ข้อความไทยของ API แสดงตรง ๆ ใต้ช่องที่ชี้ */
export function saveErrorOf(error: unknown, fields: readonly string[]): SaveError {
  const pointed = error instanceof ApiError ? error.field?.split(".")[0] : undefined;
  return {
    field: pointed !== undefined && fields.includes(pointed) ? pointed : undefined,
    forbidden: isForbidden(error),
    message: errorMessage(error),
  };
}

/** API ตอบ 403 — ไม่ใช่ผู้ดูแลระบบ (เปิด URL ตรง ๆ หรือถูกลดสิทธิ์ระหว่างเปิดหน้า) */
export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;
