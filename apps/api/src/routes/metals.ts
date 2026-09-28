import { metal } from "@ong/db";
import { asc } from "drizzle-orm";
import { Hono } from "hono";
import { type AppEnv, requireAnyBranch, requireSession } from "../lib/context";

/** โลหะที่รับซื้อ — ลำดับตาม dropdown ระบบเดิม (ทอง · นาก · เงิน · แพลตตินั่ม) · ต้องมีสาขาที่เปิดอยู่ (fail-closed) */
export const metalRoutes = new Hono<AppEnv>().use(requireSession, requireAnyBranch).get("/", async (c) => {
  const rows = await c.var.db.select().from(metal).orderBy(asc(metal.sortOrder), asc(metal.code));
  return c.json(
    rows.map((m) => ({
      id: m.id,
      code: m.code,
      name_th: m.nameTh,
      unit: m.unit,
      assessment_enabled: m.assessmentEnabled,
    })),
  );
});
