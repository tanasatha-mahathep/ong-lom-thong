import { serve } from "@hono/node-server";
import { createDb } from "@ong/db";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadEnv } from "./env";
import { createBackgroundTasks } from "./lib/background";
import { createGotenbergClient } from "./lib/gotenberg";
import { closeHttpServer, createShutdown } from "./lib/shutdown";
import { serveSpa } from "./lib/spa";
import { closeSentry, initSentry } from "./lib/sentry";
import { createS3Storage, probeConditionalWrites } from "./lib/storage";
import { companyFromEnv, createReceiptPdfService, loadPdfFonts, startPdfRetryLoop } from "./services/receiptPdf";

const env = loadEnv();
// เปิด Sentry ก่อนสร้างทุกอย่าง — error ตอนเริ่มระบบก็ถูกส่ง · ไม่ตั้ง SENTRY_DSN = ไม่ส่งอะไรเลย
initSentry({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV });
const db = createDb(env.DATABASE_URL);
const storage = createS3Storage(env);
const tasks = createBackgroundTasks();
// PDF เก็บถาวร (spec §9.2) — ฟอนต์อ่านครั้งเดียว ไฟล์หาย = ไม่ start
const pdf = createReceiptPdfService({
  db,
  storage,
  renderer: createGotenbergClient(env),
  company: companyFromEnv(env),
  fonts: await loadPdfFonts(env.PDF_FONT_DIR),
  tasks,
  now: () => new Date(),
  watermark: env.RECEIPT_WATERMARK,
});
const app = createApp({ db, auth: createAuth(db, env), env, storage, pdf });

// SPA build ของ apps/web ถูกคัดลอกมาที่ ./public ใน Docker image — origin เดียวกับ API (cache/404 ใน lib/spa.ts)
serveSpa(app, "./public");

const server = serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`api listening on :${env.PORT}`);
});

// bucket บังคับ If-None-Match จริงไหม — log ครั้งเดียวตอนเริ่ม (ยืนยัน Tigris บน staging/production)
void probeConditionalWrites(storage).then(
  (result) =>
    console.log(
      result === "honoured"
        ? "[storage] conditional writes honoured (If-None-Match: * → 412)"
        : "[storage] conditional writes NOT honoured — archives rely on HEAD + the per-bill lease",
    ),
  (e: unknown) => console.error("[storage] conditional write probe failed:", e instanceof Error ? e.message : e),
);

// SIGTERM (Railway redeploy · docker stop) / SIGINT → หยุดรับ request ใหม่ · request ที่ค้าง (บันทึกบิล) ทำจนจบ
// → ปิด pool ของ Postgres → exit 0 ภายใน 8 วินาที (lib/shutdown.ts)
// timer/งานเบื้องหลังใหม่ต้องลงทะเบียนที่นี่ เช่น
//   shutdown.add("stop", "pdf retry loop", startPdfRetryLoop(pdf)) — ฟังก์ชันที่หยุด interval
//   shutdown.add("drain", "pdf tasks", () => tasks.idle())         — รอ PDF ที่กำลังสร้างก่อนปิด DB
const shutdown = createShutdown();
shutdown.add("stop", "http server", () => closeHttpServer(server));
// ใบที่ค้าง pending/failed (Gotenberg ล่ม · deploy ระหว่างสร้าง) — ลองใหม่ทุก 5 นาที · หยุดตอนปิด
shutdown.add("stop", "pdf retry loop", startPdfRetryLoop(pdf));
// PDF ที่กำลังสร้างให้จบก่อนปิด DB (รอไม่เกิน 5 วินาที) — ที่ยังไม่เริ่ม/ไม่ทัน ยัง pending ให้ retry หลัง start ใหม่
shutdown.add("drain", "pdf tasks", () => tasks.close(5_000));
shutdown.add("close", "postgres", () => db.$client.end({ timeout: 5 }));
// event ค้างในคิวของ Sentry ต้องส่งก่อน exit (ไม่มี DSN = ทันที)
shutdown.add("close", "sentry", closeSentry);
shutdown.listen();
