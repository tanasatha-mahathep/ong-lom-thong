import { businessDate } from "@ong/core";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, requireAnyBranch, requireRole, requireSession } from "../lib/context";
import { type BranchRef, currentBranch, forUser } from "../lib/scope";
import {
  GoldPriceInputError,
  type TodayPrice,
  clearBranchPrice,
  loadGoldSetting,
  priceForBranch,
  pricesForBranches,
  quoteGoldPrice,
  setBranchPrice,
  setCentralPrice,
} from "../services/goldPrice";

// เงินรับเป็น string เท่านั้น — ตัวเลข JSON (float) ถูกปฏิเสธ (CLAUDE.md กฎ 1)
const QuoteBody = z.object({
  bar_sell: z.string(),
  /** ใส่เมื่อกำลังตั้งราคาเฉพาะสาขา — คำเตือนเทียบราคาที่สาขานั้นใช้ครั้งก่อน (เหมือนตอนบันทึก) */
  branch_id: z.string().max(64).nullish(),
});
const SetBody = z.object({ bar_sell: z.string(), confirm_typo: z.boolean().optional() });

const BAR_SELL_ERROR = apiError("ต้องส่ง bar_sell เป็นข้อความตัวเลข", "bar_sell");
const BRANCH_ID_ERROR = apiError("branch_id ไม่ถูกต้อง", "branch_id");
const CONFIRM_TYPO_ERROR = apiError("confirm_typo ต้องเป็นจริงหรือเท็จ", "confirm_typo");

/**
 * ช่องที่ผิดจริงของ SetBody (F5) — zod คืน issue ของ bar_sell ก่อนเสมอถ้าทั้งคู่ผิด (ลำดับตาม schema)
 * confirm_typo ผิดชนิด (เช่นส่ง "yes" แทน boolean) ต้องชี้ field "confirm_typo" ไม่ใช่ "bar_sell" ที่จริงแล้วถูก
 */
const setBodyError = (e: z.ZodError) => (e.issues[0]?.path[0] === "confirm_typo" ? CONFIRM_TYPO_ERROR : BAR_SELL_ERROR);

const toJson = (p: TodayPrice, diff: string) => ({
  date: p.date,
  bar_sell: p.barSell,
  bar_buy: p.barBuy,
  jewelry_buy: p.jewelryBuy,
  diff,
  source: p.source,
});

/** แถวราคาต่อสาขา — ใช้ทั้ง GET /today/branches และคำตอบของ PUT/DELETE ราคาเฉพาะสาขา */
const toBranchJson = (b: BranchRef, p: TodayPrice | null) => ({
  branch: { id: b.id, code: b.code, name: b.name },
  bar_sell: p?.barSell ?? null,
  bar_buy: p?.barBuy ?? null,
  jewelry_buy: p?.jewelryBuy ?? null,
  source: p?.source ?? null,
});

/**
 * สาขาที่ตั้ง/ลบราคาเฉพาะสาขาได้ — ต้องอยู่ใน forUser (เปิดอยู่ + มีสิทธิ์) เท่านั้น
 * ไม่มีสิทธิ์ / ไม่มีอยู่จริง / ปิดแล้ว / uuid ผิดรูป = null → 404 เหมือนกันหมด (ไม่บอกว่ามีอยู่)
 */
async function writableBranch(c: Context<AppEnv>): Promise<BranchRef | null> {
  const readable = await forUser(c.var.db, c.var.viewer);
  return readable.find((b) => b.id === c.req.param("branchId")) ?? null;
}

