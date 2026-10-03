import { readFileSync } from "node:fs";
import { type APIRequestContext, type APIResponse, expect } from "@playwright/test";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  type PDFContext,
  type PDFObject,
  type PDFPage,
  decodePDFRawStream,
} from "pdf-lib";
import { getDocumentProxy } from "unpdf";
import { stackEnv, target } from "./target";

/**
 * Gotenberg exactly as the api calls it (apps/api/src/lib/gotenberg.ts on feat/api-pdf-client · spec §9.2):
 * POST /forms/chromium/convert/html with preemptive Basic auth (RFC 7617), index.html as UTF-8 with a BOM,
 * A4 as the fallback paper, zero margins (the HTML's `@page` decides), fail on a missing asset or a console
 * exception. No pdfa/pdfua on purpose: the LibreOffice PDF/A pass drops Thai tone marks (spec §9.2).
 */
export const CONVERT_PATH = "/forms/chromium/convert/html";
export const CONVERT_FIELDS: Readonly<Record<string, string>> = {
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
};
export const GOTENBERG_USERNAME = "ong";

/** ISO 216 A4 in PostScript points (1/72 in): 210 × 297 mm = 595.28 × 841.89 pt */
export const A4_PT = { width: (210 / 25.4) * 72, height: (297 / 25.4) * 72 } as const;

/** ISO 216 A5 in points: 148 × 210 mm = 419.53 × 595.28 pt (ใบรับซื้อตั้งแต่ 3 ต.ค. 2569) */
export const A5_PT = { width: (148 / 25.4) * 72, height: (210 / 25.4) * 72 } as const;

/** the only faces a receipt may use — services/gotenberg/Dockerfile installs exactly these two */
export const SARABUN_FACES = ["Sarabun-Regular", "Sarabun-Bold"] as const;

/** the shared secret of this stack (never printed) — E2E_GOTENBERG_PASSWORD wins over stack.sh's secrets file */
export function gotenbergPassword(): string {
  const password = process.env.E2E_GOTENBERG_PASSWORD ?? stackEnv().E2E_GOTENBERG_PASSWORD;
  if (!password) throw new Error("no Gotenberg password — start the stack: make e2e-up, or set E2E_GOTENBERG_PASSWORD");
  return password;
}

