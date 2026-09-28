import { serve } from "@hono/node-server";
import { createDb } from "@ong/db";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadEnv } from "./env";
import { closeHttpServer, createShutdown } from "./lib/shutdown";
import { serveSpa } from "./lib/spa";
import { createS3Storage } from "./lib/storage";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = createApp({ db, auth: createAuth(db, env), env, storage: createS3Storage(env) });

// SPA build ของ apps/web ถูกคัดลอกมาที่ ./public ใน Docker image — origin เดียวกับ API (cache/404 ใน lib/spa.ts)
serveSpa(app, "./public");

const server = serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`api listening on :${env.PORT}`);
});

// SIGTERM (Railway redeploy · docker stop) / SIGINT → หยุดรับ request ใหม่ · request ที่ค้าง (บันทึกบิล) ทำจนจบ
// → ปิด pool ของ Postgres → exit 0 ภายใน 8 วินาที (lib/shutdown.ts)
// timer/งานเบื้องหลังใหม่ต้องลงทะเบียนที่นี่ เช่น
//   shutdown.add("stop", "pdf retry loop", startPdfRetryLoop(pdf)) — ฟังก์ชันที่หยุด interval
//   shutdown.add("drain", "pdf tasks", () => tasks.idle())         — รอ PDF ที่กำลังสร้างก่อนปิด DB
const shutdown = createShutdown();
shutdown.add("stop", "http server", () => closeHttpServer(server));
shutdown.add("close", "postgres", () => db.$client.end({ timeout: 5 }));
shutdown.listen();
