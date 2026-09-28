import { type Db, ROLES, account, session, user, verification } from "@ong/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { Env } from "./env";

/** กะทำงานหน้าร้าน — session หมดอายุใน 12 ชม. และต่ออายุเมื่อใช้งานทุกชั่วโมง */
const SESSION_SECONDS = 60 * 60 * 12;

/**
 * IP ของ client สำหรับ rate limit (sign-in ต่อ IP) และ session.ipAddress — เชื่อ X-Real-IP อย่างเดียว
 * Railway edge เขียน X-Real-IP เป็น IP จริงของ client ค่าเดียว ทับค่าที่ client ส่งมาเสมอ (ทดสอบกับ edge sin1 แล้ว)
 * ไม่ใช้ X-Forwarded-For: Railway ส่ง "<client>, <IP ของ edge>" 2 ค่า → better-auth ไม่เชื่อค่าหลายตัว = ทั้งร้านรวมถังเดียว
 * และ IP ของ edge เปลี่ยนตาม POP (trustedProxies ต้องไล่ตาม) · Forwarded / CF-Connecting-IP / True-Client-IP
 * ผ่าน edge ไปตรง ๆ = client ปลอมได้ ห้ามเพิ่ม
 * ไม่มี X-Real-IP: dev/test = 127.0.0.1 · production = ถังรวมถังเดียว + warn ใน log (ไม่เดา IP จาก header อื่น)
 * ถ้าย้ายไปหลัง proxy อื่น (เช่น nginx) ต้องตั้ง X-Real-IP = IP ของ client ทับค่าเดิมทุก request
 */
export const CLIENT_IP_HEADERS = ["x-real-ip"];

/** sign-in ต่อนาที ต่อ IP ของ client — ครั้งที่เกิน = 429 จนครบหน้าต่าง 60 วินาที */
export const SIGN_IN_PER_MINUTE = 20;

export function createAuth(db: Db, env: Env) {
  return betterAuth({
    appName: "ONG หลอมทอง",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    // SPA กับ API origin เดียว — CSRF: better-auth ตรวจ Origin ของทุก request ที่เปลี่ยนสถานะ
    trustedOrigins: [env.BETTER_AUTH_URL],
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: {
      enabled: true,
      // ไม่มีสมัครเอง — ผู้ดูแลสร้างบัญชีให้ (scripts/create-user)
      disableSignUp: true,
      minPasswordLength: 10,
    },
    user: {
      additionalFields: {
        // input: false = client ตั้งค่าเองไม่ได้ ทั้งตอนสมัครและตอนแก้โปรไฟล์
        role: { type: [...ROLES], required: true, defaultValue: "staff", input: false },
        branchId: { type: "string", required: false, input: false },
        allowedBranchIds: { type: "string[]", required: false, defaultValue: [], input: false },
        canViewAll: { type: "boolean", required: false, defaultValue: false, input: false },
        isActive: { type: "boolean", required: false, defaultValue: true, input: false },
      },
    },
    session: {
      expiresIn: SESSION_SECONDS,
      updateAge: 60 * 60,
      additionalFields: {
        // สาขาที่กำลังทำงาน เก็บฝั่งเซิร์ฟเวอร์ — เปลี่ยนผ่าน POST /api/me/branch เท่านั้น
        currentBranchId: { type: "string", required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // บัญชีถูกปิด = สร้าง session ไม่ได้ · session ใหม่เริ่มที่สาขาหลักของผู้ใช้
          before: async (s) => {
            const [u] = await db.select().from(user).where(eq(user.id, s.userId)).limit(1);
            if (!u?.isActive) return false;
            return { data: { ...s, currentBranchId: u.branchId ?? null } };
          },
        },
      },
    },
    rateLimit: {
      enabled: env.NODE_ENV !== "test",
      window: 60,
      max: 100,
      // พนักงานร้านเดียวกันออกเน็ตด้วย IP เดียว (NAT) — 20 ครั้ง/นาที ต่อ IP ให้ login พร้อมกันทั้งร้านได้ (ตัดสิน 29 ก.ย.)
      customRules: { "/sign-in/email": { window: 60, max: SIGN_IN_PER_MINUTE } },
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
      ipAddress: { ipAddressHeaders: CLIENT_IP_HEADERS },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
