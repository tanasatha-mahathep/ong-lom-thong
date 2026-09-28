import { keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { createCustomer, fetchCustomerPhoto, getCustomer, listCustomers, updateCustomer } from "./api";
import { type CustomerListParams, customerKeys } from "./keys";
import { type CustomerFormValues, normalizeQuery } from "./model";
import { postCustomerSaved } from "./sync";

export { customerKeys, type CustomerListParams };

/** รายการ/ผลค้น — คำค้นถูกทำให้ส่งได้ก่อนเป็น key (ค่าเดียวกันใช้ cache เดียวกัน) */
export function customerListQuery(params: CustomerListParams) {
  const normalized: CustomerListParams = { q: normalizeQuery(params.q), page: params.page };
  return queryOptions({
    queryKey: customerKeys.list(normalized),
    queryFn: ({ signal }) => listCustomers(normalized, signal),
    // เปลี่ยนคำค้น/หน้าแล้วตารางไม่กระพริบเป็นว่าง
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * ลูกค้ารายเดียว — สดเสมอ: กลับมาที่แท็บ (เช่น /buy หลังแก้บัตรในแท็บอื่น) ดึงใหม่ทันที
 * ตั้งตรง ๆ ไม่พึ่งค่ากลาง เพราะสถานะบัตรตัดสินว่าซื้อเข้าได้หรือไม่
 */
export function customerDetailQuery(id: string) {
  return queryOptions({
    queryKey: customerKeys.detail(id),
    queryFn: ({ signal }) => getCustomer(id, signal),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * รูปลูกค้า (ใช้คู่ `enabled: detail.has_photo`) — key ผูก updated_at จึงไม่ต้องดึงซ้ำ
 * gcTime 0: เลิกแสดงแล้วทิ้งรูป (ข้อมูลส่วนบุคคล) ไม่ค้างใน cache
 */
export function customerPhotoQuery(id: string, updatedAt: string) {
  return queryOptions({
    queryKey: customerKeys.photo(id, updatedAt),
    queryFn: ({ signal }) => fetchCustomerPhoto(id, signal),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** เพิ่มลูกค้า → รายการเก่า + แจ้งแท็บอื่น (/buy) */
export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CustomerFormValues) => createCustomer(values),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      postCustomerSaved({ action: "created", id });
    },
  });
}

/**
 * แก้ลูกค้า → ดึงรายละเอียดใหม่ก่อนจบ (คำตอบของ PUT มีเลขบัตรแบบมาสก์ ใส่ cache ไม่ได้)
 * mutateAsync resolve หลัง GET ใหม่เสร็จ — หน้าดูจึงแสดงค่าใหม่พร้อมเลขบัตรเต็มทันที
 */
export function useUpdateCustomer(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CustomerFormValues) => updateCustomer(id, values),
    onSuccess: async () => {
      postCustomerSaved({ action: "updated", id });
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      await queryClient.invalidateQueries({ queryKey: customerKeys.detail(id) });
    },
  });
}
