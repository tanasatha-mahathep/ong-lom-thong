/**
 * "พิมพ์อัตโนมัติหลังบันทึก" (spec §3.1 ตั้งได้) — ค่าของเครื่องนี้ (localStorage) ค่าเริ่มต้นเปิด
 * อ่าน/เขียนไม่ได้ (โหมดส่วนตัว · ถูกปิด storage) = ใช้ค่าเริ่มต้น ไม่ทำให้หน้าพัง
 */
const KEY = "ong.autoPrintAfterSave";

export function autoPrintEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoPrint(enabled: boolean): void {
  try {
    window.localStorage.setItem(KEY, enabled ? "on" : "off");
  } catch {
    // เก็บไม่ได้ = ใช้ได้เฉพาะรอบนี้
  }
}
