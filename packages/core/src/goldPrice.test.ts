import { describe, expect, it } from "vitest";
import { deriveGoldPrice, typoWarning } from "./goldPrice";

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

  it.each(["", "0", "-1", "abc", "12abc", "67,85O"])("ปฏิเสธค่าที่ใช้ไม่ได้: %j", (v) => {
    expect(() => deriveGoldPrice(v)).toThrow(RangeError);
  });
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
