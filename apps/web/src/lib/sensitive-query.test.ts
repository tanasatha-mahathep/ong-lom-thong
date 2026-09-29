import { describe, expect, it } from "vitest";
import { looksLikeNationalId } from "./sensitive-query";

describe("looksLikeNationalId", () => {
  it.each(["1103700123458", "1 1037 00123 45 8", "1-1037-00123-45-8"])("%j เป็นเลขบัตร", (q) => {
    expect(looksLikeNationalId(q)).toBe(true);
  });

  it.each(["", "0812345678", "110370012345", "11037001234581", "110370012345x", "RC6910-0001", "สมชาย"])(
    "%j ไม่ใช่เลขบัตร",
    (q) => {
      expect(looksLikeNationalId(q)).toBe(false);
    },
  );
});
