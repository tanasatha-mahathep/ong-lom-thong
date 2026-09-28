import { readFileSync, writeFileSync } from "node:fs";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { createDb } from "../index";
import { runMigrations } from "../migrator";
import { seedReferenceData } from "../seedData";
import {
  appliedMigrations,
  dataFingerprint,
  dropAppRoutines,
  routineFingerprint,
  schemaFingerprint,
} from "./fingerprint";
import { expectedApplied, historyProblems, parseJournal } from "./journal";

/**
 * Database steps of scripts/ci/db-verify.sh (run with tsx). The shell script owns the flow and the
 * PASS/FAIL verdicts; each command here does one thing and exits non-zero with a message on failure.
 *
 * Databases are addressed by name on the server of TEST_DATABASE_URL (admin connection), so
 * connection strings with passwords never appear in argv or in the log.
 *
 *   ping                               server reachable? prints its version
 *   create <db>  |  drop <db>...       scratch databases (template0, DROP … WITH (FORCE))
 *   url <db>                           connection string for tools that read DATABASE_URL
 *   migrate <db> <folder>              runMigrations() — the code Railway's pre-deploy runs
 *   seed <db>                          seedReferenceData() — the pre-deploy seed outside production
 *   snapshot <db> <prefix>             <prefix>.schema.txt · .data.txt · .applied.txt
 *   applied <db> <folder> [--when-only] bookkeeping rows = the folder's journal: every entry once,
 *                                      in order, with the file's sha256 (unless --when-only)
 *   history <folder> [<base-journal>]  journal/snapshot integrity (+ base journal is a prefix)
 *   canonical <db> <sql-file> <prefix> re-apply the canonical plpgsql file inside rolled-back
 *                                      transactions: .before/.after (whole schema) and
 *                                      .deployed/.from-file (routines and triggers only)
 */

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://ong:ong@localhost:5432/postgres";
const DB_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

class UsageError extends Error {}

function dbName(value: string | undefined): string {
  if (!value || !DB_NAME.test(value)) throw new UsageError(`invalid database name: ${value ?? "(missing)"}`);
  return value;
}

function arg(value: string | undefined, what: string): string {
  if (!value) throw new UsageError(`missing ${what}`);
  return value;
}

