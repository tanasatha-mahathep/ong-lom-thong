import { type GoldReference, GoldReferenceError } from "@ong/core";
import { describe, expect, it, vi } from "vitest";
import { GOLDTRADERS_EXPECTED, GOLDTRADERS_HTML, THAI_GOLD_API_JSON } from "../test/fixtures/goldReference";
import {
  type GoldReferenceProvider,
  createGoldReferenceService,
  goldtradersHtmlProvider,
  parseGoldtradersHtml,
  parseThaiGoldApiJson,
  MAX_LABEL_HTML_LENGTH,
  providerFromEnv,
  referenceAudit,
  textById,
  thaiGoldApiProvider,
} from "./goldReference";

const HTML_URL = "https://classic.goldtraders.or.th/default.aspx";
const JSON_URL = "https://api.example.test/thai-gold-api/latest";

const respond = (body: string, init: ResponseInit = {}) => vi.fn(() => Promise.resolve(new Response(body, init)));

describe("textById", () => {
  it("ตัดแท็กลูก · entity · ช่องว่างซ้อน", () => {
    expect(textById(`<span id="x"><b><font> 1&nbsp;2 &amp;\n 3 </font></b></span>`, "x")).toBe("1 2 & 3");
    expect(textById(`<SPAN ID='x'>a</SPAN>`, "x")).toBe("a");
  });

  it("ไม่มี / มีซ้ำ / id คล้ายกัน = null", () => {
    expect(textById(`<span id="y">a</span>`, "x")).toBeNull();
    expect(textById(`<span id="x">a</span><span id="x">b</span>`, "x")).toBeNull();
    expect(textById(`<span id="x1">a</span>`, "x")).toBeNull();
    expect(textById(`<span id="a.b">ok</span><span id="aXb">no</span>`, "a.b")).toBe("ok");
  });
});

describe("textById — ขอบเขตและเวลา (linear · ไม่ ReDoS)", () => {
  it("data-id ไม่นับ · id ซ้ำต่างเครื่องหมายคำพูด = null · ไม่มีแท็กปิด = null", () => {
    expect(textById(`<span data-id="x">a</span>`, "x")).toBeNull();
    expect(textById(`<span id="x">a</span><b id='x'>b</b>`, "x")).toBeNull();
    expect(textById(`<span id="x">a`, "x")).toBeNull();
    expect(textById(`<span id="x"`, "x")).toBeNull();
    expect(textById(`id="x">a</span>`, "x")).toBeNull();
    expect(textById(`< id="x">a</span>`, "x")).toBeNull();
  });

  it("label ยาวเกินเพดาน = null (ราคาจริงสั้นกว่ามาก)", () => {
    expect(textById(`<span id="x">${"1".repeat(MAX_LABEL_HTML_LENGTH + 1)}</span>`, "x")).toBeNull();
    expect(textById(`<span id="x">${"1".repeat(MAX_LABEL_HTML_LENGTH)}</span>`, "x")).toHaveLength(
      MAX_LABEL_HTML_LENGTH,
    );
  });

  it("หน้า ~100k ตัวอักษรของ '<' / ช่องว่าง / id ซ้ำ ๆ → ตอบใน < 50 ms", () => {
    const pages = [
      `<span id="x">${"<".repeat(100_000)}`,
      `${"<span ".repeat(10_000)} id="x">${" ".repeat(50_000)}</span>`,
      `${'<i id="x">'.repeat(10_000)}`,
      `<p>${" (".repeat(50_000)}</p>`,
    ];
    for (const html of pages) {
      const started = performance.now();
      textById(html, "x");
      expect(() => parseGoldtradersHtml(html)).toThrow(GoldReferenceError);
      expect(performance.now() - started).toBeLessThan(50);
    }
  });
});

