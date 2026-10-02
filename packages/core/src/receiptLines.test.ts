import { describe, expect, it } from "vitest";
import { avgPricePerG, pricePerGram, quoteBuy, type BuyLineInput, type BuyMetal } from "./buy";
import { ReceiptDataError } from "./errors";
import { D, fmtMoney } from "./money";
import { groupLinesByMetal, receiptLineLabel, type ReceiptLine } from "./receiptLines";

// ออกแบบตาม ISO/IEC/IEEE 29119-4: แบ่งกลุ่มสมมูล (บิลเก่าไม่มีค่าบริสุทธิ์ · บิลใหม่ · หัก 0 / หัก > 0) + ค่าขอบ
// (น้ำหนักรวม −0.001 | 0 | 0.001 · ราคาต่อหน่วย …4/…5/…6) · เดาข้อผิดพลาด (รูปตัวเลขจาก DB "96.500" / "3.00" ·
// ตัวเลขเสีย) — ค่าคาดหวังคิดมือ ไม่ได้คัดจากผลรันโค้ด

const GOLD = "11111111-1111-1111-1111-111111111111";
const PLATINUM = "44444444-4444-4444-4444-444444444444";
// ราคาของวัน: ทองแท่งรับซื้อ 67,650 → ทอง 96.5% ราคา/กรัม ⌊67,650 × 0.0656 × 0.965⌋ = 4,282
const METALS: Record<string, BuyMetal> = {
  [GOLD]: { code: "gold", nameTh: "ทอง", basePrice: "67650.00" },
  [PLATINUM]: { code: "platinum", nameTh: "แพลตตินั่ม", basePrice: "1000.00" },
};
/** บิลเก่า (ก่อนมีช่องค่าบริสุทธิ์ — ราคาพิมพ์เอง) */
const legacy = (metalName: string, weightG: string, amount: string): ReceiptLine => ({ metalName, weightG, amount });
/** บิลใหม่: ค่าบริสุทธิ์/หัก % ตามที่ DB คืน */
const graded = (
  metalName: string,
  purityPercent: string,
  deductPercent: string,
  weightG: string,
  amount: string,
): ReceiptLine => ({ metalName, weightG, amount, purityPercent, deductPercent });

describe("receiptLineLabel — ชื่อรายการบนใบ: โลหะ + ค่าบริสุทธิ์ + หัก % (หัก 0 ไม่พิมพ์)", () => {
  it.each<[string, Pick<ReceiptLine, "metalName" | "purityPercent" | "deductPercent">, string]>([
    ["รูปที่ quoteBuy คืน", { metalName: "ทอง", purityPercent: "96.50", deductPercent: "3" }, "ทอง 96.5% หัก 3%"],
    [
      "รูปที่ DB คืน numeric(6,3)/(5,2)",
      { metalName: "ทอง", purityPercent: "96.500", deductPercent: "3.00" },
      "ทอง 96.5% หัก 3%",
    ],
    ["หัก 0 ไม่พิมพ์", { metalName: "ทอง", purityPercent: "96.5", deductPercent: "0" }, "ทอง 96.5%"],
    ["หัก 0.00 จาก DB ไม่พิมพ์", { metalName: "ทอง", purityPercent: "100.000", deductPercent: "0.00" }, "ทอง 100%"],
    ["หัก null (มีค่าบริสุทธิ์) = ไม่หัก", { metalName: "ทอง", purityPercent: "75", deductPercent: null }, "ทอง 75%"],
    ["หักไม่ส่ง (มีค่าบริสุทธิ์) = ไม่หัก", { metalName: "นาก", purityPercent: "40.00" }, "นาก 40%"],
    ["หักขอบบน 10", { metalName: "เงิน", purityPercent: "92.50", deductPercent: "10" }, "เงิน 92.5% หัก 10%"],
    ["หักขอบล่างที่พิมพ์ 1", { metalName: "ทอง", purityPercent: "99.99", deductPercent: "1" }, "ทอง 99.99% หัก 1%"],
    ["ค่าบริสุทธิ์ขอบล่าง 1", { metalName: "ทอง", purityPercent: "1.000", deductPercent: "0.00" }, "ทอง 1%"],
    [
      "บิลเก่า: ค่าบริสุทธิ์ null → ชื่อโลหะอย่างเดียว",
      { metalName: "ทอง", purityPercent: null, deductPercent: null },
      "ทอง",
    ],
    ["บิลเก่า: ไม่ส่งทั้งสองช่อง", { metalName: "เงิน" }, "เงิน"],
    [
      "ค่าบริสุทธิ์ null แต่มีหัก → ยังเป็นบิลเก่า ไม่พิมพ์หัก",
      { metalName: "ทอง", purityPercent: null, deductPercent: "3" },
      "ทอง",
    ],
  ])("%s → %j", (_label, line, want) => {
    expect(receiptLineLabel(line)).toBe(want);
  });

  it.each<[Pick<ReceiptLine, "metalName" | "purityPercent" | "deductPercent">, string]>([
    [{ metalName: "ทอง", purityPercent: "abc", deductPercent: "3" }, 'ค่าบริสุทธิ์ไม่ใช่ตัวเลข: "abc"'],
    [{ metalName: "ทอง", purityPercent: "", deductPercent: "3" }, 'ค่าบริสุทธิ์ไม่ใช่ตัวเลข: ""'], // ว่าง ≠ null — ไม่เดาว่าเป็นบิลเก่า
    [{ metalName: "ทอง", purityPercent: "96.5", deductPercent: "x" }, 'หัก %ไม่ใช่ตัวเลข: "x"'],
    [{ metalName: "ทอง", purityPercent: "96.5", deductPercent: "Infinity" }, 'หัก %ไม่ใช่ตัวเลข: "Infinity"'],
  ])("%j → ReceiptDataError บอกช่องที่เสีย (ไม่พิมพ์ % มั่วลงใบ)", (line, message) => {
    expect(() => receiptLineLabel(line)).toThrow(new ReceiptDataError(message));
  });
});

