import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { mapServerError } from "./errors";

const apiError = (status: number, body: { error: string; field?: string; existing_id?: string }) =>
  new ApiError(status, body.error, body.field, body);

describe("mapServerError — error จากการบันทึกลูกค้า", () => {
  it("409 เลขบัตรซ้ำ → ช่องที่ 1 พร้อม id ลูกค้าเดิม", () => {
    const e = apiError(409, { error: "มีลูกค้าเลขบัตรนี้อยู่แล้ว", field: "national_id", existing_id: "c-old" });
    expect(mapServerError(e)).toEqual({ field: "national_id", key: "errors.duplicate", existingId: "c-old" });
  });

  it("409 จากการชนกันพร้อมกัน (ไม่มี existing_id) → ข้อความอย่างเดียว", () => {
    const e = apiError(409, { error: "มีลูกค้าเลขบัตรนี้อยู่แล้ว", field: "national_id" });
    expect(mapServerError(e)).toEqual({ field: "national_id", key: "errors.duplicate", existingId: undefined });
  });

  it("400 ที่ชี้ช่อง → แสดงใต้ช่องนั้นด้วยข้อความของ API (รวมอักขระควบคุมและความยาว)", () => {
    expect(
      mapServerError(apiError(400, { error: "มีอักขระที่ใช้ไม่ได้ (อักขระควบคุม)", field: "card_expire_text" })),
    ).toEqual({
      field: "card_expire_text",
      key: "errors.controlChars",
    });
    expect(mapServerError(apiError(400, { error: "ยาวเกิน 50 ตัวอักษร", field: "religion" }))).toEqual({
      field: "religion",
      key: "errors.tooLong",
      vars: { max: "50" },
    });
    expect(
      mapServerError(
        apiError(400, { error: "เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก · ตรวจหลักสุดท้ายไม่ผ่าน)", field: "national_id" }),
      ),
    ).toEqual({ field: "national_id", key: "validation.nationalIdInvalid" });
  });

  it("413 รูปใหญ่เกิน · 400 ชนิดรูป → ช่องรูป", () => {
    expect(mapServerError(apiError(413, { error: "รูปใหญ่เกิน 5 MB", field: "photo" }))).toEqual({
      field: "photo",
      key: "photo.tooLarge",
    });
    expect(mapServerError(apiError(400, { error: "รับเฉพาะรูป JPEG · PNG · WebP", field: "photo" }))).toEqual({
      field: "photo",
      key: "photo.wrongType",
    });
  });

  it("ข้อความที่ไม่รู้จัก/ภาษาอังกฤษ ไม่ถึงมือพนักงาน · field ที่ไม่ใช่ช่องของฟอร์ม → ข้อความรวม", () => {
    const english = apiError(400, { error: "Too big: expected string to have <=200 characters", field: "name_th" });
    expect(mapServerError(english)).toEqual({ field: "name_th", key: "errors.invalidField" });
    expect(mapServerError(apiError(400, { error: "ข้อมูลไม่ถูกต้อง", field: "form" }))).toEqual({
      key: "errors.unexpected",
    });
  });

  it("401 · 403 · 404 · 5xx · ติดต่อไม่ได้ · error อื่น → ข้อความรวม", () => {
    expect(mapServerError(apiError(401, { error: "unauthorized" }))).toEqual({ key: "errors.sessionExpired" });
    expect(mapServerError(apiError(403, { error: "forbidden" }))).toEqual({ key: "errors.forbidden" });
    expect(mapServerError(apiError(404, { error: "not found" }))).toEqual({ key: "errors.notFound" });
    expect(mapServerError(apiError(500, { error: "internal error" }))).toEqual({ key: "errors.serverFailure" });
    expect(mapServerError(new ApiError(0, "ติดต่อเซิร์ฟเวอร์ไม่ได้", undefined, null))).toEqual({
      key: "errors.network",
    });
    expect(mapServerError(new TypeError("boom"))).toEqual({ key: "errors.unexpected" });
  });
});
