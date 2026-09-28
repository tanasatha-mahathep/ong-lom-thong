import { businessDate } from "@ong/core";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { type AppEnv, apiError, requireRole, requireSession } from "../lib/context";
import { PurchaseQuery, purchaseCsv, purchaseReport, reportBranches, scopeTo } from "../services/reports";

/** 400 ชี้ช่องแรกที่ผิด */
const invalid = (e: z.ZodError) => {
  const issue = e.issues[0];
  const field = issue?.path.map(String).join(".");
  return apiError(issue?.message ?? "ข้อมูลไม่ถูกต้อง", field || undefined);
};

/** ช่องค้นที่ส่งมาว่าง (เช่น ?date_from=) = ไม่ได้กรอง */
const filledOnly = (query: Record<string, string>) =>
  Object.fromEntries(Object.entries(query).filter(([, v]) => v.trim() !== ""));

/** ไฟล์ CSV มีชื่อลูกค้า — ไม่ cache · ดาวน์โหลดเป็นไฟล์ · ชื่อไฟล์ ASCII ล้วน */
const csvFile = (c: Context<AppEnv>, body: string, filename: string) =>
  c.body(body, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

/** ส่วนท้ายชื่อไฟล์เมื่อกรองสาขาเดียว (code สาขาเป็นตัวเลข 5 หลัก) */
const branchSuffix = (branchId: string | undefined, scope: { code: string }[]) =>
  branchId !== undefined && scope[0] ? `_${scope[0].code.replace(/[^A-Za-z0-9-]/g, "")}` : "";

/**
 * รายงาน (spec §3 /reports/* · M3.6) — manager/accounting/admin · staff = 403
 * ขอบเขตสาขามาจาก reportBranches() จุดเดียว (fail-closed: ไม่มีสาขาที่อ่านได้ = 403 · branch_id ที่อ่านไม่ได้ = ว่าง)
 * ?format=csv = ไฟล์ CSV (UTF-8 + BOM) ตัวเลขชุดเดียวกับ JSON
 */
export const reportRoutes = new Hono<AppEnv>()
  .use(requireSession, requireRole("manager", "accounting", "admin"))
  .get("/purchase", async (c) => {
    const readable = await reportBranches(c.var.db, c.var.viewer);
    if (readable.length === 0) return c.json(apiError("forbidden"), 403);
    const query = PurchaseQuery.safeParse(filledOnly(c.req.query()));
    if (!query.success) return c.json(invalid(query.error), 400);
    const today = businessDate(c.var.now());
    const from = query.data.date_from ?? `${today.slice(0, 8)}01`;
    const to = query.data.date_to ?? today;
    if (from > to) return c.json(apiError("date_from ต้องไม่เกิน date_to", "date_to"), 400);

    const scope = scopeTo(readable, query.data.branch_id);
    const report = await purchaseReport(c.var.db, scope, { from, to, metal: query.data.metal ?? null });
    if (query.data.format === "csv") {
      return csvFile(c, purchaseCsv(report), `purchase_${from}_${to}${branchSuffix(query.data.branch_id, scope)}.csv`);
    }
    c.header("Cache-Control", "no-store");
    return c.json(report);
  });
