import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppliedMigration } from "./fingerprint";

/**
 * drizzle-kit's migration history (meta/_journal.json + <tag>.sql + meta/<prefix>_snapshot.json)
 * and what drizzle-orm's runner does with it. The runner (pg-core dialect.migrate) applies an entry
 * only when `entry.when` is greater than the newest `created_at` it has recorded, and never checks
 * hashes — so an edited old file, or a new entry whose `when` is not the largest, is silently skipped
 * on an existing database while a fresh one applies it. The checks below turn those into errors.
 */

export interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const ZERO_ID = "00000000-0000-0000-0000-000000000000";

function isEntry(value: unknown): value is JournalEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.idx === "number" &&
    typeof e.version === "string" &&
    typeof e.when === "number" &&
    typeof e.tag === "string" &&
    typeof e.breakpoints === "boolean"
  );
}

export function parseJournal(text: string, source: string): Journal {
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) throw new Error(`${source}: not a JSON object`);
  const j = raw as Record<string, unknown>;
  if (typeof j.version !== "string" || typeof j.dialect !== "string" || !Array.isArray(j.entries)) {
    throw new Error(`${source}: expected { version, dialect, entries[] }`);
  }
  const entries = j.entries as unknown[];
  entries.forEach((e, i) => {
    if (!isEntry(e)) throw new Error(`${source}: entry ${i} is not { idx, version, when, tag, breakpoints }`);
  });
  return { version: j.version, dialect: j.dialect, entries: entries as JournalEntry[] };
}

export function readJournal(migrationsFolder: string): Journal {
  const path = join(migrationsFolder, "meta", "_journal.json");
  return parseJournal(readFileSync(path, "utf8"), path);
}

/** The rows drizzle's runner writes to drizzle.__drizzle_migrations for this folder, in order. */
export function expectedApplied(migrationsFolder: string): AppliedMigration[] {
  return readJournal(migrationsFolder).entries.map((e) => {
    // same bytes → same hash as drizzle-orm/migrator readMigrationFiles (sha256 of the file text)
    const text = readFileSync(join(migrationsFolder, `${e.tag}.sql`)).toString();
    return { hash: createHash("sha256").update(text).digest("hex"), createdAt: String(e.when) };
  });
}

/** The fields the runner and drizzle-kit read, in a fixed order (JSON key order is not significant). */
const entryText = (e: JournalEntry) =>
  JSON.stringify({ idx: e.idx, version: e.version, when: e.when, tag: e.tag, breakpoints: e.breakpoints });

const snapshotFile = (tag: string) => `${tag.split("_")[0]}_snapshot.json`;

function readSnapshotIds(path: string): { id: string; prevId: string } {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const s = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return { id: typeof s.id === "string" ? s.id : "", prevId: typeof s.prevId === "string" ? s.prevId : "" };
}

/** HEAD's history on its own: idx/tag/when order, SQL + snapshot per entry, no orphans, one chain. */
export function headProblems(headFolder: string): string[] {
  const problems: string[] = [];
  const head = readJournal(headFolder);

  head.entries.forEach((e, i) => {
    if (e.idx !== i) problems.push(`journal entry ${i} (${e.tag}) has idx ${e.idx}`);
    // the Dockerfile copies packages/db/migrations only: a tag that points elsewhere is missing in production
    if (!/^[A-Za-z0-9_-]+$/.test(e.tag)) problems.push(`journal entry ${i} has tag "${e.tag}" — not a plain file name`);
    else if (/^\d{4}_/.test(e.tag) && Number(e.tag.slice(0, 4)) !== i) {
      problems.push(`journal entry ${i} has tag ${e.tag} — its number does not match its position`);
    }
    const prev = head.entries[i - 1];
    if (prev && e.when <= prev.when) {
      problems.push(
        `journal entry ${i} (${e.tag}) has when=${e.when} <= ${prev.when} of ${prev.tag} — drizzle's runner would ` +
          `skip it on every database that already applied ${prev.tag} (regenerate it with pnpm db:generate)`,
      );
    }
    if (!existsSync(join(headFolder, `${e.tag}.sql`))) problems.push(`journal entry ${e.tag} has no ${e.tag}.sql`);
  });

  const tags = new Set(head.entries.map((e) => e.tag));
  for (const file of readdirSync(headFolder)) {
    if (file.endsWith(".sql") && !tags.has(file.slice(0, -".sql".length))) {
      problems.push(`${file} is not in meta/_journal.json — the runner never applies it`);
    }
  }

  // snapshot chain: each generate links to the previous snapshot; a fork means two branches generated
  // from the same parent and were merged without regenerating
  const metaDir = join(headFolder, "meta");
  const expectedSnapshots = new Set(head.entries.map((e) => snapshotFile(e.tag)));
  for (const file of readdirSync(metaDir)) {
    if (file.endsWith("_snapshot.json") && !expectedSnapshots.has(file)) {
      problems.push(`meta/${file} does not belong to any journal entry`);
    }
  }
  let prevId = ZERO_ID;
  const seen = new Set<string>();
  for (const e of head.entries) {
    const path = join(metaDir, snapshotFile(e.tag));
    if (!existsSync(path)) {
      problems.push(`journal entry ${e.tag} has no meta/${snapshotFile(e.tag)}`);
      continue;
    }
    const s = readSnapshotIds(path);
    if (s.prevId !== prevId) {
      problems.push(
        `meta/${snapshotFile(e.tag)} prevId ${s.prevId} should be ${prevId} — the snapshot chain forks ` +
          `(two branches generated migrations from the same parent: regenerate on top of dev)`,
      );
    }
    if (seen.has(s.id)) problems.push(`meta/${snapshotFile(e.tag)} reuses snapshot id ${s.id}`);
    seen.add(s.id);
    prevId = s.id;
  }
  return problems;
}

/** A deployed journal (production tag, an environment's branch) must be an exact prefix of HEAD's. */
export function baseProblems(head: Journal, base: Journal, label: string): string[] {
  const problems: string[] = [];
  if (base.dialect !== head.dialect) problems.push(`journal dialect changed: ${base.dialect} → ${head.dialect}`);
  if (head.entries.length < base.entries.length) {
    problems.push(
      `journal has ${head.entries.length} entries but ${label} already deployed ${base.entries.length} — entries were removed`,
    );
  }
  base.entries.forEach((b, i) => {
    const h = head.entries[i];
    if (!h || entryText(h) !== entryText(b)) {
      problems.push(
        `journal entry ${i} differs from ${label} (deployed entries are immutable):\n` +
          `    ${label}: ${entryText(b)}\n    HEAD: ${h ? entryText(h) : "(missing)"}`,
      );
    }
  });
  return problems;
}

/**
 * How many of HEAD's leading journal entries some environment already runs: the longest common
 * prefix with any deployed journal (a branch behind dev shares dev's first entries, too).
 */
export function deployedPrefix(head: Journal, bases: Journal[]): number {
  let n = 0;
  for (const base of bases) {
    let common = 0;
    while (
      common < head.entries.length &&
      common < base.entries.length &&
      entryText(head.entries[common]!) === entryText(base.entries[common]!)
    ) {
      common++;
    }
    n = Math.max(n, common);
  }
  return n;
}