function urlFor(name: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

function connect(url: string): Sql {
  return postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
}

async function using<T>(url: string, run: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = connect(url);
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** Runs `run` in a transaction that is always rolled back, and returns what it produced. */
async function rolledBack(sql: Sql, run: (tx: TransactionSql) => Promise<string>): Promise<string> {
  let result: string | undefined;
  const ROLLBACK = new Error("rollback");
  try {
    await sql.begin(async (tx) => {
      result = await run(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  if (result === undefined) throw new Error("transaction produced no result");
  return result;
}

const quoteIdent = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "ping": {
      const version = await using(ADMIN_URL, async (sql) => {
        const [row] = await sql<{ v: string }[]>`SELECT current_setting('server_version') AS v`;
        return row?.v ?? "?";
      });
      console.log(`PostgreSQL ${version}`);
      return 0;
    }
    case "create": {
      const name = dbName(rest[0]);
      await using(ADMIN_URL, (sql) => sql.unsafe(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0`));
      return 0;
    }
    case "drop": {
      const names = rest.map(dbName);
      await using(ADMIN_URL, async (sql) => {
        for (const name of names) await sql.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`);
      });
      return 0;
    }
    case "url": {
      console.log(urlFor(dbName(rest[0])));
      return 0;
    }
    case "migrate": {
      await runMigrations(urlFor(dbName(rest[0])), arg(rest[1], "migrations folder"));
      return 0;
    }
    case "seed": {
      const db = createDb(urlFor(dbName(rest[0])));
      try {
        await seedReferenceData(db);
      } finally {
        await db.$client.end({ timeout: 5 });
      }
      return 0;
    }
    case "snapshot": {
      const name = dbName(rest[0]);
      const prefix = arg(rest[1], "output prefix");
      await using(urlFor(name), (sql) =>
        sql.begin("isolation level repeatable read read only", async (tx) => {
          writeFileSync(`${prefix}.schema.txt`, await schemaFingerprint(tx));
          writeFileSync(`${prefix}.data.txt`, await dataFingerprint(tx));
          const applied = await appliedMigrations(tx);
          writeFileSync(`${prefix}.applied.txt`, applied.map((m) => `${m.createdAt} ${m.hash}\n`).join(""));
        }),
      );
      return 0;
    }
    case "applied": {
      const name = dbName(rest[0]);
      const folder = arg(rest[1], "migrations folder");
      const whenOnly = rest[2] === "--when-only";
      const expected = expectedApplied(folder);
      const actual = await using(urlFor(name), (sql) => sql.begin((tx) => appliedMigrations(tx)));
      const tags = parseJournal(readFileSync(`${folder}/meta/_journal.json`, "utf8"), "journal").entries.map(
        (e) => e.tag,
      );
      const problems: string[] = [];
      const n = Math.max(expected.length, actual.length);
      for (let i = 0; i < n; i++) {
        const want = expected[i];
        const got = actual[i];
        const label = tags[i] ?? `row ${i}`;
        if (!want) problems.push(`unexpected bookkeeping row ${got?.createdAt} ${got?.hash} (not in the journal)`);
        else if (!got) problems.push(`${label} was never applied (when=${want.createdAt})`);
        else if (got.createdAt !== want.createdAt || (!whenOnly && got.hash !== want.hash)) {
          problems.push(
            `${label}: applied as when=${got.createdAt} sha256=${got.hash}, ` +
              `file is when=${want.createdAt} sha256=${want.hash}`,
          );
        }
      }
      for (const p of problems) console.error(`  ${p}`);
      if (!problems.length) {
        console.log(`  ${expected.length} journal entries applied exactly once${whenOnly ? "" : ", hashes match"}`);
      }
      return problems.length ? 1 : 0;
    }
    case "history": {
      const folder = arg(rest[0], "migrations folder");
      const baseFile = rest[1];
      const baseLabel = rest[2] ?? "base";
      const base = baseFile ? parseJournal(readFileSync(baseFile, "utf8"), baseFile) : null;
      const problems = historyProblems(folder, base, baseLabel);
      for (const p of problems) console.error(`  ${p}`);
      return problems.length ? 1 : 0;
    }
    case "canonical": {
      const name = dbName(rest[0]);
      const file = arg(rest[1], "sql file");
      const prefix = arg(rest[2], "output prefix");
      const text = readFileSync(file, "utf8");
      await using(urlFor(name), async (sql) => {
        // forward: re-applying the file changes nothing that is deployed
        writeFileSync(`${prefix}.before.txt`, await rolledBack(sql, (tx) => schemaFingerprint(tx)));
        writeFileSync(
          `${prefix}.after.txt`,
          await rolledBack(sql, async (tx) => {
            await tx.unsafe(text);
            return schemaFingerprint(tx);
          }),
        );
        // reverse: the file alone recreates every deployed routine and trigger (nothing only in migrations)
        writeFileSync(`${prefix}.deployed.txt`, await rolledBack(sql, (tx) => routineFingerprint(tx)));
        writeFileSync(
          `${prefix}.from-file.txt`,
          await rolledBack(sql, async (tx) => {
            await dropAppRoutines(tx);
            await tx.unsafe(text);
            return routineFingerprint(tx);
          }),
        );
      });
      return 0;
    }
    default:
      throw new UsageError(`unknown command: ${command ?? "(none)"}`);
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (e) {
  // drizzle wraps PostgreSQL's error in "Failed query: …" — the reason is further down the cause chain
  let err: unknown = e;
  for (let depth = 0; err instanceof Error && depth < 5; depth++, err = err.cause) {
    const pg = err as Error & { code?: string; detail?: string; hint?: string; where?: string };
    console.error(`${depth ? "  caused by: " : "db-verify: "}${pg.message}`);
    for (const field of ["code", "detail", "hint", "where"] as const) {
      if (pg[field]) console.error(`    ${field}: ${pg[field]}`);
    }
  }
  process.exitCode = e instanceof UsageError ? 2 : 1;
}
