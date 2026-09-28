import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { D, ZERO, floorTo, fmtInt, fmtMoney, fmtWeight, halfUp, isBlank, parseDecimal } from "./money";

// money.ts ทั้งไฟล์ — ค่าที่คาดหวังทุกตัวคิดมือจากสเปก §8 (R3 · R8 · R10) ใบจริง กระดานราคา และนิยามโหมดปัด
// (IEEE 754-2019 §4.3) ไม่ได้คัดลอกจากผลรัน · เทคนิคออกแบบเทสต์ (ISO/IEC/IEEE 29119-4) ระบุไว้ที่ชื่อแต่ละ describe

/**
 * oracle ค่า Decimal แบบเป๊ะ: toFixed() ที่ไม่ใส่ dp = ไม่ปัด และไม่เป็น e-notation
 * ห้ามใช้ toFixed(dp) — มันปัด HALF_UP เอง จะบังขั้นปัดที่หายไปหรือผิดโหมด
 * decimal.js เก็บค่า ไม่เก็บ scale (1.00 คือ 1) จึงเทียบผ่าน new Decimal(expected) — เขียน "1.00" ให้อ่านง่ายได้
 */
function expectDecimal(actual: Decimal | null, expected: string): void {
  expect(actual).toBeInstanceOf(Decimal);
  expect(actual?.toFixed()).toBe(new Decimal(expected).toFixed());
}

// ข้อความไม่ว่างที่ไม่ใช่ตัวเลข — error guessing จากความผิดพลาดที่หน้าร้าน
const NOT_A_NUMBER = [
  ",", // ถอดคอมมาแล้วว่าง
  "-",
  ".",
  "abc",
  "12abc", // parseFloat ได้ 12 — ต้องไม่รับครึ่ง ๆ กลาง ๆ
  "67,85O", // พิมพ์ตัว O แทนเลขศูนย์
  "๖๗๘๕๐", // เลขไทย
  "67 850", // เว้นวรรคแทนคอมมา — ไม่เดาให้
  "1.2.3", // parseFloat ได้ 1.2
  "฿100",
  "100 บาท",
];

describe("D — แปลงแบบเข้มงวด ผิดรูป = throw (แบ่งกลุ่มตามชนิดข้อมูล · syntax testing · error guessing)", () => {
  it("Decimal → คืนตัวเดิม ไม่คัดลอก (Decimal เป็น immutable)", () => {
    const x = new Decimal("5.86");
    expect(D(x)).toBe(x);
  });

  it.each<[number, string]>([
    [20030, "20030"],
    [5.86, "5.86"],
    [-970, "-970"],
    [0, "0"],
  ])("number %s → %s", (input, expected) => {
    expectDecimal(D(input), expected);
  });

  it("number ที่ติด error ของ float มา: 0.1 + 0.2 → 0.30000000000000004 — D ไม่ซ่อมให้ (กฎ 1: เงินต้องมาเป็น string)", () => {
    // IEEE 754 double: 0.1 + 0.2 = 0.3000000000000000444… · Number#toString แบบสั้นสุดที่ย้อนกลับได้ = 0.30000000000000004
    expectDecimal(D(0.1 + 0.2), "0.30000000000000004");
  });

  it.each<[string, string]>([
    ["20030", "20030"],
    ["5.860", "5.86"],
    ["-970.00", "-970"],
    ["0", "0"],
    ["67,850", "67850"], // คอมมาแบบที่ร้านพิมพ์ราคาทอง
    ["1,234,567.89", "1234567.89"], // ถอดคอมมาทุกตัว ไม่ใช่แค่ตัวแรก
    [" 67850 ", "67850"],
    ["\t5.860\n", "5.86"],
    ["  67,850  ", "67850"], // คอมมาและช่องว่างพร้อมกัน
  ])("string %j → %s", (input, expected) => {
    expectDecimal(D(input), expected);
  });

  it.each(["", "   ", ...NOT_A_NUMBER])("ผิดรูป %j → throw", (v) => {
    expect(() => D(v)).toThrow();
  });
});

