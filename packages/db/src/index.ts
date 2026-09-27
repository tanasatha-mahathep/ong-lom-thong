import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url: string = requireEnv("DATABASE_URL")) {
  // postgres.js คืน numeric เป็น string → เข้า decimal.js ได้ตรง ไม่ผ่าน float
  const client = postgres(url, { max: 10, prepare: false });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`missing env ${key}`);
  return v;
}

export { schema };
export * from "./schema";
