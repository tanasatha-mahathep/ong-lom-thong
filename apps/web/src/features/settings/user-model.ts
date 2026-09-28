import type { Role } from "@/lib/queries";
import type { AdminBranch, AdminUser, UserCreateInput, UserUpdateInput } from "./api";
import type { SettingsKey } from "./i18n";

/** ค่าในฟอร์มผู้ใช้ — branch_id "" = ไม่มีสาขาหลัก · password "" = ให้ระบบสุ่ม (เฉพาะตอนเพิ่ม) */
export interface UserFormValues {
  name: string;
  email: string;
  role: Role;
  branch_id: string;
  allowed_branch_ids: string[];
  can_view_all: boolean;
  is_active: boolean;
  password: string;
}

/** ช่องของฟอร์มตามลำดับบนจอ — error ของ API ที่ชี้ช่องอื่นแสดงรวมท้ายฟอร์ม */
export const USER_FIELDS = [
  "name",
  "email",
  "role",
  "branch_id",
  "allowed_branch_ids",
  "can_view_all",
  "is_active",
  "password",
] as const;
export type UserField = (typeof USER_FIELDS)[number];

/** ตรงกับ PASSWORD_MIN_LENGTH / PASSWORD_MAX_LENGTH ของ apps/api/src/auth.ts */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
/** ตัวแปรของข้อความตรวจรหัสผ่าน — ส่งให้ t() ทุกครั้ง (ข้อความอื่นไม่ใช้ก็ไม่เป็นไร) */
export const PASSWORD_LIMITS = { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH };

export const NEW_USER: UserFormValues = {
  name: "",
  email: "",
  role: "staff",
  branch_id: "",
  allowed_branch_ids: [],
  can_view_all: false,
  is_active: true,
  password: "",
};

export function userValuesOf(user: AdminUser): UserFormValues {
  return {
    name: user.name,
    email: user.email,
    role: user.role,
    branch_id: user.branch?.id ?? "",
    allowed_branch_ids: user.allowed_branches.map((b) => b.id),
    can_view_all: user.can_view_all,
    is_active: user.is_active,
    password: "",
  };
}

type Check = (props: { value: string }) => SettingsKey | undefined;

// รูปคร่าว ๆ พอให้เตือนพิมพ์ผิด — API (z.email) เป็นคนตัดสิน
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const checkName: Check = ({ value }) => (value.trim() ? undefined : "users.validation.name");
export const checkEmail: Check = ({ value }) => (EMAIL.test(value.trim()) ? undefined : "users.validation.email");
/** รหัสผ่านไม่บังคับ — ว่าง = ให้ระบบสุ่ม */
export const checkPassword: Check = ({ value }) => {
  if (value === "") return undefined;
  if (value.length < PASSWORD_MIN_LENGTH) return "users.validation.passwordShort";
  return value.length > PASSWORD_MAX_LENGTH ? "users.validation.passwordLong" : undefined;
};

const unique = (ids: readonly string[]) => [...new Set(ids)];

export function toUserCreate(values: UserFormValues): UserCreateInput {
  return {
    email: values.email.trim(),
    name: values.name.trim(),
    role: values.role,
    branch_id: values.branch_id || null,
    allowed_branch_ids: unique(values.allowed_branch_ids),
    can_view_all: values.can_view_all,
    // รหัสผ่านส่งตามที่พิมพ์ (ช่องว่างอาจตั้งใจ) · ว่าง = ไม่ส่ง → ระบบสุ่มและตอบกลับครั้งเดียว
    ...(values.password ? { password: values.password } : {}),
  };
}

/** บัญชีตัวเองไม่ส่ง role/is_active — ช่องถูกปิดไว้ และ API ห้ามลดสิทธิ์/ปิดตัวเองอยู่แล้ว */
export function toUserUpdate(values: UserFormValues, self: boolean): UserUpdateInput {
  return {
    name: values.name.trim(),
    branch_id: values.branch_id || null,
    allowed_branch_ids: unique(values.allowed_branch_ids),
    can_view_all: values.can_view_all,
    ...(self ? {} : { role: values.role, is_active: values.is_active }),
  };
}

/**
 * สาขาที่เลือกได้ในฟอร์ม: ที่เปิดอยู่ทั้งหมด + ที่ปิดแล้วแต่ผู้ใช้ยังผูกอยู่ (API ให้คงไว้ได้ · เลือกใหม่ไม่ได้)
 * ลำดับตามรายการสาขาของ API (sort_order แล้วรหัส)
 */
export const selectableBranches = (branches: readonly AdminBranch[], keep: readonly string[]) =>
  branches.filter((b) => b.is_active || keep.includes(b.id));

/** ไม่มีสาขาให้ทำงานเลย — เข้าระบบได้แต่ทำงานไม่ได้ (เตือน ไม่บล็อก) */
export const hasNoBranch = (values: UserFormValues) =>
  !values.can_view_all && values.branch_id === "" && values.allowed_branch_ids.length === 0;
