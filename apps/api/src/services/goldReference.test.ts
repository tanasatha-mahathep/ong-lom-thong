import { type GoldReference, GoldReferenceError } from "@ong/core";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GOLDTRADERS_EXPECTED, GOLDTRADERS_HTML, THAI_GOLD_API_JSON } from "../test/fixtures/goldReference";
import {
  type GoldReferenceProvider,
  createGoldReferenceService,
  goldtradersHtmlProvider,
  parseGoldtradersHtml,
  MAX_BODY_BYTES,
  MAX_LABEL_HTML_LENGTH,
  parseThaiGoldApiJson,
  providerFromEnv,
  referenceAudit,
  textById,
  thaiGoldApiProvider,
} from "./goldReference";

const HTML_URL = "https://classic.goldtraders.or.th/default.aspx";
const JSON_URL = "https://api.example.test/thai-gold-api/latest";

const HTML = "text/html; charset=utf-8";
const JSON_TYPE = "application/json";
const respond = (body: string, type: string, init: ResponseInit = {}) =>
  vi.fn(() =>
    Promise.resolve(new Response(body, { ...init, headers: { "content-type": type, ...(init.headers as object) } })),
  );

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

  it("แถวทองคำแท่ง/ทองรูปพรรณสลับกัน (id ของแถวถูกสลับ) = GoldReferenceError", () => {
    const rowsSwapped = GOLDTRADERS_HTML.replace("lblBLBuy", "TMP_BUY")
      .replace("lblBLSell", "TMP_SELL")
      .replace("lblOMBuy", "lblBLBuy")
      .replace("lblOMSell", "lblBLSell")
      .replace("TMP_BUY", "lblOMBuy")
      .replace("TMP_SELL", "lblOMSell");
    expect(() => parseGoldtradersHtml(rowsSwapped)).toThrow(GoldReferenceError);
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
    [
      "gold / gold_bar สลับกัน",
      {
        ...THAI_GOLD_API_JSON,
        response: {
          ...THAI_GOLD_API_JSON.response,
          price: { gold: THAI_GOLD_API_JSON.response.price.gold_bar, gold_bar: THAI_GOLD_API_JSON.response.price.gold },
        },
      },
    ],
  ])("ปฏิเสธ: %s", (_, body) => {
    expect(() => parseThaiGoldApiJson(body)).toThrow(GoldReferenceError);
  });
});

