import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  BUY_MSG,
  MAX_LINE_AMOUNT,
  MAX_LINE_WEIGHT_G,
  PAYMENT_METHODS,
  avgPricePerG,
  isPaymentMethod,
  normalizeBuyLine,
  pricePerGram,
  quoteBuy,
  type BuyLineInput,
  type BuyMetal,
  type PaymentInput,
  type PaymentMethod,
  type QuoteBuyInput,
  type QuoteBuyResult,
  type QuoteError,
  type QuotedLine,
  type QuotedPayment,
} from "./buy";
import type { CardStatus } from "./card";

// ออกแบบตาม ISO/IEC/IEEE 29119-4: ตารางตัดสินใจ (ด่านก่อนเปิดบิล · โลหะ × ราคาของวัน × ราคาทอง R7 · ช่องต่อแถว ·
// วิธีชำระซ้ำ) · แบ่งกลุ่มสมมูล + ค่าขอบ (น้ำหนัก · ค่าบริสุทธิ์ · หัก % · ยอดที่ปัดลงเหลือ 0 · เพดาน · ยอดชำระ · คงเหลือ ·
// หลักที่ถูกตัด …4/…5/…6 และ …99) · เดาข้อผิดพลาด (ว่าง · เว้นวรรค · ตัวอักษร · เลขไทย · NaN/Infinity · กับดัก float ·
// key ของ prototype · ราคาที่ client ส่งมาเอง) — ค่าคาดหวังทุกตัวคิดมือจากสเปก R1–R7 · §8 และสูตรรับซื้อที่อนุมัติ 2 ต.ค. 2569
// (Django engine.py · ปัดลงเป็นบาทเต็มทุกขั้น):
//   ราคา/กรัม = ⌊ฐาน × (0.0656 เฉพาะทอง/นาก) × บริสุทธิ์ ÷ 100⌋ → ยอดก่อนหัก = ⌊ราคา/กรัม × กรัม⌋
//   → สุทธิ = ⌊ยอดก่อนหัก × (100 − หัก) ÷ 100⌋ · เงินหัก = ยอดก่อนหัก − สุทธิ · ราคา/กรัม (แสดง) = สุทธิ ÷ กรัม HALF_UP 2
// ไม่ได้คัดค่าจากผลรันโค้ด

const GOLD = "11111111-1111-1111-1111-111111111111";
const SILVER = "22222222-2222-2222-2222-222222222222";
const NAK = "33333333-3333-3333-3333-333333333333";
const PLATINUM = "44444444-4444-4444-4444-444444444444";
const UNKNOWN = "99999999-9999-9999-9999-999999999999";

// ราคาของวันในตัวอย่าง: ทองแท่งรับซื้อ 67,650 บาท/บาททอง (ทองกับนากใช้ราคาเดียวกัน) · เงิน 45 บาท/กรัม ·
// แพลตตินั่ม 1,000 บาท/กรัม — รูปเดียวกับที่ api ส่ง (key = metal id · ราคาเป็น string จาก numeric)
const METALS: Readonly<Record<string, BuyMetal>> = {
  [GOLD]: { code: "gold", nameTh: "ทอง", basePrice: "67650.00" },
  [NAK]: { code: "nak", nameTh: "นาก", basePrice: "67650.00" },
  [SILVER]: { code: "silver", nameTh: "เงิน", basePrice: "45.00" },
  [PLATINUM]: { code: "platinum", nameTh: "แพลตตินั่ม", basePrice: "1000.00" },
};

/** ราคาของวันชุดเดิม เปลี่ยนราคาเฉพาะโลหะที่ระบุ (null = ยังไม่ได้ตั้ง) */
function withBase(over: Record<string, string | null>): Record<string, BuyMetal> {
  const metals: Record<string, BuyMetal> = { ...METALS };
  for (const [id, basePrice] of Object.entries(over)) {
    const metal = METALS[id];
    if (!metal) throw new Error(`ไม่มีโลหะ ${id} ใน METALS`);
    metals[id] = { ...metal, basePrice };
  }
  return metals;
}

/** แถวบิลตัวอย่าง: ทอง 96.5% 10 กรัม หัก 3% */
const sample = (over: Partial<BuyLineInput> = {}): BuyLineInput => ({
  metalId: GOLD,
  weightG: "10",
  purityPercent: "96.5",
  deductPercent: "3",
  ...over,
});
// แถว "ราคาเรียบ" สำหรับเทสต์ที่ไม่ได้ทดสอบสูตร: แพลตตินั่ม (คิดต่อกรัม) บริสุทธิ์ 100 ไม่หัก → ยอด = ⌊ฐาน × กรัม⌋
// ตั้งฐานด้วย flatAt() — ฐาน 100 กับ 1 กรัม = 100 บาทพอดี · ฐาน 1 = ยอดเท่ากับกรัมที่ปัดลง
const flat = (weightG: string, deductPercent = "0"): BuyLineInput => ({
  metalId: PLATINUM,
  weightG,
  purityPercent: "100",
  deductPercent,
});
const flatAt = (basePrice: string) => withBase({ [PLATINUM]: basePrice });

const cash = (amount: string): PaymentInput => ({ method: "cash", amount });
const transfer = (bank: string, amount: string): PaymentInput => ({ method: "transfer", bank, amount });
const card = (cardStatus: CardStatus) => ({ id: "c1", cardStatus });
const err = (field: string, message: string): QuoteError => ({ field, message });

function base(over: Partial<QuoteBuyInput> = {}): QuoteBuyInput {
  return {
    lines: [sample()],
    payments: [cash("41535")],
    customer: { id: "c1", cardStatus: "ok" },
    goldPriceSet: true,
    metals: METALS,
    ...over,
  };
}

// แถวชำระที่ quoteBuy คืนใน result.payments: index = ตำแหน่งใน input · ไม่มีธนาคาร = null · เงินรูป 2 ตำแหน่ง
const payRow = (index: number, method: PaymentMethod, amount: string, bank: string | null = null): QuotedPayment => ({
  index,
  method,
  bank,
  amount,
});

/**
 * แถวสินค้าที่ quoteBuy คืน — [กรัม, บริสุทธิ์, หัก] ที่ทำเป็นรูปมาตรฐาน ·
 * [ฐาน, ราคา/กรัม, ยอดก่อนหัก, เงินหัก, สุทธิ, ราคา/กรัม (แสดง)] เรียงตามขั้นของสูตร
 */
function row(
  index: number,
  metalId: string,
  [weightG, purityPercent, deductPercent]: [string, string, string],
  [basePrice, unitPrice, grossAmount, deductAmount, amount, pricePerG]: [
    string,
    string,
    string,
    string,
    string,
    string,
  ],
): QuotedLine {
  return {
    index,
    metalId,
    weightG,
    purityPercent,
    deductPercent,
    basePrice,
    unitPrice,
    grossAmount,
    deductAmount,
    amount,
    pricePerG,
  };
}
/** แถว flat: ฐาน = ราคา/กรัม (ฐานเป็นเลขเต็ม) · ไม่หัก → ยอดก่อนหัก = สุทธิ */
const flatRow = (index: number, weightG: string, basePrice: string, amount: string, pricePerG: string) =>
  row(index, PLATINUM, [weightG, "100.00", "0"], [basePrice, basePrice, amount, "0.00", amount, pricePerG]);

/** บิลแถวเดียวที่ชำระเงินสดเท่ายอดพอดี — แถวเดียว: ยอดรวม/น้ำหนักรวม/ราคาเฉลี่ย = ของแถวนั้น */
const paidInFull = (l: QuotedLine): QuoteBuyResult => ({
  ok: true,
  errors: [],
  lines: [l],
  payments: [payRow(0, "cash", l.amount)],
  totalWeight: l.weightG,
  totalAmount: l.amount,
  avgPricePerG: l.pricePerG,
  paid: l.amount,
  balance: "0.00",
});

// บิลตัวอย่างที่คิดมือ (อนุมัติ 2 ต.ค. 2569): ทองแท่งรับซื้อ 67,650 · ทอง 96.5% · 10 กรัม · หัก 3%
// ราคา/กรัม = ⌊67,650 × 0.0656 × 96.5 ÷ 100⌋ = ⌊4,437.84 × 0.965⌋ = ⌊4,282.5156⌋ = 4,282
// ยอดก่อนหัก = ⌊4,282 × 10⌋ = 42,820 · สุทธิ = ⌊42,820 × 97 ÷ 100⌋ = ⌊41,535.4⌋ = 41,535 · เงินหัก = 1,285
// ราคา/กรัม (แสดง) = 41,535 ÷ 10 = 4,153.50
const SAMPLE_LINE = row(
  0,
  GOLD,
  ["10.000", "96.50", "3"],
  ["67650.00", "4282.00", "42820.00", "1285.00", "41535.00", "4153.50"],
);
// ผลของ base(): บิลตัวอย่างชำระเงินสดครบ
const SAMPLE_OK = paidInFull(SAMPLE_LINE);
// เงิน 45.00/กรัม · 92.5% · 271.56 กรัม · ไม่หัก: ราคา/กรัม = ⌊45 × 0.925⌋ = ⌊41.625⌋ = 41 (ต่อกรัม ไม่คูณ 0.0656)
// ยอด = ⌊41 × 271.56⌋ = ⌊11,133.96⌋ = 11,133 · ราคา/กรัม (แสดง) = 11,133 ÷ 271.56 = 40.9964… → 41.00
const SILVER_LINE = row(
  0,
  SILVER,
  ["271.560", "92.50", "0"],
  ["45.00", "41.00", "11133.00", "0.00", "11133.00", "41.00"],
);
const silver = (over: Partial<BuyLineInput> = {}): BuyLineInput => ({
  metalId: SILVER,
  weightG: "271.56",
  purityPercent: "92.5",
  deductPercent: "0",
  ...over,
});

// ไม่มีแถวที่ใช้ได้และไม่มีการชำระ — ตัวเลขทุกช่องยังออกสเกลคงที่ (น้ำหนัก 3 · เงิน 2)
// น้ำหนักรวม 0 → ราคาเฉลี่ย/กรัม 0.00 (ไม่หารด้วยศูนย์)
const NOTHING_COUNTED = {
  lines: [],
  payments: [],
  totalWeight: "0.000",
  totalAmount: "0.00",
  avgPricePerG: "0.00",
  paid: "0.00",
  balance: "0.00",
};
/** แถวเดียวที่ผิดเฉพาะช่องที่ทดสอบ · ไม่มีการชำระ → ข้อผิดมีข้อเดียว และไม่มีอะไรถูกนับ */
const onlyError = (field: string, message: string): QuoteBuyResult => ({
  ok: false,
  errors: [err(field, message)],
  ...NOTHING_COUNTED,
});

describe("quoteBuy — บิลตัวอย่างที่คิดมือ (สูตรอนุมัติ 2 ต.ค. 2569)", () => {
  it("ทองแท่งรับซื้อ 67,650 · ทอง 96.5% · 10 กรัม · หัก 3% → ราคา/กรัม 4,282 · ยอด 42,820 · หัก 1,285 · จ่าย 41,535.00", () => {
    // ทั้งก้อน: ไม่มีฟิลด์เกิน/ขาด · ตัวเลขทุกช่องเป็น string สเกลคงที่
    expect(quoteBuy(base())).toStrictEqual(SAMPLE_OK);
  });

  it("ทอง 100% 10 กรัม ไม่หัก → ราคา/กรัม ⌊4,437.84⌋ = 4,437 · ยอด 44,370.00", () => {
    const want = row(
      0,
      GOLD,
      ["10.000", "100.00", "0"],
      ["67650.00", "4437.00", "44370.00", "0.00", "44370.00", "4437.00"],
    );
    expect(
      quoteBuy(base({ lines: [sample({ purityPercent: "100", deductPercent: "0" })], payments: [cash("44370")] })),
    ).toStrictEqual(paidInFull(want));
  });

  it("เงิน 45.00/กรัม · 92.5% · 271.56 กรัม → ราคา/กรัม 41 (41.625) · ยอด 11,133 (11,133.96 ปัดลง)", () => {
    expect(quoteBuy(base({ lines: [silver()], payments: [cash("11133")] }))).toStrictEqual(paidInFull(SILVER_LINE));
  });

  it("นากคิดแบบทอง (ราคาทองแท่งรับซื้อ × 0.0656) → ตัวเลขเท่าบิลตัวอย่าง", () => {
    expect(quoteBuy(base({ lines: [sample({ metalId: NAK })] }))).toStrictEqual(
      paidInFull({ ...SAMPLE_LINE, metalId: NAK }),
    );
  });

  it("หลายโลหะ: metalId ส่งผ่านตรงตัว · แถวเรียงตามที่กรอก · ยอดรวม 41,535 + 11,133 = 52,668.00", () => {
    expect(quoteBuy(base({ lines: [sample(), silver()], payments: [cash("52668")] }))).toStrictEqual({
      ok: true,
      errors: [],
      lines: [SAMPLE_LINE, { ...SILVER_LINE, index: 1 }],
      payments: [payRow(0, "cash", "52668.00")],
      totalWeight: "281.560", // 10 + 271.56
      totalAmount: "52668.00",
      // ถ่วงด้วยน้ำหนัก: 52,668 ÷ 281.56 = 187.0578… → 187.06 (ไม่ใช่ค่าเฉลี่ยตรง ๆ ของ 4,153.50 กับ 41.00)
      avgPricePerG: "187.06",
      paid: "52668.00",
      balance: "0.00",
    });
  });

  it("ราคาที่ client ส่งมาเอง (ฟิลด์ amount ของสัญญาเดิม) ถูกเมิน — ยอดมาจากสูตรเท่านั้น", () => {
    const legacy = { ...sample(), amount: "1", pricePerG: "0.10" } as BuyLineInput;
    expect(quoteBuy(base({ lines: [legacy] }))).toStrictEqual(SAMPLE_OK);
  });
});