/** `Authorization` value for HTTP Basic (RFC 7617) */
export function basicAuth(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

/** an HTML fixture from tests/e2e/fixtures/pdf — synthetic data only */
export function pdfFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/pdf/${name}`, import.meta.url), "utf8");
}

/** the multipart body the api builds: the BOM makes Chromium read UTF-8 whatever the markup claims */
function convertForm(html: string, fields: Readonly<Record<string, string>>): FormData {
  const form = new FormData();
  const utf8Html = html.startsWith("\uFEFF") ? html : `\uFEFF${html}`;
  form.append("files", new Blob([utf8Html], { type: "text/html; charset=utf-8" }), "index.html");
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return form;
}

/** the raw convert call — `authorization` left out = no credentials at all (access-control tests) */
export async function convert(
  api: APIRequestContext,
  html: string,
  options: { fields?: Readonly<Record<string, string>>; authorization?: string } = {},
): Promise<APIResponse> {
  return api.post(`${target.gotenbergURL}${CONVERT_PATH}`, {
    headers: options.authorization === undefined ? {} : { authorization: options.authorization },
    multipart: convertForm(html, { ...CONVERT_FIELDS, ...options.fields }),
    timeout: 60_000,
  });
}

/** HTML → PDF bytes through the stack's Gotenberg, with the shared secret; `fields` add to or override the api's */
export async function render(
  api: APIRequestContext,
  html: string,
  fields: Readonly<Record<string, string>> = {},
): Promise<Buffer> {
  const res = await convert(api, html, { fields, authorization: basicAuth(GOTENBERG_USERNAME, gotenbergPassword()) });
  const body = await res.body();
  expect(res.status(), `${CONVERT_PATH} → ${body.toString("utf8", 0, 300)}`).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  return body;
}

export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfFont {
  /** 1-based page whose resources (or a form XObject on it) name the font */
  page: number;
  /** resource name in the content stream, e.g. "F4" */
  resource: string;
  /** Subtype, with the descendant's for composite fonts: "Type0/CIDFontType2" · "TrueType" · "Type3" … */
  subtype: string;
  /** BaseFont with its subset tag, e.g. "BAAAAA+Sarabun-Regular" — Type 3 fonts have none */
  baseFont: string | null;
  /** FontDescriptor /FontName (ISO 32000-1 §9.8.1) */
  fontName: string | null;
  /** BaseFont (or FontName) without the subset tag — "Sarabun-Regular" */
  postScriptName: string | null;
  /** six capitals + "+" in front of the name: only the used glyphs are embedded (§9.6.4) */
  subset: boolean;
  /**
   * the font program the descriptor embeds (§9.9 Table 126): FontFile2 = TrueType. A Type 3 font draws its glyphs
   * with content-stream procedures instead (§9.6.5), so it counts as not embedded here.
   */
  fontFile: "FontFile" | "FontFile2" | "FontFile3" | null;
  embedded: boolean;
  /** /ToUnicode CMap present — what text extraction maps glyphs through (§9.10.3) */
  toUnicode: boolean;
}

export interface PdfInspection {
  /** bytes */
  size: number;
  /** first line, e.g. "%PDF-1.4" (ISO 32000-1 §7.5.2) */
  header: string;
  /** the line after the header is a comment with ≥ 4 bytes ≥ 128 — transfer tools treat the file as binary (§7.5.2) */
  binaryComment: boolean;
  /** what follows the last "%%EOF" if that marker is within the last 1024 bytes; null = no marker there (§7.5.5) */
  eofTail: string | null;
  /** pdf-lib's page tree count */
  pageCount: number;
  /** PDF.js's count — a second, independent parser */
  pdfJsPageCount: number;
  /** per page, MediaBox after inheritance (§7.7.3.4 · §14.11.2), in points */
  mediaBoxes: PdfBox[];
  /** per page, /Rotate in degrees */
  rotations: number[];
  title: string | undefined;
  producer: string | undefined;
  creator: string | undefined;
  fonts: PdfFont[];
  /** per page, what a reader that honours /ActualText gets (§14.9.4), NFC (UAX #15) — see readText */
  text: string[];
  /** per page, glyphs through /ToUnicode only — what PDF.js alone (unpdf's extractText) returns */
  toUnicodeText: string[];
}

/** structure (pdf-lib, ISO 32000) + text (PDF.js via unpdf) of a PDF — no rasterising */
export async function inspect(bytes: Uint8Array): Promise<PdfInspection> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  const pages = doc.getPages();
  const text = await readText(doc, bytes);
  return {
    size: buffer.length,
    ...fileMarkers(buffer),
    pageCount: doc.getPageCount(),
    pdfJsPageCount: text.pageCount,
    mediaBoxes: pages.map((page) => page.getMediaBox()),
    rotations: pages.map((page) => page.getRotation().angle),
    // updateMetadata: false above — otherwise pdf-lib reports itself as the producer
    title: doc.getTitle(),
    producer: doc.getProducer(),
    creator: doc.getCreator(),
    fonts: pages.flatMap((page, index) => collectFonts(doc.context, page.node.Resources(), index + 1, new Set())),
    text: text.text,
    toUnicodeText: text.toUnicodeText,
  };
}

function fileMarkers(buffer: Buffer): Pick<PdfInspection, "header" | "binaryComment" | "eofTail"> {
  const head = buffer.toString("latin1", 0, Math.min(buffer.length, 1024));
  const [header = "", second = ""] = head.split(/\r\n|\r|\n/);
  const highBytes = [...second].filter((char) => char.charCodeAt(0) >= 128).length;
  const tail = buffer.toString("latin1", Math.max(0, buffer.length - 1024));
  const eof = tail.lastIndexOf("%%EOF");
  return {
    header,
    binaryComment: second.startsWith("%") && highBytes >= 4,
    eofTail: eof < 0 ? null : tail.slice(eof + "%%EOF".length),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Fonts — walk /Resources /Font of every page and of the form XObjects it draws (ISO 32000-1 §7.8.3 · §8.10),
// Type0 → /DescendantFonts → /FontDescriptor → /FontFile* (§9.6–9.9)

/** six capitals and "+" in front of a subset font's name (§9.6.4) */
const SUBSET_TAG = /^[A-Z]{6}\+/;

function nameOf(object: PDFObject | undefined): string | null {
  return object instanceof PDFName ? object.decodeText() : null;
}

function collectFonts(
  context: PDFContext,
  resources: PDFDict | undefined,
  page: number,
  seen: Set<PDFDict>,
): PdfFont[] {
  if (!resources || seen.has(resources)) return [];
  seen.add(resources);
  const fonts: PdfFont[] = [];
  for (const [name, ref] of resources.lookupMaybe(PDFName.of("Font"), PDFDict)?.entries() ?? []) {
    const font = context.lookup(ref);
    if (font instanceof PDFDict) fonts.push(describeFont(page, name.decodeText(), font));
  }
  for (const [, ref] of resources.lookupMaybe(PDFName.of("XObject"), PDFDict)?.entries() ?? []) {
    const xobject = context.lookup(ref);
    if (xobject instanceof PDFRawStream && nameOf(xobject.dict.lookup(PDFName.of("Subtype"))) === "Form") {
      fonts.push(...collectFonts(context, xobject.dict.lookupMaybe(PDFName.of("Resources"), PDFDict), page, seen));
    }
  }
  return fonts;
}

function describeFont(page: number, resource: string, font: PDFDict): PdfFont {
  let subtype = nameOf(font.lookup(PDFName.of("Subtype"))) ?? "?";
  let descriptorOwner: PDFDict | undefined = font;
  if (subtype === "Type0") {
    const descendant = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray)?.lookupMaybe(0, PDFDict);
    subtype = `Type0/${nameOf(descendant?.lookup(PDFName.of("Subtype"))) ?? "?"}`;
    descriptorOwner = descendant;
  }
  const descriptor = descriptorOwner?.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  const fontFile = (["FontFile", "FontFile2", "FontFile3"] as const).find((key) => descriptor?.has(PDFName.of(key)));
  const baseFont = nameOf(font.lookup(PDFName.of("BaseFont")));
  const fontName = nameOf(descriptor?.lookup(PDFName.of("FontName")));
  const name = baseFont ?? fontName;
  return {
    page,
    resource,
    subtype,
    baseFont,
    fontName,
    postScriptName: name?.replace(SUBSET_TAG, "") ?? null,
    subset: SUBSET_TAG.test(name ?? ""),
    fontFile: fontFile ?? null,
    embedded: fontFile !== undefined,
    toUnicode: font.has(PDFName.of("ToUnicode")),
  };
}

/**
 * Everything that keeps these fonts from being "Sarabun only, embedded as TrueType" — [] when they are.
 * Allowed: SARABUN_FACES, each with a FontFile2 program. Every face in `required` must actually be used — no
 * Sarabun-Bold means the bold text came from some other face. Anything else (Noto Sans Thai, Liberation Sans,
 * DejaVu, a Type 3 font) is what fontconfig and Chromium fell back to.
 */
export function fontProblems(fonts: readonly PdfFont[], required: readonly string[] = SARABUN_FACES): string[] {
  const allowed = new Set<string>(SARABUN_FACES);
  const problems: string[] = [];
  for (const font of fonts) {
    const label = `${font.resource} ${font.baseFont ?? font.fontName ?? "(unnamed)"} [${font.subtype}]`;
    if (!allowed.has(font.postScriptName ?? "")) problems.push(`${label}: not Sarabun — a fallback font`);
    if (font.fontFile !== "FontFile2") {
      problems.push(`${label}: not embedded as TrueType (FontFile2) — found ${font.fontFile ?? "no font program"}`);
    }
  }
  for (const face of required) {
    if (!fonts.some((font) => font.postScriptName === face)) problems.push(`${face}: not used`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Text
//
// Chromium's PDF backend (Skia) shapes Thai with HarfBuzz: SARA AM becomes NIKHAHIT + SARA AA glyphs, and a tone
// mark raised over an upper vowel, a mark moved left for a tall consonant (ป), the NIKHAHIT + tone ligature and ญ
// without its tail are glyph substitutes the font's cmap does not reach — Skia writes <0000> for them in
// /ToUnicode. The text stays exact anyway: every cluster whose glyphs are not one-to-one with its characters sits
// in `/Span <</ActualText …>> BDC … EMC` (ISO 32000-1 §14.9.4), and readers that implement it get the source text
// (Poppler's pdftotext returns the fixture exactly). PDF.js 6.1 (bundled in unpdf 1.8) does not: its text items
// carry U+0000 there, so a tone mark looks lost although its glyph is on the page.
// readText therefore applies /ActualText itself: PDF.js lists the marked-content sequences in content-stream order
// (includeMarkedContent), a small tokenizer finds the same BMC/BDC/EMC operators with their property lists, and
// the text inside a span is replaced by its ActualText.

type PdfJsDocument = Awaited<ReturnType<typeof getDocumentProxy>>;
type PdfJsPage = Awaited<ReturnType<PdfJsDocument["getPage"]>>;
type PdfJsItem = Awaited<ReturnType<PdfJsPage["getTextContent"]>>["items"][number];

async function readText(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<{ pageCount: number; text: string[]; toUnicodeText: string[] }> {
  // a copy: PDF.js may take ownership of the buffer it is handed
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    const text: string[] = [];
    const toUnicodeText: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const content = await (
        await pdf.getPage(number)
      ).getTextContent({
        includeMarkedContent: true,
        // PDF.js's own NFKC pass is off: the only normalisation is the NFC below
        disableNormalization: true,
      });
      const joined = applyActualText(content.items, markedContent(doc, doc.getPage(number - 1)), number);
      text.push(joined.actualText.normalize("NFC"));
      toUnicodeText.push(joined.glyphs);
    }
    return { pageCount: pdf.numPages, text, toUnicodeText };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

interface Run {
  str: string;
  hasEOL: boolean;
}

interface OpenSpan {
  actualText: string | undefined;
  /** outermost span with ActualText — nested replacement text is covered by it */
  replacing: boolean;
  placed: boolean;
}

/** the same join as unpdf's extractText: item text, "\n" after each item that ends a line */
const joinRuns = (runs: readonly Run[]): string => runs.map((run) => run.str + (run.hasEOL ? "\n" : "")).join("");

function applyActualText(
  items: readonly PdfJsItem[],
  marks: readonly Mark[],
  page: number,
): { actualText: string; glyphs: string } {
  const withActualText: Run[] = [];
  const glyphs: Run[] = [];
  const open: OpenSpan[] = [];
  let next = 0;
  for (const item of items) {
    if (!("str" in item)) {
      const mark = marks[next++];
      const tag = (item as { tag?: unknown }).tag;
      const matches =
        item.type === "endMarkedContent"
          ? mark?.begin === false
          : mark?.begin === true && (typeof tag !== "string" || tag === mark.tag);
      if (!matches) {
        throw new Error(
          `page ${page}: PDF.js and the content stream disagree on marked content #${next} ` +
            `(${item.type} ${String(tag)} vs ${JSON.stringify(mark)}) — cannot place /ActualText`,
        );
      }
      if (mark?.begin) {
        const replacing = mark.actualText !== undefined && !open.some((span) => span.replacing);
        open.push({ actualText: mark.actualText, replacing, placed: false });
      } else {
        const span = open.pop();
        if (span?.replacing && !span.placed) withActualText.push({ str: span.actualText ?? "", hasEOL: false });
      }
      continue;
    }
    glyphs.push({ str: item.str, hasEOL: item.hasEOL });
    const span = open.find((candidate) => candidate.replacing);
    if (!span || /^\s*$/.test(item.str)) {
      // PDF.js reports the gap before a glyph run as a white-space item inside the next span: it is not the span's
      withActualText.push({ str: item.str, hasEOL: item.hasEOL });
    } else if (!span.placed) {
      const [, lead = "", trail = ""] = /^(\s*)[\s\S]*?(\s*)$/.exec(item.str) ?? [];
      withActualText.push({ str: `${lead}${span.actualText ?? ""}${trail}`, hasEOL: item.hasEOL });
      span.placed = true;
    } else {
      withActualText.push({ str: "", hasEOL: item.hasEOL });
    }
  }
  if (next !== marks.length) {
    throw new Error(
      `page ${page}: PDF.js reported ${next} marked-content operators, the content stream has ${marks.length}`,
    );
  }
  return { actualText: joinRuns(withActualText), glyphs: joinRuns(glyphs) };
}