describe("groupLinesByMetal — บิลเก่า (ไม่มีค่าบริสุทธิ์): 1 บรรทัดต่อโลหะ เหมือนใบจริง", () => {
  it("RC6909-0010: ทอง 3 ก้อน → 1 บรรทัด 5.860 ก. · 3,418.09/ก. · 20,030.00 (Django BuyReceiptGroupingTest)", () => {
    const rows = groupLinesByMetal([
      legacy("ทอง", "2.000", "8000"),
      legacy("ทอง", "1.860", "6000"),
      legacy("ทอง", "2.000", "6030"),
    ]);
    expect(rows).toStrictEqual([{ label: "ทอง", weightG: "5.860", unitPrice: "3418.09", amount: "20030.00" }]);
  });

  it("หลายโลหะ: เรียงตามลำดับที่ปรากฏครั้งแรก", () => {
    const rows = groupLinesByMetal([
      legacy("เงิน", "100.5", "3000"),
      legacy("ทอง", "1", "3400.50"),
      legacy("เงิน", "0.5", "15"),
    ]);
    expect(rows).toStrictEqual([
      { label: "เงิน", weightG: "101.000", unitPrice: "29.85", amount: "3015.00" }, // 3,015 ÷ 101 = 29.851…
      { label: "ทอง", weightG: "1.000", unitPrice: "3400.50", amount: "3400.50" },
    ]);
  });

  it("ผลรวมและราคาต่อหน่วยเป็น decimal ไม่ใช่ float", () => {
    // 0.1 + 0.2 ใน float = 0.30000000000000004 · 10.05 ÷ 2 ใน float = 5.02499… → ปัดผิดเป็น 5.02
    const rows = groupLinesByMetal([
      legacy("ทอง", "0.1", "5.02"),
      legacy("ทอง", "0.2", "5.03"),
      legacy("นาก", "2.000", "10.05"),
    ]);
    expect(rows).toStrictEqual([
      { label: "ทอง", weightG: "0.300", unitPrice: "33.50", amount: "10.05" },
      { label: "นาก", weightG: "2.000", unitPrice: "5.03", amount: "10.05" },
    ]);
  });

  it("ไม่มีแถว → ไม่มีบรรทัด", () => {
    expect(groupLinesByMetal([])).toStrictEqual([]);
  });
});

