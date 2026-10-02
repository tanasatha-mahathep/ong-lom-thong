import { D, type GoldPriceSetting, deriveGoldPrice, fmtInt, fmtMoney, parseDecimal, typoWarning } from "@ong/core";
import { type Db, auditLog, goldPrice, goldPriceSetting } from "@ong/db";
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { BranchRef } from "../lib/scope";
import type { Executor } from "./adminCommon";
import type { referenceAudit } from "./goldReference";

/** ช่องที่ผิด — route ตอบ 400 ชี้ช่องนี้ */
export type GoldPriceField = "bar_sell" | "silver_per_g" | "platinum_per_g";

export class GoldPriceInputError extends Error {
  constructor(
    message: string,
    readonly field: GoldPriceField = "bar_sell",
  ) {
    super(message);
  }
}

/**
 * ราคารับซื้อต่อกรัมที่ร้านตั้งเอง (ฐานสูตรเงิน/แพลตตินั่ม · METAL_PRICING ใน @ong/core) — ตั้งที่ราคากลางเท่านั้น ทุกสาขาใช้ร่วม
 * undefined = ไม่ส่งมา (คงค่าเดิมของวันนั้น) · null = ล้าง (วันนั้นรับซื้อโลหะนี้ไม่ได้) · string = ตั้งค่าใหม่
 */
export interface PerGramInput {
  silverPerG?: string | null;
  platinumPerG?: string | null;
}

const PER_GRAM = [
  { key: "silverPerG", field: "silver_per_g", name: "เงิน" },
  { key: "platinumPerG", field: "platinum_per_g", name: "แพลตตินั่ม" },
] as const;

export interface GoldQuote {
  barSell: string;
  barBuy: string;
  jewelryBuy: string;
  /** ราคาต่อกรัมรูปมาตรฐาน 2 ตำแหน่ง — undefined = ไม่ได้ส่งมา (คงค่าเดิม) */
  silverPerG?: string | null;
  platinumPerG?: string | null;
  /** ด่านกันพิมพ์ผิด — ห่างจากราคาครั้งก่อน (ราคากลาง หรือราคาที่สาขาใช้จริง) เกินเกณฑ์ · หลายราคาต่อด้วย " · " */
  warning: string | null;
}

/** numeric จาก DB มาเป็น string เสมอ (postgres.js) — เข้า decimal.js ตรง ๆ ไม่ผ่าน float */
export type GoldSettingRow = { [K in keyof GoldPriceSetting]: string };

type GoldPriceRow = typeof goldPrice.$inferSelect;

/**
 * เพดานราคาทองแท่งขายออก — ราคาจริง ~70,000 บาทต่อบาททอง จึงเผื่อไว้ 10 เท่า
 * กันเลขที่หลุดช่อง (เช่นเลขบัตร 13 หลักจาก Siam ID) ไม่ให้ล้น numeric(14,2) เป็น 500 · วันแรกไม่มีราคาก่อนหน้าให้ด่านพิมพ์ผิดจับ
 */
export const MAX_BAR_SELL = "999999.99";

/** เพดานราคาต่อกรัม — เงิน ~40 · แพลตตินั่ม ~1,000 บาท/กรัม เผื่อไว้มาก แต่กันเลขหลุดช่องไม่ให้ล้น numeric(14,2) */
export const MAX_PER_G = "99999.99";

export async function loadGoldSetting(db: Db): Promise<GoldSettingRow> {
  const [s] = await db.select().from(goldPriceSetting).where(eq(goldPriceSetting.id, 1)).limit(1);
  if (!s) throw new Error("gold_price_setting ยังไม่ได้ seed");
  return { diff: s.diff, jewelryDiscount: s.jewelryDiscount, typoGuardPercent: s.typoGuardPercent };
}

/**
 * ราคาครั้งก่อนที่ด่านกันพิมพ์ผิดใช้เทียบ — วันล่าสุดก่อน date ที่มีราคา
 * - ราคากลาง (branchId = null): ราคากลางของวันนั้น
 * - ราคาเฉพาะสาขา: ราคาที่สาขาใช้จริงวันนั้น (แถวของสาขาก่อน ไม่มีจึงราคากลาง — กติกาเดียวกับ priceForBranch)
 */
/** คอลัมน์ราคาที่ด่านกันพิมพ์ผิดเทียบได้ */
type GuardedColumn = typeof goldPrice.barSell | typeof goldPrice.silverPerG | typeof goldPrice.platinumPerG;

