import { businessDate } from "@ong/core";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { type AppEnv, apiError, requireAnyBranch, requireRole, requireSession } from "../lib/context";
import { type BranchRef, currentBranch, forUser } from "../lib/scope";
import {
  GOLD_PRICE_FIRST,
  GoldPriceInputError,
  type PerGramInput,
  type TodayPrice,
  clearBranchPrice,
  isGoldQuote,
  loadGoldSetting,
  priceForBranch,
  pricesForBranches,
  quoteGoldPrice,
  setBranchPrice,
  setCentralPrice,
} from "../services/goldPrice";
import { type CachedGoldReference, referenceAudit } from "../services/goldReference";
import {
  GOLD_HISTORY_DEFAULT_DAYS,
  GOLD_HISTORY_MAX_DAYS,
  type GoldAnnouncementRow,
  bangkokIso,
  historyStart,
  listGoldAnnouncements,
} from "../services/goldReferenceHistory";

// เงินรับเป็น string เท่านั้น — ตัวเลข JSON (float) ถูกปฏิเสธ (CLAUDE.md กฎ 1)
/**
 * ราคารับซื้อต่อกรัมของเงิน/แพลตตินั่ม (UAT 30 ก.ย. 2569) — ตั้งที่ราคากลางเท่านั้น ทุกสาขาใช้ร่วม
 * ไม่ส่ง = คงค่าเดิมของวันนี้ · null หรือ "" = ล้าง (วันนี้รับซื้อโลหะนั้นไม่ได้) · ข้อความตัวเลข = ตั้งใหม่
 */
const perGramText = z.string().max(32).nullable().optional();
/**
 * POST /quote (live preview) — strict: รับเฉพาะช่องที่หน้าเว็บส่งจริง (features/gold-price/queries.ts
 * goldPriceQuoteQueryOptions): bar_sell · branch_id (ตอนตั้งราคาเฉพาะสาขา) · silver_per_g · platinum_per_g (ช่องที่เปลี่ยน)
 * ช่องอื่น = 400 ชี้ชื่อช่อง ไม่ตัดทิ้งเงียบ ๆ — สะกดผิด (barSell · branchId) จะได้ราคาที่ไม่ได้ขอ (branchId หายไป = ราคากลาง)
 * ช่องของการบันทึก (confirm_typo · from_reference) ไม่มีความหมายกับ preview ก็เป็น 400 เช่นกัน (API3 · ASVS V5.1.2)
 */
const QuoteBody = z
  .object({
    bar_sell: z.string(),
    /** ใส่เมื่อกำลังตั้งราคาเฉพาะสาขา — คำเตือนเทียบราคาที่สาขานั้นใช้ครั้งก่อน (เหมือนตอนบันทึก) */
    branch_id: z.string().max(64).nullish(),
    silver_per_g: perGramText,
    platinum_per_g: perGramText,
  })
  .strict();
/** ช่องของการตั้งราคา (spec §5) — ฐานร่วมของ PUT ทั้งสอง · แต่ละ route ใช้ฉบับ strict ของตัวเอง (BranchSetBody · CentralSetBody) */
const SetBody = z.object({
  bar_sell: z.string(),
  silver_per_g: perGramText,
  platinum_per_g: perGramText,
  confirm_typo: z.boolean().optional(),
  /**
   * ผู้จัดการกด "ใช้ราคาสมาคมเป็นค่าเริ่มต้น" ก่อนบันทึก — ประกาศที่ browser เติมมา (เป็นคำอ้าง ไม่ใช่ข้อเท็จจริง)
   * ลง audit แยกจากราคาสมาคมที่เซิร์ฟเวอร์เห็นเอง
   */
  from_reference: z
    .object({
      announced_at: z.iso.datetime({ offset: true }).max(40),
      round: z.number().int().min(1).max(999).nullable(),
    })
    .strict()
    .optional(),
});
/**
 * PUT /today/branches/:id (ราคาเฉพาะสาขา) — strict: รับเฉพาะช่องของ SetBody · bar_sell ยังบังคับ · สาขามาจาก path เท่านั้น
 * ช่องสะกดผิด (silver_per_gram · barSell) · branch_id ใน body · ค่าที่ derive (bar_buy · jewelry_buy) · ช่องของระบบ
 * = 400 ชี้ชื่อช่อง ไม่เขียนแถวสาขา ไม่ลง audit — ไม่ตัดทิ้งเงียบ ๆ แล้วตอบ 200 (API3 · ASVS V5.1.2)
 * ราคาต่อกรัมเป็นช่องที่รู้จัก: ผ่าน schema แล้วไปโดนด่าน branchPerGramError (400 เดิม — ตั้งได้ที่ราคากลางเท่านั้น)
 */
