import { randomUUID } from "node:crypto";
import { isValidNationalId, maskNationalId } from "@ong/core";
import { describe, expect, it } from "vitest";
import { leakedInternals, moneyShapeViolations } from "./assertions";
import { expectNoNationalId, nationalIdsIn } from "./pii";
import { fillParams, hasParams } from "./routes";
import { cardFormat, syntheticNationalId, syntheticSameMask, withCheckDigit } from "./synthetic";

// ตัวช่วยเหล่านี้เป็น oracle ของเทสต์สัญญา — ถ้ามันจับผิดหรือจับไม่ได้ เทสต์ทั้งชุดก็ไร้ความหมาย จึงต้องมีเทสต์ของตัวเอง

describe("ตัวช่วยเทสต์: เลขบัตรสมมติ", () => {
  it("checksum ถูกตาม @ong/core · หลัก 2–3 เป็น 99 (ไม่ใช่รหัสจังหวัดจริง) · ไม่ซ้ำกัน", () => {
    const ids = Array.from({ length: 200 }, () => syntheticNationalId());
    for (const id of ids) {
      expect(isValidNationalId(id)).toBe(true);
      expect(id).toMatch(/^199\d{10}$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(syntheticNationalId(42)).toBe(syntheticNationalId(42));
  });

  it("withCheckDigit ให้หลักตรวจหลักเดียวที่ @ong/core ยอมรับ", () => {
    expect(withCheckDigit("167010130403")).toBe("1670101304032"); // ตัวอย่างใน nationalId.test.ts ของ core
    expect(() => withCheckDigit("12345")).toThrow();
  });

  it("syntheticSameMask: คนละเลขแต่มาสก์ออกมาเหมือนกัน", () => {
    const a = syntheticNationalId(7);
    const b = syntheticSameMask(a);
    expect(b).not.toBe(a);
    expect(isValidNationalId(b)).toBe(true);
    expect(maskNationalId(b)).toBe(maskNationalId(a));
  });

  it("cardFormat จัดกลุ่มแบบหน้าบัตร", () => {
    expect(cardFormat("1670101304032")).toBe("1 6701 01304 03 2");
    expect(cardFormat("1670101304032", "-")).toBe("1-6701-01304-03-2");
  });
});

describe("ตัวช่วยเทสต์: ตรวจเลขบัตรใน response", () => {
  const id = syntheticNationalId(1);

  it.each([
    ["ติดกัน", id],
    ["เว้นวรรคแบบหน้าบัตร", cardFormat(id)],
    ["ขีดแบบหน้าบัตร", cardFormat(id, "-")],
  ])("จับได้: %s", (_label, form) => {
    expect(nationalIdsIn(JSON.stringify({ national_id: form }))).toEqual([form]);
  });

  it.each([
    ["เลขที่มาสก์แล้ว", maskNationalId(id)],
    ["uuid ที่เป็นตัวเลขล้วน", "12345678-1234-1234-1234-123456789012"],
    ["uuid ศูนย์", "00000000-0000-4000-8000-000000000000"],
    ["เวลา ISO", "2026-09-28T03:00:00.000Z"],
    ["เบอร์โทร", "081-234-5678"],
    ["เงิน", "1234567890.12"],
    ["เลข 14 หลัก", `${id}0`],
  ])("ไม่จับผิด: %s", (_label, text) => {
    expect(nationalIdsIn(JSON.stringify({ value: text }))).toEqual([]);
  });

  it("allow ยกเว้นได้เฉพาะเลขที่ระบุ (เช่น เลขผู้เสียภาษีของร้าน) — เลขอื่นยังถูกจับ", () => {
    const shopTaxId = "1234567890121";
    const text = JSON.stringify({ company: { tax_id: shopTaxId }, customer: { national_id: id } });
    expect(() => expectNoNationalId(text, "ร้าน + ลูกค้า", [], [shopTaxId])).toThrow();
    expect(() => expectNoNationalId(JSON.stringify({ tax_id: shopTaxId }), "ร้าน", [], [shopTaxId])).not.toThrow();
  });

  it("uuid สุ่ม 5,000 ตัวไม่ถูกจับผิดเลย (hex ติดกันไม่เกิน 12 · กลุ่มไม่ตรงรูปหน้าบัตร)", () => {
    const text = JSON.stringify(Array.from({ length: 5000 }, () => randomUUID()));
    expect(nationalIdsIn(text)).toEqual([]);
  });
});

describe("ตัวช่วยเทสต์: ร่องรอยภายใน · เงินเป็น string · เติม path", () => {
  it.each([
    ["stack", "Error: x\n    at handler (/srv/app/src/routes/x.ts:12:5)"],
    ["ไฟล์ dist", "at /app/dist/index.js:1:2"],
    ["key stack", '{"error":"x","stack":"..."}'],
    ["Postgres", '{"error":"invalid input syntax for type uuid: \\"x\\""}'],
    ["relation ใน JSON", '{"error":"relation \\"customer\\" does not exist"}'],
    ["drizzle", '{"error":"Failed query: select * from customer"}'],
  ])("จับได้: %s", (_label, text) => {
    expect(leakedInternals(text)).not.toEqual([]);
  });

  it.each([
    ['{"error":"not found"}'],
    ['{"error":"ยังไม่ได้ตั้งราคาทองของวันนี้","date":"2026-09-28"}'],
    ['{"created_at":"2026-09-28T03:00:00.000Z","email":"staff@ong.test"}'],
  ])("ไม่จับผิด: %s", (text) => {
    expect(leakedInternals(text)).toEqual([]);
  });

  it("เงิน/น้ำหนักเป็น number หรือมี float ที่ใดก็ตาม = ผิด", () => {
    expect(moneyShapeViolations({ bar_sell: "67850.00", page: 1, items: [{ weight_g: "5.860" }] })).toEqual([]);
    expect(moneyShapeViolations({ bar_sell: 67850 })).toEqual(["$.bar_sell = 67850 (เงิน/น้ำหนักเป็น number)"]);
    expect(moneyShapeViolations({ lines: [{ weight_g: 5 }] })).toEqual([
      "$.lines[0].weight_g = 5 (เงิน/น้ำหนักเป็น number)",
    ]);
    expect(moneyShapeViolations({ rate: 0.95 })).toEqual(["$.rate = 0.95 (float)"]);
  });

  it("fillParams เติมทุกพารามิเตอร์ด้วยค่าที่ encode แล้ว", () => {
    expect(fillParams("/api/customers/:id/photo", "a/b c")).toBe("/api/customers/a%2Fb%20c/photo");
    expect(fillParams("/api/x/:id{[0-9]+}/:sub", "1")).toBe("/api/x/1/1");
    expect(hasParams("/api/customers/:id")).toBe(true);
    expect(hasParams("/api/customers")).toBe(false);
  });
});
