/** ส่วนที่ปลอดภัยของ error จาก Postgres — code · ชื่อ constraint · ข้อความของเซิร์ฟเวอร์ (ไม่มีค่าของแถว) */
export interface PgErrorInfo {
  code: string;
  constraintName: string | null;
  message: string;
}

/** error ของ postgres.js ตรง ๆ หรือที่ห่อด้วย DrizzleQueryError (อยู่ใน cause) — ไม่ใช่ error ของ DB = null */
export function pgError(e: unknown): PgErrorInfo | null {
  for (let cur: unknown = e, depth = 0; cur && depth < 3; depth++) {
    const err = cur as { code?: unknown; constraint_name?: unknown; message?: unknown; cause?: unknown };
    if (typeof err.code === "string") {
      return {
        code: err.code,
        constraintName: typeof err.constraint_name === "string" ? err.constraint_name : null,
        message: typeof err.message === "string" ? err.message : "",
      };
    }
    cur = err.cause;
  }
  return null;
}

/** ชื่อ constraint ที่ชน (unique_violation 23505) · ไม่ใช่การชน = null */
export function uniqueViolation(e: unknown): string | null {
  const pg = pgError(e);
  return pg?.code === "23505" ? (pg.constraintName ?? "") : null;
}

/**
 * error จากการเขียนที่มีค่าลับ (hash รหัสผ่าน) — DrizzleQueryError ต่อ params ไว้ท้าย message
 * และ detail ของ Postgres มีค่าทั้งแถว → โยนต่อเฉพาะ code/constraint/ข้อความของเซิร์ฟเวอร์
 * error ที่ไม่ได้มาจาก query (เช่น AdminError) คืนตัวเดิม
 */
export function withoutQueryValues(e: unknown, operation: string): unknown {
  const fromQuery = typeof e === "object" && e !== null && ("params" in e || "parameters" in e);
  const pg = pgError(e);
  if (!pg && !fromQuery) return e;
  const where = pg ? ` (${pg.code}${pg.constraintName ? ` ${pg.constraintName}` : ""}): ${pg.message}` : "";
  return new Error(`${operation} failed${where}`);
}
