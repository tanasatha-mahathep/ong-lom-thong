import { taxBranchLabel } from "@ong/core";
import { type Db, type Role, auditLog, branch, buyReceipt, docSequence, user } from "@ong/db";
import { and, asc, eq, getTableColumns, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { uniqueViolation } from "../lib/pg";
import { AdminError, type Executor, changedFields, notFound } from "./adminCommon";

const FIVE_DIGITS = /^\d{5}$/;
const DOC_PREFIX = /^[A-Z]{1,4}$/;
/** รหัสสาขาของสรรพากรที่หมายถึงสำนักงานใหญ่ — มีได้แห่งเดียว */
export const HEAD_OFFICE_TAX_CODE = "00000";

export const BRANCH_MSG = {
  code: "รหัสสาขาต้องเป็นตัวเลข 5 หลัก เช่น 00001",
  codeImmutable: "รหัสสาขาแก้ไม่ได้ — อยู่ในชื่อไฟล์ PDF ที่เก็บถาวรแล้ว (ต้องการรหัสใหม่ = เพิ่มสาขาใหม่)",
  codeTaken: (code: string) => `รหัสสาขา ${code} มีอยู่แล้ว`,
  name: "กรุณากรอกชื่อสาขา",
  taxCode: "รหัสสาขาของสรรพากรต้องเป็นตัวเลข 5 หลัก (00000 = สำนักงานใหญ่)",
  taxCodeTaken: (taxCode: string, holder: string) => `รหัสสาขาของสรรพากร ${taxCode} ใช้กับสาขา ${holder} แล้ว`,
  headOfficeTaken: (holder: string) =>
    `มีสำนักงานใหญ่ (รหัสสรรพากร 00000) แล้ว คือสาขา ${holder} — ร้านมีสำนักงานใหญ่ได้แห่งเดียว`,
  docPrefix: "อักษรนำเลขเอกสารต้องเป็นตัวพิมพ์ใหญ่ A–Z 1–4 ตัว เช่น PT",
  docPrefixLocked: "เปลี่ยนอักษรนำเลขเอกสารไม่ได้ — สาขานี้มีบิลแล้ว",
  sortOrder: "ลำดับต้องเป็นจำนวนเต็ม 0–9999",
  isActive: "is_active ต้องเป็น true หรือ false",
} as const;

// ---------- body ----------

const text = (label: string, max: number, required?: string) =>
  z
    .string({ error: (i) => (i.input === undefined && required ? required : `${label}ต้องเป็นข้อความ`) })
    .trim()
    .max(max, `${label}ยาวเกิน ${max} ตัวอักษร`);

/** ช่องไม่บังคับ — ว่าง / null = ไม่มีค่า (ล้างค่าเดิมเมื่อแก้) */
const clearable = (label: string, max: number) =>
  text(label, max)
    .nullable()
    .transform((v) => v || null);

const patterned = (re: RegExp, message: string) =>
  z
    .string({ error: message })
    .trim()
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || re.test(v), message);

const fields = {
  name: text("ชื่อสาขา", 100, BRANCH_MSG.name).min(1, BRANCH_MSG.name),
  short_name: clearable("ชื่อย่อ", 20),
  tax_branch_code: patterned(FIVE_DIGITS, BRANCH_MSG.taxCode),
  address: clearable("ที่อยู่", 500),
  tel: clearable("เบอร์โทร", 40),
  doc_prefix: patterned(DOC_PREFIX, BRANCH_MSG.docPrefix),
  // ไม่ใช่เงิน — รับเป็นตัวเลข JSON ได้
  sort_order: z
    .number({ error: BRANCH_MSG.sortOrder })
    .int(BRANCH_MSG.sortOrder)
    .min(0, BRANCH_MSG.sortOrder)
    .max(9999, BRANCH_MSG.sortOrder),
  is_active: z.boolean({ error: BRANCH_MSG.isActive }),
};

