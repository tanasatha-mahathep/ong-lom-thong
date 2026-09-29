/** namespace `auth` — หน้า login และขั้นเลือกสาขา (ไม่มี `as const` · ภาษาอังกฤษภายหลัง: en.ts ข้างไฟล์นี้) */
export default {
  signIn: {
    title: "เข้าสู่ระบบ",
    description: "บัญชีพนักงานร้าน{{shop}}",
    email: "อีเมล",
    emailPlaceholder: "name@example.com",
    password: "รหัสผ่าน",
    passwordPlaceholder: "••••••••••",
    submit: "เข้าสู่ระบบ",
    submitting: "กำลังเข้าสู่ระบบ…",
    help: "ลืมรหัสผ่านหรือยังไม่มีบัญชี ติดต่อผู้ดูแลระบบ",
    missingEmail: "กรอกอีเมล",
    missingPassword: "กรอกรหัสผ่าน",
    invalidEmail: "รูปแบบอีเมลไม่ถูกต้อง เช่น name@example.com",
    welcome: "ยินดีต้อนรับ {{name}}",
  },
  errors: {
    invalidCredentials: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    disabled: "บัญชีนี้ถูกปิดใช้งาน ติดต่อผู้ดูแลระบบ",
    rateLimited: "พยายามเข้าสู่ระบบบ่อยเกินไป รอสักครู่",
    forbiddenOrigin:
      "เซิร์ฟเวอร์ปฏิเสธ origin ของหน้านี้ — ตั้ง BETTER_AUTH_URL ของ api ให้ตรงกับ {{origin}} แล้วเปิด api ใหม่",
    failed: "เข้าสู่ระบบไม่สำเร็จ ลองใหม่อีกครั้ง",
  },
  branch: {
    title: "เลือกสาขาที่ทำงาน",
    greeting: "สวัสดี {{name}} — บัญชีนี้ใช้ได้ {{count}} สาขา",
    legend: "สาขาสำหรับบิลและรายงานในรอบนี้",
    hint: "เปลี่ยนภายหลังได้ที่เมนูผู้ใช้ท้ายแถบเมนู",
    submit: "เข้าใช้งาน",
    required: "เลือกสาขาที่ทำงาน",
    saveFailed: "บันทึกสาขาไม่สำเร็จ — {{reason}}",
    welcome: "ยินดีต้อนรับ {{name}} — ทำงานที่{{branch}}",
  },
  brandTagline: "ระบบซื้อเข้าหน้าร้าน · สมาชิก",
};
