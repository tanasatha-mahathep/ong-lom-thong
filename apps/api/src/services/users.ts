import { randomInt } from "node:crypto";
import { type Db, ROLES, account, auditLog, branch, session, user } from "@ong/db";
import { type SQL, and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { type Auth, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../auth";
import { uniqueViolation, withoutQueryValues } from "../lib/pg";
import type { BranchRef } from "../lib/scope";
import { AdminError, type Executor, changedFields, notFound } from "./adminCommon";
import { escapeLike } from "./customers";

export const USER_MSG = {
  emailRequired: "กรุณากรอกอีเมล",
  email: "อีเมลไม่ถูกต้อง",
  emailTaken: "มีบัญชีที่ใช้อีเมลนี้แล้ว",
  emailImmutable: "อีเมลแก้ไม่ได้ (ใช้เป็นชื่อเข้าระบบ) — ต้องการอีเมลใหม่ให้สร้างบัญชีใหม่",
  name: "กรุณากรอกชื่อ",
  role: `role ต้องเป็น ${ROLES.join(" · ")}`,
  branchId: "branch_id ต้องเป็น id ของสาขา",
  allowedIds: "allowed_branch_ids ต้องเป็นรายการ id ของสาขา",
  branchMissing: "ไม่พบสาขานี้",
  branchClosed: (label: string) => `สาขา ${label} ปิดอยู่ — เปิดสาขาก่อนหรือเลือกสาขาอื่น`,
  flag: (field: string) => `${field} ต้องเป็น true หรือ false`,
  passwordType: "รหัสผ่านต้องเป็นข้อความ",
  passwordShort: `รหัสผ่านต้องยาวอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`,
  passwordLong: `รหัสผ่านยาวเกิน ${PASSWORD_MAX_LENGTH} ตัวอักษร`,
  passwordElsewhere: "เปลี่ยนรหัสผ่านที่ POST /api/admin/users/:id/reset-password",
  selfDemote: "ลดสิทธิ์ผู้ดูแลระบบของตัวเองไม่ได้ — ให้ผู้ดูแลคนอื่นทำ",
  selfDeactivate: "ปิดบัญชีของตัวเองไม่ได้ — ให้ผู้ดูแลคนอื่นทำ",
  lastAdmin: "ต้องมีผู้ดูแลระบบ (admin) ที่ใช้งานได้อย่างน้อย 1 คน",
} as const;

// ---------- รหัสผ่าน ----------

/** ตัดตัวที่อ่านสับสน (0 O o 1 l I) — พนักงานต้องพิมพ์ตามจอ */
const PASSWORD_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
/** 20 ตัวจาก 55 ตัวอักษร ≈ 115 bit */
export const GENERATED_PASSWORD_LENGTH = 20;

/** รหัสผ่านชั่วคราว — crypto.randomInt (สุ่มเท่ากันทุกตัว ไม่มี modulo bias) */
export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET.charAt(randomInt(PASSWORD_ALPHABET.length));
  return out;
}

/** สิ่งที่ต้องยืมจาก better-auth: hash รหัสผ่าน (scrypt — ตัวเดียวกับตอน login) และรูปแบบ id */
export interface CredentialTools {
  hash(password: string): Promise<string>;
  newId(model: "user" | "account"): string;
}

export async function credentialTools(auth: Auth): Promise<CredentialTools> {
  const ctx = await auth.$context;
  return {
    hash: (password) => ctx.password.hash(password),
    newId: (model) => {
      const id = ctx.generateId({ model });
      if (typeof id !== "string") throw new Error("better-auth generateId is disabled — admin writes need string ids");
      return id;
    },
  };
}

// ---------- body / query ----------

const email = z
  .string({ error: (i) => (i.input === undefined ? USER_MSG.emailRequired : USER_MSG.email) })
  .trim()
  .toLowerCase()
  .max(254, USER_MSG.email)
  .pipe(z.email({ error: USER_MSG.email }));
const name = z
  .string({ error: (i) => (i.input === undefined ? USER_MSG.name : "ชื่อต้องเป็นข้อความ") })
  .trim()
  .min(1, USER_MSG.name)
  .max(100, "ชื่อยาวเกิน 100 ตัวอักษร");
const role = z.enum(ROLES, { error: USER_MSG.role });
const branchId = z.uuid({ error: USER_MSG.branchId }).nullable();
const allowedIds = z
  .array(z.uuid({ error: USER_MSG.allowedIds }), { error: USER_MSG.allowedIds })
  .max(50, "สาขาที่อนุญาตเกิน 50 สาขา");
const flag = (field: string) => z.boolean({ error: USER_MSG.flag(field) });
const password = z
  .string({ error: USER_MSG.passwordType })
  .min(PASSWORD_MIN_LENGTH, USER_MSG.passwordShort)
  .max(PASSWORD_MAX_LENGTH, USER_MSG.passwordLong);
/** ไม่ส่ง / ว่าง / null = ให้ระบบสุ่ม (แสดงครั้งเดียวใน response) */
const optionalPassword = z.preprocess((v) => (v === "" || v === null ? undefined : v), password.optional());

/** ช่องที่ไม่รู้จัก (เช่น canViewAll แบบ camelCase) = 400 ไม่ใช่เงียบ ๆ ไม่ทำอะไร — ทุก body ของผู้ดูแล */
export const UserCreate = z.strictObject({
  email,
  name,
  role,
  branch_id: branchId.optional(),
  allowed_branch_ids: allowedIds.optional(),
  can_view_all: flag("can_view_all").optional(),
  password: optionalPassword,
});
export type UserCreate = z.infer<typeof UserCreate>;

/** ช่องที่ไม่ส่ง = คงค่าเดิม · email แก้ไม่ได้ (ส่งค่าเดิมมาได้) · รหัสผ่านไปที่ reset-password */
export const UserUpdate = z.strictObject({
  email: z.unknown().optional(),
  password: z.unknown().optional(),
  name: name.optional(),
  role: role.optional(),
  branch_id: branchId.optional(),
  allowed_branch_ids: allowedIds.optional(),
  can_view_all: flag("can_view_all").optional(),
  is_active: flag("is_active").optional(),
});
export type UserUpdate = z.infer<typeof UserUpdate>;

export const ResetPassword = z.strictObject({ password: optionalPassword });

export const UserListQuery = z.object({
  q: z.string().trim().max(100, "คำค้นยาวเกิน 100 ตัวอักษร").optional(),
  branch_id: z.uuid({ error: "branch_id ไม่ถูกต้อง" }).optional(),
  role: role.optional(),
  active: z
    .enum(["true", "false"], { error: "active ต้องเป็น true หรือ false" })
    .transform((v) => v === "true")
    .optional(),
});
export type UserListQuery = z.infer<typeof UserListQuery>;

// ---------- อ่าน ----------

export type UserRow = typeof user.$inferSelect;

/** สาขาทั้งหมด (รวมที่ปิด) เรียงแบบหน้าจัดการสาขา — ใช้แปลง id → {id, code, name} */
export const branchRefs = (db: Executor): Promise<BranchRef[]> =>
  db
    .select({ id: branch.id, code: branch.code, name: branch.name })
    .from(branch)
    .orderBy(asc(branch.sortOrder), asc(branch.code));

/** ไม่มีรหัสผ่าน/hash/session ใน response เลย */
export function toUserJson(u: UserRow, branches: BranchRef[]) {
  const allowed = new Set(u.allowedBranchIds);
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    branch: branches.find((b) => b.id === u.branchId) ?? null,
    allowed_branches: branches.filter((b) => allowed.has(b.id)),
    can_view_all: u.canViewAll,
    is_active: u.isActive,
    created_at: u.createdAt.toISOString(),
  };
}

