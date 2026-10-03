import * as Sentry from "@sentry/node";

/**
 * เลขยาว 9 หลักขึ้นไป — เลขบัตรประชาชน 13 หลัก (ติดกันหรือมีขีด/เว้นวรรคตามหน้าบัตร) และเบอร์โทร
 * ปิดบังก่อนส่งออกนอกเซิร์ฟเวอร์ (PDPA · R13) · เลขสั้นอย่างรหัสสถานะ HTTP ไม่ถูกแตะ
 */
const LONG_DIGITS = /\d(?:[\s-]?\d){8,}/g;
const REDACTED = "[ตัวเลขยาว]";

export function scrubText(text: string): string {
  return text.replace(LONG_DIGITS, REDACTED);
}

/** ปิดบังทุกสตริงในโครงสร้าง (extra) — ตัวเลขอื่นที่ไม่ใช่สตริงไม่ถูกแตะ */
function scrubValue(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(scrubValue);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, scrubValue(inner)]));
  }
  return value;
}

/** breadcrumb ของ HTTP ตัด query string ออก (อาจมีเลขบัตร/รหัสบิลในนั้น) — เหลือแค่ path */
function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  if (breadcrumb.message) breadcrumb.message = scrubText(breadcrumb.message);
  const url: unknown = breadcrumb.data?.url;
  if (typeof url === "string") breadcrumb.data = { ...breadcrumb.data, url: url.split("?")[0] };
  return breadcrumb;
}

/** ตัวกรองก่อนส่งทุก event — ไม่มี request/ผู้ใช้ และปิดบังข้อความทุกส่วนที่เป็นสตริง */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  // body · query · cookie ของ request มีข้อมูลลูกค้า — ไม่ส่งเลย
  delete event.request;
  delete event.user;
  if (event.message) event.message = scrubText(event.message);
  if (event.logentry?.message) event.logentry.message = scrubText(event.logentry.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb);
  if (event.extra) event.extra = scrubValue(event.extra) as Record<string, unknown>;
  return event;
}

/**
 * เปิด Sentry เมื่อมี SENTRY_DSN เท่านั้น — ไม่มี = ไม่ส่งอะไร (dev/test)
 * คืน true เมื่อเปิดจริง
 */
export function initSentry({ dsn, environment }: { dsn: string | undefined; environment: string }): boolean {
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment,
    // เก็บเฉพาะ error ไม่เก็บ performance trace
    // (IP/ผู้ใช้ ตัดใน scrubEvent — v11 ไม่มี option sendDefaultPii แล้ว)
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  return true;
}

/** รายงาน error ที่ไม่คาดคิด — ต้องส่งค่าที่ผ่าน loggableError (lib/log.ts) แล้วเท่านั้น · ไม่ตั้ง DSN = no-op */
export function captureError(err: unknown): void {
  Sentry.captureException(err);
}

/** ส่ง event ที่ค้างให้จบก่อน process ปิด (รอไม่เกิน 2 วินาที) */
export function closeSentry(): Promise<boolean> {
  return Sentry.close(2_000);
}
