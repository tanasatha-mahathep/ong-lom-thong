import Decimal from "decimal.js";
import { fmtMoney, halfUp, parsePlainDecimal } from "../money";

/**
 * ผลตอบแทน/ค่าธรรมเนียมของสัญญาขายฝาก และ VAT ของใบไถ่ถอน (IVJ) — พอร์ตจาก Django `consignment/interest.py`
 *
 * ทุกกฎถอดจาก **ใบไถ่ถอนจริงของร้าน 12 ใบ** (มิ.ย.–ก.ย. 2569 ดึงจากระบบเดิมแบบ read-only 15 ก.ย. 2569)
 * ไม่ใช่การอนุมาน — เทสต์ golden ใน interest.test.ts บังคับให้ตรงทุกใบทุกสตางค์
 *
 * 1. คิด **ตามวันที่ถือครองจริง** (เดือนเต็ม + เศษวัน) ไม่ใช่ตามระยะสัญญา
 * 2. ผลตอบแทน (ปกติ 1.25 %/เดือน) กับค่าธรรมเนียมในการจัดการ (ปกติ 0.75 %/เดือน)
 *    **ปัดครึ่งขึ้นเป็นบาทแยกกันก่อน แล้วค่อยบวก** — รวมก่อนปัดเพี้ยน 1 บาท (IVJ6908-0005 · IVJ6909-0001)
 * 3. ตัวหารของเศษวัน = **จำนวนวันของเดือนที่ไถ่** (ส.ค. 31 · ก.ย. 30) ไม่ใช่ 30 ตายตัว
 * 4. ผลตอบแทน + ค่าธรรมเนียม **รวม VAT แล้ว** · VAT = ปัดครึ่งขึ้น 2 ตำแหน่ง(รวม × 7 / 107) · ฐานภาษี = รวม − VAT
 * 5. เงินต้นไม่คิด VAT · ยอดไถ่ = เงินต้น + ผลตอบแทน + ค่าธรรมเนียม
 *
 * ฟังก์ชันบริสุทธิ์ ไม่แตะ DB/เวลา — ผู้เรียกส่ง "วันนี้" มาเอง (businessDate) · อินพุตผิดรูป = RangeError
 */

/** ผลตอบแทน %/เดือน (ค่าตั้งต้นของใบจริงทั้ง 12 ใบ) */
export const DEFAULT_INTEREST_RATE = "1.25";
/** ค่าธรรมเนียมในการจัดการ %/เดือน */
export const DEFAULT_FEE_RATE = "0.75";
/** VAT % ที่รวมอยู่ในผลตอบแทน + ค่าธรรมเนียม */
export const DEFAULT_VAT_RATE = "7";

/**
 * บริบทเลขทศนิยมของ Django (Python `decimal` ค่าตั้งต้น — Django ไม่ได้ตั้งเอง): 28 หลักนัยสำคัญ
 * ปัด ROUND_HALF_EVEN ทุกขั้นกลางทาง · ใช้เฉพาะไฟล์นี้ ไม่แตะ Decimal ตัวกลางของ core (20 หลัก HALF_UP)
 *
 * จำเป็นต่อการตรงกับ Django ทุกบาท: ค่าตั้งต้นของ decimal.js ให้ผลต่างจาก Django ในบางกรณี
 * (3,100 บาท 1 เดือน 23 วัน หาร 31: Django 68 / 41 · 20 หลัก 67 / 40)
 *
 * รอเจ้าของตัดสิน: เมื่อค่าก่อนปัดที่แท้จริงลงที่ .5 พอดี แต่เศษวันหารไม่ลงตัว (10/30 · 5/31 …) Django ได้ x.4999…
 * แล้วปัดลง — 1,800 บาท 10 วันในเดือน 30 วัน: 22.5 × 10/30 = 7.5 → Django 7 (ค่าแม่นยำ 8)
 * ใบจริง 12 ใบไม่มีกรณีนี้ จึงยังพิสูจน์ไม่ได้ว่าระบบเดิมได้เท่าไร · พอร์ตนี้ตรึงให้ตรงกับ Django ตามข้อกำหนด
 */