/** branch_id = สาขาหลักหรืออยู่ในสาขาที่อนุญาต (ผู้ใช้ can_view_all ที่ไม่ได้ผูกสาขานั้นไม่นับ) */
export async function listUsers(db: Db, f: UserListQuery) {
  const where: SQL[] = [];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(or(ilike(user.email, like), ilike(user.name, like)) as SQL);
  }
  if (f.role) where.push(eq(user.role, f.role));
  if (f.active !== undefined) where.push(eq(user.isActive, f.active));
  if (f.branch_id) {
    where.push(or(eq(user.branchId, f.branch_id), sql`${f.branch_id}::uuid = any(${user.allowedBranchIds})`) as SQL);
  }
  const [rows, branches] = await Promise.all([
    db
      .select()
      .from(user)
      .where(and(...where))
      .orderBy(asc(user.name), asc(user.email)),
    branchRefs(db),
  ]);
  return rows.map((u) => toUserJson(u, branches));
}

// ---------- เขียน ----------

/** ใครทำ — userId = ผู้ดูแลที่ login (api) · null = สคริปต์ create-user ผ่าน railway ssh (cli) */
export interface Actor {
  userId: string | null;
  via: "api" | "cli";
}

/** id ของ better-auth (ตัวอักษร/ตัวเลข 32 ตัว) — รูปแบบอื่นตอบ 404 เหมือนไม่มี */
const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;

