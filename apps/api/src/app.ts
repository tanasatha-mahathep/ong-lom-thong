import type { Db } from "@ong/db";
import { Hono } from "hono";
import { accessLog } from "./lib/accessLog";
import { requireJsonBody } from "./lib/contentType";
import { requireSameOriginFetch } from "./lib/fetchSite";
import { noStoreByDefault, securityHeaders } from "./lib/httpHeaders";
import type { Auth } from "./auth";
import type { Env } from "./env";
import { type AppEnv, apiError } from "./lib/context";
import { loggableError } from "./lib/log";
import { sameOriginOnly } from "./lib/origin";
import { captureError } from "./lib/sentry";
import type { Storage } from "./lib/storage";
import { type GoldReferenceService, createGoldReferenceService, providerFromEnv } from "./services/goldReference";
import { recordGoldAnnouncement, withAnnouncementHistory } from "./services/goldReferenceHistory";
import type { ReceiptPdfService } from "./services/receiptPdf";
import { buyRoutes } from "./routes/buy";
import { customerRoutes } from "./routes/customers";
import { goldPriceRoutes } from "./routes/goldPrice";
import { me } from "./routes/me";
import { metalRoutes } from "./routes/metals";
import { reportRoutes } from "./routes/reports";
import { adminRoutes } from "./routes/admin";

export interface AppDeps {
  db: Db;
  auth: Auth;
  env: Env;
  storage: Storage;
  /** สร้าง/เก็บ PDF ของบิล — renderer จริง (Gotenberg) ใน index.ts · ตัวปลอมใน test harness */
  pdf: ReceiptPdfService;
  /** ราคาอ้างอิงสมาคม — ไม่ส่ง = สร้างจาก env (ค่าเริ่มต้นปิด) · เทสต์ส่ง provider ปลอม */
  goldReference?: GoldReferenceService;
  now?: () => Date;
}

const health = () => ({ ok: true, time: new Date().toISOString() });

/** ประกอบแอปจาก dependency ที่ส่งเข้ามา — เทสต์เรียก app.request() ได้โดยไม่ต้องเปิดพอร์ต */
export function createApp({ db, auth, env, storage, pdf, goldReference, now = () => new Date() }: AppDeps) {
  // ประกาศที่ดึงได้ถูกเก็บเป็นประวัติ (กราฟ) ทั้ง service จาก env และตัวที่เทสต์ส่งมา — ตัว service เองไม่แตะ DB
  const reference = withAnnouncementHistory(
    goldReference ??
      createGoldReferenceService({
        provider: providerFromEnv(env),
        now,
        // ไม่ log URL/ข้อความเต็ม — บอกแค่ชนิดของปัญหา
        onError: (reason) => console.warn(`[gold-reference] fetch failed: ${reason}`),
      }),
    {
      record: (value) => recordGoldAnnouncement(db, value, now()),
      onError: (e) => console.warn("[gold-reference] could not store the announcement:", loggableError(e)),
    },
  );
  const app = new Hono<AppEnv>();
  // ก่อนทุก route (รวม SPA ใน index.ts): access log ไม่มี PII · header ความปลอดภัย · API ไม่ cache
  app.use(accessLog(env.NODE_ENV === "test" ? null : (line) => console.log(line)));
  app.use(securityHeaders);
  app.use("/api/*", noStoreByDefault);
  app.use(async (c, next) => {
    c.set("db", db);
    c.set("auth", auth);
    c.set("env", env);
    c.set("storage", storage);
    c.set("pdf", pdf);
    c.set("goldReference", reference);
    c.set("now", now);
    await next();
  });
  app.get("/healthz", (c) => c.json(health()));

  const api = new Hono<AppEnv>();
  api.use(sameOriginOnly(env.BETTER_AUTH_URL));
  // defence in depth (ASVS V13.2.5) — request ที่มี body ต้องเป็น application/json (F12 · F15 · F16)
  api.use(requireJsonBody);
  // Fetch Metadata — GET ที่ส่งไฟล์สำคัญ/ลง audit ต้องไม่มาจากเว็บอื่น (sameOriginOnly ยกเว้นเมธอดปลอดภัย)
  api.use(requireSameOriginFetch);
  api.get("/healthz", (c) => c.json(health()));
  // login / logout / session ของ better-auth
  api.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  api.route("/me", me);

  api.route("/gold-price", goldPriceRoutes);
  api.route("/metals", metalRoutes);
  api.route("/customers", customerRoutes);
  api.route("/buy", buyRoutes);
  api.route("/reports", reportRoutes);
  // สาขา · ผู้ใช้ — admin เท่านั้น
  api.route("/admin", adminRoutes);

  app.route("/api", api);
  // notFound ของ sub-app ไม่ถูกใช้ตอน mount — path ใต้ /api ที่ไม่มี route ตอบ JSON 404 ทุก method
  // ไม่งั้นตกไปที่ SPA fallback ใน index.ts (index.html 200)
  app.all("/api/*", (c) => c.json(apiError("not found"), 404));

  app.onError((err, c) => {
    // ห้าม log ค่า params ของ query — มีข้อมูลลูกค้า (lib/log.ts) · Sentry รับเฉพาะค่าที่ผ่านตัวนี้เช่นกัน
    const safe = loggableError(err);
    console.error(safe);
    captureError(safe);
    return c.json(apiError("internal error"), 500);
  });
  return app;
}