export const BranchCreate = z.object({
  code: z.string({ error: BRANCH_MSG.code }).trim().regex(FIVE_DIGITS, BRANCH_MSG.code),
  name: fields.name,
  short_name: fields.short_name.optional(),
  tax_branch_code: fields.tax_branch_code.optional(),
  address: fields.address.optional(),
  tel: fields.tel.optional(),
  doc_prefix: fields.doc_prefix.optional(),
  sort_order: fields.sort_order.optional(),
  is_active: fields.is_active.optional(),
});
export type BranchCreate = z.infer<typeof BranchCreate>;

/** แก้ได้ทุกช่องยกเว้น code · ช่องที่ไม่ส่ง = คงค่าเดิม · code ที่ส่งมาต้องเท่าค่าเดิม (ฟอร์มส่งทั้งก้อนได้) */
export const BranchUpdate = z.object({
  code: z.unknown().optional(),
  name: fields.name.optional(),
  short_name: fields.short_name.optional(),
  tax_branch_code: fields.tax_branch_code.optional(),
  address: fields.address.optional(),
  tel: fields.tel.optional(),
  doc_prefix: fields.doc_prefix.optional(),
  sort_order: fields.sort_order.optional(),
  is_active: fields.is_active.optional(),
});
export type BranchUpdate = z.infer<typeof BranchUpdate>;

// ---------- อ่าน ----------

export type BranchRow = typeof branch.$inferSelect;
/** แถวสาขา + มีบิลแล้วหรือยัง (บิลทุกสถานะ รวมที่ยกเลิก) */
export type BranchWithBills = BranchRow & { hasBills: boolean };

// select จากตารางเดียว drizzle ตัดชื่อตารางหน้าคอลัมน์ใน sql`` ออก ("id" จะกลายเป็น buy_receipt.id) — จึงเขียนชื่อเต็มเอง
const hasBillsSql = sql<boolean>`exists (select 1 from ${buyReceipt} as r where r.branch_id = ${branch}.id)`;

export function toBranchJson(b: BranchWithBills) {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    short_name: b.shortName,
    tax_branch_code: b.taxBranchCode,
    // ข้อความที่พิมพ์บนหัวใบ: "สำนักงานใหญ่" / "สาขาที่ 00001" · ยังไม่มีรหัส = null (ออก PDF ไม่ได้)
    tax_branch_label: taxBranchLabel(b.taxBranchCode),
    address: b.address,
    tel: b.tel,
    doc_prefix: b.docPrefix,
    sort_order: b.sortOrder,
    is_active: b.isActive,
    // มีบิลแล้ว = doc_prefix แก้ไม่ได้ (หน้าจอปิดช่องนั้น)
    has_bills: b.hasBills,
    created_at: b.createdAt.toISOString(),
  };
}

/** ทุกสาขารวมที่ปิดแล้ว — ลำดับตามที่ผู้ดูแลตั้ง แล้วตามรหัส */
export const listBranches = (db: Db): Promise<BranchWithBills[]> =>
  db
    .select({ ...getTableColumns(branch), hasBills: hasBillsSql })
    .from(branch)
    .orderBy(asc(branch.sortOrder), asc(branch.code));

const withBills = async (db: Executor, row: BranchRow): Promise<BranchWithBills> => {
  const [bill] = await db
    .select({ id: buyReceipt.id })
    .from(buyReceipt)
    .where(eq(buyReceipt.branchId, row.id))
    .limit(1);
  return { ...row, hasBills: bill !== undefined };
};

// ---------- เขียน ----------

/** ค่าที่ลง audit — ชื่อช่องตาม API */
const auditView = (b: BranchRow) => ({
  code: b.code,
  name: b.name,
  short_name: b.shortName,
  tax_branch_code: b.taxBranchCode,
  address: b.address,
  tel: b.tel,
  doc_prefix: b.docPrefix,
  sort_order: b.sortOrder,
  is_active: b.isActive,
});

