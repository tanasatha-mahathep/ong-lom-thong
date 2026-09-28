import { auditLog } from "@ong/db";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type AppEnv, apiError, requireRole } from "../lib/context";
import { sha256Hex } from "../lib/pdfArchive";
import { forUser } from "../lib/scope";
import { VoidBody, voidBuy } from "../services/buyVoid";
import { getBuy } from "../services/buy";
import { findReadableReceipt, missingFiles, receiptForScreen } from "../services/receiptPdf";

/**
 * ไฟล์ของบิลซื้อเข้า (spec §5 · §9.2 · R12 · R15) — mount ใต้ buyRoutes (ต้อง login + มีสิทธิ์อย่างน้อยหนึ่งสาขา)
 * - บิลที่อ่านไม่ได้/ไม่มี = 404 เสมอ (fail-closed) · ไฟล์ออกทาง api เท่านั้น no-store + nosniff (R13)
 * - เสิร์ฟไฟล์ที่เก็บไว้ ไม่ render ใหม่ · ตรวจ sha256 กับที่บันทึกก่อนส่งทุกครั้ง
 */

const jsonLimit = bodyLimit({ maxSize: 8 * 1024, onError: (c) => c.json(apiError("ข้อมูลใหญ่เกินไป"), 413) });

const NOT_FOUND = apiError("not found");

