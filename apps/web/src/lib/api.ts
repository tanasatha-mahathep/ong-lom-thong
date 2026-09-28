import { z } from "zod";

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

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      credentials: "same-origin",
    });
  } catch (e) {
    // ถูกยกเลิก (TanStack Query cancel / AbortController) — ส่งต่อตามเดิม ไม่ใช่ error ของระบบ
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "ติดต่อเซิร์ฟเวอร์ไม่ได้", undefined, null);
  }

  const data = await readBody(res);
  if (!res.ok) throw toApiError(res.status, res.statusText, data);
  return schema ? schema.parse(data) : data;
}

const THAI = /[\u0E00-\u0E7F]/;
const FALLBACK = "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
const STATUS_MESSAGE: Readonly<Record<number, string>> = {
  0: "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่",
  400: "ข้อมูลไม่ถูกต้อง",
  401: "หมดเวลาใช้งาน เข้าสู่ระบบใหม่อีกครั้ง",
  403: "ไม่มีสิทธิ์",
  404: "ไม่พบข้อมูล",
  409: "ข้อมูลขัดแย้งกับที่มีอยู่",
  413: "ไฟล์ใหญ่เกินไป",
  415: "รูปแบบข้อมูลไม่ถูกต้อง",
  429: "ลองใหม่อีกครั้งในอีกสักครู่",
};

/**
 * ข้อความภาษาไทยสำหรับแสดงผู้ใช้จาก error ใด ๆ — ที่เดียวของทั้งแอป
 * ข้อความจาก API แสดงตรง ๆ เฉพาะเมื่อเป็นภาษาไทย (เช่น "branch_id ไม่ถูกต้อง") · อังกฤษ/ไม่มีข้อความ = แปลตาม status
 */
export function errorMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return FALLBACK;
  if (e.status !== 0 && THAI.test(e.error)) return e.error;
  return STATUS_MESSAGE[e.status] ?? (e.status >= 500 ? "เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง" : FALLBACK);
}
