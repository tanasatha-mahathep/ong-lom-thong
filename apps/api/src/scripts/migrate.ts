import { fileURLToPath } from "node:url";
import { runMigrations } from "@ong/db";

// ใน image: dist/migrate.js → /app/migrations (Dockerfile คัดลอก packages/db/migrations มาไว้)
// Railway เรียกเป็น preDeployCommand ก่อนสลับ deploy ใหม่ทุกครั้ง
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");

const folder = process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL("../migrations", import.meta.url));
await runMigrations(url, folder);
console.log(`migrations applied from ${folder}`);