const unique = (ids: string[]) => [...new Set(ids)];

/** ค่าที่ลง audit — ไม่มีรหัสผ่าน/hash ทุกกรณี */
const auditView = (u: UserRow) => ({
  email: u.email,
  name: u.name,
  role: u.role,
  branch_id: u.branchId,
  allowed_branch_ids: u.allowedBranchIds,
  can_view_all: u.canViewAll,
  is_active: u.isActive,
});

/**
 * สาขาที่ "เพิ่งผูก" ต้องมีอยู่และเปิดอยู่ (400 ชี้ช่อง) — สาขาที่ผูกไว้ก่อนแล้วถูกปิดทีหลังคงไว้ได้
 * (forUser กรองสาขาที่ปิดออกเอง · ไม่บังคับให้ล้างก่อนแก้ช่องอื่น)
 */
async function assertAssignable(db: Executor, main: string | null, allowed: { id: string; field: string }[]) {
  const wanted = [...(main ? [{ id: main, field: "branch_id" }] : []), ...allowed];
  if (wanted.length === 0) return;
  const rows = await db
    .select({ id: branch.id, code: branch.code, name: branch.name, isActive: branch.isActive })
    .from(branch)
    .where(inArray(branch.id, unique(wanted.map((w) => w.id))));
  for (const w of wanted) {
    const b = rows.find((r) => r.id === w.id);
    if (!b) throw new AdminError(USER_MSG.branchMissing, w.field);
    if (!b.isActive) throw new AdminError(USER_MSG.branchClosed(`${b.code} ${b.name}`), w.field);
  }
}

const revokeSessions = async (db: Executor, userId: string) =>
  (await db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id })).length;

/**
 * สร้างบัญชี — ใช้ร่วมกันทั้ง POST /api/admin/users และ scripts/create-user (CLI)
 * user + credential account + audit ในทรานแซกชันเดียว · ไม่ส่งรหัสผ่าน = สุ่มและคืนครั้งเดียว (temporaryPassword)
 */
