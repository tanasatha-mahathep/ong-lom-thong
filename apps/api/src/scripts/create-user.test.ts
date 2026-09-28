import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditLog, user } from "@ong/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USER_MSG } from "../services/users";
import { type TestApp, databaseAvailable, startTestApp } from "../test/harness";

const available = await databaseAvailable();
const TSX = fileURLToPath(new URL("../../node_modules/.bin/tsx", import.meta.url));
const SCRIPT = fileURLToPath(new URL("./create-user.ts", import.meta.url));

/** รันสคริปต์จริง (แบบ railway ssh) กับ database ของเทสต์ — รหัสผ่านส่งทาง stdin */
function runCli(t: TestApp, args: string[], stdin = ""): Promise<{ code: number | null; out: string; err: string }> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  for (const [k, v] of Object.entries(t.env)) if (v !== undefined) env[k] = String(v);
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [SCRIPT, ...args], { env });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out, err }));
    child.stdin.end(stdin);
  });
}

// แต่ละครั้งเปิด node + tsx ใหม่ (~5 วินาที) — เผื่อเวลาให้เครื่อง CI
describe.skipIf(!available)(
  "scripts/create-user — CLI ใช้ createUserAccount() ตัวเดียวกับ API",
  { timeout: 120_000 },
  () => {
    let t: TestApp;

    beforeAll(async () => {
      t = await startTestApp();
    });
    afterAll(async () => {
      await t?.close();
    });

    const signIn = async (email: string, password: string) =>
      (await t.request("/api/auth/sign-in/email", { body: { email, password } })).status;

    it("รหัสสาขา → id · รหัสผ่านจาก stdin ไม่ถูกพิมพ์ · login ได้ · audit ไม่มีผู้ทำ (via cli)", async () => {
      const password = "Cli-Password-2569";
      const args = ["--email", "Cli.User@ong.test", "--name", "ผู้ใช้ CLI", "--role", "manager"];
      const r = await runCli(t, [...args, "--branch", "00001", "--allow", "00000,00002"], `${password}\n`);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(r.out).toMatch(/^created cli\.user@ong\.test \(manager\) id=\w+\n$/);
      expect(r.out + r.err).not.toContain(password);

      const [row] = await t.db.select().from(user).where(eq(user.email, "cli.user@ong.test"));
      expect(row).toMatchObject({
        role: "manager",
        branchId: t.branches["00001"],
        allowedBranchIds: [t.branches["00000"], t.branches["00002"]],
        canViewAll: false,
        isActive: true,
      });
      expect(await signIn("cli.user@ong.test", password)).toBe(200);
      const [audit] = await t.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.rowId, row?.id ?? ""));
      expect(audit).toMatchObject({ action: "user.create", userId: null });
      expect(audit?.diff).toMatchObject({ credential: "provided", via: "cli" });
      expect(JSON.stringify(audit?.diff)).not.toContain(password);
    });

    it("ไม่ส่ง stdin → สุ่มรหัสผ่านแล้วพิมพ์ครั้งเดียว · login ได้", async () => {
      const r = await runCli(t, ["--email", "cli.random@ong.test", "--name", "สุ่มรหัส", "--view-all"]);
      expect(r.code).toBe(0);
      const password = /password \(แสดงครั้งเดียว\): (\S+)/.exec(r.out)?.[1] ?? "";
      expect(password).toMatch(/^[2-9A-HJ-NP-Za-km-z]{20}$/);
      expect(await signIn("cli.random@ong.test", password)).toBe(200);
      const [row] = await t.db.select().from(user).where(eq(user.email, "cli.random@ong.test"));
      expect(row).toMatchObject({ role: "staff", branchId: null, canViewAll: true });
    });

    it("สาขาไม่มีจริง · อีเมลซ้ำ · รหัสผ่านสั้น → exit 1 พร้อมเหตุผล ไม่สร้างบัญชี", async () => {
      const count = async () => (await t.db.select({ id: user.id }).from(user)).length;
      const before = await count();

      const noBranch = await runCli(t, ["--email", "x@ong.test", "--name", "x", "--branch", "00009"]);
      expect(noBranch.code).toBe(1);
      expect(noBranch.err).toContain("ไม่พบสาขา 00009");

      const dup = await runCli(t, ["--email", "CLI.USER@ong.test", "--name", "ซ้ำ"], "Another-Pass-2569");
      expect(dup.code).toBe(1);
      expect(dup.err).toContain(`email: ${USER_MSG.emailTaken}`);

      const short = await runCli(t, ["--email", "short@ong.test", "--name", "สั้น"], "short");
      expect(short.code).toBe(1);
      expect(short.err).toContain(`password: ${USER_MSG.passwordShort}`);
      expect(short.err).not.toContain("short\n");

      expect(await count()).toBe(before);
    });
  },
);
