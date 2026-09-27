/** Conventional Commits ภาษาอังกฤษ — semantic-release อ่าน type จาก commit เพื่อออกเลขเวอร์ชัน */
const THAI = /[\u0E00-\u0E7F]/;

export default {
  extends: ["@commitlint/config-conventional"],
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
