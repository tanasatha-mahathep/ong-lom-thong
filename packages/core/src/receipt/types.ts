/**
 * ข้อมูลใบรับซื้อของเก่า/ใบสำคัญจ่าย — ใช้ทั้ง <Receipt/> บนจอ (/buy/$id) และ PDF เก็บถาวร (renderReceiptHtml)
 * เงิน/น้ำหนักเป็น string ตามที่ API/DB ส่ง (numeric) · ตัวเลขที่ derive ทำผ่าน helper ของ @ong/core เท่านั้น
 */
export interface ReceiptData {
  company: { name: string; address: string; tel: string; fax: string | null; taxId: string };
  /**
   * taxBranchCode 5 หลักของสรรพากร: "00000" = สำนักงานใหญ่ · ห้ามใส่รหัสภายใน/รหัสชั่วคราวแทน
   * PDF (renderReceiptHtml): null = ReceiptDataError (fail-closed) · หน้าเว็บ: null = ไม่พิมพ์ป้ายสาขา
   */
  branch: { name: string; taxBranchCode: string | null };
  docNo: string;
  /** ISO ค.ศ. "YYYY-MM-DD" — พิมพ์เป็น พ.ศ. */
  date: string;
  /** "HH:MM" — เก็บไว้ในสัญญา แต่ใบจริงไม่พิมพ์เวลา จึงไม่แสดง */
  time: string;
  /**
   * nationalId พิมพ์ตามที่ส่งมา — R13: เลขเต็มเฉพาะ PDF (renderReceiptHtml ฝั่ง API)
   * หน้าเว็บ (<Receipt/> ใน browser) ต้องส่งเลขที่มาสก์แล้ว (national_id_masked ของ GET /buy/{id}) ห้ามส่งเลขเต็มเข้า browser
   */
  customer: { nameTh: string; address: string | null; nationalId: string };
  /** แถวตามที่บันทึก — ใบพิมพ์รวมเป็น 1 บรรทัดต่อโลหะ (groupLinesByMetal) */
  lines: { metalName: string; weightG: string; amount: string }[];
  detail: string | null;
  totalAmount: string;
  payments: { label: string; bank: string | null; amount: string }[];
  status: "active" | "void";
  voidReason?: string | null;
  /** ลายน้ำแนวทแยงทับทั้งใบ — ระบบทดสอบ (staging) ใส่ "ไม่ใช่ใบรับซื้อจริง" · production ไม่ส่ง */
  watermark?: string | null;
}

/** สำเนาบัตรประชาชน — แยกไฟล์จากใบรับซื้อ สิทธิ์เข้าถึงแคบกว่า (PDPA) */
export interface IdCardCopyData {
  docNo: string;
  /** ISO ค.ศ. "YYYY-MM-DD" ของบิล */
  date: string;
  companyName: string;
  /** URL หรือ data: URI ของรูปบัตร — ส่งให้ Gotenberg เป็น form file แล้วอ้างชื่อไฟล์แบบ relative ได้ */
  photoSrc: string;
  /** ลายน้ำแนวทแยงแบบเดียวกับ ReceiptData.watermark */
  watermark?: string | null;
}

export interface RenderHtmlOptions {
  /**
   * ฐาน URL ของ Sarabun-Regular.ttf / Sarabun-Bold.ttf · ค่าเริ่มต้น "/fonts" (apps/web/public/fonts)
   * "" = อ้างชื่อไฟล์แบบ relative — ใช้กับ Gotenberg ที่ส่ง .ttf ไปเป็น form file คู่กับ index.html
   */
  fontBaseUrl?: string;
}
