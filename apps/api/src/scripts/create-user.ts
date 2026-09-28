import { parseArgs } from "node:util";
import { branch, createDb } from "@ong/db";
import { inArray } from "drizzle-orm";
import { createAuth } from "../auth";
import { loadEnv } from "../env";
import { AdminError } from "../services/adminCommon";
import { UserCreate, createUserAccount, credentialTools } from "../services/users";

/**
 * สร้างบัญชีพนักงาน (ปิด sign-up สาธารณะ) — ใช้ผ่าน railway ssh หรือเครื่อง dev · ปกติใช้หน้า /settings/users
 *   node dist/create-user.js --email a@shop.th --name "ชื่อ" --role staff --branch 00000 [--allow 00001,00002] [--view-all]
 * รหัสผ่าน: ส่งทาง stdin (echo -n "…" | node …) — ไม่รับทาง argv กันค้างใน shell history
 * ไม่ส่ง stdin = สุ่มให้และพิมพ์ครั้งเดียว
 * ตรวจและบันทึกด้วย createUserAccount() ตัวเดียวกับ POST /api/admin/users (สาขาต้องเปิดอยู่ · audit via=cli)
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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

if (!values.email || !values.name) fail("--email และ --name จำเป็น");

const env = loadEnv();
const db = createDb(env.DATABASE_URL);

// --branch / --allow รับรหัสสาขา (เช่น 00000) → id
const main = values.branch?.trim() || null;
const extra = (values.allow?.split(",") ?? []).map((c) => c.trim()).filter(Boolean);
const codes = [...(main ? [main] : []), ...extra];
const rows = codes.length
  ? await db.select({ id: branch.id, code: branch.code }).from(branch).where(inArray(branch.code, codes))
  : [];
const idOf = (code: string) => rows.find((r) => r.code === code)?.id ?? fail(`ไม่พบสาขา ${code}`);

const given = await readStdin();
const input = UserCreate.safeParse({
  email: values.email,
  name: values.name,
  role: values.role,
  branch_id: main ? idOf(main) : null,
  allowed_branch_ids: extra.map(idOf),
  can_view_all: values["view-all"],
  password: given || undefined,
});
if (!input.success) {
  const issue = input.error.issues[0];
  fail(`${issue?.path.join(".") || "input"}: ${issue?.message ?? "ข้อมูลไม่ถูกต้อง"}`);
}

try {
  const tools = await credentialTools(createAuth(db, env));
  const { row, temporaryPassword } = await createUserAccount(db, tools, input.data, { userId: null, via: "cli" });
  console.log(`created ${row.email} (${row.role}) id=${row.id}`);
  if (temporaryPassword) console.log(`password (แสดงครั้งเดียว): ${temporaryPassword}`);
} catch (e) {
  if (e instanceof AdminError) fail(`${e.field ?? "input"}: ${e.message}`);
  throw e;
}
process.exit(0);