/** รหัสภายใน / รหัสสรรพากร ชนกับสาขาอื่น → 409 ที่บอกว่าชนกับสาขาไหน · ไม่ชน = null */
async function findConflict(
  db: Executor,
  keys: { code?: string; taxBranchCode?: string | null },
  exceptId?: string,
): Promise<AdminError | null> {
  const others = (where: ReturnType<typeof eq>) => (exceptId ? and(where, ne(branch.id, exceptId)) : where);
  if (keys.code !== undefined) {
    const [dup] = await db
      .select({ id: branch.id })
      .from(branch)
      .where(others(eq(branch.code, keys.code)))
      .limit(1);
    if (dup) return new AdminError(BRANCH_MSG.codeTaken(keys.code), "code", 409);
  }
  if (keys.taxBranchCode) {
    const [holder] = await db
      .select({ code: branch.code, name: branch.name })
      .from(branch)
      .where(others(eq(branch.taxBranchCode, keys.taxBranchCode)))
      .limit(1);
    if (holder) {
      const who = `${holder.code} ${holder.name}`;
      const message =
        keys.taxBranchCode === HEAD_OFFICE_TAX_CODE
          ? BRANCH_MSG.headOfficeTaken(who)
          : BRANCH_MSG.taxCodeTaken(keys.taxBranchCode, who);
      return new AdminError(message, "tax_branch_code", 409);
    }
  }
  return null;
}

/**
 * รหัสสรรพากรห้ามซ้ำ (นิติบุคคลเดียว → สำนักงานใหญ่ 00000 มีได้แห่งเดียว) — DB ยังไม่มี unique ของช่องนี้
 * จึงล็อกตารางสาขาแบบกันการเขียนอื่นทุกทาง (api · seed · SQL) ตลอดทรานแซกชัน: ตรวจซ้ำแล้วเขียนโดยไม่มีใครแทรก
 * การอ่าน (SELECT · FK ของบิล/ผู้ใช้) ไม่ถูกบล็อก
 */
const lockBranches = (tx: Executor) => tx.execute(sql`lock table ${branch} in share row exclusive mode`);

/**
 * doc_prefix แก้ได้เฉพาะสาขาที่ยังไม่มีบิล — มีบิลแล้วเปลี่ยน = เลขที่สองรูปแบบปนกันในสาขา/เดือนเดียว
 * (RC6910-0001 → PT-RC6910-0002) เรียงตาม doc_no และ manifest ส่งบัญชีรายเดือนเพี้ยน
 * บิลที่กำลังบันทึกอยู่: การบันทึกบิลเรียก next_doc_no() (เขียน doc_sequence) ก่อนอ่าน doc_prefix เสมอ →
 * ล็อก doc_sequence แบบ SHARE = รอบิลที่ค้างอยู่ทุกใบ commit ก่อนตรวจ และบิลใหม่รอจนทรานแซกชันนี้จบ
 * (บิลใหม่จึงอ่านอักษรนำใหม่) · ล็อกแค่ตอนเปลี่ยน doc_prefix ซึ่งนาน ๆ ครั้ง
 */
async function assertDocPrefixChangeable(tx: Executor, branchId: string) {
  await tx.execute(sql`lock table ${docSequence} in share mode`);
  const [bill] = await tx
    .select({ id: buyReceipt.id })
    .from(buyReceipt)
    .where(eq(buyReceipt.branchId, branchId))
    .limit(1);
  if (bill) throw new AdminError(BRANCH_MSG.docPrefixLocked, "doc_prefix", 409);
}

/** code ชนกันตอนบันทึก (unique ของ DB — ตาข่ายชั้นสุดท้าย) → 409 ข้อความเดียวกับที่ตรวจล่วงหน้า */
const codeRace = (e: unknown, code: string) =>
  uniqueViolation(e) === "branch_code_unique" ? new AdminError(BRANCH_MSG.codeTaken(code), "code", 409) : e;

