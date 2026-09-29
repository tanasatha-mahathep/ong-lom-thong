import {
  D,
  type GoldReference,
  GoldReferenceError,
  businessDate,
  parseGoldAnnouncement,
  validateGoldReferencePrices,
} from "@ong/core";
import { z } from "zod";
import type { Env } from "../env";

/**
 * ราคาอ้างอิงจากประกาศสมาคมค้าทองคำ — แสดงและเติมค่าเริ่มต้นในหน้าตั้งราคาเท่านั้น
 * ระบบไม่ตั้งราคาของร้านเองเด็ดขาด (ผู้จัดการต้องกดบันทึก) · quoteBuy() ใช้ราคาที่ร้านบันทึกเท่านั้น (กฎ 2)
 */

type FetchLike = (input: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;

/** แหล่งราคา — สลับได้ด้วย GOLD_REFERENCE_PROVIDER (env) */
export interface GoldReferenceProvider {
  /** ชื่อแหล่งที่แสดงผู้ใช้/ลง audit — host ที่ดึงจริง */
  readonly source: string;
  /** ดึง + parse + ตรวจ · ผิดรูปแบบ = GoldReferenceError · เครือข่ายล้ม = error อื่น */
  fetch(signal: AbortSignal): Promise<GoldReference>;
}

/** หน้าเกินขนาดนี้ไม่ใช่หน้าราคาที่คาดไว้ — ไม่อ่านทั้งก้อนเข้าหน่วยความจำ */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

async function fetchText(fetchImpl: FetchLike, url: string, signal: AbortSignal, accept: string): Promise<string> {
  const res = await fetchImpl(url, { signal, headers: { accept } });
  if (!res.ok) throw new Error(`reference source answered ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new GoldReferenceError("คำตอบใหญ่ผิดปกติ");
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) throw new GoldReferenceError("คำตอบใหญ่ผิดปกติ");
  return text;
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

/** ข้อความใน label ยาวเกินนี้ = ไม่ใช่ label ราคา/เวลาประกาศ (ของจริง < 100 ตัวอักษรรวมแท็ก <b><font>) */
export const MAX_LABEL_HTML_LENGTH = 400;

const isTagNameChar = (ch: string) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");

/** ตัดแท็กออก (แทนด้วยช่องว่าง) — วนทีละตัวอักษร linear ไม่ใช้ regex */
function stripTags(html: string): string {
  let out = "";
  let inTag = false;
  for (const ch of html) {
    if (inTag) {
      if (ch === ">") inTag = false;
    } else if (ch === "<") {
      inTag = true;
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

/** ตำแหน่งทั้งหมดของ attribute id="…" / id='…' (ตัวพิมพ์ใหญ่/เล็กของ "id") ที่หน้าเป็นช่องว่าง — indexOf ล้วน */
function idAttributePositions(html: string, id: string): number[] {
  const found: number[] = [];
  for (const attr of ["id", "ID", "Id", "iD"]) {
    for (const quote of ['"', "'"]) {
      const needle = `${attr}=${quote}${id}${quote}`;
      for (let at = html.indexOf(needle); at !== -1; at = html.indexOf(needle, at + needle.length)) {
        if (/\s/.test(html.charAt(at - 1))) found.push(at);
      }
    }
  }
  return found;
}

/**
 * ข้อความภายใน element ที่มี id นี้ (ตัดแท็กลูก เช่น <b><font>) — ไม่มี/มีซ้ำ/ยาวผิดปกติ = null
 * indexOf/slice ล้วน (linear · ไม่มี regex กับหน้า HTML ทั้งหน้า — CodeQL js/polynomial-redos)
 * รูปที่รับ: `<tag … id="ID" …>ข้อความ</tag>` · id เขียนแบบมีช่องว่างรอบ "=" ไม่รับ (หน้า ASP.NET ไม่เขียนแบบนั้น)
 */
export function textById(html: string, id: string): string | null {
  const positions = idAttributePositions(html, id);
  if (positions.length !== 1) return null;
  const at = positions[0] as number;
  const tagStart = html.lastIndexOf("<", at);
  const openEnd = html.indexOf(">", at);
  if (tagStart === -1 || openEnd === -1) return null;
  let nameEnd = tagStart + 1;
  while (nameEnd < at && isTagNameChar(html.charAt(nameEnd))) nameEnd++;
  const name = html.slice(tagStart + 1, nameEnd).toLowerCase();
  if (name === "" || html.slice(nameEnd, at).includes(">")) return null;
  // ปิดแท็ก </name หรือ </NAME — หาในช่วงจำกัดความยาวเท่านั้น (ไม่ lowercase ทั้งช่วง: ความยาวของอักษรบางตัวเปลี่ยน)
  const window = html.slice(openEnd + 1, openEnd + 1 + MAX_LABEL_HTML_LENGTH + name.length + 2);
  const closes = [`</${name}`, `</${name.toUpperCase()}`].map((t) => window.indexOf(t)).filter((i) => i !== -1);
  if (closes.length === 0) return null;
  const close = Math.min(...closes);
  return stripTags(window.slice(0, close))
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (_, e: string) => ENTITIES[e] ?? "")
    .split(/\s+/)
    .filter((part) => part !== "")
    .join(" ");
}

/**
 * id ของ label ในหน้า classic.goldtraders.or.th/default.aspx (ASP.NET WebForms)
 * ที่มา: selector ของโปรเจกต์ MIT github.com/max180643/thai-gold-api (src/config/price.ts) — ยังไม่ได้ตรวจกับหน้าจริง
 * จากเครื่องนี้ (เครือข่ายถูกบล็อก) · หน้าเปลี่ยนโครง = GoldReferenceError → 503 invalid (ไม่เดาราคา)
 */
export const GOLDTRADERS_IDS = {
  announcement: "DetailPlace_uc_goldprices1_lblAsTime",
  barBuy: "DetailPlace_uc_goldprices1_lblBLBuy",
  barSell: "DetailPlace_uc_goldprices1_lblBLSell",
  ornamentBuy: "DetailPlace_uc_goldprices1_lblOMBuy",
  ornamentSell: "DetailPlace_uc_goldprices1_lblOMSell",
} as const;

/** parse หน้า HTML ของสมาคม — แยกจาก fetch เพื่อเทสต์กับ fixture */
export function parseGoldtradersHtml(html: string): GoldReference {
  const read = (key: keyof typeof GOLDTRADERS_IDS) => {
    const text = textById(html, GOLDTRADERS_IDS[key]);
    if (!text) throw new GoldReferenceError(`ไม่พบ ${key} ในหน้าของสมาคม`);
    return text;
  };
  const prices = validateGoldReferencePrices({
    barBuy: read("barBuy"),
    barSell: read("barSell"),
    ornamentBuy: read("ornamentBuy"),
    ornamentSell: read("ornamentSell"),
  });
  return { ...prices, ...parseGoldAnnouncement(read("announcement")) };
}

const ThaiGoldApiSchema = z.object({
  status: z.literal("success"),
  response: z.object({
    update_date: z.string().max(40),
    update_time: z.string().max(80),
    price: z.object({
      gold: z.object({ buy: z.string().max(20), sell: z.string().max(20) }),
      gold_bar: z.object({ buy: z.string().max(20), sell: z.string().max(20) }),
    }),
  }),
});

/**
 * parse JSON ของ thai-gold-api (`GET /latest`) — ตัวเลขต้องเป็น string ("71,150.00") JSON number ถูกปฏิเสธ
 * gold = ทองรูปพรรณ · gold_bar = ทองคำแท่ง · เวลา = update_date + update_time ("เวลา 17:23 น. (ครั้งที่ 69)")
 */
export function parseThaiGoldApiJson(body: unknown): GoldReference {
  const parsed = ThaiGoldApiSchema.safeParse(body);
  if (!parsed.success) throw new GoldReferenceError("รูปแบบ JSON ไม่ตรงกับที่รองรับ");
  const { update_date, update_time, price } = parsed.data.response;
  const prices = validateGoldReferencePrices({
    barBuy: price.gold_bar.buy,
    barSell: price.gold_bar.sell,
    ornamentBuy: price.gold.buy,
    ornamentSell: price.gold.sell,
  });
  return { ...prices, ...parseGoldAnnouncement(`${update_date} ${update_time}`) };
}

export function goldtradersHtmlProvider(url: string, fetchImpl: FetchLike = fetch): GoldReferenceProvider {
  return {
    source: new URL(url).host,
    fetch: async (signal) => parseGoldtradersHtml(await fetchText(fetchImpl, url, signal, "text/html")),
  };
}

export function thaiGoldApiProvider(url: string, fetchImpl: FetchLike = fetch): GoldReferenceProvider {
  return {
    source: new URL(url).host,
    fetch: async (signal) => {
      const text = await fetchText(fetchImpl, url, signal, "application/json");
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new GoldReferenceError("คำตอบไม่ใช่ JSON");
      }
      return parseThaiGoldApiJson(body);
    },
  };
}

/** provider ตาม env — "none" = null (ปิด) */
export function providerFromEnv(
  env: Pick<Env, "GOLD_REFERENCE_PROVIDER" | "GOLD_REFERENCE_URL">,
  fetchImpl: FetchLike = fetch,
): GoldReferenceProvider | null {
  const url = env.GOLD_REFERENCE_URL;
  if (env.GOLD_REFERENCE_PROVIDER === "none" || !url) return null;
  return env.GOLD_REFERENCE_PROVIDER === "goldtraders-html"
    ? goldtradersHtmlProvider(url, fetchImpl)
    : thaiGoldApiProvider(url, fetchImpl);
}

export interface CachedGoldReference extends GoldReference {
  source: string;
  /** เวลาที่เซิร์ฟเวอร์ดึงสำเร็จ (ISO UTC) */
  fetchedAt: string;
}

/** ปิดอยู่ · ติดต่อแหล่งไม่ได้/timeout · แหล่งตอบข้อมูลที่ไม่ผ่านการตรวจ */
export type GoldReferenceFailure = "disabled" | "unavailable" | "invalid";

export type GoldReferenceResult =
  { ok: true; value: CachedGoldReference; stale: boolean } | { ok: false; reason: GoldReferenceFailure };

export interface GoldReferenceService {
  get(): Promise<GoldReferenceResult>;
  /** ค่าล่าสุดที่ดึงสำเร็จ (ไม่ดึงใหม่ · ไม่รอเครือข่าย) — ใช้ลง audit ตอนบันทึกราคา */
  peek(): CachedGoldReference | null;
}

export const GOLD_REFERENCE_TIMEOUT_MS = 5_000;
/** ราคาสมาคมประกาศหลายครั้งต่อวัน (ครั้งที่ …) แต่ห่างกันหลายนาที — 5 นาทีสดพอ และยิงแหล่งไม่เกิน 12 ครั้ง/ชม./process */
export const GOLD_REFERENCE_TTL_MS = 5 * 60_000;
/** ดึงล้มแล้วรอเท่านี้ก่อนลองใหม่ — แหล่งล่มไม่ทำให้ทุก request รอ timeout 5 วินาที */
export const GOLD_REFERENCE_RETRY_MS = 60_000;
/** ดึงล้มแต่มีค่าเดิมที่ดึงไม่เกินเท่านี้ + ประกาศวันนี้ → ส่งค่าเดิมพร้อม stale=true (ไม่ใช่ราคาที่แต่งขึ้น) */
export const GOLD_REFERENCE_STALE_MAX_MS = 60 * 60_000;

/**
 * cache ต่อ process (ไม่ใช่ DB): ข้อมูลอ้างอิงสาธารณะ สร้างใหม่ได้เสมอ ไม่ต้อง migration
 * หลาย instance = แต่ละตัวยิงแหล่งไม่เกินทุก 5 นาที · request พร้อมกันรอการดึงรอบเดียวกัน
 */
export function createGoldReferenceService(options: {
  provider: GoldReferenceProvider | null;
  now?: () => Date;
  timeoutMs?: number;
  ttlMs?: number;
  retryMs?: number;
  staleMaxMs?: number;
  onError?: (reason: GoldReferenceFailure, error: unknown) => void;
}): GoldReferenceService {
  const {
    provider,
    now = () => new Date(),
    timeoutMs = GOLD_REFERENCE_TIMEOUT_MS,
    ttlMs = GOLD_REFERENCE_TTL_MS,
    retryMs = GOLD_REFERENCE_RETRY_MS,
    staleMaxMs = GOLD_REFERENCE_STALE_MAX_MS,
    onError = () => {},
  } = options;
  let last: CachedGoldReference | null = null;
  let failure: { at: number; reason: GoldReferenceFailure } | null = null;
  let inflight: Promise<void> | null = null;

  const age = (v: CachedGoldReference) => now().getTime() - Date.parse(v.fetchedAt);
  const announcedToday = (v: CachedGoldReference) => businessDate(new Date(v.announcedAt)) === businessDate(now());

  async function refresh(p: GoldReferenceProvider): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const value = await Promise.race([
        p.fetch(controller.signal),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => reject(new Error("reference source timed out")));
        }),
      ]);
      // ประกาศล่วงหน้าเกิน 10 นาที = นาฬิกา/ข้อมูลผิด
      if (Date.parse(value.announcedAt) - now().getTime() > 10 * 60_000) {
        throw new GoldReferenceError("เวลาประกาศอยู่ในอนาคต");
      }
      last = { ...value, source: p.source, fetchedAt: now().toISOString() };
      failure = null;
    } catch (e) {
      const reason = e instanceof GoldReferenceError ? "invalid" : "unavailable";
      failure = { at: now().getTime(), reason };
      onError(reason, e);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    peek: () => (last && age(last) <= staleMaxMs ? last : null),
    async get() {
      if (!provider) return { ok: false, reason: "disabled" };
      const fresh = last && age(last) < ttlMs;
      const coolingDown = failure && now().getTime() - failure.at < retryMs;
      if (!fresh && !coolingDown) {
        inflight ??= refresh(provider).finally(() => {
          inflight = null;
        });
        await inflight;
      }
      const value = last;
      if (value && age(value) < ttlMs && !failure) return { ok: true, value, stale: !announcedToday(value) };
      // ดึงล้ม: ค่าเดิมของวันนี้ที่ยังไม่เก่าเกินไป — บอกชัดว่า stale
      if (value && age(value) <= staleMaxMs && announcedToday(value)) return { ok: true, value, stale: true };
      return { ok: false, reason: failure?.reason ?? "unavailable" };
    },
  };
}

/** ค่าที่ลง audit ตอนบันทึกราคา — ราคาสมาคมที่เซิร์ฟเวอร์เห็นล่าสุด + ผู้จัดการกดเติมจากราคาสมาคมหรือไม่ */
export function referenceAudit(cached: CachedGoldReference | null, prefilled: boolean, savedBarSell: string) {
  if (!cached) return prefilled ? { prefilled: true, source: null } : null;
  return {
    prefilled,
    source: cached.source,
    announced_at: cached.announcedAt,
    round: cached.round,
    bar_sell: cached.barSell,
    matches_bar_sell: D(cached.barSell).eq(savedBarSell),
  };
}
