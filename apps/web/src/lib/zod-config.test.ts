import { describe, expect, it } from "vitest";
import { z } from "zod";
import mainSource from "../main.tsx?raw";
import "./zod-config";

describe("zod ภายใต้ CSP (ไม่มี unsafe-eval)", () => {
  it("ปิด JIT — zod ไม่เรียก new Function จึงไม่มี CSP violation", () => {
    expect(z.config().jitless).toBe(true);
    // schema ยังตรวจได้ตามปกติ
    expect(z.object({ bar_sell: z.string() }).safeParse({ bar_sell: "67850.00" }).success).toBe(true);
  });

  it("main.tsx import zod-config เป็นบรรทัดแรก — ก่อน module ที่สร้าง schema ตอน import", () => {
    const firstImport = mainSource.split("\n").find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "./lib/zod-config";');
  });
});