export async function createBranch(db: Db, input: BranchCreate, actorId: string): Promise<BranchWithBills> {
  try {
    return await db.transaction(async (tx) => {
      await lockBranches(tx);
      const conflict = await findConflict(tx, { code: input.code, taxBranchCode: input.tax_branch_code ?? null });
      if (conflict) throw conflict;
      const [row] = await tx
        .insert(branch)
        .values({
          code: input.code,
          name: input.name,
          shortName: input.short_name ?? null,
          taxBranchCode: input.tax_branch_code ?? null,
          address: input.address ?? null,
          tel: input.tel ?? null,
          docPrefix: input.doc_prefix ?? null,
          sortOrder: input.sort_order ?? 0,
          isActive: input.is_active ?? true,
        })
        .returning();
      if (!row) throw new Error("insert branch returned nothing");
      await tx.insert(auditLog).values({
        userId: actorId,
        action: "branch.create",
        tableName: "branch",
        rowId: row.id,
        diff: { after: auditView(row) },
      });
      return { ...row, hasBills: false };
    });
  } catch (e) {
    throw codeRace(e, input.code);
  }
}

export interface AffectedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** ผู้ใช้ที่ยังใช้งานอยู่และมีสาขานี้เป็นสาขาหลัก — ต้องย้ายสาขาหลักเมื่อสาขาถูกปิด */
const mainBranchUsers = (db: Executor, branchId: string): Promise<AffectedUser[]> =>
  db
    .select({ id: user.id, email: user.email, name: user.name, role: user.role })
    .from(user)
    .where(and(eq(user.branchId, branchId), eq(user.isActive, true)))
    .orderBy(asc(user.email));

/**
 * แก้สาขา (ยกเว้น code · doc_prefix หลังมีบิล) · ปิด/เปิดสาขาได้ — ปิดแล้ว forUser() ตัดออกจากสิทธิ์ทุกคนทันที
 * affectedUsers = ผู้ใช้ที่ยังใช้สาขาที่ปิดอยู่นี้เป็นสาขาหลัก ([] เมื่อสาขาเปิดอยู่)
 */
export async function updateBranch(db: Db, id: string, input: BranchUpdate, actorId: string) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  return db.transaction(async (tx) => {
    await lockBranches(tx);
    const [before] = await tx.select().from(branch).where(eq(branch.id, id));
    if (!before) throw notFound();
    if (input.code !== undefined && !(typeof input.code === "string" && input.code.trim() === before.code)) {
      throw new AdminError(BRANCH_MSG.codeImmutable, "code");
    }
    const next: BranchRow = {
      ...before,
      name: input.name ?? before.name,
      shortName: input.short_name !== undefined ? input.short_name : before.shortName,
      taxBranchCode: input.tax_branch_code !== undefined ? input.tax_branch_code : before.taxBranchCode,
      address: input.address !== undefined ? input.address : before.address,
      tel: input.tel !== undefined ? input.tel : before.tel,
      docPrefix: input.doc_prefix !== undefined ? input.doc_prefix : before.docPrefix,
      sortOrder: input.sort_order ?? before.sortOrder,
      isActive: input.is_active ?? before.isActive,
    };
    if (next.taxBranchCode !== before.taxBranchCode) {
      const conflict = await findConflict(tx, { taxBranchCode: next.taxBranchCode }, id);
      if (conflict) throw conflict;
    }
    if (next.docPrefix !== before.docPrefix) await assertDocPrefixChangeable(tx, id);
    const changed = changedFields(auditView(before), auditView(next));
    let row = before;
    if (Object.keys(changed).length > 0) {
      const [updated] = await tx
        .update(branch)
        .set({
          name: next.name,
          shortName: next.shortName,
          taxBranchCode: next.taxBranchCode,
          address: next.address,
          tel: next.tel,
          docPrefix: next.docPrefix,
          sortOrder: next.sortOrder,
          isActive: next.isActive,
        })
        .where(eq(branch.id, id))
        .returning();
      if (!updated) throw new Error("update branch returned nothing");
      row = updated;
      await tx.insert(auditLog).values({
        userId: actorId,
        action: "branch.update",
        tableName: "branch",
        rowId: id,
        diff: changed,
      });
    }
    const affectedUsers = row.isActive ? [] : await mainBranchUsers(tx, id);
    return { row: await withBills(tx, row), affectedUsers };
  });
}