const Django = Decimal.clone({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface HoldPeriod {
  /** เดือนเต็ม */
  months: number;
  /** วันที่เหลือหลังเดือนเต็ม */
  days: number;
}

export interface ConsignmentQuoteInput {
  /** เงินต้นขายฝาก (บาท) ตัวเลขล้วน ทศนิยม ≤ 2 เช่น "65000" · "65000.00" */
  principal: string;
  /** วันทำสัญญา "YYYY-MM-DD" */
  contractDate: string;
  /** วันที่ไถ่ "YYYY-MM-DD" (ก่อนหรือวันเดียวกับวันทำสัญญา = ถือครอง 0) */
  redeemDate: string;
  /** ผลตอบแทน %/เดือน · ไม่ส่ง = DEFAULT_INTEREST_RATE */
  interestRate?: string;
  /** ค่าธรรมเนียมในการจัดการ %/เดือน · ไม่ส่ง = DEFAULT_FEE_RATE */
  feeRate?: string;
  /** VAT % · ไม่ส่ง = DEFAULT_VAT_RATE */
  vatRate?: string;
}

/** ทุกตัวเลขที่ต้องพิมพ์บนใบไถ่ถอน — เงินเป็น string ทศนิยม 2 ตำแหน่ง (ผลตอบแทน/ค่าธรรมเนียมเป็นบาทเต็ม ".00") */
export interface ConsignmentQuote extends HoldPeriod {
  /** จำนวนวันของเดือนที่ไถ่ — ตัวหารของเศษวัน */
  daysInMonth: number;
  /** ผลตอบแทน (รวม VAT) */
  interest: string;
  /** ค่าธรรมเนียมในการจัดการ (รวม VAT) */
  fee: string;
  /** ผลตอบแทน + ค่าธรรมเนียม (รวม VAT) */
  gross: string;
  /** ฐานภาษี = gross − vat */
  vatBase: string;
  vat: string;
  /** ยอดที่ลูกค้าชำระเพื่อไถ่คืน = เงินต้น + gross */
  total: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const MAX_YEAR = 9999; // ช่วงเดียวกับ Python `date` (1–9999)

/** จำนวนวันของเดือน — วันที่ 0 ของเดือนถัดไป (ปีอธิกสุรทินตามกฎ 4/100/400 ของ Date) */
function daysInMonth(year: number, month: number): number {
  const t = new Date(0);
  t.setUTCFullYear(year, month, 0);
  return t.getUTCDate();
}

/** ลำดับวันนับจาก epoch — setUTCFullYear ไม่แปลงปี 0–99 เป็น 19xx แบบ Date.UTC */
function epochDay(d: CivilDate): number {
  const t = new Date(0);
  t.setUTCFullYear(d.year, d.month - 1, d.day);
  return t.getTime() / MS_PER_DAY;
}

/** "YYYY-MM-DD" ที่มีจริงในปฏิทิน (ปี 1–9999) เท่านั้น — "2026-02-29" · "2026-9-1" · "2026-09-01T00:00" = RangeError */
function parseIsoDate(value: string, field: string): CivilDate {
  const d = ISO_DATE.test(value)
    ? {
        year: Number.parseInt(value.slice(0, 4), 10),
        month: Number.parseInt(value.slice(5, 7), 10),
        day: Number.parseInt(value.slice(8, 10), 10),
      }
    : null;
  if (!d || d.year < 1 || d.month < 1 || d.month > 12 || d.day < 1 || d.day > daysInMonth(d.year, d.month)) {
    throw new RangeError(`${field}: วันที่ไม่ถูกต้อง "${value}" (ต้องเป็น YYYY-MM-DD ที่มีจริง)`);
  }
  return d;
}

const toIso = (d: CivilDate): string =>
  `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** add_months ของ Django: เลื่อนเดือน แล้วตัดวันให้ไม่เกินวันสุดท้ายของเดือนปลายทาง (31 ม.ค. + 1 = 28/29 ก.พ.) */
function shiftMonths(d: CivilDate, months: number): CivilDate {
  const m = d.month - 1 + months;
  const carry = Math.floor(m / 12); // floor แบบ Python `//` — เดือนติดลบถอยปีถูกต้อง
  const year = d.year + carry;
  const month = m - carry * 12 + 1;
  if (year < 1 || year > MAX_YEAR) throw new RangeError(`addMonths: ปี ${year} อยู่นอกช่วง 1–${MAX_YEAR}`);
  return { year, month, day: Math.min(d.day, daysInMonth(year, month)) };
}

function holdPeriod(start: CivilDate, end: CivilDate): HoldPeriod {
  const endDay = epochDay(end);
  if (endDay <= epochDay(start)) return { months: 0, days: 0 };
  let months = (end.year - start.year) * 12 + (end.month - start.month);
  if (epochDay(shiftMonths(start, months)) > endDay) months -= 1;
  return { months, days: endDay - epochDay(shiftMonths(start, months)) };
}

function parseRate(value: string, field: string): Decimal {
  const rate = parsePlainDecimal(value);
  if (!rate) throw new RangeError(`${field}: อัตราไม่ถูกต้อง "${value}" (ตัวเลขไม่ติดลบ)`);
  return new Django(rate);
}

function parsePrincipal(value: string): Decimal {
  const principal = parsePlainDecimal(value);
  if (!principal || principal.decimalPlaces() > 2) {
    throw new RangeError(`principal: เงินต้นไม่ถูกต้อง "${value}" (ตัวเลขไม่ติดลบ ทศนิยม ≤ 2)`);
  }
  return new Django(principal);
}

/**
 * วันที่ + n เดือน แบบเดียวกับใบไถ่ถอนของระบบเดิม — วันที่เกินเดือนปลายทางถูกตัดเป็นวันสุดท้าย
 * ตัวอย่าง: addMonths("2026-01-31", 1) = "2026-02-28" · addMonths("2028-01-31", 1) = "2028-02-29"
 */
export function addMonths(date: string, months: number): string {
  if (!Number.isSafeInteger(months)) throw new RangeError(`addMonths: จำนวนเดือนต้องเป็นจำนวนเต็ม (${months})`);
  return toIso(shiftMonths(parseIsoDate(date, "date"), months));
}

/**
 * ระยะถือครอง (เดือนเต็ม, วันที่เหลือ) ตามที่ใบไถ่ถอนพิมพ์ · end ≤ start = 0 เดือน 0 วัน
 * ตัวอย่าง: 4 ส.ค. → 5 ก.ย. = 1 เดือน 1 วัน · 5 ก.ค. → 4 ส.ค. = 0 เดือน 30 วัน
 */
export function monthsDaysBetween(start: string, end: string): HoldPeriod {
  return holdPeriod(parseIsoDate(start, "start"), parseIsoDate(end, "end"));
}

/** ยอดไถ่ถอน ณ วันที่ไถ่ — สูตรเดียวของทั้งระบบ (preview และบันทึกใบ IVJ ต้องเรียกตัวนี้) */
export function quote(input: ConsignmentQuoteInput): ConsignmentQuote {
  const principal = parsePrincipal(input.principal);
  const interestRate = parseRate(input.interestRate ?? DEFAULT_INTEREST_RATE, "interestRate");
  const feeRate = parseRate(input.feeRate ?? DEFAULT_FEE_RATE, "feeRate");
  const vatRate = parseRate(input.vatRate ?? DEFAULT_VAT_RATE, "vatRate");
  const contract = parseIsoDate(input.contractDate, "contractDate");
  const redeem = parseIsoDate(input.redeemDate, "redeemDate");

  const { months, days } = holdPeriod(contract, redeem);
  const dim = daysInMonth(redeem.year, redeem.month);
  // ลำดับการคำนวณเท่ากับ Django ทุกขั้น (ผลกลางทางปัดตามบริบท Django ต่างกันได้ถ้าสลับลำดับ)
  const factor = new Django(months).plus(new Django(days).div(dim));
  const interest = halfUp(principal.times(interestRate).div(100).times(factor), 0);
  const fee = halfUp(principal.times(feeRate).div(100).times(factor), 0);
  const gross = interest.plus(fee);
  const vat = halfUp(gross.times(vatRate).div(new Django(100).plus(vatRate)), 2);

  return {
    months,
    days,
    daysInMonth: dim,
    interest: fmtMoney(interest),
    fee: fmtMoney(fee),
    gross: fmtMoney(gross),
    vatBase: fmtMoney(gross.minus(vat)),
    vat: fmtMoney(vat),
    total: fmtMoney(principal.plus(gross)),
  };
}
