import { type ExternalToast, toast } from "sonner";

/**
 * toast หลังส่งฟอร์ม (U5) — ใช้สองตัวนี้แทน `toast.success` / `toast.error` ตรง ๆ ให้ทุกหน้าเหมือนกัน
 * สำเร็จ = หายเองใน ~4 วินาที · ผิดพลาด = ค้างจนกดปิด (ปุ่มปิดมีป้าย "ปิดการแจ้งเตือน")
 * ตำแหน่ง top-center ตั้งที่ `<Toaster>` ใน routes/__root.tsx
 */

export const TOAST_POSITION = "top-center" as const;
export const TOAST_SUCCESS_MS = 4000;

export function notifySuccess(message: string, options?: ExternalToast) {
  return toast.success(message, { duration: TOAST_SUCCESS_MS, ...options });
}

export function notifyError(message: string, options?: ExternalToast) {
  return toast.error(message, { duration: Number.POSITIVE_INFINITY, closeButton: true, ...options });
}
