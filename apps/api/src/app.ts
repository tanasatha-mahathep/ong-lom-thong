import type { Db } from "@ong/db";
import { deriveGoldPrice, fmtInt, fmtMoney } from "@ong/core";
import { Hono } from "hono";
import type { Auth } from "./auth";
import type { Env } from "./env";
import { type AppEnv, apiError, requireSession } from "./lib/context";
import { sameOriginOnly } from "./lib/origin";
import { me } from "./routes/me";

export interface AppDeps {
  db: Db;
  auth: Auth;
  env: Env;
}

const health = () => ({ ok: true, time: new Date().toISOString() });

/** ประกอบแอปจาก dependency ที่ส่งเข้ามา — เทสต์เรียก app.request() ได้โดยไม่ต้องเปิดพอร์ต */
export function createApp({ db, auth, env }: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use(async (c, next) => {
    c.set("db", db);
    c.set("auth", auth);
    c.set("env", env);
    await next();
  });
  app.get("/healthz", (c) => c.json(health()));

  const api = new Hono<AppEnv>();
  api.use(sameOriginOnly(env.BETTER_AUTH_URL));
  api.get("/healthz", (c) => c.json(health()));
  // login / logout / session ของ better-auth
  api.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
  api.route("/me", me);

  // ใช้ฟังก์ชันเดียวกับที่ PUT /gold-price/today จะใช้ตอนบันทึก
  api.post("/gold-price/quote", requireSession, async (c) => {
    const body: { bar_sell?: string } = await c.req.json<{ bar_sell?: string }>().catch(() => ({}));
    try {
      const q = deriveGoldPrice(body.bar_sell ?? "");
      return c.json({ bar_sell: fmtMoney(q.barSell), bar_buy: fmtMoney(q.barBuy), jewelry_buy: fmtInt(q.jewelryBuy) });
    } catch (e) {
      return c.json(apiError((e as Error).message, "bar_sell"), 400);
    }
  });

  api.notFound((c) => c.json(apiError("not found"), 404));
  app.route("/api", api);

  app.onError((err, c) => {
    console.error(err);
    return c.json(apiError("internal error"), 500);
  });
  return app;
}
