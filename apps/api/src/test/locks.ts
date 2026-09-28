import type { Db } from "@ong/db";
import { sql } from "drizzle-orm";

/**
 * รอจนมี query ใน database นี้ (ของเทสต์ไฟล์นี้เท่านั้น) ติดรอ lock อย่างน้อย `count` ตัว — ใช้พิสูจน์ว่าคำขอที่ทำพร้อมกัน
 * รอกันจริง ไม่ใช่แค่บังเอิญวิ่งทีละคำขอ
 */
export async function waitForLockWait(db: Db, count = 1, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((row?.n ?? 0) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("ไม่มี query ไหนรอ lock ภายในเวลาที่กำหนด");
}

/** connection แยกที่เปิดทรานแซกชันค้างไว้ — จำลองผู้ดูแลอีกคน/สคริปต์ที่กำลังเขียนอยู่พร้อมกัน */
export async function openTransaction(db: Db) {
  const conn = await db.$client.reserve();
  await conn`begin`;
  return {
    sql: conn,
    async commit() {
      await conn`commit`;
      conn.release();
    },
  };
}
