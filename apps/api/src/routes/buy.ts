import { businessTime } from "@ong/core";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { z } from "zod";
import { type AppEnv, apiError, requireAnyBranch, requireRole, requireSession } from "../lib/context";
import { forUser } from "../lib/scope";
import { receiptForScreen } from "../services/receiptPdf";
import { buyPdfRoutes } from "./buyPdf";
import {
  BuyError,
  ListQuery,
  QuoteBody,
  SaveBody,
  getBuy,
  listBuys,
  prepareBuy,
  quoteJson,
  saveBuy,
} from "../services/buy";

// บิลละไม่เกิน 50 แถว + ชำระ 10 แถว — เกินนี้ตัดทิ้งก่อน parse
const jsonLimit = bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json(apiError("ข้อมูลใหญ่เกินไป"), 413),
});

/** 400 ชี้ช่องแรกที่ผิด เช่น "lines.0.weight_g" */
const invalid = (e: z.ZodError) => {
  const issue = e.issues[0];
  const field = issue?.path.map(String).join(".");
  return apiError(issue?.message ?? "ข้อมูลไม่ถูกต้อง", field || undefined);
};

const readJson = (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => undefined);

/** ช่องค้นที่ส่งมาว่าง (เช่น ?date_from=) = ไม่ได้กรอง */
const filledOnly = (query: Record<string, string>) =>
  Object.fromEntries(Object.entries(query).filter(([, v]) => v.trim() !== ""));

/**
 * ซื้อเข้าหน้าร้าน (RC) — quote กับบันทึกผ่าน prepareBuy() → quoteBuy() ตัวเดียวกัน (CLAUDE.md กฎ 2)
 * เขียนได้เฉพาะสาขาที่กำลังทำงาน · อ่านเฉพาะสาขาที่มีสิทธิ์ (fail-closed · 404 ไม่บอกว่ามีอยู่)
 */
export const buyRoutes = new Hono<AppEnv>()
  .use(requireSession, requireAnyBranch)
  .get("/", async (c) => {
    const query = ListQuery.safeParse(filledOnly(c.req.query()));
    if (!query.success) return c.json(invalid(query.error), 400);
    const readable = await forUser(c.var.db, c.var.viewer);
    const { items, hasMore } = await listBuys(c.var.db, readable, query.data);
    c.header("Cache-Control", "no-store");
    return c.json({ items, page: query.data.page, has_more: hasMore });
  })
  // live preview — ตอบ 200 เสมอเมื่อ payload ถูกรูป (ok=false พร้อม errors ต่อช่อง)
  .post("/quote", jsonLimit, async (c) => {
    const body = QuoteBody.safeParse(await readJson(c));
    if (!body.success) return c.json(invalid(body.error), 400);
    try {
      const prepared = await prepareBuy(c.var.db, c.var.viewer, body.data, c.var.now());
      return c.json(quoteJson(prepared));
    } catch (e) {
      if (e instanceof BuyError) return c.json({ ...apiError(e.message, e.field), ...e.extra }, e.status);
      throw e;
    }
  })
  // accounting อ่านอย่างเดียว (spec §10)
  .post("/", requireRole("staff", "manager", "admin"), jsonLimit, async (c) => {
    const body = SaveBody.safeParse(await readJson(c));
    if (!body.success) return c.json(invalid(body.error), 400);
    const now = c.var.now();
    try {
      const { replay, receipt } = await saveBuy(
        c.var.db,
        c.var.viewer,
        body.data,
        now,
        body.data.time ?? businessTime(now),
      );
      // PDF เก็บถาวรสร้างเบื้องหลัง — ตอบทันทีด้วย pdf_status "pending" ไม่รอ Gotenberg (spec §9.2)
      if (!replay) c.var.pdf.enqueue(receipt.id);
      return c.json(receipt, replay ? 200 : 201);
    } catch (e) {
      if (e instanceof BuyError) return c.json({ ...apiError(e.message, e.field), ...e.extra }, e.status);
      throw e;
    }
  })
  .get("/:id", async (c) => {
    const readable = await forUser(c.var.db, c.var.viewer);
    const bill = await getBuy(c.var.db, readable, c.req.param("id"));
    if (!bill) return c.json(apiError("not found"), 404);
    c.header("Cache-Control", "no-store");
    // receipt = ข้อมูลใบเดียวกับที่ใช้สร้าง PDF (เลขบัตรมาสก์) — จอกับไฟล์ไม่เพี้ยนกัน
    return c.json({ ...bill, receipt: await receiptForScreen(c.var.db, c.var.env, bill.id) });
  })
  // ไฟล์ PDF · สำเนาบัตร · retry · ยกเลิกบิล — อยู่ใต้ middleware ชุดเดียวกัน (login + สาขา)
  .route("/", buyPdfRoutes);