describe("isBlank — ว่าง = ไม่มีค่า หรือ string ที่มีแต่ช่องว่าง (แบ่งกลุ่มสมมูล)", () => {
  it.each([undefined, null])("%s → ว่าง", (v) => {
    expect(isBlank(v)).toBe(true);
  });

  it.each(["", "   ", "\t", "\r\n", " \t\n "])("string %j → ว่าง", (v) => {
    expect(isBlank(v)).toBe(true);
  });

  it("NBSP (U+00A0) อย่างเดียว → ว่าง — String#trim ตัดให้ (มักติดมาเวลาคัดลอกจากเว็บหรือ Excel)", () => {
    expect(isBlank("\u00a0")).toBe(true);
  });

  it.each(["0", " 0 ", "abc", ","])("string %j → ไม่ว่าง", (v) => {
    expect(isBlank(v)).toBe(false);
  });

  // ไม่ใช่ string และไม่ใช่ null/undefined — รวมกับดัก falsy (0 · -0 · NaN · false · 0n): ถ้าเขียน !v ตัวเลข 0 จะกลายเป็น "ไม่ได้กรอก"
  it.each<[string, unknown]>([
    ["number 0", 0],
    ["number -0", -0],
    ["NaN", NaN],
    ["false", false],
    ["bigint 0n", 0n],
    ["{}", {}],
    ["[]", []],
    ["Decimal 0", new Decimal(0)],
  ])("%s → ไม่ว่าง", (_label, v) => {
    expect(isBlank(v)).toBe(false);
  });
});

describe("parseDecimal — ค่าที่ผู้ใช้กรอก ไม่ throw ใช้ไม่ได้ = null (ตารางตัดสินใจ · MC/DC ของด่านชนิดข้อมูล)", () => {
  // | กฎ | ว่าง | ชนิด string/number/Decimal | D() throw | finite | ผล      |
  // | R1 | ใช่  | –                          | –         | –      | null    |
  // | R2 | ไม่  | ไม่                        | –         | –      | null    |
  // | R3 | ไม่  | ใช่                        | ใช่       | –      | null    |
  // | R4 | ไม่  | ใช่                        | ไม่       | ไม่    | null    |
  // | R5 | ไม่  | ใช่                        | ไม่       | ใช่    | Decimal |
  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ['""', ""],
    ["ช่องว่าง แท็บ ขึ้นบรรทัด", "  \t\n"],
  ])("R1 ว่าง: %s → null", (_label, v) => {
    expect(parseDecimal(v)).toBeNull();
  });

  // MC/DC ของด่านชนิดข้อมูล: string · number · Decimal ผ่าน (แถว R5 ทีละชนิด) ชนิดอื่นตกหมด (แถวนี้)
  // ชนิดทั่วไปจาก JSON (boolean · object · array) ต่อให้ไม่มีด่าน D() ก็ throw TypeError ที่ .replace แล้วตก catch อยู่ดี
  // String object มี .replace/.trim เหมือน string — จึงเป็นแถวเดียวที่ผลเปลี่ยน (ได้ 5.86) ถ้าด่านนี้หายไป
  it.each<[string, unknown]>([
    ["true", true],
    ["false", false],
    ["bigint 5n", 5n],
    ["{}", {}],
    ["[]", []],
    ['["5.86"]', ["5.86"]],
    ['String object "5.86"', Object("5.86") as unknown],
  ])("R2 ชนิดอื่น: %s → null", (_label, v) => {
    expect(parseDecimal(v)).toBeNull();
  });

  it.each(NOT_A_NUMBER)("R3 ผิดรูป: %j → null ไม่ throw", (v) => {
    expect(parseDecimal(v)).toBeNull();
  });

  it.each<[string, unknown]>([
    ['"NaN"', "NaN"],
    ['"Infinity"', "Infinity"],
    ['"-Infinity"', "-Infinity"],
    ['" Infinity " มีช่องว่าง', " Infinity "],
    ["number NaN", NaN],
    ["number Infinity", Infinity],
    ["number -Infinity", -Infinity],
    ["Decimal NaN", new Decimal(NaN)],
    ["Decimal -Infinity", new Decimal(-Infinity)],
  ])("R4 ไม่ใช่จำนวนจำกัด: %s → null", (_label, v) => {
    expect(parseDecimal(v)).toBeNull();
  });

  it.each<[string, string, unknown]>([
    ['"5.860"', "5.86", "5.860"],
    ['"67,850"', "67850", "67,850"],
    ['" 20,030.00 "', "20030", " 20,030.00 "],
    ['"-1" (ค่าลบผ่าน — กฎ > 0 เป็นของผู้เรียก R3)', "-1", "-1"],
    ["number 5.86", "5.86", 5.86],
    ['Decimal "3418.09"', "3418.09", new Decimal("3418.09")],
  ])("R5 ใช้ได้: %s → %s", (_label, expected, v) => {
    expectDecimal(parseDecimal(v), expected);
  });

  it.each<[string, unknown]>([
    ['"0"', "0"],
    ['"0.00"', "0.00"],
    ["number 0", 0],
    ["Decimal 0", new Decimal(0)],
  ])("%s → Decimal ศูนย์ ไม่ใช่ null — quoteBuy แยก !w (ไม่ได้กรอก) ออกจาก w.lte(0) (ไม่เป็นบวก)", (_label, v) => {
    const w = parseDecimal(v);
    expect(w).not.toBeNull();
    expectDecimal(w, "0");
    expect(w?.lte(0)).toBe(true);
  });
});

