import { expect, test } from "../../lib/fixtures";
import { expectApiError, expectFieldError } from "../../lib/http";

interface Price {
  date: string;
  bar_sell: string;
  bar_buy: string;
  jewelry_buy: string;
  diff: string;
  source: "central" | "branch";
}

/** the shop's business day is Thai time (Asia/Bangkok) — not the runner's clock zone */
const thaiDate = (at = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(at);

test.describe("today's gold price — roles, R8 and money as strings (spec §5 · rules 1–3)", () => {
  test("a manager sets it, staff read it; staff and accounting may not set it", async ({ signedIn }) => {
    const [manager, staff, accounting, admin] = await Promise.all([
      signedIn("manager"),
      signedIn("staff"),
      signedIn("accounting"),
      signedIn("admin"),
    ]);
    const before = thaiDate();

    // R8 board example: 67,850 → bar buy 67,650 → jewelry HALF_UP(67,650 × 0.95, 0) = 64,268
    const set = await manager.put("/api/gold-price/today", { data: { bar_sell: "67850" } });
    expect(set.status(), await set.text()).toBe(200);
    const saved = (await set.json()) as Price;
    expect(saved).toMatchObject({ bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268", source: "central" });
    expect([before, thaiDate()]).toContain(saved.date);

    // preview and save share one formula (rule 2): the quote must match what was stored
    const quote = await staff.post("/api/gold-price/quote", { data: { bar_sell: "67850" } });
    expect(await quote.json()).toEqual({ bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268" });

    const read = await staff.get("/api/gold-price/today");
    expect(read.status()).toBe(200);
    expect(await read.json()).toEqual(saved);

    for (const [who, client] of [
      ["staff", staff],
      ["accounting", accounting],
    ] as const) {
      const res = await client.put("/api/gold-price/today", { data: { bar_sell: "1" } });
      expect((await expectApiError(res, 403)).error, who).toBe("forbidden");
    }
    const byAdmin = await admin.put("/api/gold-price/today", { data: { bar_sell: "67850" } });
    expect(byAdmin.status()).toBe(200);
  });

  test("money travels as strings — a JSON number or a third decimal is refused", async ({ signedIn }) => {
    const manager = await signedIn("manager");
    await expectFieldError(await manager.post("/api/gold-price/quote", { data: { bar_sell: 67850 } }), 400, "bar_sell");
    await expectFieldError(
      await manager.post("/api/gold-price/quote", { data: { bar_sell: "67850.005" } }),
      400,
      "bar_sell",
    );
    await expectFieldError(await manager.post("/api/gold-price/quote", { data: { bar_sell: "-1" } }), 400, "bar_sell");
  });

  test("reference data came from the pre-deploy seed: metals in the legacy order", async ({ signedIn }) => {
    const staff = await signedIn("staff");
    const res = await staff.get("/api/metals");
    expect(res.status()).toBe(200);
    const metals = (await res.json()) as { code: string; name_th: string; unit: string }[];
    expect(metals.map((m) => [m.code, m.name_th, m.unit])).toEqual([
      ["gold", "ทอง", "g"],
      ["nak", "นาก", "g"],
      ["silver", "เงิน", "g"],
      ["platinum", "แพลตตินั่ม", "g"],
    ]);
  });
});