describe("quoteBuy — สูตรปัดลง (FLOOR) ทุกขั้น · ทอง/นากคูณ 0.0656 · ต่อกรัมไม่คูณ", () => {
  // ทุกแถวชำระเท่ายอดพอดี → ok · แถวที่ได้คือแถวเดียวในบิล
  const FORMULA: { label: string; metals?: Record<string, BuyMetal>; line: BuyLineInput; want: QuotedLine }[] = [
    {
      // 67,759 × 0.0656 = 4,444.9904 → 4,444 (HALF_UP จะได้ 4,445)
      label: "…99 ที่ขั้นราคา/กรัม (ทอง): ⌊4,444.9904⌋ = 4,444",
      metals: withBase({ [GOLD]: "67759.00" }),
      line: sample({ weightG: "1", purityPercent: "100", deductPercent: "0" }),
      want: row(0, GOLD, ["1.000", "100.00", "0"], ["67759.00", "4444.00", "4444.00", "0.00", "4444.00", "4444.00"]),
    },
    {
      // 100 × 99.99% = 99.99 → 99 (HALF_UP จะได้ 100)
      label: "…99 ที่ขั้นราคา/กรัม (ต่อกรัม): ⌊100 × 99.99%⌋ = 99",
      metals: flatAt("100.00"),
      line: { ...flat("1"), purityPercent: "99.99" },
      want: row(0, PLATINUM, ["1.000", "99.99", "0"], ["100.00", "99.00", "99.00", "0.00", "99.00", "99.00"]),
    },
    {
      // 1 × 1.999 = 1.999 → 1 (HALF_UP จะได้ 2) · ราคา/กรัม (แสดง) 1 ÷ 1.999 = 0.50025… → 0.50
      label: "…999 ที่ขั้นยอดก่อนหัก: ⌊1 × 1.999⌋ = 1",
      metals: flatAt("1.00"),
      line: flat("1.999"),
      want: flatRow(0, "1.999", "1.00", "1.00", "0.50"),
    },
    {
      // 101 × 99% = 99.99 → 99 · เงินหักจึงเป็น 2 ไม่ใช่ 1.01 (ปัดลงที่สุทธิ = เงินหักปัดขึ้นเป็นบาทเต็ม)
      label: "…99 ที่ขั้นสุทธิ: ⌊101 × 99%⌋ = 99 · หัก 2",
      metals: flatAt("101.00"),
      line: flat("1", "1"),
      want: row(0, PLATINUM, ["1.000", "100.00", "1"], ["101.00", "101.00", "101.00", "2.00", "99.00", "99.00"]),
    },
    {
      // ฐาน 1,000 เท่ากัน: ทอง 1,000 × 0.0656 = 65.6 → 65 · แพลตตินั่ม (ต่อกรัม) = 1,000
      label: "ทองคูณ 0.0656: ฐาน 1,000 → ราคา/กรัม ⌊65.6⌋ = 65",
      metals: withBase({ [GOLD]: "1000.00" }),
      line: sample({ weightG: "1", purityPercent: "100", deductPercent: "0" }),
      want: row(0, GOLD, ["1.000", "100.00", "0"], ["1000.00", "65.00", "65.00", "0.00", "65.00", "65.00"]),
    },
    {
      label: "ต่อกรัมไม่คูณ: แพลตตินั่มฐาน 1,000 → ราคา/กรัม 1,000",
      line: flat("1"),
      want: flatRow(0, "1.000", "1000.00", "1000.00", "1000.00"),
    },
    {
      // ⌊4,282 × 0.001⌋ = ⌊4.282⌋ = 4 · ⌊4 × 97%⌋ = ⌊3.88⌋ = 3 · ราคา/กรัม (แสดง) 3 ÷ 0.001 = 3,000
      label: "ทองน้ำหนักเล็กสุด 0.001 กรัม: ⌊4.282⌋ = 4 → ⌊3.88⌋ = 3 บาท",
      line: sample({ weightG: "0.001" }),
      want: row(0, GOLD, ["0.001", "96.50", "3"], ["67650.00", "4282.00", "4.00", "1.00", "3.00", "3000.00"]),
    },
    {
      // ⌊41 × 0.025⌋ = ⌊1.025⌋ = 1 — ขอบล่างที่ยังได้ 1 บาท (0.024 กรัม = 0 บาท ดูด่าน amountZero)
      label: "เงิน 0.025 กรัม: ⌊1.025⌋ = 1 บาท",
      line: silver({ weightG: "0.025" }),
      want: row(0, SILVER, ["0.025", "92.50", "0"], ["45.00", "41.00", "1.00", "0.00", "1.00", "40.00"]),
    },
    {
      // ทอง 1%: ⌊4,437.84 × 1%⌋ = ⌊44.3784⌋ = 44 · ⌊44 × 0.023⌋ = ⌊1.012⌋ = 1 · 1 ÷ 0.023 = 43.478… → 43.48
      label: "ทอง 1% (ขอบล่างของค่าบริสุทธิ์) 0.023 กรัม → 1 บาท",
      line: sample({ weightG: "0.023", purityPercent: "1", deductPercent: "0" }),
      want: row(0, GOLD, ["0.023", "1.00", "0"], ["67650.00", "44.00", "1.00", "0.00", "1.00", "43.48"]),
    },
    {
      // 67,650.00 จาก numeric ที่จัดรูปมีคอมมา — อ่านได้ ค่าเดียวกับบิลตัวอย่าง
      label: "ราคาฐานคั่นหลักพัน '67,650.00' → อ่านได้",
      metals: withBase({ [GOLD]: "67,650.00" }),
      line: sample(),
      want: SAMPLE_LINE,
    },
  ];
  it.each(FORMULA)("$label", ({ metals, line, want }) => {
    expect(quoteBuy(base({ metals: metals ?? METALS, lines: [line], payments: [cash(want.amount)] }))).toStrictEqual(
      paidInFull(want),
    );
  });

  // ทุกตัวเลือกของ dropdown กับทองตัวอย่าง (ยอดก่อนหัก 42,820): สุทธิ = ⌊42,820 × (100 − หัก) ÷ 100⌋ · ราคา/กรัม = สุทธิ ÷ 10
  it.each([
    ["0", "0.00", "42820.00", "4282.00"],
    ["1", "429.00", "42391.00", "4239.10"], // 42,391.8
    ["2", "857.00", "41963.00", "4196.30"], // 41,963.6
    ["3", "1285.00", "41535.00", "4153.50"], // 41,535.4
    ["4", "1713.00", "41107.00", "4110.70"], // 41,107.2
    ["5", "2141.00", "40679.00", "4067.90"], // 40,679 พอดี
    ["6", "2570.00", "40250.00", "4025.00"], // 40,250.8
    ["7", "2998.00", "39822.00", "3982.20"], // 39,822.6
    ["8", "3426.00", "39394.00", "3939.40"], // 39,394.4
    ["9", "3854.00", "38966.00", "3896.60"], // 38,966.2
    ["10", "4282.00", "38538.00", "3853.80"], // 38,538 พอดี (ขอบบน)
  ])("หัก %s%% → เงินหัก %s · จ่าย %s · ราคา/กรัม %s", (deduct, deductAmount, amount, pricePerG) => {
    const want = row(
      0,
      GOLD,
      ["10.000", "96.50", deduct],
      ["67650.00", "4282.00", "42820.00", deductAmount, amount, pricePerG],
    );
    expect(quoteBuy(base({ lines: [sample({ deductPercent: deduct })], payments: [cash(amount)] }))).toStrictEqual(
      paidInFull(want),
    );
  });
});

describe("quoteBuy — ยอดที่คิดได้ต้องมากกว่า 0 บาท (amountZero ที่ lines.i.weight_g)", () => {
  it.each<[string, Record<string, BuyMetal>, BuyLineInput]>([
    // ⌊41 × 0.024⌋ = ⌊0.984⌋ = 0 — ใต้ขอบ 1 บาท 1 ขั้น (0.025 กรัม = 1 บาท)
    ["เงิน 92.5% 0.024 กรัม: ⌊0.984⌋ = 0", METALS, silver({ weightG: "0.024" })],
    // ⌊41 × 0.025⌋ = 1 · ⌊1 × 90%⌋ = 0 — หักจนเหลือศูนย์
    ["เงิน 0.025 กรัม หัก 10%: ⌊0.9⌋ = 0", METALS, silver({ weightG: "0.025", deductPercent: "10" })],
    // ⌊1 × 99%⌋ = ⌊0.99⌋ = 0
    ["ฐาน 1 บาท หัก 1%: ⌊0.99⌋ = 0", flatAt("1.00"), flat("1", "1")],
    // ⌊45 × 1%⌋ = ⌊0.45⌋ = 0 — ราคา/กรัมเป็น 0 น้ำหนักเท่าไรก็ได้ 0
    ["เงิน 1% 1,000 กรัม: ราคา/กรัม ⌊0.45⌋ = 0", METALS, silver({ weightG: "1000", purityPercent: "1" })],
    // ทอง 1%: ราคา/กรัม 44 · ⌊44 × 0.022⌋ = ⌊0.968⌋ = 0 (0.023 กรัม = 1 บาท)
    ["ทอง 1% 0.022 กรัม: ⌊0.968⌋ = 0", METALS, sample({ weightG: "0.022", purityPercent: "1", deductPercent: "0" })],
    // ฐาน 0.99 ต่อกรัม (ตั้งราคาแล้ว > 0) → ราคา/กรัม ⌊0.99⌋ = 0
    ["ฐานต่ำกว่า 1 บาท/กรัม: ⌊0.99⌋ = 0", flatAt("0.99"), flat("1000")],
  ])("%s → ไม่นับ", (_label, metals, line) => {
    expect(quoteBuy(base({ metals, lines: [line], payments: [] }))).toStrictEqual(
      onlyError("lines.0.weight_g", BUY_MSG.amountZero),
    );
  });

  it("แถวที่ผิดช่องอื่นอยู่แล้วไม่ถูกคิดราคา จึงไม่ขึ้น amountZero ซ้ำ", () => {
    expect(
      quoteBuy(base({ lines: [silver({ weightG: "0.024", purityPercent: "100.5" })], payments: [] })),
    ).toStrictEqual(onlyError("lines.0.purity_percent", BUY_MSG.purityInvalid));
  });
});

describe("quoteBuy — ค่าบริสุทธิ์ต่อแถว (1–100 ทศนิยม ≤ 2): กลุ่มสมมูล + ค่าขอบ", () => {
  it.each<[string, unknown, string]>([
    ["สตริงว่าง", "", BUY_MSG.purityRequired],
    ["มีแต่ช่องว่าง", "   ", BUY_MSG.purityRequired],
    ["ไม่ส่ง (undefined · cast)", undefined, BUY_MSG.purityRequired],
    ["null (cast)", null, BUY_MSG.purityRequired],
    ["ตัวเลข JSON 96.5 (cast) — ไม่ใช่ข้อความ = ยังไม่ได้กรอก", 96.5, BUY_MSG.purityRequired],
    ["0.99 ใต้ขอบล่าง 1 ขั้น", "0.99", BUY_MSG.purityInvalid],
    ["0", "0", BUY_MSG.purityInvalid],
    ["100.01 เหนือขอบบน 1 ขั้น", "100.01", BUY_MSG.purityInvalid],
    ["101", "101", BUY_MSG.purityInvalid],
    ["965 ลืมจุด", "965", BUY_MSG.purityInvalid],
    ["ทศนิยม 3 ตำแหน่ง", "96.555", BUY_MSG.purityInvalid],
    ["คอมมาแทนจุด", "96,5", BUY_MSG.purityInvalid],
    ["เลขไทย", "๙๖.๕", BUY_MSG.purityInvalid],
    ["เครื่องหมายบวก", "+96.5", BUY_MSG.purityInvalid],
    ["ติดลบ", "-96.5", BUY_MSG.purityInvalid],
    ["exponent", "9.65e1", BUY_MSG.purityInvalid],
    ["NaN", "NaN", BUY_MSG.purityInvalid],
    ["Infinity", "Infinity", BUY_MSG.purityInvalid],
    ["พิมพ์ % ต่อท้าย", "96.5%", BUY_MSG.purityInvalid],
    ["ตัวอักษร", "abc", BUY_MSG.purityInvalid],
  ])("%s → %s ที่ lines.0.purity_percent ข้อเดียว และไม่นับรวมยอด", (_label, purity, msg) => {
    const line = sample({ purityPercent: purity as string });
    expect(quoteBuy(base({ lines: [line], payments: [] }))).toStrictEqual(onlyError("lines.0.purity_percent", msg));
  });

  // ฐาน 100 บาท/กรัม · 1 กรัม · ไม่หัก → ยอด = ⌊ค่าบริสุทธิ์⌋ บาท
  it.each([
    ["1", "1.00", "1.00"], // ขอบล่างพอดี
    ["1.00", "1.00", "1.00"],
    ["1.01", "1.01", "1.00"], // เหนือขอบล่าง 1 ขั้น: ⌊1.01⌋ = 1
    ["01", "1.00", "1.00"], // ศูนย์นำหน้า
    ["96.5", "96.50", "96.00"],
    ["96.550", "96.55", "96.00"], // สเกลตรวจที่ค่า ศูนย์ท้ายไม่นับ
    [" 96.5 ", "96.50", "96.00"], // เว้นวรรคหัวท้ายถูกตัด
    ["99.99", "99.99", "99.00"], // ใต้ขอบบน 1 ขั้น
    ["100", "100.00", "100.00"], // ขอบบนพอดี
    ["100.00", "100.00", "100.00"],
  ])("ค่าบริสุทธิ์ %j → ใช้ได้ เป็น %s · ยอด %s", (typed, purityPercent, amount) => {
    const want = row(0, PLATINUM, ["1.000", purityPercent, "0"], ["100.00", amount, amount, "0.00", amount, amount]);
    expect(
      quoteBuy(
        base({ metals: flatAt("100.00"), lines: [{ ...flat("1"), purityPercent: typed }], payments: [cash(amount)] }),
      ),
    ).toStrictEqual(paidInFull(want));
  });
});

