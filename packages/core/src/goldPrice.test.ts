import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOLD_SETTING,
  deriveGoldPrice,
  type GoldPriceQuote,
  type GoldPriceSetting,
  typoWarning,
} from "./goldPrice";
import type { Numeric } from "./money";

// oracle ของไฟล์นี้ (CLAUDE.md กฎ 1–3)
// • Decimal ที่โค้ดคืนมา เทียบด้วย .toFixed() แบบไม่ใส่ตำแหน่ง = ค่าจริงไม่ปัด (plain notation · decimal.js ตัดศูนย์ท้าย 67850.50 → "67850.5")
//   ห้ามใช้ .toFixed(0) / .toFixed(2) เป็นตัวเทียบ: มันปัด HALF_UP เอง ถ้า deriveGoldPrice ลืมปัด (คืน 64267.5 ซึ่งคือค่าที่จะถูกเก็บ) เทสต์ก็ยังผ่าน
// • ค่าคาดหวังทุกตัวคิดมือจาก R8 · กระดานราคาจริง · ค่า DEFAULT ใน migration — ตัวเลขที่คิดอยู่ในชื่อเทสต์/คอมเมนต์ ไม่ได้คัดลอกจากผลรันโค้ด
// • ออกแบบตาม ISO/IEC/IEEE 29119-4: equivalence partitioning · boundary value analysis · decision table · error guessing

const BAR_SELL_ERROR = "ราคาทองแท่งขายออกต้องเป็นตัวเลขมากกว่า 0";

/** ค่าจริงไม่ปัดของทั้ง 3 ราคา — และต้องเป็น Decimal ไม่ใช่ number (number.toFixed() ให้ข้อความเหมือนกัน จึงเช็กชนิดด้วย · กฎ 1) */
function exact(q: GoldPriceQuote) {
  expect(q.barSell).toBeInstanceOf(Decimal);
  expect(q.barBuy).toBeInstanceOf(Decimal);
  expect(q.jewelryBuy).toBeInstanceOf(Decimal);
  return { barSell: q.barSell.toFixed(), barBuy: q.barBuy.toFixed(), jewelryBuy: q.jewelryBuy.toFixed() };
}

/** ค่าตั้งส่วนต่าง/ส่วนลด — deriveGoldPrice ไม่ใช้เกณฑ์ด่านพิมพ์ผิด จึงใส่ "3" ไว้ให้ครบชนิดเท่านั้น */
const setting = (diff: Numeric, jewelryDiscount: Numeric): GoldPriceSetting => ({
  diff,
  jewelryDiscount,
  typoGuardPercent: "3",
});

/** error ที่ถูกโยน (หรือ "ไม่ throw") — ตรวจทั้งชนิดและข้อความตรงตัวจากการเรียกครั้งเดียว */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (e) {
    return e;
  }
  return "ไม่ throw";
}

/** ผลของด่านกันพิมพ์ผิด: "ผ่าน" = คืน null · "เตือน" = คืนข้อความ · "throw" = ค่าที่รับมาใช้ไม่ได้ */
function guardOutcome(run: () => string | null): "ผ่าน" | "เตือน" | "throw" {
  try {
    return run() === null ? "ผ่าน" : "เตือน";
  } catch {
    return "throw";
  }
}

