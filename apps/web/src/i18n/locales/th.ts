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
    /** ปุ่มแสดง/ซ่อนรหัสผ่าน (U7 — components/ui/form-field.tsx) */
    password: {
      show: "แสดงรหัสผ่าน",
      hide: "ซ่อนรหัสผ่าน",
      hint: "{{action}} ({{shortcut}})",
    },
    /** ชั้นบังหน้าจอค้างเกินเวลา (lib/blocking.ts) — ปลดให้ทำงานต่อได้ */
    blockingTimeout: "ใช้เวลานานผิดปกติ — ตรวจการเชื่อมต่อ แล้วลองใหม่หรือรีเฟรชหน้า",
    /** บันทึกสำเร็จแล้วแต่ขั้นถัดไป (นำทาง/พิมพ์) ล้ม — ห้ามให้บันทึกซ้ำ (hooks/use-app-form.ts) */
    afterSaveFailed: "บันทึกแล้ว แต่เปิดหน้าถัดไปไม่ได้ — ห้ามบันทึกซ้ำ รีเฟรชหน้าเพื่อทำงานต่อ",
    baht: "บาท",
    /** ช่องวันที่พิมพ์เอง พ.ศ. (components/thai-date-field.tsx) — ข้อความชุดเดียวทุกหน้า */
    dateField: {
      placeholder: "วว/ดด/ปปปป",
      hint: "พ.ศ. เช่น 29/09/2569",
      required: "กรอกวันที่",
      invalid: "วันที่ไม่ถูกต้อง — พิมพ์ วว/ดด/ปปปป (พ.ศ.) เช่น 29/09/2569",
      tooEarly: "วันที่ต้องตั้งแต่ 1 ม.ค. 2543",
      range: "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด",
    },
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
    /** กระดิ่งขวาสุดของหัวหน้า (components/notification-bell.tsx) */
    bell: {
      label: "การแจ้งเตือน",
      labelUnread: "การแจ้งเตือน ({{count}} รายการใหม่)",
      title: "การแจ้งเตือน",
      empty: "ยังไม่มีการแจ้งเตือน",
    },
    currentBranch: "สาขาปัจจุบัน",
    /** ปุ่มย้อนกลับ [←] หน้าชื่อหน้าเอกสาร (PageHeader `back`) */
    back: {
      customers: "กลับไปรายการลูกค้า",
      bills: "กลับไปค้นบิล",
    },
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
      savingWait: "กำลังบันทึก… รอให้เสร็จก่อนเปลี่ยนสาขา",
      changedElsewhere: "สาขาถูกเปลี่ยนเป็น {{name}} จากที่อื่น",
      changedTitle: "สาขาถูกเปลี่ยนจากที่อื่น",
      changedBody:
        "ตอนนี้บัญชีนี้ทำงานที่ {{name}} (เปลี่ยนจากแท็บหรือเครื่องอื่น) — ข้อมูลที่กรอกค้างไว้บันทึกไม่ได้ กรุณาโหลดหน้าใหม่",
      changedReload: "โหลดหน้าใหม่",
    },
    /**
     * ค้นหา (Ctrl/⌘+K) — ปุ่มใต้ตัวเลือกสาขา + หน้าค้นหา (components/command-search.tsx · command-palette.tsx)
     * ขอบเขต: หน้าและทางลัดตาม role · ลูกค้าทั้งร้าน (ใช้ร่วมทุกสาขา) · บิลเฉพาะสาขาปัจจุบัน
     */
    search: {
      trigger: "ค้นหา…",
      /** ป้ายปุ่มลัดบนปุ่มค้นหา — เครื่อง Apple ใช้ ⌘ */
      shortcutApple: "⌘K",
      shortcutOther: "Ctrl K",
      tooltip: "ค้นหา ({{shortcut}})",
      title: "ค้นหา",
      /** คำอธิบายของ dialog สำหรับ screen reader — บอกขอบเขตการค้น */
      description: "ค้นหน้าและทางลัด ลูกค้าของทั้งร้าน และบิลของ{{name}}",
      descriptionNoBranch: "ค้นหน้าและทางลัด และลูกค้าของทั้งร้าน — ยังไม่ได้เลือกสาขา จึงค้นบิลไม่ได้",
      inputLabel: "คำค้น",
      placeholder: "ชื่อลูกค้า เลขบัตร เลขที่บิล หรือชื่อหน้า…",
      results: "ผลการค้นหา",
      hintEmpty: "พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นลูกค้าและเลขที่บิลของสาขานี้",
      hintEmptyNoBranch: "พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นลูกค้า",
      hintOneMore: "พิมพ์อีก 1 ตัวอักษรเพื่อค้นลูกค้าและบิล",
      groups: {
        actions: "ทางลัด",
        pages: "ไปที่หน้า",
        customers: "ลูกค้า · ทุกสาขา",
        bills: "บิล · {{name}}",
        billsNoBranch: "บิล",
      },
      actions: {
        newBill: "เปิดบิลใหม่",
        newCustomer: "เพิ่มลูกค้า",
      },
      loading: "กำลังค้นหา…",
      failedCustomers: "ค้นลูกค้าไม่สำเร็จ — เลือกเพื่อลองใหม่",
      failedBills: "ค้นบิลไม่สำเร็จ — เลือกเพื่อลองใหม่",
      noBranch: "ยังไม่ได้เลือกสาขา — เลือกสาขาที่หัวเมนูก่อนจึงค้นบิลได้",
      seeAll: "ดูทั้งหมด",
      seeAllCustomers: "ในหน้าลูกค้า",
      seeAllBills: "ในหน้าค้นบิล",
      amount: "{{amount}} บาท",
      /** บรรทัดรองของบิล: วันที่ (วว/ดด/ปปปป พ.ศ. ชม:นน) · ชื่อลูกค้า */
      billMeta: "{{date}} · {{customer}}",
      empty: "ไม่พบผลลัพธ์ที่ตรงกับ “{{q}}”",
      /** ประกาศผ่าน live region หลังผลนิ่ง (WCAG 4.1.3) */
      status: {
        oneMore: "พบ {{n}} รายการ — พิมพ์อีก 1 ตัวอักษรเพื่อค้นลูกค้าและบิล",
        found: "พบ{{summary}}",
        pages: "หน้าและทางลัด {{n}} รายการ",
        customers: "ลูกค้า {{n}} รายการ",
        bills: "บิล {{n}} รายการ",
        failedCustomers: "ค้นลูกค้าไม่สำเร็จ",
        failedBills: "ค้นบิลไม่สำเร็จ",
        none: "ไม่พบผลลัพธ์ที่ตรงกับ “{{q}}”",
      },
      /** แถบปุ่มท้ายหน้าค้นหา (ประดับ — screen reader ใช้ปุ่มตามรูปแบบ combobox อยู่แล้ว) */
      keys: {
        up: "↑",
        down: "↓",
        enter: "↵",
        escape: "Esc",
        move: "เลื่อน",
        open: "เปิด",
        close: "ปิด",
      },
      scope: "บิลเฉพาะ {{name}}",
      leaveTitle: "ข้อมูลในหน้านี้ยังไม่ได้บันทึก",
      leaveBody: "ถ้าไปที่ “{{name}}” ข้อมูลที่กรอกค้างไว้จะหายไป",
      leaveStay: "อยู่ต่อ",
      leaveConfirm: "ทิ้งข้อมูลและไปต่อ",
      savingWait: "กำลังบันทึก… รอให้เสร็จก่อนเปิดหน้าอื่น",
      loadFailed: "เปิดหน้าค้นหาไม่สำเร็จ — ลองใหม่อีกครั้ง",
    },
    /** เวอร์ชันใต้เมนูผู้ใช้ (components/app-version.tsx) */
    appVersion: {
      plain: "v{{version}}",
      withCommit: "v{{version}} · {{commit}}",
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
