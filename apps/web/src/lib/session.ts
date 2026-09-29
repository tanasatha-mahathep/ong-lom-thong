import { z } from "zod";
import i18next from "@/i18n";
import { ApiError, apiFetch, errorMessage } from "@/lib/api";
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
export async function switchBranch(branchId: string, { signal }: { signal?: AbortSignal } = {}) {
  const { branch } = await apiFetch("/api/me/branch", {
    method: "POST",
    json: { branch_id: branchId },
    schema: SwitchBranchSchema,
    signal,
  });
  return branch;
}

/** ข้อความของ error ตอน login (เรียงตามสิ่งที่พนักงานเจอบ่อย) — ข้อความอยู่ใน auth.errors */
export function signInErrorMessage(e: unknown, origin: string): string {
  const t = i18next.getFixedT(null, "auth");
  if (!(e instanceof ApiError)) return t("errors.failed");
  if (e.status === 0) return errorMessage(e);
  // api จำกัด 20 ครั้ง/นาที/IP
  if (e.status === 429) return t("errors.rateLimited");
  // บัญชีถูกปิด — databaseHooks ของ api ไม่ยอมสร้าง session
  if (e.code === "FAILED_TO_CREATE_SESSION") return t("errors.disabled");
  if (e.status === 400 || e.status === 401) return t("errors.invalidCredentials");
  if (e.status === 403 && (e.error === "forbidden origin" || e.code?.includes("ORIGIN"))) {
    return t("errors.forbiddenOrigin", { origin });
  }
  return t("errors.failed");
}

/** อักขระควบคุม (tab/ขึ้นบรรทัด ฯลฯ) และ backslash — browser ตัดทิ้งหรือแปลงเป็น "/" จน path กลายเป็นโดเมนอื่นได้ */
function hasUnsafeChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === "\\") return true;
  }
  return false;
}

function decode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * ปลายทางหลัง login (?redirect=) ต้องเป็นหน้าในแอปเท่านั้น — กัน open redirect ไปเว็บอื่น
 * แปลงด้วย URL จริงเทียบกับ origin ของแอป แล้วคืนแค่ path + search + hash · ไม่ผ่าน = undefined (ไปหน้าแรก)
 */
export function safeRedirect(value: unknown, origin: string = window.location.origin): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  const decoded = decode(value);
  // ตรวจทั้งก่อนและหลัง decode — "%09" / "%5C" กลายเป็นอักขระอันตรายหลัง decode
  if (decoded === undefined || hasUnsafeChar(value) || hasUnsafeChar(decoded)) return undefined;

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  // "/.//host" → pathname "//host" · "/%2F%2Fhost" decode แล้วเป็น "///host" — คือ URL ไม่มี scheme ไปโดเมนอื่น
  const path = decode(url.pathname);
  if (path === undefined || path.startsWith("//") || decoded.startsWith("//")) return undefined;
  // วนกลับมาหน้า login ไม่มีประโยชน์
  if (url.pathname === "/login") return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}