describe("deriveGoldPrice — สูตรจากระบบเดิม ยืนยันกับกระดานราคาจริง", () => {
  it("27 ก.ย. 2569: 67,850 → รับซื้อ 67,650 → รูปพรรณ 64,268", () => {
    const q = deriveGoldPrice("67850");
    expect(q.barSell.toFixed()).toBe("67850");
    expect(q.barBuy.toFixed()).toBe("67650");
    // 67,650 × 0.95 = 64,267.50 → HALF_UP 0 → 64,268 · ถ้าลืมปัด toFixed() จะได้ "64267.5" แล้ว fail
    expect(q.jewelryBuy.toFixed()).toBe("64268");
  });

  it("8 ก.ย. 2569 (หน้าจอระบบเดิมใน reference Django): 68,600 → 68,400 → 64,980 — 68,400 × 0.95 ลงตัว", () => {
    expect(exact(deriveGoldPrice("68600"))).toStrictEqual({ barSell: "68600", barBuy: "68400", jewelryBuy: "64980" });
  });

  it("รับค่าที่มีคอมมาแบบที่ร้านพิมพ์", () => {
    const q = deriveGoldPrice("67,850");
    expect(q.barSell.toFixed()).toBe("67850");
    expect(q.jewelryBuy.toFixed()).toBe("64268");
  });

  it("ปัดครึ่งขึ้น ไม่ใช่ปัดเลขคู่ (banker's): 67,630 × 0.95 = 64,248.5 → 64,249", () => {
    const q = deriveGoldPrice("67830");
    expect(q.barBuy.toFixed()).toBe("67630");
    expect(q.jewelryBuy.toFixed()).toBe("64249");
  });

  it("ส่วนต่าง/ส่วนลด ปรับได้จากตั้งค่า", () => {
    const q = deriveGoldPrice("50000", { diff: "100", jewelryDiscount: "0.9", typoGuardPercent: "3" });
    expect(q.barBuy.toFixed()).toBe("49900");
    expect(q.jewelryBuy.toFixed()).toBe("44910"); // 49,900 × 0.9 = 44,910 ลงตัว
  });

  // error guessing + BVA ที่ 0 (ศูนย์ทุกรูป · ต่ำกว่า 0 หนึ่งสตางค์) · "NaN"/"Infinity" decimal.js parse ได้แต่ไม่ใช่ตัวเลขจำกัด
  // · เลขไทย · พิมพ์ 67850 ตอนแป้นค้างภาษาไทย (เกษมณี 6 7 8 5 0 = ุ ึ ค ถ จ)
  it.each([
    "",
    "0",
    "-1",
    "abc",
    "12abc",
    "67,85O",
    "   ",
    "-0",
    "0.00",
    "-0.01",
    "NaN",
    "Infinity",
    "-Infinity",
    "๖๗๘๕๐",
    "ุึคถจ",
    // parseDecimal แบบเข้ม (dev PR #53): exponent · hex · คอมมาผิดตำแหน่ง ไม่ใช่ตัวเลขที่ผู้ใช้กรอก
    "6.785e4",
    "0x1090A",
    "67,85",
    "678,50",
  ])("ปฏิเสธค่าที่ใช้ไม่ได้: %j", (v) => {
    const e = thrownBy(() => deriveGoldPrice(v));
    expect(e).toBeInstanceOf(RangeError);
    expect(e).toHaveProperty("message", BAR_SELL_ERROR);
  });

  it.each([
    { label: "number 0", v: 0 },
    { label: "number -1", v: -1 },
    { label: "number NaN", v: NaN },
    { label: "number Infinity", v: Infinity },
    { label: "Decimal 0", v: new Decimal(0) },
    { label: "Decimal -0.01", v: new Decimal("-0.01") },
    { label: "Decimal NaN", v: new Decimal(NaN) },
  ])("ปฏิเสธค่าที่ไม่ใช่ string: $label", ({ v }) => {
    const e = thrownBy(() => deriveGoldPrice(v));
    expect(e).toBeInstanceOf(RangeError);
    expect(e).toHaveProperty("message", BAR_SELL_ERROR);
  });

  it("ขอบฝั่งที่รับ: 0.01 (บวกเล็กสุดของราคา 2 ตำแหน่ง) ผ่านด่าน — ส่วนต่าง 0 แยกออกจากเรื่องราคาต่ำกว่าส่วนต่างที่ api ตัดสิน", () => {
    const q = deriveGoldPrice("0.01", setting("0", "0.95"));
    expect(q.barSell.toFixed()).toBe("0.01");
    expect(q.barBuy.toFixed()).toBe("0.01");
  });
});

