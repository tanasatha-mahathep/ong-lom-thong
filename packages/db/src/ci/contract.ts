import { basename } from "node:path";
import type { Entry } from "./fingerprint";

/**
 * Expand–contract lint for migrations that are not deployed anywhere yet.
 *
 * Railway runs the migrations in pre-deploy while the previous release still serves traffic, and a
 * rollback runs the previous release on the new schema. So a release may only *expand* the schema;
 * dropping, renaming or narrowing what the previous release reads or writes ("contract") belongs in
 * a later release, once no running code uses it. Rewriting existing rows (UPDATE/DELETE/TRUNCATE)
 * changes stored money and tax documents in every environment at once. A new CHECK/UNIQUE/FK on
 * columns that already hold data can fail the deploy on rows CI never sees (production's).
 *
 * A deliberate exception is acknowledged in the new migration itself, reviewed with the PR:
 *   -- db-verify: allow contract <why the previous release no longer uses it>
 *   -- db-verify: allow data-change <why rewriting these rows is correct>
 */

export type Category = "contract" | "data-change";

export interface Finding {
  category: Category;
  message: string;
}

const MARKER = /^[ \t]*--[ \t]*db-verify:[ \t]*allow[ \t]+(contract|data-change)\b[ \t]*(.*)$/gim;

/** Acknowledged categories with their reasons (a marker without a reason does not count). */
export function markers(files: { name: string; sql: string }[]): Map<Category, string> {
  const found = new Map<Category, string>();
  for (const { name, sql } of files) {
    for (const m of sql.matchAll(MARKER)) {
      const reason = (m[2] ?? "").trim();
      if (reason) found.set(m[1] as Category, `${basename(name)}: ${reason}`);
    }
  }
  return found;
}

const attr = (e: Entry | undefined, name: string) =>
  e?.attrs.find((a) => a.startsWith(`${name} `))?.slice(name.length + 1);

/** `schema.table.column` → `schema.table` (identifiers are %I-quoted, so a dot is a separator). */
const tableOf = (columnKey: string) => columnKey.slice(0, columnKey.lastIndexOf("."));

const RELATIONS = new Set(["table", "view", "materialized view", "foreign table"]);
const ROUTINES = new Set(["function", "procedure", "aggregate", "window function"]);

/** Schema changes between two catalogs that code written for `before` cannot survive. */
export function contractFindings(before: Entry[], after: Entry[]): Finding[] {
  const id = (e: Entry) => `${e.kind}\u0000${e.key}`;
  const now = new Map(after.map((e) => [id(e), e]));
  const was = new Map(before.map((e) => [id(e), e]));
  const findings: Finding[] = [];
  const add = (message: string) => findings.push({ category: "contract", message });
  const goneRelations = new Set<string>();

  for (const e of before) {
    const next = now.get(id(e));
    if (RELATIONS.has(e.kind) && !next) {
      goneRelations.add(e.key);
      add(`drops or renames ${e.kind} ${e.key}`);
    } else if (ROUTINES.has(e.kind) && !next) {
      add(`drops or changes the signature of ${e.kind} ${e.key}`);
    } else if (e.kind === "enum") {
      if (!next) add(`drops or renames enum ${e.key}`);
      else {
        const labels = (x: Entry) => new Set((attr(x, "labels") ?? "").split(", "));
        const removed = [...labels(e)].filter((l) => !labels(next).has(l));
        if (removed.length) add(`removes value(s) ${removed.join(", ")} from enum ${e.key}`);
      }
    } else if (e.kind === "column" && !goneRelations.has(tableOf(e.key))) {
      if (!next) add(`drops or renames column ${e.key}`);
      else {
        if (attr(e, "type") !== attr(next, "type")) {
          add(`changes the type of ${e.key}: ${attr(e, "type")} → ${attr(next, "type")}`);
        }
        if (attr(e, "not null") === "false" && attr(next, "not null") === "true") add(`makes ${e.key} NOT NULL`);
      }
    }
  }
  // columns that already existed, per table: a new constraint that reads one of them judges old rows
  const oldColumns = new Map<string, string[]>();
  for (const e of before) {
    if (e.kind !== "column") continue;
    const table = tableOf(e.key);
    oldColumns.set(table, [...(oldColumns.get(table) ?? []), e.key.slice(table.length + 1)]);
  }
  const readsOldColumn = (table: string, definition: string) =>
    (oldColumns.get(table) ?? []).some((name) =>
      name.startsWith('"')
        ? definition.includes(name)
        : new RegExp(`\\b${name.replace(/[$]/g, "\\$&")}\\b`).test(definition),
    );
  for (const e of after) {
    if (was.has(id(e))) continue;
    if (e.kind === "column" && was.has(`table\u0000${tableOf(e.key)}`)) {
      const required = attr(e, "not null") === "true" && attr(e, "default") === "-";
      if (required && attr(e, "identity") === "-" && attr(e, "generated") === "-") {
        add(`adds NOT NULL column ${e.key} without a default to existing table ${tableOf(e.key)}`);
      }
    } else if (e.kind === "constraint" && /^type [cufpx]$/m.test(e.attrs.join("\n"))) {
      const table = tableOf(e.key);
      const definition = attr(e, "definition") ?? "";
      // FK/UNIQUE/PK judge only their own column list (a FK's REFERENCES side is another table)
      const judged =
        /^(?:FOREIGN KEY|UNIQUE(?: NULLS NOT DISTINCT)?|PRIMARY KEY) \(([^)]*)\)/.exec(definition)?.[1] ?? definition;
      if (was.has(`table\u0000${table}`) && readsOldColumn(table, judged)) {
        add(`adds constraint ${e.key} (${definition}) — rows already in ${table} in every environment must satisfy it`);
      }
    }
  }
  return findings;
}

