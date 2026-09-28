import { defineConfig } from "vitest/config";

export default defineConfig({
  // ใบรับซื้อ (src/receipt) เป็น TSX — ใช้ JSX runtime อัตโนมัติแบบเดียวกับ tsconfig
  esbuild: { jsx: "automatic" },
  test: {
    name: "core",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
