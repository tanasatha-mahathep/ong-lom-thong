import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { TEST_GOTENBERG, gotenbergAvailable } from "../test/harness";
import { type FetchLike, PdfRenderError, createGotenbergClient } from "./gotenberg";

const ENV = {
  GOTENBERG_URL: "http://gotenberg.test:3000",
  GOTENBERG_USERNAME: "ong",
  GOTENBERG_PASSWORD: "s3cret-pass",
};
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const FONT = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x0c]);

interface Call {
  url: URL;
  init: RequestInit;
}

/** fetch ปลอม — จดทุก request แล้วตอบตามที่เทสต์กำหนด */
function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fetch, calls };
}

const pdfResponse = () => new Response(PDF, { status: 200, headers: { "content-type": "application/pdf" } });

async function renderError(promise: Promise<unknown>): Promise<PdfRenderError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PdfRenderError);
  return err as PdfRenderError;
}

describe("createGotenbergClient — htmlToPdf (fetch ปลอม)", () => {
  it("ส่ง multipart: index.html + asset · A4 · ใช้ขนาด/ขอบจาก @page · ไม่มี PDF/A · basic auth", async () => {
    const { fetch, calls } = fakeFetch(pdfResponse);
    const client = createGotenbergClient(ENV, { fetch });

    const pdf = await client.htmlToPdf({
      html: '<!doctype html><html lang="th"><body>ใบรับซื้อ</body></html>',
      files: [{ name: "Sarabun-Regular.ttf", data: FONT, contentType: "font/ttf" }],
    });

    expect(pdf).toEqual(PDF);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url.href).toBe("http://gotenberg.test:3000/forms/chromium/convert/html");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("ong:s3cret-pass").toString("base64")}`);
    expect(headers.has("gotenberg-trace")).toBe(false);

    const form = init.body as FormData;
    const files = form.getAll("files") as File[];
    expect(files.map((f) => f.name)).toEqual(["index.html", "Sarabun-Regular.ttf"]);
    // index.html เป็น UTF-8 นำด้วย BOM
    const html = new Uint8Array(await files[0]!.arrayBuffer());
    expect([...html.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(html)).toBe('<!doctype html><html lang="th"><body>ใบรับซื้อ</body></html>');
    expect(files[1]!.type).toBe("font/ttf");
    expect(new Uint8Array(await files[1]!.arrayBuffer())).toEqual(FONT);

    const fields = Object.fromEntries([...form.entries()].filter(([name]) => name !== "files"));
    expect(fields).toEqual({
      paperWidth: "8.27",
      paperHeight: "11.69",
      preferCssPageSize: "true",
      printBackground: "true",
      marginTop: "0",
      marginBottom: "0",
      marginLeft: "0",
      marginRight: "0",
      failOnResourceLoadingFailed: "true",
      failOnConsoleExceptions: "true",
    });
    // PDF/A (LibreOffice) ทำวรรณยุกต์ไทยหาย — ห้ามส่ง
    expect(form.has("pdfa")).toBe(false);
    expect(form.has("pdfua")).toBe(false);
  });

  it("ไม่ใส่ BOM ซ้ำ · ส่ง Gotenberg-Trace เมื่อระบุ · URL ที่ลงท้าย / หรือมี path prefix", async () => {
    const { fetch, calls } = fakeFetch(pdfResponse);
    await createGotenbergClient({ ...ENV, GOTENBERG_URL: "http://gotenberg.test:3000/" }, { fetch }).htmlToPdf({
      html: "\uFEFF<p>x</p>",
      trace: "RC6910-0001",
    });
    await createGotenbergClient({ ...ENV, GOTENBERG_URL: "https://proxy.test/gotenberg" }, { fetch }).htmlToPdf({
      html: "<p>x</p>",
    });

    expect(calls.map((c) => c.url.href)).toEqual([
      "http://gotenberg.test:3000/forms/chromium/convert/html",
      "https://proxy.test/gotenberg/forms/chromium/convert/html",
    ]);
    expect(new Headers(calls[0]!.init.headers).get("gotenberg-trace")).toBe("RC6910-0001");
    const index = (calls[0]!.init.body as FormData).get("files") as File;
    const bytes = new Uint8Array(await index.arrayBuffer());
    expect([...bytes.subarray(0, 4)]).toEqual([0xef, 0xbb, 0xbf, "<".charCodeAt(0)]);
  });

  it("ชื่อ asset ที่เป็น path / ชนกับ index.html / ซ้ำกัน → TypeError ก่อนส่ง", async () => {
    const { fetch, calls } = fakeFetch(pdfResponse);
    const client = createGotenbergClient(ENV, { fetch });
    const asset = (name: string) => ({ name, data: FONT, contentType: "font/ttf" });
    for (const name of ["index.html", "INDEX.HTML", "../secret.ttf", "fonts/a.ttf", ".hidden", "", "a b.ttf"]) {
      await expect(client.htmlToPdf({ html: "<p>x</p>", files: [asset(name)] }), name).rejects.toThrow(TypeError);
    }
    await expect(client.htmlToPdf({ html: "<p>x</p>", files: [asset("a.ttf"), asset("a.ttf")] })).rejects.toThrow(
      /duplicate/,
    );
    expect(calls).toHaveLength(0);
  });

  it("Gotenberg ไม่ตอบภายในเวลา → PdfRenderError timeout", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
      });
    const client = createGotenbergClient(ENV, { fetch: hang, timeoutMs: 20 });
    const err = await renderError(client.htmlToPdf({ html: "<p>x</p>" }));
    expect(err).toMatchObject({ kind: "timeout", status: null });
    expect(err.message).toMatch(/20 ms/);
  });

  it("ตอบหัวแล้วแต่ส่งไฟล์ไม่จบภายในเวลา → timeout (เวลาครอบถึงการอ่านไฟล์)", async () => {
    const stall: FetchLike = (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("%PDF-1.4\n"));
          init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const client = createGotenbergClient(ENV, { fetch: stall, timeoutMs: 20 });
    expect(await renderError(client.htmlToPdf({ html: "<p>x</p>" }))).toMatchObject({ kind: "timeout" });
  });

  it("ต่อไม่ได้ → PdfRenderError unreachable พร้อมรหัสสาเหตุ", async () => {
    const refused: FetchLike = () =>
      Promise.reject(
        new TypeError("fetch failed", { cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }) }),
      );
    const err = await renderError(createGotenbergClient(ENV, { fetch: refused }).htmlToPdf({ html: "<p>x</p>" }));
    expect(err).toMatchObject({ kind: "unreachable", status: null });
    expect(err.message).toContain("ECONNREFUSED");
    expect(err.cause).toBeInstanceOf(TypeError);
  });

  it("Gotenberg ตอบ error → PdfRenderError http พร้อม status และข้อความสั้น ๆ", async () => {
    const message = "Chromium failed to load resources: resource Font: net::ERR_FILE_NOT_FOUND";
    const conflict = fakeFetch(() => new Response(message, { status: 409 }));
    const err = await renderError(
      createGotenbergClient(ENV, { fetch: conflict.fetch }).htmlToPdf({ html: "<p>x</p>" }),
    );
    expect(err).toMatchObject({ kind: "http", status: 409, body: message });

    const busy = fakeFetch(() => new Response("x".repeat(5_000), { status: 503 }));
    const long = await renderError(createGotenbergClient(ENV, { fetch: busy.fetch }).htmlToPdf({ html: "<p>x</p>" }));
    expect(long).toMatchObject({ kind: "http", status: 503 });
    expect(long.body.length).toBeLessThanOrEqual(300);
  });

  it("ตอบ 200 แต่ไม่ใช่ PDF (เช่น หน้า error ของ proxy) → not-pdf", async () => {
    const html = fakeFetch(() => new Response("<html>502 Bad Gateway</html>", { status: 200 }));
    const err = await renderError(createGotenbergClient(ENV, { fetch: html.fetch }).htmlToPdf({ html: "<p>x</p>" }));
    expect(err).toMatchObject({ kind: "not-pdf", status: 200 });
    expect(err.body).toContain("502 Bad Gateway");

    const empty = fakeFetch(() => new Response(null, { status: 200 }));
    expect(
      await renderError(createGotenbergClient(ENV, { fetch: empty.fetch }).htmlToPdf({ html: "<p>x</p>" })),
    ).toMatchObject({ kind: "not-pdf" });
  });

  it("PDF ถูกตัดกลางทาง (ไม่มี %%EOF) → not-pdf — ห้ามเก็บไฟล์ไม่ครบเป็นหลักฐานถาวร", async () => {
    const truncated = fakeFetch(() => new Response("%PDF-1.4\n1 0 obj\n<</Type /Catalog", { status: 200 }));
    const err = await renderError(
      createGotenbergClient(ENV, { fetch: truncated.fetch }).htmlToPdf({ html: "<p>x</p>" }),
    );
    expect(err).toMatchObject({ kind: "not-pdf", status: 200 });
    expect(err.message).toMatch(/%%EOF/);
  });
});

describe("createGotenbergClient — health (fetch ปลอม)", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("ดูเฉพาะ Chromium — LibreOffice ล่ม (503) ไม่นับ", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ status: "up", details: { chromium: { status: "up" }, libreoffice: { status: "up" } } }),
    );
    expect(await createGotenbergClient(ENV, { fetch }).health()).toEqual({ up: true, status: 200 });
    expect(calls[0]!.url.href).toBe("http://gotenberg.test:3000/health");

    const libreofficeDown = fakeFetch(() =>
      json({ status: "down", details: { chromium: { status: "up" }, libreoffice: { status: "down" } } }, 503),
    );
    expect(await createGotenbergClient(ENV, { fetch: libreofficeDown.fetch }).health()).toEqual({
      up: true,
      status: 503,
    });
  });

  it("Chromium ล่ม / ตอบไม่ใช่ JSON / ต่อไม่ได้ → up=false (ไม่ throw)", async () => {
    const down = fakeFetch(() => json({ status: "down", details: { chromium: { status: "down" } } }, 503));
    expect(await createGotenbergClient(ENV, { fetch: down.fetch }).health()).toEqual({ up: false, status: 503 });

    const notJson = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    expect(await createGotenbergClient(ENV, { fetch: notJson.fetch }).health()).toEqual({ up: false, status: 200 });

    const refused: FetchLike = () => Promise.reject(new TypeError("fetch failed"));
    expect(await createGotenbergClient(ENV, { fetch: refused }).health()).toEqual({ up: false, status: null });
  });
});

// ---------- Gotenberg จริง (docker compose · CI) ----------

const gotenberg = await gotenbergAvailable();
const FONTS = new URL("../../../web/public/fonts/", import.meta.url);
// PNG 1×1 จริง — ถ้าโหลดไม่ได้ Chromium จะวาดไอคอนรูปแตก (14×16) แทน
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

const RECEIPT_HTML = `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><title>RC6910-0001</title>
<style>
@font-face { font-family: 'Sarabun'; src: url('Sarabun-Regular.ttf'); font-weight: normal; }
@font-face { font-family: 'Sarabun'; src: url('Sarabun-Bold.ttf'); font-weight: bold; }
@page { size: A4; margin: 10mm 12mm; }
body { font-family: 'Sarabun', sans-serif; font-size: 12px; }
</style></head>
<body>
  <h1>ใบรับซื้อของเก่า/ใบสำคัญจ่าย</h1>
  <p>ชื่อผู้ขาย : นายทดสอบ ระบบ · ซื้อ ที่ น้ำ ผู้ขาย เลขประจำตัวผู้เสียภาษี</p>
  <img src="card.png" alt="" style="width:20mm;height:20mm">
</body></html>`;

/** ขนาดของรูปทุกรูปใน PDF (ไม่พึ่งลำดับ key ใน dictionary) */
function imageSizes(pdf: string): string[] {
  const dicts = pdf.match(/<<[^<>]*\/Subtype\s*\/Image[^<>]*>>/g) ?? [];
  return dicts.map((d) => `${/\/Width\s+(\d+)/.exec(d)?.[1]}x${/\/Height\s+(\d+)/.exec(d)?.[1]}`);
}

describe.skipIf(!gotenberg)("Gotenberg จริง — ใบภาษาไทย + ฟอนต์ Sarabun", () => {
  const client = createGotenbergClient(TEST_GOTENBERG);
  const assets = async () => [
    {
      name: "Sarabun-Regular.ttf",
      data: await readFile(new URL("Sarabun-Regular.ttf", FONTS)),
      contentType: "font/ttf",
    },
    { name: "Sarabun-Bold.ttf", data: await readFile(new URL("Sarabun-Bold.ttf", FONTS)), contentType: "font/ttf" },
    { name: "card.png", data: PNG_1X1, contentType: "image/png" },
  ];

  it("ได้ PDF A4 ที่ฝัง Sarabun · ไม่ใช่ PDF/A · Title = เลขที่บิล · รูปจาก asset", async () => {
    const pdf = await client.htmlToPdf({ html: RECEIPT_HTML, files: await assets(), trace: "RC6910-0001" });
    const text = Buffer.from(pdf).toString("latin1");

    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Sarabun-Regular/);
    expect(text).toMatch(/\/BaseFont\s*\/[A-Z]{6}\+Sarabun-Bold/);
    expect(text).not.toMatch(/pdfaid|GTS_PDFA/);
    expect(text).toContain("/Title (RC6910-0001)");
    expect(imageSizes(text)).toContain("1x1");

    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
    expect(box).not.toBeNull();
    // A4 = 595.28 × 841.89 pt (Chromium ปัดเป็นพิกเซล ±1)
    expect(Math.abs(Number(box![1]) - 595.28)).toBeLessThan(2);
    expect(Math.abs(Number(box![2]) - 841.89)).toBeLessThan(2);
  });

  it("asset ที่ HTML อ้างแต่ไม่ได้ส่ง → 409 ไม่ได้ PDF รูปแตก", async () => {
    const withoutPhoto = (await assets()).filter((a) => a.name !== "card.png");
    const err = await renderError(client.htmlToPdf({ html: RECEIPT_HTML, files: withoutPhoto }));
    expect(err).toMatchObject({ kind: "http", status: 409 });
    expect(err.body).toMatch(/failed to load resources/i);
  });

  it("รหัสผ่านผิด → 401", async () => {
    const wrong = createGotenbergClient({ ...TEST_GOTENBERG, GOTENBERG_PASSWORD: "wrong-password" });
    expect(await renderError(wrong.htmlToPdf({ html: "<p>x</p>" }))).toMatchObject({ kind: "http", status: 401 });
  });

  it("health: Chromium พร้อม", async () => {
    expect((await client.health()).up).toBe(true);
  });
});
