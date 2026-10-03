import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import djangoParity from "./django-parity.json";
import {
  type ConsignmentQuote,
  type ConsignmentQuoteInput,
  DEFAULT_FEE_RATE,
  DEFAULT_INTEREST_RATE,
  DEFAULT_VAT_RATE,
  addMonths,
  monthsDaysBetween,
  quote,
} from "./interest";
import legacy from "./legacy-redeem-12.json";

// ข้อสอบของสูตรไถ่ถอน: golden = ใบจริง 12 ใบ (ถ้าไม่ตรงแม้ใบเดียว งานไม่ผ่าน)
// ค่าที่คาดหวังนอก golden คิดมือจากกฎในหัว interest.ts แล้วตรวจไขว้กับ Django consignment/interest.py — ตรงทุกตัว
// django-parity.json = ผลของ Django เอง (oracle) ในกรณีที่ความละเอียดหรือลำดับการคำนวณทำให้ผลต่างกัน

type Doc = (typeof legacy.redemptions)[number];
const DOCS: readonly Doc[] = legacy.redemptions;
const doc = (redeemDoc: string): Doc => {
  const found = DOCS.find((d) => d.redeemDoc === redeemDoc);
  if (!found) throw new Error(`ไม่มี ${redeemDoc} ใน legacy-redeem-12.json`);
  return found;
};

// ใบจริงพิมพ์เงินเป็นบาทเต็มหรือ 2 ตำแหน่ง ("54" · "81.31") — ขยายเป็น 2 ตำแหน่งแบบไม่ปัด (มีไม่เกิน 2 ตำแหน่งอยู่แล้ว)
const money = (printed: string): string => {
  expect(printed).toMatch(/^\d+(\.\d{2})?$/);
  return new Decimal(printed).toFixed(2);
};

const MONEY_FIELDS = ["interest", "fee", "gross", "vatBase", "vat", "total"] as const;

describe("golden — ใบไถ่ถอนจริงของร้าน 12 ใบ (มิ.ย.–ก.ย. 2569)", () => {
  it("ชุดข้อมูลครบ 12 ใบ เลขใบไม่ซ้ำ และไม่มีช่องอื่นนอกจากเลขเอกสาร วันที่ เงินต้น อัตรา ตัวเลขบนใบ", () => {
    expect(DOCS).toHaveLength(12);
    expect(new Set(DOCS.map((d) => d.redeemDoc)).size).toBe(12);
    for (const d of DOCS) {
      expect(Object.keys(d).sort()).toEqual(
        [
          "contractDate",
          "contractDoc",
          "days",
          "fee",
          "feeRate",
          "gross",
          "interest",
          "interestRate",
          "months",
          "principal",
          "redeemDate",
          "redeemDoc",
          "total",
          "vat",
          "vatBase",
        ].sort(),
      );
    }
  });

  it.each(DOCS.map((d) => [d.redeemDoc, d] as const))("%s ตรงใบจริงทุกบาททุกสตางค์", (_, d) => {
    const q = quote({
      principal: d.principal,
      contractDate: d.contractDate,
      redeemDate: d.redeemDate,
      interestRate: d.interestRate,
      feeRate: d.feeRate,
    });
    expect({ months: q.months, days: q.days, ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, q[f]])) }).toEqual({
      months: d.months,
      days: d.days,
      ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, money(d[f])])),
    });
  });

  it.each(DOCS.map((d) => [d.redeemDoc, d] as const))("%s ระยะถือครองตรงกับที่ใบพิมพ์", (_, d) => {
    expect(monthsDaysBetween(d.contractDate, d.redeemDate)).toEqual({ months: d.months, days: d.days });
  });
});

