import { businessDate } from "@ong/core";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { type AppEnv, apiError, requireAnyBranch, requireSession } from "../lib/context";
import { MAX_PHOTO_BYTES } from "../lib/image";
import { UNUSABLE_CHARS_MSG, isCleanText } from "../lib/text";
import {
  CustomerInputError,
  createCustomer,
  findCustomer,
  parseCustomerInput,
  recordPhotoView,
  searchCustomers,
  toDetail,
  toListItem,
  toMaskedDetail,
  updateCustomer,
} from "../services/customers";

const ListQuery = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .refine(isCleanText, UNUSABLE_CHARS_MSG)
    .refine((q) => q.length === 0 || q.length >= 2, "ค้นอย่างน้อย 2 ตัวอักษร")
    .default(""),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});

// รูป 5 MB + ช่องข้อความ — เกินนี้ตัดทิ้งก่อน parse
const formLimit = bodyLimit({
  maxSize: MAX_PHOTO_BYTES + 256 * 1024,
  onError: (c) => c.json(apiError("รูปใหญ่เกิน 5 MB", "photo"), 413),
});

const inputError = (e: CustomerInputError) => ({ ...apiError(e.message, e.field), ...e.extra });

/** ฟอร์มลูกค้ารับเฉพาะ multipart (มีรูป) — อย่างอื่น = null */
async function readForm(c: Context<AppEnv>) {
  if (!c.req.header("content-type")?.startsWith("multipart/form-data")) return null;
  return c.req.parseBody().catch(() => null);
}
const NOT_MULTIPART = apiError("ต้องส่งเป็น multipart/form-data");

/**
 * ลูกค้าใช้ร่วมทั้งร้าน (ไม่มี branch_id) แต่ต้องมีสิทธิ์อย่างน้อยหนึ่งสาขา — fail-closed
 * เลขบัตรเต็มออกเฉพาะ GET /:id (R13) — PUT ตอบแบบมาสก์ · รูปออกทาง api เท่านั้น ไม่ cache
 * รูปทุกครั้งที่ส่งลง audit customer.photo_view (PDPA) — บันทึกไม่ได้ = ไม่ส่งรูป
 */
export const customerRoutes = new Hono<AppEnv>()
  .use(requireSession, requireAnyBranch)
  .get("/", async (c) => {
    const query = ListQuery.safeParse(c.req.query());
    if (!query.success) {
      const issue = query.error.issues[0];
      return c.json(apiError(issue?.message ?? "invalid query", String(issue?.path[0] ?? "q")), 400);
    }
    const { q, page } = query.data;
    const { rows, hasMore } = await searchCustomers(c.var.db, q, page);
    const today = businessDate(c.var.now());
    return c.json({ items: rows.map((r) => toListItem(r, today)), page, has_more: hasMore });
  })
  .post("/", formLimit, async (c) => {
    const form = await readForm(c);
    if (!form) return c.json(NOT_MULTIPART, 415);
    try {
      const input = parseCustomerInput(form);
      const row = await createCustomer(c.var.db, c.var.storage, input, form.photo, c.var.viewer.userId);
      return c.json({ id: row.id }, 201);
    } catch (e) {
      if (e instanceof CustomerInputError) return c.json(inputError(e), e.status);
      throw e;
    }
  })
  .get("/:id", async (c) => {
    const row = await findCustomer(c.var.db, c.req.param("id"));
    if (!row) return c.json(apiError("not found"), 404);
    c.header("Cache-Control", "no-store");
    return c.json(toDetail(row, businessDate(c.var.now())));
  })
  .put("/:id", formLimit, async (c) => {
    const before = await findCustomer(c.var.db, c.req.param("id"));
    if (!before) return c.json(apiError("not found"), 404);
    const form = await readForm(c);
    if (!form) return c.json(NOT_MULTIPART, 415);
    try {
      const input = parseCustomerInput(form);
      const row = await updateCustomer(c.var.db, c.var.storage, before, input, form.photo, c.var.viewer.userId);
      // เลขบัตรเต็มออกเฉพาะ GET /:id (R13 · spec §5) — response ของการแก้ไขมาสก์
      return c.json(toMaskedDetail(row, businessDate(c.var.now())));
    } catch (e) {
      if (e instanceof CustomerInputError) return c.json(inputError(e), e.status);
      throw e;
    }
  })
  .get("/:id/photo", async (c) => {
    const row = await findCustomer(c.var.db, c.req.param("id"));
    const object = row?.photoKey ? await c.var.storage.get(row.photoKey) : null;
    if (!row || !object) return c.json(apiError("not found"), 404);
    // บันทึกก่อนส่งทุกครั้ง — บันทึกไม่ได้ = throw → 500 ไม่ส่งรูป (แนวเดียวกับ GET /buy/:id/idcard)
    await recordPhotoView(c.var.db, c.var.viewer.userId, row.id);
    return c.body(object.body, 200, {
      "Content-Type": object.contentType,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    });
  });