type Mark = { begin: true; tag: string | null; actualText: string | undefined } | { begin: false };

/** BMC/BDC/EMC of a page in drawing order, form XObjects inlined where `Do` draws them — as PDF.js walks them */
function markedContent(doc: PDFDocument, page: PDFPage): Mark[] {
  const contents = page.node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  const marks: Mark[] = [];
  scanMarkedContent(doc.context, streams, page.node.Resources(), marks, new Set());
  return marks;
}

function scanMarkedContent(
  context: PDFContext,
  streams: readonly (PDFObject | undefined)[],
  resources: PDFDict | undefined,
  marks: Mark[],
  ancestors: Set<PDFObject>,
): void {
  // an array of content streams is one stream split between tokens (§7.8.2)
  const decoded = streams.map((stream) => {
    if (!(stream instanceof PDFRawStream)) throw new Error("content stream is not a stream");
    return decodePDFRawStream(stream).decode();
  });
  const source = Buffer.concat(decoded.flatMap((bytes) => [bytes, Buffer.from("\n")]));
  let depth = 0;
  for (const [operator, operands] of operations(source)) {
    const first = operands[0];
    if (operator === "BMC" || operator === "BDC") {
      depth++;
      const tag = first instanceof Name ? first.value : null;
      const actualText = operator === "BDC" ? actualTextOf(operands[1], resources) : undefined;
      marks.push({ begin: true, tag, actualText });
    } else if (operator === "EMC") {
      // PDF.js ignores an EMC without its BMC/BDC — so does this
      if (depth > 0) {
        depth--;
        marks.push({ begin: false });
      }
    } else if (operator === "Do" && first instanceof Name) {
      const ref = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.get(PDFName.of(first.value));
      const xobject = ref === undefined ? undefined : context.lookup(ref);
      const isForm = xobject instanceof PDFRawStream && nameOf(xobject.dict.lookup(PDFName.of("Subtype"))) === "Form";
      if (isForm && !ancestors.has(xobject)) {
        const own = xobject.dict.lookupMaybe(PDFName.of("Resources"), PDFDict);
        scanMarkedContent(context, [xobject], own ?? resources, marks, new Set([...ancestors, xobject]));
      }
    }
  }
}