describe("halfUp — ปัดครึ่งขึ้น เสมอกันแล้วหนีศูนย์ (ค่าขอบ …4/…5/…6 · ตัวแยกโหมด HALF_EVEN และ Math.round)", () => {
  // สเปก §8: เงิน/ราคาต่อกรัม HALF_UP 2 ตำแหน่ง · ราคาทองรูปพรรณ HALF_UP 0 ตำแหน่ง (R8) — decimal.js ROUND_HALF_UP
  it.each<[string, string]>([
    ["1.004", "1.00"], // หลักที่ถูกตัด 4 → ลง
    ["1.0049", "1.00"], // ต่ำกว่าครึ่ง — ถ้าปัดสองทอด (1.0049 → 1.005 → 1.01) จะผิด
    ["1.005", "1.01"], // เสมอ → ขึ้น
    ["1.006", "1.01"],
    ["1.025", "1.03"], // HALF_EVEN ได้ 1.02
    ["0.125", "0.13"], // 1 ÷ 8 ใน buy.test · HALF_EVEN ได้ 0.12
    ["0.995", "1.00"], // ทดเข้าหลักหน่วย
    ["999999999999.995", "1000000000000.00"], // สูงสุดของ numeric(14,2) + ครึ่ง → ทดผ่านเลข 9 ทั้ง 12 หลัก
    ["1.23", "1.23"], // ลงตัวแล้ว ไม่เปลี่ยน
    ["20030", "20030.00"],
    ["0", "0.00"],
    ["-1.004", "-1.00"],
    ["-1.005", "-1.01"], // เสมอ → หนีศูนย์ · HALF_CEIL และ Math.round ได้ -1.00
    ["-1.006", "-1.01"],
    ["-0.004", "0.00"], // ลบที่ปัดแล้วเป็นศูนย์ มีค่าเท่าศูนย์
    ["-970.5", "-970.50"], // ลบที่ลงตัวแล้ว ไม่เปลี่ยน
  ])("2 ตำแหน่ง: %s → %s", (input, expected) => {
    expectDecimal(halfUp(new Decimal(input), 2), expected);
  });

  it.each<[string, string]>([
    ["0.4", "0"],
    ["0.5", "1"], // HALF_EVEN ได้ 0
    ["2.5", "3"], // HALF_EVEN ได้ 2
    ["64267.5", "64268"], // กระดานราคาจริง 27 ก.ย. 2569: 67,650 × 0.95 = 64,267.50
    ["64248.5", "64249"], // 67,630 × 0.95 = 64,248.50 · HALF_EVEN ได้ 64,248
    ["-0.4", "0"],
    ["-0.5", "-1"], // Math.round ได้ -0
    ["-2.5", "-3"], // Math.round และ HALF_EVEN ได้ -2
  ])("0 ตำแหน่ง: %s → %s", (input, expected) => {
    expectDecimal(halfUp(new Decimal(input), 0), expected);
  });

  it("ปัดก่อนแล้วค่อย format แบบ buy.ts: -0.004 → 0.00 ไม่ใช่ -0.00", () => {
    expect(fmtMoney(halfUp(new Decimal("-0.004"), 2))).toBe("0.00");
  });

  it("ไม่แก้ค่าตัวตั้ง (คืน Decimal ตัวใหม่)", () => {
    const v = new Decimal("1.005");
    expectDecimal(halfUp(v, 2), "1.01");
    expectDecimal(v, "1.005");
  });
});

