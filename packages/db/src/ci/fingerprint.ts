import type { TransactionSql } from "postgres";

/**
 * Catalog fingerprint of a database, queried with SQL instead of pg_dump: a CI runner's pg_dump may
 * be older than the server (18) and refuse to run, and a dump carries data and ordering noise.
 *
 * Every line names its object, so `diff -u` of two fingerprints reads on its own:
 *   column public.branch.code | type text
 *   function public.next_doc_no(p_branch uuid, p_prefix text, p_date date) | > BEGIN
 *
 * Covered: schemas · extensions · enums/domains/composite/range types · tables (kind, persistence,
 * RLS, partitioning, inheritance, options, state of the internal FK triggers) · columns (position,
 * type, nullability, default, identity, generated, collation) · constraints · indexes · sequences
 * (not their current value) · views · functions/procedures (pg_get_functiondef) · triggers ·
 * policies · rules · statistics objects · event triggers · default privileges · per-database
 * settings · owners, ACLs and comments. drizzle's own bookkeeping table is left out (compared
 * separately). Not covered: operators, casts, collations, text-search objects, publications —
 * none are used here; add a query before relying on them.
 */

/** Every schema except PostgreSQL's own (the drizzle schema is included: migrations can create objects there). */
const appSchema = (alias: string) =>
  `${alias}.nspname NOT IN ('pg_catalog', 'information_schema') AND ${alias}.nspname NOT LIKE 'pg\\_%'`;
/** drizzle.__drizzle_migrations and its sequence/index/constraints — runner-owned, compared on its own. */
const notBookkeeping = (ns: string, rel: string) =>
  `NOT (${ns}.nspname = 'drizzle' AND coalesce(${rel}, '') LIKE '\\_\\_drizzle\\_migrations%')`;
/** Members of an extension belong to the extension (captured by name + version), not to us. */
const notExtensionMember = (catalog: string, oid: string) =>
  `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = '${catalog}'::regclass AND d.objid = ${oid} AND d.deptype = 'e')`;

export interface Entry {
  kind: string;
  key: string;
  attrs: string[];
  definition: string | null;
}

/** Order of sections in the rendered fingerprint (readability only — lines are sorted within). */
const KIND_ORDER = [
  "database setting",
  "event trigger",
  "extension",
  "default privileges",
  "schema",
  "enum",
  "domain",
  "composite type",
  "range type",
  "multirange type",
  "table",
  "view",
  "materialized view",
  "foreign table",
  "column",
  "constraint",
  "index",
  "sequence",
  "function",
  "procedure",
  "aggregate",
  "window function",
  "trigger",
  "policy",
  "rule",
  "statistics",
];

/** Routines and triggers — the objects that packages/db/sql/functions.sql owns. */
export const ROUTINE_KINDS = new Set([
  "function",
  "procedure",
  "aggregate",
  "window function",
  "trigger",
  "event trigger",
]);