describe("providers (fetch ปลอม)", () => {
  it("HTML: ส่ง signal + accept + redirect error · source = host", async () => {
    const fetchImpl = respond(GOLDTRADERS_HTML, HTML, { status: 200 });
    const p = goldtradersHtmlProvider(HTML_URL, fetchImpl);
    expect(p.source).toBe("classic.goldtraders.or.th");
    const signal = new AbortController().signal;
    await expect(p.fetch(signal)).resolves.toEqual(GOLDTRADERS_EXPECTED);
    expect(fetchImpl).toHaveBeenCalledWith(HTML_URL, { signal, headers: { accept: "text/html" }, redirect: "error" });
  });

  it("HTTP ไม่ใช่ 2xx = error เครือข่าย (ไม่ใช่ GoldReferenceError)", async () => {
    const p = goldtradersHtmlProvider(HTML_URL, respond("down", HTML, { status: 502 }));
    const e = await p.fetch(new AbortController().signal).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(GoldReferenceError);
  });

  it("content-type ไม่ตรงชนิดของ provider = GoldReferenceError", async () => {
    const html = goldtradersHtmlProvider(HTML_URL, respond(GOLDTRADERS_HTML, JSON_TYPE));
    await expect(html.fetch(new AbortController().signal)).rejects.toThrow("ชนิดคำตอบไม่ตรงกับที่รองรับ");
    const json = thaiGoldApiProvider(JSON_URL, respond(JSON.stringify(THAI_GOLD_API_JSON), "text/plain"));
    await expect(json.fetch(new AbortController().signal)).rejects.toThrow("ชนิดคำตอบไม่ตรงกับที่รองรับ");
    const none = goldtradersHtmlProvider(
      HTML_URL,
      vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
    );
    await expect(none.fetch(new AbortController().signal)).rejects.toThrow("ชนิดคำตอบไม่ตรงกับที่รองรับ");
  });

  it("คำตอบใหญ่ผิดปกติ = GoldReferenceError (content-length · นับ byte จริง ไม่ใช่ตัวอักษร)", async () => {
    const big = goldtradersHtmlProvider(HTML_URL, respond("x", HTML, { headers: { "content-length": "3000000" } }));
    await expect(big.fetch(new AbortController().signal)).rejects.toThrow("คำตอบใหญ่ผิดปกติ");
    const real = goldtradersHtmlProvider(HTML_URL, respond("x".repeat(MAX_BODY_BYTES + 1), HTML));
    await expect(real.fetch(new AbortController().signal)).rejects.toThrow("คำตอบใหญ่ผิดปกติ");
    // อักษรไทย 3 byte ต่อตัว: 0.7M ตัวอักษร (< 2M ตัว) แต่ ~2.1 MB
    const thai = goldtradersHtmlProvider(HTML_URL, respond("ก".repeat(700_000), HTML));
    await expect(thai.fetch(new AbortController().signal)).rejects.toThrow("คำตอบใหญ่ผิดปกติ");
  });

  it("body ว่าง = ไม่ใช่หน้าราคา", async () => {
    const empty = goldtradersHtmlProvider(
      HTML_URL,
      vi.fn(() => Promise.resolve(new Response(null, { status: 200, headers: { "content-type": HTML } }))),
    );
    await expect(empty.fetch(new AbortController().signal)).rejects.toThrow(GoldReferenceError);
  });

  it("JSON: parse + ตรวจ · ไม่ใช่ JSON = GoldReferenceError", async () => {
    const ok = thaiGoldApiProvider(JSON_URL, respond(JSON.stringify(THAI_GOLD_API_JSON), JSON_TYPE));
    await expect(ok.fetch(new AbortController().signal)).resolves.toEqual(GOLDTRADERS_EXPECTED);
    const bad = thaiGoldApiProvider(JSON_URL, respond("<html>", JSON_TYPE));
    await expect(bad.fetch(new AbortController().signal)).rejects.toThrow(new GoldReferenceError("คำตอบไม่ใช่ JSON"));
  });

  it("providerFromEnv: none/ไม่มี URL = null · เลือกตามชนิด", () => {
    expect(providerFromEnv({ GOLD_REFERENCE_PROVIDER: "none", GOLD_REFERENCE_URL: HTML_URL })).toBeNull();
    expect(providerFromEnv({ GOLD_REFERENCE_PROVIDER: "goldtraders-html", GOLD_REFERENCE_URL: undefined })).toBeNull();
    const html = providerFromEnv(
      { GOLD_REFERENCE_PROVIDER: "goldtraders-html", GOLD_REFERENCE_URL: HTML_URL },
      respond(GOLDTRADERS_HTML, HTML),
    );
    expect(html?.source).toBe("classic.goldtraders.or.th");
    const json = providerFromEnv({ GOLD_REFERENCE_PROVIDER: "thai-gold-api", GOLD_REFERENCE_URL: JSON_URL });
    expect(json?.source).toBe("api.example.test");
  });
});

