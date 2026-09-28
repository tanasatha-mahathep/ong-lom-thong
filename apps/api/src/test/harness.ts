import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { type Db, type Role, branch, createDb, runMigrations, seedReferenceData } from "@ong/db";
import postgres from "postgres";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { loadEnv } from "../env";

const BASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://ong:ong@localhost:5432/postgres";
const MIGRATIONS = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
const ORIGIN = "http://localhost:8787";

/** เครื่อง dev ที่ไม่ได้ `pnpm infra:up` = ข้ามเทสต์ที่ต้องใช้ DB · ใน CI ต้องมีเสมอ (ไม่งั้น fail) */
export async function databaseAvailable(): Promise<boolean> {
  const sql = postgres(BASE_URL, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch (e) {
    if (process.env.CI) throw new Error(`TEST_DATABASE_URL ใช้ไม่ได้ใน CI: ${(e as Error).message}`, { cause: e });
    console.warn(`[api tests] ข้าม — ต่อ Postgres ไม่ได้ (${BASE_URL}) · รัน pnpm infra:up`);
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export interface TestUser {
  email: string;
  password: string;
  role?: Role;
  branch?: string | null;
  allow?: string[];
  viewAll?: boolean;
  active?: boolean;
}

/** database ใหม่ต่อไฟล์เทสต์ — migrate + seed (สาขา 00000/00001/00002 · โลหะ 4 ชนิด) */
export async function startTestApp() {
  const admin = postgres(BASE_URL, { max: 1, onnotice: () => {} });
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;

  await runMigrations(url.toString(), MIGRATIONS);
  const db: Db = createDb(url.toString());
  await seedReferenceData(db);

  const env = loadEnv({
    NODE_ENV: "test",
    DATABASE_URL: url.toString(),
    BETTER_AUTH_SECRET: "test-only-secret-0123456789abcdefghij",
    BETTER_AUTH_URL: ORIGIN,
  });
  const auth = createAuth(db, env);
  const app = createApp({ db, auth, env });
  const branches = Object.fromEntries((await db.select().from(branch)).map((b) => [b.code, b.id]));

  async function createUser(u: TestUser) {
    const ctx = await auth.$context;
    const created = await ctx.internalAdapter.createUser(
      {
        email: u.email,
        name: u.email.split("@")[0] ?? u.email,
        emailVerified: true,
        role: u.role ?? "staff",
        branchId: u.branch ? branches[u.branch] : null,
        allowedBranchIds: (u.allow ?? []).map((c) => branches[c]),
        canViewAll: u.viewAll ?? false,
        isActive: u.active ?? true,
      },
      { method: "admin" },
    );
    await ctx.internalAdapter.linkAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: await ctx.password.hash(u.password),
    });
    return created;
  }

  /** request ผ่าน app โดยตรง — ใส่ Origin ให้ผ่าน CSRF check ของ better-auth */
  function request(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
    const headers: Record<string, string> = { origin: init.origin ?? ORIGIN };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.cookie) headers.cookie = init.cookie;
    return app.request(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  /** login แล้วคืน cookie สำหรับ request ต่อ ๆ ไป */
  async function login(email: string, password: string): Promise<string> {
    const res = await request("/api/auth/sign-in/email", { body: { email, password } });
    if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`);
    return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  }

  async function close() {
    await db.$client.end({ timeout: 1 });
    await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end({ timeout: 1 });
  }

  return { app, db, auth, env, branches, createUser, request, login, close };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;
