import type { Env } from "../env";

/**
 * Gotenberg (Chromium → PDF) สำหรับใบรับซื้อ/สำเนาบัตรที่เก็บถาวร (spec §9.2 · R15)
 *
 * - POST /forms/chromium/convert/html + basic auth (Railway: private network เท่านั้น)
 * - PDF จาก Chromium ตรง ๆ — **ห้ามเปิด PDF/A**: ขั้นแปลงของ LibreOffice ทำวรรณยุกต์ไทยหาย (ซื้อ→ซือ · ทดสอบ 28 ก.ย.)
 * - layout เป็นของ HTML ที่เดียว (`@page { size: A4; margin: … }`) เหมือน window.print() บนจอ:
 *   preferCssPageSize ให้ CSS ชนะ · ส่ง A4 ไว้เป็นค่าสำรอง (ไม่ส่ง Gotenberg ใช้ Letter) · ขอบ 0 = ขอบมาจาก @page เท่านั้น
 * - asset ที่ HTML อ้าง (ฟอนต์ · รูปบัตร) โหลดไม่ได้ = ล้มทั้งใบ (failOnResourceLoadingFailed)
 *   ดีกว่าได้ PDF ที่รูปแตก/ฟอนต์ผิดเก็บถาวรไปตลอด
 * - ตั้ง `<title>` ใน HTML เป็นเลขที่บิล — Chromium ใส่เป็น Title ของ PDF (ไม่ตั้ง = ชื่อไฟล์สุ่ม)
 */

/** A4 แนวตั้ง (นิ้ว) — ใช้เมื่อ HTML ไม่ได้ประกาศ @page size */
export const A4_INCHES = { width: "8.27", height: "11.69" } as const;
export const GOTENBERG_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 5_000;
const ERROR_BODY_MAX = 300;

/** ค่าเดียวกันทุกใบ — ไม่มี pdfa/pdfua โดยตั้งใจ (ดูบนสุด) */
const CONVERT_FIELDS: Readonly<Record<string, string>> = {
  paperWidth: A4_INCHES.width,
  paperHeight: A4_INCHES.height,
  preferCssPageSize: "true",
  printBackground: "true",
  marginTop: "0",
  marginBottom: "0",
  marginLeft: "0",
  marginRight: "0",
  failOnResourceLoadingFailed: "true",
  failOnConsoleExceptions: "true",
};

// ชื่อไฟล์ asset = ชื่อที่ HTML อ้างแบบ relative — ห้าม path และห้ามชนกับ index.html
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export type FetchLike = (input: URL, init: RequestInit) => Promise<Response>;

export interface PdfAsset {
  /** ชื่อที่ HTML อ้าง เช่น `url('Sarabun-Regular.ttf')` · `<img src="card.jpg">` */
  name: string;
  data: Uint8Array;
  contentType: string;
}

export interface HtmlToPdfInput {
  /** เอกสารเต็ม (`<!doctype html>…`) — ส่งเป็น index.html */
  html: string;
  files?: readonly PdfAsset[];
  /** header `Gotenberg-Trace` — ตามหาใน log ของ Gotenberg ได้ (เช่น เลขที่บิล) */
  trace?: string;
}

export interface GotenbergHealth {
  /** Chromium พร้อมแปลง */
  up: boolean;
  /** HTTP status ของ /health · null = ต่อไม่ได้/หมดเวลา */
  status: number | null;
}

export interface PdfRenderer {
  /** HTML → PDF (byte ขึ้นต้น `%PDF-` และจบด้วย `%%EOF` แล้ว) · ล้ม = PdfRenderError */
  htmlToPdf(input: HtmlToPdfInput): Promise<Uint8Array<ArrayBuffer>>;
  /** ไม่ throw — ใช้เช็กก่อน retry หรือแสดงสถานะ */
  health(): Promise<GotenbergHealth>;
}

/**
 * - `timeout` ไม่ได้คำตอบภายในเวลา · `unreachable` ต่อไม่ได้ (DNS/connection)
 * - `http` Gotenberg ตอบ error (400 form ผิด · 401 รหัสผ่าน · 409 asset โหลดไม่ได้ · 503 ยุ่ง/หมดเวลาฝั่งนั้น)
 * - `not-pdf` ตอบ 2xx แต่ไม่ใช่ PDF ที่ครบไฟล์
 */
export type PdfRenderErrorKind = "timeout" | "unreachable" | "http" | "not-pdf";

export class PdfRenderError extends Error {
  readonly kind: PdfRenderErrorKind;
  /** HTTP status จาก Gotenberg · null = ไม่ได้คำตอบ */
  readonly status: number | null;
  /** ต้นข้อความที่ Gotenberg ตอบ (ตัดสั้น) — ไม่มี HTML ของใบ (มีเลขบัตร) */
  readonly body: string;

  constructor(
    kind: PdfRenderErrorKind,
    message: string,
    details: { status?: number | null; body?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: details.cause });
    this.name = "PdfRenderError";
    this.kind = kind;
    this.status = details.status ?? null;
    this.body = details.body ?? "";
  }
}

type GotenbergEnv = Pick<Env, "GOTENBERG_URL" | "GOTENBERG_USERNAME" | "GOTENBERG_PASSWORD">;

