import { isValidNationalId } from "@ong/core";
import { type APIRequestContext, type TestInfo, test as base, expect } from "@playwright/test";
import { A4_PT, type PdfInspection, fontProblems, inspect, pdfFixture, render } from "../../lib/pdf";

/**
 * Golden checks of what Gotenberg (Chromium) makes of a Thai A4 page — the archive copy of every receipt is such a
 * PDF, kept for the tax office (spec §9). Structure and text only: pixel diffs break on every Chromium release
 * without a bug. A new Gotenberg image must pass this file before it ships.
 */

const HTML = pdfFixture("thai-a4.html");

/** each <h1>/<p> in the fixture's body as a reader sees it: comments and tags dropped, white space collapsed */
const BODY = (/<body>([\s\S]*)<\/body>/.exec(HTML)?.[1] ?? "").replace(/<!--[\s\S]*?-->/g, "");
const FIXTURE_LINES = [...BODY.matchAll(/<(h1|p)>([\s\S]*?)<\/\1>/g)].map((match) =>
  (match[2] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim(),
);
const FIXTURE_TITLE = /<title>([^<]*)<\/title>/.exec(HTML)?.[1];

/** the words the LibreOffice PDF/A pass broke (spec §9.2: ซื้อ→ซือ · ที่→ที · น้ำ→นา) — plus SARA AM on its own */
const REGRESSION_WORDS = ["ซื้อ", "ที่", "น้ำ", "ทองคำ"];

/**
 * What a reader that ignores /ActualText gets from the Sarabun render: PDF.js 6.1 via unpdf (PDF.js is also the
 * engine of Firefox's viewer). The LibreOffice PDF/A pass of spec §9.2 drops exactly the marks that come out as
 * U+0000 here (tried with pdfa=PDF/A-2b on this fixture: ซื้อ→ซือ · ที่→ที · น้ำ→นา · เป็น→เปน · ชื่อ→ชือ).
 * Observed on Gotenberg 8.37.0 (HeadlessChrome 152, Skia/PDF m152) with Sarabun; NFC changes none of it.
 * Glyph by glyph through /ToUnicode:
 * - ำ SARA AM (U+0E33) is drawn as NIKHAHIT + SARA AA → "\u0e4d\u0e32". NFC does not undo that: SARA AM's
 *   decomposition is a compatibility one (NFKD), not canonical.
 * - a tone mark or MAITAIKHU raised over an upper vowel (ซื้ ที่ นี้ จี๊ ตี๋ ญี่ หมื่ ชื่) or moved left for a tall
 *   consonant (ปู่ ปุ่ เป็), the NIKHAHIT + MAI THO ligature of น้ำ, and ญ without its tail before ู are glyph
 *   substitutes the font's cmap does not reach: Skia writes <0000> for them → U+0000. The glyphs are on the page.
 * - a mark on a plain consonant (ก่ ย่ ผู้ ร้ ห้ ถ้ เจ็ ตั) and everything else maps one to one; spaces and line
 *   breaks come out as in the source, no extra ones.
 */
const GLYPHS_ONLY_LINES = [
  "ใบรับซื\u0000อทองค\u0e4d\u0e32 (ทดสอบ)",
  "ซื\u0000อ ที\u0000 น\u0000า ทองค\u0e4d\u0e32",
  "ปู\u0000ย่า กี\u0000 ผู้ นี\u0000 จี\u0000ด ตี\u0000 ญี\u0000ปุ\u0000น กตัญ\u0000ู",
  "ก่ ก้ ก๊ ก๋ กั กิ กี กึ กื กุ กู ก็ ก์",
  "๐๑๒๓๔๕๖๗๘๙ 0123456789",
  "รวมเป\u0000นเงิน 67,850.00 บาท (๖๗,๘๕๐.๐๐ บาท)",
  "หกหมื\u0000นเจ็ดพันแปดร้อยห้าสิบบาทถ้วน",
  "ชื\u0000อผู้ขาย : ทดสอบ ใจดี เลขประจ\u0e4d\u0e32ตัวประชาชน 1 0000 12345 67 7",
];

// ่ ้ ๊ ๋ tone marks · ั ิ ี ึ ื above · ุ ู below · ็ MAITAIKHU · ์ THANTHAKHAT
const MARKS = [0x0e48, 0x0e49, 0x0e4a, 0x0e4b, 0x0e31, 0x0e34, 0x0e35, 0x0e36, 0x0e37, 0x0e38, 0x0e39, 0x0e47, 0x0e4c];

const codePoints = (text: string): string =>
  [...text].map((char) => `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`).join(" ");

/** the fixture with its one font-family swapped — refuses a fixture that no longer declares it exactly once */
function withFontFamily(html: string, from: string, to: string): string {
  const declaration = `font-family: "${from}"`;
  const count = html.split(declaration).length - 1;
  if (count !== 1) throw new Error(`the fixture must declare ${declaration} exactly once — found ${count}`);
  return html.replace(declaration, `font-family: "${to}"`);
}

interface Rendered {
  name: string;
  bytes: Buffer;
  pdf: PdfInspection;
}

async function renderAndInspect(api: APIRequestContext, name: string, html: string): Promise<Rendered> {
  const bytes = await render(api, html);
  return { name, bytes, pdf: await inspect(bytes) };
}

/** the exact bytes each test looked at, for a human to open from the report — never committed */
async function attach(testInfo: TestInfo, rendered: Rendered): Promise<void> {
  await testInfo.attach(rendered.name, { body: rendered.bytes, contentType: "application/pdf" });
  const summary = JSON.stringify(rendered.pdf, null, 2);
  await testInfo.attach(`${rendered.name}.json`, { body: summary, contentType: "application/json" });
}

// Each PDF is rendered once per worker; the test-scoped fixtures attach it to every test that reads it.
const test = base.extend<
  { sarabun: Rendered; fallback: Rendered },
  { gotenberg: APIRequestContext; sarabunRender: Rendered; fallbackRender: Rendered }
>({
  gotenberg: [
    async ({ playwright }, use) => {
      const api = await playwright.request.newContext();
      await use(api);
      await api.dispose();
    },
    { scope: "worker" },
  ],
  sarabunRender: [
    async ({ gotenberg }, use) => {
      await use(await renderAndInspect(gotenberg, "thai-a4.pdf", HTML));
    },
    { scope: "worker", timeout: 90_000 },
  ],
  fallbackRender: [
    async ({ gotenberg }, use) => {
      const html = withFontFamily(HTML, "Sarabun", "NoSuchFont");
      await use(await renderAndInspect(gotenberg, "thai-a4-nosuchfont.pdf", html));
    },
    { scope: "worker", timeout: 90_000 },
  ],
  sarabun: async ({ sarabunRender }, use, testInfo) => {
    await attach(testInfo, sarabunRender);
    await use(sarabunRender);
  },
  fallback: async ({ fallbackRender }, use, testInfo) => {
    await attach(testInfo, fallbackRender);
    await use(fallbackRender);
  },
});

test.describe("Gotenberg renders the Thai A4 fixture", () => {
  // in order in one worker, so each PDF is rendered once for all of these checks (they stay independent)
  test.describe.configure({ mode: "default" });

  test("fixture: the Thai under test, in NFC, with synthetic data only", () => {
    // one expected line per h1/p, no markup leaking in; the glyph golden below follows the same lines
    for (const line of FIXTURE_LINES) expect(line, "expected line holds markup or nothing").toMatch(/^[^<>]+$/);
    expect(FIXTURE_LINES).toHaveLength(GLYPHS_ONLY_LINES.length);
    const text = FIXTURE_LINES.join("\n");
    for (const needle of [...REGRESSION_WORDS, "ปู่ย่า", "กี่", "ผู้", "๐๑๒๓๔๕๖๗๘๙", "0123456789", "67,850.00 บาท"]) {
      expect(text, `fixture lost ${needle}`).toContain(needle);
    }
    for (const mark of MARKS.map((code) => String.fromCodePoint(code))) {
      expect(text, `fixture lost ${codePoints(mark)}`).toContain(mark);
    }
    expect(text, "the fixture is NFC (UAX #15)").toBe(text.normalize("NFC"));
    expect(FIXTURE_TITLE).toBeTruthy();
    // CLAUDE.md rule 8 · PDPA: the seller is "ทดสอบ …", the ID is made up — valid check digit, province 00
    expect(text).toContain("ผู้ขาย : ทดสอบ ");
    const nationalId = /\b(\d) (\d{4}) (\d{5}) (\d{2}) (\d)\b/.exec(text)?.slice(1).join("") ?? "";
    expect(isValidNationalId(nationalId), nationalId).toBe(true);
    expect(nationalId.slice(1, 3), "province 00 does not exist").toBe("00");
  });

  test("is a complete PDF: header, binary marker, %%EOF, one page (ISO 32000-1 §7.5)", ({ sarabun }) => {
    const { pdf } = sarabun;
    // §7.5.2: the first line is %PDF-1.n (or 2.0) — Chromium writes 1.4
    expect(pdf.header).toMatch(/^%PDF-(1\.[0-7]|2\.0)$/);
    // §7.5.2: then a comment of ≥ 4 bytes ≥ 128, so no transfer treats the file as text
    expect(pdf.binaryComment).toBe(true);
    // §7.5.5: the last line is %%EOF — readers look within the last 1024 bytes; nothing but an end of line after it
    expect(pdf.eofTail, "no %%EOF within the last 1024 bytes").not.toBeNull();
    expect(pdf.eofTail).toMatch(/^(\r\n|\r|\n)?$/);
    // two independent parsers agree: exactly one page, no blank overflow page
    expect(pdf.pageCount).toBe(1);
    expect(pdf.pdfJsPageCount).toBe(1);
  });

  test("is A4 portrait: MediaBox 595.28 × 841.89 pt ± 0.5 (ISO 216 · ISO 32000-1 §14.11.2)", ({ sarabun }) => {
    const { pdf } = sarabun;
    expect(pdf.mediaBoxes).toHaveLength(1);
    for (const [index, box] of pdf.mediaBoxes.entries()) {
      const page = `page ${index + 1}: MediaBox [${box.x} ${box.y} ${box.x + box.width} ${box.y + box.height}]`;
      expect(Math.abs(box.width - A4_PT.width), page).toBeLessThanOrEqual(0.5);
      expect(Math.abs(box.height - A4_PT.height), page).toBeLessThanOrEqual(0.5);
      expect(pdf.rotations[index], `${page} is rotated`).toBe(0);
    }
  });

  test("comes straight from Chromium, with the document title", ({ sarabun }) => {
    const { pdf } = sarabun;
    // Skia is Chromium's PDF backend; a LibreOffice (PDF/A) pass would sign here — and drop tone marks (spec §9.2)
    expect(pdf.producer).toMatch(/^Skia\/PDF m\d+$/);
    expect(pdf.creator).toMatch(/\bHeadlessChrome\/\d+/);
    // the api puts the document number in <title>; Chromium carries it into /Title (ISO 32000-1 §14.3.3)
    expect(pdf.title).toBe(FIXTURE_TITLE);
  });

  test("embeds Sarabun Regular and Bold as TrueType and no other font", ({ sarabun }) => {
    expect(fontProblems(sarabun.pdf.fonts)).toEqual([]);
  });

  test("negative control: without Sarabun the font check fails and names the fallback", ({ fallback }) => {
    const { pdf } = fallback;
    const faces = pdf.fonts.map((font) => font.postScriptName);
    // the same check as above has to fail — otherwise it proves nothing
    expect(fontProblems(pdf.fonts)).not.toEqual([]);
    expect(faces.filter((face) => face?.startsWith("Sarabun"))).toEqual([]);
    // the silent fallback the Dockerfile warns about: fontconfig picks Noto Sans Thai for the Thai glyphs
    expect(faces).toContain("NotoSansThai-Regular");
    expect(fontProblems(pdf.fonts)).toContainEqual(expect.stringContaining("NotoSansThai-Regular"));
    // …and the text still reads back perfectly, so only the font check can tell a receipt lost its font
    expect(pdf.text[0]?.split("\n")).toEqual(FIXTURE_LINES);
  });

  test("reads back every line exactly, tone marks included (/ActualText · NFC)", ({ sarabun }) => {
    const { pdf } = sarabun;
    // glyph → Unicode goes through each font's /ToUnicode CMap (ISO 32000-1 §9.10.3)
    expect(pdf.fonts.filter((font) => !font.toUnicode)).toEqual([]);
    // text = PDF.js items with each cluster's /ActualText applied (ISO 32000-1 §14.9.4, see lib/pdf.ts), then NFC
    // (UAX #15) — a no-op here: the ActualText is the source text. Spaces and line breaks are as in the source.
    expect(pdf.text).toHaveLength(1);
    const text = pdf.text[0] ?? "";
    expect(text.split("\n")).toEqual(FIXTURE_LINES);
    for (const word of REGRESSION_WORDS) expect(text, `${word} = ${codePoints(word)}`).toContain(word);
  });

  test("without /ActualText the stacked marks read as U+0000: present as glyphs, lost as text", ({ sarabun }) => {
    const lines = sarabun.pdf.toUnicodeText[0]?.split("\n");
    expect(lines).toEqual(GLYPHS_ONLY_LINES);
    // the comparison the text test makes fails here — it tells a lost tone mark from a kept one
    expect(lines).not.toEqual(FIXTURE_LINES);
  });
});
