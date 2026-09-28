import { D, type GoldPriceSetting, deriveGoldPrice, fmtInt, fmtMoney, parseDecimal, typoWarning } from "@ong/core";
import { type Db, auditLog, goldPrice, goldPriceSetting } from "@ong/db";
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";

export class GoldPriceInputError extends Error {}

export interface GoldQuote {
  barSell: string;
  barBuy: string;
  jewelryBuy: string;
  /** ด่านกันพิมพ์ผิด — ห่างจากราคากลางครั้งก่อนเกินเกณฑ์ */
  warning: string | null;
}

/** numeric จาก DB มาเป็น string เสมอ (postgres.js) — เข้า decimal.js ตรง ๆ ไม่ผ่าน float */
export type GoldSettingRow = { [K in keyof GoldPriceSetting]: string };

export async function loadGoldSetting(db: Db): Promise<GoldSettingRow> {
  const [s] = await db.select().from(goldPriceSetting).where(eq(goldPriceSetting.id, 1)).limit(1);
  if (!s) throw new Error("gold_price_setting ยังไม่ได้ seed");
  return { diff: s.diff, jewelryDiscount: s.jewelryDiscount, typoGuardPercent: s.typoGuardPercent };
}

async function previousCentralBarSell(db: Db, date: string): Promise<string | null> {
  const [row] = await db
    .select({ barSell: goldPrice.barSell })
    .from(goldPrice)
    .where(and(isNull(goldPrice.branchId), lt(goldPrice.date, date)))
    .orderBy(desc(goldPrice.date))
    .limit(1);
  return row?.barSell ?? null;
}

/**
 * ฟังก์ชันเดียวที่ POST /gold-price/quote และ PUT /gold-price/today ใช้ (R8 · CLAUDE.md กฎ 2)
 * ร้านกรอกแค่ทองแท่งขายออก → derive รับซื้อ + รูปพรรณจากค่าตั้งใน DB
 */
export async function quoteGoldPrice(db: Db, barSellInput: string, date: string): Promise<GoldQuote> {
  const sell = parseDecimal(barSellInput);
  if (!sell || sell.lte(0)) throw new GoldPriceInputError("ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0");
  if (sell.decimalPlaces() > 2) throw new GoldPriceInputError("ราคาทศนิยมไม่เกิน 2 ตำแหน่ง");
  const setting = await loadGoldSetting(db);
  const q = deriveGoldPrice(sell, setting);
  if (q.barBuy.lte(0)) throw new GoldPriceInputError("ราคาต่ำกว่าส่วนต่างรับซื้อ");
  const previous = await previousCentralBarSell(db, date);
  return {
    barSell: fmtMoney(q.barSell),
    barBuy: fmtMoney(q.barBuy),
    jewelryBuy: fmtInt(q.jewelryBuy),
    warning: typoWarning(previous, q.barSell, setting.typoGuardPercent),
  };
}

export interface TodayPrice {
  id: string;
  date: string;
  barSell: string;
  barBuy: string;
  jewelryBuy: string;
  /** "branch" = ราคาเฉพาะสาขา · "central" = ราคากลางทุกสาขา */
  source: "branch" | "central";
}

/** ราคาของวันสำหรับสาขา — ราคาเฉพาะสาขามาก่อน ไม่มีจึงใช้ราคากลาง · ไม่มีทั้งคู่ = null (R7) */
export async function priceForBranch(db: Db, date: string, branchId: string | null): Promise<TodayPrice | null> {
  const scope = branchId
    ? or(eq(goldPrice.branchId, branchId), isNull(goldPrice.branchId))
    : isNull(goldPrice.branchId);
  const rows = await db
    .select()
    .from(goldPrice)
    .where(and(eq(goldPrice.date, date), scope));
  const row = rows.find((r) => r.branchId !== null) ?? rows.find((r) => r.branchId === null);
  if (!row) return null;
  return {
    id: row.id,
    date: row.date,
    barSell: row.barSell,
    barBuy: row.barBuy,
    jewelryBuy: fmtInt(D(row.jewelryBuy)),
    source: row.branchId ? "branch" : "central",
  };
}

/** ตั้งราคากลางของวัน (upsert) + audit ในทรานแซกชันเดียว (R12) */
export async function setCentralPrice(
  db: Db,
  date: string,
  quote: GoldQuote,
  userId: string,
  confirmedWarning: boolean,
) {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(goldPrice)
      .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, date)))
      .for("update");
    const values = { barSell: quote.barSell, barBuy: quote.barBuy, jewelryBuy: quote.jewelryBuy, setBy: userId };
    const [row] = await tx
      .insert(goldPrice)
      .values({ branchId: null, date, ...values })
      .onConflictDoUpdate({ target: [goldPrice.branchId, goldPrice.date], set: values })
      .returning();
    if (!row) throw new Error("upsert gold_price returned nothing");
    const pick = (r: typeof row) => ({
      bar_sell: r.barSell,
      bar_buy: r.barBuy,
      jewelry_buy: r.jewelryBuy,
      set_by: r.setBy,
    });
    await tx.insert(auditLog).values({
      userId,
      action: before ? "gold_price.update" : "gold_price.create",
      tableName: "gold_price",
      rowId: row.id,
      diff: { date, before: before ? pick(before) : null, after: pick(row), typo_warning_confirmed: confirmedWarning },
    });
    return row;
  });
}
