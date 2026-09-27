import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");

await runMigrations(url, fileURLToPath(new URL("../migrations", import.meta.url)));
console.log("migrations applied");
