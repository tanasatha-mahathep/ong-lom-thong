import { describe, expect, it } from "vitest";
import { t } from "./i18n";
import { DATE_PRESETS, billsSearchSchema, cleanQuery, parseDateFilter, toListParams } from "./search";

const presetRange = (label: string, today: string) => {
  const preset = DATE_PRESETS.find((p) => t(p.label) === label);
  if (!preset) throw new Error(`ไม่มีปุ่ม ${label}`);
  return preset.range(today);
};

describe("billsSearchSchema — ค่าใน URL ที่อ่านไม่ได้กลายเป็นไม่กรอง ไม่ทำให้หน้าพัง", () => {
  it("รับค่าที่ถูกต้องตามเดิม", () => {
    expect(
      billsSearchSchema.parse({
        from: "2026-09-01",
        to: "2026-09-28",
        metal: "gold",
        q: "RC6909",
        branch: "b-00001",
        page: 3,
      }),
    ).toEqual({ from: "2026-09-01", to: "2026-09-28", metal: "gold", q: "RC6909", branch: "b-00001", page: 3 });
  });

  it("วันที่ผิดรูป / ไม่มีจริง / ก่อน ค.ศ. 2000 · page ผิด · ค่าว่าง → undefined", () => {
    expect(
      billsSearchSchema.parse({
        from: "28/09/2569",
        to: "2026-02-30",
        metal: "",
        branch: "",
        page: "abc",
      }),
    ).toEqual({});
    expect(billsSearchSchema.parse({ from: "1999-12-31", page: 0 })).toEqual({});
  });

  it("คำค้นที่ router อ่านเป็นตัวเลข (พิมพ์ ?q=6910 เอง) กลับเป็นข้อความ", () => {
    expect(billsSearchSchema.parse({ q: 6910 }).q).toBe("6910");
  });
});

describe("toListParams — search ของหน้า → ตัวกรองของ GET /api/buy", () => {
  it("ไม่มีตัวกรอง = ไม่ส่งอะไร (ทุกวันที่ ทุกสาขาที่อ่านได้)", () => {
    expect(toListParams({})).toEqual({});
  });

  it("แปลงชื่อช่อง · หน้า 1 ไม่ใส่ page · หน้าอื่นใส่", () => {
    expect(toListParams({ from: "2026-09-01", to: "2026-09-28", metal: "nak", branch: "b-00001", page: 1 })).toEqual({
      date_from: "2026-09-01",
      date_to: "2026-09-28",
      metal: "nak",
      branch_id: "b-00001",
    });
    expect(toListParams({ page: 2 })).toEqual({ page: 2 });
  });

  it("คำค้น 1 ตัวอักษรไม่ส่ง (API ตอบ 400) · 2 ตัวขึ้นไปส่ง", () => {
    expect(toListParams({ q: "ก" })).toEqual({});
    expect(toListParams({ q: " ก " })).toEqual({});
    expect(toListParams({ q: "กข" })).toEqual({ q: "กข" });
  });

  it("ตัดอักขระควบคุมก่อนส่ง — เหลือตัวเดียวก็ไม่ส่ง", () => {
    expect(toListParams({ q: "RC\u00006909\u0007" })).toEqual({ q: "RC6909" });
    expect(toListParams({ q: "\u0001ก\u001f" })).toEqual({});
  });
});

describe("cleanQuery", () => {
  it("ตัดอักขระควบคุม (รวม tab/ขึ้นบรรทัด) และ surrogate ที่ไม่มีคู่ แล้ว trim", () => {
    expect(cleanQuery("  สมชาย\tใจดี\n")).toBe("สมชายใจดี");
    expect(cleanQuery("\uD800ab")).toBe("ab");
  });

  it("อีโมจิ (surrogate ครบคู่) ไม่ถูกตัด", () => {
    expect(cleanQuery("ab😀")).toBe("ab😀");
  });
});

describe("parseDateFilter — ข้อความในช่องวันที่ → ISO", () => {
  it("พ.ศ. แบบที่ร้านพิมพ์ → ISO ค.ศ. · ช่องว่าง = ไม่กรอง", () => {
    expect(parseDateFilter("28/09/2569")).toBe("2026-09-28");
    expect(parseDateFilter(" 1/10/2569 ")).toBe("2026-10-01");
    expect(parseDateFilter("   ")).toBe("");
  });

  it("อ่านไม่ได้ · ไม่มีวันนั้นจริง · ก่อน ค.ศ. 2000 → null", () => {
    expect(parseDateFilter("28/09/69")).toBeNull();
    expect(parseDateFilter("31/02/2569")).toBeNull();
    expect(parseDateFilter("abc")).toBeNull();
    expect(parseDateFilter("31/12/2542")).toBeNull();
  });
});

describe("DATE_PRESETS — ช่วงวันที่สำเร็จรูป (today ส่งเข้ามา ไม่อ่านนาฬิกาเอง)", () => {
  it("ป้ายมาจากไฟล์ข้อความ เรียงตามปุ่ม", () => {
    expect(DATE_PRESETS.map((p) => t(p.label))).toEqual(["วันนี้", "เมื่อวาน", "7 วันล่าสุด", "เดือนนี้", "ทุกวันที่"]);
  });

  it("กลางเดือน", () => {
    const today = "2026-09-28";
    expect(presetRange("วันนี้", today)).toEqual({ from: today, to: today });
    expect(presetRange("เมื่อวาน", today)).toEqual({ from: "2026-09-27", to: "2026-09-27" });
    expect(presetRange("7 วันล่าสุด", today)).toEqual({ from: "2026-09-22", to: today });
    expect(presetRange("เดือนนี้", today)).toEqual({ from: "2026-09-01", to: today });
    expect(presetRange("ทุกวันที่", today)).toEqual({});
  });

  it("วันที่ 1 — เมื่อวานข้ามเดือน · 7 วันข้ามปี", () => {
    expect(presetRange("เมื่อวาน", "2026-10-01")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(presetRange("7 วันล่าสุด", "2027-01-03")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
    expect(presetRange("เดือนนี้", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });
});