describe("deriveGoldPrice — ทองรูปพรรณ HALF_UP 0 ตำแหน่ง (§8 · BVA ที่หลักที่ถูกตัด …4 / …5 / …6)", () => {
  // ส่วนต่าง 200 × 0.95: ราคาเต็มบาท → เศษเป็นทวีคูณของ 0.05 · ราคามีสตางค์ → ขยับทีละ 0.0095 รอบ ๆ .5
  it.each([
    {
      barSell: "67852",
      barBuy: "67652",
      product: "64,269.40",
      jewelryBuy: "64269",
      why: "ตัด 4 → ลง (ROUND_UP ได้ 64,270)",
    },
    {
      barSell: "67850",
      barBuy: "67650",
      product: "64,267.50",
      jewelryBuy: "64268",
      why: "ตัด 5 → ขึ้น (HALF_DOWN ได้ 64,267)",
    },
    {
      barSell: "67848",
      barBuy: "67648",
      product: "64,265.60",
      jewelryBuy: "64266",
      why: "ตัด 6 → ขึ้น (FLOOR ได้ 64,265)",
    },
    {
      barSell: "67830",
      barBuy: "67630",
      product: "64,248.50",
      jewelryBuy: "64249",
      why: "หลังเลขคู่ (HALF_EVEN ได้ 64,248)",
    },
    { barSell: "67849.99", barBuy: "67649.99", product: "64,267.4905", jewelryBuy: "64267", why: "ต่ำกว่า .5 → ลง" },
    { barSell: "67850.01", barBuy: "67650.01", product: "64,267.5095", jewelryBuy: "64268", why: "เกิน .5 → ขึ้น" },
  ])("$barSell → รับซื้อ $barBuy × 0.95 = $product → $jewelryBuy · $why", ({ barSell, barBuy, jewelryBuy }) => {
    expect(exact(deriveGoldPrice(barSell))).toStrictEqual({ barSell, barBuy, jewelryBuy });
  });
});

describe("deriveGoldPrice — รูปแบบราคาขายออกที่รับได้ (EP) · ขายออก/รับซื้อไม่ถูกปัด", () => {
  it.each([
    { label: 'string "67850"', v: "67850" },
    { label: 'คอมมาหลักพัน "67,850"', v: "67,850" },
    { label: 'มีช่องว่างหัวท้าย " 67,850 "', v: " 67,850 " },
    { label: 'ทศนิยมศูนย์ "67850.00"', v: "67850.00" },
    { label: "number 67850", v: 67850 },
    { label: "Decimal (แบบที่ api ส่ง)", v: new Decimal("67850") }, // api parseDecimal ก่อนแล้วส่ง Decimal
  ])("$label → 67,850 / 67,650 / 64,268", ({ v }) => {
    expect(exact(deriveGoldPrice(v))).toStrictEqual({ barSell: "67850", barBuy: "67650", jewelryBuy: "64268" });
  });

  it("มีสตางค์: 67,850.50 → รับซื้อ 67,650.50 ตรงตัว · รูปพรรณ 67,650.50 × 0.95 = 64,267.975 → 64,268", () => {
    expect(exact(deriveGoldPrice("67850.50"))).toStrictEqual({
      barSell: "67850.5",
      barBuy: "67650.5",
      jewelryBuy: "64268",
    });
  });
});

describe("deriveGoldPrice — ค่าตั้งส่วนต่าง/ส่วนลด (decision table) และค่าเริ่มต้น", () => {
  it("ค่าเริ่มต้น = ระบบเดิม: ส่วนต่าง 200 (gold_setting.php) · × 0.95 (ระบบเดิมหัก 5%) · ด่าน 3% (DEFAULT ใน migration) · เป็น string ไม่ใช่ number", () => {
    expect(DEFAULT_GOLD_SETTING).toStrictEqual({ diff: "200", jewelryDiscount: "0.95", typoGuardPercent: "3" });
  });

  it.each([
    // Django test_spread_and_discount_are_configurable: 70,000 − 300 = 69,700 × 0.96 ลงตัว
    {
      label: "ส่วนต่าง 300 · × 0.96",
      s: setting("300", "0.96"),
      barSell: "70000",
      barBuy: "69700",
      product: "66,912",
      jewelryBuy: "66912",
    },
    // Django test_uses_half_up_rounding_like_javascript_not_bankers: banker's จะได้ 34,300
    {
      label: "ส่วนต่าง 0 · × 0.5",
      s: setting("0", "0.5"),
      barSell: "68601",
      barBuy: "68601",
      product: "34,300.5",
      jewelryBuy: "34301",
    },
    // diff เป็น money (numeric 14,2) มีสตางค์ได้: 67,850 − 200.50 = 67,649.50
    {
      label: "ส่วนต่างมีสตางค์ 200.50",
      s: setting("200.50", "0.95"),
      barSell: "67850",
      barBuy: "67649.5",
      product: "64,267.025",
      jewelryBuy: "64267",
    },
    // jewelry_discount เป็น numeric(6,4) ทศนิยม 4 ตำแหน่งได้
    {
      label: "ส่วนลด 4 ตำแหน่ง 0.9525",
      s: setting("200", "0.9525"),
      barSell: "67850",
      barBuy: "67650",
      product: "64,436.625",
      jewelryBuy: "64437",
    },
    // loadGoldSetting คืน string จาก postgres.js ตาม scale ของคอลัมน์
    {
      label: "แถว DB 200.00 / 0.9500",
      s: setting("200.00", "0.9500"),
      barSell: "67850",
      barBuy: "67650",
      product: "64,267.5",
      jewelryBuy: "64268",
    },
    {
      label: "number 200 / 0.95",
      s: setting(200, 0.95),
      barSell: "67850",
      barBuy: "67650",
      product: "64,267.5",
      jewelryBuy: "64268",
    },
    {
      label: "Decimal 200 / 0.95",
      s: setting(new Decimal("200"), new Decimal("0.95")),
      barSell: "67850",
      barBuy: "67650",
      product: "64,267.5",
      jewelryBuy: "64268",
    },
  ])("$label: $barSell → รับซื้อ $barBuy → × ส่วนลด = $product → $jewelryBuy", ({ s, barSell, barBuy, jewelryBuy }) => {
    expect(exact(deriveGoldPrice(barSell, s))).toStrictEqual({ barSell, barBuy, jewelryBuy });
  });

  it.each([
    { label: 'ส่วนต่าง "abc"', s: setting("abc", "0.95") },
    { label: 'ส่วนต่างว่าง ""', s: setting("", "0.95") },
    { label: 'ส่วนลด "abc"', s: setting("200", "abc") },
    { label: 'ส่วนลดเป็นช่องว่าง "  "', s: setting("200", "  ") },
  ])("ค่าตั้งเป็นขยะ → throw ไม่แอบใช้ค่าเริ่มต้น: $label", ({ s }) => {
    expect(() => deriveGoldPrice("67850", s)).toThrow();
  });
});

