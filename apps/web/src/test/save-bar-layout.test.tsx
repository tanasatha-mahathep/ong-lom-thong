import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GOLD_PRICE, fakeApi, json, makeMe, renderApp } from "@/test/app";
import { METALS } from "@/test/buy-api";

/** jsdom ไม่คำนวณ layout — ตรวจสัญญาของ class (วัดจริงด้วย Playwright ที่ 1366 · 1024 · 768 · 390 — ดู PR) */
describe("แถบบันทึกของ /buy", () => {
  it("เต็มความกว้างพื้นที่เนื้อหา (ชิดขอบ sidebar ถึงขอบขวา) + เว้นขอบล่างของจอมือถือ", async () => {
    fakeApi({
      "GET /api/me": () => json(makeMe("staff")),
      "GET /api/gold-price/today": () => json(GOLD_PRICE),
      "GET /api/metals": () => json(METALS),
    });
    renderApp("/buy");
    await screen.findByRole("heading", { level: 1, name: "ซื้อเข้า" }, { timeout: 10_000 });
    const main = document.getElementById("main");
    expect(main).toHaveClass("@container/main", "[--main-px:1rem]", "md:[--main-px:1.5rem]");
    const bar = document.querySelector('[data-slot="save-bar"]');
    expect(bar).toHaveClass(
      "sticky",
      "bottom-0",
      "w-[calc(100cqw_+_2*var(--main-px,1rem))]",
      "mx-[calc((100%_-_100cqw)/2_-_var(--main-px,1rem))]",
      "border-t-2",
      "bg-background",
      "pb-[calc(0.75rem_+_env(safe-area-inset-bottom))]",
    );
    // เนื้อในยังตรงแนวกับหน้า (กล่อง max-w-5xl เดียวกับฟอร์ม)
    expect(bar?.firstElementChild).toHaveClass("mx-auto", "max-w-5xl");
  });
});