/** /ActualText of a BDC property list: inline dictionary, or a name in the /Properties resource (§14.6.2) */
function actualTextOf(properties: Operand | undefined, resources: PDFDict | undefined): string | undefined {
  if (properties instanceof Map) {
    const value = properties.get("ActualText");
    return value instanceof Uint8Array ? textString(value) : undefined;
  }
  if (properties instanceof Name) {
    const list = resources
      ?.lookupMaybe(PDFName.of("Properties"), PDFDict)
      ?.lookupMaybe(PDFName.of(properties.value), PDFDict);
    return list?.lookupMaybe(PDFName.of("ActualText"), PDFString, PDFHexString)?.decodeText();
  }
  return undefined;
}

/** PDF text string (§7.9.2.2): UTF-16BE with BOM or PDFDocEncoding — plus UTF-8 with BOM (ISO 32000-2) */
function textString(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder().decode(bytes.subarray(3));
  return PDFHexString.of(Buffer.from(bytes).toString("hex")).decodeText();
}

// ---------------------------------------------------------------------------------------------------------------
// Content-stream tokenizer — ISO 32000-1 §7.2 lexical conventions, §7.8.2 content streams, §8.9.7 inline images.
// Just enough to find operators and their operands; strings are skipped correctly, so text never passes for an
// operator.