const BranchSetBody = SetBody.strict();
/**
 * PUT /today (ราคากลางของทุกสาขา) — ด่านเดียวของ body ทุกคำขอ ทั้งที่ส่งและไม่ส่ง bar_sell (spec §5)
 * รับเฉพาะช่องของ SetBody (bar_sell · silver_per_g · platinum_per_g · confirm_typo · from_reference) — strict:
 * ช่องสะกดผิด (barSell) · ค่าที่เซิร์ฟเวอร์ derive เอง (bar_buy · jewelry_buy) · branch_id (PUT นี้เปลี่ยนราคาของทุกสาขา) ·
 * ช่องของระบบ (diff · date · set_by · source) = 400 ชี้ชื่อช่อง ไม่บันทึกอะไร — ไม่ตัดทิ้งเงียบ ๆ แล้วตอบ 200 (API3 · ASVS V5.1.2)
 * bar_sell ไม่บังคับ: ไม่ส่ง · null · "" หรือช่องว่างล้วน (แบบเดียวกับราคาต่อกรัม) = ไม่ตั้งราคาทอง
 * → บันทึกแค่ราคาต่อกรัมที่ส่งมา ค่าทองของแถวราคากลางคงเดิม · ตัวเลข JSON ยังเป็น 400 (กฎ 1)
 */
const CentralSetBody = SetBody.extend({ bar_sell: z.string().nullable().optional() }).strict();

/**
 * เพดาน body ของ PUT /today · PUT /today/branches/:id · POST /quote — body จริงมีไม่เกิน 5 ช่อง (ไม่กี่ร้อยไบต์)
 * เกินนี้ตัดทิ้งก่อน parse และไม่เขียนอะไร (413 · แบบเดียวกับ routes/admin.ts) · ผูกทีละ route ที่มี body เท่านั้น ไม่ใช้ .use():
 * GET ไม่ผ่านตัวนี้เลย (และ bodyLimit ปล่อย request ที่ไม่มี body อยู่แล้ว) · DELETE ราคาเฉพาะสาขาไม่อ่าน body
 * วางหลัง requireRole — role ที่ตั้งราคาไม่ได้ได้ 403 เสมอ ไม่ว่า body ใหญ่แค่ไหน (role ตัดสินก่อนอ่าน body)
 */
const jsonLimit = bodyLimit({
  maxSize: 16 * 1024,
  onError: (c) => c.json(apiError("ข้อมูลใหญ่เกินไป"), 413),
});

/** ?days= จำนวนวันย้อนหลัง (นับวันนี้ด้วย) — ตัวเลขล้วน 1–366 · ไม่ส่ง = 90 · รูปอื่นทั้งหมด (0 · ติดลบ · ทศนิยม · ว่าง) = 400 */
const HistoryQuery = z.object({
  days: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(GOLD_HISTORY_MAX_DAYS))
    .default(GOLD_HISTORY_DEFAULT_DAYS),
});

