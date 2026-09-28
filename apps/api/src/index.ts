import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createDb } from "@ong/db";
import { logger } from "hono/logger";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadEnv } from "./env";
import { createBackgroundTasks } from "./lib/background";
import { createGotenbergClient } from "./lib/gotenberg";
import { createS3Storage } from "./lib/storage";
import { companyFromEnv, createReceiptPdfService, loadPdfFonts, startPdfRetryLoop } from "./services/receiptPdf";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const storage = createS3Storage(env);
// PDF เก็บถาวร (spec §9.2) — ฟอนต์อ่านครั้งเดียว ไฟล์หาย = ไม่ start
const pdf = createReceiptPdfService({
  db,
  storage,
  renderer: createGotenbergClient(env),
  company: companyFromEnv(env),
  fonts: await loadPdfFonts(env.PDF_FONT_DIR),
  tasks: createBackgroundTasks(),
  now: () => new Date(),
});
const app = createApp({ db, auth: createAuth(db, env), env, storage, pdf });
app.use(logger());

// SPA build ของ apps/web ถูกคัดลอกมาที่ ./public ใน Docker image — origin เดียวกับ API
app.use("/*", serveStatic({ root: "./public" }));
app.get("/*", serveStatic({ root: "./public", path: "index.html" }));

serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`api listening on :${env.PORT}`);
});

// ใบที่ค้าง pending/failed (Gotenberg ล่ม · deploy ระหว่างสร้าง) — ลองใหม่ทุก 5 นาที
startPdfRetryLoop(pdf);