describe("quoteBuy — หัก % ต่อแถว (dropdown เลขเต็ม 0–10 · ไม่ส่ง/ว่าง = 0)", () => {
  // ฐาน 100 บาท/กรัม · 1 กรัม · บริสุทธิ์ 100 → ยอดก่อนหัก 100 · สุทธิ = 100 − หัก
  const noDeduct: BuyLineInput = { metalId: PLATINUM, weightG: "1", purityPercent: "100" };
  it.each<[string, BuyLineInput, string, string, string]>([
    ["ไม่ส่งฟิลด์", noDeduct, "0", "0.00", "100.00"],
    ["undefined", { ...noDeduct, deductPercent: undefined }, "0", "0.00", "100.00"],
    ["null", { ...noDeduct, deductPercent: null }, "0", "0.00", "100.00"],
    ["สตริงว่าง", flat("1", ""), "0", "0.00", "100.00"],
    ["มีแต่ช่องว่าง", flat("1", "  "), "0", "0.00", "100.00"],
    ['"0" ขอบล่าง', flat("1", "0"), "0", "0.00", "100.00"],
    ['"00"', flat("1", "00"), "0", "0.00", "100.00"],
    ['"1" เหนือขอบล่าง 1 ขั้น', flat("1", "1"), "1", "1.00", "99.00"],
    ['"03" ศูนย์นำหน้า', flat("1", "03"), "3", "3.00", "97.00"],
    ['" 3 " เว้นวรรคหัวท้าย', flat("1", " 3 "), "3", "3.00", "97.00"],
    ['"9" ใต้ขอบบน 1 ขั้น', flat("1", "9"), "9", "9.00", "91.00"],
    ['"10" ขอบบน', flat("1", "10"), "10", "10.00", "90.00"],
  ])("%s → หัก %s · เงินหัก %s · จ่าย %s", (_label, line, deductPercent, deductAmount, amount) => {
    const want = row(
      0,
      PLATINUM,
      ["1.000", "100.00", deductPercent],
      ["100.00", "100.00", "100.00", deductAmount, amount, amount],
    );
    expect(quoteBuy(base({ metals: flatAt("100.00"), lines: [line], payments: [cash(amount)] }))).toStrictEqual(
      paidInFull(want),
    );
  });

  it.each<[string, unknown]>([
    ["11 เหนือขอบบน 1 ขั้น", "11"],
    ["99", "99"],
    ["100", "100"],
    ["010 (3 หลัก)", "010"],
    ["-1 ใต้ขอบล่าง 1 ขั้น", "-1"],
    ["+3", "+3"],
    ["1.5 ทศนิยม", "1.5"],
    ["3.0 ทศนิยมแม้ค่าเป็นเลขเต็ม", "3.0"],
    ["3% พิมพ์ % ต่อท้าย", "3%"],
    ["เลขไทย ๓", "๓"],
    ["exponent 1e1", "1e1"],
    ["ตัวอักษร", "abc"],
    ["ตัวเลข JSON 3 (cast)", 3],
    ["ตัวเลข JSON 0 (cast)", 0],
    ["boolean (cast)", true],
  ])("หัก %s → deductInvalid ที่ lines.0.deduct_percent ข้อเดียว และไม่นับรวมยอด", (_label, deduct) => {
    const line = sample({ deductPercent: deduct as string });
    expect(quoteBuy(base({ lines: [line], payments: [] }))).toStrictEqual(
      onlyError("lines.0.deduct_percent", BUY_MSG.deductInvalid),
    );
  });
});

// ── ตารางตัดสินใจ: โลหะ × ราคาของวัน × ราคาทองวันนี้ (R7) ───────────────────────────────────────────────────
const COPPER = "55555555-5555-5555-5555-555555555555";
const ODD = "66666666-6666-6666-6666-666666666666";
const NO_GOLD = err("gold_price", BUY_MSG.noGoldPrice);
const metalErr = (message: string) => err("lines.0.metal_id", message);

describe("quoteBuy — โลหะ · วิธีคิดราคา · ราคาของวัน (ข้อผิดที่ lines.i.metal_id)", () => {
  // ชำระว่าง → ไม่มีข้อผิดของการชำระปน (ยกเว้นแถวที่ถูกนับซึ่งค้างยอด — ตัดข้อ "payments" ออกก่อนเทียบ)
  // ทอง/นากไม่มีราคาตอนยังไม่ตั้งราคาทองวันนี้ → แจ้งครั้งเดียวที่ gold_price ไม่ซ้ำที่แถว · เงิน/แพลตตินั่มไม่ได้รับยกเว้น
  const RULES: {
    label: string;
    goldPriceSet: boolean;
    metals: Record<string, BuyMetal>;
    metalId: string;
    errors: QuoteError[];
    counted: boolean;
  }[] = [
    {
      label: "id ที่ไม่รู้จัก",
      goldPriceSet: true,
      metals: METALS,
      metalId: UNKNOWN,
      errors: [metalErr(BUY_MSG.unknownMetal)],
      counted: false,
    },
    {
      label: "id ที่ไม่รู้จัก · ยังไม่ตั้งราคาทอง",
      goldPriceSet: false,
      metals: METALS,
      metalId: UNKNOWN,
      errors: [NO_GOLD, metalErr(BUY_MSG.unknownMetal)],
      counted: false,
    },
    {
      label: "id ว่าง",
      goldPriceSet: true,
      metals: METALS,
      metalId: "",
      errors: [metalErr(BUY_MSG.unknownMetal)],
      counted: false,
    },
    {
      label: "id = __proto__",
      goldPriceSet: true,
      metals: METALS,
      metalId: "__proto__",
      errors: [metalErr(BUY_MSG.unknownMetal)],
      counted: false,
    },
    {
      label: "id = toString",
      goldPriceSet: true,
      metals: METALS,
      metalId: "toString",
      errors: [metalErr(BUY_MSG.unknownMetal)],
      counted: false,
    },
    {
      label: "id = constructor",
      goldPriceSet: true,
      metals: METALS,
      metalId: "constructor",
      errors: [metalErr(BUY_MSG.unknownMetal)],
      counted: false,
    },
    {
      label: "ไม่มีรายการโลหะของวันเลย (metals ว่าง)",
      goldPriceSet: true,
      metals: {},
      metalId: GOLD,
      errors: [metalErr(BUY_MSG.unknownMetal)],
      counted: false,
    },
    {
      label: "code ที่ไม่มีวิธีคิดราคา (ทองแดง)",
      goldPriceSet: true,
      metals: { ...METALS, [COPPER]: { code: "copper", nameTh: "ทองแดง", basePrice: "300.00" } },
      metalId: COPPER,
      errors: [metalErr("ยังไม่ได้กำหนดวิธีคิดราคาของทองแดง")],
      counted: false,
    },
    {
      label: "code = toString (ไม่หลุดไปเจอ prototype ของ METAL_PRICING)",
      goldPriceSet: true,
      metals: { ...METALS, [ODD]: { code: "toString", nameTh: "โลหะทดสอบ", basePrice: "1.00" } },
      metalId: ODD,
      errors: [metalErr("ยังไม่ได้กำหนดวิธีคิดราคาของโลหะทดสอบ")],
      counted: false,
    },
    {
      label: "ทองไม่มีราคา · ตั้งราคาทองแล้ว (ข้อมูลขัดกัน) → fail-closed ที่แถว",
      goldPriceSet: true,
      metals: withBase({ [GOLD]: null }),
      metalId: GOLD,
      errors: [metalErr("ยังไม่ได้ตั้งราคาทองของวันนี้")],
      counted: false,
    },
    {
      label: "ทองไม่มีราคา · ยังไม่ตั้งราคาทอง → gold_price ข้อเดียว",
      goldPriceSet: false,
      metals: withBase({ [GOLD]: null }),
      metalId: GOLD,
      errors: [NO_GOLD],
      counted: false,
    },
    {
      label: "ทองราคา 0 · ยังไม่ตั้งราคาทอง → gold_price ข้อเดียว",
      goldPriceSet: false,
      metals: withBase({ [GOLD]: "0.00" }),
      metalId: GOLD,
      errors: [NO_GOLD],
      counted: false,
    },
    {
      label: "ทองราคา 0 · ตั้งราคาทองแล้ว → ที่แถว",
      goldPriceSet: true,
      metals: withBase({ [GOLD]: "0.00" }),
      metalId: GOLD,
      errors: [metalErr("ยังไม่ได้ตั้งราคาทองของวันนี้")],
      counted: false,
    },
    {
      label: "นากไม่มีราคา · ยังไม่ตั้งราคาทอง → gold_price ข้อเดียว (นากคิดแบบทอง)",
      goldPriceSet: false,
      metals: withBase({ [NAK]: null }),
      metalId: NAK,
      errors: [NO_GOLD],
      counted: false,
    },
    {
      label: "นากไม่มีราคา · ตั้งราคาทองแล้ว → ที่แถว",
      goldPriceSet: true,
      metals: withBase({ [NAK]: null }),
      metalId: NAK,
      errors: [metalErr("ยังไม่ได้ตั้งราคานากของวันนี้")],
      counted: false,
    },
    {
      label: "เงินไม่มีราคา · ตั้งราคาทองแล้ว",
      goldPriceSet: true,
      metals: withBase({ [SILVER]: null }),
      metalId: SILVER,
      errors: [metalErr("ยังไม่ได้ตั้งราคาเงินของวันนี้")],
      counted: false,
    },
    {
      label: "เงินไม่มีราคา · ยังไม่ตั้งราคาทอง → ทั้งสองข้อ (ต่อกรัมไม่ได้รับยกเว้น)",
      goldPriceSet: false,
      metals: withBase({ [SILVER]: null }),
      metalId: SILVER,
      errors: [NO_GOLD, metalErr("ยังไม่ได้ตั้งราคาเงินของวันนี้")],
      counted: false,
    },
    ...(
      [
        ["null", null],
        ['"0"', "0"],
        ['"0.00"', "0.00"],
        ['"-1000" (parser เข้มไม่รับเครื่องหมาย)', "-1000"],
        ['"" (ว่าง)', ""],
        ['"abc"', "abc"],
        ['"Infinity"', "Infinity"],
        ['"NaN"', "NaN"],
      ] as const
    ).map(([what, price]) => ({
      label: `แพลตตินั่มราคา ${what}`,
      goldPriceSet: true,
      metals: withBase({ [PLATINUM]: price }),
      metalId: PLATINUM,
      errors: [metalErr("ยังไม่ได้ตั้งราคาแพลตตินั่มของวันนี้")],
      counted: false,
    })),
    {
      label: "ทองมีราคา · ยังไม่ตั้งราคาทอง → ด่าน R7 บล็อกการบันทึก แต่ยอดยังคิดให้เห็น",
      goldPriceSet: false,
      metals: METALS,
      metalId: GOLD,
      errors: [NO_GOLD],
      counted: true,
    },
    {
      label: "ทองมีราคา · ตั้งราคาทองแล้ว → นับ",
      goldPriceSet: true,
      metals: METALS,
      metalId: GOLD,
      errors: [],
      counted: true,
    },
  ];
  it.each(RULES)("$label", ({ goldPriceSet, metals, metalId, errors, counted }) => {
    const r = quoteBuy(base({ goldPriceSet, metals, lines: [sample({ metalId })], payments: [] }));
    expect(r.errors.filter((e) => e.field !== "payments")).toStrictEqual(errors);
    expect(r.lines).toStrictEqual(counted ? [{ ...SAMPLE_LINE, metalId }] : []);
    expect(r.ok).toBe(false); // ไม่มีการชำระ → ไม่มีกฎไหน ok
  });

  it("ยังไม่ตั้งราคาทอง: ทอง/นากหลายแถวแจ้ง gold_price ข้อเดียว ไม่ซ้ำทุกแถว · แถวเงินที่มีราคายังนับ", () => {
    expect(
      quoteBuy(
        base({
          goldPriceSet: false,
          metals: withBase({ [GOLD]: null, [NAK]: null }),
          lines: [sample(), sample({ metalId: NAK }), sample({ weightG: "1" }), silver()],
          payments: [cash("11133")],
        }),
      ),
    ).toStrictEqual({ ...paidInFull({ ...SILVER_LINE, index: 3 }), ok: false, errors: [NO_GOLD] });
  });

  it("ยังไม่ตั้งราคาทองแต่กรอกชำระแล้ว: แถวทองไม่ถูกนับ ยอดบิล 0.00 → การชำระขึ้นเกินยอด (บันทึกไม่ได้อยู่แล้ว)", () => {
    expect(quoteBuy(base({ goldPriceSet: false, metals: withBase({ [GOLD]: null }) }))).toStrictEqual({
      ok: false,
      errors: [NO_GOLD, err("payments", BUY_MSG.overpaid)],
      lines: [],
      payments: [payRow(0, "cash", "41535.00")],
      totalWeight: "0.000",
      totalAmount: "0.00",
      avgPricePerG: "0.00",
      paid: "41535.00",
      balance: "-41535.00",
    });
  });
});

// ── ตารางตัดสินใจ: ด่านก่อนเปิดบิล ─────────────────────────────────────────────────────────────────────
// ข้อความสถานะบัตรพิมพ์ตรงตัว (ไม่อ้าง CARD_STATUS_MESSAGE) ให้ oracle อิสระจากโค้ด — ระบบเดิม status 1/2/3 (R2)
const NO_CUSTOMER = err("customer_id", BUY_MSG.noCustomer);
const CARD_EXPIRED = err("customer_id", "บัตรประชาชนหมดอายุแล้ว");
const CARD_MISSING = err("customer_id", "ยังไม่ได้กรอกวันที่บัตรหมดอายุ");
const CARD_INVALID = err("customer_id", "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง");

const OMIT = "ไม่ส่งฟิลด์";
type CustomerArg = QuoteBuyInput["customer"] | typeof OMIT;

function withCustomer(goldPriceSet: boolean, customer: CustomerArg): QuoteBuyInput {
  const { customer: _dropped, ...rest } = base({ goldPriceSet });
  return customer === OMIT ? rest : { ...rest, customer };
}