const QUERIES: string[] = [
  // schemas
  `SELECT 'schema' AS kind, format('%I', n.nspname) AS key,
     ARRAY['owner ' || pg_get_userbyid(n.nspowner), 'acl ' || coalesce(n.nspacl::text, '-'),
           'comment ' || coalesce(obj_description(n.oid, 'pg_namespace'), '-')] AS attrs,
     NULL::text AS definition
   FROM pg_namespace n WHERE ${appSchema("n")}`,

  // extensions (members are excluded everywhere else)
  `SELECT 'extension', format('%I', e.extname),
     ARRAY['version ' || e.extversion, 'schema ' || format('%I', n.nspname)], NULL
   FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace`,

  // tables, views, materialized views, foreign tables
  `SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'table' WHEN 'v' THEN 'view'
                         WHEN 'm' THEN 'materialized view' ELSE 'foreign table' END,
     format('%I.%I', n.nspname, c.relname),
     array_remove(ARRAY[
       'relkind ' || c.relkind::text,
       'persistence ' || c.relpersistence::text,
       'owner ' || pg_get_userbyid(c.relowner),
       'acl ' || coalesce(c.relacl::text, '-'),
       'row level security ' || c.relrowsecurity || ' forced ' || c.relforcerowsecurity,
       'replica identity ' || c.relreplident::text,
       'access method ' || coalesce(am.amname, '-'),
       'options ' || coalesce(c.reloptions::text, '-'),
       'comment ' || coalesce(obj_description(c.oid, 'pg_class'), '-'),
       -- FK enforcement lives in internal triggers: ALTER TABLE … DISABLE TRIGGER ALL turns it off
       'internal triggers ' || coalesce((SELECT string_agg(t2.tgenabled::text, '' ORDER BY t2.tgenabled::text)
                                         FROM pg_trigger t2 WHERE t2.tgrelid = c.oid AND t2.tgisinternal), '-'),
       CASE WHEN c.relkind = 'p' THEN 'partition key ' || pg_get_partkeydef(c.oid) END,
       CASE WHEN c.relispartition THEN 'partition bound ' || pg_get_expr(c.relpartbound, c.oid) END,
       (SELECT 'inherits ' || string_agg(format('%I.%I', pn.nspname, pc.relname), ', ' ORDER BY i.inhseqno)
          FROM pg_inherits i JOIN pg_class pc ON pc.oid = i.inhparent
          JOIN pg_namespace pn ON pn.oid = pc.relnamespace WHERE i.inhrelid = c.oid)
     ], NULL),
     CASE WHEN c.relkind IN ('v', 'm') THEN pg_get_viewdef(c.oid, true) END
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   LEFT JOIN pg_am am ON am.oid = c.relam
   WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND ${appSchema("n")} AND ${notBookkeeping("n", "c.relname")}
     AND ${notExtensionMember("pg_class", "c.oid")}`,

  // columns — position is the logical order among live columns (dropped columns leave attnum gaps)
  `SELECT 'column', format('%I.%I.%I', n.nspname, c.relname, a.attname),
     ARRAY[
       'position ' || row_number() OVER (PARTITION BY c.oid ORDER BY a.attnum),
       'type ' || format_type(a.atttypid, a.atttypmod),
       'not null ' || a.attnotnull,
       'default ' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), '-'),
       'identity ' || coalesce(nullif(a.attidentity::text, ''), '-'),
       'generated ' || coalesce(nullif(a.attgenerated::text, ''), '-'),
       'collation ' || CASE WHEN a.attcollation = t.typcollation THEN 'default' ELSE coalesce(format('%I.%I', cn.nspname, co.collname), '-') END,
       'storage ' || a.attstorage::text,
       'compression ' || coalesce(nullif(a.attcompression::text, ''), '-'),
       'acl ' || coalesce(a.attacl::text, '-'),
       'comment ' || coalesce(col_description(c.oid, a.attnum), '-')
     ], NULL
   FROM pg_attribute a
   JOIN pg_class c ON c.oid = a.attrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   JOIN pg_type t ON t.oid = a.atttypid
   LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
   LEFT JOIN pg_collation co ON co.oid = a.attcollation
   LEFT JOIN pg_namespace cn ON cn.oid = co.collnamespace
   WHERE a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
     AND ${appSchema("n")} AND ${notBookkeeping("n", "c.relname")} AND ${notExtensionMember("pg_class", "c.oid")}`,

  // constraints on tables and domains (PG 18 also lists NOT NULL here as contype 'n')
  `SELECT 'constraint', format('%I.%I.%I', n.nspname, coalesce(c.relname, t.typname), con.conname),
     ARRAY['type ' || con.contype::text, 'definition ' || pg_get_constraintdef(con.oid, true),
           'comment ' || coalesce(obj_description(con.oid, 'pg_constraint'), '-')], NULL
   FROM pg_constraint con
   JOIN pg_namespace n ON n.oid = con.connamespace
   LEFT JOIN pg_class c ON c.oid = con.conrelid
   LEFT JOIN pg_type t ON t.oid = con.contypid
   WHERE ${appSchema("n")} AND ${notBookkeeping("n", "c.relname")}`,

  // indexes, including the ones behind primary keys and unique constraints
  `SELECT 'index', format('%I.%I', n.nspname, ic.relname),
     ARRAY['definition ' || pg_get_indexdef(i.indexrelid), 'valid ' || i.indisvalid,
           'clustered ' || i.indisclustered, 'replica identity ' || i.indisreplident,
           'comment ' || coalesce(obj_description(ic.oid, 'pg_class'), '-')], NULL
   FROM pg_index i
   JOIN pg_class ic ON ic.oid = i.indexrelid
   JOIN pg_namespace n ON n.oid = ic.relnamespace
   WHERE ${appSchema("n")} AND ${notBookkeeping("n", "ic.relname")} AND ${notExtensionMember("pg_class", "ic.oid")}`,

  // sequences — definition and owner, never last_value (that is data)
  `SELECT 'sequence', format('%I.%I', n.nspname, c.relname),
     ARRAY[
       'type ' || format_type(s.seqtypid, NULL),
       'start ' || s.seqstart, 'increment ' || s.seqincrement,
       'min ' || s.seqmin, 'max ' || s.seqmax, 'cache ' || s.seqcache, 'cycle ' || s.seqcycle,
       'persistence ' || c.relpersistence::text,
       'owner ' || pg_get_userbyid(c.relowner),
       'acl ' || coalesce(c.relacl::text, '-'),
       'comment ' || coalesce(obj_description(c.oid, 'pg_class'), '-'),
       'owned by ' || coalesce((
         SELECT format('%I.%I.%I', dn.nspname, dc.relname, da.attname) || ' (' || d.deptype::text || ')'
         FROM pg_depend d
         JOIN pg_class dc ON dc.oid = d.refobjid
         JOIN pg_namespace dn ON dn.oid = dc.relnamespace
         JOIN pg_attribute da ON da.attrelid = d.refobjid AND da.attnum = d.refobjsubid
         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid
           AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')), '-')
     ], NULL
   FROM pg_sequence s
   JOIN pg_class c ON c.oid = s.seqrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE ${appSchema("n")} AND ${notBookkeeping("n", "c.relname")} AND ${notExtensionMember("pg_class", "c.oid")}`,

  // enums, domains, standalone composite types, range types (array types are implicit)
  `SELECT CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'd' THEN 'domain' WHEN 'c' THEN 'composite type'
                         WHEN 'r' THEN 'range type' ELSE 'multirange type' END,
     format('%I.%I', n.nspname, t.typname),
     array_remove(ARRAY[
       'owner ' || pg_get_userbyid(t.typowner),
       'acl ' || coalesce(t.typacl::text, '-'),
       'comment ' || coalesce(obj_description(t.oid, 'pg_type'), '-'),
       CASE WHEN t.typtype = 'e' THEN 'labels ' || (
         SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder)
         FROM pg_enum e WHERE e.enumtypid = t.oid) END,
       CASE WHEN t.typtype = 'd' THEN 'base type ' || format_type(t.typbasetype, t.typtypmod) END,
       CASE WHEN t.typtype = 'd' THEN 'not null ' || t.typnotnull END,
       CASE WHEN t.typtype = 'd' THEN 'default ' || coalesce(t.typdefault, '-') END,
       CASE WHEN t.typtype = 'c' THEN 'attributes ' || (
         SELECT string_agg(format('%I %s', a.attname, format_type(a.atttypid, a.atttypmod)), ', ' ORDER BY a.attnum)
         FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) END,
       CASE WHEN t.typtype = 'r' THEN 'subtype ' || (
         SELECT format_type(r.rngsubtype, NULL) FROM pg_range r WHERE r.rngtypid = t.oid) END
     ], NULL), NULL
   FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typtype IN ('e', 'd', 'c', 'r', 'm')
     AND (t.typtype <> 'c' OR (SELECT rc.relkind FROM pg_class rc WHERE rc.oid = t.typrelid) = 'c')
     AND ${appSchema("n")} AND ${notExtensionMember("pg_type", "t.oid")}`,

  // functions and procedures — full text via pg_get_functiondef (aggregates have none)
  `SELECT CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure' WHEN 'a' THEN 'aggregate'
                         ELSE 'window function' END,
     format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
     array_remove(ARRAY[
       'owner ' || pg_get_userbyid(p.proowner),
       'acl ' || coalesce(p.proacl::text, '-'),
       'comment ' || coalesce(obj_description(p.oid, 'pg_proc'), '-'),
       CASE WHEN p.prokind = 'a' THEN (
         SELECT format('aggregate sfunc %s stype %s finalfunc %s initcond %s', ag.aggtransfn,
                       format_type(ag.aggtranstype, NULL), ag.aggfinalfn, coalesce(ag.agginitval, '-'))
         FROM pg_aggregate ag WHERE ag.aggfnoid = p.oid) END
     ], NULL),
     CASE WHEN p.prokind <> 'a' THEN pg_get_functiondef(p.oid) END
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE ${appSchema("n")} AND ${notExtensionMember("pg_proc", "p.oid")}`,

  // triggers written by us (internal ones back foreign keys and carry OIDs in their names)
  `SELECT 'trigger', format('%I.%I.%I', n.nspname, c.relname, tg.tgname),
     ARRAY['definition ' || pg_get_triggerdef(tg.oid, true), 'enabled ' || tg.tgenabled::text,
           'comment ' || coalesce(obj_description(tg.oid, 'pg_trigger'), '-')], NULL
   FROM pg_trigger tg
   JOIN pg_class c ON c.oid = tg.tgrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT tg.tgisinternal AND ${appSchema("n")}`,

  // row level security policies
  `SELECT 'policy', format('%I.%I.%I', n.nspname, c.relname, pol.polname),
     ARRAY[
       'command ' || pol.polcmd::text, 'permissive ' || pol.polpermissive,
       'roles ' || (SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM (
         SELECT CASE WHEN role_oid = 0 THEN 'public' ELSE pg_get_userbyid(role_oid) END AS name
         FROM unnest(pol.polroles) AS role_oid) r),
       'using ' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
       'with check ' || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-')
     ], NULL
   FROM pg_policy pol
   JOIN pg_class c ON c.oid = pol.polrelid
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE ${appSchema("n")}`,

  // rewrite rules other than the ones that implement views
  `SELECT 'rule', format('%I.%I.%I', n.nspname, c.relname, r.rulename),
     ARRAY['enabled ' || r.ev_enabled::text], pg_get_ruledef(r.oid, true)
   FROM pg_rewrite r
   JOIN pg_class c ON c.oid = r.ev_class
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE r.rulename <> '_RETURN' AND ${appSchema("n")}`,

  // extended statistics (CREATE STATISTICS) steer the planner
  `SELECT 'statistics', format('%I.%I', n.nspname, s.stxname),
     ARRAY['definition ' || pg_get_statisticsobjdef(s.oid)], NULL
   FROM pg_statistic_ext s JOIN pg_namespace n ON n.oid = s.stxnamespace
   WHERE ${appSchema("n")}`,

  // ALTER DATABASE … SET / ALTER ROLE … IN DATABASE … SET (timezone, search_path, …) for this database
  `SELECT 'database setting', coalesce(pg_get_userbyid(nullif(s.setrole, 0))::text, 'all roles'),
     ARRAY(SELECT x FROM unnest(s.setconfig) AS x ORDER BY x), NULL
   FROM pg_db_role_setting s
   WHERE s.setdatabase = (SELECT d.oid FROM pg_database d WHERE d.datname = current_database())`,

  // database-wide objects that migrations could create
  `SELECT 'event trigger', format('%I', e.evtname),
     ARRAY['event ' || e.evtevent, 'function ' || e.evtfoid::regprocedure::text,
           'enabled ' || e.evtenabled::text, 'tags ' || coalesce(e.evttags::text, '-')], NULL
   FROM pg_event_trigger e WHERE ${notExtensionMember("pg_event_trigger", "e.oid")}`,

  `SELECT 'default privileges',
     format('%s in %s on %s', pg_get_userbyid(da.defaclrole), coalesce(format('%I', n.nspname), '*'), da.defaclobjtype::text),
     ARRAY['acl ' || da.defaclacl::text], NULL
   FROM pg_default_acl da LEFT JOIN pg_namespace n ON n.oid = da.defaclnamespace`,
];

