import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { target } from "./lib/target";

// One id per run, shared by the runner and every worker (workers inherit the runner's env): it goes into
// every account and customer this run creates, so reruns never collide. The dash keeps digit runs short —
// a 13-digit run in a response means an unmasked national ID to the masking checks.
process.env.E2E_RUN_ID ??= `${new Date().toISOString().replace(/\D/g, "").slice(2, 12)}-${randomBytes(2).toString("hex")}`;

const CI = !!process.env.CI;

/**
 * Projects
 *   smoke  read-only — also runs against deployed environments (deploy-smoke.yml): never writes
 *   api    black-box journeys through the real container: cookies, CSRF, S3 — writes, local stack only
 *   pdf    golden checks of Gotenberg's Thai A4 output (structure + text, no pixel diffs)
 *   ui     Chromium: the SPA, console, axe-core WCAG 2.x AA
 * `setup` creates this run's accounts on the local stack; only `api` depends on it.
 */
export default defineConfig({
  testDir: "./specs",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  // Playwright's recommendation for CI: one worker, stable timings; locally as many as the machine has
  workers: CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
    ["junit", { outputFile: "test-results/junit.xml" }],
  ],
  use: {
    baseURL: target.baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  },
  projects: [
    { name: "setup", testDir: "./specs/setup", testMatch: /.*\.setup\.ts/ },
    { name: "smoke", testDir: "./specs/smoke" },
    { name: "api", testDir: "./specs/api", dependencies: ["setup"] },
    { name: "pdf", testDir: "./specs/pdf" },
    { name: "ui", testDir: "./specs/ui", use: { ...devices["Desktop Chrome"] } },
  ],
});
