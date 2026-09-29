import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type UrlSearch, useHeldQuery } from "./use-held-query";

const ID = "1103700123458";
const OTHER_ID = "3100500987657";

const open = (url: UrlSearch) => renderHook(({ url }) => useHeldQuery(url), { initialProps: { url } });

describe("useHeldQuery", () => {
  it("URL ปกติ: ไม่ถืออะไร", () => {
    const { result } = open({ q: "", page: 1 });
    expect(result.current.held).toBeUndefined();

    const withName = open({ q: "สมชาย", page: 3 });
    expect(withName.result.current.held).toBeUndefined();
  });

  it("hold: ถือเลขบัตรและไปหน้า 1 ทันที ก่อนที่ URL จะตามมา", () => {
    const { result } = open({ q: "", page: 3 });

    act(() => result.current.hold(ID));

    expect(result.current.held).toEqual({ q: ID, page: 1 });
  });

  it("URL ตามมาด้วย q ว่าง (ที่หน้านี้ทำเอง): ยังถืออยู่ และตามเลขหน้าของ URL", () => {
    const { result, rerender } = open({ q: "somchai", page: 3 });
    act(() => result.current.hold(ID));

    rerender({ url: { q: "", page: 1 } });
    expect(result.current.held).toEqual({ q: ID, page: 1 });

    // เปลี่ยนหน้าผลค้น → URL ตาม · ย้อนกลับจากหน้า 2 ไปหน้า 1 → ตาม URL
    act(() => result.current.setPage(2));
    expect(result.current.held).toEqual({ q: ID, page: 2 });
    rerender({ url: { q: "", page: 2 } });
    expect(result.current.held).toEqual({ q: ID, page: 2 });
    rerender({ url: { q: "", page: 1 } });
    expect(result.current.held).toEqual({ q: ID, page: 1 });
  });

  it("ระหว่างที่ URL ยังไม่เปลี่ยน (router ยังไม่ทัน): ไม่ถือว่าเป็นการเปลี่ยนจากภายนอก", () => {
    const { result, rerender } = open({ q: "somchai", page: 3 });

    act(() => result.current.hold(ID));
    rerender({ url: { q: "somchai", page: 3 } });

    expect(result.current.held).toEqual({ q: ID, page: 1 });
  });

  it("URL เปลี่ยนจากภายนอกมาพร้อม q ของตัวเอง: เลิกถือ", () => {
    const { result, rerender } = open({ q: "", page: 1 });
    act(() => result.current.hold(ID));

    rerender({ url: { q: "somchai", page: 1 } });

    expect(result.current.held).toBeUndefined();
  });

  it("URL เปลี่ยนไปเป็นเลขบัตรอีกเลข (ลิงก์เก่า): ถือเลขใหม่แทน", () => {
    const { result, rerender } = open({ q: "", page: 1 });
    act(() => result.current.hold(ID));

    rerender({ url: { q: OTHER_ID, page: 2 } });

    expect(result.current.held).toEqual({ q: OTHER_ID, page: 2 });
  });

  it("เปิดจากลิงก์เก่าที่มีเลขบัตรใน URL: ถือตั้งแต่ render แรก พร้อมเลขหน้าเดิม", () => {
    const { result } = open({ q: ID, page: 2 });

    expect(result.current.held).toEqual({ q: ID, page: 2 });
  });

  it("release: เลิกถือ · setPage ตอนไม่ได้ถือไม่ทำอะไร", () => {
    const { result } = open({ q: "", page: 1 });

    act(() => result.current.setPage(4));
    expect(result.current.held).toBeUndefined();

    act(() => result.current.hold(ID));
    act(() => result.current.release());
    expect(result.current.held).toBeUndefined();
  });
});
