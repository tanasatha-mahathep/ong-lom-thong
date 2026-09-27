/** Conventional Commits — semantic-release อ่าน type จาก commit เพื่อออกเลขเวอร์ชัน */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // หัวเรื่องเป็นภาษาไทยปนชื่อเฉพาะ (Hono, Vite, README) — ไม่มีตัวพิมพ์เล็ก/ใหญ่ให้บังคับ
    "subject-case": [0],
    "scope-enum": [2, "always", ["core", "db", "api", "web", "gotenberg", "deps", "release"]],
  },
};
