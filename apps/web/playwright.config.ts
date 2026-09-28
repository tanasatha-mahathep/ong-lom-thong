import { defineConfig, devices } from "@playwright/test";

// e2e ไม่อยู่ใน `make check` — ต้องมี api + web + Postgres (ตามพอร์ตเดียวกับ vite.config.ts)
// WEB_PORT=5181 API_PORT=8791 E2E_EMAIL=… E2E_PASSWORD=… pnpm --filter @ong/web e2e
const baseURL = `http://localhost:${process.env.WEB_PORT ?? "5173"}`;

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL,
    locale: "th-TH",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // ใช้ server ที่เปิดอยู่แล้วถ้ามี — ไม่มีก็เปิด `make dev` (โหลด .env) ให้
  webServer: {
    command: "make -C ../.. dev",
    url: `${baseURL}/api/healthz`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
