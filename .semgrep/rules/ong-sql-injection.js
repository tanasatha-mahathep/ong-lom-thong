// Fixture for ong-sql-injection.yml — run: semgrep --test .semgrep/rules (not application code)
import { sql, sql as drizzleSql } from "drizzle-orm";

const ORDER = "created_at desc";

export async function sqlRaw(input) {
  // ruleid: ong-drizzle-sql-raw-non-literal
  sql.raw(input);
  // ruleid: ong-drizzle-sql-raw-non-literal
  sql.raw(`order by ${input}`);
  // ruleid: ong-drizzle-sql-raw-non-literal
  drizzleSql.raw(input);
  // ok: ong-drizzle-sql-raw-non-literal
  sql.raw("now()");
  // ok: ong-drizzle-sql-raw-non-literal
  sql.raw(`now()`);
  // ok: ong-drizzle-sql-raw-non-literal
  return sql.raw(ORDER);
}

export async function drizzleExecute(db, id) {
  // ruleid: ong-sql-string-query
  await db.execute(`select * from customer where id = '${id}'`);
  // ruleid: ong-sql-string-query
  await db.execute("select * from customer where id = '" + id + "'");
  const query = `select * from customer where id = '${id}'`;
  // ruleid: ong-sql-string-query
  await db.execute(query);
  // ok: ong-sql-string-query
  await db.execute(sql`select * from customer where id = ${id}`);
  const tagged = sql`select * from customer where id = ${id}`;
  // ok: ong-sql-string-query
  await db.execute(tagged);
  // ok: ong-sql-string-query
  await db.execute(sql`select * from customer where name_th like ${`%${id}%`}`);
  // ok: ong-sql-string-query
  return db.execute("select 1");
}

export async function postgresUnsafe(client, name, id, fileText) {
  // ruleid: ong-sql-string-query
  await client.unsafe(`create database ${name}`);
  // ok: ong-sql-string-query
  await client.unsafe("select * from customer where id = $1", [id]);
  // ok: ong-sql-string-query
  return client.unsafe(fileText);
}