describe("ปัดผลตอบแทนและค่าธรรมเนียมแยกกันก่อน แล้วค่อยบวก", () => {
  // รวมอัตราก่อนปัด (2 %/เดือน) ได้ 100 และ 106 — ใบจริงคือ 101 และ 107
  it.each([
    ["IVJ6909-0001", "63.00", "38.00", "101.00"],
    ["IVJ6908-0005", "67.00", "40.00", "107.00"],
  ])("%s: ผลตอบแทน %s + ค่าธรรมเนียม %s = %s (รวมก่อนปัดจะขาด 1 บาท)", (redeemDoc, interest, fee, gross) => {
    const d = doc(redeemDoc);
    const q = quote({ principal: d.principal, contractDate: d.contractDate, redeemDate: d.redeemDate });
    expect([q.interest, q.fee, q.gross]).toEqual([interest, fee, gross]);
    expect(q.gross).toBe(money(d.gross));
  });

  it("ปัดครึ่งขึ้น (HALF_UP) ไม่ใช่ครึ่งไปเลขคู่ — 312.5 → 313 · 187.5 → 188", () => {
    // 50,000 × 1.25% × 14/28 = 312.5 พอดี · × 0.75% × 14/28 = 187.5 พอดี
    const q = quote({ principal: "50000", contractDate: "2026-02-01", redeemDate: "2026-02-15" });
    expect([q.interest, q.fee, q.gross]).toEqual(["313.00", "188.00", "501.00"]);
  });
});

describe("ตัวหารของเศษวัน = จำนวนวันของเดือนที่ไถ่", () => {
  it("IVJ6908-0007: ไถ่ใน ส.ค. หาร 31 → 258 (ถ้าหาร 30 จะได้ 267)", () => {
    const q = quote({ principal: "50000", contractDate: "2026-08-23", redeemDate: "2026-08-31" });
    expect([q.daysInMonth, q.gross]).toEqual([31, "258.00"]);
  });

  it("ถือ 8 วันเท่ากัน: เดือน 31 วัน (ส.ค.) กับเดือน 30 วัน (ก.ย.) ได้ยอดต่างกัน", () => {
    const aug = quote({ principal: "50000", contractDate: "2026-08-23", redeemDate: "2026-08-31" });
    const sep = quote({ principal: "50000", contractDate: "2026-09-22", redeemDate: "2026-09-30" });
    expect([aug.days, sep.days]).toEqual([8, 8]);
    expect([aug.daysInMonth, sep.daysInMonth]).toEqual([31, 30]);
    expect(sep).toEqual({
      months: 0,
      days: 8,
      daysInMonth: 30,
      interest: "167.00",
      fee: "100.00",
      gross: "267.00",
      vatBase: "249.53",
      vat: "17.47",
      total: "50267.00",
    } satisfies ConsignmentQuote);
    expect(aug.gross).not.toBe(sep.gross);
  });

  it("ปีอธิกสุรทิน: ก.พ. 2571 (2028) หาร 29 · ก.พ. 2569 (2026) หาร 28", () => {
    const leap = quote({ principal: "50000", contractDate: "2028-02-01", redeemDate: "2028-02-15" });
    const common = quote({ principal: "50000", contractDate: "2026-02-01", redeemDate: "2026-02-15" });
    expect(leap).toEqual({
      months: 0,
      days: 14,
      daysInMonth: 29,
      interest: "302.00",
      fee: "181.00",
      gross: "483.00",
      vatBase: "451.40",
      vat: "31.60",
      total: "50483.00",
    } satisfies ConsignmentQuote);
    expect(common).toEqual({
      months: 0,
      days: 14,
      daysInMonth: 28,
      interest: "313.00",
      fee: "188.00",
      gross: "501.00",
      vatBase: "468.22",
      vat: "32.78",
      total: "50501.00",
    } satisfies ConsignmentQuote);
  });

  it("ใช้เดือนที่ไถ่ ไม่ใช่เดือนที่ทำสัญญา — 20 ม.ค. → 5 ก.พ. 2569 หาร 28 (ไม่ใช่ 31)", () => {
    // 28,000 × 1.25% × 16/28 = 200 พอดี · หาร 31 จะได้ 180.65 → 181
    const q = quote({ principal: "28000", contractDate: "2026-01-20", redeemDate: "2026-02-05" });
    expect([q.days, q.daysInMonth, q.interest, q.fee, q.gross]).toEqual([16, 28, "200.00", "120.00", "320.00"]);
  });

  it("เดือนเต็มหลายเดือนข้ามปี + เศษวัน: 15 พ.ย. 2568 → 20 ม.ค. 2570 = 14 เดือน 5 วัน หาร 31", () => {
    expect(quote({ principal: "10000", contractDate: "2025-11-15", redeemDate: "2027-01-20" })).toEqual({
      months: 14,
      days: 5,
      daysInMonth: 31,
      interest: "1770.00",
      fee: "1062.00",
      gross: "2832.00",
      vatBase: "2646.73",
      vat: "185.27",
      total: "12832.00",
    } satisfies ConsignmentQuote);
  });
});

