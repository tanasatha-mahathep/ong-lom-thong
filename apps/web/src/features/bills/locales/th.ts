/**
 * ข้อความของหน้าค้นบิลและการ์ดบิลวันนี้ (namespace "bills")
 * แทรกค่าด้วย {{ชื่อ}} · เทสต์อ่านข้อความจากไฟล์นี้ชุดเดียวกัน
 */
export default {
  filters: {
    region: "ตัวกรองบิล",
    search: "ค้นหา",
    searchPlaceholder: "เช่น RC6909-0001 · สมชาย · เลขบัตรประชาชน",
    searchTooShort: "ค้นอย่างน้อย 2 ตัวอักษร",
    from: "ตั้งแต่วันที่",
    to: "ถึงวันที่",
    presets: "ช่วงวันที่สำเร็จรูป",
    metal: "โลหะ",
    allMetals: "ทุกโลหะ",
    branch: "สาขา",
    allBranches: "ทุกสาขา",
    clear: "ล้างตัวกรอง",
  },

  presets: {
    today: "วันนี้",
    yesterday: "เมื่อวาน",
    last7Days: "7 วันล่าสุด",
    thisMonth: "เดือนนี้",
    allDates: "ทุกวันที่",
  },

  columns: {
    docNo: "เลขที่",
    date: "วันที่",
    time: "เวลา",
    branch: "สาขา",
    customer: "ลูกค้า",
    weight: "น้ำหนัก (กรัม)",
    amount: "ยอดรวม (บาท)",
    createdBy: "ผู้บันทึก",
    status: "สถานะ",
    pdf: "PDF",
  },
  status: { void: "ยกเลิก" },
  pdf: { ready: "พร้อม", pending: "กำลังสร้าง", failed: "ล้มเหลว", invalid: "ข้อมูลไม่ครบ" },

  results: {
    caption: "รายการบิลซื้อเข้าตามตัวกรอง",
    empty: "ไม่พบบิลตามเงื่อนไขที่ค้นหา",
    totals: "รวม {{count}} บิล · น้ำหนัก {{weight}} กรัม · ยอดรวม {{amount}} บาท",
    totalsNote: "ไม่นับบิลที่ยกเลิก",
    loading: "กำลังค้นหา…",
    error: "ค้นบิลไม่สำเร็จ",
  },

  today: {
    title: "บิลซื้อเข้าวันนี้",
    caption: "บิลซื้อเข้าวันนี้ของสาขาปัจจุบัน",
    viewAll: "ดูทั้งหมด",
    latestOnly: "แสดง {{count}} ใบล่าสุด",
    empty: "วันนี้ยังไม่มีบิลซื้อเข้า",
    buy: "ซื้อเข้า",
    noBranch: "เลือกสาขาจากเมนูผู้ใช้ก่อน",
    loadError: "โหลดบิลวันนี้ไม่ได้",
  },
};
