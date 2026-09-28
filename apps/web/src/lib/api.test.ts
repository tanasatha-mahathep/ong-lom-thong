import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiBlob, apiFetch, errorMessage } from "./api";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(response: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    typeof response === "function" ? response() : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(error instanceof ApiError)) throw new Error(`expected ApiError, got ${String(error)}`);
  return error;
}

describe("apiFetch — คำขอ", () => {
  it("GET ไปที่ path เดิม origin เดียวกัน พร้อม cookie (same-origin)", async () => {
    const fetchMock = stubFetch(json({ ok: true }));
    await expect(apiFetch("/api/healthz")).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/healthz");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
  });

  it("json = POST พร้อม Content-Type · เงินส่งเป็นข้อความตามเดิม", async () => {
    const fetchMock = stubFetch(json({ bar_buy: "67650.00" }));
    await apiFetch("/api/gold-price/quote", { json: { bar_sell: "67850.00" } });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    expect(init?.body).toBe('{"bar_sell":"67850.00"}');
  });

  it("FormData ส่งตรง ๆ ให้ browser ใส่ boundary เอง", async () => {
    const fetchMock = stubFetch(json({ id: "c1" }, 201));
    const form = new FormData();
    form.set("name_th", "ทดสอบ");
    await apiFetch("/api/customers", { form });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.body).toBe(form);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("ตรวจรูปคำตอบด้วย schema ถ้าให้มา", async () => {
    stubFetch(json({ bar_sell: 67850 }));
    const schema = z.object({ bar_sell: z.string() });
    await expect(apiFetch("/api/gold-price/today", { schema })).rejects.toBeInstanceOf(z.ZodError);
  });

  it("204 ไม่มี body = undefined", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(apiFetch("/api/auth/sign-out", { method: "POST" })).resolves.toBeUndefined();
  });
});

describe("apiFetch — error เป็น ApiError เสมอ", () => {
  it("รูป {error, field} ของ API", async () => {
    stubFetch(json({ error: "branch_id ไม่ถูกต้อง", field: "branch_id" }, 400));
    const e = await caught(apiFetch("/api/me/branch", { json: { branch_id: "x" } }));
    expect(e).toMatchObject({ status: 400, error: "branch_id ไม่ถูกต้อง", field: "branch_id" });
    expect(e.body).toEqual({ error: "branch_id ไม่ถูกต้อง", field: "branch_id" });
    expect(errorMessage(e)).toBe("branch_id ไม่ถูกต้อง");
  });

  it("รูป {code, message} ของ better-auth", async () => {
    stubFetch(json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, 401));
    const e = await caught(apiFetch("/api/auth/sign-in/email", { json: {} }));
    expect(e).toMatchObject({ status: 401, error: "Invalid email or password", field: undefined });
    expect(e.code).toBe("INVALID_EMAIL_OR_PASSWORD");
  });

  it("body ไม่ใช่ JSON (เช่น proxy ตอบ 502) ใช้ status text", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    const e = await caught(apiFetch("/api/me"));
    expect(e).toMatchObject({ status: 502, error: "Bad Gateway", body: "<html>bad gateway</html>" });
  });

  it("ติดต่อเซิร์ฟเวอร์ไม่ได้ = status 0", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const e = await caught(apiFetch("/api/me"));
    expect(e).toMatchObject({ status: 0, error: "ติดต่อเซิร์ฟเวอร์ไม่ได้" });
  });

  it("การยกเลิก (AbortError) ส่งต่อตามเดิม ไม่แปลงเป็น ApiError", async () => {
    stubFetch(() => Promise.reject(new DOMException("aborted", "AbortError")));
    await expect(apiFetch("/api/me")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("error ที่ไม่ใช่ ApiError ได้ข้อความกลาง", () => {
    expect(errorMessage(new Error("boom"))).toBe("เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
  });
});

describe("errorMessage — จอภาษาไทยไม่แสดงข้อความอังกฤษจาก API", () => {
  it.each([
    [400, "branch_id ไม่ถูกต้อง", "branch_id ไม่ถูกต้อง"],
    [404, "ยังไม่ได้ตั้งราคาทองของวันนี้", "ยังไม่ได้ตั้งราคาทองของวันนี้"],
    [400, "invalid query", "ข้อมูลไม่ถูกต้อง"],
    [401, "unauthorized", "หมดเวลาใช้งาน เข้าสู่ระบบใหม่อีกครั้ง"],
    [403, "forbidden", "ไม่มีสิทธิ์"],
    [404, "not found", "ไม่พบข้อมูล"],
    [409, "Conflict", "ข้อมูลขัดแย้งกับที่มีอยู่"],
    [413, "Payload Too Large", "ไฟล์ใหญ่เกินไป"],
    [429, "Too many requests. Please try again later.", "ลองใหม่อีกครั้งในอีกสักครู่"],
    [500, "internal error", "เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง"],
    [502, "Bad Gateway", "เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง"],
    [0, "ติดต่อเซิร์ฟเวอร์ไม่ได้", "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่"],
    [418, "I'm a teapot", "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง"],
  ])("%i %j → %j", (status, error, expected) => {
    expect(errorMessage(new ApiError(status, error, undefined, { error }))).toBe(expected);
  });
});

describe("apiBlob — ไฟล์ส่วนตัวผ่าน cookie session", () => {
  it("ได้ Blob · origin เดียวกันพร้อม cookie · ไม่ใช้ HTTP cache", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = stubFetch(new Response(png, { status: 200, headers: { "Content-Type": "image/png" } }));
    const blob = await apiBlob("/api/customers/c1/photo");
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(png);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/customers/c1/photo");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.cache).toBe("no-store");
  });

  it("error เป็น ApiError รูปเดียวกับ apiFetch", async () => {
    stubFetch(json({ error: "not found" }, 404));
    expect(await caught(apiBlob("/api/customers/c1/photo"))).toMatchObject({ status: 404, error: "not found" });

    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await caught(apiBlob("/api/customers/c1/photo"))).toMatchObject({ status: 0 });
  });
});
