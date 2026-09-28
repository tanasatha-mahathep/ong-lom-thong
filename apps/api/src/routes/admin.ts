import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import { type AppEnv, apiError, requireRole, requireSession } from "../lib/context";
import { AdminError } from "../services/adminCommon";
import {
  BranchCreate,
  BranchUpdate,
  createBranch,
  listBranches,
  toBranchJson,
  updateBranch,
} from "../services/branches";
import {
  ResetPassword,
  UserCreate,
  UserListQuery,
  UserUpdate,
  branchRefs,
  createUserAccount,
  credentialTools,
  listUsers,
  resetUserPassword,
  toUserJson,
  updateUserAccount,
} from "../services/users";

const NOT_JSON = "ต้องส่งข้อมูลเป็น JSON object";

// ฟอร์มผู้ดูแลเล็กมาก — เกินนี้ตัดทิ้งก่อน parse
const jsonLimit = bodyLimit({
  maxSize: 16 * 1024,
  onError: (c) => c.json(apiError("ข้อมูลใหญ่เกินไป"), 413),
});

/** 400 ชี้ช่องแรกที่ผิด เช่น "allowed_branch_ids.0" · body ไม่ใช่ object = ข้อความเดียวกันทุก endpoint */
const invalid = (e: z.ZodError) => {
  const issue = e.issues[0];
  const field = issue?.path.map(String).join(".");
  return field ? apiError(issue?.message ?? "ข้อมูลไม่ถูกต้อง", field) : apiError(NOT_JSON);
};

/** JSON เสีย = undefined (→ 400) · body ว่างใช้ค่า emptyAs (reset-password ที่ให้ระบบสุ่ม ไม่ต้องมี body) */
async function readJson(c: Context<AppEnv>, emptyAs?: unknown): Promise<unknown> {
  const raw = await c.req.text();
  if (raw.trim() === "" && emptyAs !== undefined) return emptyAs;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** ช่องค้นที่ส่งมาว่าง (เช่น ?role=) = ไม่ได้กรอง */
const filledOnly = (query: Record<string, string>) =>
  Object.fromEntries(Object.entries(query).filter(([, v]) => v.trim() !== ""));

const failed = (c: Context<AppEnv>, e: unknown) => {
  if (e instanceof AdminError) return c.json(apiError(e.message, e.field), e.status);
  throw e;
};

const actor = (c: Context<AppEnv>) => ({ userId: c.var.viewer.userId, via: "api" as const });

/** ทุกคำตอบของผู้ดูแลห้าม cache — มีรหัสผ่านชั่วคราวและข้อมูลบัญชี */
const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const branches = new Hono<AppEnv>()
  .get("/", async (c) => c.json({ items: (await listBranches(c.var.db)).map(toBranchJson) }))
  .post("/", jsonLimit, async (c) => {
    const body = BranchCreate.safeParse(await readJson(c));
    if (!body.success) return c.json(invalid(body.error), 400);
    try {
      const row = await createBranch(c.var.db, body.data, c.var.viewer.userId);
      return c.json({ branch: toBranchJson(row) }, 201);
    } catch (e) {
      return failed(c, e);
    }
  })
  .put("/:id", jsonLimit, async (c) => {
    const body = BranchUpdate.safeParse(await readJson(c));
    if (!body.success) return c.json(invalid(body.error), 400);
    try {
      const { row, affectedUsers } = await updateBranch(c.var.db, c.req.param("id"), body.data, c.var.viewer.userId);
      return c.json({ branch: toBranchJson(row), affected_users: affectedUsers });
    } catch (e) {
      return failed(c, e);
    }
  });

const users = new Hono<AppEnv>()
  .get("/", async (c) => {
    const query = UserListQuery.safeParse(filledOnly(c.req.query()));
    if (!query.success) return c.json(invalid(query.error), 400);
    return c.json({ items: await listUsers(c.var.db, query.data) });
  })
  .post("/", jsonLimit, async (c) => {
    const body = UserCreate.safeParse(await readJson(c));
    if (!body.success) return c.json(invalid(body.error), 400);
    try {
      const tools = await credentialTools(c.var.auth);
      const { row, temporaryPassword } = await createUserAccount(c.var.db, tools, body.data, actor(c));
      const user = toUserJson(row, await branchRefs(c.var.db));
      return c.json({ user, temporary_password: temporaryPassword }, 201);
    } catch (e) {
      return failed(c, e);
    }
  })
  .put("/:id", jsonLimit, async (c) => {
    const body = UserUpdate.safeParse(await readJson(c));
    if (!body.success) return c.json(invalid(body.error), 400);
    try {
      const { row, sessionsRevoked } = await updateUserAccount(c.var.db, c.req.param("id"), body.data, actor(c));
      return c.json({ user: toUserJson(row, await branchRefs(c.var.db)), sessions_revoked: sessionsRevoked });
    } catch (e) {
      return failed(c, e);
    }
  })
  .post("/:id/reset-password", jsonLimit, async (c) => {
    const body = ResetPassword.safeParse(await readJson(c, {}));
    if (!body.success) return c.json(invalid(body.error), 400);
    try {
      const tools = await credentialTools(c.var.auth);
      const { temporaryPassword, sessionsRevoked } = await resetUserPassword(
        c.var.db,
        tools,
        c.req.param("id"),
        body.data.password,
        actor(c),
      );
      return c.json({ temporary_password: temporaryPassword, sessions_revoked: sessionsRevoked });
    } catch (e) {
      return failed(c, e);
    }
  });

/**
 * ผู้ดูแลระบบเท่านั้น (spec §10: admin = ผู้ใช้/สาขา/ตั้งค่า) — role อื่น 403 แม้ can_view_all
 * ไม่ผูกสาขาปัจจุบัน: เป็นการตั้งค่าทั้งร้าน ไม่ใช่ข้อมูลของสาขา · ผลต่อสิทธิ์สาขามีผลทันทีผ่าน forUser()
 */
export const adminRoutes = new Hono<AppEnv>()
  .use(noStore, requireSession, requireRole("admin"))
  .route("/branches", branches)
  .route("/users", users);