export function createGotenbergClient(
  env: GotenbergEnv,
  options: { fetch?: FetchLike; timeoutMs?: number } = {},
): PdfRenderer {
  const fetchImpl: FetchLike = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? GOTENBERG_TIMEOUT_MS;
  // ต่อ path แบบ relative — ใช้ได้แม้ Gotenberg อยู่หลัง path prefix
  const base = env.GOTENBERG_URL.endsWith("/") ? env.GOTENBERG_URL : `${env.GOTENBERG_URL}/`;
  const convertUrl = new URL("forms/chromium/convert/html", base);
  const healthUrl = new URL("health", base);
  const credentials = Buffer.from(`${env.GOTENBERG_USERNAME}:${env.GOTENBERG_PASSWORD}`, "utf8").toString("base64");
  const authorization = `Basic ${credentials}`;

  return {
    async htmlToPdf({ html, files = [], trace }) {
      const body = buildForm(html, files);
      const headers: Record<string, string> = { authorization };
      if (trace) headers["gotenberg-trace"] = trace;
      // เวลาเดียวครอบทั้งส่ง รอ และอ่านไฟล์กลับ
      const signal = AbortSignal.timeout(timeoutMs);

      let res: Response;
      try {
        res = await fetchImpl(convertUrl, { method: "POST", headers, body, signal });
      } catch (e) {
        throw transportError(e, timeoutMs);
      }

      let pdf: Uint8Array<ArrayBuffer>;
      try {
        if (!res.ok) {
          const text = (await res.text()).trim().slice(0, ERROR_BODY_MAX);
          throw new PdfRenderError("http", `gotenberg responded ${res.status}`, { status: res.status, body: text });
        }
        pdf = new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        if (e instanceof PdfRenderError) throw e;
        throw transportError(e, timeoutMs);
      }
      assertCompletePdf(pdf, res.status);
      return pdf;
    },

    async health() {
      try {
        const res = await fetchImpl(healthUrl, {
          headers: { authorization },
          signal: AbortSignal.timeout(Math.min(timeoutMs, HEALTH_TIMEOUT_MS)),
        });
        const body: unknown = await res.json().catch(() => null);
        return { up: chromiumUp(body), status: res.status };
      } catch {
        return { up: false, status: null };
      }
    },
  };
}

function buildForm(html: string, files: readonly PdfAsset[]): FormData {
  const seen = new Set<string>();
  for (const f of files) {
    if (!ASSET_NAME.test(f.name) || f.name.toLowerCase() === "index.html") {
      throw new TypeError(`invalid asset name: ${JSON.stringify(f.name)}`);
    }
    if (seen.has(f.name)) throw new TypeError(`duplicate asset name: ${JSON.stringify(f.name)}`);
    seen.add(f.name);
  }
  const form = new FormData();
  // Blob เข้ารหัส string เป็น UTF-8 เสมอ — BOM ทำให้ Chromium อ่านเป็น UTF-8 แน่นอน ไม่เดาเอง/ไม่เชื่อ meta charset อื่น
  const utf8Html = html.startsWith("\uFEFF") ? html : `\uFEFF${html}`;
  form.append("files", new Blob([utf8Html], { type: "text/html; charset=utf-8" }), "index.html");
  // สำเนาลง ArrayBuffer ธรรมดา — Blob ไม่รับ view บน SharedArrayBuffer
  for (const f of files) form.append("files", new Blob([new Uint8Array(f.data)], { type: f.contentType }), f.name);
  for (const [name, value] of Object.entries(CONVERT_FIELDS)) form.append(name, value);
  return form;
}

function transportError(e: unknown, timeoutMs: number): PdfRenderError {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "TimeoutError" || name === "AbortError") {
    return new PdfRenderError("timeout", `gotenberg did not answer within ${timeoutMs} ms`, { cause: e });
  }
  const code = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  const reason = typeof code === "string" ? code : e instanceof Error ? e.message : String(e);
  return new PdfRenderError("unreachable", `gotenberg unreachable: ${reason}`, { cause: e });
}

/** ไฟล์นี้จะถูกเก็บถาวรแก้ไม่ได้ — ต้องขึ้นต้น `%PDF-` และมี `%%EOF` ใน 1024 byte สุดท้าย (ไม่ถูกตัดกลางทาง) */
function assertCompletePdf(pdf: Uint8Array, status: number): void {
  const bytes = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  if (bytes.toString("latin1", 0, 5) !== "%PDF-") {
    const body = new TextDecoder().decode(pdf.subarray(0, ERROR_BODY_MAX));
    throw new PdfRenderError("not-pdf", "gotenberg response is not a PDF", { status, body });
  }
  if (!bytes.toString("latin1", Math.max(0, bytes.length - 1024)).includes("%%EOF")) {
    throw new PdfRenderError("not-pdf", "gotenberg returned an incomplete PDF (no %%EOF)", { status });
  }
}

/** /health ตอบ 503 ได้ถ้าโมดูลอื่น (LibreOffice) ล่ม — ดูเฉพาะ Chromium ที่เราใช้ */
function chromiumUp(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const b = body as { status?: unknown; details?: { chromium?: { status?: unknown } } };
  const chromium = b.details?.chromium?.status;
  return chromium === undefined ? b.status === "up" : chromium === "up";
}
