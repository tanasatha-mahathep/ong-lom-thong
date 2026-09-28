import { businessDate } from "@ong/core";
import { Hono } from "hono";
import { z } from "zod";
import { type AppEnv, apiError, requireRole, requireSession } from "../lib/context";
import {
  GoldPriceInputError,
  type TodayPrice,
  loadGoldSetting,
  priceForBranch,
  quoteGoldPrice,
  setCentralPrice,
} from "../services/goldPrice";

// เงินรับเป็น string เท่านั้น — ตัวเลข JSON (float) ถูกปฏิเสธ (CLAUDE.md กฎ 1)
const QuoteBody = z.object({ bar_sell: z.string() });
const SetBody = z.object({ bar_sell: z.string(), confirm_typo: z.boolean().optional() });

const toJson = (p: TodayPrice, diff: string) => ({
  date: p.date,
  bar_sell: p.barSell,
  bar_buy: p.barBuy,
  jewelry_buy: p.jewelryBuy,
  diff,
  source: p.source,
});

export const goldPriceRoutes = new Hono<AppEnv>()
  .use(requireSession)
  .get("/today", async (c) => {
    const date = businessDate(c.var.now());
    const price = await priceForBranch(c.var.db, date, c.var.viewer.currentBranchId);
    if (!price) return c.json({ ...apiError("ยังไม่ได้ตั้งราคาทองของวันนี้"), date }, 404);
    const setting = await loadGoldSetting(c.var.db);
    return c.json(toJson(price, setting.diff));
  })
  .post("/quote", async (c) => {
    const body = QuoteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("ต้องส่ง bar_sell เป็นข้อความตัวเลข", "bar_sell"), 400);
    try {
      const q = await quoteGoldPrice(c.var.db, body.data.bar_sell, businessDate(c.var.now()));
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
  // ตั้งราคากลางของวัน — manager/admin (spec §10) · ห่างเกินเกณฑ์ต้องยืนยัน (409)
  .put("/today", requireRole("manager", "admin"), async (c) => {
    const body = SetBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(apiError("ต้องส่ง bar_sell เป็นข้อความตัวเลข", "bar_sell"), 400);
    const date = businessDate(c.var.now());
    try {
      const q = await quoteGoldPrice(c.var.db, body.data.bar_sell, date);
      if (q.warning && !body.data.confirm_typo) {
        return c.json({ ...apiError(q.warning, "bar_sell"), warning: q.warning }, 409);
      }
      await setCentralPrice(c.var.db, date, q, c.var.viewer.userId, !!q.warning);
      const price = await priceForBranch(c.var.db, date, null);
      const setting = await loadGoldSetting(c.var.db);
      return c.json(toJson(price as TodayPrice, setting.diff));
    } catch (e) {
      if (e instanceof GoldPriceInputError) return c.json(apiError(e.message, "bar_sell"), 400);
      throw e;
    }
  });
