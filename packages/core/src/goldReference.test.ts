import { describe, expect, it } from "vitest";
import {
  GoldReferenceError,
  parseGoldAnnouncement,
  validateGoldReferencePrices,
  type GoldReferencePrices,
} from "./goldReference";

// ตัวอย่างสมมติรูปแบบเดียวกับประกาศสมาคมค้าทองคำ (แท่ง ส่วนต่าง 200 · รูปพรรณรับซื้อมีทศนิยม)
const SAMPLE = { barBuy: "70,950.00", barSell: "71,150.00", ornamentBuy: "69,523.76", ornamentSell: "71,950.00" };

function errorOf(run: () => unknown): string {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(GoldReferenceError);
    return (e as Error).message;
  }
  throw new Error("ไม่ throw");
}

describe("validateGoldReferencePrices", () => {
  it("คั่นหลักพันได้ · คืนเงิน 2 ตำแหน่งเป็น string", () => {
    expect(validateGoldReferencePrices(SAMPLE)).toEqual<GoldReferencePrices>({
      barBuy: "70950.00",
      barSell: "71150.00",
      ornamentBuy: "69523.76",
      ornamentSell: "71950.00",
    });
  });

  it("ทองคำแท่งขายออกเท่ากับรับซื้อได้ (ขอบ)", () => {
    expect(validateGoldReferencePrices({ ...SAMPLE, barBuy: "71150" }).barBuy).toBe("71150.00");
  });

  it.each([
    [{ barSell: "" }, "barSell: ไม่ใช่ตัวเลข"],
    [{ barBuy: "abc" }, "barBuy: ไม่ใช่ตัวเลข"],
    [{ ornamentSell: "-71950" }, "ornamentSell: ไม่ใช่ตัวเลข"],
    [{ ornamentBuy: "1e5" }, "ornamentBuy: ไม่ใช่ตัวเลข"],
    [{ barSell: "71150.001" }, "barSell: ทศนิยมเกิน 2 ตำแหน่ง"],
    [{ barBuy: "9999" }, "barBuy: อยู่นอกช่วงที่เป็นไปได้"],
    [{ barSell: "1000000" }, "barSell: อยู่นอกช่วงที่เป็นไปได้"],
    // ทองคำแท่งประกาศเป็นบาทเต็มเสมอ
    [{ barBuy: "70950.50" }, "barBuy: ทองคำแท่งต้องเป็นบาทเต็ม"],
    [{ barSell: "71150.50" }, "barSell: ทองคำแท่งต้องเป็นบาทเต็ม"],
    [{ barBuy: "71151" }, "ทองคำแท่งขายออกต่ำกว่ารับซื้อ"],
    // ส่วนต่างแท่ง 1% ของ 71,150 = 711.50 → 70,439 ผ่าน (ดูเทสต์ขอบ) · 70,438 ไม่ผ่าน
    [{ barBuy: "70438" }, "ส่วนต่างทองคำแท่งกว้างผิดปกติ"],
    [{ ornamentSell: "71150" }, "ทองรูปพรรณขายออกต้องสูงกว่าทองคำแท่งขายออก"],
    [{ ornamentBuy: "70950" }, "ทองรูปพรรณรับซื้อต้องต่ำกว่าทองคำแท่งรับซื้อ"],
    // รูปพรรณห่างจากแท่งขายออก 5% ของ 71,150 = 3,557.50
    [{ ornamentBuy: "67592.49" }, "ornamentBuy: ห่างจากทองคำแท่งขายออกผิดปกติ"],
    [{ ornamentSell: "74707.51" }, "ornamentSell: ห่างจากทองคำแท่งขายออกผิดปกติ"],
  ])("ปฏิเสธ %o", (patch, message) => {
    expect(errorOf(() => validateGoldReferencePrices({ ...SAMPLE, ...patch }))).toBe(message);
  });

  it("ขอบบนพอดียังรับ — ส่วนต่างแท่ง 1% · รูปพรรณ ±5%", () => {
    const edge = { ...SAMPLE, barBuy: "70439", ornamentBuy: "67592.50", ornamentSell: "74707.50" };
    expect(validateGoldReferencePrices(edge)).toEqual({
      barBuy: "70439.00",
      barSell: "71150.00",
      ornamentBuy: "67592.50",
      ornamentSell: "74707.50",
    });
  });

  it("แถวแท่ง/รูปพรรณสลับกัน หรือรับซื้อ/ขายออกสลับกัน = ปฏิเสธทุกแบบ", () => {
    const rowsSwapped = {
      barBuy: "69,523.76",
      barSell: "71,950.00",
      ornamentBuy: "70,950.00",
      ornamentSell: "71,150.00",
    };
    expect(errorOf(() => validateGoldReferencePrices(rowsSwapped))).toBe("barBuy: ทองคำแท่งต้องเป็นบาทเต็ม");
    // รูปพรรณรับซื้อที่บังเอิญเป็นบาทเต็มก็ยังไม่ผ่าน (ส่วนต่างแท่งกว้างเกิน)
    const wholeSwapped = { ...rowsSwapped, barBuy: "69,500.00" };
    expect(errorOf(() => validateGoldReferencePrices(wholeSwapped))).toBe("ส่วนต่างทองคำแท่งกว้างผิดปกติ");
    const barBuySell = { ...SAMPLE, barBuy: "71,150.00", barSell: "70,950.00" };
    expect(errorOf(() => validateGoldReferencePrices(barBuySell))).toBe("ทองคำแท่งขายออกต่ำกว่ารับซื้อ");
    const ornBuySell = { ...SAMPLE, ornamentBuy: "71,950.00", ornamentSell: "69,523.76" };
    expect(errorOf(() => validateGoldReferencePrices(ornBuySell))).toBe("ทองรูปพรรณขายออกต้องสูงกว่าทองคำแท่งขายออก");
  });
});