// 2 (ราคาทอง) × 7 (ลูกค้า: ไม่มี 3 แบบ + สถานะบัตร 4 ค่า) = 14 กฎ · ลำดับข้อผิดตามหน้า /buy §3.1: หัวบิล/ราคาทอง → ลูกค้า
const PRECONDITIONS: { goldPriceSet: boolean; label: string; customer: CustomerArg; errors: QuoteError[] }[] = [
  { goldPriceSet: true, label: "ไม่ส่งฟิลด์ customer", customer: OMIT, errors: [NO_CUSTOMER] },
  { goldPriceSet: true, label: "customer: undefined", customer: undefined, errors: [NO_CUSTOMER] },
  { goldPriceSet: true, label: "customer: null", customer: null, errors: [NO_CUSTOMER] },
  { goldPriceSet: true, label: "บัตร ok", customer: card("ok"), errors: [] },
  { goldPriceSet: true, label: "บัตรหมดอายุ (status 1)", customer: card("expired"), errors: [CARD_EXPIRED] },
  { goldPriceSet: true, label: "ไม่มีวันหมดอายุ (status 2)", customer: card("missing"), errors: [CARD_MISSING] },
  { goldPriceSet: true, label: "วันที่ผิดรูป (status 3)", customer: card("invalid"), errors: [CARD_INVALID] },
  { goldPriceSet: false, label: "ไม่ส่งฟิลด์ customer", customer: OMIT, errors: [NO_GOLD, NO_CUSTOMER] },
  { goldPriceSet: false, label: "customer: undefined", customer: undefined, errors: [NO_GOLD, NO_CUSTOMER] },
  { goldPriceSet: false, label: "customer: null", customer: null, errors: [NO_GOLD, NO_CUSTOMER] },
  { goldPriceSet: false, label: "บัตร ok", customer: card("ok"), errors: [NO_GOLD] },
  { goldPriceSet: false, label: "บัตรหมดอายุ (status 1)", customer: card("expired"), errors: [NO_GOLD, CARD_EXPIRED] },
  {
    goldPriceSet: false,
    label: "ไม่มีวันหมดอายุ (status 2)",
    customer: card("missing"),
    errors: [NO_GOLD, CARD_MISSING],
  },
  { goldPriceSet: false, label: "วันที่ผิดรูป (status 3)", customer: card("invalid"), errors: [NO_GOLD, CARD_INVALID] },
];

describe("quoteBuy — ตารางตัดสินใจ: ราคาทองวันนี้ × ลูกค้า/สถานะบัตร (R1 · R2 · R7)", () => {
  it.each(PRECONDITIONS)("ตั้งราคาทองแล้ว=$goldPriceSet · $label", ({ goldPriceSet, customer, errors }) => {
    const input = withCustomer(goldPriceSet, customer);
    // กลุ่ม "ไม่ส่งฟิลด์" ต้องไม่มี key จริง ๆ ไม่ใช่ key ที่เป็น undefined
    expect(Object.hasOwn(input, "customer")).toBe(customer !== OMIT);
    // ด่านนี้บล็อกการบันทึกเท่านั้น — ยอดของบิล (ราคาทองที่ส่งมาใน metals) ยังคำนวณให้เห็นบนจอครบเหมือนบิลปกติ
    expect(quoteBuy(input)).toStrictEqual({ ...SAMPLE_OK, ok: errors.length === 0, errors });
  });

  it("R7 ใช้ข้อความเดียวกับ Django ที่พนักงานคุ้น", () => {
    expect(BUY_MSG.noGoldPrice).toBe("ยังไม่ได้ตั้งราคาทองของวันนี้");
  });
});

describe("quoteBuy — น้ำหนักต่อแถว (R3: > 0 · ทศนิยมไม่เกิน 3): กลุ่มสมมูล + ค่าขอบ", () => {
  // ไม่มีการชำระ → ข้อผิดที่เหลือมีแค่ช่องที่ทดสอบ · แถวที่ผิดไม่ถูกนับ ยอดทุกช่องจึงเป็นศูนย์
  it.each([
    ["0", BUY_MSG.weightPositive], // บนขอบล่างพอดี (ต้องมากกว่า 0)
    ["0.000", BUY_MSG.weightPositive], // ศูนย์ที่พิมพ์ทศนิยมครบ 3 ตำแหน่ง
    // ต่ำกว่าศูนย์: parser เข้ม (dev PR #53) ไม่รับเครื่องหมาย → "ตัวเลขไม่ถูกต้อง" ตั้งแต่ขั้น parse ไม่ถึงด่าน > 0
    ["-0", BUY_MSG.badNumber], // ลบศูนย์
    ["-0.001", BUY_MSG.badNumber], // ต่ำกว่าขอบล่าง 1 หน่วยที่เล็กที่สุด (0.001 กรัม)
    ["-0.0001", BUY_MSG.badNumber], // ติดลบและทศนิยมเกิน → ยังบอกข้อเดียว
    ["-1", BUY_MSG.badNumber],
    ["0.0001", BUY_MSG.weightScale], // มากกว่า 0 แต่ 4 ตำแหน่ง → ผิดที่สเกล ไม่ใช่ "ต้องมากกว่า 0"
    ["1.2345", BUY_MSG.weightScale], // เกินขอบบนของสเกล 1 ตำแหน่ง
    ["", BUY_MSG.badNumber],
    ["   ", BUY_MSG.badNumber],
    ["abc", BUY_MSG.badNumber],
    ["5.86g", BUY_MSG.badNumber],
    ["5.8.6", BUY_MSG.badNumber],
    ["๕.๘๖๐", BUY_MSG.badNumber], // เลขไทย
    ["0x10", BUY_MSG.badNumber],
    ["1e3", BUY_MSG.badNumber],
    ["NaN", BUY_MSG.badNumber],
    ["Infinity", BUY_MSG.badNumber],
    ["5,86", BUY_MSG.weightComma], // คอมมาแทนจุดทศนิยม — ไม่เดา
    ["5,860", BUY_MSG.weightComma], // เคยถูกอ่านเป็น 5,860 กรัม
    ["1,250.500", BUY_MSG.weightComma], // น้ำหนักไม่คั่นหลักพัน
  ])("น้ำหนัก %j → %s ที่ lines.0.weight_g ข้อเดียว และไม่นับรวมยอด", (w, msg) => {
    expect(quoteBuy(base({ lines: [sample({ weightG: w })], payments: [] }))).toStrictEqual(
      onlyError("lines.0.weight_g", msg),
    );
  });

  it("น้ำหนักที่ไม่ใช่ข้อความ (ตัวเลข JSON · cast) → ตัวเลขไม่ถูกต้อง ไม่ใช่ 'ห้ามใส่จุลภาค'", () => {
    expect(quoteBuy(base({ lines: [sample({ weightG: 10 as unknown as string })], payments: [] }))).toStrictEqual(
      onlyError("lines.0.weight_g", BUY_MSG.badNumber),
    );
  });

  it.each([
    // [ที่พิมพ์, weightG ที่ได้, ยอด = ⌊1,000 × น้ำหนัก⌋] · ฐาน 1,000 บาท/กรัม → ราคา/กรัม (แสดง) 1,000.00 ทุกแถว
    ["0.001", "0.001", "1.00"], // ขอบล่างที่ใช้ได้
    ["1.234", "1.234", "1234.00"], // ขอบบนของสเกล
    ["5.8600", "5.860", "5860.00"], // สเกลตรวจที่ค่า ศูนย์ท้ายไม่นับ
    [" 5.860 ", "5.860", "5860.00"], // เว้นวรรคหัวท้ายถูกตัดทิ้ง
    ["1250.500", "1250.500", "1250500.00"], // น้ำหนักเกินพันเป็นตัวเลขล้วน
  ])("น้ำหนัก %j → ใช้ได้ เป็น %s · ยอด %s", (typed, weightG, amount) => {
    expect(quoteBuy(base({ lines: [flat(typed)], payments: [cash(amount)] }))).toStrictEqual(
      paidInFull(flatRow(0, weightG, "1000.00", amount, "1000.00")),
    );
  });
});

describe("quoteBuy — ช่องต่อแถว: ตารางตัดสินใจ 4 ช่อง · ดัชนีแถว (R3)", () => {
  // โลหะ × น้ำหนัก × บริสุทธิ์ × หัก (ถูก/ผิด) = 16 กฎ · ทุกช่องที่ผิดแจ้งครบ เรียงตามจอ: โลหะ → น้ำหนัก → บริสุทธิ์ → หัก
  // ชำระ 41,535 ทุกกฎ: แถวที่ไม่ถูกนับทำให้ยอดบิล 0.00 → ชำระกลายเป็นเกินยอด คงเหลือ −41,535.00
  const FIELDS = [
    { name: "โลหะ", key: "metalId", bad: UNKNOWN, error: err("lines.0.metal_id", BUY_MSG.unknownMetal) },
    { name: "น้ำหนัก", key: "weightG", bad: "0", error: err("lines.0.weight_g", BUY_MSG.weightPositive) },
    { name: "บริสุทธิ์", key: "purityPercent", bad: "", error: err("lines.0.purity_percent", BUY_MSG.purityRequired) },
    { name: "หัก", key: "deductPercent", bad: "11", error: err("lines.0.deduct_percent", BUY_MSG.deductInvalid) },
  ] as const;
  const RULES = Array.from({ length: 16 }, (_, mask) => {
    const wrong = FIELDS.filter((_f, bit) => (mask >> (3 - bit)) & 1);
    return {
      label: wrong.length === 0 ? "ถูกครบทุกช่อง → นับ" : `ผิด: ${wrong.map((f) => f.name).join(" + ")} → ไม่นับ`,
      line: sample(Object.fromEntries(wrong.map((f) => [f.key, f.bad]))),
      errors: wrong.map((f) => f.error),
    };
  });
  it.each(RULES)("$label", ({ line, errors }) => {
    const r = quoteBuy(base({ lines: [line] }));
    if (errors.length === 0) {
      expect(r).toStrictEqual(SAMPLE_OK);
      return;
    }
    expect(r).toStrictEqual({
      ok: false,
      errors: [...errors, err("payments", BUY_MSG.overpaid)],
      lines: [],
      payments: [payRow(0, "cash", "41535.00")],
      totalWeight: "0.000",
      totalAmount: "0.00",
      avgPricePerG: "0.00",
      paid: "41535.00",
      balance: "-41535.00",
    });
  });

  it("แถวที่สองผิด → ข้อผิดชี้ lines.1.* · แถวแรกยังนับ", () => {
    expect(quoteBuy(base({ lines: [sample(), sample({ weightG: "1.2345", purityPercent: "96.555" })] }))).toStrictEqual(
      {
        ...SAMPLE_OK,
        ok: false,
        errors: [err("lines.1.weight_g", BUY_MSG.weightScale), err("lines.1.purity_percent", BUY_MSG.purityInvalid)],
      },
    );
  });

  it("แถวแรกผิด แถวที่สองถูก → ข้อผิดชี้ lines.0.* · ยอดมาจากแถวที่สองเท่านั้น · index = 1", () => {
    expect(quoteBuy(base({ lines: [sample({ weightG: "" }), sample()] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("lines.0.weight_g", BUY_MSG.badNumber)],
      lines: [{ ...SAMPLE_LINE, index: 1 }],
    });
  });

  it("เลขบัตร 13 หลักหลุดลงทุกช่องของแถว → ปฏิเสธครบทุกช่อง ไม่ใช่ 500 ตอนบันทึก", () => {
    const id = "1103700123458";
    expect(
      quoteBuy(base({ lines: [{ metalId: GOLD, weightG: id, purityPercent: id, deductPercent: id }], payments: [] })),
    ).toStrictEqual({
      ok: false,
      errors: [
        err("lines.0.weight_g", BUY_MSG.weightMax),
        err("lines.0.purity_percent", BUY_MSG.purityInvalid),
        err("lines.0.deduct_percent", BUY_MSG.deductInvalid),
      ],
      ...NOTHING_COUNTED,
    });
  });
});

describe("quoteBuy — ราคา/กรัม (แสดง) = สุทธิ ÷ น้ำหนัก HALF_UP 2 ตำแหน่ง ใช้แสดงเท่านั้น (R3 · §8)", () => {
  // ฐาน 1 บาท/กรัม → ยอด ⌊น้ำหนัก⌋ = 1 บาท ทุกแถวน้ำหนัก 1.x · ค่าขอบรอบครึ่ง 0.625 (…4/…5/…6 ของหลักที่ถูกตัด)
  it.each([
    // [ฐาน, กรัม, หัก, สุทธิ, ผลหารจริง, ที่ต้องได้]
    ["1.00", "1.599", "0", "1.00", "0.62539…", "0.63"], // เหนือครึ่ง
    ["1.00", "1.6", "0", "1.00", "0.625", "0.63"], // ครึ่งพอดี: HALF_EVEN/FLOOR → 0.62
    ["1.00", "1.601", "0", "1.00", "0.62460…", "0.62"], // ใต้ครึ่ง: CEIL/UP → 0.63
    ["1.00", "1.5", "0", "1.00", "0.666…", "0.67"], // ผลหารไม่รู้จบ
    ["1.00", "1.2", "0", "1.00", "0.833…", "0.83"],
    // ⌊3 × 8⌋ = 24 · ⌊24 × 90%⌋ = ⌊21.6⌋ = 21 · 21 ÷ 8 = 2.625 → 2.63 (HALF_EVEN → 2.62)
    ["3.00", "8", "10", "21.00", "2.625", "2.63"],
  ])(
    "ฐาน %s · %s กรัม · หัก %s%% → สุทธิ %s ÷ กรัม = %s → %s",
    (basePrice, weightG, deduct, amount, _exact, pricePerG) => {
      const r = quoteBuy(base({ metals: flatAt(basePrice), lines: [flat(weightG, deduct)], payments: [cash(amount)] }));
      expect(r.ok).toBe(true);
      expect(r.lines.map((l) => [l.amount, l.pricePerG])).toStrictEqual([[amount, pricePerG]]);
      expect(r.avgPricePerG).toBe(pricePerG); // แถวเดียว
    },
  );

  it("ยอดบิลคือสุทธิที่ปัดลงแล้ว ไม่ได้คูณกลับจากราคา/กรัม: เงิน 271.56 กรัม แสดง 41.00/กรัม แต่ยอด 11,133.00 (คูณกลับได้ 11,133.96)", () => {
    const r = quoteBuy(base({ lines: [silver()], payments: [cash("11133")] }));
    expect([r.lines[0]?.pricePerG, r.totalAmount, r.paid, r.balance]).toStrictEqual([
      "41.00",
      "11133.00",
      "11133.00",
      "0.00",
    ]);
  });
});

describe("quoteBuy — ยอดรวมเป็นผลบวกทศนิยมตรงตัว ไม่มีเศษ float (R4 ต้องเท่ากันพอดี)", () => {
  it("น้ำหนัก 0.1 + 0.2 = 0.300 (float: 0.30000000000000004) · ฐาน 100: 10 + 20 = 30.00", () => {
    expect(
      quoteBuy(base({ metals: flatAt("100.00"), lines: [flat("0.1"), flat("0.2")], payments: [cash("30")] })),
    ).toStrictEqual({
      ok: true,
      errors: [],
      lines: [flatRow(0, "0.100", "100.00", "10.00", "100.00"), flatRow(1, "0.200", "100.00", "20.00", "100.00")],
      payments: [payRow(0, "cash", "30.00")],
      totalWeight: "0.300",
      totalAmount: "30.00",
      avgPricePerG: "100.00", // 30 ÷ 0.300
      paid: "30.00",
      balance: "0.00",
    });
  });

  it("บิล 1.00 ชำระแยก 0.06 + 0.57 + 0.37 → พอดี ไม่ใช่ขาด (float: Σ = 0.9999999999999999)", () => {
    const r = quoteBuy(
      base({
        metals: flatAt("1.00"),
        lines: [flat("1")],
        payments: [cash("0.06"), transfer("KBANK", "0.57"), transfer("SCB", "0.37")],
      }),
    );
    expect(r.errors).toStrictEqual([]);
    expect([r.totalAmount, r.paid, r.balance]).toStrictEqual(["1.00", "1.00", "0.00"]);
  });

  it("สิบแถว แถวละ 0.1 กรัม = 1.000 กรัม (float: Σ = 0.9999999999999999) · ฐาน 10: แถวละ 1 บาท รวม 10.00", () => {
    const r = quoteBuy(
      base({ metals: flatAt("10.00"), lines: Array.from({ length: 10 }, () => flat("0.1")), payments: [cash("10")] }),
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.amount)).toStrictEqual(Array.from({ length: 10 }, () => "1.00"));
    expect([r.totalWeight, r.totalAmount, r.avgPricePerG, r.paid, r.balance]).toStrictEqual([
      "1.000",
      "10.00",
      "10.00",
      "10.00",
      "0.00",
    ]);
  });

  it("ไม่มีรายการและไม่มีการชำระ → noLines ข้อเดียว (ไม่ขึ้นยอดไม่ตรง) · ตัวเลขยังสเกลคงที่", () => {
    expect(quoteBuy(base({ lines: [], payments: [] }))).toStrictEqual(onlyError("lines", BUY_MSG.noLines));
  });
});

