import { describe, expect, it } from "vitest";
import { safeRedirect } from "./session";

// ค่าที่ validateSearch ได้รับ (router decode query string มาแล้ว) — ชุดเดียวกับที่ผู้รีวิวยิงทดสอบใน browser จริง
describe("safeRedirect — ปลายทางหลัง login ต้องเป็นหน้าในแอป", () => {
  it.each([
    ["//evil.example", "protocol-relative"],
    ["/\\evil.example", "backslash"],
    ["https://evil.example", "absolute URL"],
    ["/\t/evil.example", "tab"],
    ["/\n/evil.example", "LF"],
    ["/\r/evil.example", "CR"],
    ["/\t\\evil.example", "tab + backslash"],
    ["/x\u007f", "DEL"],
    ["/%09/evil.example", "encoded tab"],
    ["/%0A/evil.example", "encoded LF"],
    ["/%0D/evil.example", "encoded CR"],
    ["/%09%5Cevil.example", "encoded tab + backslash"],
    ["/%5Cevil.example", "encoded backslash"],
    ["/%2F%2Fevil.example", "double-encoded slashes"],
    ["/.//evil.example", "dot segment that collapses to //"],
    ["/%E0%A4%A", "malformed percent encoding"],
    ["", "empty"],
    ["evil.example", "no leading slash"],
    ["/login", "login itself"],
    ["/login?redirect=/bills", "login loop"],
  ])("%j (%s) → ไม่ผ่าน", (value) => {
    expect(safeRedirect(value)).toBeUndefined();
  });

  it.each([
    ["/", "/"],
    ["/bills#x", "/bills#x"],
    ["/customers?q=ab", "/customers?q=ab"],
    ["/customers/abc", "/customers/abc"],
    ["/customers?q=%E0%B8%81", "/customers?q=%E0%B8%81"],
    ["/reports/../bills", "/bills"],
  ])("%j → %j", (value, expected) => {
    expect(safeRedirect(value)).toBe(expected);
  });

  it("ค่าที่ไม่ใช่ข้อความไม่ผ่าน", () => {
    expect(safeRedirect(undefined)).toBeUndefined();
    expect(safeRedirect(42)).toBeUndefined();
    expect(safeRedirect({ href: "/bills" })).toBeUndefined();
  });

  it("เทียบกับ origin ของแอปเสมอ", () => {
    expect(safeRedirect("/bills", "https://ong.example")).toBe("/bills");
    expect(safeRedirect("//ong.example/bills", "https://ong.example")).toBeUndefined();
  });
});
