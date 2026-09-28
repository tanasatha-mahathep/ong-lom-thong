import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  INVALID_FIELD_MESSAGE,
  NETWORK_MESSAGE,
  SERVER_FAILURE_MESSAGE,
  UNEXPECTED_MESSAGE,
  mapServerError,
} from "./errors";

const apiError = (status: number, body: { error: string; field?: string; existing_id?: string }) =>
  new ApiError(status, body.error, body.field, body);

describe("mapServerError — error จากการบันทึกลูกค้า", () => {
  it("409 เลขบัตรซ้ำ → ช่องที่ 1 พร้อม id ลูกค้าเดิม", () => {
    const e = apiError(409, { error: "มีลูกค้าเลขบัตรนี้อยู่แล้ว", field: "national_id", existing_id: "c-old" });
    expect(mapServerError(e)).toEqual({
      field: "national_id",
      message: "มีลูกค้าเลขบัตรนี้อยู่แล้ว",
      existingId: "c-old",
    });
  });

  it("409 จากการชนกันพร้อมกัน (ไม่มี existing_id) → ข้อความอย่างเดียว", () => {
    const e = apiError(409, { error: "มีลูกค้าเลขบัตรนี้อยู่แล้ว", field: "national_id" });
    expect(mapServerError(e)).toEqual({ field: "national_id", message: "มีลูกค้าเลขบัตรนี้อยู่แล้ว" });
  });

  it("400 ที่ชี้ช่อง → แสดงใต้ช่องนั้น (รวมอักขระควบคุมที่ API ปฏิเสธ)", () => {
    const e = apiError(400, { error: "มีอักขระที่ใช้ไม่ได้ (อักขระควบคุม)", field: "card_expire_text" });
    expect(mapServerError(e)).toEqual({ field: "card_expire_text", message: "มีอักขระที่ใช้ไม่ได้ (อักขระควบคุม)" });
  });

  it("413 รูปใหญ่เกิน → ช่องรูป", () => {
    const e = apiError(413, { error: "รูปใหญ่เกิน 5 MB", field: "photo" });
    expect(mapServerError(e)).toEqual({ field: "photo", message: "รูปใหญ่เกิน 5 MB" });
  });

  it("field ที่ไม่ใช่ช่องของฟอร์ม → แสดงรวมท้ายฟอร์ม", () => {
    const e = apiError(400, { error: "ข้อมูลไม่ถูกต้อง", field: "form" });
    expect(mapServerError(e)).toEqual({ message: "ข้อมูลไม่ถูกต้อง" });
  });

  it("ข้อความภาษาอังกฤษจาก API ไม่ถึงมือพนักงาน", () => {
    const e = apiError(400, { error: "Too big: expected string to have <=200 characters", field: "name_th" });
    expect(mapServerError(e)).toEqual({ field: "name_th", message: INVALID_FIELD_MESSAGE });
  });

  it("403 · 404 · 5xx · ติดต่อไม่ได้ → ข้อความไทยรวม", () => {
    expect(mapServerError(apiError(403, { error: "forbidden" })).message).toBe("บัญชีนี้ไม่มีสิทธิ์บันทึกข้อมูลลูกค้า");
    expect(mapServerError(apiError(404, { error: "not found" })).message).toBe("ไม่พบลูกค้ารายนี้");
    expect(mapServerError(apiError(500, { error: "internal error" }))).toEqual({ message: SERVER_FAILURE_MESSAGE });
    expect(mapServerError(new ApiError(0, "ติดต่อเซิร์ฟเวอร์ไม่ได้", undefined, null))).toEqual({
      message: NETWORK_MESSAGE,
    });
  });

  it("error อื่นที่ไม่ใช่ ApiError → ข้อความกลาง ข้อมูลยังอยู่ในฟอร์ม", () => {
    expect(mapServerError(new TypeError("boom"))).toEqual({ message: UNEXPECTED_MESSAGE });
  });
});
