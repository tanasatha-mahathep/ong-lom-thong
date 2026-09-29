/**
 * นำทาง browser ไปที่ URL จริง (ไม่ใช่ SPA route) — ใช้กับไฟล์ที่ดาวน์โหลดผ่าน `Content-Disposition: attachment`
 * (เช่น zip ส่งบัญชีรายเดือน) เพื่อให้ browser จัดการ stream ลงดิสก์เอง — **ห้าม `fetch()` ไฟล์ใหญ่เข้าหน่วยความจำ**
 * เทสต์แทนได้ (jsdom ห้ามแก้ `location.assign` ตรง ๆ) — ดู lib/app-update.ts สำหรับรูปแบบเดียวกัน
 */
/** รอให้ browser เริ่มบันทึกไฟล์ก่อนปล่อย object URL */
export const REVOKE_DELAY_MS = 10_000;

export const navigation = {
  downloadAt: (url: string) => window.location.assign(url),
  /** ไฟล์ที่ขอผ่าน fetch (ต้องรู้ผลสำเร็จ/ล้มเหลวเพื่อแจ้งผู้ใช้ — CSV ขนาดเล็ก) → บันทึกลงเครื่องด้วยชื่อที่กำหนด */
  saveBlob: (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
    } finally {
      // Safari/Firefox เริ่มอ่าน URL หลังคลิกช้ากว่า tick ถัดไป — ปล่อยทีหลัง (ต้องปล่อยเสมอ แม้ click() throw)
      setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    }
  },
};