describe("parseGoldtradersHtml (fixture สังเคราะห์)", () => {
  it("อ่านราคา 4 ค่า + เวลาประกาศ + ครั้งที่", () => {
    expect(parseGoldtradersHtml(GOLDTRADERS_HTML)).toEqual(GOLDTRADERS_EXPECTED);
  });

  it("ขาดช่อง = GoldReferenceError (ไม่เดา)", () => {
    const missing = GOLDTRADERS_HTML.replace("lblBLSell", "lblSomethingElse");
    expect(() => parseGoldtradersHtml(missing)).toThrow(new GoldReferenceError("ไม่พบ barSell ในหน้าของสมาคม"));
    const empty = GOLDTRADERS_HTML.replace("29/09/2569 เวลา 09:31 น. (ครั้งที่ 2)", "");
    expect(() => parseGoldtradersHtml(empty)).toThrow(GoldReferenceError);
  });

  it("สลับช่อง / ขยะ = GoldReferenceError", () => {
    const swapped = GOLDTRADERS_HTML.replace("67,650.00", "X")
      .replace("67,850.00", "67,650.00")
      .replace("X", "67,850.00");
    expect(() => parseGoldtradersHtml(swapped)).toThrow("ทองคำแท่งขายออกต่ำกว่ารับซื้อ");
    expect(() => parseGoldtradersHtml("<html>maintenance</html>")).toThrow(GoldReferenceError);
  });
});

describe("parseThaiGoldApiJson (fixture ตาม README)", () => {
  it("gold = รูปพรรณ · gold_bar = แท่ง", () => {
    expect(parseThaiGoldApiJson(THAI_GOLD_API_JSON)).toEqual(GOLDTRADERS_EXPECTED);
  });

  it.each([
    ["status ไม่ใช่ success", { ...THAI_GOLD_API_JSON, status: "error" }],
    [
      "ราคาเป็น number",
      {
        ...THAI_GOLD_API_JSON,
        response: {
          ...THAI_GOLD_API_JSON.response,
          price: { gold: { buy: 66295.52, sell: "68,650.00" }, gold_bar: THAI_GOLD_API_JSON.response.price.gold_bar },
        },
      },
    ],
    ["ไม่ใช่ object", null],
  ])("ปฏิเสธ: %s", (_, body) => {
    expect(() => parseThaiGoldApiJson(body)).toThrow(GoldReferenceError);
  });
});