describe("typoWarning — ด่านกันพิมพ์ผิด", () => {
  it("ไม่มีราคาก่อนหน้า → ไม่เตือน", () => {
    expect(typoWarning(null, "67850")).toBeNull();
    expect(typoWarning(undefined, "67850")).toBeNull();
  });
  it("ห่างไม่เกิน 3% → ไม่เตือน", () => {
    expect(typoWarning("67850", "69000")).toBeNull(); // 1,150 ÷ 67,850 = 1.69%
  });
  it("พิมพ์ตกหลัก (67,850 → 6,785) → เตือนพร้อมตัวเลข", () => {
    // 61,065 ÷ 67,850 = 0.9 พอดี → 90.0%
    expect(typoWarning("67850", "6785")).toBe("ราคาห่างจากครั้งก่อน 90.0% (67850 → 6785) — ตรวจสอบก่อนบันทึก");
  });
  it("เกณฑ์ปรับได้", () => {
    // 1,150 ÷ 67,850 = 1.6949…% เกิน 1% → แสดง 1.7%
    expect(typoWarning("67850", "69000", "1")).toBe("ราคาห่างจากครั้งก่อน 1.7% (67850 → 69000) — ตรวจสอบก่อนบันทึก");
  });
});

describe("typoWarning — ราคาก่อนหน้า ≤ 0 = ไม่มีฐานให้เทียบ → ไม่เตือน (กันหารด้วยศูนย์)", () => {
  it.each([
    { label: '"0"', prev: "0" },
    { label: '"0.00" (รูปจาก numeric 14,2)', prev: "0.00" },
    { label: '"-0"', prev: "-0" },
    { label: '"-0.01" (ต่ำกว่า 0 หนึ่งสตางค์)', prev: "-0.01" },
    { label: '"-67850"', prev: "-67850" },
    { label: "number 0", prev: 0 },
    { label: "Decimal 0", prev: new Decimal(0) },
  ])("ราคาก่อนหน้า $label → null", ({ prev }) => {
    expect(typoWarning(prev, "67850")).toBeNull();
  });

  it("ขอบฝั่งที่คำนวณ: ราคาก่อนหน้า 0.01 (บวกเล็กสุด) → คิด % ตามปกติ และเตือน", () => {
    expect(typoWarning("0.01", "67850")).not.toBeNull();
  });
});

