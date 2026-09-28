import type { Db, Role } from "@ong/db";
import { createMiddleware } from "hono/factory";
import type { Auth } from "../auth";
import type { Env } from "../env";
import type { Viewer } from "./scope";

export interface AppEnv {
  Variables: {
    db: Db;
    auth: Auth;
    env: Env;
    viewer: Viewer;
    /** นาฬิกา — ฉีดเข้ามาได้เพื่อให้เทสต์กำหนดวันเวลาเอง */
    now: () => Date;
  };
}

/** error ทุกตัวของ API รูปเดียวกัน (spec §5) */
export const apiError = (error: string, field?: string) => (field ? { error, field } : { error });

/** ต้อง login และบัญชียังเปิดอยู่ — ไม่งั้น 401 */
export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  const result = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!result || !result.user.isActive) return c.json(apiError("unauthorized"), 401);
  const { user, session } = result;
  c.set("viewer", {
    userId: user.id,
    sessionId: session.id,
    name: user.name,
    email: user.email,
    role: user.role,
    branchId: user.branchId ?? null,
    allowedBranchIds: user.allowedBranchIds ?? [],
    canViewAll: user.canViewAll ?? false,
    currentBranchId: session.currentBranchId ?? null,
  });
  await next();
});

/** จำกัด role (spec §10) — ไม่มีสิทธิ์ = 403 */
export const requireRole = (...roles: Role[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!roles.includes(c.var.viewer.role)) return c.json(apiError("forbidden"), 403);
    await next();
  });
