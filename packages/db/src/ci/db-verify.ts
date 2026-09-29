import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { contractFindings, dataChangeFindings, type Finding, markers } from "./contract";
import {
  type Entry,
  appliedMigrations,
  catalogEntries,
  dataFingerprint,
  dropAppCode,
  renderRoutines,
  renderSchema,
  renderStructure,
  routineFingerprint,
  schemaFingerprint,
} from "./fingerprint";
import { baseProblems, deployedPrefix, expectedApplied, headProblems, parseJournal, readJournal } from "./journal";

/**
 * Database steps of scripts/ci/db-verify.sh (run with tsx). The shell script owns the flow and the
 * PASS/FAIL verdicts; each command here does one thing and exits non-zero with a message on failure.
 *
 * Databases are addressed by name on the server of TEST_DATABASE_URL (admin connection), so
 * connection strings with passwords never appear in argv or in the log. Product code (schema,
 * migrator, seed) is imported only by the commands that run it, so a broken seed cannot make
 * `ping` or `history` fail.
 *
 *   ping                                   server reachable? prints its version
 *   create <db>  |  drop <db>...           scratch databases (template0, DROP … WITH (FORCE))
 *   url <db>                               connection string for tools that read DATABASE_URL
 *   migrate <db> <folder> [--entries N]    runMigrations() — the code Railway's pre-deploy runs
 *                                          (--entries: only the journal's first N entries)
 *   seed <db>                              seedReferenceData() — the pre-deploy seed outside production
 *   snapshot <db> <prefix>                 <prefix>.schema.txt · .structure.txt · .data.txt ·
 *                                          .applied.txt · .entries.json
 *   applied <db> <folder> [--when-only]    bookkeeping rows = the folder's journal: every entry once,
 *                                          in order, with the file's sha256 (unless --when-only)
 *   history <folder> [<label>=<journal>…]  journal/snapshot integrity; every deployed journal is a
 *                                          prefix; prints "deployed <N>" (entries already deployed)
 *   canonical <db> <sql-file> <prefix>     re-apply the canonical plpgsql file inside rolled-back
 *                                          transactions: .before/.after (whole schema) and
 *                                          .deployed/.from-file (routines and triggers only)
 *   contract [--report] <before.entries.json> <after.entries.json> [<new migration.sql>…]
 *                                          expand–contract findings (see contract.ts); exit 1 when
 *                                          one is not acknowledged, unless --report
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

const readEntries = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Entry[];

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
      const { runMigrations } = await import("../migrator");
      const url = urlFor(dbName(rest[0]));
      const folder = arg(rest[1], "migrations folder");
      if (rest[2] !== "--entries") {
        await runMigrations(url, folder);
        return 0;
      }
      // a copy whose journal stops after N entries: the database as an older release left it
      const n = Number(arg(rest[3], "entry count"));
      const copy = mkdtempSync(join(tmpdir(), "db-verify-prefix-"));
      try {
        cpSync(folder, copy, { recursive: true });
        const journal = readJournal(copy);
        writeFileSync(
          join(copy, "meta", "_journal.json"),
          JSON.stringify({ ...journal, entries: journal.entries.slice(0, n) }),
        );
        await runMigrations(url, copy);
      } finally {
        rmSync(copy, { recursive: true, force: true });
      }
      return 0;
    }
    case "seed": {
      const { createDb } = await import("../index");
      const { seedReferenceData } = await import("../seedData");
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
          const entries = await catalogEntries(tx);
          writeFileSync(`${prefix}.schema.txt`, renderSchema(entries));
          writeFileSync(`${prefix}.structure.txt`, renderStructure(entries));
          writeFileSync(`${prefix}.entries.json`, JSON.stringify(entries));
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
      const entries = readJournal(folder).entries;
      // name each row by what it is (its `when`), not by where it sits
      const label = (createdAt: string) =>
        entries.find((e) => String(e.when) === createdAt)?.tag ?? `unknown entry when=${createdAt}`;
      const problems: string[] = [];
      const n = Math.max(expected.length, actual.length);
      for (let i = 0; i < n; i++) {
        const want = expected[i];
        const got = actual[i];
        if (!want) problems.push(`unexpected bookkeeping row: ${label(got?.createdAt ?? "?")} sha256=${got?.hash}`);
        else if (!got) problems.push(`${entries[i]?.tag} was never applied (when=${want.createdAt})`);
        else if (got.createdAt !== want.createdAt) {
          problems.push(
            `position ${i}: expected ${entries[i]?.tag} (when=${want.createdAt}), found ${label(got.createdAt)}`,
          );
        } else if (!whenOnly && got.hash !== want.hash) {
          problems.push(`${entries[i]?.tag} was applied from different SQL (sha256 ${got.hash}, file ${want.hash})`);
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
      const head = readJournal(folder);
      const problems = headProblems(folder);
      const bases = rest.slice(1).map((spec) => {
        const at = spec.indexOf("=");
        if (at < 1) throw new UsageError(`expected <label>=<journal file>, got ${spec}`);
        const file = spec.slice(at + 1);
        return { label: spec.slice(0, at), journal: parseJournal(readFileSync(file, "utf8"), file) };
      });
      for (const { label, journal } of bases) problems.push(...baseProblems(head, journal, label));
      for (const p of problems) console.error(p);
      console.log(
        `deployed ${deployedPrefix(
          head,
          bases.map((b) => b.journal),
        )}`,
      );
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
            await dropAppCode(tx);
            await tx.unsafe(text);
            return renderRoutines(await catalogEntries(tx));
          }),
        );
      });
      return 0;
    }
    case "contract": {
      const report = rest[0] === "--report";
      const args = report ? rest.slice(1) : rest;
      const before = readEntries(arg(args[0], "before entries"));
      const after = readEntries(arg(args[1], "after entries"));
      const files = args.slice(2).map((name) => ({ name, sql: readFileSync(name, "utf8") }));
      const findings: Finding[] = [
        ...contractFindings(before, after),
        ...files.flatMap((f) => dataChangeFindings(f.name, f.sql)),
      ];
      const allowed = markers(files);
      let open = 0;
      for (const f of findings) {
        const reason = allowed.get(f.category);
        if (!reason) open++;
        console.log(`${f.category}: ${f.message}${reason ? `  [acknowledged — ${reason}]` : ""}`);
      }
      return open && !report ? 1 : 0;
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
    // connection errors can carry an empty message and only a code (ECONNREFUSED)
    console.error(`${depth ? "  caused by: " : "db-verify: "}${pg.message || pg.code || pg.name}`);
    for (const field of ["code", "detail", "hint", "where"] as const) {
      if (pg[field]) console.error(`    ${field}: ${pg[field]}`);
    }
  }
  const codes = new Set(["CONNECT_TIMEOUT", "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "57P03", "53300"]);
  const code = (e as { code?: string }).code;
  if (code && codes.has(code)) console.error(`db-verify: cannot reach PostgreSQL (${code}) — an environment problem`);
  process.exitCode = e instanceof UsageError ? 2 : 1;
}
