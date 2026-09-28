import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { json } from "@/test/app";
import { CUSTOMER_DETAIL, CUSTOMER_ID } from "@/test/customers";
import { createCustomer, fetchCustomerPhoto, getCustomer, listCustomers, updateCustomer } from "./api";
import { EMPTY_CUSTOMER } from "./model";

function stubFetch(response: () => Response) {
  // apiFetch/apiBlob เรียก fetch ด้วย path ที่เป็นข้อความเสมอ
  const fetchMock = vi.fn((_input: string, _init?: RequestInit) => Promise.resolve(response()));
  vi.stubGlobal("fetch", fetchMock);
  const call = (i = 0) => {
    const [input, init] = fetchMock.mock.calls[i] ?? [];
    return { url: input ?? "", method: init?.method, body: init?.body };
  };
  return { fetchMock, call };
}

describe("listCustomers — GET /api/customers", () => {
  it("คำค้นว่าง หน้า 1 = ไม่มี query string", async () => {
    const { call } = stubFetch(() => json({ items: [], page: 1, has_more: false }));
    await expect(listCustomers({ q: "", page: 1 })).resolves.toEqual({ items: [], page: 1, has_more: false });
    expect(call().url).toBe("/api/customers");
  });

  it("คำค้นถูกตัดอักขระควบคุม/ช่องว่างก่อนส่ง · หน้าอื่นส่ง page", async () => {
    const { call } = stubFetch(() => json({ items: [], page: 3, has_more: false }));
    await listCustomers({ q: " สม\u0000ชาย ", page: 3 });
    const url = new URL(call().url, "http://localhost");
    expect(url.pathname).toBe("/api/customers");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "สมชาย", page: "3" });
  });

  it("คำตอบผิดรูปไม่หลุดไปถึงจอ", async () => {
    stubFetch(() => json({ items: [{ id: "x" }], page: 1, has_more: false }));
    await expect(listCustomers({ q: "", page: 1 })).rejects.toThrow();
  });
});

describe("getCustomer — GET /api/customers/:id", () => {
  it("ได้รายละเอียดพร้อมเลขบัตรเต็ม", async () => {
    const { call } = stubFetch(() => json(CUSTOMER_DETAIL));
    await expect(getCustomer(CUSTOMER_ID)).resolves.toEqual(CUSTOMER_DETAIL);
    expect(call().url).toBe(`/api/customers/${CUSTOMER_ID}`);
  });

  it("id ถูก encode (ไม่หลุดไป path อื่น)", async () => {
    const { call } = stubFetch(() => json({ error: "not found" }, 404));
    await expect(getCustomer("../me")).rejects.toBeInstanceOf(ApiError);
    expect(call().url).toBe("/api/customers/..%2Fme");
  });
});

describe("createCustomer / updateCustomer — multipart", () => {
  const values = { ...EMPTY_CUSTOMER, national_id: "1103700123458", name_th: "นายทดสอบ ระบบ" };

  it("POST ฟอร์มตามลำดับ Siam ID → id ใหม่", async () => {
    const { call } = stubFetch(() => json({ id: "c-new" }, 201));
    await expect(createCustomer(values)).resolves.toEqual({ id: "c-new" });
    const { url, method, body } = call();
    expect([url, method]).toEqual(["/api/customers", "POST"]);
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get("national_id")).toBe("1103700123458");
  });

  it("PUT แทนทั้งแถว · ไม่ใช้คำตอบ (เลขบัตรในคำตอบเป็นแบบมาสก์)", async () => {
    const { call } = stubFetch(() => json({ ...CUSTOMER_DETAIL, national_id: "1 XXXX XXXXX 45 8" }));
    await expect(updateCustomer(CUSTOMER_ID, values)).resolves.toBeUndefined();
    const { url, method, body } = call();
    expect([url, method]).toEqual([`/api/customers/${CUSTOMER_ID}`, "PUT"]);
    expect([...(body as FormData).keys()]).toHaveLength(10);
  });

  it("409 เลขบัตรซ้ำเป็น ApiError พร้อม existing_id ใน body", async () => {
    stubFetch(() => json({ error: "มีลูกค้าเลขบัตรนี้อยู่แล้ว", field: "national_id", existing_id: "c-old" }, 409));
    await expect(createCustomer(values)).rejects.toMatchObject({
      status: 409,
      field: "national_id",
      body: { existing_id: "c-old" },
    });
  });
});

describe("fetchCustomerPhoto — GET /api/customers/:id/photo", () => {
  it("ได้รูปเป็น Blob ไม่ผ่าน HTTP cache", async () => {
    const { fetchMock, call } = stubFetch(
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } }),
    );
    const blob = await fetchCustomerPhoto(CUSTOMER_ID);
    expect(blob).toMatchObject({ type: "image/jpeg", size: 3 });
    expect(call().url).toBe(`/api/customers/${CUSTOMER_ID}/photo`);
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe("no-store");
  });
});