describe("VAT รวมอยู่ในผลตอบแทน + ค่าธรรมเนียม · เงินต้นไม่คิด VAT", () => {
  it.each(DOCS.map((d) => [d.redeemDoc, d] as const))(
    "%s: vat = HALF_UP2(gross × 7/107) · vatBase + vat = gross · total = เงินต้น + gross",
    (_, d) => {
      const q = quote({ principal: d.principal, contractDate: d.contractDate, redeemDate: d.redeemDate });
      const gross = new Decimal(q.gross);
      expect(q.vat).toBe(gross.times(7).div(107).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2));
      expect(new Decimal(q.vatBase).plus(q.vat).toFixed(2)).toBe(q.gross);
      expect(new Decimal(d.principal).plus(gross).toFixed(2)).toBe(q.total);
    },
  );

  it("เงินต้นมีสตางค์: สตางค์ไปอยู่ในยอดรวม ไม่เข้า VAT", () => {
    expect(quote({ principal: "65000.50", contractDate: "2026-06-12", redeemDate: "2026-06-14" })).toEqual({
      months: 0,
      days: 2,
      daysInMonth: 30,
      interest: "54.00",
      fee: "33.00",
      gross: "87.00",
      vatBase: "81.31",
      vat: "5.69",
      total: "65087.50",
    } satisfies ConsignmentQuote);
  });
});

describe("ระยะถือครอง — ขอบของวันที่", () => {
  it("ไถ่วันเดียวกับวันทำสัญญา = 0 เดือน 0 วัน · ไม่มีผลตอบแทน (IVJ6908-0003)", () => {
    expect(monthsDaysBetween("2026-08-10", "2026-08-10")).toEqual({ months: 0, days: 0 });
    expect(quote({ principal: "50000", contractDate: "2026-08-10", redeemDate: "2026-08-10" })).toEqual({
      months: 0,
      days: 0,
      daysInMonth: 31,
      interest: "0.00",
      fee: "0.00",
      gross: "0.00",
      vatBase: "0.00",
      vat: "0.00",
      total: "50000.00",
    } satisfies ConsignmentQuote);
  });

  it("ไถ่ก่อนวันทำสัญญา = 0 (ไม่ติดลบ) · ยอดไถ่ = เงินต้น", () => {
    expect(monthsDaysBetween("2026-09-10", "2026-09-01")).toEqual({ months: 0, days: 0 });
    expect(monthsDaysBetween("2027-01-01", "2026-12-31")).toEqual({ months: 0, days: 0 });
    expect(quote({ principal: "50000", contractDate: "2026-09-10", redeemDate: "2026-09-01" })).toEqual({
      months: 0,
      days: 0,
      daysInMonth: 30,
      interest: "0.00",
      fee: "0.00",
      gross: "0.00",
      vatBase: "0.00",
      vat: "0.00",
      total: "50000.00",
    } satisfies ConsignmentQuote);
  });

  it.each([
    // [start, end, months, days]
    ["2026-08-04", "2026-09-05", 1, 1], // IVJ6909-0002 — ครบเดือนแล้วเกิน 1 วัน
    ["2026-07-05", "2026-08-04", 0, 30], // IVJ6908-0001 — ยังไม่ครบเดือน (ถอยเดือนลง 1)
    ["2026-01-31", "2026-02-28", 1, 0], // 31 ม.ค. + 1 เดือน = 28 ก.พ. → ครบเดือนพอดี
    ["2026-01-30", "2026-02-28", 1, 0], // ตัดวันเหมือนกัน
    ["2026-01-31", "2026-03-01", 1, 1], // 28 ก.พ. + 1 วัน
    ["2028-01-31", "2028-02-29", 1, 0], // ปีอธิกสุรทิน
    ["2028-01-31", "2028-02-28", 0, 28],
    ["2026-03-31", "2026-04-30", 1, 0], // เดือน 31 → 30 วัน
    ["2026-03-31", "2026-05-01", 1, 1],
    ["2026-12-31", "2027-01-01", 0, 1], // ข้ามปี
    ["2025-11-15", "2027-01-20", 14, 5],
  ])("%s → %s = %i เดือน %i วัน", (start, end, months, days) => {
    expect(monthsDaysBetween(start, end)).toEqual({ months, days });
  });
});

