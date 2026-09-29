/**
 * นำทาง browser ไปที่ URL จริง (ไม่ใช่ SPA route) — ใช้กับไฟล์ที่ดาวน์โหลดผ่าน `Content-Disposition: attachment`
 * (เช่น zip ส่งบัญชีรายเดือน) เพื่อให้ browser จัดการ stream ลงดิสก์เอง — **ห้าม `fetch()` ไฟล์ใหญ่เข้าหน่วยความจำ**
 * เทสต์แทนได้ (jsdom ห้ามแก้ `location.assign` ตรง ๆ) — ดู lib/app-update.ts สำหรับรูปแบบเดียวกัน
 */
export const navigation = {
  downloadAt: (url: string) => window.location.assign(url),
  /** ไฟล์ที่ขอผ่าน fetch (ต้องรู้ผลสำเร็จ/ล้มเหลวเพื่อแจ้งผู้ใช้ — CSV ขนาดเล็ก) → บันทึกลงเครื่องด้วยชื่อที่กำหนด */
  saveBlob: (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    // ให้ browser เริ่มอ่านลิงก์ก่อนค่อยปล่อย URL
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};
