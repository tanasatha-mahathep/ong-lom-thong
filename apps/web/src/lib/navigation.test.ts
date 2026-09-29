import { afterEach, describe, expect, it, vi } from "vitest";
import { REVOKE_DELAY_MS, navigation } from "./navigation";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function stubUrl() {
  // jsdom ไม่มี createObjectURL
  const create = vi.fn(() => "blob:test");
  const revoke = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  return { create, revoke };
}

describe("navigation.saveBlob", () => {
  it("คลิกลิงก์ดาวน์โหลดด้วยชื่อที่กำหนด · ปล่อย object URL หลัง 10 วินาที (ไม่ใช่ทันที)", () => {
    vi.useFakeTimers();
    const { revoke } = stubUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("รายงาน.csv");
      expect(this.href).toBe("blob:test");
    });

    navigation.saveBlob(new Blob(["x"]), "รายงาน.csv");

    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull();
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });

  it("click() ล้ม → ยังปล่อย object URL", () => {
    vi.useFakeTimers();
    const { revoke } = stubUrl();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => navigation.saveBlob(new Blob(["x"]), "a.csv")).toThrow("blocked");
    vi.advanceTimersByTime(REVOKE_DELAY_MS);
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
});
