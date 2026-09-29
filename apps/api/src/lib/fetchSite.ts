import { createMiddleware } from "hono/factory";
import { type AppEnv, apiError } from "./context";

/** ค่าที่ยอมได้ของ Sec-Fetch-Site — same-origin = หน้าเว็บของเราเอง · none = ผู้ใช้เปิดเอง (พิมพ์ URL · bookmark) */
const ALLOWED_SITES = new Set(["same-origin", "none"]);

/**
 * เส้นทางที่ส่งของสำคัญออกไปด้วย GET — ของพวกนี้ sameOriginOnly ไม่ได้กัน (เมธอดปลอดภัยถูกยกเว้น)
 * - /reports/export  = zip บัญชีรายเดือน (ลง audit export.monthly)
 * - /buy/:id/idcard  = สำเนาบัตรประชาชน (ลง audit buy.idcard_view)
 * - /buy/:id/pdf     = ใบรับซื้อ มีเลขบัตรเต็ม (CLAUDE.md กฎ 7)
 * - /customers/:id/photo = รูปสำเนาบัตรที่แนบไว้ (ต้นฉบับของไฟล์ idcard — services/receiptPdf.ts)
 */
const GUARDED_PATHS = [
  /^\/api\/reports\/export$/,
  /^\/api\/buy\/[^/]+\/(pdf|idcard)$/,
  /^\/api\/customers\/[^/]+\/photo$/,
];

/** better-auth ตรวจ Origin/CSRF ของเส้นทางตัวเองอยู่แล้ว — ไม่เอาด่านนี้ไปทับ (แนวเดียวกับ contentType.ts) */
const AUTH_PREFIX = "/api/auth/";

const CROSS_SITE = apiError("เปิดไฟล์นี้จากเว็บอื่นไม่ได้ — เปิดจากหน้าระบบโดยตรง");

/** "Same-Origin" → "same-origin" (เทียบตัวพิมพ์เล็ก เผื่อ proxy แก้รูปคำ) */
function fetchSite(header: string | undefined): string | undefined {
  return header?.trim().toLowerCase();
}

/**
 * Fetch Metadata (ASVS V13.2.5 · V4.2.2 · RFC 9110 §15.5.4) — กันลิงก์ข้ามเว็บดูดไฟล์และทิ้ง audit ปลอม
 *
 * cookie เป็น SameSite=Lax → top-level GET ข้ามเว็บยังแนบ cookie ไปด้วย ส่วน sameOriginOnly (lib/origin.ts)
 * ยกเว้น GET/HEAD/OPTIONS ไว้ จึงเหลือช่องให้หน้าเว็บของคนอื่นพา browser ของพนักงานที่ login อยู่ไปโหลด
 * zip บัญชี / สำเนาบัตร ได้ ผลคือไฟล์ถูกดาวน์โหลดลงเครื่องเหยื่อ และ audit ลงชื่อพนักงานคนนั้นทั้งที่ไม่ได้สั่งเอง
 * (CORS กัน script ของผู้โจมตีอ่าน byte ได้อยู่แล้ว — ที่กันเพิ่มคือ audit เพี้ยน · ดาวน์โหลดที่ไม่ได้สั่ง ·
 * งานหนักฝั่งเซิร์ฟเวอร์ที่ /reports/export ถูกกระตุ้นซ้ำ ๆ)
 *
 * ปฏิเสธ cross-site และ same-site — SPA กับ API อยู่ origin เดียวกัน (spec §2 · §11) ตอน dev ก็ผ่าน proxy ของ
 * Vite ที่ path /api ทั้ง prod และ dev จึงเห็นแต่ same-origin · ไม่มี client จริงที่ต้องใช้ same-site
 * (subdomain ข้างเคียงที่ถูกยึดก็ same-site และส่ง cookie ได้ จึงไม่ยอม)
 *
 * **ไม่มี header = ผ่าน** (browser เก่า · curl · เครื่องมือของร้าน) — header นี้ browser ตั้งเองเท่านั้น
 * ปลอมจาก JS ไม่ได้ ถ้า fail-closed กับ header ที่หายไปฝ่ายบัญชีจะดาวน์โหลดไม่ได้กลางวันทำงาน
 * ค่าที่ไม่รู้จักถือว่าไม่ผ่าน (browser ส่งได้แค่ 4 ค่าตามสเปก)
 *
 * 403 ไม่ใช่ 400 — request ถูกรูปและ login มาแล้ว ที่ถูกปฏิเสธคือ "ที่มา" ของมัน (เท่ากับ sameOriginOnly)
 */
export const requireSameOriginFetch = createMiddleware<AppEnv>(async (c, next) => {
  const path = c.req.path;
  if (path.startsWith(AUTH_PREFIX) || !GUARDED_PATHS.some((p) => p.test(path))) return next();
  const site = fetchSite(c.req.header("sec-fetch-site"));
  if (site === undefined || ALLOWED_SITES.has(site)) return next();
  return c.json(CROSS_SITE, 403);
});