describe("providers กับ fetch จริง (เซิร์ฟเวอร์ local)", () => {
  let server: Server;
  let base = "";
  let streamClosed: Promise<void> = Promise.resolve();
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/redirect") {
        // redirect ไป host อื่น (localhost ≠ 127.0.0.1) ที่ตอบหน้าราคาถูกต้อง — ถ้าตาม redirect เทสต์จะได้ราคา (fail)
        const port = (server.address() as AddressInfo).port;
        res.writeHead(302, { location: `http://localhost:${port}/` }).end();
        return;
      }
      if (req.url === "/endless") {
        // ไม่มี content-length · ส่งไม่หยุด — client ต้องตัดเองเมื่อเกินเพดาน
        res.writeHead(200, { "content-type": HTML });
        streamClosed = new Promise((resolve) => res.on("close", () => resolve()));
        const chunk = "x".repeat(64 * 1024);
        const pump = () => {
          while (!res.destroyed && res.write(chunk));
          if (!res.destroyed) res.once("drain", pump);
        };
        pump();
        return;
      }
      res.writeHead(200, { "content-type": HTML }).end(GOLDTRADERS_HTML);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("ไม่ตาม redirect (กัน SSRF ไป host ภายใน) = error เครือข่าย → unavailable", async () => {
    const e = await goldtradersHtmlProvider(`${base}/redirect`)
      .fetch(AbortSignal.timeout(2_000))
      .catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(GoldReferenceError);
  });

  it("stream ไม่มีที่สิ้นสุด → หยุดอ่านเมื่อเกินเพดาน และปิดการเชื่อมต่อ", async () => {
    await expect(goldtradersHtmlProvider(`${base}/endless`).fetch(AbortSignal.timeout(5_000))).rejects.toThrow(
      "คำตอบใหญ่ผิดปกติ",
    );
    await streamClosed;
  });

  it("หน้าปกติผ่าน fetch จริงได้ค่าเดียวกับ fixture", async () => {
    await expect(goldtradersHtmlProvider(`${base}/`).fetch(AbortSignal.timeout(2_000))).resolves.toEqual(
      GOLDTRADERS_EXPECTED,
    );
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

describe("referenceAudit — แยกคำอ้างของ client กับสิ่งที่เซิร์ฟเวอร์เห็น", () => {
  const cached = { ...REF, source: "fake.test", fetchedAt: "2026-09-29T03:00:00.000Z" };
  const SERVER_SEEN = {
    source: "fake.test",
    announced_at: "2026-09-29T09:31:00+07:00",
    round: 2,
    bar_sell: "67850.00",
    fetched_at: "2026-09-29T03:00:00.000Z",
  };

  it("client เติมจากประกาศเดียวกับที่เซิร์ฟเวอร์เห็น + ราคาตรง (เทียบแบบ decimal · เวลาเทียบเป็นจุดเวลา)", () => {
    const client = { announced_at: "2026-09-29T02:31:00Z", round: 2 };
    expect(referenceAudit(cached, client, "67850")).toEqual({
      client_prefilled: true,
      client_announced_at: "2026-09-29T02:31:00Z",
      client_round: 2,
      server_seen: SERVER_SEEN,
      saved_matches_server_bar_sell: true,
      client_matches_server_announcement: true,
    });
  });

  it("client อ้างประกาศอื่น → client_matches_server_announcement false (ไม่เชื่อค่าของ client)", () => {
    const client = { announced_at: "2026-09-29T16:00:00+07:00", round: 9 };
    expect(referenceAudit(cached, client, "67900.00")).toMatchObject({
      client_round: 9,
      saved_matches_server_bar_sell: false,
      client_matches_server_announcement: false,
    });
  });

  it("ไม่ได้เติม แต่เซิร์ฟเวอร์เห็นราคาสมาคม → บันทึกสิ่งที่เซิร์ฟเวอร์เห็น", () => {
    expect(referenceAudit(cached, null, "67850.00")).toEqual({
      client_prefilled: false,
      client_announced_at: null,
      client_round: null,
      server_seen: SERVER_SEEN,
      saved_matches_server_bar_sell: true,
      client_matches_server_announcement: null,
    });
  });

  it("เซิร์ฟเวอร์ไม่เห็นราคาสมาคม: เติมมา = บันทึกแค่คำอ้าง · ไม่ได้เติม = null", () => {
    expect(referenceAudit(null, { announced_at: "2026-09-29T09:31:00+07:00", round: null }, "67850.00")).toEqual({
      client_prefilled: true,
      client_announced_at: "2026-09-29T09:31:00+07:00",
      client_round: null,
      server_seen: null,
      saved_matches_server_bar_sell: null,
      client_matches_server_announcement: null,
    });
    expect(referenceAudit(null, null, "67850.00")).toBeNull();
  });
});
