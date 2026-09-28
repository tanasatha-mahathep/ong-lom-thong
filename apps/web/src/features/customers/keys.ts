/** พารามิเตอร์ของ GET /api/customers */
export interface CustomerListParams {
  q: string;
  page: number;
}

/**
 * query key ของลูกค้า — หน้า /buy ใช้ key ชุดเดียวกัน (ห้ามเปลี่ยนรูป):
 * `["customers", "list", {q, page}]` · `["customers", "detail", id]`
 * ไม่ใส่สาขาใน key: ลูกค้าใช้ร่วมทั้งร้าน และสลับสาขาแล้ว invalidate ทุก query อยู่แล้ว
 */
export const customerKeys = {
  all: ["customers"] as const,
  lists: () => [...customerKeys.all, "list"] as const,
  list: (params: CustomerListParams) => [...customerKeys.lists(), params] as const,
  details: () => [...customerKeys.all, "detail"] as const,
  detail: (id: string) => [...customerKeys.details(), id] as const,
  /** รูปผูกกับ updated_at — บันทึกใหม่แล้ว key เปลี่ยน ดึงรูปใหม่เอง */
  photo: (id: string, version: string) => [...customerKeys.all, "photo", id, version] as const,
};
