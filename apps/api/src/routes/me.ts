import { session } from "@ong/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, requireSession } from "../lib/context";
import { currentBranch, forUser } from "../lib/scope";

const SwitchBranch = z.object({ branch_id: z.uuid() });

export const me = new Hono<AppEnv>()
  .use(requireSession)
  .get("/", async (c) => {
    const v = c.var.viewer;
    const branches = await forUser(c.var.db, v);
    return c.json({
      user: { id: v.userId, name: v.name, email: v.email },
      role: v.role,
      branch: currentBranch(v, branches),
      branches,
      can_view_all: v.canViewAll,
    });
  })
  .post("/branch", async (c) => {
    const body = SwitchBranch.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("branch_id ไม่ถูกต้อง", "branch_id"), 400);
    const branches = await forUser(c.var.db, c.var.viewer);
    const target = branches.find((b) => b.id === body.data.branch_id);
    // fail-closed: ไม่มีสิทธิ์และไม่มีอยู่จริงตอบเหมือนกัน — ไม่บอกว่าสาขานั้นมีอยู่
    if (!target) return c.json(apiError("not found", "branch_id"), 404);
    await c.var.db.update(session).set({ currentBranchId: target.id }).where(eq(session.id, c.var.viewer.sessionId));
    return c.json({ branch: target });
  });