describe("addMonths — ตัดวันให้ไม่เกินวันสุดท้ายของเดือนปลายทาง", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"], // ปีอธิกสุรทิน
    ["1900-01-31", 1, "1900-02-28"], // หาร 100 ลงตัว ไม่ใช่อธิกสุรทิน
    ["2000-01-31", 1, "2000-02-29"], // หาร 400 ลงตัว เป็นอธิกสุรทิน
    ["2026-03-31", 1, "2026-04-30"],
    ["2026-11-15", 3, "2027-02-15"], // ทดปี
    ["2026-01-15", -1, "2025-12-15"], // ถอยข้ามปี (floor แบบ Python)
    ["2026-05-31", -3, "2026-02-28"],
    ["2026-01-31", -13, "2024-12-31"],
    ["2026-09-14", 0, "2026-09-14"],
    ["0099-01-31", 1, "0099-02-28"], // ปี < 100 ไม่ถูกแปลงเป็น 19xx
    ["0004-01-31", 1, "0004-02-29"],
  ])("%s + %i เดือน = %s", (date, months, expected) => {
    expect(addMonths(date, months)).toBe(expected);
  });

  it.each([
    ["9999-12-01", 1],
    ["0001-01-01", -1],
  ])("%s + %i เดือน: ปีหลุดช่วง 1–9999 = RangeError (แบบ Python date)", (date, months) => {
    expect(() => addMonths(date, months)).toThrow(RangeError);
  });

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    "จำนวนเดือน %s ไม่ใช่จำนวนเต็มที่ปลอดภัย = RangeError",
    (n) => {
      expect(() => addMonths("2026-01-31", n)).toThrow(/จำนวนเต็ม/);
    },
  );
});

describe("ค่าตั้งต้นและอัตราที่ส่งเอง", () => {
  it("ค่าตั้งต้น 1.25 / 0.75 / 7 และไม่ส่ง = ส่งค่าตั้งต้นเอง", () => {
    expect([DEFAULT_INTEREST_RATE, DEFAULT_FEE_RATE, DEFAULT_VAT_RATE]).toEqual(["1.25", "0.75", "7"]);
    const base = { principal: "25000", contractDate: "2026-09-05", redeemDate: "2026-09-14" };
    expect(quote(base)).toEqual(quote({ ...base, interestRate: "1.25", feeRate: "0.75", vatRate: "7" }));
    // IVJ6909-0003 — บั๊ก Django รุ่นแรกคิดเต็ม 3 เดือน = 937.50 · ใบจริง 150
    expect(quote(base).gross).toBe("150.00");
  });

  it("อัตราที่ส่งเองถูกใช้จริงทั้งสามตัว — ค่าธรรมเนียม 0 และ VAT 0", () => {
    expect(
      quote({
        principal: "10000",
        contractDate: "2026-09-01",
        redeemDate: "2026-10-01",
        interestRate: "3",
        feeRate: "0",
        vatRate: "0",
      }),
    ).toEqual({
      months: 1,
      days: 0,
      daysInMonth: 31,
      interest: "300.00",
      fee: "0.00",
      gross: "300.00",
      vatBase: "300.00",
      vat: "0.00",
      total: "10300.00",
    } satisfies ConsignmentQuote);
  });

  it("VAT 10 %: ฐานภาษีใช้สูตร gross × rate / (100 + rate)", () => {
    const q = quote({
      principal: "10000",
      contractDate: "2026-09-01",
      redeemDate: "2026-10-01",
      interestRate: "1",
      feeRate: "0.1",
      vatRate: "10",
    });
    expect([q.interest, q.fee, q.gross, q.vat, q.vatBase, q.total]).toEqual([
      "100.00",
      "10.00",
      "110.00",
      "10.00",
      "100.00",
      "10110.00",
    ]);
  });

  it("เงินต้น 0 = ทุกยอดเป็น 0.00", () => {
    const q = quote({ principal: "0", contractDate: "2026-06-12", redeemDate: "2026-07-14" });
    expect(MONEY_FIELDS.map((f) => q[f])).toEqual(MONEY_FIELDS.map(() => "0.00"));
  });
});

