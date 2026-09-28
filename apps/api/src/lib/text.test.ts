import { describe, expect, it } from "vitest";
import { isCleanText } from "./text";

describe("isCleanText — ข้อความที่เก็บลง DB ได้", () => {
  it.each([
    ["สร้อยขาด 1 เส้น", true],
    ["tab\tnewline\nCR\r", true],
    ["emoji 😀 (คู่ surrogate ครบ)", true],
    ["", true],
    ["NUL\u0000", false],
    ["ESC\u001b", false],
    ["lone high \uD800", false],
    ["lone low \uDC00", false],
    ["กลับด้าน \uDE00\uD83D", false],
  ])("%j → %s", (s, ok) => {
    expect(isCleanText(s)).toBe(ok);
  });
});