describe("parseGoldAnnouncement", () => {
  it("รูปแบบเต็มของสมาคม → ISO เวลาไทย + ครั้งที่", () => {
    expect(parseGoldAnnouncement("02/02/2569 เวลา 17:23 น. (ครั้งที่ 69)")).toEqual({
      announcedAt: "2026-02-02T17:23:00+07:00",
      round: 69,
    });
  });

  it("ช่องว่างซ้อน/ขึ้นบรรทัด · วันเดือนหลักเดียว · จุดแทนโคลอน · ไม่มี 'น.' · ไม่มีครั้งที่", () => {
    expect(parseGoldAnnouncement("  29/9/2569\n เวลา  9.05 ")).toEqual({
      announcedAt: "2026-09-29T09:05:00+07:00",
      round: null,
    });
    expect(parseGoldAnnouncement("29/09/2569 09:05 น (ครั้งที่ 1)")).toEqual({
      announcedAt: "2026-09-29T09:05:00+07:00",
      round: 1,
    });
  });

  it("ข้อความยาว/ช่องว่างและวงเล็บซ้ำ ๆ 100k ตัวอักษร → error ทันที (ไม่ ReDoS)", () => {
    for (const evil of [
      " ".repeat(100_000),
      `02/02/2569 เวลา 17:23${" ".repeat(100_000)}x`,
      `02/02/2569 เวลา 17:23 น. (${" (".repeat(50_000)}`,
    ]) {
      const started = performance.now();
      expect(errorOf(() => parseGoldAnnouncement(evil))).toBe("รูปแบบเวลาประกาศไม่ถูกต้อง");
      expect(performance.now() - started).toBeLessThan(50);
    }
    // ใต้เพดานความยาว — regex ใหม่ยังเร็ว
    const started = performance.now();
    expect(() => parseGoldAnnouncement(`02/02/2569 เวลา 17:23${" ".repeat(90)}(`)).toThrow(GoldReferenceError);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("ราคายาวผิดปกติ (> 20 ตัว) = ไม่ใช่ตัวเลข โดยไม่ต้องเข้า regex", () => {
    expect(errorOf(() => validateGoldReferencePrices({ ...SAMPLE, barSell: "1".repeat(100_000) }))).toBe(
      "barSell: ไม่ใช่ตัวเลข",
    );
  });

  it("29 ก.พ. ปีอธิกสุรทิน (2567 = 2024) ผ่าน", () => {
    expect(parseGoldAnnouncement("29/02/2567 เวลา 23:59 น.").announcedAt).toBe("2024-02-29T23:59:00+07:00");
  });

  it.each([
    ["", "รูปแบบเวลาประกาศไม่ถูกต้อง"],
    ["ราคาทองวันนี้", "รูปแบบเวลาประกาศไม่ถูกต้อง"],
    ["02/02/2569", "รูปแบบเวลาประกาศไม่ถูกต้อง"],
    ["02/02/2569 เวลา 17:23 น. (ครั้งที่ 1000)", "รูปแบบเวลาประกาศไม่ถูกต้อง"],
    ["02/02/2026 เวลา 17:23 น.", "ปีของประกาศต้องเป็น พ.ศ."],
    ["02/02/2701 เวลา 17:23 น.", "ปีของประกาศต้องเป็น พ.ศ."],
    ["29/02/2569 เวลา 17:23 น.", "วันที่ของประกาศไม่มีจริง"],
    ["31/04/2569 เวลา 17:23 น.", "วันที่ของประกาศไม่มีจริง"],
    ["01/13/2569 เวลา 17:23 น.", "วันที่ของประกาศไม่มีจริง"],
    ["00/01/2569 เวลา 17:23 น.", "วันที่ของประกาศไม่มีจริง"],
    ["02/02/2569 เวลา 24:00 น.", "เวลาของประกาศไม่ถูกต้อง"],
    ["02/02/2569 เวลา 17:60 น.", "เวลาของประกาศไม่ถูกต้อง"],
    ["02/02/2569 เวลา 17:23 น. (ครั้งที่ 0)", "ครั้งที่ของประกาศไม่ถูกต้อง"],
  ])("ปฏิเสธ %j", (text, message) => {
    expect(errorOf(() => parseGoldAnnouncement(text))).toBe(message);
  });
});