describe("รูปแบบเอาท์พุต — เงินเป็น string ทศนิยม 2 ตำแหน่งเสมอ (แบบ fmtMoney ของ core)", () => {
  it.each(DOCS.map((d) => [d.redeemDoc, d] as const))("%s", (_, d) => {
    const q = quote({ principal: d.principal, contractDate: d.contractDate, redeemDate: d.redeemDate });
    for (const f of MONEY_FIELDS) expect(q[f]).toMatch(/^\d+\.\d{2}$/);
    for (const f of ["interest", "fee", "gross"] as const) expect(q[f]).toMatch(/\.00$/);
    expect([typeof q.months, typeof q.days, typeof q.daysInMonth]).toEqual(["number", "number", "number"]);
  });
});

describe("ความละเอียดกลางทางยึด Django (Python decimal 28 หลัก ROUND_HALF_EVEN) — การตัดสินใจของเจ้าของ 4 ต.ค. 2569", () => {
  // Decimal ตัวกลางของ core (20 หลัก HALF_UP) ได้ 67 / 40 — ต่างจาก Django และค่าแม่นยำ (3,100 × 54/31 × 1.25% = 67.5 → 68)
  it("3,100 บาท 20 มิ.ย. → 12 ส.ค. 2569 (1 เดือน 23 วัน หาร 31): 68 / 41 เท่ากับ Django", () => {
    expect(quote({ principal: "3100", contractDate: "2026-06-20", redeemDate: "2026-08-12" })).toEqual({
      months: 1,
      days: 23,
      daysInMonth: 31,
      interest: "68.00",
      fee: "41.00",
      gross: "109.00",
      vatBase: "101.87",
      vat: "7.13",
      total: "3209.00",
    } satisfies ConsignmentQuote);
  });

  // ตามการตัดสินใจของเจ้าของ 4 ต.ค. 2569: ยึด Django — ใช้กับทั้งกรณี 1,800 บาท และ 6,200 บาท ข้างล่าง
  // ค่าจริงก่อนปัดลงที่ .5 พอดี (ปัดครึ่งขึ้นจะได้มากกว่า 1 บาท) แต่ Django เก็บเศษวันที่หารไม่ลงตัว (10/30 · 5/31)
  // เป็น 28 หลักที่ต่ำกว่าค่าจริงนิดเดียว ได้ x.4999… แล้วปัดลง · ค่าคาดหวังข้างล่างคือผลของ Django ซึ่งเป็นพฤติกรรมที่ตกลงแล้ว
  // ห้ามแก้เป็นค่าแม่นยำ — เหตุผลเต็มอยู่ที่ `Django` ใน interest.ts
  it("1,800 บาท 1 → 11 ก.ย. 2569: ผลตอบแทน 7 ตาม Django (ค่าจริง 22.5 × 10/30 = 7.5 — ปัดครึ่งขึ้นจะได้ 8)", () => {
    expect(quote({ principal: "1800", contractDate: "2026-09-01", redeemDate: "2026-09-11" })).toEqual({
      months: 0,
      days: 10,
      daysInMonth: 30,
      interest: "7.00",
      fee: "5.00",
      gross: "12.00",
      vatBase: "11.21",
      vat: "0.79",
      total: "1812.00",
    } satisfies ConsignmentQuote);
  });

  it("6,200 บาท 5 → 10 ส.ค. 2569: ค่าธรรมเนียม 7 ตาม Django (ค่าจริง 46.5 × 5/31 = 7.5 — ปัดครึ่งขึ้นจะได้ 8)", () => {
    expect(quote({ principal: "6200", contractDate: "2026-08-05", redeemDate: "2026-08-10" })).toEqual({
      months: 0,
      days: 5,
      daysInMonth: 31,
      interest: "13.00",
      fee: "7.00",
      gross: "20.00",
      vatBase: "18.69",
      vat: "1.31",
      total: "6220.00",
    } satisfies ConsignmentQuote);
  });
});