describe("groupLinesByMetal — บิลใหม่: 1 บรรทัดต่อ (โลหะ · ค่าบริสุทธิ์ · หัก %) — % ต่างกันพิมพ์แยกบรรทัด", () => {
  it("ทอง 3 ก้อนคนละค่าบริสุทธิ์ (97 · 81 · 75) → 3 บรรทัด ตามลำดับที่กรอก", () => {
    const rows = groupLinesByMetal([
      graded("ทอง", "97.000", "0.00", "2.000", "8000.00"),
      graded("ทอง", "81.000", "0.00", "1.860", "6000.00"),
      graded("ทอง", "75.000", "0.00", "2.000", "6030.00"),
    ]);
    expect(rows).toStrictEqual([
      { label: "ทอง 97%", weightG: "2.000", unitPrice: "4000.00", amount: "8000.00" },
      { label: "ทอง 81%", weightG: "1.860", unitPrice: "3225.81", amount: "6000.00" }, // 6,000 ÷ 1.86 = 3,225.806…
      { label: "ทอง 75%", weightG: "2.000", unitPrice: "3015.00", amount: "6030.00" },
    ]);
  });

  it("ค่าบริสุทธิ์และหัก % เดียวกัน → รวมเป็นบรรทัดเดียว แม้รูปตัวเลขต่างกัน (96.5 / 96.50 / 96.500 · 3 / 3.00)", () => {
    const rows = groupLinesByMetal([
      graded("ทอง", "96.5", "3", "2.000", "8307.00"),
      graded("ทอง", "96.50", "3", "1.860", "7725.00"),
      graded("ทอง", "96.500", "3.00", "2.000", "8307.00"),
    ]);
    // 8,307 + 7,725 + 8,307 = 24,339 · ÷ 5.86 = 4,153.412… → 4,153.41
    expect(rows).toStrictEqual([
      { label: "ทอง 96.5% หัก 3%", weightG: "5.860", unitPrice: "4153.41", amount: "24339.00" },
    ]);
  });

  it("ปนกัน: ค่าบริสุทธิ์ต่าง · หักต่าง · หัก 0 · โลหะอื่น · บิลเก่า — แยกบรรทัดครบ เรียงตามที่ปรากฏครั้งแรก", () => {
    const rows = groupLinesByMetal([
      graded("ทอง", "96.500", "3.00", "10.000", "41535.00"), // A
      graded("ทอง", "90.000", "3.00", "1.000", "3874.00"), // B: บริสุทธิ์ต่าง
      graded("ทอง", "96.500", "0.00", "1.000", "4282.00"), // C: หักต่าง (0 ไม่พิมพ์)
      graded("เงิน", "92.500", "0.00", "271.560", "11133.00"), // D: โลหะอื่น
      legacy("ทอง", "1.000", "3000.00"), // E: บิลเก่าของโลหะเดียวกัน → ไม่ปนกับบรรทัดที่มี %
      graded("ทอง", "96.500", "3.00", "2.000", "8307.00"), // รวมกับ A
      graded("ทอง", "96.500", "10.00", "1.000", "3853.00"), // F: หักต่าง
    ]);
    expect(rows).toStrictEqual([
      // A: 41,535 + 8,307 = 49,842 · 12 กรัม → 4,153.50
      { label: "ทอง 96.5% หัก 3%", weightG: "12.000", unitPrice: "4153.50", amount: "49842.00" },
      { label: "ทอง 90% หัก 3%", weightG: "1.000", unitPrice: "3874.00", amount: "3874.00" },
      { label: "ทอง 96.5%", weightG: "1.000", unitPrice: "4282.00", amount: "4282.00" },
      { label: "เงิน 92.5%", weightG: "271.560", unitPrice: "41.00", amount: "11133.00" }, // 11,133 ÷ 271.56 = 40.996…
      { label: "ทอง", weightG: "1.000", unitPrice: "3000.00", amount: "3000.00" },
      { label: "ทอง 96.5% หัก 10%", weightG: "1.000", unitPrice: "3853.00", amount: "3853.00" },
    ]);
  });
});

