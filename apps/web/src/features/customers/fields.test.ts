import { describe, expect, it } from "vitest";
import { CARD_FIELDS, SIAM_ID_FIELDS, TEXT_FIELDS, fieldElementId, isFieldName } from "./fields";
import th from "./locales/th";

/**
 * สำเนาตรงตัวจาก Work_2026-09-27/03-customer-member.md (ลำดับที่ Siam ID พิมพ์) — ห้าม import จากโค้ด
 * ถ้ามีคนสลับลำดับใน fields.ts หรือแก้ป้ายใน locales/th.ts เทสต์นี้ต้องแดง (CLAUDE.md กฎ 6)
 */
const SIAM_ID_ORDER_FROM_03 = [
  ["national_id", "เลขประจำตัวประชาชน"],
  ["name_th", "ชื่อ - นามสกุล (ภาษาไทย)"],
  ["name_en", "ชื่อ - นามสกุล (ภาษาอังกฤษ)"],
  ["birthday_text", "วันเดือนปีเกิด"],
  ["religion", "ศาสนา"],
  ["address", "ที่อยู่"],
  ["card_issue_text", "วันที่ออกบัตร"],
  ["card_expire_text", "วันที่บัตรหมดอายุ"],
  ["photo", "รูปภาพ"],
  ["mobile", "เบอร์มือถือ"],
  ["phone2", "เบอร์โทรติดต่อที่สะดวก"],
];

describe("ลำดับช่อง Siam ID", () => {
  it("11 ช่อง ชื่อและป้ายภาษาไทย (locales/th.ts) ตรงกับ 03 ตามลำดับ", () => {
    expect(SIAM_ID_FIELDS.map((f) => [f.name, th.fields[f.name].label])).toEqual(SIAM_ID_ORDER_FROM_03);
  });

  it("placeholder ตามระบบเดิม (cust_add.html) — ช่องวันเกิดมีตัวอย่างรูปแบบ", () => {
    expect(th.fields.national_id.placeholder).toBe("เลขบัตร 13 หลัก");
    expect(th.fields.birthday_text.placeholder).toBe("ตัวอย่าง 1 มกราคม 2540");
  });

  it("id ของ element เรียง siam-1 … siam-11", () => {
    expect(SIAM_ID_FIELDS.map((f) => f.id)).toEqual(SIAM_ID_ORDER_FROM_03.map((_, i) => `siam-${i + 1}`));
    expect(fieldElementId("photo")).toBe("siam-9");
  });

  it("ช่องวันที่ทั้งสามเป็นข้อความ · ที่อยู่เป็น textarea · ช่องที่ 9 เป็นรูป", () => {
    const kindOf = Object.fromEntries(SIAM_ID_FIELDS.map((f) => [f.name, f.kind]));
    expect(kindOf).toMatchObject({
      birthday_text: "text",
      card_issue_text: "text",
      card_expire_text: "text",
      address: "textarea",
      photo: "photo",
    });
  });

  it("ป้าย *สำคัญ ตามระบบเดิม (1 · 2 · 6 · 10) · API บังคับแค่ 1 และ 2", () => {
    expect(SIAM_ID_FIELDS.filter((f) => f.important).map((f) => f.id)).toEqual([
      "siam-1",
      "siam-2",
      "siam-6",
      "siam-10",
    ]);
    expect(SIAM_ID_FIELDS.filter((f) => f.required).map((f) => f.name)).toEqual(["national_id", "name_th"]);
  });

  it("ช่องจากบัตร = 1–8 · ช่องข้อความ = ทุกช่องยกเว้นรูป", () => {
    expect(CARD_FIELDS).toEqual(SIAM_ID_ORDER_FROM_03.slice(0, 8).map(([name]) => name));
    expect(TEXT_FIELDS.map((f) => f.name)).toEqual(
      SIAM_ID_ORDER_FROM_03.map(([name]) => name).filter((name) => name !== "photo"),
    );
  });

  it("isFieldName รับเฉพาะชื่อช่องของฟอร์ม", () => {
    expect(isFieldName("card_expire_text")).toBe(true);
    expect(isFieldName("photo")).toBe(true);
    expect(isFieldName("form")).toBe(false);
    expect(isFieldName(undefined)).toBe(false);
  });
});
