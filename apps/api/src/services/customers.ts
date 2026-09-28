import { randomUUID } from "node:crypto";
import { cardStatus, isValidNationalId, maskNationalId, normalizeNationalId, parseThaiDate } from "@ong/core";
import { type Db, auditLog, customer } from "@ong/db";
import { and, desc, eq, ilike, like, ne, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { MAX_PHOTO_BYTES, sniffImage } from "../lib/image";
import type { Storage } from "../lib/storage";

export class CustomerInputError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly status: 400 | 409 = 400,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `ยาวเกิน ${max} ตัวอักษร`)
    .optional()
    .transform((v) => (v ? v : null));

/** 10 ช่องข้อความ (ช่องที่ 9 ตามลำดับ Siam ID คือรูป — ส่งแยกเป็นไฟล์) · วันที่เก็บเป็นข้อความตามที่ Siam ID พิมพ์ */
export const CustomerInput = z.object({
  national_id: z
    .string({ error: "กรุณากรอกเลขบัตรประชาชน" })
    .transform(normalizeNationalId)
    .refine(isValidNationalId, "เลขบัตรประชาชนไม่ถูกต้อง (13 หลัก · ตรวจหลักสุดท้ายไม่ผ่าน)"),
  name_th: z.string({ error: "กรุณากรอกชื่อ-นามสกุล" }).trim().min(1, "กรุณากรอกชื่อ-นามสกุล").max(200),
  name_en: optionalText(200),
  birthday_text: optionalText(50),
  religion: optionalText(50),
  address: optionalText(1000),
  card_issue_text: optionalText(50),
  card_expire_text: optionalText(50),
  mobile: optionalText(30),
  phone2: optionalText(30),
});
export type CustomerInput = z.infer<typeof CustomerInput>;

export function parseCustomerInput(fields: Record<string, unknown>): CustomerInput {
  const strings = Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === "string"));
  const parsed = CustomerInput.safeParse(strings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CustomerInputError(issue?.message ?? "ข้อมูลไม่ถูกต้อง", String(issue?.path[0] ?? "form"));
  }
  return parsed.data;
}

type CustomerRow = typeof customer.$inferSelect;

export function toDetail(row: CustomerRow, today: string) {
  return {
    id: row.id,
    national_id: row.nationalId,
    name_th: row.nameTh,
    name_en: row.nameEn,
    birthday_text: row.birthdayText,
    religion: row.religion,
    address: row.address,
    card_issue_text: row.cardIssueText,
    card_expire_text: row.cardExpireText,
    card_expire_date: row.cardExpireDate,
    card_status: cardStatus(row.cardExpireText, today),
    mobile: row.mobile,
    phone2: row.phone2,
    has_photo: row.photoKey !== null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** รายการ — เลขบัตรมาสก์เสมอ (R13) */
export function toListItem(row: CustomerRow, today: string) {
  return {
    id: row.id,
    national_id_masked: maskNationalId(row.nationalId),
    name_th: row.nameTh,
    mobile: row.mobile,
    // หน้า /buy แสดงที่อยู่ของลูกค้าที่เลือกจาก dropdown (spec §3.1 ข้อ 2)
    address: row.address,
    card_status: cardStatus(row.cardExpireText, today),
  };
}

export const PAGE_SIZE = 20;
/** คำค้นที่ผู้ใช้พิมพ์ใช้ใน LIKE — % _ และ backslash เป็นตัวอักษรธรรมดา */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** ค้นจากชื่อ (ไทย/อังกฤษ) · เลขบัตร · เบอร์ — ว่าง = ล่าสุดก่อน */
export async function searchCustomers(db: Db, q: string, page: number) {
  const term = q.trim();
  const digits = term.replace(/\D/g, "");
  const conditions: SQL[] = [];
  if (term) {
    const text = `%${escapeLike(term)}%`;
    conditions.push(ilike(customer.nameTh, text), ilike(customer.nameEn, text));
    if (digits.length >= 2) {
      const d = `%${digits}%`;
      conditions.push(like(customer.nationalId, d), like(customer.mobile, d), like(customer.phone2, d));
    }
  }
  const rows = await db
    .select()
    .from(customer)
    .where(conditions.length ? or(...conditions) : undefined)
    .orderBy(desc(customer.updatedAt), desc(customer.id))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function findCustomer(db: Db, id: string): Promise<CustomerRow | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db.select().from(customer).where(eq(customer.id, id)).limit(1);
  return row ?? null;
}

async function storePhoto(storage: Storage, customerId: string, file: unknown): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > MAX_PHOTO_BYTES) throw new CustomerInputError("รูปใหญ่เกิน 5 MB", "photo");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new CustomerInputError("รับเฉพาะรูป JPEG · PNG · WebP", "photo");
  // key ใหม่ทุกครั้ง — ไม่เขียนทับ ไม่มีโค้ดลบ
  const key = `photos/${customerId}/${randomUUID()}.${kind.ext}`;
  await storage.put(key, bytes, kind.type);
  return key;
}