describe("typoWarning — ขอบเกณฑ์ค่าเริ่มต้น 3% (BVA · รวมขอบ: ห่างพอดี 3% ไม่เตือน)", () => {
  it.each([
    { prev: "10000", next: "10000", why: "เท่าเดิม 0%", outcome: "ผ่าน" },
    { prev: "10000", next: "10299.99", why: "+2.9999%", outcome: "ผ่าน" },
    { prev: "10000", next: "10300", why: "+3% พอดี", outcome: "ผ่าน" },
    { prev: "10000", next: "10300.01", why: "+3.0001%", outcome: "เตือน" },
    { prev: "10000", next: "9700.01", why: "−2.9999%", outcome: "ผ่าน" },
    { prev: "10000", next: "9700", why: "−3% พอดี", outcome: "ผ่าน" },
    { prev: "10000", next: "9699.99", why: "−3.0001%", outcome: "เตือน" },
    { prev: "67850", next: "69885.5", why: "ราคาจริง +3% พอดี", outcome: "ผ่าน" }, // 67,850 × 0.03 = 2,035.5
    { prev: "67850", next: "69885.51", why: "ราคาจริง เกิน 3% หนึ่งสตางค์", outcome: "เตือน" },
  ])("$prev → $next ($why) → $outcome", ({ prev, next, outcome }) => {
    expect(guardOutcome(() => typoWarning(prev, next))).toBe(outcome);
  });

  it("% คิดเทียบราคาก่อนหน้า ไม่ใช่ราคาใหม่", () => {
    // 10,000 → 9,700: 300 ÷ 10,000 = 3% พอดี → ผ่าน (ถ้าหารด้วยราคาใหม่: 300 ÷ 9,700 = 3.09% จะเตือน)
    expect(typoWarning("10000", "9700")).toBeNull();
    // 9,700 → 10,000: 300 ÷ 9,700 = 3.0928% → เตือน 3.1% (ถ้าหารด้วยราคาใหม่: 3% พอดี จะไม่เตือน)
    expect(typoWarning("9700", "10000")).toBe("ราคาห่างจากครั้งก่อน 3.1% (9700 → 10000) — ตรวจสอบก่อนบันทึก");
  });
});

describe("typoWarning — ข้อความเตือนตรงตัวทั้งประโยค (% ทศนิยม 1 ตำแหน่ง HALF_UP · ราคาเต็มบาทไม่มีคอมมา)", () => {
  it.each([
    {
      label: "พิมพ์ตกหลัก: 61,065 ÷ 67,850 = 90%",
      prev: "67850",
      next: "6785",
      msg: "ราคาห่างจากครั้งก่อน 90.0% (67850 → 6785) — ตรวจสอบก่อนบันทึก",
    },
    {
      label: "พิมพ์เกินหลัก: 610,650 ÷ 67,850 = 900%",
      prev: "67850",
      next: "678500",
      msg: "ราคาห่างจากครั้งก่อน 900.0% (67850 → 678500) — ตรวจสอบก่อนบันทึก",
    },
    {
      label: "หลักแรกผิด: 10,000 ÷ 67,850 = 14.738…%",
      prev: "67850",
      next: "57850",
      msg: "ราคาห่างจากครั้งก่อน 14.7% (67850 → 57850) — ตรวจสอบก่อนบันทึก",
    },
    {
      label: "เคสใน Django: 61,740 ÷ 68,600 = 90%",
      prev: "68600",
      next: "6860",
      msg: "ราคาห่างจากครั้งก่อน 90.0% (68600 → 6860) — ตรวจสอบก่อนบันทึก",
    },
  ])("$label", ({ prev, next, msg }) => {
    expect(typoWarning(prev, next)).toBe(msg);
  });

  it.each([
    { next: "10304", why: "3.04% ตัด 4 → ลง", msg: "ราคาห่างจากครั้งก่อน 3.0% (10000 → 10304) — ตรวจสอบก่อนบันทึก" },
    {
      next: "10305",
      why: "3.05% ตัด 5 → ขึ้น (HALF_EVEN ได้ 3.0)",
      msg: "ราคาห่างจากครั้งก่อน 3.1% (10000 → 10305) — ตรวจสอบก่อนบันทึก",
    },
    {
      next: "10306",
      why: "3.06% ตัด 6 → ขึ้น (ตัดทิ้งได้ 3.0)",
      msg: "ราคาห่างจากครั้งก่อน 3.1% (10000 → 10306) — ตรวจสอบก่อนบันทึก",
    },
    {
      next: "10325",
      why: "3.25% → 3.3 (HALF_EVEN ได้ 3.2)",
      msg: "ราคาห่างจากครั้งก่อน 3.3% (10000 → 10325) — ตรวจสอบก่อนบันทึก",
    },
    {
      next: "9695",
      why: "ขาลง 3.05% → แสดงเป็นบวก",
      msg: "ราคาห่างจากครั้งก่อน 3.1% (10000 → 9695) — ตรวจสอบก่อนบันทึก",
    },
  ])("10,000 → $next: $why", ({ next, msg }) => {
    expect(typoWarning("10000", next)).toBe(msg);
  });

  it.each([
    { label: "string", prev: "67850", next: "6785" },
    { label: "คอมมาหลักพัน", prev: "67,850", next: "6,785" },
    { label: 'แบบ api: DB "67850.00" + Decimal', prev: "67850.00", next: new Decimal("6785") }, // ก่อนหน้าจาก numeric(14,2) · ใหม่ = q.barSell
    { label: "number", prev: 67850, next: 6785 },
    { label: "Decimal", prev: new Decimal("67850"), next: new Decimal("6785") },
  ])("รับได้ทุกชนิด ($label) → ข้อความเดียวกัน", ({ prev, next }) => {
    expect(typoWarning(prev, next)).toBe("ราคาห่างจากครั้งก่อน 90.0% (67850 → 6785) — ตรวจสอบก่อนบันทึก");
  });
});