// ต้องมีสิทธิ์อย่างน้อยหนึ่งสาขาที่เปิดอยู่ (fail-closed) — บัญชีที่ไม่มีสาขา/สาขาถูกปิดหมด = 403 ทุก endpoint
export const goldPriceRoutes = new Hono<AppEnv>()
  .use(requireSession, requireAnyBranch)
  // ราคาที่สาขาปัจจุบันใช้วันนี้ — สาขาที่ไม่อยู่ในสิทธิ์แล้ว (ถูกถอน/ปิด) ไม่นับ → ราคากลาง (fail-closed)
  .get("/today", async (c) => {
    const date = businessDate(c.var.now());
    const here = currentBranch(c.var.viewer, await forUser(c.var.db, c.var.viewer));
    const price = await priceForBranch(c.var.db, date, here?.id ?? null);
    if (!price) return c.json({ ...apiError("ยังไม่ได้ตั้งราคาทองของวันนี้"), date }, 404);
    const setting = await loadGoldSetting(c.var.db);
    return c.json(toJson(price, setting.diff));
  })
  // ราคาวันนี้ของทุกสาขาที่อ่านได้ พร้อมที่มา (branch = ราคาเฉพาะสาขา · central = ราคากลาง · null = ยังไม่ตั้ง)
  .get("/today/branches", async (c) => {
    const readable = await forUser(c.var.db, c.var.viewer);
    const rows = await pricesForBranches(c.var.db, businessDate(c.var.now()), readable);
    return c.json(rows.map((r) => toBranchJson(r.branch, r.price)));
  })
  .post("/quote", async (c) => {
    const body = QuoteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const onBranch = body.error.issues[0]?.path[0] === "branch_id";
      return c.json(onBranch ? BRANCH_ID_ERROR : BAR_SELL_ERROR, 400);
    }
    let branchId: string | null = null;
    if (body.data.branch_id != null) {
      const readable = await forUser(c.var.db, c.var.viewer);
      const target = readable.find((b) => b.id === body.data.branch_id);
      if (!target) return c.json(apiError("not found", "branch_id"), 404);
      branchId = target.id;
    }
    try {
      const q = await quoteGoldPrice(c.var.db, body.data.bar_sell, businessDate(c.var.now()), branchId);
      return c.json({
        bar_sell: q.barSell,
        bar_buy: q.barBuy,
        jewelry_buy: q.jewelryBuy,
        ...(q.warning ? { warning: q.warning } : {}),
      });
    } catch (e) {
      if (e instanceof GoldPriceInputError) return c.json(apiError(e.message, "bar_sell"), 400);
      throw e;
    }
  })
  // ตั้งราคากลางของวัน — manager/admin (spec §10) · ห่างเกินเกณฑ์ต้องยืนยัน (409 ชี้ confirm_typo)
  .put("/today", requireRole("manager", "admin"), async (c) => {
    const body = SetBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(setBodyError(body.error), 400);
    const date = businessDate(c.var.now());
    try {
      const q = await quoteGoldPrice(c.var.db, body.data.bar_sell, date);
      if (q.warning && !body.data.confirm_typo) {
        return c.json({ ...apiError(q.warning, "confirm_typo"), warning: q.warning }, 409);
      }
      await setCentralPrice(c.var.db, date, q, c.var.viewer.userId, !!q.warning);
      const price = await priceForBranch(c.var.db, date, null);
      const setting = await loadGoldSetting(c.var.db);
      return c.json(toJson(price as TodayPrice, setting.diff));
    } catch (e) {
      if (e instanceof GoldPriceInputError) return c.json(apiError(e.message, "bar_sell"), 400);
      throw e;
    }
  })
  // ราคาเฉพาะสาขาของวันนี้ (อิงราคากลาง override ได้) — manager/admin เฉพาะสาขาที่เปิดอยู่และมีสิทธิ์
  // สูตรเดียวกับราคากลาง (quoteGoldPrice) · ด่านพิมพ์ผิดเทียบราคาที่สาขานั้นใช้จริงครั้งก่อน
  .put("/today/branches/:branchId", requireRole("manager", "admin"), async (c) => {
    const target = await writableBranch(c);
    if (!target) return c.json(apiError("not found"), 404);
    const body = SetBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(setBodyError(body.error), 400);
    const date = businessDate(c.var.now());
    try {
      const q = await quoteGoldPrice(c.var.db, body.data.bar_sell, date, target.id);
      if (q.warning && !body.data.confirm_typo) {
        return c.json({ ...apiError(q.warning, "confirm_typo"), warning: q.warning }, 409);
      }
      await setBranchPrice(c.var.db, date, target, q, c.var.viewer.userId, !!q.warning);
      return c.json(toBranchJson(target, await priceForBranch(c.var.db, date, target.id)));
    } catch (e) {
      if (e instanceof GoldPriceInputError) return c.json(apiError(e.message, "bar_sell"), 400);
      throw e;
    }
  })
  // ลบราคาเฉพาะสาขาของวันนี้ → กลับไปใช้ราคากลาง · ไม่มีให้ลบ = 200 สถานะปัจจุบัน (ไม่ลง audit)
  .delete("/today/branches/:branchId", requireRole("manager", "admin"), async (c) => {
    const target = await writableBranch(c);
    if (!target) return c.json(apiError("not found"), 404);
    const date = businessDate(c.var.now());
    await clearBranchPrice(c.var.db, date, target, c.var.viewer.userId);
    return c.json(toBranchJson(target, await priceForBranch(c.var.db, date, target.id)));
  });
