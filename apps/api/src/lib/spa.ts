import { serveStatic } from "@hono/node-server/serve-static";
import type { Env, Hono } from "hono";

/**
 * เสิร์ฟ build ของ apps/web ที่ origin เดียวกับ API — เรียกหลัง createApp (route ของ /api มาก่อน)
 * - /assets/* ที่ไม่มี = 404 จริง: tab ที่เปิดค้างข้าม redeploy ขอ chunk hash เดิม
 *   ต้องได้ error ไม่ใช่ index.html (browser อ่าน HTML เป็น JS ไม่ได้ หน้าเสียเงียบ ๆ)
 * - path อื่นที่ไม่ใช่ไฟล์ = index.html (client-side routing)
 * root: path สัมพัทธ์จาก cwd ตอน start (ข้อกำหนดของ serveStatic)
 */
export function serveSpa<E extends Env>(app: Hono<E>, root: string) {
  app.use("/*", serveStatic({ root }));
  app.all("/assets/*", (c) => c.text("not found", 404));
  app.get("/*", serveStatic({ root, path: "index.html" }));
}