describe("ราคา/กรัม สูตรเดียว (CLAUDE.md กฎ 2) — quoteBuy → ใบรับซื้อ ให้ค่าเดียวกันทุกทาง", () => {
  // แพลตตินั่ม (คิดต่อกรัม) บริสุทธิ์ 100 → ราคา/กรัม = ฐาน · ยอด = ⌊⌊ฐาน × กรัม⌋ × (100 − หัก) ÷ 100⌋
  const flat = (weightG: string, deductPercent: string): BuyLineInput => ({
    metalId: PLATINUM,
    weightG,
    purityPercent: "100",
    deductPercent,
  });
  it.each<[string, Record<string, BuyMetal>, BuyLineInput, string, string]>([
    // [กรณี, ราคาของวัน, แถว, สุทธิ (คิดมือ), ราคา/กรัม ที่ทุกทางต้องได้]
    [
      "บิลตัวอย่าง ทอง 96.5% 10 ก. หัก 3%",
      METALS,
      { metalId: GOLD, weightG: "10", purityPercent: "96.5", deductPercent: "3" },
      "41535.00",
      "4153.50",
    ],
    [
      "ครึ่งพอดี 1 ÷ 1.6 = 0.625 (HALF_EVEN → 0.62)",
      { ...METALS, [PLATINUM]: { code: "platinum", nameTh: "แพลตตินั่ม", basePrice: "1.00" } },
      flat("1.6", "0"),
      "1.00",
      "0.63",
    ],
    [
      "21 ÷ 8 = 2.625 (⌊24 × 90%⌋ = 21)",
      { ...METALS, [PLATINUM]: { code: "platinum", nameTh: "แพลตตินั่ม", basePrice: "3.00" } },
      flat("8", "10"),
      "21.00",
      "2.63",
    ],
    [
      "ผลหารไม่รู้จบ 1 ÷ 1.5",
      { ...METALS, [PLATINUM]: { code: "platinum", nameTh: "แพลตตินั่ม", basePrice: "1.00" } },
      flat("1.5", "0"),
      "1.00",
      "0.67",
    ],
    [
      "น้ำหนักเพดาน: 99,999,999 ÷ 999,999.999 = 99.9999991",
      { ...METALS, [PLATINUM]: { code: "platinum", nameTh: "แพลตตินั่ม", basePrice: "100.00" } },
      flat("999999.999", "0"),
      "99999999.00",
      "100.00",
    ],
  ])("%s: pricePerGram · quoteBuy (แถว/เฉลี่ย) · avgPricePerG · ใบรับซื้อ", (_label, metals, line, amount, want) => {
    const q = quoteBuy({ lines: [line], payments: [], customer: null, goldPriceSet: true, metals });
    const quoted = q.lines[0];
    expect(quoted?.amount).toBe(amount);
    expect(quoted?.pricePerG).toBe(want);
    expect(q.avgPricePerG).toBe(want);
    expect(fmtMoney(pricePerGram(D(amount), D(q.totalWeight)))).toBe(want);
    expect(avgPricePerG(amount, q.totalWeight)).toBe(want);
    const printed = groupLinesByMetal([
      {
        metalName: "x",
        weightG: q.totalWeight,
        amount,
        purityPercent: quoted?.purityPercent,
        deductPercent: quoted?.deductPercent,
      },
    ]);
    expect(printed[0]?.unitPrice).toBe(want);
  });

  it("หลายแถว (โลหะ · บริสุทธิ์ · หักเดียวกัน): ราคาเฉลี่ยบนจอ = ราคาต่อหน่วยบนใบรับซื้อ · ชื่อรายการมี %", () => {
    // ราคา/กรัม 4,282 · 2 ก. ⌊8,564 × 97%⌋ = 8,307 · 1.86 ก. ⌊⌊7,964.52⌋ × 97%⌋ = ⌊7,725.08⌋ = 7,725 · 2 ก. 8,307
    const lines = ["2.000", "1.860", "2.000"].map((weightG): BuyLineInput => ({
      metalId: GOLD,
      weightG,
      purityPercent: "96.5",
      deductPercent: "3",
    }));
    const q = quoteBuy({ lines, payments: [], customer: null, goldPriceSet: true, metals: METALS });
    expect(q.lines.map((l) => l.amount)).toStrictEqual(["8307.00", "7725.00", "8307.00"]);
    const printed = groupLinesByMetal(q.lines.map((l) => ({ metalName: "ทอง", ...l })));
    // Σ 24,339 ÷ 5.86 = 4,153.412… → 4,153.41
    expect(q.avgPricePerG).toBe("4153.41");
    expect(printed).toStrictEqual([
      { label: "ทอง 96.5% หัก 3%", weightG: "5.860", unitPrice: q.avgPricePerG, amount: q.totalAmount },
    ]);
  });

  it("น้ำหนักรวม 0: จอแสดง 0.00 (avgPricePerG) · ใบรับซื้อไม่พิมพ์ราคามั่ว (throw)", () => {
    expect(avgPricePerG("100", "0")).toBe("0.00");
    expect(() => groupLinesByMetal([legacy("ทอง", "0", "100")])).toThrow(ReceiptDataError);
  });
});

