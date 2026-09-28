import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";

/**
 * header ความปลอดภัยของทุก response — SPA · API · PDF · รูป
 * CSP ตาม SPA: Vite build มีแต่ script ภายนอก (ห้าม inline script เด็ดขาด) · Radix/shadcn ใช้ inline style
 * ฟอนต์ Sarabun อยู่ /fonts · blob: = พรีวิวรูปบัตร · data: = รูปเล็กใน CSS
 * frame-ancestors 'none' + X-Frame-Options DENY ทุก response รวม PDF (เปิดแท็บใหม่ ไม่ฝังใน iframe)
 * — Chrome 154 เปิด PDF ที่มี CSP ชุดนี้ได้ปกติ (ทดสอบแล้ว) · Firefox ไม่ใช้ CSP ของหน้ากับ pdf.js ตั้งแต่ v77
 * HSTS ไม่มี preload/includeSubDomains (Railway เสิร์ฟ HTTPS · browser ไม่สน HSTS ที่มากับ http://localhost)
 * ตั้งหลัง route ทำงาน — แตะเฉพาะ header ชุดนี้ ไม่แตะ Cache-Control / Content-Disposition ของ route
 */
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    imgSrc: ["'self'", "data:", "blob:"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
  },
  xFrameOptions: "DENY",
  referrerPolicy: "strict-origin-when-cross-origin",
  strictTransportSecurity: "max-age=31536000",
  crossOriginOpenerPolicy: "same-origin",
});

/** API ไม่ให้ cache เป็นค่าเริ่มต้น (ข้อมูลลูกค้า/บิล) — route ที่ตั้ง Cache-Control เองใช้ค่าของ route */
export const noStoreByDefault = createMiddleware(async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "no-store");
});
