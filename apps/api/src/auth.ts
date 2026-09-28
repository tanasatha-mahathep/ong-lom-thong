import { type Db, ROLES, account, session, user, verification } from "@ong/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { Env } from "./env";

/** กะทำงานหน้าร้าน — session หมดอายุใน 12 ชม. และต่ออายุเมื่อใช้งานทุกชั่วโมง */
const SESSION_SECONDS = 60 * 60 * 12;

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
      customRules: { "/sign-in/email": { window: 60, max: 5 } },
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === "production",
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
