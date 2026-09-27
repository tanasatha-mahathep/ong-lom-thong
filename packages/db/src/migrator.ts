import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** รัน migrations ที่ยังไม่เคยรัน (drizzle จดไว้ใน __drizzle_migrations) — เรียกซ้ำได้ */
export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const client = postgres(url, {
    max: 1,
    // NOTICE ของ "IF NOT EXISTS" ไม่ใช่ข้อผิดพลาด — ไม่ต้องพิมพ์ลง log ของ deploy
    onnotice: () => {},
    // DDL รอ lock นานเกิน = ล้มเลย (exit 1 → Railway ไม่สลับ deploy) แทนการค้างและทำให้ query ของแอปต่อคิว
    connection: { lock_timeout: "10s" },
  });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