class Name {
  constructor(readonly value: string) {}
}

class Keyword {
  constructor(readonly value: string) {}
}

type Operand = number | boolean | null | Uint8Array | Name | Operand[] | Map<string, Operand>;
type Token = number | Uint8Array | Name | Keyword | "[" | "]" | "<<" | ">>";

const WHITE_SPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]); // Table 1
const DELIMITERS = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]); // ( ) < > [ ] { } / %
// Table 3: \n \r \t \b \f \( \) \\
const ESCAPES = new Map([
  [0x6e, 0x0a],
  [0x72, 0x0d],
  [0x74, 0x09],
  [0x62, 0x08],
  [0x66, 0x0c],
  [0x28, 0x28],
  [0x29, 0x29],
  [0x5c, 0x5c],
]);
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const HEX_DIGIT = /^[0-9A-Fa-f]$/;

function* operations(source: Uint8Array): Generator<[string, Operand[]]> {
  const root: Operand[] = [];
  const containers: Operand[][] = [root];
  for (const token of tokens(source)) {
    const top = containers[containers.length - 1] ?? root;
    if (token === "[" || token === "<<") {
      containers.push([]);
    } else if (token === "]" || token === ">>") {
      if (containers.length === 1) continue; // unbalanced — ignored
      const items = containers.pop() ?? [];
      (containers[containers.length - 1] ?? root).push(token === "]" ? items : toDictionary(items));
    } else if (token instanceof Keyword) {
      if (token.value === "true" || token.value === "false") top.push(token.value === "true");
      else if (token.value === "null") top.push(null);
      // an operator inside [ ] or << >> is malformed and dropped
      else if (containers.length === 1) yield [token.value, root.splice(0)];
    } else {
      top.push(token);
    }
  }
}