/**
 * The SQL with comments, string/identifier literals and dollar-quoted bodies blanked out, so that
 * statement keywords can be read without being fooled by text inside a function body or a comment.
 */
export function stripSql(sql: string): string {
  return strip(sql).text;
}

/** Like stripSql, but dollar-quoted bodies become `$body<n>$` placeholders and are returned. */
function strip(sql: string): { text: string; bodies: string[] } {
  const bodies: string[] = [];
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else i++;
      }
      out += " ";
    } else if (c === "'" || c === '"') {
      const escapes = c === "'" && /(^|[^A-Za-z0-9_$])[eE]$/.test(out); // E'…' allows backslash escapes
      i++;
      while (i < sql.length) {
        if (escapes && sql[i] === "\\") i += 2;
        else if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
      out += c === '"' ? '"x"' : "''";
    } else if (c === "$") {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (!tag) {
        out += c;
        i++;
        continue;
      }
      const close = sql.indexOf(tag[0], i + tag[0].length);
      const end = close === -1 ? sql.length : close;
      bodies.push(sql.slice(i + tag[0].length, end));
      i = close === -1 ? sql.length : close + tag[0].length;
      out += ` $body${bodies.length - 1}$ `;
    } else {
      out += c;
      i++;
    }
  }
  return { text: out, bodies };
}

const REWRITES = /^(UPDATE|DELETE|TRUNCATE|MERGE)\b/i;

/** Statements that rewrite existing rows. INSERT is additive (reference data) and allowed. */
export function dataChangeFindings(name: string, sql: string): Finding[] {
  const findings: Finding[] = [];
  const { text: stripped, bodies } = strip(sql);
  for (const statement of stripped.split(";")) {
    const text = statement.trim().replace(/\s+/g, " ");
    if (!text) continue;
    const cte = /^WITH\b/i.test(text) && /\b(UPDATE|DELETE|MERGE)\b/i.test(text);
    // DO runs its body once, now (CREATE FUNCTION only defines one): look inside it
    const body = /^DO\b.*\$body(\d+)\$/i.exec(text);
    const doRewrites = !!body && /\b(UPDATE|DELETE|TRUNCATE|MERGE)\b/i.test(stripSql(bodies[Number(body[1])] ?? ""));
    if (REWRITES.test(text) || cte || doRewrites) {
      findings.push({ category: "data-change", message: `${basename(name)}: ${text.slice(0, 120)}` });
    }
  }
  return findings;
}
