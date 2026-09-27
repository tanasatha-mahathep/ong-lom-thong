/** Conventional Commits ภาษาอังกฤษ — semantic-release อ่าน type จาก commit เพื่อออกเลขเวอร์ชัน */
const THAI = /[\u0E00-\u0E7F]/;

export default {
  extends: ["@commitlint/config-conventional"],
  // dependabot เขียน body เป็น URL ยาวเกิน 100 ตัวอักษร — รูปแบบตายตัว ไม่ต้องตรวจ
  ignores: [(message) => /^(?:chore|ci|build)\(deps(?:-dev)?\): bump /.test(message)],
  plugins: [
    {
      rules: {
        "english-only": ({ raw }) => [!THAI.test(raw ?? ""), "commit message must be written in English"],
      },
    },
  ],
  rules: {
    "english-only": [2, "always"],
    "scope-enum": [2, "always", ["core", "db", "api", "web", "gotenberg", "deps", "release"]],
  },
};
