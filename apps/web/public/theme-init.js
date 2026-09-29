// ตั้งธีมก่อน React โหลด — กันจอขาววาบในโหมดมืด · CSP ห้าม inline script จึงแยกเป็นไฟล์
// ต้องตรงกับ src/lib/theme.ts (key "ong.theme" · ค่าเริ่มต้น "system")
(function () {
  var theme = "system";
  try {
    theme = localStorage.getItem("ong.theme") || "system";
  } catch {
    // localStorage ถูกบล็อก — ใช้ค่าเริ่มต้น
  }
  var dark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