function toDictionary(items: readonly Operand[]): Map<string, Operand> {
  const dictionary = new Map<string, Operand>();
  for (let i = 0; i + 1 < items.length; i += 2) {
    const key = items[i];
    const value = items[i + 1];
    if (key instanceof Name && value !== undefined) dictionary.set(key.value, value);
  }
  return dictionary;
}

function* tokens(source: Uint8Array): Generator<Token> {
  const at = (index: number): number => source[index] ?? -1;
  const isRegular = (byte: number): boolean => byte >= 0 && !WHITE_SPACE.has(byte) && !DELIMITERS.has(byte);
  const latin1 = (from: number, to: number): string => Buffer.from(source.subarray(from, to)).toString("latin1");
  let i = 0;
  while (i < source.length) {
    const byte = at(i);
    if (WHITE_SPACE.has(byte)) {
      i++;
    } else if (byte === 0x25) {
      // % comment to the end of the line
      while (i < source.length && at(i) !== 0x0a && at(i) !== 0x0d) i++;
    } else if (byte === 0x28) {
      const [value, end] = literalString(source, i + 1);
      i = end;
      yield value;
    } else if (byte === 0x3c && at(i + 1) === 0x3c) {
      i += 2;
      yield "<<";
    } else if (byte === 0x3e && at(i + 1) === 0x3e) {
      i += 2;
      yield ">>";
    } else if (byte === 0x3c) {
      // hex string: white space ignored, an odd final digit is followed by 0 (§7.3.4.3)
      const close = source.indexOf(0x3e, i + 1);
      const end = close < 0 ? source.length : close;
      const digits = latin1(i + 1, end).replace(/[^0-9A-Fa-f]/g, "");
      i = end + 1;
      yield Buffer.from(digits.length % 2 === 0 ? digits : `${digits}0`, "hex");
    } else if (byte === 0x5b || byte === 0x5d) {
      i++;
      yield byte === 0x5b ? "[" : "]";
    } else if (byte === 0x2f) {
      // name: regular characters, #xx escapes (§7.3.5)
      let name = "";
      i++;
      while (isRegular(at(i))) {
        const escaped = latin1(i + 1, i + 3);
        if (at(i) === 0x23 && escaped.length === 2 && [...escaped].every((c) => HEX_DIGIT.test(c))) {
          name += String.fromCharCode(Number.parseInt(escaped, 16));
          i += 3;
        } else {
          name += String.fromCharCode(at(i));
          i++;
        }
      }
      yield new Name(name);
    } else if (!isRegular(byte)) {
      i++; // a stray ) > { } — not in a well-formed content stream
    } else {
      const start = i;
      while (isRegular(at(i))) i++;
      const word = latin1(start, i);
      if (NUMBER.test(word)) {
        yield Number(word);
      } else {
        yield new Keyword(word);
        if (word === "ID") i = endOfInlineImage(source, i);
      }
    }
  }
}