async function previousValue(
  db: Db,
  date: string,
  branchId: string | null,
  column: GuardedColumn,
): Promise<string | null> {
  const scope = branchId
    ? or(eq(goldPrice.branchId, branchId), isNull(goldPrice.branchId))
    : isNull(goldPrice.branchId);
  const [row] = await db
    .select({ value: column })
    .from(goldPrice)
    // ราคาต่อกรัมว่างได้ (วันที่ไม่ได้ตั้ง) — เทียบกับวันล่าสุดที่ตั้งไว้จริง
    .where(and(scope, lt(goldPrice.date, date), isNotNull(column)))
    // วันเดียวกันมีทั้งสองแถว → แถวของสาขามาก่อน (false < true)
    .orderBy(desc(goldPrice.date), sql`${goldPrice.branchId} is null`)
    .limit(1);
  return row?.value ?? null;
}

/** ราคาต่อกรัมที่ส่งมา → รูปมาตรฐาน · undefined = ไม่ส่ง · null/"" = ล้าง */
function perGramPrice(input: string | null | undefined, field: GoldPriceField, name: string) {
  if (input === undefined) return undefined;
  if (input === null || input.trim() === "") return null;
  const v = parseDecimal(input);
  if (!v || v.lte(0)) throw new GoldPriceInputError(`ราคา${name}ต่อกรัมต้องเป็นตัวเลขมากกว่า 0`, field);
  if (v.decimalPlaces() > 2) throw new GoldPriceInputError("ราคาทศนิยมไม่เกิน 2 ตำแหน่ง", field);
  if (v.gt(MAX_PER_G)) throw new GoldPriceInputError(`ราคา${name}ต่อกรัมสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง`, field);
  return v;
}

/**
 * ฟังก์ชันเดียวที่ quote และการบันทึกราคา (กลาง/เฉพาะสาขา) ใช้ (R8 · CLAUDE.md กฎ 2)
 * ร้านกรอกแค่ทองแท่งขายออก → derive รับซื้อ + รูปพรรณจากค่าตั้งใน DB · ราคาต่อกรัมของเงิน/แพลตตินั่ม (ถ้าส่งมา) ตรวจรูปแล้วเก็บตรงตัว
 * branchId = null → เตือนเทียบราคากลางครั้งก่อน · มีสาขา → เทียบราคาที่สาขานั้นใช้จริงครั้งก่อน
 */
export async function quoteGoldPrice(
  db: Db,
  barSellInput: string,
  date: string,
  branchId: string | null = null,
  perGram: PerGramInput = {},
): Promise<GoldQuote> {
  const sell = parseDecimal(barSellInput);
  if (!sell || sell.lte(0)) throw new GoldPriceInputError("ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0");
  if (sell.gt(MAX_BAR_SELL)) throw new GoldPriceInputError("ราคาทองสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง");
  if (sell.decimalPlaces() > 2) throw new GoldPriceInputError("ราคาทศนิยมไม่เกิน 2 ตำแหน่ง");
  const metals = PER_GRAM.map((m) => ({ ...m, value: perGramPrice(perGram[m.key], m.field, m.name) }));
  const setting = await loadGoldSetting(db);
  const q = deriveGoldPrice(sell, setting);
  if (q.barBuy.lte(0)) throw new GoldPriceInputError("ราคาต่ำกว่าส่วนต่างรับซื้อ");
  const warnings = [
    typoWarning(await previousValue(db, date, branchId, goldPrice.barSell), q.barSell, setting.typoGuardPercent),
  ];
  const quote: GoldQuote = {
    barSell: fmtMoney(q.barSell),
    barBuy: fmtMoney(q.barBuy),
    jewelryBuy: fmtInt(q.jewelryBuy),
    warning: null,
  };
  for (const m of metals) {
    if (m.value === undefined) continue;
    quote[m.key] = m.value === null ? null : fmtMoney(m.value);
    if (m.value === null) continue;
    const previous = await previousValue(db, date, branchId, goldPrice[m.key]);
    warnings.push(typoWarning(previous, m.value, setting.typoGuardPercent, `ราคา${m.name}`));
  }
  quote.warning = warnings.filter((w) => w !== null).join(" · ") || null;
  return quote;
}

export interface TodayPrice {
  id: string;
  date: string;
  barSell: string;
  barBuy: string;
  jewelryBuy: string;
  /** "branch" = ราคาเฉพาะสาขา · "central" = ราคากลางทุกสาขา */
  source: "branch" | "central";
  /** ราคารับซื้อต่อกรัมของวัน — ของสาขาถ้ามี ไม่มีจึงราคากลาง · null = ยังไม่ได้ตั้ง (รับซื้อโลหะนั้นไม่ได้) */
  silverPerG: string | null;
  platinumPerG: string | null;
}

