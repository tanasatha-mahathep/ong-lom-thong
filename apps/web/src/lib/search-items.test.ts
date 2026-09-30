import { describe, expect, it } from "vitest";
import { navFor } from "./nav";
import type { Role } from "./queries";
import { matchesQuery, normalizeForMatch, searchPagesFor } from "./search-items";

describe("normalizeForMatch", () => {
  it("ตัวพิมพ์เล็ก · ช่องว่างซ้อนและหัวท้าย · รูป Unicode เดียวกัน (NFC)", () => {
    expect(normalizeForMatch("  Reports   Export ")).toBe("reports export");
    // "é" แบบประกอบ (e + U+0301) = แบบตัวเดียว
    expect(normalizeForMatch("é")).toBe("é");
    expect(normalizeForMatch("ลูก ค้า")).toBe("ลูก ค้า");
  });
});

describe("matchesQuery", () => {
  const texts = ["ยอดซื้อ", "รายงานยอดซื้อ", "รายงาน", "/reports/purchase"];

  it("คำค้นว่าง = ตรงทุกอย่าง", () => {
    expect(matchesQuery("", texts)).toBe(true);
    expect(matchesQuery("   ", texts)).toBe(true);
  });

  it("ภาษาไทยไม่เว้นวรรค — ส่วนใดของข้อความก็ได้ · ทุกคำต้องพบ", () => {
    expect(matchesQuery("ซื้อ", texts)).toBe(true);
    expect(matchesQuery("รายงาน ซื้อ", texts)).toBe(true);
    expect(matchesQuery("รายงาน สต็อก", texts)).toBe(false);
  });

  it("path ของหน้าและตัวพิมพ์ใหญ่", () => {
    expect(matchesQuery("/REPORTS", texts)).toBe(true);
    expect(matchesQuery("purchase", texts)).toBe(true);
    expect(matchesQuery("stock", texts)).toBe(false);
  });
});

describe("รายการตาม role", () => {
  it.each<Role>(["staff", "manager", "accounting", "admin"])("%s: หน้าเท่ากับเมนูใน sidebar ตามลำดับ", (role) => {
    expect(searchPagesFor(role).map((page) => page.item.to)).toEqual(
      navFor(role).flatMap((group) => group.items.map((item) => item.to)),
    );
  });

  it("หน้าในกลุ่มรายงาน/ตั้งค่ารู้ชื่อกลุ่ม", () => {
    const pages = searchPagesFor("admin");
    expect(pages.find((page) => page.item.to === "/reports/stock")?.group).toBe("reports");
    expect(pages.find((page) => page.item.to === "/settings/users")?.group).toBe("settings");
    expect(pages.find((page) => page.item.to === "/")?.group).toBeUndefined();
  });
});
