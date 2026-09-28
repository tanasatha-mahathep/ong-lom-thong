import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { type Db, type Role, branch, createDb, runMigrations, seedReferenceData } from "@ong/db";
import postgres from "postgres";
import { createApp } from "../app";
import { createAuth } from "../auth";
import { loadEnv } from "../env";
import { createGotenbergClient } from "../lib/gotenberg";
import { createMemoryStorage } from "../lib/storage";

const BASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://ong:ong@localhost:5432/postgres";
const MIGRATIONS = fileURLToPath(new URL("../../../../packages/db/migrations", import.meta.url));
const ORIGIN = "http://localhost:8787";

/** Gotenberg สำหรับเทสต์ที่แปลง PDF จริง — ค่าเริ่มต้นตาม docker-compose.yml (basic auth ong/ongongong) */
export const TEST_GOTENBERG = {
  GOTENBERG_URL: process.env.TEST_GOTENBERG_URL ?? "http://localhost:3000",
  GOTENBERG_USERNAME: process.env.TEST_GOTENBERG_USERNAME ?? "ong",
  GOTENBERG_PASSWORD: process.env.TEST_GOTENBERG_PASSWORD ?? "ongongong",
};

/** ไม่มี Gotenberg = ข้ามเทสต์ที่แปลงจริง · CI ที่ตั้ง TEST_GOTENBERG_URL ไว้ต้องมีเสมอ (ไม่งั้น fail) */
export async function gotenbergAvailable(): Promise<boolean> {
  const { up, status } = await createGotenbergClient(TEST_GOTENBERG, { timeoutMs: 3_000 }).health();
  if (up) return true;
  const where = `${TEST_GOTENBERG.GOTENBERG_URL} (status ${status ?? "no answer"})`;
  if (process.env.CI && process.env.TEST_GOTENBERG_URL) throw new Error(`TEST_GOTENBERG_URL ใช้ไม่ได้ใน CI: ${where}`);
  console.warn(`[api tests] ข้ามเทสต์ Gotenberg — ต่อ ${where} ไม่ได้ · รัน make infra-up`);
  return false;
}

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
export async function startTestApp(options: { now?: () => Date } = {}) {
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
    // เทสต์ใช้ storage ในหน่วยความจำ — ค่าพวกนี้แค่ให้ผ่าน schema
    S3_ENDPOINT: "http://storage.invalid",
    S3_REGION: "test",
    S3_BUCKET: "test",
    S3_ACCESS_KEY: "test",
    S3_SECRET_KEY: "test",
    // ยังไม่มี route ไหนแปลง PDF — ค่าพวกนี้แค่ให้ผ่าน schema (ข้อมูลกิจการสมมติ · เลขผู้เสียภาษี checksum ถูก)
    GOTENBERG_URL: "http://gotenberg.invalid",
    GOTENBERG_USERNAME: "test",
    GOTENBERG_PASSWORD: "test",
    COMPANY_NAME: "ร้านทดสอบ",
    COMPANY_ADDRESS: "1 ถนนทดสอบ ตำบลในเมือง อำเภอเมือง จังหวัดขอนแก่น 40000",
    COMPANY_TEL: "0800000000",
    COMPANY_TAX_ID: "1234567890121",
  });
  const auth = createAuth(db, env);
  const storage = createMemoryStorage();
  const app = createApp({ db, auth, env, storage, now: options.now });
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
  /** body เป็น FormData = multipart (browser ใส่ boundary เอง) · อย่างอื่น = JSON */
  function request(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
    const headers: Record<string, string> = { origin: init.origin ?? ORIGIN };
    const multipart = init.body instanceof FormData;
    if (init.body !== undefined && !multipart) headers["content-type"] = "application/json";
    if (init.cookie) headers.cookie = init.cookie;
    return app.request(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : multipart ? (init.body as FormData) : JSON.stringify(init.body),
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

  return { app, db, auth, env, storage, branches, createUser, request, login, close };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;
