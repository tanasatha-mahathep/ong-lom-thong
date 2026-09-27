import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/** รัน migrations ที่ยังไม่เคยรัน (drizzle จดไว้ใน __drizzle_migrations) — เรียกซ้ำได้ */
export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  // NOTICE ของ "IF NOT EXISTS" ไม่ใช่ข้อผิดพลาด — ไม่ต้องพิมพ์ลง log ของ deploy
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
