import type { Breadcrumb, ErrorEvent } from "@sentry/react";

/**
 * Sentry ฝั่งเบราว์เซอร์ — เฉพาะ error ไม่มี Session Replay และไม่มี performance trace
 * เหตุผล: ฟอร์มลูกค้ามีเลขบัตรประชาชนและชื่อ · Replay บันทึกการพิมพ์ได้ (PDPA · CLAUDE.md กฎ 7)
 * ไม่ตั้ง VITE_SENTRY_DSN = ไม่โหลดไลบรารีเลย (dev / test)
 * โหลดแบบ dynamic import เพื่อไม่ให้ chunk หลักใหญ่ขึ้น (งบ bundle ใน scripts/ci)
 */

/** เลขยาว 9 หลักขึ้นไป — เลขบัตรประชาชนทั้งแบบติดกันและมีขีด/เว้นวรรค รวมถึงเบอร์โทร */
const LONG_DIGITS = /\d(?:[\s-]?\d){8,}/g;
const REDACTED = "[ตัวเลขยาว]";

export function scrubText(text: string): string {
  return text.replace(LONG_DIGITS, REDACTED);
}

/** ตัด query string ของ URL (อาจมีรหัสลูกค้า) — เหลือ path */
function stripQuery(url: string): string {
  const at = url.indexOf("?");
  return at === -1 ? url : url.slice(0, at);
}

function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
  const url: unknown = breadcrumb.data?.url;
  if (typeof url === "string") breadcrumb.data = { ...breadcrumb.data, url: stripQuery(url) };
  return breadcrumb;
}

/** ตัวกรองก่อนส่งทุก event — ตัด request (URL/body) และผู้ใช้ทิ้ง ปิดบังข้อความทุกส่วนที่เป็นสตริง */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  delete event.request;
  delete event.user;
  if (event.message) event.message = scrubText(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  return event;
}

/** เปิด Sentry ถ้ามี DSN — ไม่มี = ไม่ทำอะไร */
export async function initErrorTracking(): Promise<void> {
  const dsn: unknown = import.meta.env.VITE_SENTRY_DSN;
  if (typeof dsn !== "string" || dsn === "") return;
  const configured: unknown = import.meta.env.VITE_SENTRY_ENVIRONMENT;
  const environment = typeof configured === "string" && configured !== "" ? configured : import.meta.env.MODE;
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0,
    // ตัด tracing และ Replay ออกจากค่าเริ่มต้นของไลบรารี แม้มีมาให้โดยอัตโนมัติ
    integrations: (defaults) => defaults.filter((i) => i.name !== "BrowserTracing" && i.name !== "Replay"),
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

/** รายงาน error ที่ React จับเองไม่ได้ (onUncaughtError) — ยังไม่เปิด Sentry = ไม่ทำอะไร */
export function reportError(error: unknown): void {
  const dsn: unknown = import.meta.env.VITE_SENTRY_DSN;
  if (typeof dsn !== "string" || dsn === "") return;
  void import("@sentry/react").then((Sentry) => Sentry.captureException(error));
}