export async function createUserAccount(
  db: Db,
  tools: CredentialTools,
  input: UserCreate,
  actor: Actor,
): Promise<{ row: UserRow; temporaryPassword: string | null }> {
  const main = input.branch_id ?? null;
  const requested = input.allowed_branch_ids ?? [];
  await assertAssignable(
    db,
    main,
    requested.map((id, i) => ({ id, field: `allowed_branch_ids.${i}` })),
  );
  const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, input.email)).limit(1);
  if (taken) throw new AdminError(USER_MSG.emailTaken, "email", 409);

  const secret = input.password ?? generatePassword();
  const hash = await tools.hash(secret);
  const id = tools.newId("user");
  try {
    const row = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(user)
        .values({
          id,
          // better-auth ค้นอีเมลแบบตัวพิมพ์เล็กเสมอ — UserCreate แปลงแล้ว
          email: input.email,
          name: input.name,
          emailVerified: true,
          role: input.role,
          branchId: main,
          allowedBranchIds: unique(requested),
          canViewAll: input.can_view_all ?? false,
          isActive: true,
        })
        .returning();
      if (!row) throw new Error("insert user returned nothing");
      await tx.insert(account).values({
        id: tools.newId("account"),
        accountId: id,
        providerId: "credential",
        userId: id,
        password: hash,
      });
      await tx.insert(auditLog).values({
        userId: actor.userId,
        action: "user.create",
        tableName: "user",
        rowId: id,
        diff: {
          after: auditView(row),
          credential: input.password === undefined ? "generated" : "provided",
          via: actor.via,
        },
      });
      return row;
    });
    return { row, temporaryPassword: input.password === undefined ? secret : null };
  } catch (e) {
    if (uniqueViolation(e) === "user_email_unique") throw new AdminError(USER_MSG.emailTaken, "email", 409);
    throw withoutQueryValues(e, "user.create");
  }
}

/**
 * แก้บัญชี — สิทธิ์ (role · สาขา · can_view_all) มีผลทันทีกับทุก session เพราะ requireSession อ่านผู้ใช้จาก DB ทุก request
 * ปิดบัญชี = ลบทุก session ของผู้ใช้นั้นในทรานแซกชันเดียวกัน · ห้ามลดสิทธิ์/ปิดตัวเอง · ต้องเหลือ admin ที่ใช้งานได้ ≥ 1
 */
export async function updateUserAccount(
  db: Db,
  targetId: string,
  input: UserUpdate,
  actor: Actor,
): Promise<{ row: UserRow; sessionsRevoked: number }> {
  if (!USER_ID.test(targetId)) throw notFound();
  return db.transaction(async (tx) => {
    // ล็อก admin ที่ใช้งานได้ทั้งชุดก่อนเสมอ (เรียงตาม id — สองคำขอพร้อมกันรอกันแทน deadlock)
    // คำขอที่ลด admin พร้อมกันจะเห็นผลของอีกฝ่ายหลังได้ล็อก → ไม่มีทางเหลือ admin 0 คน
    // "no key update" ไม่ใช่ "update": ล็อกกันเองได้เหมือนกัน แต่ไม่ขวาง FK check (FOR KEY SHARE) ของแถวที่อ้างถึงผู้ใช้
    // (audit_log.user_id · session · buy_receipt.created_by) — FOR UPDATE ทำให้ PUT กับ reset-password ที่ทับกัน deadlock
    const admins = await tx
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.role, "admin"), eq(user.isActive, true)))
      .orderBy(asc(user.id))
      .for("no key update");
    const [before] = await tx.select().from(user).where(eq(user.id, targetId)).for("no key update");
    if (!before) throw notFound();

    if (
      input.email !== undefined &&
      !(typeof input.email === "string" && input.email.trim().toLowerCase() === before.email)
    ) {
      throw new AdminError(USER_MSG.emailImmutable, "email");
    }
    if (input.password !== undefined) throw new AdminError(USER_MSG.passwordElsewhere, "password");

    const next: UserRow = {
      ...before,
      name: input.name ?? before.name,
      role: input.role ?? before.role,
      branchId: input.branch_id !== undefined ? input.branch_id : before.branchId,
      allowedBranchIds:
        input.allowed_branch_ids !== undefined ? unique(input.allowed_branch_ids) : before.allowedBranchIds,
      canViewAll: input.can_view_all ?? before.canViewAll,
      isActive: input.is_active ?? before.isActive,
    };

    const demoted = before.role === "admin" && next.role !== "admin";
    const deactivated = before.isActive && !next.isActive;
    if (actor.userId === targetId && demoted) throw new AdminError(USER_MSG.selfDemote, "role", 409);
    if (actor.userId === targetId && deactivated) throw new AdminError(USER_MSG.selfDeactivate, "is_active", 409);
    const wasActiveAdmin = before.role === "admin" && before.isActive;
    if (wasActiveAdmin && (demoted || deactivated) && !admins.some((a) => a.id !== targetId)) {
      throw new AdminError(USER_MSG.lastAdmin, demoted ? "role" : "is_active", 409);
    }

    await assertAssignable(
      tx,
      next.branchId !== before.branchId ? next.branchId : null,
      (input.allowed_branch_ids ?? [])
        .map((id, i) => ({ id, field: `allowed_branch_ids.${i}` }))
        .filter((w) => !before.allowedBranchIds.includes(w.id)),
    );

    const changed = changedFields(auditView(before), auditView(next));
    if (Object.keys(changed).length === 0) return { row: before, sessionsRevoked: 0 };

    const [row] = await tx
      .update(user)
      .set({
        name: next.name,
        role: next.role,
        branchId: next.branchId,
        allowedBranchIds: next.allowedBranchIds,
        canViewAll: next.canViewAll,
        isActive: next.isActive,
        updatedAt: new Date(),
      })
      .where(eq(user.id, targetId))
      .returning();
    if (!row) throw new Error("update user returned nothing");
    // ปิดบัญชี = ออกจากระบบทุกเครื่อง — requireSession ปฏิเสธบัญชีที่ปิดอยู่แล้ว แต่ลบ session ทิ้งด้วย
    // กัน cookie เก่ากลับมาใช้ได้เมื่อเปิดบัญชีคืน
    const sessionsRevoked = deactivated ? await revokeSessions(tx, targetId) : 0;
    await tx.insert(auditLog).values({
      userId: actor.userId,
      action: "user.update",
      tableName: "user",
      rowId: targetId,
      diff: sessionsRevoked > 0 ? { ...changed, sessions_revoked: sessionsRevoked } : changed,
    });
    return { row, sessionsRevoked };
  });
}

