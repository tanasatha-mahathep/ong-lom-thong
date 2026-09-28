import type { Db } from "@ong/db";

/** db หรือทรานแซกชันที่เปิดอยู่ — ฟังก์ชันตรวจที่ใช้ได้ทั้งก่อนและในทรานแซกชัน */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** error ของงานผู้ดูแล (สาขา · ผู้ใช้) ที่ route แปลงเป็น HTTP ตรง ๆ — ข้อความภาษาไทยชี้ช่อง (spec §5) */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly field: string | undefined,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

/** ไม่มี / id ผิดรูป ตอบเหมือนกัน */
export const notFound = () => new AdminError("not found", undefined, 404);

type Plain = string | number | boolean | null | readonly string[];

/** ช่องที่ค่าเปลี่ยน → { ช่อง: { before, after } } สำหรับ audit_log.diff (R12) · ไม่เปลี่ยนเลย = {} */
export function changedFields<T extends Record<string, Plain>>(before: T, after: T) {
  const same = (a: Plain, b: Plain) => JSON.stringify(a) === JSON.stringify(b);
  return Object.fromEntries(
    Object.keys(after)
      .filter((k) => !same(before[k] as Plain, after[k] as Plain))
      .map((k) => [k, { before: before[k], after: after[k] }]),
  ) as Partial<Record<keyof T, { before: Plain; after: Plain }>>;
}
