import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { BranchSchema, ROLES, type Role } from "@/lib/queries";

/**
 * endpoint ของผู้ดูแลระบบ (apps/api/src/routes/admin.ts · services/branches.ts · services/users.ts)
 * admin เท่านั้น (role อื่น 403) · ไม่ผูกสาขาปัจจุบัน · คำตอบ no-store · ไม่แบ่งหน้า (ร้านมีไม่กี่สาขา/สิบกว่าคน)
 */

// ---------- สาขา ----------

/** toBranchJson() — ทุกสาขารวมที่ปิดแล้ว */
export const AdminBranchSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  short_name: z.string().nullable(),
  tax_branch_code: z.string().nullable(),
  /** ข้อความบนหัวใบ "สำนักงานใหญ่" / "สาขาที่ 00001" (ภาษาไทยเสมอ — เอกสารภาษี) · ยังไม่มีรหัส = null */
  tax_branch_label: z.string().nullable(),
  address: z.string().nullable(),
  tel: z.string().nullable(),
  doc_prefix: z.string().nullable(),
  sort_order: z.number().int(),
  is_active: z.boolean(),
  /** มีบิลแล้ว (ทุกสถานะ) = doc_prefix แก้ไม่ได้ */
  has_bills: z.boolean(),
  created_at: z.string(),
});
export type AdminBranch = z.infer<typeof AdminBranchSchema>;

/** ผู้ใช้ที่ยังผูกกับสาขาที่เพิ่งปิด (PUT ตอบมาเมื่อสาขาปิดอยู่ · เปิดอยู่ = []) */
export const AffectedUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  /** ผูกทางสาขาหลัก / สาขาที่อนุญาต */
  via: z.enum(["main", "allowed"]),
  /** ไม่เหลือสาขาที่เปิดอยู่ให้ทำงาน — ต้องผูกสาขาใหม่ */
  becomes_branchless: z.boolean(),
});
export type AffectedUser = z.infer<typeof AffectedUserSchema>;

const BranchListSchema = z.object({ items: z.array(AdminBranchSchema) });
const BranchCreatedSchema = z.object({ branch: AdminBranchSchema });
const BranchUpdatedSchema = z.object({
  branch: AdminBranchSchema,
  // บันทึกสำเร็จแล้ว — รายการนี้แค่แจ้งเตือน ไม่มีก็ไม่ควรทำให้หน้าจอบอกว่าบันทึกไม่สำเร็จ
  affected_users: z.array(AffectedUserSchema).catch([]),
});

/** ช่องที่แก้ได้ทั้งตอนเพิ่มและแก้ — ช่องข้อความที่ไม่บังคับส่ง null = ไม่มีค่า */
interface BranchFields {
  name: string;
  short_name: string | null;
  tax_branch_code: string | null;
  address: string | null;
  tel: string | null;
  sort_order: number;
  is_active: boolean;
}
export interface BranchCreateInput extends BranchFields {
  code: string;
  doc_prefix: string | null;
}
/** ไม่ส่ง code (แก้ไม่ได้) · ไม่ส่ง doc_prefix เมื่อสาขามีบิลแล้ว (แก้ไม่ได้) */
export interface BranchUpdateInput extends BranchFields {
  doc_prefix?: string | null;
}

const branchPath = (id: string) => `/api/admin/branches/${encodeURIComponent(id)}` as const;

export function listBranches(signal?: AbortSignal) {
  return apiFetch("/api/admin/branches", { signal, schema: BranchListSchema });
}

export async function createBranch(input: BranchCreateInput): Promise<AdminBranch> {
  const { branch } = await apiFetch("/api/admin/branches", {
    method: "POST",
    json: input,
    schema: BranchCreatedSchema,
  });
  return branch;
}

export function updateBranch(id: string, input: BranchUpdateInput) {
  return apiFetch(branchPath(id), { method: "PUT", json: input, schema: BranchUpdatedSchema });
}

// ---------- ผู้ใช้ ----------

/** toUserJson() — ไม่มีรหัสผ่าน/hash/session */
export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  /** สาขาหลัก (อาจเป็นสาขาที่ปิดไปแล้ว) */
  branch: BranchSchema.nullable(),
  allowed_branches: z.array(BranchSchema),
  can_view_all: z.boolean(),
  is_active: z.boolean(),
  created_at: z.string(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

const UserListSchema = z.object({ items: z.array(AdminUserSchema) });
/** temporary_password มีเฉพาะเมื่อไม่ได้ตั้งรหัสผ่านเอง — แสดงครั้งเดียว ห้ามเก็บ */
const UserCreatedSchema = z.object({ user: AdminUserSchema, temporary_password: z.string().nullable() });
const UserUpdatedSchema = z.object({ user: AdminUserSchema, sessions_revoked: z.number().int() });
const PasswordResetSchema = z.object({
  temporary_password: z.string().nullable(),
  sessions_revoked: z.number().int(),
});

/** ตัวกรองของ GET /api/admin/users — ค่าเดียวกับ search ใน URL ของ /settings/users */
export interface UserFilters {
  q: string;
  /** สาขาหลักหรือสาขาที่อนุญาต */
  branch?: string;
  role?: Role;
  active?: boolean;
}

export interface UserCreateInput {
  email: string;
  name: string;
  role: Role;
  branch_id: string | null;
  allowed_branch_ids: string[];
  can_view_all: boolean;
  /** ไม่ส่ง = ระบบสุ่มและตอบกลับครั้งเดียว */
  password?: string;
}

/** ช่องที่ไม่ส่ง = คงค่าเดิม — บัญชีตัวเองไม่ส่ง role/is_active (API ห้ามลดสิทธิ์/ปิดตัวเองอยู่แล้ว) */
export interface UserUpdateInput {
  name: string;
  branch_id: string | null;
  allowed_branch_ids: string[];
  can_view_all: boolean;
  role?: Role;
  is_active?: boolean;
}

const userPath = (id: string) => `/api/admin/users/${encodeURIComponent(id)}` as const;

export function listUsers({ q, branch, role, active }: UserFilters, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (branch) params.set("branch_id", branch);
  if (role) params.set("role", role);
  if (active !== undefined) params.set("active", String(active));
  const query = params.toString();
  return apiFetch(`/api/admin/users${query ? `?${query}` : ""}`, { signal, schema: UserListSchema });
}

export function createUser(input: UserCreateInput) {
  return apiFetch("/api/admin/users", { method: "POST", json: input, schema: UserCreatedSchema });
}

export function updateUser(id: string, input: UserUpdateInput) {
  return apiFetch(userPath(id), { method: "PUT", json: input, schema: UserUpdatedSchema });
}

/** รหัสผ่านใหม่แบบสุ่ม (ไม่ส่ง password) + ลบทุก session ของผู้ใช้นั้น */
export function resetUserPassword(id: string) {
  return apiFetch(`${userPath(id)}/reset-password`, { method: "POST", json: {}, schema: PasswordResetSchema });
}
