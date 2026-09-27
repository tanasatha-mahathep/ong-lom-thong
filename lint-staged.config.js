// รันแบบไม่ขนาน (--concurrent false ใน .husky/pre-commit) เพราะ package.json เข้าได้หลาย pattern
export default {
  "*.{ts,tsx,js}": ["eslint --fix --max-warnings=0 --no-warn-ignored", "prettier --write"],
  "package.json": "sort-package-json",
  "*.{json,md,yml,yaml,css,html}": "prettier --write --ignore-unknown",
};