const BAR_SELL_ERROR = apiError("ต้องส่ง bar_sell เป็นข้อความตัวเลข", "bar_sell");
const DAYS_ERROR = apiError(`days ต้องเป็นจำนวนเต็ม 1–${GOLD_HISTORY_MAX_DAYS}`, "days");
const BRANCH_ID_ERROR = apiError("branch_id ไม่ถูกต้อง", "branch_id");
const CONFIRM_TYPO_ERROR = apiError("confirm_typo ต้องเป็นจริงหรือเท็จ", "confirm_typo");
const FROM_REFERENCE_ERROR = apiError("from_reference ต้องมี announced_at และ round ของประกาศ", "from_reference");
const GOLD_PRICE_FIRST_ERROR = apiError(GOLD_PRICE_FIRST, "bar_sell");
const FROM_REFERENCE_WITHOUT_GOLD_ERROR = apiError(
  "from_reference ใช้คู่กับ bar_sell เท่านั้น — ราคาสมาคมเป็นที่มาของราคาทอง",
  "from_reference",
);
const perGramError = (field: "silver_per_g" | "platinum_per_g") =>
  apiError(`ต้องส่ง ${field} เป็นข้อความตัวเลข หรือ null เพื่อล้าง`, field);
/** ราคาต่อกรัมตั้งได้ที่ราคากลางเท่านั้น — ส่งมากับราคาเฉพาะสาขา = 400 (ไม่ทิ้งเงียบ ๆ) */
const branchPerGramError = (body: { silver_per_g?: unknown; platinum_per_g?: unknown }) => {
  const field =
    body.silver_per_g !== undefined ? "silver_per_g" : body.platinum_per_g !== undefined ? "platinum_per_g" : null;
  return field ? apiError("ราคาเงิน/แพลตตินั่มต่อกรัมตั้งได้ที่ราคากลางเท่านั้น", field) : null;
};

/**
 * ช่องระดับบนสุดที่ไม่รู้จัก (schema strict ทั้งสามตัว) → 400 ข้อความแบบ routes/admin.ts ("ไม่รู้จักช่อง a, b")
 * field = ช่องแรกที่ไม่รู้จักตามลำดับใน body · ช่องเกินข้างใน from_reference (path ไม่ว่าง) ไม่ใช่กรณีนี้ = null
 * zod ตรวจช่องที่รู้จักก่อนช่องเกิน — body ที่ผิดทั้งสองแบบได้ issue ของช่องที่รู้จักเป็นตัวแรก (ไม่มาถึงที่นี่)
 */
function unknownFieldError(issue: z.ZodError["issues"][number] | undefined) {
  if (issue?.code !== "unrecognized_keys" || issue.path.length > 0) return null;
  return apiError(`ไม่รู้จักช่อง ${issue.keys.join(", ")}`, issue.keys[0]);
}

/**
 * ช่องที่ผิดจริงของ SetBody (F5) — zod คืน issue ของ bar_sell ก่อนเสมอถ้าทั้งคู่ผิด (ลำดับตาม schema)
 * confirm_typo ผิดชนิด (เช่นส่ง "yes" แทน boolean) ต้องชี้ field "confirm_typo" ไม่ใช่ "bar_sell" ที่จริงแล้วถูก
 * ช่องที่ไม่รู้จัก (CentralSetBody · BranchSetBody) ชี้ช่องแรกที่ไม่รู้จัก · ช่องเกินข้างใน from_reference ยังชี้ from_reference
 */
const setBodyError = (e: z.ZodError) => {
  const issue = e.issues[0];
  const unknown = unknownFieldError(issue);
  if (unknown) return unknown;
  const field = issue?.path[0];
  if (field === "confirm_typo") return CONFIRM_TYPO_ERROR;
  if (field === "from_reference") return FROM_REFERENCE_ERROR;
  if (field === "silver_per_g" || field === "platinum_per_g") return perGramError(field);
  return BAR_SELL_ERROR;
};