async function collect(tx: TransactionSql): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const query of QUERIES) {
    // the column alias list gives every query the same row shape whatever its select list says
    const rows = await tx.unsafe<Entry[]>(`SELECT * FROM (${query}) AS q (kind, key, attrs, definition)`);
    for (const row of rows) entries.push(row);
  }
  return entries;
}

type Keep = (entry: Entry) => boolean;

function render(entries: Entry[], keep: Keep = () => true, keepAttr: (attr: string) => boolean = () => true): string {
  const rank = (kind: string) => {
    const i = KIND_ORDER.indexOf(kind);
    return i === -1 ? KIND_ORDER.length : i;
  };
  const sorted = entries
    .filter(keep)
    .sort((a, b) => rank(a.kind) - rank(b.kind) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const lines: string[] = [];
  for (const e of sorted) {
    const head = `${e.kind} ${e.key} |`;
    for (const attr of e.attrs) if (keepAttr(attr)) lines.push(`${head} ${attr}`);
    if (e.definition !== null) {
      for (const line of e.definition.replace(/\n+$/, "").split("\n")) lines.push(`${head} > ${line}`);
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/**
 * Names are printed schema-qualified whatever the caller's search_path: the queries run with
 * search_path = pg_catalog (transaction-local, restored afterwards so the caller can keep using the
 * transaction), so the fingerprint of the same schema is byte-identical across databases and roles.
 */
async function withCatalogPath<T>(tx: TransactionSql, run: () => Promise<T>): Promise<T> {
  const [previous] = await tx.unsafe<{ path: string }[]>(`SELECT current_setting('search_path') AS path`);
  await tx.unsafe(`SELECT set_config('search_path', 'pg_catalog', true)`);
  const result = await run();
  await tx.unsafe(`SELECT set_config('search_path', $1, true)`, [previous?.path ?? ""]);
  return result;
}

/** Every catalog entry of the database (read once, rendered several ways). */
export async function catalogEntries(tx: TransactionSql): Promise<Entry[]> {
  return withCatalogPath(tx, () => collect(tx));
}

/** Whole schema: every schema except PostgreSQL's own, without drizzle's bookkeeping table. */
export const renderSchema = (entries: Entry[]) => render(entries);

/** Only routines and triggers — what packages/db/sql/functions.sql is supposed to define. */
export const renderRoutines = (entries: Entry[]) => render(entries, (e) => ROUTINE_KINDS.has(e.kind));

/**
 * What schema.ts can declare, so a database built by the migrations can be compared with one built
 * by `drizzle-kit push` of schema.ts: tables, columns, constraints, indexes, sequences, enums,
 * views, policies — without column positions (ALTER … ADD COLUMN appends), routines and triggers
 * (functions.sql), constraint triggers, the drizzle schema, owners, ACLs, comments and storage tuning.
 */
const STRUCTURE_KINDS = new Set([
  "enum",
  "table",
  "view",
  "materialized view",
  "column",
  "constraint",
  "index",
  "sequence",
  "policy",
]);
const NOT_DECLARABLE =
  /^(position|comment|acl|owner|options|storage|compression|replica identity|access method|clustered|internal triggers) /;
export const renderStructure = (entries: Entry[]) =>
  render(
    entries,
    (e) =>
      STRUCTURE_KINDS.has(e.kind) &&
      !e.key.startsWith("drizzle.") &&
      !(e.kind === "constraint" && e.attrs.includes("type t")),
    (attr) => !NOT_DECLARABLE.test(attr),
  );

export async function schemaFingerprint(tx: TransactionSql): Promise<string> {
  return renderSchema(await catalogEntries(tx));
}

export async function routineFingerprint(tx: TransactionSql): Promise<string> {
  return renderRoutines(await catalogEntries(tx));
}

/** Row count + md5 of every application table's rows — detects any write by a supposed no-op. */
export async function dataFingerprint(tx: TransactionSql): Promise<string> {
  return withCatalogPath(tx, async () => {
    const tables = await tx.unsafe<{ name: string }[]>(
      `SELECT format('%I.%I', n.nspname, c.relname) AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND ${appSchema("n")} AND ${notBookkeeping("n", "c.relname")}
       ORDER BY 1`,
    );
    const lines: string[] = [];
    for (const { name } of tables) {
      const [row] = await tx.unsafe<{ rows: string; md5: string }[]>(
        `SELECT count(*)::text AS rows, md5(coalesce(string_agg(t::text, E'\\n' ORDER BY t::text), '')) AS md5
         FROM ${name} t`,
      );
      lines.push(`data ${name} | rows ${row?.rows ?? "?"} md5 ${row?.md5 ?? "?"}`);
    }
    return lines.length ? `${lines.join("\n")}\n` : "";
  });
}

/**
 * Drops every application trigger, event trigger and routine (CASCADE), so that what
 * packages/db/sql/functions.sql recreates on its own can be compared with what was deployed.
 */
export async function dropAppCode(tx: TransactionSql): Promise<void> {
  const drops = await tx.unsafe<{ stmt: string }[]>(
    `SELECT format('DROP TRIGGER IF EXISTS %I ON %I.%I', tg.tgname, n.nspname, c.relname) AS stmt
     FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT tg.tgisinternal AND ${appSchema("n")}
     UNION ALL
     SELECT format('DROP EVENT TRIGGER IF EXISTS %I', e.evtname)
     FROM pg_event_trigger e WHERE ${notExtensionMember("pg_event_trigger", "e.oid")}
     UNION ALL
     SELECT format('DROP %s IF EXISTS %s CASCADE',
              CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END,
              p.oid::regprocedure)
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE ${appSchema("n")} AND ${notExtensionMember("pg_proc", "p.oid")}`,
  );
  for (const { stmt } of drops) await tx.unsafe(stmt);
}

export interface AppliedMigration {
  hash: string;
  createdAt: string;
}

/** drizzle's bookkeeping (drizzle.__drizzle_migrations) in the order the runner reads it. */
export async function appliedMigrations(tx: TransactionSql): Promise<AppliedMigration[]> {
  const [exists] = await tx.unsafe<{ ok: boolean }[]>(
    `SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`,
  );
  if (!exists?.ok) return [];
  return tx.unsafe<AppliedMigration[]>(
    `SELECT hash, created_at::text AS "createdAt" FROM drizzle.__drizzle_migrations ORDER BY created_at, id`,
  );
}
