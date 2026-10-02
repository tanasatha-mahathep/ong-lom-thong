import { expect, test } from "../../lib/fixtures";
import { expectApiError, expectFieldError } from "../../lib/http";

interface Price {
  date: string;
  bar_sell: string;
  bar_buy: string;
  jewelry_buy: string;
  /** shop-set buy price per gram (central only, every branch uses it) — null = not set today */
  silver_per_g: string | null;
  platinum_per_g: string | null;
  diff: string;
  source: "central" | "branch";
}

interface BranchPrice {
  branch: { id: string; code: string; name: string };
  silver_per_g: string | null;
  platinum_per_g: string | null;
}

const MONEY_2DP = /^\d+\.\d{2}$/;
/** per-gram prices travel as a 2-decimal string or null — never a JSON number (rule 1) */
const expectPerGramShape = (body: { silver_per_g?: unknown; platinum_per_g?: unknown }, where: string) => {
  for (const key of ["silver_per_g", "platinum_per_g"] as const) {
    expect(key in body, `${where}: ${key} is always present`).toBe(true);
    const value = body[key];
    if (value !== null) expect(value, `${where}: ${key}`).toMatch(MONEY_2DP);
  }
};
/** the gold part of a saved price — the per-gram prices may be changed meanwhile by another spec on the shared stack */
const goldOf = (p: Price) => ({
  date: p.date,
  bar_sell: p.bar_sell,
  bar_buy: p.bar_buy,
  jewelry_buy: p.jewelry_buy,
  diff: p.diff,
  source: p.source,
});

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
    expectPerGramShape(saved, "PUT /today");

    // preview and save share one formula (rule 2): the quote must match what was stored
    // (no per-gram price sent → no per-gram key in the quote)
    const quote = await staff.post("/api/gold-price/quote", { data: { bar_sell: "67850" } });
    expect(await quote.json()).toEqual({ bar_sell: "67850.00", bar_buy: "67650.00", jewelry_buy: "64268" });

    const read = await staff.get("/api/gold-price/today");
    expect(read.status()).toBe(200);
    const readBody = (await read.json()) as Price;
    expect(readBody).toMatchObject(goldOf(saved));
    expectPerGramShape(readBody, "GET /today");

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

test.describe("silver / platinum buy price per gram — central only, strings, validated (UAT 30 Sep 2026)", () => {
  // nothing here writes: the shared stack's per-gram prices belong to the buy journey (buy.spec.ts)
  test("the quote echoes the normalized per-gram prices; blank or null clears; omitted stays absent", async ({
    signedIn,
  }) => {
    const staff = await signedIn("staff");
    const res = await staff.post("/api/gold-price/quote", {
      data: { bar_sell: "67850", silver_per_g: "45.5", platinum_per_g: "" },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toMatchObject({
      bar_sell: "67850.00",
      bar_buy: "67650.00",
      jewelry_buy: "64268",
      silver_per_g: "45.50",
      platinum_per_g: null,
    });
    const onlyPlatinum = await staff.post("/api/gold-price/quote", {
      data: { bar_sell: "67850", platinum_per_g: "1,050" },
    });
    const body = (await onlyPlatinum.json()) as Record<string, unknown>;
    expect(body.platinum_per_g).toBe("1050.00");
    expect("silver_per_g" in body).toBe(false);
  });

  test("a bad per-gram price is refused naming its field — on the quote and on the save", async ({ signedIn }) => {
    const manager = await signedIn("manager");
    const cases: [Record<string, unknown>, string, string][] = [
      [{ silver_per_g: 45 }, "silver_per_g", "ต้องส่ง silver_per_g เป็นข้อความตัวเลข หรือ null เพื่อล้าง"],
      [{ silver_per_g: "0" }, "silver_per_g", "ราคาเงินต่อกรัมต้องเป็นตัวเลขมากกว่า 0"],
      [{ silver_per_g: "45.555" }, "silver_per_g", "ราคาทศนิยมไม่เกิน 2 ตำแหน่ง"],
      [{ silver_per_g: "100000" }, "silver_per_g", "ราคาเงินต่อกรัมสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง"],
      [{ platinum_per_g: "abc" }, "platinum_per_g", "ราคาแพลตตินั่มต่อกรัมต้องเป็นตัวเลขมากกว่า 0"],
      [{ platinum_per_g: "100000" }, "platinum_per_g", "ราคาแพลตตินั่มต่อกรัมสูงผิดปกติ — ตรวจตัวเลขอีกครั้ง"],
    ];
    for (const [extra, field, error] of cases) {
      const data = { bar_sell: "67850", ...extra };
      const quoted = await expectFieldError(await manager.post("/api/gold-price/quote", { data }), 400, field);
      expect(quoted.error).toBe(error);
      // refused before anything is written, even with the typo guard confirmed
      const put = await manager.put("/api/gold-price/today", { data: { ...data, confirm_typo: true } });
      expect((await expectFieldError(put, 400, field)).error).toBe(error);
    }
  });

  test("a branch price cannot carry a per-gram price; staff and accounting may not set one", async ({ signedIn }) => {
    const [manager, staff, accounting] = await Promise.all([
      signedIn("manager"),
      signedIn("staff"),
      signedIn("accounting"),
    ]);
    const branches = await manager.get("/api/gold-price/today/branches");
    expect(branches.status()).toBe(200);
    const rows = (await branches.json()) as BranchPrice[];
    // fail-closed: a manager of 00000 lists only 00000
    expect(rows.map((r) => r.branch.code)).toEqual(["00000"]);
    for (const row of rows) expectPerGramShape(row, `GET /today/branches ${row.branch.code}`);
    const home = rows[0]?.branch.id ?? "";

    const branchOnly = "ราคาเงิน/แพลตตินั่มต่อกรัมตั้งได้ที่ราคากลางเท่านั้น";
    for (const [extra, field] of [
      [{ silver_per_g: "45.00" }, "silver_per_g"],
      [{ platinum_per_g: null }, "platinum_per_g"],
    ] as const) {
      const data = { bar_sell: "67850", ...extra };
      const put = await manager.put(`/api/gold-price/today/branches/${home}`, { data });
      expect((await expectFieldError(put, 400, field)).error).toBe(branchOnly);
      const quote = await manager.post("/api/gold-price/quote", { data: { ...data, branch_id: home } });
      expect((await expectFieldError(quote, 400, field)).error).toBe(branchOnly);
    }

    for (const [who, client] of [
      ["staff", staff],
      ["accounting", accounting],
    ] as const) {
      const res = await client.put("/api/gold-price/today", { data: { silver_per_g: "45.00" } });
      expect((await expectApiError(res, 403)).error, who).toBe("forbidden");
    }
  });
});
