import { describe, expect, it } from "vitest";
import { cardStatus, parseThaiDate } from "./card";

const TODAY = "2026-09-28";

describe("parseThaiDate — รูปแบบที่ Siam ID พิมพ์", () => {
  it.each([
    ["31/12/2570", "2027-12-31"],
    ["1/1/2570", "2027-01-01"],
    ["31-12-2027", "2027-12-31"],
    ["31.12.2027", "2027-12-31"],
    ["2027-12-31", "2027-12-31"],
    ["2570-12-31", "2027-12-31"],
    [" 05/06/2569 ", "2026-06-05"],
  ])("%j → %s", (input, iso) => {
    expect(parseThaiDate(input)).toBe(iso);
  });

  it.each(["", "abc", "30/02/2570", "31/04/2570", "13/13/2570", "1/1/70", "2027/12/31", null, undefined])(
    "ใช้ไม่ได้: %j → null",
    (input) => {
      expect(parseThaiDate(input as string | null | undefined)).toBeNull();
    },
  );
});

describe("cardStatus — ระบบเดิม status 0/1/2/3 บล็อกทั้ง 3 กรณีที่ไม่ ok", () => {
  it("ยังไม่หมดอายุ → ok", () => expect(cardStatus("31/12/2570", TODAY)).toBe("ok"));
  it("หมดอายุวันนี้พอดี → ยัง ok", () => expect(cardStatus("28/09/2569", TODAY)).toBe("ok"));
  it("หมดอายุแล้ว → expired", () => expect(cardStatus("27/09/2569", TODAY)).toBe("expired"));
  it("ว่าง → missing", () => {
    expect(cardStatus("", TODAY)).toBe("missing");
    expect(cardStatus("   ", TODAY)).toBe("missing");
    expect(cardStatus(null, TODAY)).toBe("missing");
  });
  it("รูปแบบผิด → invalid", () => expect(cardStatus("31/02/2570", TODAY)).toBe("invalid"));
  it("บัตรผู้สูงอายุ 'ตลอดชีพ' → ok", () => {
    expect(cardStatus("ตลอดชีพ", TODAY)).toBe("ok");
    expect(cardStatus("Lifetime", TODAY)).toBe("ok");
  });
});
