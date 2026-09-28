import { describe, expect, it } from "vitest";
import {
  CustomerDetailSchema,
  type CustomerFormValues,
  EMPTY_CUSTOMER,
  formatNationalId,
  normalizeQuery,
  toCustomerFormData,
  toFormValues,
} from "./model";

// เลขบัตรสมมติที่ checksum ถูก (ชุดเดียวกับเทสต์ของ api) — ห้ามใช้ข้อมูลจริง
const DETAIL = {
  id: "0b8a3c52-5f7e-4a36-9a51-3f4b7a8c9d10",
  national_id: "1103700123458",
  name_th: "นายทดสอบ ระบบ",
  name_en: null,
  birthday_text: "1 มกราคม 2530",
  religion: null,
  address: "1 ถ.ทดสอบ",
  card_issue_text: "01/01/2565",
  card_expire_text: "31/12/2600",
  card_expire_date: "2057-12-31",
  card_status: "ok",
  mobile: "0812345678",
  phone2: null,
  has_photo: false,
  created_at: "2026-09-28T08:00:00.000Z",
  updated_at: "2026-09-28T08:00:00.000Z",
} as const;

const SIAM_ID_KEYS = [
  "national_id",
  "name_th",
  "name_en",
  "birthday_text",
  "religion",
  "address",
  "card_issue_text",
  "card_expire_text",
  "photo",
  "mobile",
  "phone2",
];

const filled: CustomerFormValues = {
  national_id: " 1-1037-00123-45-8 ",
  name_th: "  นายทดสอบ ระบบ",
  name_en: "Mr. Test System",
  birthday_text: "1 มกราคม 2530",
  religion: "พุทธ",
  address: "1 ถ.ทดสอบ\nต.ในเมือง",
  card_issue_text: "01/01/2565",
  card_expire_text: "31/12/2600",
  photo: new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
  mobile: "0812345678",
  phone2: "",
};

describe("toCustomerFormData — body ของ POST/PUT", () => {
  it("เรียงตามลำดับ Siam ID โดยรูปอยู่ลำดับที่ 9", () => {
    const form = toCustomerFormData(filled);
    expect([...form.keys()]).toEqual(SIAM_ID_KEYS);
    const photo = form.get("photo");
    expect(photo).toBeInstanceOf(File);
    expect(photo).toMatchObject({ name: "image.png", type: "image/png", size: 3 });
  });

  it('ค่าดิบตามที่พิมพ์ — ไม่ trim ไม่แปลง · ช่องว่างส่ง "" (PUT แทนทั้งแถว)', () => {
    const form = toCustomerFormData(filled);
    expect(form.get("national_id")).toBe(" 1-1037-00123-45-8 ");
    expect(form.get("name_th")).toBe("  นายทดสอบ ระบบ");
    expect(form.get("address")).toBe("1 ถ.ทดสอบ\nต.ในเมือง");
    expect(form.get("phone2")).toBe("");
  });

  it("ไม่เลือกรูปใหม่ = ไม่ส่ง photo (API ใช้รูปเดิม) · ครบ 10 ช่องข้อความ", () => {
    const form = toCustomerFormData(EMPTY_CUSTOMER);
    expect([...form.keys()]).toEqual(SIAM_ID_KEYS.filter((k) => k !== "photo"));
    expect([...form.values()].every((v) => v === "")).toBe(true);
  });
});

describe("toFormValues — ค่าเริ่มต้นของฟอร์มแก้ไข", () => {
  it("null เป็นช่องว่าง · ไม่มีรูปใหม่", () => {
    const detail = CustomerDetailSchema.parse(DETAIL);
    expect(toFormValues(detail)).toEqual({
      national_id: "1103700123458",
      name_th: "นายทดสอบ ระบบ",
      name_en: "",
      birthday_text: "1 มกราคม 2530",
      religion: "",
      address: "1 ถ.ทดสอบ",
      card_issue_text: "01/01/2565",
      card_expire_text: "31/12/2600",
      photo: null,
      mobile: "0812345678",
      phone2: "",
    });
  });
});

describe("CustomerDetailSchema", () => {
  it("ไม่รับสถานะบัตรนอกรายการ", () => {
    expect(CustomerDetailSchema.safeParse({ ...DETAIL, card_status: "blocked" }).success).toBe(false);
  });
});

describe("formatNationalId — เลขเต็มเฉพาะหน้าลูกค้าเดี่ยว", () => {
  it("จัดกลุ่ม 1-4-5-2-1 แบบหน้าบัตร", () => {
    expect(formatNationalId("1103700123458")).toBe("1 1037 00123 45 8");
    expect(formatNationalId("1-1037-00123-45-8")).toBe("1 1037 00123 45 8");
  });

  it("ไม่ครบ 13 หลักแสดงตามเดิม", () => {
    expect(formatNationalId("12345")).toBe("12345");
  });
});

describe("normalizeQuery — คำค้นที่ API รับ", () => {
  it("ตัดอักขระควบคุม (API ตอบ 400) และช่องว่างหัวท้าย", () => {
    expect(normalizeQuery("  สม\u0000ชาย\t ")).toBe("สมชาย");
    expect(normalizeQuery("08\u001b12\u007f")).toBe("0812");
  });

  it("ยาวเกิน 100 ตัวอักษรตัดทิ้ง", () => {
    expect(normalizeQuery("ก".repeat(150))).toHaveLength(100);
  });
});
