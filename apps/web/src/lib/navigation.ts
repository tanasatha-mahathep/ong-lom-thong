/**
 * นำทาง browser ไปที่ URL จริง (ไม่ใช่ SPA route) — ใช้กับไฟล์ที่ดาวน์โหลดผ่าน `Content-Disposition: attachment`
 * (เช่น zip ส่งบัญชีรายเดือน) เพื่อให้ browser จัดการ stream ลงดิสก์เอง — **ห้าม `fetch()` ไฟล์ใหญ่เข้าหน่วยความจำ**
 * เทสต์แทนได้ (jsdom ห้ามแก้ `location.assign` ตรง ๆ) — ดู lib/app-update.ts สำหรับรูปแบบเดียวกัน
 */
export const navigation = { downloadAt: (url: string) => window.location.assign(url) };
