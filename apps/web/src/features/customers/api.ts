import { z } from "zod";
import { apiBlob, apiFetch } from "@/lib/api";
import type { CustomerListParams } from "./keys";
import {
  CustomerDetailSchema,
  type CustomerFormValues,
  CustomerListSchema,
  normalizeQuery,
  toCustomerFormData,
} from "./model";

/** endpoint ของลูกค้า (apps/api/src/routes/customers.ts) — ต้องมีสิทธิ์อย่างน้อยหนึ่งสาขา ทุก role */
const customerPath = (id: string) => `/api/customers/${encodeURIComponent(id)}` as const;

/** POST ตอบ `{id}` · PUT ตอบรายละเอียดที่เลขบัตรมาสก์ — ตรวจแค่ว่าได้ลูกค้ากลับมา ไม่ใช้ค่าอื่น */
const SavedSchema = z.object({ id: z.string() });

/** ค้น (ชื่อไทย/อังกฤษ · เลขบัตร · เบอร์) — คำค้นว่าง = ล่าสุดก่อน · หน้าละ 20 */
export function listCustomers({ q, page }: CustomerListParams, signal?: AbortSignal) {
  const params = new URLSearchParams();
  const term = normalizeQuery(q);
  if (term) params.set("q", term);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return apiFetch(`/api/customers${query ? `?${query}` : ""}`, { signal, schema: CustomerListSchema });
}

/** ลูกค้ารายเดียว — ที่เดียวที่ได้เลขบัตรเต็ม (R13) */
export function getCustomer(id: string, signal?: AbortSignal) {
  return apiFetch(customerPath(id), { signal, schema: CustomerDetailSchema });
}

/** เพิ่มลูกค้า (multipart) → id ใหม่ · เลขบัตรซ้ำ = 409 พร้อม existing_id */
export function createCustomer(values: CustomerFormValues) {
  return apiFetch("/api/customers", { method: "POST", form: toCustomerFormData(values), schema: SavedSchema });
}

/**
 * แก้ลูกค้า (multipart · แทนทั้งแถว) — คำตอบมีเลขบัตรแบบมาสก์ จึงไม่ใช้
 * ผู้เรียกต้อง GET ใหม่ (useUpdateCustomer invalidate ให้แล้ว)
 */
export async function updateCustomer(id: string, values: CustomerFormValues): Promise<void> {
  await apiFetch(customerPath(id), { method: "PUT", form: toCustomerFormData(values), schema: SavedSchema });
}

/** รูปลูกค้า (มีเมื่อ `has_photo`) — ผ่าน api เท่านั้น ไม่ cache */
export function fetchCustomerPhoto(id: string, signal?: AbortSignal) {
  return apiBlob(`${customerPath(id)}/photo`, { signal });
}