describe("quoteBuy — จำนวนเงินต่อแถวชำระ (R4): กลุ่มสมมูล + ค่าขอบ", () => {
  // บิลตัวอย่าง 41,535 ชำระแถวเดียว — แถวที่ใช้ไม่ได้ไม่ถูกนับเป็นยอดชำระ → คงเหลือ 41,535.00 ทั้งก้อน
  it.each([
    ["", BUY_MSG.paymentAmount],
    ["   ", BUY_MSG.paymentAmount],
    ["abc", BUY_MSG.paymentAmount],
    ["๔๑๕๓๕", BUY_MSG.paymentAmount], // เลขไทย
    ["0", BUY_MSG.paymentAmount], // บนขอบล่างพอดี
    ["0.00", BUY_MSG.paymentAmount],
    ["-0.01", BUY_MSG.paymentAmount], // ต่ำกว่าขอบล่าง 1 สตางค์
    ["-0.001", BUY_MSG.paymentAmount], // ติดลบและทศนิยมเกิน → ตรวจค่าบวกก่อน
    ["0.001", BUY_MSG.amountScale], // มากกว่า 0 แต่ 3 ตำแหน่ง
    ["41534.999", BUY_MSG.amountScale],
    ["41535.001", BUY_MSG.amountScale], // ถ้าหลุดไปนับ จะกลายเป็นเกินยอด 0.001
  ])("ชำระ %j → %s ที่ payments.0.amount และไม่นับเป็นยอดชำระ", (amount, msg) => {
    expect(quoteBuy(base({ payments: [cash(amount)] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments.0.amount", msg), err("payments", BUY_MSG.unbalanced("41535.00"))],
      payments: [], // แถวที่ผิดไม่ออกใน result.payments
      paid: "0.00",
      balance: "41535.00",
    });
  });

  it.each([
    ["41535", "ไม่มีทศนิยม"],
    ["41535.00", "2 ตำแหน่งพอดี = ขอบบนของสเกล"],
    ["41535.000", "ศูนย์ท้ายไม่นับ สเกลตรวจที่ค่า"],
    ["41,535", "คอมมาหลักพัน (เงินคั่นหลักพันได้ ต่างจากน้ำหนัก)"],
    [" 41535 ", "เว้นวรรคหัวท้าย"],
  ])("ชำระ %j (%s) → ครบพอดี ok", (amount) => {
    expect(quoteBuy(base({ payments: [cash(amount)] }))).toStrictEqual(SAMPLE_OK);
  });

  it("แถวชำระที่ผิดทำให้ไม่ ok แม้คงเหลือ 0.00 — ปุ่มบันทึกต้องดู ok ไม่ใช่ balance", () => {
    expect(quoteBuy(base({ payments: [cash("0"), transfer("KBANK", "41535")] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments.0.amount", BUY_MSG.paymentAmount)],
      payments: [payRow(1, "transfer", "41535.00", "KBANK")],
    });
  });
});

describe("quoteBuy — วิธีชำระซ้ำ (R5): กุญแจคือ วิธี + ธนาคาร", () => {
  // บิล 41,535 ชำระสองแถว 20,000 + 21,535 — แถวหลังที่ซ้ำไม่ถูกนับ: ชำระ 20,000 คงเหลือ 21,535.00
  // คอลัมน์สุดท้าย = แถวแรกที่ถูกเก็บใน result.payments (แถวหลังที่ซ้ำไม่ถูกเก็บ)
  it.each<[string, PaymentInput, PaymentInput, QuotedPayment]>([
    ["เงินสดสองแถว", cash("20000"), cash("21535"), payRow(0, "cash", "20000.00")],
    [
      "โอนธนาคารเดียวกันสองแถว",
      transfer("KBANK", "20000"),
      transfer("KBANK", "21535"),
      payRow(0, "transfer", "20000.00", "KBANK"),
    ],
    // ไม่มีธนาคาร 3 แบบ (null · "" · ไม่ส่ง) เป็นกุญแจเดียวกัน — ใช้ได้เฉพาะเงินสด เพราะโอนต้องระบุธนาคาร (dev PR #53)
    [
      "เงินสด bank: null กับไม่ส่ง bank",
      { method: "cash", bank: null, amount: "20000" },
      { method: "cash", amount: "21535" },
      payRow(0, "cash", "20000.00"),
    ],
    [
      'เงินสด bank: "" กับ bank: null',
      { method: "cash", bank: "", amount: "20000" },
      { method: "cash", bank: null, amount: "21535" },
      payRow(0, "cash", "20000.00"), // "" = ไม่มีธนาคาร → null
    ],
  ])("%s → ซ้ำ · ข้อผิดอยู่ที่แถวหลัง payments.1.method", (_label, first, second, kept) => {
    expect(quoteBuy(base({ payments: [first, second] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments.1.method", BUY_MSG.paymentDup), err("payments", BUY_MSG.unbalanced("21535.00"))],
      payments: [kept],
      paid: "20000.00",
      balance: "21535.00",
    });
  });

  // คอลัมน์สุดท้าย = result.payments ที่คาด (เก็บทั้งสองแถว ตามลำดับ input)
  it.each<[string, PaymentInput, PaymentInput, QuotedPayment[]]>([
    [
      "วิธีเดียวกัน คนละธนาคาร",
      transfer("KBANK", "20000"),
      transfer("SCB", "21535"),
      [payRow(0, "transfer", "20000.00", "KBANK"), payRow(1, "transfer", "21535.00", "SCB")],
    ],
    [
      "คนละวิธี แต่ละแถวถูกกฎธนาคาร (เงินสดไม่มี · โอนมี)",
      cash("20000"),
      transfer("KBANK", "21535"),
      [payRow(0, "cash", "20000.00"), payRow(1, "transfer", "21535.00", "KBANK")],
    ],
  ])("%s → ไม่ซ้ำ ชำระครบ ok", (_label, first, second, payments) => {
    expect(quoteBuy(base({ payments: [first, second] }))).toStrictEqual({ ...SAMPLE_OK, payments });
  });

  // เดิมเป็นคำถาม product (ธนาคารบนแถวเงินสด) — dev PR #53 ตอบแล้ว: เงินสดห้ามระบุธนาคาร · แถวที่ผิดไม่ถึงด่านวิธีซ้ำ
  it("คนละวิธี ธนาคารเดียวกัน: แถวเงินสดที่ระบุธนาคารถูกปฏิเสธ ไม่ใช่ 'ซ้ำ' และไม่นับยอด", () => {
    expect(
      quoteBuy(base({ payments: [transfer("KBANK", "20000"), { method: "cash", bank: "KBANK", amount: "21535" }] })),
    ).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments.1.bank", BUY_MSG.cashNoBank), err("payments", BUY_MSG.unbalanced("21535.00"))],
      payments: [payRow(0, "transfer", "20000.00", "KBANK")],
      paid: "20000.00",
      balance: "21535.00",
    });
  });

  it("โอนไม่ระบุธนาคารถูกปฏิเสธก่อนด่านวิธีซ้ำ: แถวหลังได้ 'เลือกธนาคาร' ไม่ใช่ 'ซ้ำ'", () => {
    expect(
      quoteBuy(base({ payments: [transfer("KBANK", "20000"), { method: "transfer", amount: "21535" }] })),
    ).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments.1.bank", BUY_MSG.bankRequired), err("payments", BUY_MSG.unbalanced("21535.00"))],
      payments: [payRow(0, "transfer", "20000.00", "KBANK")],
      paid: "20000.00",
      balance: "21535.00",
    });
  });

  it("ซ้ำสามแถว → ข้อผิดที่แถว 1 และ 2 · นับเฉพาะแถวแรก", () => {
    expect(quoteBuy(base({ payments: [cash("20000"), cash("10000"), cash("11535")] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [
        err("payments.1.method", BUY_MSG.paymentDup),
        err("payments.2.method", BUY_MSG.paymentDup),
        err("payments", BUY_MSG.unbalanced("21535.00")),
      ],
      payments: [payRow(0, "cash", "20000.00")],
      paid: "20000.00",
      balance: "21535.00",
    });
  });

  // ทั้งสองแขนงของจำนวนเงินที่ผิด (ว่าง/ไม่บวก · ทศนิยมเกิน) ต้องไม่จองวิธีชำระ
  it.each([
    ["0", BUY_MSG.paymentAmount],
    ["0.001", BUY_MSG.amountScale],
  ])("แถวที่จำนวนเงินผิด (%j) ไม่จองวิธีชำระ — แถวถัดไปวิธีเดียวกันไม่นับว่าซ้ำ", (amount, msg) => {
    expect(quoteBuy(base({ payments: [cash(amount), cash("41535")] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments.0.amount", msg)],
      payments: [payRow(1, "cash", "41535.00")],
    });
  });

  it("R5 ใช้ข้อความเดียวกับระบบเดิม", () => {
    expect(BUY_MSG.paymentDup).toBe("มีวิธีการชำระนี้อยู่แล้ว");
  });
});

describe("quoteBuy — คงเหลือ = ยอดบิล − ยอดชำระ ต้องเป็น 0.00 พอดี (R4): ค่าขอบรอบศูนย์", () => {
  it.each<[string, string, QuoteError[]]>([
    ["41534.99", "0.01", [err("payments", BUY_MSG.unbalanced("0.01"))]], // ขาด 1 สตางค์
    ["41535.00", "0.00", []], // พอดี
    ["41535.01", "-0.01", [err("payments", BUY_MSG.overpaid)]], // เกิน 1 สตางค์ — ยอดบิลเป็นบาทเต็มแต่ชำระมีสตางค์ได้
  ])("ชำระ %s → คงเหลือ %s", (amount, balance, errors) => {
    expect(quoteBuy(base({ payments: [cash(amount)] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: errors.length === 0,
      errors,
      payments: [payRow(0, "cash", amount)],
      paid: amount,
      balance,
    });
  });

  it("มีรายการแต่ยังไม่ชำระ → คงเหลือเต็มยอด 41,535.00 (ค่าที่ปุ่ม 'เต็มจำนวน' ใช้)", () => {
    expect(quoteBuy(base({ payments: [] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments", BUY_MSG.unbalanced("41535.00"))],
      payments: [],
      paid: "0.00",
      balance: "41535.00",
    });
  });

  it("ไม่มีรายการเลยแต่มีการชำระ → noLines และเกินยอด", () => {
    expect(quoteBuy(base({ lines: [], payments: [cash("100")] }))).toStrictEqual({
      ok: false,
      errors: [err("lines", BUY_MSG.noLines), err("payments", BUY_MSG.overpaid)],
      lines: [],
      payments: [payRow(0, "cash", "100.00")],
      totalWeight: "0.000",
      totalAmount: "0.00",
      avgPricePerG: "0.00", // น้ำหนักรวม 0 → 0.00 (ไม่หารด้วยศูนย์)
      paid: "100.00",
      balance: "-100.00",
    });
  });

  it("มีแต่แถวที่ใช้ไม่ได้แต่มีการชำระ → เกินยอด (แถวที่ผิดไม่ถูกนับเป็นยอดบิล)", () => {
    expect(quoteBuy(base({ lines: [sample({ weightG: "0" })], payments: [cash("100")] }))).toStrictEqual({
      ok: false,
      errors: [err("lines.0.weight_g", BUY_MSG.weightPositive), err("payments", BUY_MSG.overpaid)],
      lines: [],
      payments: [payRow(0, "cash", "100.00")],
      totalWeight: "0.000",
      totalAmount: "0.00",
      avgPricePerG: "0.00", // น้ำหนักรวม 0 → 0.00 (ไม่หารด้วยศูนย์)
      paid: "100.00",
      balance: "-100.00",
    });
  });

  it("ข้อความยอดไม่ตรงบอกยอดคงเหลือที่ส่งเข้าไปตรงตัว", () => {
    expect(BUY_MSG.unbalanced("12345.67")).toContain("12345.67");
  });
});

describe("quoteBuy — รายงานทุกข้อผิดในครั้งเดียว (ไม่หยุดที่ข้อแรก) · ok เป็น true เฉพาะเมื่อ errors ว่าง", () => {
  it("บิลที่ผิดทุกด่าน → errors ครบทุกข้อ เรียงตามหน้าจอ: ราคาทอง → ลูกค้า → รายการ (โลหะ → น้ำหนัก → บริสุทธิ์ → หัก) → ชำระ → คงเหลือ", () => {
    const r = quoteBuy({
      goldPriceSet: false,
      customer: card("invalid"),
      // ยังไม่ตั้งราคาทองวันนี้ → ทอง/นากไม่มีราคา · แพลตตินั่มก็ยังไม่ได้ตั้ง · เงิน 45 บาท/กรัม
      metals: withBase({ [GOLD]: null, [NAK]: null, [PLATINUM]: null }),
      lines: [
        { metalId: UNKNOWN, weightG: "abc", purityPercent: "", deductPercent: "1.5" }, // 0: ผิดครบทั้ง 4 ช่อง
        sample({ weightG: "1.2345", purityPercent: "96.555" }), // 1: ทศนิยมเกิน 2 ช่อง (ทองไม่มีราคา → ไม่แจ้งที่แถว)
        silver({ weightG: "2", purityPercent: "100" }), // 2: ใช้ได้ → ⌊45 × 2⌋ = 90.00 · 45.00/กรัม
        silver({ weightG: "5,860", purityPercent: "100.01", deductPercent: "-1" }), // 3: คอมมา · เกิน 100 · ติดลบ
        sample({ weightG: "1000000" }), // 4: เกินเพดานน้ำหนัก 999,999.999
        { metalId: PLATINUM, weightG: "1", purityPercent: "100" }, // 5: แพลตตินั่มยังไม่ตั้งราคา (ต่อกรัมไม่ได้รับยกเว้น)
        silver({ weightG: "0.001", purityPercent: "100" }), // 6: ⌊45 × 0.001⌋ = 0 → ราคา 0 บาท
        sample({ metalId: NAK }), // 7: ช่องถูกครบแต่นากยังไม่มีราคา → ข้าม ไม่มีข้อผิดที่แถว (แจ้งที่ gold_price แล้ว)
      ],
      payments: [
        cash(""), // 0: ว่าง
        cash("0.001"), // 1: ทศนิยมเกิน (แถวที่ผิดไม่จองวิธี จึงไม่ซ้ำกับแถว 0)
        transfer("KBANK", "40"), // 2: ใช้ได้ → ชำระ 40.00
        transfer("KBANK", "60"), // 3: ซ้ำกับแถว 2 → ไม่นับ
        { method: "transfer", amount: "10" }, // 4: โอนไม่ระบุธนาคาร
        { method: "cash", bank: "KBANK", amount: "10" }, // 5: เงินสดระบุธนาคาร
        { method: "cheque", amount: "10" }, // 6: วิธีที่ไม่รู้จัก
      ],
    });
    expect(r).toStrictEqual({
      ok: false,
      errors: [
        err("gold_price", BUY_MSG.noGoldPrice),
        err("customer_id", "รูปแบบวันที่บัตรหมดอายุไม่ถูกต้อง"),
        err("lines.0.metal_id", BUY_MSG.unknownMetal),
        err("lines.0.weight_g", BUY_MSG.badNumber),
        err("lines.0.purity_percent", BUY_MSG.purityRequired),
        err("lines.0.deduct_percent", BUY_MSG.deductInvalid),
        err("lines.1.weight_g", BUY_MSG.weightScale),
        err("lines.1.purity_percent", BUY_MSG.purityInvalid),
        err("lines.3.weight_g", BUY_MSG.weightComma),
        err("lines.3.purity_percent", BUY_MSG.purityInvalid),
        err("lines.3.deduct_percent", BUY_MSG.deductInvalid),
        err("lines.4.weight_g", BUY_MSG.weightMax),
        err("lines.5.metal_id", "ยังไม่ได้ตั้งราคาแพลตตินั่มของวันนี้"),
        err("lines.6.weight_g", BUY_MSG.amountZero),
        err("payments.0.amount", BUY_MSG.paymentAmount),
        err("payments.1.amount", BUY_MSG.amountScale),
        err("payments.3.method", BUY_MSG.paymentDup),
        err("payments.4.bank", BUY_MSG.bankRequired),
        err("payments.5.bank", BUY_MSG.cashNoBank),
        err("payments.6.method", BUY_MSG.paymentMethod),
        err("payments", BUY_MSG.unbalanced("50.00")), // 90.00 − 40.00
      ],
      lines: [row(2, SILVER, ["2.000", "100.00", "0"], ["45.00", "45.00", "90.00", "0.00", "90.00", "45.00"])],
      payments: [payRow(2, "transfer", "40.00", "KBANK")],
      totalWeight: "2.000",
      totalAmount: "90.00",
      avgPricePerG: "45.00", // 90.00 ÷ 2.000
      paid: "40.00",
      balance: "50.00",
    });
  });

  it.each<[string, boolean, QuoteBuyInput]>([
    ["บิลถูกต้องครบ", true, base()],
    ["ยังไม่ตั้งราคาทอง", false, base({ goldPriceSet: false })],
    ["บัตรหมดอายุ", false, base({ customer: card("expired") })],
    ["ไม่มีรายการ", false, base({ lines: [], payments: [] })],
    ["น้ำหนักผิด", false, base({ lines: [sample({ weightG: "0" })] })],
    ["ค่าบริสุทธิ์ว่าง", false, base({ lines: [sample({ purityPercent: "" })] })],
    ["หัก % เกิน", false, base({ lines: [sample({ deductPercent: "11" })] })],
    ["โลหะไม่มีราคาของวัน", false, base({ metals: withBase({ [GOLD]: null }) })],
    ["ราคาที่คิดได้เป็น 0", false, base({ lines: [silver({ weightG: "0.024" })], payments: [] })],
    ["ชำระขาด", false, base({ payments: [] })],
    ["ชำระเกิน", false, base({ payments: [cash("41535.01")] })],
    ["วิธีชำระซ้ำ", false, base({ payments: [cash("20000"), cash("21535")] })],
    ["แถวชำระผิดแต่คงเหลือ 0.00", false, base({ payments: [cash("0"), transfer("KBANK", "41535")] })],
  ])("%s → ok=%s และตรงกับ errors ว่าง", (_label, ok, input) => {
    const r = quoteBuy(input);
    expect(r.ok).toBe(ok);
    expect(r.errors.length === 0).toBe(ok);
  });
});

// freeze ทั้งก้อนแบบลึก — ถ้า quoteBuy เขียนทับอินพุต (push/assign) โมดูล ESM เป็น strict mode จะ throw ทันที
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value) as unknown[]) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("quoteBuy — ฟังก์ชันบริสุทธิ์: preview กับ save ได้ผลเดียวกัน (CLAUDE.md กฎ 2 · R14)", () => {
  it("อินพุตเดียวกันเรียกซ้ำได้ผลเท่ากันทุกช่อง — ไม่มีสถานะค้างข้ามการเรียก", () => {
    const input = base({ payments: [cash("20000"), transfer("KBANK", "21535")] });
    const preview = quoteBuy(input);
    const save = quoteBuy(input);
    expect(save).toStrictEqual(preview);
    // ถ้าจำวิธีชำระข้ามการเรียก รอบที่สองจะขึ้น "ซ้ำ" และยอดชำระจะหาย
    expect(preview).toStrictEqual({
      ...SAMPLE_OK,
      payments: [payRow(0, "cash", "20000.00"), payRow(1, "transfer", "21535.00", "KBANK")],
    });
  });

  it("ไม่แก้อินพุต: อินพุตที่ freeze ทั้งก้อน (รวม metals) ยังคำนวณได้ และค่าเดิมไม่เปลี่ยน", () => {
    const input = base({
      metals: structuredClone(METALS),
      lines: [sample(), sample({ weightG: "0" })],
      payments: [cash("41535"), cash("1")],
    });
    const before = structuredClone(input);
    const r = quoteBuy(deepFreeze(input));
    expect(input).toStrictEqual(before);
    expect(r).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("lines.1.weight_g", BUY_MSG.weightPositive), err("payments.1.method", BUY_MSG.paymentDup)],
    });
  });
});

// ── เพดานต่อแถว ──────────────────────────────────────────────────────────────────────────────────────
// เพดานพิมพ์ตรงตัวในตาราง (ไม่อ้าง MAX_LINE_*) ให้ oracle อิสระ · ขั้นเล็กสุด: น้ำหนัก 0.001 g · ยอดที่คิดได้เป็นบาทเต็ม
describe("quoteBuy — เพดานต่อแถว: น้ำหนัก 999,999.999 g · ยอดที่คิดได้ ≤ 99,999,999.99 บาท", () => {
  it("ค่าคงที่กับข้อความที่พนักงานเห็นบอกเพดานเดียวกัน", () => {
    expect(MAX_LINE_WEIGHT_G).toBe("999999.999");
    expect(MAX_LINE_AMOUNT).toBe("99999999.99");
    expect(BUY_MSG.weightMax).toContain("999,999.999");
    expect(BUY_MSG.amountMax).toContain("99,999,999.99");
  });

  it.each([
    ["1000000.000", BUY_MSG.weightMax], // เหนือเพดาน 1 ขั้น (0.001 g)
    ["1000000", BUY_MSG.weightMax], // ค่าเดียวกัน ไม่มีทศนิยม
    ["1,000,000", BUY_MSG.weightComma], // น้ำหนักไม่รับคอมมาเลย (dev PR #53) — ไม่ถึงด่านเพดาน
    ["1000000.0001", BUY_MSG.weightScale], // เกินทั้งเพดานและสเกล → ตรวจสเกลก่อน บอกข้อเดียว
    ["-1000000", BUY_MSG.badNumber], // ติดลบ → parser เข้มไม่รับเครื่องหมาย
  ])("น้ำหนัก %j → %s ที่ lines.0.weight_g ข้อเดียว และไม่นับรวมยอด", (w, msg) => {
    expect(quoteBuy(base({ lines: [sample({ weightG: w })], payments: [] }))).toStrictEqual(
      onlyError("lines.0.weight_g", msg),
    );
  });

  it.each([
    ["999999.998", "ต่ำกว่าเพดาน 1 ขั้น"],
    ["999999.999", "เท่าเพดานพอดี"],
  ])("น้ำหนัก %s (%s) → ใช้ได้", (weightG) => {
    // ฐาน 1 บาท/กรัม: ⌊999,999.99x⌋ = 999,999 · ÷ 999,999.99x = 0.99999999… → HALF_UP 2 → 1.00
    expect(
      quoteBuy(base({ metals: flatAt("1.00"), lines: [flat(weightG)], payments: [cash("999999")] })),
    ).toStrictEqual(paidInFull(flatRow(0, weightG, "1.00", "999999.00", "1.00")));
  });

  it.each<[string, Record<string, BuyMetal>, BuyLineInput]>([
    // ⌊100,000,000 × 1⌋ = 100,000,000 — เหนือเพดาน (ยอดเป็นบาทเต็ม ขั้นถัดจาก 99,999,999 คือ 100,000,000)
    ["ฐาน 100,000,000 × 1 กรัม = 100,000,000", flatAt("100000000.00"), flat("1")],
    // ทอง 100%: ⌊4,437 × 22,537.751⌋ = ⌊100,000,001.187⌋ — น้ำหนักเหนือขอบ 1 ขั้น (22,537.750 = 99,999,996)
    [
      "ทอง 100% 22,537.751 กรัม = 100,000,001",
      METALS,
      sample({ weightG: "22537.751", purityPercent: "100", deductPercent: "0" }),
    ],
    // ⌊101 × 999,999.999⌋ = 100,999,999 — น้ำหนักในเพดานแต่ยอดเกิน
    ["ฐาน 101 × น้ำหนักเพดาน = 100,999,999", flatAt("101.00"), flat("999999.999")],
  ])("%s → amountMax ที่ lines.0.weight_g และไม่นับ", (_label, metals, line) => {
    expect(quoteBuy(base({ metals, lines: [line], payments: [] }))).toStrictEqual(
      onlyError("lines.0.weight_g", BUY_MSG.amountMax),
    );
  });

  it.each<[string, Record<string, BuyMetal>, BuyLineInput, QuotedLine]>([
    [
      "ฐาน 99,999,999 × 1 กรัม = 99,999,999 (ยอดบาทเต็มสูงสุดที่รับ)",
      flatAt("99999999.00"),
      flat("1"),
      flatRow(0, "1.000", "99999999.00", "99999999.00", "99999999.00"),
    ],
    [
      // ⌊99,999,999.99⌋ = 99,999,999 — ฐานเท่าเพดานพอดีแต่ราคา/กรัมปัดลงแล้วไม่เกิน
      "ฐาน 99,999,999.99 × 1 กรัม → ราคา/กรัม ⌊99,999,999.99⌋ = 99,999,999",
      flatAt("99999999.99"),
      flat("1"),
      row(
        0,
        PLATINUM,
        ["1.000", "100.00", "0"],
        ["99999999.99", "99999999.00", "99999999.00", "0.00", "99999999.00", "99999999.00"],
      ),
    ],
    [
      // ⌊4,437 × 22,537.75⌋ = ⌊99,999,996.75⌋ · ÷ 22,537.75 = 4,436.99996… → 4,437.00
      "ทอง 100% 22,537.750 กรัม = 99,999,996",
      METALS,
      sample({ weightG: "22537.750", purityPercent: "100", deductPercent: "0" }),
      row(
        0,
        GOLD,
        ["22537.750", "100.00", "0"],
        ["67650.00", "4437.00", "99999996.00", "0.00", "99999996.00", "4437.00"],
      ),
    ],
    [
      // ยอดก่อนหัก 100,000,000 เกินเพดาน แต่สุทธิ ⌊100,000,000 × 99%⌋ = 99,000,000 ไม่เกิน — เพดานตรวจที่ยอดที่จ่ายจริง
      "ฐาน 100,000,000 หัก 1% → สุทธิ 99,000,000",
      flatAt("100000000.00"),
      flat("1", "1"),
      row(
        0,
        PLATINUM,
        ["1.000", "100.00", "1"],
        ["100000000.00", "100000000.00", "100000000.00", "1000000.00", "99000000.00", "99000000.00"],
      ),
    ],
  ])("%s → ใช้ได้", (_label, metals, line, want) => {
    expect(quoteBuy(base({ metals, lines: [line], payments: [cash(want.amount)] }))).toStrictEqual(paidInFull(want));
  });

  it("เพดานเป็นต่อแถว ไม่ใช่ต่อบิล: 50 แถว (สูงสุดที่ API รับ) ที่น้ำหนักเพดาน → ใช้ได้ ยอดรวมยังพอดี numeric ใน DB", () => {
    // ฐาน 100 บาท/กรัม: ⌊100 × 999,999.999⌋ = ⌊99,999,999.9⌋ = 99,999,999 ต่อแถว
    const r = quoteBuy(
      base({
        metals: flatAt("100.00"),
        lines: Array.from({ length: 50 }, () => flat("999999.999")),
        payments: [cash("4999999950")],
      }),
    );
    expect(r.errors).toStrictEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lines.map((l) => l.index)).toStrictEqual(Array.from({ length: 50 }, (_, i) => i));
    // ต่อแถว: 99,999,999 ÷ 999,999.999 = 99.9999991 → 100.00
    expect(r.lines.map((l) => [l.amount, l.pricePerG])).toStrictEqual(
      Array.from({ length: 50 }, () => ["99999999.00", "100.00"]),
    );
    expect(r.payments).toStrictEqual([payRow(0, "cash", "4999999950.00")]);
    expect([r.totalWeight, r.totalAmount, r.avgPricePerG, r.paid, r.balance]).toStrictEqual([
      "49999999.950", // 50 × 999,999.999 — 8 หลักหน้าจุด ≤ 9 ของ numeric(12,3)
      "4999999950.00", // 50 × 99,999,999 — 10 หลักหน้าจุด ≤ 12 ของ numeric(14,2)
      "100.00", // 4,999,999,950 ÷ 49,999,999.95 = 99.9999991 → 100.00
      "4999999950.00",
      "0.00",
    ]);
  });
});

// ── วิธีชำระ ───────────────────────────────────────────────────────────────────────────────────────────
const UNPAID = err("payments", BUY_MSG.unbalanced("41535.00")); // แถวชำระไม่ถูกนับ → ค้างเต็มยอดบิลตัวอย่าง
const NOT_COUNTED = { payments: [], paid: "0.00", balance: "41535.00" };

describe("quoteBuy — วิธีชำระ: กลุ่มสมมูลของค่า method (PAYMENT_METHODS · isPaymentMethod)", () => {
  it("ข้อความเดียวกับระบบเดิม (02 §3.4)", () => {
    expect(BUY_MSG.paymentMethod).toBe("กรุณาเลือกประเภทเงินที่ชำระ");
  });

  // เงินสดไม่มีธนาคาร · โอนต้องมีธนาคาร (dev PR #53)
  it.each<[PaymentMethod, string | null]>([
    ["cash", null],
    ["transfer", "KBANK"],
  ])("%s (ธนาคาร %s) → วิธีที่รับได้ ชำระครบ ok", (method, bank) => {
    expect(isPaymentMethod(method)).toBe(true);
    expect(quoteBuy(base({ payments: [{ method, bank, amount: "41535" }] }))).toStrictEqual({
      ...SAMPLE_OK,
      payments: [payRow(0, method, "41535.00", bank)],
    });
  });

  it.each<[string, unknown]>([
    ["สตริงว่าง", ""],
    ["วิธีที่ไม่รู้จัก", "cheque"],
    ["ตัวพิมพ์ต่าง", "Cash"],
    ["มีช่องว่างหัวท้าย — key ต้องตรงตัว ไม่ตัดให้", " cash "],
    ["key ของ prototype: toString", "toString"],
    ["key ของ prototype: __proto__", "__proto__"],
    ["key ของ prototype: constructor", "constructor"],
    ["key ของ prototype: hasOwnProperty", "hasOwnProperty"],
    ["null (cast)", null],
    ["undefined (cast)", undefined],
    ["ตัวเลข (cast)", 1],
    ["boolean (cast)", true],
    ['อาร์เรย์ ["cash"] (cast) — ถ้าไม่เช็กชนิด key จะถูกแปลงเป็น "cash"', ["cash"]],
    ['String object ของ "cash" (cast)', new String("cash")],
    ['object ที่ toString() ได้ "cash" (cast)', { toString: () => "cash" }],
  ])("%s → กรุณาเลือกประเภทเงินที่ชำระ · แถวไม่ถูกนับ", (_label, method) => {
    expect(isPaymentMethod(method)).toBe(false);
    expect(quoteBuy(base({ payments: [{ method: method as string, amount: "41535" }] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments.0.method", BUY_MSG.paymentMethod), UNPAID],
      ...NOT_COUNTED,
    });
  });

  it('แถวที่วิธีผิดไม่ถึงด่านวิธีซ้ำ: สองแถววิธีว่าง → แจ้ง "เลือกวิธี" ทั้งสองแถว ไม่ขึ้น "ซ้ำ"', () => {
    expect(
      quoteBuy(
        base({
          payments: [
            { method: "", amount: "20000" },
            { method: "", amount: "21535" },
          ],
        }),
      ),
    ).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [
        err("payments.0.method", BUY_MSG.paymentMethod),
        err("payments.1.method", BUY_MSG.paymentMethod),
        UNPAID,
      ],
      ...NOT_COUNTED,
    });
  });
});

describe("quoteBuy — แถวชำระ: ตารางตัดสินใจ วิธี × จำนวนเงิน (แจ้งครบทุกช่องของแถว ไม่หยุดที่ช่องแรก)", () => {
  it("วิธีถูก · เงินถูก → นับเป็นยอดชำระ", () => {
    expect(quoteBuy(base({ payments: [{ method: "cash", amount: "41535" }] }))).toStrictEqual(SAMPLE_OK);
  });

  // ทุกกฎที่เหลือ: แถวไม่ถูกนับ · ข้อผิดของช่อง method มาก่อน amount เสมอ
  it.each<[string, string, string, QuoteError[]]>([
    ["วิธีผิด · เงินถูก", "", "41535", [err("payments.0.method", BUY_MSG.paymentMethod), UNPAID]],
    ["วิธีถูก · เงินว่าง", "cash", "", [err("payments.0.amount", BUY_MSG.paymentAmount), UNPAID]],
    ["วิธีถูก · เงินทศนิยมเกิน", "cash", "41535.001", [err("payments.0.amount", BUY_MSG.amountScale), UNPAID]],
    [
      "วิธีผิด · เงินว่าง",
      "",
      "",
      [err("payments.0.method", BUY_MSG.paymentMethod), err("payments.0.amount", BUY_MSG.paymentAmount), UNPAID],
    ],
    [
      "วิธีผิด · เงินติดลบ",
      "cheque",
      "-1",
      [err("payments.0.method", BUY_MSG.paymentMethod), err("payments.0.amount", BUY_MSG.paymentAmount), UNPAID],
    ],
    [
      "วิธีผิด · เงินทศนิยมเกิน",
      "cheque",
      "41535.001",
      [err("payments.0.method", BUY_MSG.paymentMethod), err("payments.0.amount", BUY_MSG.amountScale), UNPAID],
    ],
  ])("%s", (_label, method, amount, errors) => {
    expect(quoteBuy(base({ payments: [{ method, amount }] }))).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors,
      ...NOT_COUNTED,
    });
  });
});

// ── ธนาคาร ─────────────────────────────────────────────────────────────────────────────────────────────
describe("quoteBuy — ธนาคาร: ตัดช่องว่างหัวท้ายทั้งในแถวที่บันทึกและในกุญแจวิธีซ้ำ · ว่าง = null", () => {
  it.each<[string, string, string]>([
    ["ช่องว่างหัวท้าย", "KBANK", " KBANK "],
    ["tab/ขึ้นบรรทัด", "KBANK", "\tKBANK\n"],
    ["NBSP จากการคัดลอกหน้าเว็บ", "KBANK", " KBANK "],
  ])("โอน · ธนาคาร%s → %j", (_label, kept, bank) => {
    expect(quoteBuy(base({ payments: [{ method: "transfer", bank, amount: "41535" }] }))).toStrictEqual({
      ...SAMPLE_OK,
      payments: [payRow(0, "transfer", "41535.00", kept)],
    });
  });

  it.each<[string, string | null | undefined]>([
    ["มีแต่ช่องว่าง", "   "],
    ["มีแต่ tab/ขึ้นบรรทัด", "\t\n"],
    ["NBSP ล้วน", " "],
    ["สตริงว่าง", ""],
    ["null", null],
    ["ไม่ส่ง (undefined)", undefined],
  ])("เงินสด · ธนาคาร%s → null", (_label, bank) => {
    expect(quoteBuy(base({ payments: [{ method: "cash", bank, amount: "41535" }] }))).toStrictEqual(SAMPLE_OK);
  });

  // สองแถว 20,000 + 21,535 ที่ธนาคารต่างกันแค่ช่องว่างหัวท้าย = กุญแจเดียวกัน → แถวหลังซ้ำ ไม่นับ
  it.each<[string, PaymentMethod, string | null, string | null | undefined, string | null | undefined]>([
    ['โอน " KBANK " กับ "KBANK"', "transfer", "KBANK", " KBANK ", "KBANK"],
    ['โอน "KBANK" กับ "\\tKBANK\\n"', "transfer", "KBANK", "KBANK", "\tKBANK\n"],
    ['โอน NBSP+KBANK กับ "KBANK "', "transfer", "KBANK", " KBANK", "KBANK "],
    ['เงินสด "   " กับ null', "cash", null, "   ", null],
    ['เงินสด "\\t" กับไม่ส่ง bank', "cash", null, "\t", undefined],
  ])("%s → ซ้ำ · เก็บแถวแรกเป็น %s ธนาคาร %j", (_label, method, kept, first, second) => {
    expect(
      quoteBuy(
        base({
          payments: [
            { method, bank: first, amount: "20000" },
            { method, bank: second, amount: "21535" },
          ],
        }),
      ),
    ).toStrictEqual({
      ...SAMPLE_OK,
      ok: false,
      errors: [err("payments.1.method", BUY_MSG.paymentDup), err("payments", BUY_MSG.unbalanced("21535.00"))],
      payments: [payRow(0, method, "20000.00", kept)],
      paid: "20000.00",
      balance: "21535.00",
    });
  });

  it('ตัดช่องว่างแล้วยังคนละธนาคาร (" KBANK " กับ " SCB ") → ไม่ซ้ำ · เก็บชื่อที่ตัดแล้ว', () => {
    expect(
      quoteBuy(
        base({
          payments: [
            { method: "transfer", bank: " KBANK ", amount: "20000" },
            { method: "transfer", bank: " SCB ", amount: "21535" },
          ],
        }),
      ),
    ).toStrictEqual({
      ...SAMPLE_OK,
      payments: [payRow(0, "transfer", "20000.00", "KBANK"), payRow(1, "transfer", "21535.00", "SCB")],
    });
  });
});

// ── pricePerGram / avgPricePerG ────────────────────────────────────────────────────────────────────────
describe("pricePerGram — ราคา ÷ น้ำหนัก HALF_UP 2 ตำแหน่ง (สูตรเดียว: ต่อแถว · ใบรับซื้อ · ราคาเฉลี่ย)", () => {
  // ผลเป็น Decimal — เทียบด้วย toString() ที่แสดงค่าจริงทุกหลัก ไม่ใช้ toFixed(2) ซึ่งปัดเองจนซ่อนขั้นปัดที่หายไป
  it.each([
    // [ราคา, น้ำหนัก, ผลหารจริง, ที่ต้องได้]
    ["12.44", "10", "1.244", "1.24"], // …4 → ลง (CEIL/UP จะได้ 1.25)
    ["12.45", "10", "1.245", "1.25"], // …5 → ขึ้น (HALF_EVEN/HALF_DOWN จะได้ 1.24)
    ["12.46", "10", "1.246", "1.25"], // …6 → ขึ้น (FLOOR/DOWN จะได้ 1.24)
    ["0.04", "10", "0.004", "0"], // ปัดเหลือศูนย์
    ["0.05", "10", "0.005", "0.01"], // HALF_EVEN/FLOOR → 0
    ["0.06", "10", "0.006", "0.01"],
    ["1", "8", "0.125", "0.13"],
    ["1", "3", "0.333…", "0.33"], // ผลหารไม่รู้จบ
    ["2", "3", "0.666…", "0.67"],
    ["41535", "10", "4153.5", "4153.5"], // บิลตัวอย่าง
    ["11133", "271.56", "40.9964…", "41"], // เงินตัวอย่าง
    ["99999999", "0.001", "99999999000", "99999999000"], // ยอดบาทเต็มสูงสุด ÷ น้ำหนักเล็กสุด
  ])("%s ÷ %s = %s → %s", (amount, weight, _exact, expected) => {
    expect(pricePerGram(new Decimal(amount), new Decimal(weight)).toString()).toBe(expected);
  });
});

describe("avgPricePerG — ยอดรวม ÷ น้ำหนักรวม HALF_UP 2 · น้ำหนักรวม ≤ 0 → 0.00 · รับคอมมา", () => {
  it.each([
    ["0", "บนขอบพอดี"],
    ["0.000", "ศูนย์ที่มีทศนิยม"],
    ["-0", "ลบศูนย์"],
    ["-0.001", "ต่ำกว่าศูนย์ 1 ขั้น"],
    ["-5", "ติดลบ"],
    ["-1,000", "ติดลบและมีคอมมา"],
  ])("น้ำหนักรวม %j (%s) → 0.00 ไม่หาร", (weight) => {
    expect(avgPricePerG("100", weight)).toBe("0.00");
  });

  it.each([
    // [ยอดรวม, น้ำหนักรวม, ที่ต้องได้]
    ["1", "0.001", "1000.00"], // เหนือศูนย์ 1 ขั้น: 1 ÷ 0.001 = 1,000
    ["12.44", "10", "1.24"], // …4
    ["12.45", "10", "1.25"], // …5 (HALF_EVEN → 1.24)
    ["12.46", "10", "1.25"], // …6
    ["0", "5.860", "0.00"], // ยอดศูนย์
    ["52,668.00", "281.560", "187.06"], // 52,668 ÷ 281.56 = 187.0578… → 187.06
    ["41,535", "10.000", "4153.50"],
    ["1,000,000.00", "1,000", "1000.00"], // คอมมาทั้งสองช่อง: 1,000,000 ÷ 1,000
    [" 41535 ", " 10 ", "4153.50"], // ช่องว่างหัวท้าย
  ])("%j ÷ %j → %s", (amount, weight, expected) => {
    expect(avgPricePerG(amount, weight)).toBe(expected);
  });

  it("รับ Decimal ตรง ๆ (เส้นทางที่ quoteBuy ส่งเข้า)", () => {
    expect(avgPricePerG(new Decimal("41535"), new Decimal("10"))).toBe("4153.50");
    expect(avgPricePerG(new Decimal("100"), new Decimal("0"))).toBe("0.00");
  });
});

describe("quoteBuy — index · ราคาเฉลี่ย/กรัม · แถวชำระที่บันทึก", () => {
  it("index = ตำแหน่งใน input แม้แถวก่อนหน้าผิดและถูกข้าม", () => {
    const r = quoteBuy(base({ lines: [sample({ weightG: "0" }), sample({ weightG: "10.000" })] }));
    expect(r.lines).toStrictEqual([{ ...SAMPLE_LINE, index: 1 }]);
    expect(r.errors.map((e) => e.field)).toStrictEqual(["lines.0.weight_g"]);
  });

  it("ราคาเฉลี่ย/กรัม = ยอดรวม ÷ น้ำหนักรวม ปัดครึ่งขึ้น 2 ตำแหน่ง (ระบบเดิม sum_price) — ใช้ซ้ำกับบิลที่บันทึกแล้วได้ค่าเดียวกัน", () => {
    const q = quoteBuy(base({ lines: [sample(), silver()], payments: [cash("52668")] }));
    expect(q.avgPricePerG).toBe("187.06"); // 52,668 ÷ 281.56 = 187.0578…
    expect(avgPricePerG(q.totalAmount, q.totalWeight)).toBe(q.avgPricePerG);
    expect(quoteBuy(base()).avgPricePerG).toBe("4153.50");
  });

  it("ไม่มีแถวที่ถูกต้อง → ราคาเฉลี่ย 0.00 (ไม่หารด้วยศูนย์)", () => {
    expect(quoteBuy(base({ lines: [], payments: [] })).avgPricePerG).toBe("0.00");
  });

  it("แถวชำระที่ถูกต้องออกมาในรูปมาตรฐาน — ตัดคอมมา · ธนาคารว่าง = null", () => {
    const r = quoteBuy(
      base({
        payments: [
          { method: "cash", bank: "  ", amount: "20,000" },
          { method: "transfer", bank: " KBANK ", amount: "21535" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.payments).toStrictEqual([payRow(0, "cash", "20000.00"), payRow(1, "transfer", "21535.00", "KBANK")]);
  });

  it("payments: index = ตำแหน่งใน input แม้แถวก่อนหน้าผิดและถูกข้าม (เหมือน lines)", () => {
    const r = quoteBuy(
      base({
        payments: [
          { method: "cheque", amount: "999" }, // วิธีไม่รู้จัก — ถูกข้าม
          { method: "cash", amount: "41535" },
        ],
      }),
    );
    expect(r.payments).toStrictEqual([payRow(1, "cash", "41535.00")]);
    expect(r.errors.map((e) => e.field)).toStrictEqual(["payments.0.method"]);
  });
});

describe("quoteBuy — วิธีชำระ", () => {
  it.each([
    [{ method: "transfer", amount: "41535" }, BUY_MSG.bankRequired],
    [{ method: "transfer", bank: "   ", amount: "41535" }, BUY_MSG.bankRequired],
    [{ method: "cash", bank: "KBANK", amount: "41535" }, BUY_MSG.cashNoBank],
  ])("ธนาคารไม่เข้ากับวิธี %j → %s · ไม่นับยอด", (p, message) => {
    const r = quoteBuy(base({ payments: [p] }));
    expect(r.errors[0]).toStrictEqual({ field: "payments.0.bank", message });
    expect(r.paid).toBe("0.00");
    expect(r.ok).toBe(false);
  });
  it("โอนระบุธนาคาร · เงินสดไม่ระบุ → ผ่าน", () => {
    const r = quoteBuy(
      base({
        payments: [
          { method: "transfer", bank: "SCB", amount: "41000" },
          { method: "cash", bank: null, amount: "535" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });
  it("ไม่เลือกวิธี + ไม่กรอกเงิน → แจ้งทั้งสองช่อง", () => {
    const r = quoteBuy(base({ payments: [{ method: "", amount: "" }] }));
    expect(r.errors.map((e) => e.field)).toStrictEqual(["payments.0.method", "payments.0.amount", "payments"]);
  });
  it("PAYMENT_METHODS: เงินสด · โอนเงิน", () => {
    expect(PAYMENT_METHODS).toStrictEqual({ cash: "เงินสด", transfer: "โอนเงิน" });
    expect(isPaymentMethod("cash")).toBe(true);
    expect(isPaymentMethod("toString")).toBe(false); // ไม่หลุดไปเจอ prototype
  });
});

describe("BUY_MSG — ข้อความของช่องใหม่ (โลหะ · ค่าบริสุทธิ์ · หัก % · ยอดที่คิดได้) พิมพ์ตรงตัว", () => {
  it("ราคาของวัน/วิธีคิดราคาบอกชื่อโลหะ · ทองใช้ข้อความเดียวกับ R7", () => {
    expect(BUY_MSG.unknownMetal).toBe("ไม่พบประเภทโลหะ");
    expect(BUY_MSG.noPricing("ทองแดง")).toBe("ยังไม่ได้กำหนดวิธีคิดราคาของทองแดง");
    expect(BUY_MSG.noMetalPrice("เงิน")).toBe("ยังไม่ได้ตั้งราคาเงินของวันนี้");
    expect(BUY_MSG.noMetalPrice("ทอง")).toBe(BUY_MSG.noGoldPrice);
  });

  it("ค่าบริสุทธิ์ · หัก % บอกช่วงที่รับ", () => {
    expect(BUY_MSG.purityRequired).toBe("กรุณากรอกค่าบริสุทธิ์ (%)");
    expect(BUY_MSG.purityInvalid).toBe("ค่าบริสุทธิ์ต้องเป็นตัวเลข 1–100 ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 96.5");
    expect(BUY_MSG.deductInvalid).toBe("หัก % ต้องเป็นเลขจำนวนเต็ม 0–10");
  });

  it("ยอดที่คิดได้เป็น 0 / เกินเพดาน ชี้ให้ตรวจน้ำหนัก (ราคาไม่ได้พิมพ์เองแล้ว)", () => {
    expect(BUY_MSG.amountZero).toBe("ราคาที่คิดได้เป็น 0 บาท — ตรวจน้ำหนักและค่าบริสุทธิ์");
    expect(BUY_MSG.amountMax).toBe("ราคาที่คิดได้เกิน 99,999,999.99 บาท — ตรวจน้ำหนักอีกครั้ง");
    expect(Object.hasOwn(BUY_MSG, "amountPositive")).toBe(false); // ราคาไม่ได้พิมพ์เองแล้ว
  });
});

describe("normalizeBuyLine — แถวที่กรอก → รูปมาตรฐานเดียวกับ quoteBuy (เทียบเนื้อบิลตอนกดซ้ำ ไม่ต้องรู้ราคาของวัน)", () => {
  it.each<[string, BuyLineInput, { weightG: string; purityPercent: string; deductPercent: string }]>([
    ["บิลตัวอย่าง", sample(), { weightG: "10.000", purityPercent: "96.50", deductPercent: "3" }],
    [
      "เว้นวรรคหัวท้ายทุกช่อง",
      sample({ weightG: " 5.86 ", purityPercent: " 100 ", deductPercent: " 10 " }),
      { weightG: "5.860", purityPercent: "100.00", deductPercent: "10" },
    ],
    [
      "หัก % ไม่ส่ง → 0",
      { metalId: GOLD, weightG: "1", purityPercent: "75" },
      { weightG: "1.000", purityPercent: "75.00", deductPercent: "0" },
    ],
    [
      "หัก % null → 0",
      sample({ deductPercent: null }),
      { weightG: "10.000", purityPercent: "96.50", deductPercent: "0" },
    ],
    ['หัก % "" → 0', sample({ deductPercent: "" }), { weightG: "10.000", purityPercent: "96.50", deductPercent: "0" }],
    [
      'หัก % "03" → 3',
      sample({ deductPercent: "03" }),
      { weightG: "10.000", purityPercent: "96.50", deductPercent: "3" },
    ],
    [
      'หัก % "00" → 0',
      sample({ deductPercent: "00" }),
      { weightG: "10.000", purityPercent: "96.50", deductPercent: "0" },
    ],
    [
      "ค่าบริสุทธิ์ศูนย์ท้าย 96.550 → 96.55",
      sample({ purityPercent: "96.550" }),
      { weightG: "10.000", purityPercent: "96.55", deductPercent: "3" },
    ],
    [
      "ค่าบริสุทธิ์ขอบล่าง 1 → 1.00",
      sample({ purityPercent: "1" }),
      { weightG: "10.000", purityPercent: "1.00", deductPercent: "3" },
    ],
    [
      "น้ำหนักเล็กสุด 0.001",
      sample({ weightG: "0.001" }),
      { weightG: "0.001", purityPercent: "96.50", deductPercent: "3" },
    ],
    [
      "น้ำหนักศูนย์ท้ายเกิน 5.8600 → 5.860",
      sample({ weightG: "5.8600" }),
      { weightG: "5.860", purityPercent: "96.50", deductPercent: "3" },
    ],
  ])("%s", (_label, line, want) => {
    expect(normalizeBuyLine(line)).toStrictEqual({ metalId: line.metalId, ...want });
  });

  it("metalId ส่งผ่านตรงตัว (ไม่ตรวจกับรายการโลหะ — ไม่มี metals ในอินพุต)", () => {
    expect(normalizeBuyLine(sample({ metalId: "ไม่ใช่ uuid" }))?.metalId).toBe("ไม่ใช่ uuid");
  });

  it.each<[string, Partial<BuyLineInput>]>([
    ["น้ำหนักว่าง", { weightG: "" }],
    ["น้ำหนักตัวอักษร", { weightG: "abc" }],
    ["น้ำหนักมีคอมมา", { weightG: "5,860" }],
    ["น้ำหนักติดลบ", { weightG: "-1" }],
    ["น้ำหนัก exponent", { weightG: "1e3" }],
    ["ค่าบริสุทธิ์ว่าง", { purityPercent: "" }],
    ["ค่าบริสุทธิ์ใต้ขอบล่าง 0.99", { purityPercent: "0.99" }],
    ["ค่าบริสุทธิ์เหนือขอบบน 100.01", { purityPercent: "100.01" }],
    ["ค่าบริสุทธิ์ 3 ตำแหน่ง", { purityPercent: "96.555" }],
    ["ค่าบริสุทธิ์คอมมา", { purityPercent: "96,5" }],
    ["หัก % เกิน 10", { deductPercent: "11" }],
    ["หัก % ทศนิยม", { deductPercent: "1.5" }],
    ["หัก % ติดลบ", { deductPercent: "-1" }],
    ["หัก % เป็นตัวเลข JSON (cast)", { deductPercent: 3 as unknown as string }],
  ])("%s → null (ตัวแยกเดียวกับ quoteBuy)", (_label, over) => {
    expect(normalizeBuyLine(sample(over))).toBeNull();
    // quoteBuy ก็ปฏิเสธแถวเดียวกัน
    expect(quoteBuy(base({ lines: [sample(over)], payments: [] })).lines).toStrictEqual([]);
  });

  it("แถวที่ quoteBuy รับ → รูปมาตรฐานตรงกับช่องเดียวกันใน QuotedLine", () => {
    const line = sample({ weightG: " 5.86 ", purityPercent: "96.500", deductPercent: "03" });
    const q = quoteBuy(base({ lines: [line], payments: [] })).lines[0];
    expect(normalizeBuyLine(line)).toStrictEqual({
      metalId: q?.metalId,
      weightG: q?.weightG,
      purityPercent: q?.purityPercent,
      deductPercent: q?.deductPercent,
    });
  });

  // F18 (แก้แล้ว): น้ำหนักที่ quoteBuy ปฏิเสธต้องไม่ถูก fmtWeight ปัดเป็นค่าที่ใช้ได้ — ไม่งั้น body ที่ผิดรูป "1.2345"
  // ได้กุญแจเดียวกับบิลที่บันทึกไว้ "1.235" (sameBill ของ api ถือว่าเป็นบิลเดิม) · ใช้ weightError ตัวเดียวกับ quoteBuy
  it.each<[string, string, string]>([
    ["F18 น้ำหนักทศนิยม 4 ตำแหน่ง → null ไม่ใช่ปัดเป็น 1.235", "1.2345", BUY_MSG.weightScale],
    ["น้ำหนัก 0 → null ไม่ใช่ 0.000", "0", BUY_MSG.weightPositive],
    ["น้ำหนักเกินเพดาน 1,000,000 → null", "1000000", BUY_MSG.weightMax],
  ])("%s", (_label, weightG, message) => {
    expect(quoteBuy(base({ lines: [sample({ weightG })], payments: [] })).errors).toStrictEqual([
      err("lines.0.weight_g", message),
    ]);
    expect(normalizeBuyLine(sample({ weightG }))).toBeNull();
  });
});