describe("typoWarning — ราคาต่อกรัมของเงิน/แพลตตินั่ม: คำนำหน้า + ราคามีสตางค์พิมพ์ 2 ตำแหน่ง (UAT 30 ก.ย. 2569)", () => {
  it.each([
    {
      label: "เงิน 45.50 → 4.55 (พิมพ์ตกหลัก): 40.95 ÷ 45.50 = 90%",
      prev: "45.50",
      next: "4.55",
      msg: "ราคาเงินห่างจากครั้งก่อน 90.0% (45.50 → 4.55) — ตรวจสอบก่อนบันทึก",
    },
    {
      label: "เงิน 45 → 50.50: 5.5 ÷ 45 = 12.22…% · ตัวเต็มบาทไม่มีทศนิยม ตัวมีสตางค์มี 2 ตำแหน่ง",
      prev: "45.00",
      next: "50.5",
      msg: "ราคาเงินห่างจากครั้งก่อน 12.2% (45 → 50.50) — ตรวจสอบก่อนบันทึก",
    },
  ])("$label", ({ prev, next, msg }) => {
    expect(typoWarning(prev, next, "3", "ราคาเงิน")).toBe(msg);
  });

  it("อยู่ในเกณฑ์ → null ไม่ว่าคำนำหน้าเป็นอะไร: 1,200 → 1,230 = 2.5%", () => {
    expect(typoWarning("1200", "1230", "3", "ราคาแพลตตินั่ม")).toBeNull();
  });

  it("ไม่ส่งคำนำหน้า = 'ราคา' (ข้อความเดิมของทอง ไม่เปลี่ยน)", () => {
    expect(typoWarning("67850", "6785", "3")).toBe("ราคาห่างจากครั้งก่อน 90.0% (67850 → 6785) — ตรวจสอบก่อนบันทึก");
  });
});

describe("typoWarning — เกณฑ์ปรับได้ (typo_guard_percent · รวมขอบทุกค่า)", () => {
  it.each([
    { label: 'เกณฑ์ "0" · ราคาเท่าเดิม', prev: "67850", next: "67850", guard: "0", outcome: "ผ่าน" },
    { label: 'เกณฑ์ "0" · ขยับ 1 สตางค์', prev: "67850", next: "67850.01", guard: "0", outcome: "เตือน" },
    { label: 'เกณฑ์ "0" · ลง 50 บาท', prev: "67850", next: "67800", guard: "0", outcome: "เตือน" },
    { label: 'เกณฑ์ "90" · ห่าง 90% พอดี', prev: "67850", next: "6785", guard: "90", outcome: "ผ่าน" },
    { label: 'เกณฑ์ "89.99" · ห่าง 90%', prev: "67850", next: "6785", guard: "89.99", outcome: "เตือน" },
    { label: 'เกณฑ์ "90.01" · ห่าง 90%', prev: "67850", next: "6785", guard: "90.01", outcome: "ผ่าน" },
    { label: 'เกณฑ์แบบ DB "3.00" · +3% พอดี', prev: "10000", next: "10300", guard: "3.00", outcome: "ผ่าน" },
    { label: 'เกณฑ์แบบ DB "3.00" · +3.0001%', prev: "10000", next: "10300.01", guard: "3.00", outcome: "เตือน" },
    { label: "เกณฑ์เป็น number 1 · ห่าง 1.69%", prev: "67850", next: "69000", guard: 1, outcome: "เตือน" },
    {
      label: "เกณฑ์เป็น Decimal 1 · ห่าง 1.69%",
      prev: "67850",
      next: "69000",
      guard: new Decimal(1),
      outcome: "เตือน",
    },
  ])("$label → $outcome", ({ prev, next, guard, outcome }) => {
    expect(guardOutcome(() => typoWarning(prev, next, guard))).toBe(outcome);
  });
});