/** ช่องที่ผิดของ QuoteBody — ช่องที่ไม่รู้จักชี้ชื่อช่อง · ที่เหลือเหมือนเดิม (ไม่มี body · JSON เสีย · bar_sell ผิด = bar_sell) */
const quoteBodyError = (e: z.ZodError) => {
  const issue = e.issues[0];
  const unknown = unknownFieldError(issue);
  if (unknown) return unknown;
  const field = issue?.path[0];
  if (field === "silver_per_g" || field === "platinum_per_g") return perGramError(field);
  return field === "branch_id" ? BRANCH_ID_ERROR : BAR_SELL_ERROR;
};

/** ราคาอ้างอิงสมาคม — เงินเป็น string 2 ตำแหน่ง (กฎ 1) · round เป็นจำนวนเต็ม (ไม่ใช่เงิน) */
const referenceJson = (r: CachedGoldReference, stale: boolean) => ({
  source: r.source,
  announced_at: r.announcedAt,
  round: r.round,
  bar_buy: r.barBuy,
  bar_sell: r.barSell,
  ornament_buy: r.ornamentBuy,
  ornament_sell: r.ornamentSell,
  fetched_at: r.fetchedAt,
  stale,
});

/** ประกาศหนึ่งครั้งในประวัติ — ชื่อ/รูปเดียวกับ GET /reference (announced_at เวลาไทย · เงิน string 2 ตำแหน่ง) */
const historyItemJson = (r: GoldAnnouncementRow) => ({
  announced_at: bangkokIso(r.announcedAt),
  round: r.round,
  source: r.source,
  bar_buy: r.barBuy,
  bar_sell: r.barSell,
  ornament_buy: r.ornamentBuy,
  ornament_sell: r.ornamentSell,
});

const toJson = (p: TodayPrice, diff: string) => ({
  date: p.date,
  bar_sell: p.barSell,
  bar_buy: p.barBuy,
  jewelry_buy: p.jewelryBuy,
  silver_per_g: p.silverPerG,
  platinum_per_g: p.platinumPerG,
  diff,
  source: p.source,
});

/** แถวราคาต่อสาขา — ใช้ทั้ง GET /today/branches และคำตอบของ PUT/DELETE ราคาเฉพาะสาขา */
const toBranchJson = (b: BranchRef, p: TodayPrice | null) => ({
  branch: { id: b.id, code: b.code, name: b.name },
  bar_sell: p?.barSell ?? null,
  bar_buy: p?.barBuy ?? null,
  jewelry_buy: p?.jewelryBuy ?? null,
  silver_per_g: p?.silverPerG ?? null,
  platinum_per_g: p?.platinumPerG ?? null,
  source: p?.source ?? null,
});

/** ราคาต่อกรัมจาก body → อินพุตของ quoteGoldPrice (ไม่ส่ง = undefined คงค่าเดิม) */
const perGramOf = (b: { silver_per_g?: string | null; platinum_per_g?: string | null }): PerGramInput => ({
  silverPerG: b.silver_per_g,
  platinumPerG: b.platinum_per_g,
});

/** bar_sell ของ PUT /today — ไม่ส่ง · null · "" หรือช่องว่างล้วน = ไม่ตั้งราคาทอง (null) · ข้อความอื่นส่งให้ quoteGoldPrice ตรวจตามเดิม */
const barSellOf = (input: string | null | undefined): string | null =>
  input == null || input.trim() === "" ? null : input;

/**
 * PUT /today ที่ไม่ได้ตั้งราคาทอง — ปฏิเสธก่อนตรวจราคาต่อกรัม (ลำดับเดียวกับหลายช่องผิด: bar_sell ก่อน) · null = ไปต่อได้
 * - ไม่มีราคาให้บันทึกเลย (ไม่ส่งทั้งเงินและแพลตตินั่ม) = 400 เดิมของ bar_sell
 * - from_reference คือที่มาของราคาทอง — ไม่มีราคาทองให้อ้าง = 400 (ไม่ทิ้งเงียบ ๆ)
 * - วันนี้ยังไม่มีราคากลาง = 400 ชี้ bar_sell · อ่านแถวราคากลางเท่านั้น (branchId = null) แถวราคาเฉพาะสาขาไม่นับ
 */
