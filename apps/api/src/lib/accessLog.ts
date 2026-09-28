import { createMiddleware } from "hono/factory";

export type LogLine = (line: string) => void;

/** เลข 13 หลักขึ้นไปใน path (เลขบัตร/เลขผู้เสียภาษีที่หลุดมาใน URL) — uuid ไม่มีช่วงตัวเลขยาวขนาดนี้ */
const LONG_DIGITS = /\d{13,}/g;

/** path ที่ลง log ได้ — ไม่มี query string (?q= คำค้นเลขบัตร/ชื่อ/เบอร์) และปิดเลขยาว */
export const loggablePath = (path: string) => path.replace(LONG_DIGITS, (d) => "#".repeat(d.length));

/**
 * access log บรรทัดเดียวต่อ request: method · path (ไม่มี query) · status · เวลา
 * ไม่ log body · cookie · header ใด ๆ (PDPA · R13) — ต้องลงก่อนทุก route ใน createApp
 * write = null → ไม่ log (เทสต์)
 */
export function accessLog(write: LogLine | null) {
  return createMiddleware(async (c, next) => {
    if (!write) return next();
    const started = performance.now();
    let status = 500;
    try {
      await next();
      status = c.res.status;
    } finally {
      write(`${c.req.method} ${loggablePath(c.req.path)} ${status} ${Math.round(performance.now() - started)}ms`);
    }
  });
}