/**
 * ตั้งรหัสผ่านใหม่ (ไม่ส่ง = สุ่มและคืนครั้งเดียว) + ลบทุก session ของผู้ใช้นั้น — ทรานแซกชันเดียวกับ audit
 * audit บันทึกแค่ว่าสุ่มหรือผู้ดูแลตั้งให้ ไม่มีรหัสผ่าน/hash
 */
export async function resetUserPassword(
  db: Db,
  tools: CredentialTools,
  targetId: string,
  newPassword: string | undefined,
  actor: Actor,
): Promise<{ temporaryPassword: string | null; sessionsRevoked: number }> {
  if (!USER_ID.test(targetId)) throw notFound();
  // ตรวจก่อน hash (scrypt ช้าโดยตั้งใจ) — id ที่ไม่มีจริงไม่ต้องเสียเวลา
  const [exists] = await db.select({ id: user.id }).from(user).where(eq(user.id, targetId)).limit(1);
  if (!exists) throw notFound();

  const secret = newPassword ?? generatePassword();
  const hash = await tools.hash(secret);
  try {
    const sessionsRevoked = await db.transaction(async (tx) => {
      const [target] = await tx.select({ id: user.id }).from(user).where(eq(user.id, targetId)).for("no key update");
      if (!target) throw notFound();
      const updated = await tx
        .update(account)
        .set({ password: hash, updatedAt: new Date() })
        .where(and(eq(account.userId, targetId), eq(account.providerId, "credential")))
        .returning({ id: account.id });
      if (updated.length === 0) {
        await tx.insert(account).values({
          id: tools.newId("account"),
          accountId: targetId,
          providerId: "credential",
          userId: targetId,
          password: hash,
        });
      }
      const revoked = await revokeSessions(tx, targetId);
      await tx.insert(auditLog).values({
        userId: actor.userId,
        action: "user.reset_password",
        tableName: "user",
        rowId: targetId,
        diff: {
          credential: newPassword === undefined ? "generated" : "provided",
          sessions_revoked: revoked,
          via: actor.via,
        },
      });
      return revoked;
    });
    return { temporaryPassword: newPassword === undefined ? secret : null, sessionsRevoked };
  } catch (e) {
    throw withoutQueryValues(e, "user.reset_password");
  }
}