async function serveStored(c: Context<AppEnv>, key: string, sha256: string, filename: string) {
  const object = await c.var.storage.get(key);
  if (!object || sha256Hex(object.body) !== sha256) {
    // ไฟล์หาย/ถูกแก้หลังบันทึก — ห้ามส่งเอกสารที่ไม่ตรงหลักฐาน
    console.error(`[pdf] stored file does not match its record: ${key}`);
    return c.json(apiError("ไฟล์ไม่ตรงกับที่บันทึกไว้ — แจ้งผู้ดูแลระบบ"), 500);
  }
  return c.body(object.body, 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
}

const notReady = (status: string) => apiError(`PDF ยังไม่พร้อม (${status})`);

export const buyPdfRoutes = new Hono<AppEnv>()
  /**
   * ใบรับซื้อ — บิลที่ยกเลิกแล้วได้ฉบับยกเลิก (ตรา "ยกเลิก") เป็นค่าเริ่มต้น
   * ?version=original = ฉบับเดิม · ?version=void = ฉบับยกเลิก (บิลที่ยังไม่ยกเลิก = 404)
   */
  .get("/:id/pdf", async (c) => {
    const version = c.req.query("version");
    if (version !== undefined && version !== "original" && version !== "void") {
      return c.json(apiError("version ต้องเป็น original หรือ void", "version"), 400);
    }
    const bill = await findReadableReceipt(c.var.db, await forUser(c.var.db, c.var.viewer), c.req.param("id"));
    if (!bill) return c.json(NOT_FOUND, 404);
    c.header("Cache-Control", "no-store");
    const wantVoid = version === "void" || (version === undefined && bill.status === "void");
    if (wantVoid) {
      if (bill.status !== "void") return c.json(NOT_FOUND, 404);
      if (bill.voidPdfStatus !== "ready" || !bill.voidPdfKey || !bill.voidPdfSha256) {
        return c.json({ ...notReady(bill.voidPdfStatus), pdf_status: bill.voidPdfStatus, version: "void" }, 409);
      }
      return serveStored(c, bill.voidPdfKey, bill.voidPdfSha256, `${bill.docNo}_void.pdf`);
    }
    if (bill.pdfStatus !== "ready" || !bill.pdfKey || !bill.pdfSha256) {
      return c.json({ ...notReady(bill.pdfStatus), pdf_status: bill.pdfStatus, version: "original" }, 409);
    }
    return serveStored(c, bill.pdfKey, bill.pdfSha256, `${bill.docNo}.pdf`);
  })
  /** สำเนาบัตรประชาชน — accounting/admin เท่านั้น (spec §5) · audit ทุกครั้งที่เปิดไฟล์ (PDPA) */
  .get("/:id/idcard", requireRole("accounting", "admin"), async (c) => {
    const bill = await findReadableReceipt(c.var.db, await forUser(c.var.db, c.var.viewer), c.req.param("id"));
    if (!bill) return c.json(NOT_FOUND, 404);
    c.header("Cache-Control", "no-store");
    if (bill.idcardStatus === "none") return c.json(apiError("บิลนี้ไม่มีสำเนาบัตร"), 404);
    if (bill.idcardStatus !== "ready" || !bill.idcardPdfKey || !bill.idcardSha256) {
      return c.json(
        { ...apiError(`สำเนาบัตรยังไม่พร้อม (${bill.idcardStatus})`), idcard_status: bill.idcardStatus },
        409,
      );
    }
    // บันทึกก่อนส่งไฟล์ — บันทึกไม่ได้ = ไม่ส่ง
    await c.var.db.insert(auditLog).values({
      userId: c.var.viewer.userId,
      action: "buy.idcard_view",
      tableName: "buy_receipt",
      rowId: bill.id,
      diff: { doc_no: bill.docNo, key: bill.idcardPdfKey },
    });
    return serveStored(c, bill.idcardPdfKey, bill.idcardSha256, `${bill.docNo}_idcard.pdf`);
  })
  /** สั่งสร้างไฟล์ที่ยังขาด/ล้มเหลวใหม่ (manager/admin · audit) — รอผลแล้วตอบสถานะ */
  .post("/:id/pdf/retry", requireRole("manager", "admin"), async (c) => {
    const bill = await findReadableReceipt(c.var.db, await forUser(c.var.db, c.var.viewer), c.req.param("id"));
    if (!bill) return c.json(NOT_FOUND, 404);
    const before = {
      pdf_status: bill.pdfStatus,
      idcard_status: bill.idcardStatus,
      void_pdf_status: bill.voidPdfStatus,
    };
    // retry ที่คนสั่งรวมไฟล์ invalid ด้วย (หลังแก้ข้อมูลแล้ว) — loop อัตโนมัติไม่แตะ
    if (missingFiles(bill, { includeInvalid: true }).length === 0) {
      return c.json({ ...apiError("ไฟล์ครบแล้ว ไม่ต้องสร้างใหม่"), ...before }, 409);
    }
    await c.var.db.insert(auditLog).values({
      userId: c.var.viewer.userId,
      action: "buy.pdf_retry",
      tableName: "buy_receipt",
      rowId: bill.id,
      diff: { doc_no: bill.docNo, before },
    });
    const result = await c.var.pdf.archive(bill.id, { includeInvalid: true });
    if (!result) return c.json(NOT_FOUND, 404);
    const { busy: _busy, ...statuses } = result;
    return c.json(statuses);
  })
  /** ยกเลิกบิล (manager/admin) — reason บังคับ · ยกเลิกซ้ำ = 409 · ตอบบิลเต็ม + void_pdf_status */
  .post("/:id/void", requireRole("manager", "admin"), jsonLimit, async (c) => {
    const body = VoidBody.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) {
      const issue = body.error.issues[0];
      return c.json(apiError(issue?.message ?? "ข้อมูลไม่ถูกต้อง", "reason"), 400);
    }
    const readable = await forUser(c.var.db, c.var.viewer);
    const id = c.req.param("id");
    const result = await voidBuy(c.var.db, readable, c.var.viewer, id, body.data.reason, c.var.now());
    if (result === "not_found") return c.json(NOT_FOUND, 404);
    if (result === "already_void") return c.json(apiError("บิลนี้ถูกยกเลิกไปแล้ว", "status"), 409);
    c.var.pdf.enqueue(id);
    const bill = await getBuy(c.var.db, readable, id);
    c.header("Cache-Control", "no-store");
    return c.json({ ...bill, receipt: await receiptForScreen(c.var.db, c.var.env, id), void_pdf_status: "pending" });
  });