/** row = แถวที่ใช้ (สาขาก่อน) · central = แถวราคากลางของวันเดียวกัน — ราคาต่อกรัมตกไปใช้ราคากลางทีละช่อง */
const toTodayPrice = (row: GoldPriceRow, central: GoldPriceRow | undefined): TodayPrice => ({
  id: row.id,
  date: row.date,
  barSell: row.barSell,
  barBuy: row.barBuy,
  jewelryBuy: fmtInt(D(row.jewelryBuy)),
  source: row.branchId ? "branch" : "central",
  silverPerG: row.silverPerG ?? central?.silverPerG ?? null,
  platinumPerG: row.platinumPerG ?? central?.platinumPerG ?? null,
});

/** ราคาของวันสำหรับสาขา — ราคาเฉพาะสาขามาก่อน ไม่มีจึงใช้ราคากลาง · ไม่มีทั้งคู่ = null (R7) */
export async function priceForBranch(db: Db, date: string, branchId: string | null): Promise<TodayPrice | null> {
  const scope = branchId
    ? or(eq(goldPrice.branchId, branchId), isNull(goldPrice.branchId))
    : isNull(goldPrice.branchId);
  const rows = await db
    .select()
    .from(goldPrice)
    .where(and(eq(goldPrice.date, date), scope));
  const central = rows.find((r) => r.branchId === null);
  const row = rows.find((r) => r.branchId !== null) ?? central;
  return row ? toTodayPrice(row, central) : null;
}

/** ราคาของวันของหลายสาขาในคำสั่งเดียว — กติกาเดียวกับ priceForBranch · เรียงตามรายการสาขาที่ส่งมา */
export async function pricesForBranches(
  db: Db,
  date: string,
  branches: BranchRef[],
): Promise<{ branch: BranchRef; price: TodayPrice | null }[]> {
  if (branches.length === 0) return [];
  const rows = await db
    .select()
    .from(goldPrice)
    .where(
      and(
        eq(goldPrice.date, date),
        or(
          isNull(goldPrice.branchId),
          inArray(
            goldPrice.branchId,
            branches.map((b) => b.id),
          ),
        ),
      ),
    );
  const central = rows.find((r) => r.branchId === null);
  const own = new Map(rows.filter((r) => r.branchId !== null).map((r) => [r.branchId, r]));
  return branches.map((b) => {
    const row = own.get(b.id) ?? central;
    return { branch: b, price: row ? toTodayPrice(row, central) : null };
  });
}

/** ค่าที่ audit เก็บ (ก่อน/หลัง/ที่ลบ) */
const auditValues = (r: GoldPriceRow) => ({
  bar_sell: r.barSell,
  bar_buy: r.barBuy,
  jewelry_buy: r.jewelryBuy,
  silver_per_g: r.silverPerG,
  platinum_per_g: r.platinumPerG,
  set_by: r.setBy,
});

/** ช่องที่ upsert — ราคาต่อกรัมที่ไม่ได้ส่งมา (undefined) ไม่อยู่ในชุด → แถวเดิมคงค่าเดิม · แถวใหม่ = null */
const upsertValues = (quote: GoldQuote, userId: string) => ({
  barSell: quote.barSell,
  barBuy: quote.barBuy,
  jewelryBuy: quote.jewelryBuy,
  setBy: userId,
  ...(quote.silverPerG === undefined ? {} : { silverPerG: quote.silverPerG }),
  ...(quote.platinumPerG === undefined ? {} : { platinumPerG: quote.platinumPerG }),
});

/**
 * ราคาสมาคม (อ้างอิง) ตอนบันทึก — ที่มา + เวลาประกาศ + ผู้จัดการกดเติมจากราคาสมาคมหรือไม่ (ไม่ต้อง migration: audit_log.diff เป็น jsonb)
 * null = ไม่มีราคาสมาคมและไม่ได้กดเติม → ไม่ใส่คีย์ reference
 */
export type ReferenceAudit = ReturnType<typeof referenceAudit>;

const branchRef = (b: BranchRef) => ({ id: b.id, code: b.code, name: b.name });