// ── ด่าน coverage: ค่าขอบราคาต่อหน่วย · น้ำหนักรวมรอบศูนย์ · บรรทัดเดียวเสียทั้งใบ · ข้อความ error ตรงตัว ───────────
const expectReceiptDataError = (run: () => unknown, message: string) => {
  expect(run).toThrow(ReceiptDataError);
  expect(run).toThrow(new ReceiptDataError(message));
};

describe("groupLinesByMetal — ราคาต่อหน่วย HALF_UP 2 ที่หลักที่ถูกตัด …4/…5/…6 (BVA)", () => {
  it.each([
    ["12.44", "1.24"], // 12.44 ÷ 10 = 1.244 → ลง
    ["12.45", "1.25"], // 1.245 เสมอ → ขึ้น (HALF_EVEN ได้ 1.24)
    ["12.46", "1.25"], // 1.246 → ขึ้น
  ])("ทอง 10.000 ก. %s บาท → ราคาต่อหน่วย %s", (amount, unitPrice) => {
    expect(groupLinesByMetal([legacy("ทอง", "10.000", amount)])).toStrictEqual([
      { label: "ทอง", weightG: "10.000", unitPrice, amount },
    ]);
  });
});

describe("groupLinesByMetal — น้ำหนักรวมต่อบรรทัดต้องมากกว่า 0 (BVA −0.001 | 0 | 0.001) · fail-closed ทั้งใบ", () => {
  it("น้ำหนักรวมเล็กสุดที่รับ 0.001 ก. → พิมพ์ได้: 3 บาท ÷ 0.001 = 3,000.00 ต่อกรัม", () => {
    expect(groupLinesByMetal([graded("ทอง", "96.500", "3.00", "0.001", "3")])).toStrictEqual([
      { label: "ทอง 96.5% หัก 3%", weightG: "0.001", unitPrice: "3000.00", amount: "3.00" },
    ]);
  });

  it.each([
    ["0", "บนขอบพอดี"],
    ["0.000", "ศูนย์แบบที่ DB ส่ง"],
    ["-0.001", "ต่ำกว่าศูนย์ 1 ขั้น"],
  ])("น้ำหนักรวม %s (%s) → ReceiptDataError ข้อความตรงตัว (บิลเก่า · บิลใหม่)", (weightG) => {
    expectReceiptDataError(() => groupLinesByMetal([legacy("ทอง", weightG, "100")]), "น้ำหนักรวมของทองต้องมากกว่า 0");
    expectReceiptDataError(
      () => groupLinesByMetal([graded("ทอง", "96.500", "3.00", weightG, "100")]),
      "น้ำหนักรวมของทอง 96.5% หัก 3%ต้องมากกว่า 0",
    );
  });

  it("บรรทัดหนึ่งเสีย ทั้งใบพิมพ์ไม่ได้ — ไม่ออกใบที่ขาดบรรทัด", () => {
    const lines = [legacy("ทอง", "5.860", "20030"), graded("เงิน", "92.500", "0.00", "0", "10")];
    expectReceiptDataError(() => groupLinesByMetal(lines), "น้ำหนักรวมของเงิน 92.5%ต้องมากกว่า 0");
  });

  it.each([
    [{ weightG: "abc", amount: "100" }, 'น้ำหนักไม่ใช่ตัวเลข: "abc"'],
    [{ weightG: "", amount: "100" }, 'น้ำหนักไม่ใช่ตัวเลข: ""'],
    [{ weightG: "1", amount: "" }, 'ราคาไม่ใช่ตัวเลข: ""'],
    [{ weightG: "1", amount: "Infinity" }, 'ราคาไม่ใช่ตัวเลข: "Infinity"'],
  ])("%j → ReceiptDataError บอกช่องที่เสีย", (row, message) => {
    expectReceiptDataError(() => groupLinesByMetal([{ metalName: "ทอง", ...row }]), message);
  });

  it("ค่าบริสุทธิ์เสียในแถวใดแถวหนึ่ง → ReceiptDataError ทั้งใบ", () => {
    expectReceiptDataError(
      () => groupLinesByMetal([legacy("ทอง", "1", "100"), graded("ทอง", "abc", "0", "1", "100")]),
      'ค่าบริสุทธิ์ไม่ใช่ตัวเลข: "abc"',
    );
  });
});