describe("ตรงกับ Django ทุกแถวของ oracle (django-parity.json — ผลจาก Django interest.py เอง)", () => {
  // แถว: "tag principal contractDate redeemDate interestRate feeRate vatRate | months days daysInMonth interest fee
  // gross vatBase vat total" · tag บอกว่าแถวนั้นจับการเบี่ยงจาก Django แบบไหน (คำอธิบายอยู่ที่ tags ในไฟล์)
  const ROW =
    /^([a-z0-9-]+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) \| (\d+) (\d+) (\d+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+)$/;
  const rows = djangoParity.rows.map((line) => {
    const f = ROW.exec(line)?.slice(1);
    if (f?.length !== 16) throw new Error(`django-parity.json: แถวผิดรูป "${line}"`);
    const at = (i: number): string => f[i] ?? "";
    const input: ConsignmentQuoteInput = {
      principal: at(1),
      contractDate: at(2),
      redeemDate: at(3),
      interestRate: at(4),
      feeRate: at(5),
      vatRate: at(6),
    };
    const expected: ConsignmentQuote = {
      months: Number.parseInt(at(7), 10),
      days: Number.parseInt(at(8), 10),
      daysInMonth: Number.parseInt(at(9), 10),
      interest: at(10),
      fee: at(11),
      gross: at(12),
      vatBase: at(13),
      vat: at(14),
      total: at(15),
    };
    return { tag: at(0), label: `${at(0)} ${at(1)} ${at(2)} → ${at(3)}`, input, expected };
  });

  it("ทุกแท็กที่อธิบายไว้มีแถว และทุกแถวใช้แท็กที่อธิบายไว้", () => {
    const tags = Object.keys(djangoParity.tags).sort();
    expect([...new Set(rows.map((r) => r.tag))].sort()).toEqual(tags);
    expect(tags).toEqual(["below-exact", "general", "one-division", "rate-times-factor", "vs-20-digits"]);
  });

  it.each(rows.map((r) => [r.label, r] as const))("%s", (_, r) => {
    expect(quote(r.input)).toEqual(r.expected);
  });
});

describe("อินพุตผิดรูป = RangeError (ไม่เดา ไม่คิดต่อ)", () => {
  const ok = { principal: "50000", contractDate: "2026-09-01", redeemDate: "2026-09-11" };

  it.each([
    "2026-02-29", // ไม่มีจริง (ไม่ใช่ปีอธิกสุรทิน)
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "0000-01-01",
    "2026-9-1",
    "2026-09-01T00:00:00Z",
    " 2026-09-01",
    "01/09/2026",
    "",
  ])("วันที่ %j", (bad) => {
    expect(() => quote({ ...ok, contractDate: bad })).toThrow(/contractDate: วันที่ไม่ถูกต้อง/);
    expect(() => quote({ ...ok, redeemDate: bad })).toThrow(/redeemDate: วันที่ไม่ถูกต้อง/);
    expect(() => monthsDaysBetween(bad, "2026-09-01")).toThrow(/start: /);
    expect(() => monthsDaysBetween("2026-09-01", bad)).toThrow(/end: /);
    expect(() => addMonths(bad, 1)).toThrow(/date: /);
  });

  it.each(["-1", "1,000", "abc", "100.001", "1e5", "", " "])("เงินต้น %j", (bad) => {
    expect(() => quote({ ...ok, principal: bad })).toThrow(RangeError);
    expect(() => quote({ ...ok, principal: bad })).toThrow(/principal: /);
  });

  it.each(["-1", "abc", "1e2", ""])("อัตรา %j", (bad) => {
    expect(() => quote({ ...ok, interestRate: bad })).toThrow(/interestRate: /);
    expect(() => quote({ ...ok, feeRate: bad })).toThrow(/feeRate: /);
    expect(() => quote({ ...ok, vatRate: bad })).toThrow(/vatRate: /);
  });
});
