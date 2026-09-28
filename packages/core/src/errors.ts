/**
 * ข้อมูลของเอกสารผิดจนพิมพ์ไม่ได้ — ยอดไม่ตรง · วันที่ผิดรูป · ไม่มี/ผิดรหัสสาขา · ไม่มีรูปบัตร · ตัวเลขเสียหรือเกินช่วง
 * ลองใหม่กี่ครั้งก็ได้ผลเดิม: งาน PDF จับ class นี้แล้วบันทึกเป็นความล้มเหลวถาวร (ต้องแก้ข้อมูล) ไม่ต้อง retry
 * error อื่น (Gotenberg ล่ม · เครือข่าย · bucket · ตั้งค่าผิด) เป็นความล้มเหลวชั่วคราว retry ได้
 */
export class ReceiptDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptDataError";
  }
}
