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

  it("ขายออกเท่ากับรับซื้อได้ (ขอบ)", () => {
    const same = { ...SAMPLE, barBuy: "71150", ornamentBuy: "71950" };
    expect(validateGoldReferencePrices(same)).toMatchObject({ barBuy: "71150.00", ornamentBuy: "71950.00" });
  });

  it.each([
    [{ barSell: "" }, "barSell: ไม่ใช่ตัวเลข"],
    [{ barBuy: "abc" }, "barBuy: ไม่ใช่ตัวเลข"],
    [{ ornamentSell: "-71950" }, "ornamentSell: ไม่ใช่ตัวเลข"],
    [{ ornamentBuy: "1e5" }, "ornamentBuy: ไม่ใช่ตัวเลข"],
    [{ barSell: "71150.001" }, "barSell: ทศนิยมเกิน 2 ตำแหน่ง"],
    [{ barBuy: "9999.99" }, "barBuy: อยู่นอกช่วงที่เป็นไปได้"],
    [{ barSell: "1000000" }, "barSell: อยู่นอกช่วงที่เป็นไปได้"],
    [{ barBuy: "71150.01" }, "ทองคำแท่งขายออกต่ำกว่ารับซื้อ"],
    [{ ornamentBuy: "71950.01" }, "ทองรูปพรรณขายออกต่ำกว่ารับซื้อ"],
    // สลับช่อง/หลักหาย: ห่างจากแท่งขายออกเกิน 10%
    [{ barBuy: "64000" }, "barBuy: ห่างจากทองคำแท่งขายออกผิดปกติ"],
    [{ ornamentBuy: "64000" }, "ornamentBuy: ห่างจากทองคำแท่งขายออกผิดปกติ"],
    [{ ornamentSell: "78300" }, "ornamentSell: ห่างจากทองคำแท่งขายออกผิดปกติ"],
  ])("ปฏิเสธ %o", (patch, message) => {
    expect(errorOf(() => validateGoldReferencePrices({ ...SAMPLE, ...patch }))).toBe(message);
  });

  it("ห่าง 10% พอดียังรับ (ขอบบน)", () => {
    // 71,150 × 10% = 7,115 → 64,035 / 78,265
    const edge = { ...SAMPLE, barBuy: "64035", ornamentBuy: "64035", ornamentSell: "78265" };
    expect(validateGoldReferencePrices(edge).ornamentSell).toBe("78265.00");
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
