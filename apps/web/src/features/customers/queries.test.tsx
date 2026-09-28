import { QueryClient, QueryClientProvider, keepPreviousData, useQuery } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { json } from "@/test/app";
import { CUSTOMER_DETAIL, CUSTOMER_ID } from "@/test/customers";
import { EMPTY_CUSTOMER } from "./model";
import {
  customerDetailQuery,
  customerKeys,
  customerListQuery,
  customerPhotoQuery,
  useCreateCustomer,
  useUpdateCustomer,
} from "./queries";

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

type Route = (init: RequestInit | undefined) => Response;

/** fetch ปลอม — key = "METHOD path" · เก็บลำดับการเรียกไว้ตรวจ */
function stubApi(routes: Record<string, Route>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${path}`;
      calls.push(key);
      const route = routes[key];
      return Promise.resolve(route ? route(init) : json({ error: "not found" }, 404));
    }),
  );
  return calls;
}

describe("query key — /buy ใช้ร่วม ห้ามเปลี่ยนรูป", () => {
  it('["customers","list",{q,page}] · ["customers","detail",id]', () => {
    expect(customerKeys.list({ q: "ทดสอบ", page: 2 })).toEqual(["customers", "list", { q: "ทดสอบ", page: 2 }]);
    expect(customerKeys.detail("c1")).toEqual(["customers", "detail", "c1"]);
    expect(customerKeys.lists()).toEqual(["customers", "list"]);
  });

  it("คำค้นที่ต่างแค่ช่องว่าง/อักขระควบคุมใช้ cache เดียวกัน", () => {
    expect(customerListQuery({ q: " 0812\u0000 ", page: 1 }).queryKey).toEqual(
      customerListQuery({ q: "0812", page: 1 }).queryKey,
    );
  });
});

describe("ความสดของข้อมูล", () => {
  it("รายการไม่กระพริบเมื่อเปลี่ยนคำค้น", () => {
    const options = customerListQuery({ q: "", page: 1 });
    expect(options.placeholderData).toBe(keepPreviousData);
    expect(options.staleTime).toBe(30_000);
  });

  it("รายละเอียดสดเสมอ และดึงใหม่เมื่อกลับมาที่แท็บ (สถานะบัตรตัดสินการซื้อเข้า)", () => {
    expect(customerDetailQuery("c1")).toMatchObject({ staleTime: 0, refetchOnWindowFocus: true });
  });

  it("รูปผูก updated_at และไม่ค้างใน cache", () => {
    const options = customerPhotoQuery("c1", "2026-09-28T03:00:00.000Z");
    expect(options.queryKey).toEqual(["customers", "photo", "c1", "2026-09-28T03:00:00.000Z"]);
    expect(options).toMatchObject({ staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  });
});

describe("mutation", () => {
  it("เพิ่มลูกค้า → รายการเก่า + แจ้งแท็บอื่น", async () => {
    stubApi({ "POST /api/customers": () => json({ id: "c-new" }, 201) });
    const post = vi.spyOn(BroadcastChannel.prototype, "postMessage");
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateCustomer(), { wrapper });

    await act(() => result.current.mutateAsync(EMPTY_CUSTOMER));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["customers", "list"] });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "customer-saved", action: "created", id: "c-new" }),
    );
  });

  it("แก้ลูกค้า → GET ใหม่ก่อนจบ · cache มีเลขบัตรเต็มจาก GET ไม่ใช่เลขมาสก์จาก PUT", async () => {
    let name = CUSTOMER_DETAIL.name_th;
    const detailPath = `/api/customers/${CUSTOMER_ID}`;
    const calls = stubApi({
      [`GET ${detailPath}`]: () => json({ ...CUSTOMER_DETAIL, name_th: name }),
      [`PUT ${detailPath}`]: (init) => {
        const sent = (init?.body as FormData).get("name_th");
        name = typeof sent === "string" ? sent : "";
        return json({ ...CUSTOMER_DETAIL, name_th: name, national_id: "1 XXXX XXXXX 45 8" });
      },
    });
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(
      () => ({ detail: useQuery(customerDetailQuery(CUSTOMER_ID)), update: useUpdateCustomer(CUSTOMER_ID) }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));

    await act(() =>
      result.current.update.mutateAsync({ ...EMPTY_CUSTOMER, national_id: "1103700123458", name_th: "นายแก้ไข แล้ว" }),
    );

    expect(calls).toEqual([`GET ${detailPath}`, `PUT ${detailPath}`, `GET ${detailPath}`]);
    expect(queryClient.getQueryData(customerKeys.detail(CUSTOMER_ID))).toMatchObject({
      national_id: "1103700123458",
      name_th: "นายแก้ไข แล้ว",
    });
  });
});