const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code === "23505" || err.cause?.code === "23505";
};

async function assertNationalIdFree(db: Db, nationalId: string, exceptId?: string) {
  const where = exceptId
    ? and(eq(customer.nationalId, nationalId), ne(customer.id, exceptId))
    : eq(customer.nationalId, nationalId);
  const [dup] = await db.select({ id: customer.id }).from(customer).where(where).limit(1);
  if (dup) throw new CustomerInputError("มีลูกค้าเลขบัตรนี้อยู่แล้ว", "national_id", 409, { existing_id: dup.id });
}

const columns = (input: CustomerInput) => ({
  nationalId: input.national_id,
  nameTh: input.name_th,
  nameEn: input.name_en,
  birthdayText: input.birthday_text,
  religion: input.religion,
  address: input.address,
  cardIssueText: input.card_issue_text,
  cardExpireText: input.card_expire_text,
  // parse ตอนบันทึก — "ตลอดชีพ" หรือรูปแบบที่อ่านไม่ได้ = null (สถานะบัตรคิดจากข้อความตอนอ่าน)
  cardExpireDate: parseThaiDate(input.card_expire_text),
  mobile: input.mobile,
  phone2: input.phone2,
});

/** ค่าที่ลง audit — เลขบัตรมาสก์ (PDPA) · รูปบันทึกแค่ว่าเปลี่ยน */
const auditView = (row: CustomerRow) => ({
  national_id: maskNationalId(row.nationalId),
  name_th: row.nameTh,
  name_en: row.nameEn,
  birthday_text: row.birthdayText,
  religion: row.religion,
  address: row.address,
  card_issue_text: row.cardIssueText,
  card_expire_text: row.cardExpireText,
  mobile: row.mobile,
  phone2: row.phone2,
  photo: row.photoKey ? "set" : null,
});

export async function createCustomer(db: Db, storage: Storage, input: CustomerInput, photo: unknown, userId: string) {
  await assertNationalIdFree(db, input.national_id);
  const id = randomUUID();
  const photoKey = await storePhoto(storage, id, photo);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(customer)
        .values({ id, ...columns(input), photoKey, createdBy: userId, updatedBy: userId })
        .returning();
      if (!row) throw new Error("insert customer returned nothing");
      await tx.insert(auditLog).values({
        userId,
        action: "customer.create",
        tableName: "customer",
        rowId: row.id,
        diff: { after: auditView(row) },
      });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new CustomerInputError("มีลูกค้าเลขบัตรนี้อยู่แล้ว", "national_id", 409);
    throw e;
  }
}

export async function updateCustomer(
  db: Db,
  storage: Storage,
  before: CustomerRow,
  input: CustomerInput,
  photo: unknown,
  userId: string,
) {
  await assertNationalIdFree(db, input.national_id, before.id);
  const photoKey = (await storePhoto(storage, before.id, photo)) ?? before.photoKey;
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(customer)
        .set({ ...columns(input), photoKey, updatedBy: userId, updatedAt: new Date() })
        .where(eq(customer.id, before.id))
        .returning();
      if (!row) throw new Error("update customer returned nothing");
      const a = auditView(before);
      const b = auditView(row);
      const changed = Object.fromEntries(
        (Object.keys(b) as (keyof typeof b)[])
          .filter((k) => a[k] !== b[k] || (k === "photo" && row.photoKey !== before.photoKey))
          .map((k) => [k, { before: a[k], after: k === "photo" ? "replaced" : b[k] }]),
      );
      if (Object.keys(changed).length) {
        await tx.insert(auditLog).values({
          userId,
          action: "customer.update",
          tableName: "customer",
          rowId: row.id,
          diff: changed,
        });
      }
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new CustomerInputError("มีลูกค้าเลขบัตรนี้อยู่แล้ว", "national_id", 409);
    throw e;
  }
}
