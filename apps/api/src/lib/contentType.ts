import { createMiddleware } from "hono/factory";
import { type AppEnv, apiError } from "./context";

const JSON_TYPE = "application/json";
const MULTIPART_TYPE = "multipart/form-data";

/** เมธอดที่ตามปกติมี body — ใช้คู่กับ Content-Length ตัดสินว่า request นี้ "มี body" จริงไหม */
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** ฟอร์มลูกค้า (มีรูปแนบ) — เส้นทางเดียวที่รับ multipart ได้ (routes/customers.ts: POST / · PUT /:id) */
const MULTIPART_ALLOWED_PATH = /^\/api\/customers(\/[^/]+)?$/;

/** better-auth ตรวจ Origin/CSRF ของเส้นทางตัวเองอยู่แล้ว — sign-in/sign-out ของเราส่ง JSON เสมอ (apps/web/src/lib/session.ts)
 * แต่เส้นทางอื่นของ better-auth (เช่น get-session ตอน login) ไม่ควรผูกกับ content-type ที่ไลบรารีเลือกเอง */
const AUTH_PREFIX = "/api/auth/";

/**
 * request นี้มี body จริงไหม — GET/HEAD ไม่นับเลย ส่วนที่เหลือดู Content-Length / Transfer-Encoding ก่อน
 * เผื่อไว้ด้วย content-type: fetch/browser ไม่ตั้ง header นี้เองถ้าไม่มี body (string → text/plain, FormData →
 * multipart อัตโนมัติ) จึงใช้แทนได้เมื่อ Content-Length ไม่ถูกส่งผ่านมา (เช่น request ที่ประกอบในหน่วยความจำของเทสต์
 * ไม่ใช่ over-the-wire — @hono/node-server ของจริงอ่าน Content-Length จาก request ที่เข้ามาได้ตรง ๆ)
 */
function hasBody(req: Request): boolean {
  if (!BODY_METHODS.has(req.method.toUpperCase())) return false;
  const len = req.headers.get("content-length");
  if (len !== null) return Number(len) > 0;
  if ((req.headers.get("transfer-encoding") ?? "").toLowerCase().includes("chunked")) return true;
  return req.headers.get("content-type") !== null;
}

/** "application/json; charset=utf-8" → "application/json" (ตัด parameter ทิ้ง เทียบตัวพิมพ์เล็ก) */
function mediaType(header: string | undefined): string {
  return (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

const UNSUPPORTED_TYPE = apiError("ต้องส่งเป็น application/json");

/**
 * defence in depth (ASVS V13.2.5 · F12 · F15 · F16) — sameOriginOnly กัน cross-site ไปแล้ว แต่ request ที่มี body
 * ยังต้องเป็น application/json เท่านั้น (charset ต่อท้ายได้) กัน content-type sniffing / CSRF ผ่านฟอร์ม text/plain
 * multipart/form-data ได้เฉพาะฟอร์มลูกค้าที่มีไฟล์แนบ · ตั้งครั้งเดียวที่ /api ไม่กระจายไปทีละ route
 * /api/auth/* ยกเว้น — ปล่อยให้ better-auth ตรวจของตัวเอง (sign-in/sign-out ของเราส่ง JSON อยู่แล้ว)
 */
export const requireJsonBody = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.path.startsWith(AUTH_PREFIX) || !hasBody(c.req.raw)) return next();
  const type = mediaType(c.req.header("content-type"));
  if (type === JSON_TYPE) return next();
  if (type === MULTIPART_TYPE && MULTIPART_ALLOWED_PATH.test(c.req.path)) return next();
  return c.json(UNSUPPORTED_TYPE, 415);
});
