/**
 * error ในรูปที่ลง log ได้ — ห้ามมีข้อมูลลูกค้า (PDPA · R13)
 * DrizzleQueryError ต่อค่า params ของ query ไว้ท้าย message (snapshot ลูกค้า: เลขบัตร · ชื่อ · เบอร์)
 * และ error ของ Postgres มี detail ("Failing row contains (…)") ที่มีทั้งแถว
 * → error ที่มาจาก query (มี params/parameters) log เฉพาะ SQL ที่ไม่มีค่า + code/message ของ Postgres
 */
export function loggableError(err: unknown): unknown {
  if (typeof err !== "object" || err === null || !("params" in err || "parameters" in err)) return err;
  const e = err as { name?: unknown; query?: unknown; message?: unknown; code?: unknown; cause?: unknown };
  const cause =
    typeof e.cause === "object" && e.cause !== null ? (e.cause as { code?: unknown; message?: unknown }) : null;
  return {
    error: typeof e.name === "string" ? e.name : "Error",
    query: typeof e.query === "string" ? e.query : undefined,
    code: cause ? cause.code : e.code,
    // message ของ DrizzleQueryError มีค่า params — ใช้ของ Postgres (cause) · error ของ postgres.js เองไม่มีค่าใน message
    message: cause ? cause.message : "params" in e ? undefined : e.message,
  };
}
