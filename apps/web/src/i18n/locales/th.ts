/**
 * ข้อความของโครงแอป — namespace `common` (ใช้ทุกหน้า) และ `shell` (sidebar · หัวหน้า · ตาราง)
 * ภาษาไทยอย่างเดียวตอนนี้ · ภาษาอังกฤษภายหลัง: เพิ่ม en.ts ข้างไฟล์นี้ (`satisfies typeof th`) แล้วลงทะเบียนใน resources.ts
 * ห้ามใส่ `as const` — ค่าต้องเป็น string ธรรมดา ให้ en.ts ใช้ชนิดเดียวกันได้
 */
export default {
  common: {
    shopName: "โอเอ็นจี หลอมทอง",
    retry: "ลองใหม่",
    saving: "กำลังบันทึก…",
    /** ชั้นบังหน้าจอระหว่างพาไปหน้าอื่น/โหลดใหม่หลังการกระทำ (components/blocking-overlay.tsx) */
    blocking: "กำลังทำงาน…",
    /** ชั้นบังหน้าจอค้างเกินเวลา (lib/blocking.ts) — ปลดให้ทำงานต่อได้ */
    blockingTimeout: "ใช้เวลานานผิดปกติ — ตรวจการเชื่อมต่อ แล้วลองใหม่หรือรีเฟรชหน้า",
    /** บันทึกสำเร็จแล้วแต่ขั้นถัดไป (นำทาง/พิมพ์) ล้ม — ห้ามให้บันทึกซ้ำ (hooks/use-app-form.ts) */
    afterSaveFailed: "บันทึกแล้ว แต่เปิดหน้าถัดไปไม่ได้ — ห้ามบันทึกซ้ำ รีเฟรชหน้าเพื่อทำงานต่อ",
    baht: "บาท",
    noBranch: "ยังไม่ได้เลือกสาขา",
    branchCode: "รหัสสาขา {{code}}",
    loadFailed: "โหลด{{what}}ไม่ได้",
    placeholder: "อยู่ระหว่างพัฒนา",
    roles: {
      staff: "พนักงาน",
      manager: "ผู้จัดการ",
      accounting: "บัญชี",
      admin: "ผู้ดูแลระบบ",
    },
    goldPrice: {
      today: "ราคาทองวันนี้",
      barSell: "ทองแท่งขายออก",
      barBuy: "ทองแท่งรับซื้อ",
      jewelryBuy: "ทองรูปพรรณรับซื้อ",
      notSet: "ยังไม่ได้ตั้งราคาทองวันนี้",
      source: {
        central: "ราคากลาง",
        branch: "ราคาเฉพาะสาขา",
      },
    },
    errors: {
      fallback: "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง",
      network: "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่",
      badRequest: "ข้อมูลไม่ถูกต้อง",
      unauthorized: "หมดเวลาใช้งาน เข้าสู่ระบบใหม่อีกครั้ง",
      forbidden: "ไม่มีสิทธิ์",
      notFound: "ไม่พบข้อมูล",
      conflict: "ข้อมูลขัดแย้งกับที่มีอยู่",
      tooLarge: "ไฟล์ใหญ่เกินไป",
      unsupported: "รูปแบบข้อมูลไม่ถูกต้อง",
      rateLimited: "ลองใหม่อีกครั้งในอีกสักครู่",
      server: "เซิร์ฟเวอร์ขัดข้อง ลองใหม่อีกครั้ง",
    },
    status: {
      notFoundTitle: "ไม่พบหน้านี้",
      notFoundBody: "ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว",
      backHome: "กลับหน้าแรก",
      errorTitle: "เกิดข้อผิดพลาด",
    },
  },
  shell: {
    skipLink: "ข้ามไปเนื้อหาหลัก",
    sidebar: "แถบเมนู",
    mainNav: "เมนูหลัก",
    breadcrumb: "ตำแหน่งของหน้า",
    breadcrumbMore: "เพิ่มเติม",
    toggleSidebar: "แสดง/ซ่อนเมนู",
    sheetTitle: "เมนู",
    sheetDescription: "เมนูหลักของระบบ",
    close: "ปิด",
    notifications: "การแจ้งเตือน",
    closeNotification: "ปิดการแจ้งเตือน",
    currentBranch: "สาขาปัจจุบัน",
    quickBuy: "ซื้อเข้า",
    groups: {
      reports: "รายงาน",
      settings: "ตั้งค่า",
    },
    nav: {
      home: "หน้าแรก",
      buy: "ซื้อเข้า",
      bills: "ค้นบิล",
      customers: "ลูกค้า",
      purchase: "ยอดซื้อ",
      stock: "สต็อก",
      export: "ส่งบัญชีรายเดือน",
      goldPrice: "ราคาทองวันนี้",
      branches: "สาขา",
      users: "ผู้ใช้",
    },
    /** ชื่อหน้า — route ใส่ key ใน `staticData.title` (หัวหน้า · breadcrumb · document.title) */
    routes: {
      login: "เข้าสู่ระบบ",
      home: "หน้าแรก",
      buy: "ซื้อเข้า",
      bill: "ดูบิล",
      bills: "ค้นบิล",
      customers: "ลูกค้า",
      customerNew: "เพิ่มลูกค้า",
      customer: "ข้อมูลลูกค้า",
      settings: "ตั้งค่า",
      goldPrice: "ตั้งราคาทองวันนี้",
      branches: "จัดการสาขา",
      users: "จัดการผู้ใช้",
      reports: "รายงาน",
      purchase: "รายงานยอดซื้อ",
      stock: "สต็อกคงเหลือ",
      export: "ส่งบัญชีรายเดือน",
    },
    /** ตัวเลือกสาขาที่หัว sidebar (แบบ TeamSwitcher ของ sidebar-07) */
    branchSwitcher: {
      label: "สาขา",
      /** ปุ่มลัดของสาขาที่ n ในรายการ — Alt (ไม่ใช่ Ctrl/⌘ ที่ browser ใช้สลับแท็บ) */
      shortcut: "Alt+{{n}}",
      manage: "จัดการสาขา",
      switched: "เปลี่ยนสาขาเป็น {{name}} แล้ว",
      failed: "เปลี่ยนสาขาไม่สำเร็จ — {{reason}}",
      confirmTitle: "ข้อมูลในหน้านี้ยังไม่ได้บันทึก",
      confirmBody: "ถ้าเปลี่ยนเป็น {{name}} ข้อมูลที่กรอกค้างไว้จะหายไป",
      confirmStay: "อยู่ต่อ",
      confirmSwitch: "ทิ้งข้อมูลและเปลี่ยนสาขา",
    },
    userMenu: {
      signOut: "ออกจากระบบ",
      signOutFailed: "ออกจากระบบไม่สำเร็จ — {{reason}}",
    },
    theme: {
      label: "ธีม",
      light: "สว่าง",
      dark: "มืด",
      system: "ตามระบบ",
    },
    update: {
      message: "มีเวอร์ชันใหม่ กรุณารีเฟรช",
      reload: "รีเฟรช",
    },
    table: {
      empty: "ไม่พบข้อมูล",
      pager: "เปลี่ยนหน้า",
      page: "หน้า {{page}}",
      previous: "ก่อนหน้า",
      next: "ถัดไป",
    },
  },
};