/**
 * ล็อกต่อ (ราคากลาง หรือสาขา, วันที่) ตลอดทรานแซกชัน (F11)
 * `SELECT … FOR UPDATE` ล็อกแถวที่มีอยู่แล้วเท่านั้น — ราคาแรกของวันยังไม่มีแถวให้ล็อก สอง request แรกของวันที่ยิงพร้อมกัน
 * จึงเห็น "ก่อน" เป็น null ทั้งคู่ (audit กลายเป็น create ซ้ำสองครั้งแทนที่จะเป็น create แล้ว update)
 * ต้องเรียกก่อน SELECT เสมอ — คีย์ = hash ของ scope+วันที่ (`hashtextextended`) · ปล่อยเองตอนจบทรานแซกชัน (xact)
 * ตัวที่ยิงทีหลังจึงรอจนตัวแรก commit ก่อน แล้วเห็นแถวที่เพิ่งสร้างจริง → บันทึกเป็น update ถูกต้อง
 */
async function lockPriceRow(tx: Executor, branchId: string | null, date: string): Promise<void> {
  const key = `gold_price:${branchId ?? "central"}:${date}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** ตั้งราคากลางของวัน (upsert) + audit ในทรานแซกชันเดียว (R12) */
export async function setCentralPrice(
  db: Db,
  date: string,
  quote: GoldQuote,
  userId: string,
  confirmedWarning: boolean,
  reference: ReferenceAudit = null,
) {
  return db.transaction(async (tx) => {
    await lockPriceRow(tx, null, date);
    const [before] = await tx
      .select()
      .from(goldPrice)
      .where(and(isNull(goldPrice.branchId), eq(goldPrice.date, date)))
      .for("update");
    const values = upsertValues(quote, userId);
    const [row] = await tx
      .insert(goldPrice)
      .values({ branchId: null, date, ...values })
      .onConflictDoUpdate({ target: [goldPrice.branchId, goldPrice.date], set: values })
      .returning();
    if (!row) throw new Error("upsert gold_price returned nothing");
    await tx.insert(auditLog).values({
      userId,
      action: before ? "gold_price.update" : "gold_price.create",
      tableName: "gold_price",
      rowId: row.id,
      diff: {
        date,
        before: before ? auditValues(before) : null,
        after: auditValues(row),
        typo_warning_confirmed: confirmedWarning,
        ...(reference ? { reference } : {}),
      },
    });
    return row;
  });
}

/**
 * ตั้งราคาเฉพาะสาขาของวัน (override ราคากลาง · upsert) + audit gold_price.set_branch ในทรานแซกชันเดียว (R12)
 * สาขาต้องผ่าน forUser (เปิดอยู่ + มีสิทธิ์) มาจาก route แล้ว · บิลที่เปิดไปแล้วเก็บราคาของตัวเอง (snapshot) ไม่เปลี่ยน
 */
export async function setBranchPrice(
  db: Db,
  date: string,
  target: BranchRef,
  quote: GoldQuote,
  userId: string,
  confirmedWarning: boolean,
  reference: ReferenceAudit = null,
) {
  return db.transaction(async (tx) => {
    await lockPriceRow(tx, target.id, date);
    const [before] = await tx
      .select()
      .from(goldPrice)
      .where(and(eq(goldPrice.branchId, target.id), eq(goldPrice.date, date)))
      .for("update");
    const values = upsertValues(quote, userId);
    const [row] = await tx
      .insert(goldPrice)
      .values({ branchId: target.id, date, ...values })
      .onConflictDoUpdate({ target: [goldPrice.branchId, goldPrice.date], set: values })
      .returning();
    if (!row) throw new Error("upsert gold_price returned nothing");
    await tx.insert(auditLog).values({
      userId,
      action: "gold_price.set_branch",
      tableName: "gold_price",
      rowId: row.id,
      diff: {
        date,
        branch: branchRef(target),
        before: before ? auditValues(before) : null,
        after: auditValues(row),
        typo_warning_confirmed: confirmedWarning,
        ...(reference ? { reference } : {}),
      },
    });
    return row;
  });
}

/**
 * ลบราคาเฉพาะสาขาของวัน → สาขากลับไปใช้ราคากลาง · audit gold_price.clear_branch พร้อมค่าที่ลบ (R12)
 * ไม่มีราคาเฉพาะสาขาอยู่แล้ว = null (ไม่มีอะไรเปลี่ยน ไม่ลง audit) · บิลเดิมเก็บ snapshot ของตัวเอง ไม่กระทบ
 */
export async function clearBranchPrice(
  db: Db,
  date: string,
  target: BranchRef,
  userId: string,
): Promise<GoldPriceRow | null> {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(goldPrice)
      .where(and(eq(goldPrice.branchId, target.id), eq(goldPrice.date, date)))
      .returning();
    if (!removed) return null;
    await tx.insert(auditLog).values({
      userId,
      action: "gold_price.clear_branch",
      tableName: "gold_price",
      rowId: removed.id,
      diff: { date, branch: branchRef(target), removed: auditValues(removed) },
    });
    return removed;
  });
}
