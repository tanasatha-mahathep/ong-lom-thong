import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createDb } from "@ong/db";
import { logger } from "hono/logger";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadEnv } from "./env";
import { createS3Storage } from "./lib/storage";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = createApp({ db, auth: createAuth(db, env), env, storage: createS3Storage(env) });
app.use(logger());

// SPA build ของ apps/web ถูกคัดลอกมาที่ ./public ใน Docker image — origin เดียวกับ API
app.use("/*", serveStatic({ root: "./public" }));
app.get("/*", serveStatic({ root: "./public", path: "index.html" }));

serve({ fetch: app.fetch, port: env.PORT }, () => {
  console.log(`api listening on :${env.PORT}`);
});
