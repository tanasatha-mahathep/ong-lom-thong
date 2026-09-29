import { describe, expect, it } from "vitest";
import i18next, { LANGUAGE } from "@/i18n";
import { purchaseFilterSchema, stockFilterSchema } from "./filter-schema";

const tc = i18next.getFixedT(LANGUAGE, "common");
const base = { date_from: "01/09/2569", date_to: "29/09/2569", metal: "", branch_id: "" };
const messages = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.error?.issues.map((i) => `${String(i.path[0])}: ${i.message}`) ?? [];

describe("ตัวกรองรายงาน — ตรวจก่อนส่ง (U2)", () => {
  it("ผ่าน → วันที่เป็น ISO ค.ศ. · โลหะ/สาขาผ่านตรงตัว", () => {
    expect(purchaseFilterSchema(tc).parse({ ...base, metal: "gold", branch_id: "b-1" })).toEqual({
      date_from: "2026-09-01",
      date_to: "2026-09-29",
      metal: "gold",
      branch_id: "b-1",
    });
  });

  it("ช่องว่าง · ไม่ใช่วันจริง · ก่อนปี 2543: error ที่ช่องนั้น", () => {
    const schema = purchaseFilterSchema(tc);
    expect(messages(schema.safeParse({ ...base, date_from: "" }))).toEqual([`date_from: ${tc("dateField.required")}`]);
    expect(messages(schema.safeParse({ ...base, date_to: "31/02/2569" }))).toEqual([
      `date_to: ${tc("dateField.invalid")}`,
    ]);
    expect(messages(schema.safeParse({ ...base, date_from: "31/12/2542" }))).toEqual([
      `date_from: ${tc("dateField.tooEarly")}`,
    ]);
  });

  it("from > to → error ที่ช่อง to · from = to ผ่าน · ช่องใดช่องหนึ่งอ่านไม่ได้ไม่ซ้อน error ช่วง", () => {
    const schema = purchaseFilterSchema(tc);
    expect(messages(schema.safeParse({ ...base, date_from: "30/09/2569" }))).toEqual([
      `date_to: ${tc("dateField.range")}`,
    ]);
    expect(schema.safeParse({ ...base, date_from: "29/09/2569" }).success).toBe(true);
    expect(messages(schema.safeParse({ ...base, date_from: "x", date_to: "01/01/2560" }))).toEqual([
      `date_from: ${tc("dateField.invalid")}`,
    ]);
  });

  it("สต็อก: as_of", () => {
    const schema = stockFilterSchema(tc);
    expect(schema.parse({ as_of: "29/9/2569", branch_id: "" })).toEqual({ as_of: "2026-09-29", branch_id: "" });
    expect(messages(schema.safeParse({ as_of: "", branch_id: "" }))).toEqual([`as_of: ${tc("dateField.required")}`]);
  });
});