describe("typoWarning — ค่าขยะต้องไม่ทำให้ด่านถูกข้ามเงียบ ๆ (fail closed)", () => {
  it.each([
    { label: 'ราคาก่อนหน้า "abc"', run: () => typoWarning("abc", "67850") },
    { label: 'ราคาก่อนหน้าว่าง ""', run: () => typoWarning("", "67850") },
    { label: 'ราคาก่อนหน้าเป็นช่องว่าง "   "', run: () => typoWarning("   ", "67850") },
    { label: 'ราคาใหม่ "abc"', run: () => typoWarning("67850", "abc") },
    { label: 'ราคาใหม่ว่าง ""', run: () => typoWarning("67850", "") },
    { label: 'ราคาใหม่ "67,85O" (ตัว O)', run: () => typoWarning("67850", "67,85O") },
    { label: 'เกณฑ์ "abc" · ราคาเท่าเดิม', run: () => typoWarning("67850", "67850", "abc") }, // ปกติราคาเท่าเดิม = ผ่าน
    { label: 'เกณฑ์ว่าง ""', run: () => typoWarning("67850", "67850", "") },
  ])("$label → throw", ({ run }) => {
    expect(guardOutcome(run)).toBe("throw");
  });

  // decimal.js parse "NaN"/"Infinity" ได้โดยไม่ throw — ข้อกำหนดคือด่านต้องไม่ "ผ่าน" (เตือนหรือ throw ก็ได้)
  it.each([
    { label: 'ราคาก่อนหน้า "NaN"', run: () => typoWarning("NaN", "67850") },
    { label: "ราคาก่อนหน้า NaN (number)", run: () => typoWarning(NaN, "67850") },
    { label: 'ราคาก่อนหน้า "Infinity"', run: () => typoWarning("Infinity", "67850") },
    { label: 'ราคาใหม่ "NaN"', run: () => typoWarning("67850", "NaN") },
    { label: 'ราคาใหม่ "Infinity"', run: () => typoWarning("67850", "Infinity") },
    { label: 'ราคาใหม่ "-Infinity"', run: () => typoWarning("67850", "-Infinity") },
    { label: 'เกณฑ์ "NaN" · ราคาเท่าเดิม', run: () => typoWarning("67850", "67850", "NaN") },
    { label: "เกณฑ์ NaN (number) · ราคาเท่าเดิม", run: () => typoWarning("67850", "67850", NaN) },
  ])("$label → ไม่ผ่านเงียบ ๆ", ({ run }) => {
    expect(guardOutcome(run)).not.toBe("ผ่าน");
  });
});

describe("deriveGoldPrice — ค่าตั้งจาก DB ที่ผิด ต้องหยุด", () => {
  it.each([
    [{ diff: "NaN", jewelryDiscount: "0.95" }],
    [{ diff: "Infinity", jewelryDiscount: "0.95" }],
    [{ diff: "-1", jewelryDiscount: "0.95" }],
    [{ diff: "200", jewelryDiscount: "NaN" }],
    [{ diff: "200", jewelryDiscount: "0" }],
    [{ diff: "200", jewelryDiscount: "1.5" }],
  ])("%j", (bad) => {
    expect(() => deriveGoldPrice("67850", { ...DEFAULT_GOLD_SETTING, ...bad })).toThrow(RangeError);
  });

  it("ค่าปกติยังได้ 67,850 → 67,650 → 64,268", () => {
    const q = deriveGoldPrice("67850", DEFAULT_GOLD_SETTING);
    expect([q.barBuy.toFixed(2), q.jewelryBuy.toFixed(0)]).toEqual(["67650.00", "64268"]);
  });
});

