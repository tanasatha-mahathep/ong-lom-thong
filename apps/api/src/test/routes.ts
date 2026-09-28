import type { Env, Hono } from "hono";
import { inspectRoutes } from "hono/dev";

/** method ที่เปลี่ยนสถานะ — ต้องผ่าน sameOriginOnly (CSRF) · GET/HEAD/OPTIONS เป็น safe method (RFC 9110 §9.2.1) */
export const STATE_CHANGING = ["POST", "PUT", "PATCH", "DELETE"] as const;
const ALL_METHODS = ["GET", "HEAD", ...STATE_CHANGING] as const;

export interface Endpoint {
  /** GET · POST · PUT · PATCH · DELETE (route แบบ ALL ถูกกระจายเป็นทุก method) */
  method: string;
  /** รูปแบบ path ตามที่ลงทะเบียน เช่น /api/customers/:id */
  path: string;
  /** "GET /api/customers/:id" — ใช้เป็นชื่อเทสต์และ key ของ allowlist */
  key: string;
}

/**
 * endpoint ทั้งหมดที่ลงทะเบียนใน app จริง — อ่านจาก router ของ Hono (hono/dev inspectRoutes) ไม่ใช่รายการเขียนมือ
 * route ใหม่ที่ใครเพิ่มเข้ามาจึงเข้าเทสต์สัญญาอัตโนมัติ · ตัด middleware (use · bodyLimit · requireRole) ออก · ไม่ซ้ำ
 */
export function listEndpoints<E extends Env>(app: Hono<E>): Endpoint[] {
  const seen = new Map<string, Endpoint>();
  for (const route of inspectRoutes(app)) {
    if (route.isMiddleware) continue;
    const methods = route.method === "ALL" ? ALL_METHODS : [route.method];
    for (const method of methods) {
      const key = `${method} ${route.path}`;
      if (!seen.has(key)) seen.set(key, { method, path: route.path, key });
    }
  }
  return [...seen.values()];
}

const PARAM = /:[A-Za-z_]\w*(?:\{[^}]*\})?/g;

/** path มีพารามิเตอร์ (:id) หรือไม่ */
export const hasParams = (path: string) => /:[A-Za-z_]/.test(path);

/** เติมพารามิเตอร์ทุกตัวด้วยค่าเดียวกัน (encode แล้ว) · wildcard (*) เติม "x" */
export function fillParams(path: string, value: string): string {
  return path.replace(PARAM, encodeURIComponent(value)).replace(/\*/g, "x");
}