describe("providers (fetch ปลอม)", () => {
  it("HTML: ส่ง signal + accept · source = host", async () => {
    const fetchImpl = respond(GOLDTRADERS_HTML, { status: 200 });
    const p = goldtradersHtmlProvider(HTML_URL, fetchImpl);
    expect(p.source).toBe("classic.goldtraders.or.th");
    const signal = new AbortController().signal;
    await expect(p.fetch(signal)).resolves.toEqual(GOLDTRADERS_EXPECTED);
    expect(fetchImpl).toHaveBeenCalledWith(HTML_URL, { signal, headers: { accept: "text/html" } });
  });

  it("HTTP ไม่ใช่ 2xx = error เครือข่าย (ไม่ใช่ GoldReferenceError)", async () => {
    const p = goldtradersHtmlProvider(HTML_URL, respond("down", { status: 502 }));
    const e = await p.fetch(new AbortController().signal).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(GoldReferenceError);
  });

  it("คำตอบใหญ่ผิดปกติ = GoldReferenceError (ทั้ง content-length และขนาดจริง)", async () => {
    const big = goldtradersHtmlProvider(HTML_URL, respond("x", { headers: { "content-length": "3000000" } }));
    await expect(big.fetch(new AbortController().signal)).rejects.toThrow("คำตอบใหญ่ผิดปกติ");
    const real = goldtradersHtmlProvider(HTML_URL, respond("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(real.fetch(new AbortController().signal)).rejects.toThrow("คำตอบใหญ่ผิดปกติ");
  });

  it("JSON: parse + ตรวจ · ไม่ใช่ JSON = GoldReferenceError", async () => {
    const ok = thaiGoldApiProvider(JSON_URL, respond(JSON.stringify(THAI_GOLD_API_JSON)));
    await expect(ok.fetch(new AbortController().signal)).resolves.toEqual(GOLDTRADERS_EXPECTED);
    const bad = thaiGoldApiProvider(JSON_URL, respond("<html>"));
    await expect(bad.fetch(new AbortController().signal)).rejects.toThrow(new GoldReferenceError("คำตอบไม่ใช่ JSON"));
  });

  it("providerFromEnv: none/ไม่มี URL = null · เลือกตามชนิด", () => {
    expect(providerFromEnv({ GOLD_REFERENCE_PROVIDER: "none", GOLD_REFERENCE_URL: HTML_URL })).toBeNull();
    expect(providerFromEnv({ GOLD_REFERENCE_PROVIDER: "goldtraders-html", GOLD_REFERENCE_URL: undefined })).toBeNull();
    const fetchImpl = respond(GOLDTRADERS_HTML);
    const html = providerFromEnv(
      { GOLD_REFERENCE_PROVIDER: "goldtraders-html", GOLD_REFERENCE_URL: HTML_URL },
      fetchImpl,
    );
    expect(html?.source).toBe("classic.goldtraders.or.th");
    const json = providerFromEnv({ GOLD_REFERENCE_PROVIDER: "thai-gold-api", GOLD_REFERENCE_URL: JSON_URL });
    expect(json?.source).toBe("api.example.test");
  });
});

// 10:00 น. 29 ก.ย. 2569 เวลาไทย — ประกาศ 09:31 ของวันเดียวกัน
const T0 = new Date("2026-09-29T03:00:00Z");
const REF: GoldReference = GOLDTRADERS_EXPECTED;

function fakeProvider(impl: (signal: AbortSignal) => Promise<GoldReference>) {
  const fetch = vi.fn(impl);
  const provider: GoldReferenceProvider = { source: "fake.test", fetch };
  return { provider, fetch };
}

function clock(start = T0) {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

describe("createGoldReferenceService", () => {
  it("ปิด (provider null) = disabled · peek null", async () => {
    const s = createGoldReferenceService({ provider: null });
    expect(await s.get()).toEqual({ ok: false, reason: "disabled" });
    expect(s.peek()).toBeNull();
  });

  it("ดึงครั้งแรก → cache 5 นาที → ดึงใหม่", async () => {
    const c = clock();
    const { provider, fetch } = fakeProvider(() => Promise.resolve(REF));
    const s = createGoldReferenceService({ provider, now: c.now });
    const first = await s.get();
    expect(first).toEqual({
      ok: true,
      stale: false,
      value: { ...REF, source: "fake.test", fetchedAt: "2026-09-29T03:00:00.000Z" },
    });
    c.advance(5 * 60_000 - 1);
    await s.get();
    expect(fetch).toHaveBeenCalledTimes(1);
    c.advance(1);
    await s.get();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("request พร้อมกันรอการดึงรอบเดียว", async () => {
    let release = () => {};
    const { provider, fetch } = fakeProvider(
      () =>
        new Promise((resolve) => {
          release = () => resolve(REF);
        }),
    );
    const s = createGoldReferenceService({ provider, now: clock().now });
    const a = s.get();
    const b = s.get();
    release();
    expect((await a).ok && (await b).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("timeout (~5 วินาที) → unavailable · provider ที่ไม่สน signal ก็ไม่ค้าง · abort signal จริง", async () => {
    let seen: AbortSignal | null = null;
    const { provider } = fakeProvider((signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const onError = vi.fn();
    const s = createGoldReferenceService({ provider, now: clock().now, timeoutMs: 20, onError });
    expect(await s.get()).toEqual({ ok: false, reason: "unavailable" });
    expect((seen as AbortSignal | null)?.aborted).toBe(true);
    expect(onError).toHaveBeenCalledWith("unavailable", expect.any(Error));
  });

  it("ข้อมูลไม่ผ่านการตรวจ → invalid · พักลองใหม่ 60 วินาที", async () => {
    const c = clock();
    const { provider, fetch } = fakeProvider(() => Promise.reject(new GoldReferenceError("ขยะ")));
    const s = createGoldReferenceService({ provider, now: c.now });
    expect(await s.get()).toEqual({ ok: false, reason: "invalid" });
    c.advance(59_999);
    expect(await s.get()).toEqual({ ok: false, reason: "invalid" });
    expect(fetch).toHaveBeenCalledTimes(1);
    c.advance(1);
    await s.get();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("เวลาประกาศอยู่ในอนาคตเกิน 10 นาที = invalid", async () => {
    const future = { ...REF, announcedAt: "2026-09-29T10:11:00+07:00" };
    const s = createGoldReferenceService({
      provider: fakeProvider(() => Promise.resolve(future)).provider,
      now: clock().now,
    });
    expect(await s.get()).toEqual({ ok: false, reason: "invalid" });
    const edge = { ...REF, announcedAt: "2026-09-29T10:10:00+07:00" };
    const ok = createGoldReferenceService({
      provider: fakeProvider(() => Promise.resolve(edge)).provider,
      now: clock().now,
    });
    expect((await ok.get()).ok).toBe(true);
  });

  it("ดึงใหม่ล้ม: ค่าเดิมของวันนี้ไม่เกิน 1 ชม. = stale · เกินแล้ว = 503", async () => {
    const c = clock();
    let fail = false;
    const { provider } = fakeProvider(() => (fail ? Promise.reject(new Error("down")) : Promise.resolve(REF)));
    const s = createGoldReferenceService({ provider, now: c.now });
    await s.get();
    fail = true;
    c.advance(10 * 60_000);
    const stale = await s.get();
    expect(stale).toMatchObject({ ok: true, stale: true, value: { barSell: "67850.00" } });
    expect(s.peek()?.barSell).toBe("67850.00");
    c.advance(50 * 60_000 + 1);
    expect(await s.get()).toEqual({ ok: false, reason: "unavailable" });
    expect(s.peek()).toBeNull();
  });

  it("ดึงใหม่ล้ม + ค่าเดิมเป็นของเมื่อวาน = 503 (ไม่ส่งราคาเมื่อวานเป็นราคาวันนี้)", async () => {
    // 23:55 น. ดึงได้ → 00:05 น. วันใหม่ดึงล้ม
    const c = clock(new Date("2026-09-29T16:55:00Z"));
    let fail = false;
    const { provider } = fakeProvider(() => (fail ? Promise.reject(new Error("down")) : Promise.resolve(REF)));
    const s = createGoldReferenceService({ provider, now: c.now });
    expect(await s.get()).toMatchObject({ ok: true, stale: false });
    fail = true;
    c.advance(10 * 60_000);
    expect(await s.get()).toEqual({ ok: false, reason: "unavailable" });
  });

  it("ดึงสำเร็จแต่ประกาศล่าสุดเป็นของวันก่อน (ยังไม่ประกาศวันนี้) = stale", async () => {
    const yesterday = { ...REF, announcedAt: "2026-09-28T17:30:00+07:00" };
    const s = createGoldReferenceService({
      provider: fakeProvider(() => Promise.resolve(yesterday)).provider,
      now: clock().now,
    });
    expect(await s.get()).toMatchObject({ ok: true, stale: true });
  });
});

describe("referenceAudit", () => {
  const cached = { ...REF, source: "fake.test", fetchedAt: "2026-09-29T03:00:00.000Z" };
  it("มีราคาสมาคม: บันทึกที่มา เวลาประกาศ ครั้งที่ และตรงกับที่บันทึกหรือไม่ (เทียบแบบ decimal)", () => {
    expect(referenceAudit(cached, true, "67850.00")).toEqual({
      prefilled: true,
      source: "fake.test",
      announced_at: "2026-09-29T09:31:00+07:00",
      round: 2,
      bar_sell: "67850.00",
      matches_bar_sell: true,
    });
    expect(referenceAudit(cached, false, "67900.00")).toMatchObject({ prefilled: false, matches_bar_sell: false });
  });
  it("ไม่มีราคาสมาคม: กดเติม = บันทึกว่ากดแต่ไม่รู้ที่มา · ไม่ได้กด = null", () => {
    expect(referenceAudit(null, true, "67850.00")).toEqual({ prefilled: true, source: null });
    expect(referenceAudit(null, false, "67850.00")).toBeNull();
  });
});