// ── ด่านค่าตั้ง (dev PR #68): ส่วนต่าง finite และ ≥ 0 · ส่วนลด finite และ 0 < ส่วนลด ≤ 1 — BVA ทุกขอบ · ข้อความตรงตัว ─────
// เดิมค่าตั้ง NaN/∞/ติดลบ ได้ราคาเพี้ยนออกไปเงียบ ๆ · ค่าที่คาดคิดมือ: รับซื้อ = 67,850 − ส่วนต่าง · รูปพรรณ = HALF_UP(รับซื้อ × ส่วนลด, 0)
const SETTING_ERROR = "ค่าตั้งราคาทองไม่ถูกต้อง (ส่วนต่าง / ส่วนลดทองรูปพรรณ)";

describe("deriveGoldPrice — ค่าตั้งที่อยู่บนขอบของช่วงที่รับ (BVA ฝั่งรับ)", () => {
  it.each([
    { label: "ส่วนต่าง 0 (ขอบล่างพอดี)", s: setting("0", "0.95"), barBuy: "67850", jewelryBuy: "64458" }, // 67,850 × 0.95 = 64,457.5 → 64,458
    { label: "ส่วนต่าง 0.00 แบบแถว DB", s: setting("0.00", "0.95"), barBuy: "67850", jewelryBuy: "64458" },
    { label: "ส่วนต่าง −0 (มีค่าเท่าศูนย์)", s: setting("-0", "0.95"), barBuy: "67850", jewelryBuy: "64458" },
    { label: "ส่วนลด 1 (ขอบบนพอดี) = รับซื้อเต็ม", s: setting("200", "1"), barBuy: "67650", jewelryBuy: "67650" },
    { label: "ส่วนลด 1.0000 แบบแถว DB", s: setting("200", "1.0000"), barBuy: "67650", jewelryBuy: "67650" },
    { label: "ส่วนลดบวกเล็กสุดของ numeric(6,4)", s: setting("200", "0.0001"), barBuy: "67650", jewelryBuy: "7" }, // 6.765 → 7
  ])("$label → รับซื้อ $barBuy · รูปพรรณ $jewelryBuy", ({ s, barBuy, jewelryBuy }) => {
    expect(exact(deriveGoldPrice("67850", s))).toStrictEqual({ barSell: "67850", barBuy, jewelryBuy });
  });
});

describe("deriveGoldPrice — ค่าตั้งนอกช่วง → RangeError ข้อความตรงตัว ไม่คืนราคา (BVA ฝั่งปฏิเสธ · EP ค่าไม่จำกัด)", () => {
  it.each([
    { label: "ส่วนต่างติดลบ 1 สตางค์", s: setting("-0.01", "0.95") },
    { label: "ส่วนต่างติดลบเล็กมาก −0.0000001", s: setting("-0.0000001", "0.95") },
    { label: "ส่วนต่าง NaN", s: setting("NaN", "0.95") },
    { label: "ส่วนต่าง Infinity", s: setting("Infinity", "0.95") },
    { label: "ส่วนต่าง −Infinity", s: setting("-Infinity", "0.95") },
    { label: "ส่วนลด 0 (ขอบล่าง ไม่รวม)", s: setting("200", "0") },
    { label: "ส่วนลดติดลบ", s: setting("200", "-0.95") },
    { label: "ส่วนลดเกิน 1 เล็กน้อย 1.0000001", s: setting("200", "1.0000001") },
    { label: "ส่วนลด 1.5", s: setting("200", "1.5") },
    { label: "ส่วนลด NaN", s: setting("200", "NaN") },
    { label: "ส่วนลด Infinity", s: setting("200", "Infinity") },
    { label: "number NaN", s: setting(Number.NaN, 0.95) },
    { label: "Decimal Infinity", s: setting(new Decimal(Infinity), "0.95") },
  ])("$label → RangeError", ({ s }) => {
    const e = thrownBy(() => deriveGoldPrice("67850", s));
    expect(e).toBeInstanceOf(RangeError);
    expect(e).toHaveProperty("message", SETTING_ERROR);
  });

  it("ราคาขายออกผิดถูกตรวจก่อนค่าตั้ง — ผิดทั้งคู่ได้ข้อความของราคา", () => {
    const e = thrownBy(() => deriveGoldPrice("0", setting("NaN", "0")));
    expect(e).toBeInstanceOf(RangeError);
    expect(e).toHaveProperty("message", BAR_SELL_ERROR);
  });
});