describe("floorTo — ปัดลงเข้าหา −∞ (ต้นทุน/กรัม โหมดประเมิน R10 · §8 FLOOR 2 · ยังไม่มีโค้ดเรียก เทสต์นี้คือด่านเดียว)", () => {
  it.each<[string, string]>([
    ["1.004", "1.00"],
    ["1.005", "1.00"], // HALF_UP ได้ 1.01
    ["1.006", "1.00"],
    ["1.009", "1.00"],
    ["1.0099", "1.00"], // ต่ำกว่าขั้นถัดไปนิดเดียว
    ["1.01", "1.01"], // ตรงขั้นพอดี ไม่เปลี่ยน
    ["1.0101", "1.01"],
    ["1.23", "1.23"],
    ["0.009", "0.00"],
    ["0", "0.00"],
    ["-0.001", "-0.01"], // ลบนิดเดียว → −0.01 ไม่ใช่ 0
    ["-1.001", "-1.01"], // เข้าหา −∞ · ตัดทิ้ง (ROUND_DOWN / trunc) ได้ -1.00
    ["-1.005", "-1.01"],
    ["-1.009", "-1.01"],
    ["-1.01", "-1.01"], // ลบที่ลงตัวแล้ว ต้องไม่ลดอีกขั้น
  ])("2 ตำแหน่ง: %s → %s", (input, expected) => {
    expectDecimal(floorTo(new Decimal(input), 2), expected);
  });

  it("ค่าจากใบจริง 20,030 ÷ 5.860 = 3,418.0887…: floorTo 3,418.08 ≠ halfUp 3,418.09 — ใช้สลับกันแล้วต่าง 1 สตางค์", () => {
    // 5.86 × 3,418 = 20,029.48 → เหลือ 0.52 ÷ 5.86 = 0.0887… · หลักที่สาม 8 ≥ 5 → halfUp ขึ้น · floor ลงเสมอ
    const perGram = new Decimal("20030").div(new Decimal("5.860"));
    expectDecimal(floorTo(perGram, 2), "3418.08");
    expectDecimal(halfUp(perGram, 2), "3418.09");
  });

  it("ไม่แก้ค่าตัวตั้ง (คืน Decimal ตัวใหม่)", () => {
    const v = new Decimal("-1.001");
    expectDecimal(floorTo(v, 2), "-1.01");
    expectDecimal(v, "-1.001");
  });
});

