import { describe, expect, it } from "vitest";
import { DEFAULT_GOLD_SETTING, deriveGoldPrice, typoWarning } from "./goldPrice";

describe("deriveGoldPrice — สูตรจากระบบเดิม ยืนยันกับกระดานราคาจริง", () => {
  it("27 ก.ย. 2569: 67,850 → รับซื้อ 67,650 → รูปพรรณ 64,268", () => {
    const q = deriveGoldPrice("67850");
    expect(q.barBuy.toFixed(0)).toBe("67650");
    expect(q.jewelryBuy.toFixed(0)).toBe("64268");
  });

  it("รับค่าที่มีคอมมาแบบที่ร้านพิมพ์", () => {
    expect(deriveGoldPrice("67,850").jewelryBuy.toFixed(0)).toBe("64268");
  });

  it("ปัดครึ่งขึ้น ไม่ใช่ปัดเลขคู่ (banker's): 67,630 × 0.95 = 64,248.5 → 64,249", () => {
    const q = deriveGoldPrice("67830");
    expect(q.barBuy.toFixed(0)).toBe("67630");
    expect(q.jewelryBuy.toFixed(0)).toBe("64249");
  });

  it("ส่วนต่าง/ส่วนลด ปรับได้จากตั้งค่า", () => {
    const q = deriveGoldPrice("50000", { diff: "100", jewelryDiscount: "0.9", typoGuardPercent: "3" });
    expect(q.barBuy.toFixed(0)).toBe("49900");
    expect(q.jewelryBuy.toFixed(0)).toBe("44910");
  });

  it.each(["", "0", "-1", "abc", "12abc", "67,85O", "6.785e4", "0x1090A", "67,85", "678,50"])(
    "ปฏิเสธค่าที่ใช้ไม่ได้: %j",
    (v) => {
      expect(() => deriveGoldPrice(v)).toThrow(RangeError);
    },
  );
});

describe("typoWarning — ด่านกันพิมพ์ผิด", () => {
  it("ไม่มีราคาก่อนหน้า → ไม่เตือน", () => {
    expect(typoWarning(null, "67850")).toBeNull();
    expect(typoWarning(undefined, "67850")).toBeNull();
  });
  it("ห่างไม่เกิน 3% → ไม่เตือน", () => {
    expect(typoWarning("67850", "69000")).toBeNull();
  });
  it("พิมพ์ตกหลัก (67,850 → 6,785) → เตือนพร้อมตัวเลข", () => {
    const w = typoWarning("67850", "6785");
    expect(w).toContain("90.0%");
    expect(w).toContain("67850 → 6785");
  });
  it("เกณฑ์ปรับได้", () => {
    expect(typoWarning("67850", "69000", "1")).not.toBeNull();
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