/** literal string from just after its "(" (§7.3.4.2) → [bytes, index after the closing ")"] */
function literalString(source: Uint8Array, start: number): [Uint8Array, number] {
  const out: number[] = [];
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const byte = source[i++] ?? 0;
    if (byte === 0x5c) {
      const next = source[i++] ?? 0;
      const escaped = ESCAPES.get(next);
      if (escaped !== undefined) {
        out.push(escaped);
      } else if (next >= 0x30 && next <= 0x37) {
        // \ddd octal, up to three digits, high-order overflow ignored
        let value = next - 0x30;
        for (let digits = 1; digits < 3 && (source[i] ?? 0) >= 0x30 && (source[i] ?? 0) <= 0x37; digits++) {
          value = value * 8 + (source[i++] ?? 0x30) - 0x30;
        }
        out.push(value & 0xff);
      } else if (next === 0x0d) {
        if (source[i] === 0x0a) i++; // backslash + end of line: the string continues on the next line
      } else if (next !== 0x0a) {
        out.push(next); // any other escaped byte stands for itself
      }
    } else if (byte === 0x28) {
      depth++;
      out.push(byte);
    } else if (byte === 0x29) {
      if (--depth === 0) break;
      out.push(byte);
    } else if (byte === 0x0d) {
      if (source[i] === 0x0a) i++;
      out.push(0x0a); // an unescaped end of line reads as LF
    } else {
      out.push(byte);
    }
  }
  return [Uint8Array.from(out), i];
}

/** BI … ID <data> EI: data starts after one white-space byte and ends at the first "EI" between white space */
function endOfInlineImage(source: Uint8Array, afterId: number): number {
  const isWhite = (index: number): boolean => WHITE_SPACE.has(source[index] ?? -1);
  for (let j = afterId + 1; j + 1 < source.length; j++) {
    const atEnd = j + 2 >= source.length || isWhite(j + 2) || DELIMITERS.has(source[j + 2] ?? -1);
    if (source[j] === 0x45 && source[j + 1] === 0x49 && isWhite(j - 1) && atEnd) return j;
  }
  return source.length;
}
