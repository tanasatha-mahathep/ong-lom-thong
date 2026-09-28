import type { CustomerDetail, CustomerListItem } from "@/features/customers/model";

/**
 * ลูกค้าสมมติสำหรับเทสต์ — เลขบัตร checksum ถูกชุดเดียวกับเทสต์ของ api (ไม่ใช่คนจริง · CLAUDE.md กฎ 8)
 * 1103700123458 · 3100500987657 · 5109900112237
 */
export const CUSTOMER_ID = "0b8a3c52-5f7e-4a36-9a51-3f4b7a8c9d10";
export const OTHER_CUSTOMER_ID = "7d1e9f40-2c3b-4e8a-b6d5-1a2b3c4d5e6f";

export const CUSTOMER_DETAIL: CustomerDetail = {
  id: CUSTOMER_ID,
  national_id: "1103700123458",
  name_th: "นายทดสอบ ระบบ",
  name_en: "Mr. Test System",
  birthday_text: "1 มกราคม 2530",
  religion: "พุทธ",
  address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
  card_issue_text: "01/01/2565",
  card_expire_text: "31/12/2600",
  card_expire_date: "2057-12-31",
  card_status: "ok",
  mobile: "0812345678",
  phone2: "021234567",
  has_photo: false,
  created_at: "2026-09-28T03:00:00.000Z",
  updated_at: "2026-09-28T03:00:00.000Z",
};

export const CUSTOMER_ROW: CustomerListItem = {
  id: CUSTOMER_ID,
  national_id_masked: "1 XXXX XXXXX 45 8",
  name_th: "นายทดสอบ ระบบ",
  mobile: "0812345678",
  address: "1 ถ.ทดสอบ ต.ในเมือง อ.เมือง จ.ขอนแก่น",
  card_status: "ok",
};

export const EXPIRED_ROW: CustomerListItem = {
  id: OTHER_CUSTOMER_ID,
  national_id_masked: "3 XXXX XXXXX 65 7",
  name_th: "นางสาวตัวอย่าง ใจดี",
  mobile: null,
  address: null,
  card_status: "expired",
};

/** รูป PNG 1×1 จุด */
export const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

export const pngFile = (name = "image.png") => new File([PNG_1X1], name, { type: "image/png" });
