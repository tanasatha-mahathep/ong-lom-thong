import type Decimal from "decimal.js";
import { fmtMoney, parseDecimal } from "./money";

/**
 * ราคาอ้างอิงจากประกาศสมาคมค้าทองคำ (ทองคำแท่ง / ทองรูปพรรณ 96.5% ต่อน้ำหนัก 1 บาท)
 * ใช้แสดงและเติมค่าเริ่มต้นในฟอร์มตั้งราคาเท่านั้น — ไม่เข้าสูตรบิล (quoteBuy ใช้ราคาที่ร้านบันทึกเท่านั้น · กฎ 2)
 */
export interface GoldReferencePrices {
  /** ทองคำแท่ง รับซื้อ — เงิน 2 ตำแหน่ง */
  barBuy: string;
  /** ทองคำแท่ง ขายออก */
  barSell: string;
  /** ทองรูปพรรณ รับซื้อ (สมาคมประกาศมีทศนิยม) */
  ornamentBuy: string;
  /** ทองรูปพรรณ ขายออก */
  ornamentSell: string;
}

export interface GoldReferenceAnnouncement {
  /** เวลาประกาศ ISO 8601 เวลาไทย เช่น "2026-02-02T17:23:00+07:00" */
  announcedAt: string;
  /** ครั้งที่ของวัน — ไม่มีในข้อความ = null */
  round: number | null;
}

export type GoldReference = GoldReferencePrices & GoldReferenceAnnouncement;

/** ข้อมูลจากแหล่งภายนอกไม่ผ่านการตรวจ — ห้ามแสดง/ใช้ (fail-closed: ไม่เดาราคา) */
export class GoldReferenceError extends Error {}

/**
 * ช่วงราคาที่ยอมรับ (บาทต่อน้ำหนักทอง 1 บาท) — ราคาจริง 2569 ราว 60,000–80,000
 * ต่ำกว่า 10,000 = อ่านผิดช่อง/หลักหาย · เพดานเท่ากับเพดานราคาที่ร้านบันทึกได้ (numeric(14,2) ไม่ล้น)
 */
export const GOLD_REFERENCE_MIN = "10000";
export const GOLD_REFERENCE_MAX = "999999.99";
/**
 * ทุกราคาต้องห่างจากทองแท่งขายออกไม่เกิน % นี้ — ส่วนต่างจริงราว 0.3% (แท่ง) และ ~5% (รูปพรรณรับซื้อ)
 * ไกลกว่านี้ = สลับช่อง / หลักเกิน / ข้อมูลขยะ
 */
export const GOLD_REFERENCE_MAX_SPREAD_PERCENT = "10";

const PRICE_FIELDS = ["barBuy", "barSell", "ornamentBuy", "ornamentSell"] as const;

function price(field: string, raw: string): Decimal {
  const v = parseDecimal(raw);
  if (!v) throw new GoldReferenceError(`${field}: ไม่ใช่ตัวเลข`);
  if (v.decimalPlaces() > 2) throw new GoldReferenceError(`${field}: ทศนิยมเกิน 2 ตำแหน่ง`);
  if (v.lt(GOLD_REFERENCE_MIN) || v.gt(GOLD_REFERENCE_MAX))
    throw new GoldReferenceError(`${field}: อยู่นอกช่วงที่เป็นไปได้`);
  return v;
}

/**
 * ตรวจราคา 4 ค่าจากแหล่งภายนอกอย่างเข้ม — รับ "71,150.00" (คั่นหลักพัน) · คืนเงิน 2 ตำแหน่งเป็น string
 * ขายออก ≥ รับซื้อ ทั้งแท่งและรูปพรรณ · ทุกค่าห่างจากแท่งขายออกไม่เกิน GOLD_REFERENCE_MAX_SPREAD_PERCENT
 */
export function validateGoldReferencePrices(raw: Record<(typeof PRICE_FIELDS)[number], string>): GoldReferencePrices {
  const [barBuy, barSell, ornamentBuy, ornamentSell] = PRICE_FIELDS.map((f) => price(f, raw[f])) as [
    Decimal,
    Decimal,
    Decimal,
    Decimal,
  ];
  if (barSell.lt(barBuy)) throw new GoldReferenceError("ทองคำแท่งขายออกต่ำกว่ารับซื้อ");
  if (ornamentSell.lt(ornamentBuy)) throw new GoldReferenceError("ทองรูปพรรณขายออกต่ำกว่ารับซื้อ");
  for (const [field, v] of [
    ["barBuy", barBuy],
    ["ornamentBuy", ornamentBuy],
    ["ornamentSell", ornamentSell],
  ] as const) {
    if (v.minus(barSell).abs().div(barSell).times(100).gt(GOLD_REFERENCE_MAX_SPREAD_PERCENT)) {
      throw new GoldReferenceError(`${field}: ห่างจากทองคำแท่งขายออกผิดปกติ`);
    }
  }
  return {
    barBuy: fmtMoney(barBuy),
    barSell: fmtMoney(barSell),
    ornamentBuy: fmtMoney(ornamentBuy),
    ornamentSell: fmtMoney(ornamentSell),
  };
}

// "02/02/2569 เวลา 17:23 น. (ครั้งที่ 69)" — วัน/เดือน/ปี พ.ศ. · เวลา 24 ชม. · ครั้งที่ (ถ้ามี)
const ANNOUNCEMENT =
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(?:เวลา\s*)?(\d{1,2})[:.](\d{2})\s*(?:น\.?)?\s*(?:\(\s*ครั้งที่\s*(\d{1,3})\s*\))?$/;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * ข้อความเวลาประกาศของสมาคม → เวลา ISO (เวลาไทย +07:00) + ครั้งที่
 * ปีต้องเป็น พ.ศ. (2500–2700) · วันต้องมีจริงในปฏิทิน · เวลา 00:00–23:59 · ครั้งที่ 1–999 — ผิดรูป = GoldReferenceError
 */
export function parseGoldAnnouncement(text: string): GoldReferenceAnnouncement {
  const m = ANNOUNCEMENT.exec(text.replace(/\s+/g, " ").trim());
  if (!m) throw new GoldReferenceError("รูปแบบเวลาประกาศไม่ถูกต้อง");
  const [day, month, yearBe, hour, minute] = m.slice(1, 6).map(Number) as [number, number, number, number, number];
  if (yearBe < 2500 || yearBe > 2700) throw new GoldReferenceError("ปีของประกาศต้องเป็น พ.ศ.");
  const year = yearBe - 543;
  // Date.UTC เลื่อนวันที่ล้น (31/02 → 03/03) — เทียบกลับจึงรู้ว่าวันไม่มีจริง
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new GoldReferenceError("วันที่ของประกาศไม่มีจริง");
  }
  if (hour > 23 || minute > 59) throw new GoldReferenceError("เวลาของประกาศไม่ถูกต้อง");
  const round = m[6] === undefined ? null : Number(m[6]);
  if (round === 0) throw new GoldReferenceError("ครั้งที่ของประกาศไม่ถูกต้อง");
  return {
    announcedAt: `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00+07:00`,
    round,
  };
}
