import { z } from "zod";
import { ApiError, apiFetch } from "@/lib/api";
import { BranchSchema } from "@/lib/queries";

/** login ด้วย better-auth (origin เดียวกัน) — สำเร็จแล้ว server ตั้ง cookie HttpOnly ให้เอง ไม่มี token ฝั่ง browser */
export async function signIn(credentials: { email: string; password: string }): Promise<void> {
  await apiFetch("/api/auth/sign-in/email", { method: "POST", json: credentials });
}

export async function signOut(): Promise<void> {
  await apiFetch("/api/auth/sign-out", { method: "POST", json: {} });
}

const SwitchBranchSchema = z.object({ branch: BranchSchema });

/** เปลี่ยนสาขาที่กำลังทำงาน (เก็บใน session ฝั่งเซิร์ฟเวอร์) — ได้สาขาใหม่กลับมา */
export async function switchBranch(branchId: string) {
  const { branch } = await apiFetch("/api/me/branch", {
    method: "POST",
    json: { branch_id: branchId },
    schema: SwitchBranchSchema,
  });
  return branch;
}

/** ข้อความภาษาไทยของ error ตอน login (เรียงตามสิ่งที่พนักงานเจอบ่อย) */
export function signInErrorMessage(e: unknown, origin: string): string {
  if (!(e instanceof ApiError)) return "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง";
  if (e.status === 0) return "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่";
  if (e.status === 429) return "ลองใหม่อีกครั้งในอีกสักครู่";
  // บัญชีถูกปิด — databaseHooks ของ api ไม่ยอมสร้าง session
  if (e.code === "FAILED_TO_CREATE_SESSION") return "บัญชีนี้ถูกปิดใช้งาน ติดต่อผู้ดูแลระบบ";
  if (e.status === 400 || e.status === 401) return "อีเมลหรือรหัสผ่านไม่ถูกต้อง";
  if (e.status === 403 && (e.error === "forbidden origin" || e.code?.includes("ORIGIN"))) {
    return `เซิร์ฟเวอร์ปฏิเสธ origin ของหน้านี้ — ตั้ง BETTER_AUTH_URL ของ api ให้ตรงกับ ${origin} แล้วเปิด api ใหม่`;
  }
  return "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง";
}

/**
 * ปลายทางหลัง login (?redirect=) ต้องเป็น path ในแอปเท่านั้น — กัน open redirect ไปเว็บอื่น
 * ไม่ผ่าน = undefined (ไปหน้าแรก)
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  // "//host" และ "/\host" browser ตีความเป็นโดเมนอื่น · วนกลับมาหน้า login ไม่มีประโยชน์
  if (value.startsWith("//") || value.startsWith("/\\") || value.startsWith("/login")) return undefined;
  return value;
}