async function keepGoldRefusal(c: Context<AppEnv>, body: z.infer<typeof CentralSetBody>, date: string) {
  if (body.silver_per_g === undefined && body.platinum_per_g === undefined) return BAR_SELL_ERROR;
  if (body.from_reference !== undefined) return FROM_REFERENCE_WITHOUT_GOLD_ERROR;
  if (!(await priceForBranch(c.var.db, date, null))) return GOLD_PRICE_FIRST_ERROR;
  return null;
}

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
  // ราคาอ้างอิงประกาศสมาคมค้าทองคำ — ข้อมูลสาธารณะเหมือนกันทุกสาขา แสดง/เติมค่าเริ่มต้นเท่านั้น (ไม่ตั้งราคาร้าน)
  // ดึงไม่ได้/ปิด/ข้อมูลไม่ผ่านการตรวจ = 503 {error, reason} — ไม่แต่งราคาขึ้นเอง (fail-closed)
  .get("/reference", async (c) => {
    const result = await c.var.goldReference.get();
    if (!result.ok) return c.json({ ...apiError("ดึงราคาอ้างอิงไม่ได้"), reason: result.reason }, 503);
    return c.json(referenceJson(result.value, result.stale));
  })
  // ประวัติราคาสมาคม (กราฟ) — ประกาศที่ /reference เคยดึงได้ ตั้งแต่ 00:00 น. เวลาไทยของ (วันนี้ − days + 1) เรียงเก่า → ใหม่
  // อ่าน DB อย่างเดียว ไม่ดึงแหล่งภายนอก · แหล่งปิดอยู่ก็ยังได้ที่เก็บไว้ · ยังไม่มี = items ว่าง (เริ่มเก็บตั้งแต่ติดตั้ง ไม่มีย้อนหลัง)
  .get("/reference/history", async (c) => {
    const query = HistoryQuery.safeParse(c.req.query());
    if (!query.success) return c.json(DAYS_ERROR, 400);
    const { days } = query.data;
    const from = historyStart(businessDate(c.var.now()), days);
    const rows = await listGoldAnnouncements(c.var.db, new Date(from));
    return c.json({ days, from, items: rows.map(historyItemJson) });
  })
  // live preview ของฟอร์มราคา (ทุก role ที่มีสาขา) — body เกิน 16 KB = 413 · ช่องที่ไม่รู้จัก = 400 (QuoteBody strict)
  .post("/quote", jsonLimit, async (c) => {
    const body = QuoteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(quoteBodyError(body.error), 400);
    let branchId: string | null = null;
    if (body.data.branch_id != null) {
      const perGram = branchPerGramError(body.data);
      if (perGram) return c.json(perGram, 400);
      const readable = await forUser(c.var.db, c.var.viewer);
      const target = readable.find((b) => b.id === body.data.branch_id);
      if (!target) return c.json(apiError("not found", "branch_id"), 404);
      branchId = target.id;
    }
    try {
      const q = await quoteGoldPrice(
        c.var.db,
        body.data.bar_sell,
        businessDate(c.var.now()),
        branchId,
        perGramOf(body.data),
      );
      return c.json({
        bar_sell: q.barSell,
        bar_buy: q.barBuy,
        jewelry_buy: q.jewelryBuy,
        ...(q.silverPerG === undefined ? {} : { silver_per_g: q.silverPerG }),
        ...(q.platinumPerG === undefined ? {} : { platinum_per_g: q.platinumPerG }),
        ...(q.warning ? { warning: q.warning } : {}),
      });
    } catch (e) {
      if (e instanceof GoldPriceInputError) return c.json(apiError(e.message, e.field), 400);
      throw e;
    }
  })
  // ตั้งราคากลางของวัน — manager/admin (spec §10) · ห่างเกินเกณฑ์ต้องยืนยัน (409 ชี้ confirm_typo)
  // role ตัดสินก่อนอ่าน body (role อื่น = 403 เสมอ) · body เกิน 16 KB = 413 · ช่องที่ไม่รู้จัก = 400 ทุกคำขอ (CentralSetBody strict)
  // ไม่ส่ง bar_sell = แก้แค่ราคาเงิน/แพลตตินั่มของราคากลางที่มีแล้ว ค่าทองคงเดิม (quoteGoldPrice ตัวเดียวกัน ข้ามส่วนทอง)
  .put("/today", requireRole("manager", "admin"), jsonLimit, async (c) => {
    const body = CentralSetBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(setBodyError(body.error), 400);
    const date = businessDate(c.var.now());
    const barSell = barSellOf(body.data.bar_sell);
    if (barSell === null) {
      const refused = await keepGoldRefusal(c, body.data, date);
      if (refused) return c.json(refused, 400);
    }
    try {
      const q = await quoteGoldPrice(c.var.db, barSell, date, null, perGramOf(body.data));
      if (q.warning && !body.data.confirm_typo) {
        return c.json({ ...apiError(q.warning, "confirm_typo"), warning: q.warning }, 409);
      }
      // ราคาสมาคมอ้างอิงราคาทองที่บันทึก — แก้แค่ราคาต่อกรัมไม่มีราคาทองให้เทียบ จึงไม่มีคีย์ reference ใน audit
      const reference = isGoldQuote(q)
        ? referenceAudit(c.var.goldReference.peek(), body.data.from_reference ?? null, q.barSell)
        : null;
      await setCentralPrice(c.var.db, date, q, c.var.viewer.userId, !!q.warning, reference);
      const price = await priceForBranch(c.var.db, date, null);
      const setting = await loadGoldSetting(c.var.db);
      return c.json(toJson(price as TodayPrice, setting.diff));
    } catch (e) {
      if (e instanceof GoldPriceInputError) return c.json(apiError(e.message, e.field), 400);
      throw e;
    }
  })
  // ราคาเฉพาะสาขาของวันนี้ (อิงราคากลาง override ได้) — manager/admin เฉพาะสาขาที่เปิดอยู่และมีสิทธิ์
  // สูตรเดียวกับราคากลาง (quoteGoldPrice) · ด่านพิมพ์ผิดเทียบราคาที่สาขานั้นใช้จริงครั้งก่อน
  // role ก่อน → body เกิน 16 KB = 413 (เหมือนกันทุกสาขา ไม่บอกว่าสาขามีอยู่) → สาขา 404 → ช่องที่ไม่รู้จัก 400 (BranchSetBody strict)
  .put("/today/branches/:branchId", requireRole("manager", "admin"), jsonLimit, async (c) => {
    const target = await writableBranch(c);
    if (!target) return c.json(apiError("not found"), 404);
    const body = BranchSetBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json(setBodyError(body.error), 400);
    const perGram = branchPerGramError(body.data);
    if (perGram) return c.json(perGram, 400);
    const date = businessDate(c.var.now());
    try {
      const q = await quoteGoldPrice(c.var.db, body.data.bar_sell, date, target.id);
      if (q.warning && !body.data.confirm_typo) {
        return c.json({ ...apiError(q.warning, "confirm_typo"), warning: q.warning }, 409);
      }
      const reference = referenceAudit(c.var.goldReference.peek(), body.data.from_reference ?? null, q.barSell);
      await setBranchPrice(c.var.db, date, target, q, c.var.viewer.userId, !!q.warning, reference);
      return c.json(toBranchJson(target, await priceForBranch(c.var.db, date, target.id)));
    } catch (e) {
      if (e instanceof GoldPriceInputError) return c.json(apiError(e.message, e.field), 400);
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
