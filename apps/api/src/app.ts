import type { Db } from "@ong/db";
import { Hono } from "hono";
import type { Auth } from "./auth";
import type { Env } from "./env";
import { type AppEnv, apiError } from "./lib/context";
import { loggableError } from "./lib/log";
import { sameOriginOnly } from "./lib/origin";
import type { Storage } from "./lib/storage";
import type { ReceiptPdfService } from "./services/receiptPdf";
import { buyRoutes } from "./routes/buy";
import { customerRoutes } from "./routes/customers";
import { goldPriceRoutes } from "./routes/goldPrice";
import { me } from "./routes/me";
import { metalRoutes } from "./routes/metals";

export interface AppDeps {
  db: Db;
  auth: Auth;
  env: Env;
  storage: Storage;
  /** สร้าง/เก็บ PDF ของบิล — renderer จริง (Gotenberg) ใน index.ts · ตัวปลอมใน test harness */
  pdf: ReceiptPdfService;
  now?: () => Date;
}

const health = () => ({ ok: true, time: new Date().toISOString() });

/** ประกอบแอปจาก dependency ที่ส่งเข้ามา — เทสต์เรียก app.request() ได้โดยไม่ต้องเปิดพอร์ต */
export function createApp({ db, auth, env, storage, pdf, now = () => new Date() }: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set("db", db);
    c.set("auth", auth);
    c.set("env", env);
    c.set("storage", storage);
    c.set("pdf", pdf);
    c.set("now", now);
    await next();
  });
  app.get("/healthz", (c) => c.json(health()));

  const api = new Hono<AppEnv>();
  api.use(sameOriginOnly(env.BETTER_AUTH_URL));
  api.get("/healthz", (c) => c.json(health()));
  // login / logout / session ของ better-auth
  api.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  api.route("/me", me);

  api.route("/gold-price", goldPriceRoutes);
  api.route("/metals", metalRoutes);
  api.route("/customers", customerRoutes);
  api.route("/buy", buyRoutes);

  api.notFound((c) => c.json(apiError("not found"), 404));
  app.route("/api", api);

  app.onError((err, c) => {
    // ห้าม log ค่า params ของ query — มีข้อมูลลูกค้า (lib/log.ts)
    console.error(loggableError(err));
    return c.json(apiError("internal error"), 500);
  });
  return app;
}