describe("halfUp · floorTo — ตรวจตามนิยามโหมดปัด ทุกค่า 3 ตำแหน่งใน [−2.000, 2.000] (property แบบกำหนดแน่นอน)", () => {
  // 4,001 ค่า ครอบหลักที่ถูกตัด 0–9 ทั้งฝั่งบวก ลบ และศูนย์ · จำนวนเต็ม ÷ 1000 ด้วย Decimal (หารลงตัว ไม่ผ่าน float)
  const grid = Array.from({ length: 4001 }, (_, i) => new Decimal(i - 2000).div(1000));
  const step = new Decimal("0.01");
  const halfStep = new Decimal("0.005");

  it("halfUp(x, 2) ตรงนิยาม roundTiesToAway: ทศนิยม ≤ 2 · |r − x| ≤ 0.005 · ห่างเท่ากันพอดีต้องได้ |r| > |x|", () => {
    const wrong: string[] = [];
    let ties = 0;
    for (const x of grid) {
      const r = halfUp(x, 2);
      const gap = r.minus(x).abs();
      const tie = gap.eq(halfStep);
      if (tie) ties += 1;
      if (r.decimalPlaces() > 2 || gap.gt(halfStep) || (tie && r.abs().lte(x.abs()))) {
        wrong.push(`${x.toFixed()} → ${r.toFixed()}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(ties).toBe(400); // ±0.005, ±0.015, …, ±1.995 ฝั่งละ 200 — กันเทสต์ผ่านลอย ๆ เพราะกริดไม่มีกรณีเสมอ
  });

  it("floorTo(x, 2) ตรงนิยาม roundTowardNegative: ทศนิยม ≤ 2 · r ≤ x · x − r < 0.01", () => {
    const wrong: string[] = [];
    for (const x of grid) {
      const r = floorTo(x, 2);
      if (r.decimalPlaces() > 2 || r.gt(x) || x.minus(r).gte(step)) wrong.push(`${x.toFixed()} → ${r.toFixed()}`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("fmtMoney · fmtWeight · fmtInt — string ทศนิยมคงที่ 2 · 3 · 0 ที่ API ส่งออก (ค่าขอบ · plain notation)", () => {
  it.each<[string, string]>([
    ["5", "5.00"], // เติมศูนย์
    ["5.8", "5.80"],
    ["20030", "20030.00"], // ไม่ใส่คอมมา — จัดรูปแบบเป็นหน้าที่ของจอ (Intl.NumberFormat)
    ["1234567.891", "1234567.89"],
    ["1.004", "1.00"],
    ["1.0049", "1.00"], // ไม่ปัดสองทอด
    ["1.005", "1.01"], // ถ้าผ่าน number จะได้ "1.00": (1.005).toFixed(2)
    ["1.006", "1.01"],
    ["1.025", "1.03"], // HALF_EVEN ได้ 1.02
    ["0.995", "1.00"],
    ["0", "0.00"],
    ["0.004", "0.00"],
    ["0.005", "0.01"],
    ["0.0000001", "0.00"], // Decimal#toString ได้ "1e-7"
    ["-970", "-970.00"], // ชำระเกิน: 20,030 − 21,000
    ["-1.005", "-1.01"], // เสมอ → หนีศูนย์
    ["1000000000000000000000", "1000000000000000000000.00"], // Number#toFixed ได้ "1e+21"
  ])("fmtMoney %s → %s", (input, expected) => {
    expect(fmtMoney(new Decimal(input))).toBe(expected);
  });

  // สเปก §8: น้ำหนักไม่ปัด (R3 รับ ≤ 3 ตำแหน่งตั้งแต่ต้น) — แถวที่เกิน 3 ตำแหน่งคือด่านสำรอง ปัดแบบเดียวกับเงิน (HALF_UP)
  // ตรงกับจอระบบเดิมที่แสดงน้ำหนักด้วย toLocaleString (สูงสุด 3 ตำแหน่ง) ซึ่งปัดแบบ halfExpand = HALF_UP
  it.each<[string, string]>([
    ["5.86", "5.860"], // น้ำหนักบนใบจริง
    ["5", "5.000"],
    ["0.001", "0.001"], // ขั้นเล็กสุดที่ R3 รับ
    ["1.0004", "1.000"],
    ["1.0005", "1.001"],
    ["1.0025", "1.003"], // HALF_EVEN ได้ 1.002
    ["0.9995", "1.000"],
    ["0", "0.000"],
    ["0.0000001", "0.000"],
    ["-5.86", "-5.860"],
    ["1000000000000000000000", "1000000000000000000000.000"],
  ])("fmtWeight %s → %s", (input, expected) => {
    expect(fmtWeight(new Decimal(input))).toBe(expected);
  });

  it.each<[string, string]>([
    ["64268", "64268"],
    ["64267.5", "64268"], // กระดานราคาจริง
    ["64248.5", "64249"], // HALF_EVEN ได้ 64248
    ["0.4", "0"],
    ["0.5", "1"],
    ["2.5", "3"],
    ["0", "0"],
    ["-95", "-95"],
    ["-2.5", "-3"],
    ["1000000000000000000000", "1000000000000000000000"],
  ])("fmtInt %s → %s", (input, expected) => {
    expect(fmtInt(new Decimal(input))).toBe(expected);
  });
});

describe("ZERO — ค่าเริ่มของยอดสะสม", () => {
  it("เป็น Decimal ศูนย์ · format เป็น 0.00 / 0.000 (ยอดของบิลที่ยังไม่มีรายการ)", () => {
    expectDecimal(ZERO, "0");
    expect(fmtMoney(ZERO)).toBe("0.00");
    expect(fmtWeight(ZERO)).toBe("0.000");
  });

  it("สะสมยอดแบบ quoteBuy แล้ว ZERO ยังเป็นศูนย์ — plus คืนตัวใหม่ ไม่แก้ตัวเดิม", () => {
    let total = ZERO;
    for (const amount of ["20030", "3000.50"]) total = total.plus(new Decimal(amount));
    expectDecimal(total, "23030.50"); // 20,030 + 3,000.50
    expect(total).not.toBe(ZERO);
    expectDecimal(ZERO, "0");
  });
});
