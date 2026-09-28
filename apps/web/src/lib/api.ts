import { z } from "zod";
import i18next from "@/i18n";
import type { resources } from "@/i18n/resources";

/** เงิน/น้ำหนักจาก API เป็นข้อความทศนิยมเสมอ (CLAUDE.md กฎ 1) — ตรวจรูปแต่ไม่แปลงเป็น number */
export const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "ต้องเป็นข้อความตัวเลขทศนิยม");

/**
 * error จาก API — รูป `{error, field?}` ของเรา (spec §5) หรือ `{code, message}` ของ better-auth
 * status 0 = ติดต่อเซิร์ฟเวอร์ไม่ได้ (network)
 */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly status: number,
    readonly error: string,
    readonly field: string | undefined,
    readonly body: unknown,
  ) {
    super(error);
  }

  /** code ของ better-auth เช่น INVALID_EMAIL_OR_PASSWORD (ไม่มี = undefined) */
  get code(): string | undefined {
    return isRecord(this.body) && typeof this.body.code === "string" ? this.body.code : undefined;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body" | "credentials"> {
  /** ส่งเป็น JSON (ตั้ง Content-Type ให้) */
  json?: unknown;
  /** ส่งเป็น multipart — browser ใส่ boundary เอง */
  form?: FormData;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  if (!res.headers.get("content-type")?.includes("json")) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toApiError(status: number, statusText: string, body: unknown): ApiError {
  if (isRecord(body)) {
    const field = typeof body.field === "string" ? body.field : undefined;
    if (typeof body.error === "string") return new ApiError(status, body.error, field, body);
    if (typeof body.message === "string") return new ApiError(status, body.message, field, body);
  }
  return new ApiError(status, statusText || `HTTP ${status}`, undefined, body);
}

type ApiPath = `/api/${string}`;

/** fetch origin เดียวกันพร้อม cookie — ติดต่อไม่ได้ = ApiError status 0 */
async function send(path: ApiPath, init: Omit<RequestInit, "credentials">): Promise<Response> {
  try {
    return await fetch(path, { ...init, credentials: "same-origin" });
  } catch (e) {
    // ถูกยกเลิก (TanStack Query cancel / AbortController) — ส่งต่อตามเดิม ไม่ใช่ error ของระบบ
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "ติดต่อเซิร์ฟเวอร์ไม่ได้", undefined, null);
  }
}

/**
 * fetch ไปที่ `/api/...` origin เดียวกับหน้าเว็บ — cookie session ของ better-auth ไปเอง (same-origin)
 * สำเร็จ = body ที่ผ่าน `schema` (zod) · ไม่ส่ง schema = `unknown` ให้ผู้เรียก narrow เอง (ไม่มี cast ลอย ๆ)
 * ไม่สำเร็จ = throw ApiError
 */
export function apiFetch<T>(path: ApiPath, options: ApiFetchOptions & { schema: z.ZodType<T> }): Promise<T>;
export function apiFetch(path: ApiPath, options?: ApiFetchOptions): Promise<unknown>;
export async function apiFetch<T>(
  path: ApiPath,
  options: ApiFetchOptions & { schema?: z.ZodType<T> } = {},
): Promise<unknown> {
  const { json, form, schema, headers: initHeaders, method, ...init } = options;
  const headers = new Headers(initHeaders);
  headers.set("Accept", "application/json");
  let body: BodyInit | undefined;
  if (json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  const res = await send(path, { ...init, method: method ?? (body === undefined ? "GET" : "POST"), headers, body });
  const data = await readBody(res);
  if (!res.ok) throw toApiError(res.status, res.statusText, data);
  return schema ? schema.parse(data) : data;
}

/**
 * ไฟล์ส่วนตัวจาก api (รูปลูกค้า ฯลฯ) เป็น Blob — ไฟล์ไม่มี public URL (R13) จึงอ่านผ่าน cookie session
 * ไม่ใช้ HTTP cache ของ browser (ข้อมูลส่วนบุคคล) · error เป็น ApiError รูปเดียวกับ apiFetch
 */
export async function apiBlob(path: ApiPath, { signal }: { signal?: AbortSignal } = {}): Promise<Blob> {
  const res = await send(path, { signal, cache: "no-store" });
  if (!res.ok) throw toApiError(res.status, res.statusText, await readBody(res));
  return res.blob();
}

const THAI = /[\u0E00-\u0E7F]/;

/** status → key ใน common.errors */
const STATUS_ERROR = {
  0: "network",
  400: "badRequest",
  401: "unauthorized",
  403: "forbidden",
  404: "notFound",
  409: "conflict",
  413: "tooLarge",
  415: "unsupported",
  429: "rateLimited",
} as const satisfies Record<number, keyof (typeof resources)["th"]["common"]["errors"]>;

/**
 * ข้อความสำหรับแสดงผู้ใช้จาก error ใด ๆ — ที่เดียวของทั้งแอป (ข้อความอยู่ใน common.errors)
 * ข้อความจาก API แสดงตรง ๆ เฉพาะเมื่อเป็นภาษาไทย (API ส่งข้อความไทยของช่อง/กฎธุรกิจ) · อื่น ๆ แปลตาม status
 * ภาษาอังกฤษภายหลัง: ข้อความไทยจาก API ต้อง map ด้วย `field` + status เป็นคำแปล — ยังไม่ได้ทำ
 */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return i18next.t("errors.fallback", { ns: "common" });
  if (e.status !== 0 && THAI.test(e.error)) return e.error;
  const key: keyof (typeof resources)["th"]["common"]["errors"] =
    e.status in STATUS_ERROR
      ? STATUS_ERROR[e.status as keyof typeof STATUS_ERROR]
      : e.status >= 500
        ? "server"
        : "fallback";
  return i18next.t(`errors.${key}`, { ns: "common" });
}
