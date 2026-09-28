import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono } from "hono";

/** ไฟล์ใน /assets มี hash ของ Vite ในชื่อ — เนื้อหาเปลี่ยน = ชื่อเปลี่ยน จึง cache ได้ยาว */
export const ASSET_CACHE = "public, max-age=31536000, immutable";

/**
 * เสิร์ฟ build ของ apps/web ที่ origin เดียวกับ API — เรียกหลัง createApp (route ของ /api มาก่อน)
 * - /assets/* ที่มีอยู่ = cache 1 ปี · ที่ไม่มี = 404 จริง: tab ที่เปิดค้างข้าม redeploy ขอ chunk hash เดิม
 *   ต้องได้ error ไม่ใช่ index.html (browser อ่าน HTML เป็น JS ไม่ได้ หน้าเสียเงียบ ๆ)
 * - index.html ทุกทาง (/ · /index.html · SPA fallback) = no-cache — browser ต้องถามเซิร์ฟเวอร์ก่อนใช้
 *   หลัง deploy จึงได้ index.html ที่ชี้ asset ชุดใหม่
 * - path อื่นที่ไม่ใช่ไฟล์ = index.html (client-side routing)
 * root: path สัมพัทธ์จาก cwd ตอน start (ข้อกำหนดของ serveStatic)
 */
export function serveSpa<E extends Env>(app: Hono<E>, root: string) {
  app.use("/*", async (c, next) => {
    await next();
    if (c.res.headers.has("Cache-Control")) return;
    if (c.req.path.startsWith("/assets/")) {
      if (c.res.status === 200) c.res.headers.set("Cache-Control", ASSET_CACHE);
    } else if (c.res.headers.get("Content-Type")?.startsWith("text/html")) {
      c.res.headers.set("Cache-Control", "no-cache");
    }
  });
  app.use("/*", serveStatic({ root }));
  app.all("/assets/*", (c) => c.text("not found", 404));
  app.get("/*", serveStatic({ root, path: "index.html" }));
}
