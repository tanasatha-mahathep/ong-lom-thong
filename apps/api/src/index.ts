import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { deriveGoldPrice, fmtInt, fmtMoney } from "@ong/core";
import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();
app.use(logger());

const health = (c: { json: (o: object) => Response }) => c.json({ ok: true, time: new Date().toISOString() });
app.get("/healthz", health);

const api = new Hono();
api.get("/healthz", health);

// ตัวอย่าง endpoint แรก — ใช้ฟังก์ชันเดียวกับที่ PUT /gold-price/today จะใช้ตอนบันทึก
api.post("/gold-price/quote", async (c) => {
  const body: { bar_sell?: string } = await c.req.json<{ bar_sell?: string }>().catch(() => ({}));
  try {
    const q = deriveGoldPrice(body.bar_sell ?? "");
    return c.json({
      bar_sell: fmtMoney(q.barSell),
      bar_buy: fmtMoney(q.barBuy),
      jewelry_buy: fmtInt(q.jewelryBuy),
    });
  } catch (e) {
    return c.json({ error: (e as Error).message, field: "bar_sell" }, 400);
  }
});

app.route("/api", api);

// SPA build ของ apps/web ถูกคัดลอกมาที่ ./public ใน Docker image — origin เดียวกับ API
app.use("/*", serveStatic({ root: "./public" }));
app.get("/*", serveStatic({ root: "./public", path: "index.html" }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`api listening on :${port}`);
});
