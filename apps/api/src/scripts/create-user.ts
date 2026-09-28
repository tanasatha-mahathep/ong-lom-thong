import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { ROLES, type Role, branch, createDb, user } from "@ong/db";
import { eq, inArray } from "drizzle-orm";
import { createAuth } from "../auth";
import { loadEnv } from "../env";

/**
 * สร้างบัญชีพนักงาน (ปิด sign-up สาธารณะ) — ใช้ผ่าน railway ssh หรือเครื่อง dev
 *   node dist/create-user.js --email a@shop.th --name "ชื่อ" --role staff --branch 00000 [--allow 00001,00002] [--view-all]
 * รหัสผ่าน: ส่งทาง stdin (echo -n "…" | node …) — ไม่รับทาง argv กันค้างใน shell history
 * ไม่ส่ง stdin = สุ่มให้และพิมพ์ครั้งเดียว
 */
const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "staff" },
    branch: { type: "string" },
    allow: { type: "string" },
    "view-all": { type: "boolean", default: false },
  },
});

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

const role = values.role as Role;
if (!values.email || !values.name) throw new Error("--email และ --name จำเป็น");
if (!ROLES.includes(role)) throw new Error(`--role ต้องเป็น ${ROLES.join("|")}`);

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const ctx = await createAuth(db, env).$context;

const codes = [values.branch, ...(values.allow?.split(",") ?? [])].filter((c): c is string => !!c?.trim());
const branches = codes.length ? await db.select().from(branch).where(inArray(branch.code, codes)) : [];
const byCode = new Map(branches.map((b) => [b.code, b.id]));
for (const code of codes) if (!byCode.has(code)) throw new Error(`ไม่พบสาขา ${code}`);

const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, values.email)).limit(1);
if (existing) throw new Error(`มีบัญชี ${values.email} แล้ว`);

const given = await readStdin();
const password = given || randomBytes(12).toString("base64url");
if (password.length < 10) throw new Error("รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร");

const created = await ctx.internalAdapter.createUser(
  {
    email: values.email,
    name: values.name,
    emailVerified: true,
    role,
    branchId: values.branch ? byCode.get(values.branch) : null,
    allowedBranchIds: (values.allow?.split(",") ?? []).map((c) => byCode.get(c.trim())).filter(Boolean),
    canViewAll: values["view-all"],
    isActive: true,
  },
  { method: "admin" },
);
await ctx.internalAdapter.linkAccount({
  userId: created.id,
  providerId: "credential",
  accountId: created.id,
  password: await ctx.password.hash(password),
});

console.log(`created ${values.email} (${role}) id=${created.id}`);
if (!given) console.log(`password (แสดงครั้งเดียว): ${password}`);
process.exit(0);
