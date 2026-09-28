import { createMiddleware } from "hono/factory";
import { type AppEnv, apiError } from "./context";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF: request ที่เปลี่ยนสถานะต้องมี Origin ตรงกับแอปเท่านั้น (SPA กับ API origin เดียว · browser ส่ง Origin กับ POST เสมอ)
 * better-auth ตรวจเฉพาะ endpoint ของตัวเองและเฉพาะตอนมี cookie — route ของเราต้องกันเอง
 * ไม่มี Origin = ปฏิเสธ (script ที่เรียก API ต้องใส่ Origin ให้ถูก)
 */
export const sameOriginOnly = (appUrl: string) => {
  const allowed = new URL(appUrl).origin;
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && c.req.header("origin") !== allowed) {
      return c.json(apiError("forbidden origin"), 403);
    }
    await next();
  });
};
