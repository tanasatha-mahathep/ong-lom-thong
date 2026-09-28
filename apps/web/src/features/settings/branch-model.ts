import type { AdminBranch, BranchCreateInput, BranchUpdateInput } from "./api";
import type { SettingsKey } from "./i18n";

/** ค่าในฟอร์มสาขา — ข้อความตามที่พิมพ์ (แปลงเป็น payload ตอนบันทึก) */
export interface BranchFormValues {
  code: string;
  name: string;
  short_name: string;
  tax_branch_code: string;
  address: string;
  tel: string;
  doc_prefix: string;
  sort_order: string;
  is_active: boolean;
}

/** ช่องของฟอร์มตามลำดับบนจอ — error ของ API ที่ชี้ช่องอื่นแสดงรวมท้ายฟอร์ม */
export const BRANCH_FIELDS = [
  "code",
  "name",
  "short_name",
  "tax_branch_code",
  "address",
  "tel",
  "doc_prefix",
  "sort_order",
  "is_active",
] as const;
export type BranchField = (typeof BRANCH_FIELDS)[number];

// รูปแบบเดียวกับ BranchCreate ของ API (services/branches.ts) — API ตรวจซ้ำและเป็นคนตัดสิน
const FIVE_DIGITS = /^\d{5}$/;
const DOC_PREFIX = /^[A-Z]{1,4}$/;
const SORT_ORDER = /^\d{1,4}$/;
const MAX_SORT_ORDER = 9999;

/** สาขาใหม่: ต่อท้ายรายการ (ลำดับมากสุด + 1) · เปิดใช้งานทันที */
export function newBranchValues(branches: readonly AdminBranch[]): BranchFormValues {
  const last = Math.max(-1, ...branches.map((b) => b.sort_order));
  return {
    code: "",
    name: "",
    short_name: "",
    tax_branch_code: "",
    address: "",
    tel: "",
    doc_prefix: "",
    sort_order: String(Math.min(last + 1, MAX_SORT_ORDER)),
    is_active: true,
  };
}

export function branchValuesOf(branch: AdminBranch): BranchFormValues {
  return {
    code: branch.code,
    name: branch.name,
    short_name: branch.short_name ?? "",
    tax_branch_code: branch.tax_branch_code ?? "",
    address: branch.address ?? "",
    tel: branch.tel ?? "",
    doc_prefix: branch.doc_prefix ?? "",
    sort_order: String(branch.sort_order),
    is_active: branch.is_active,
  };
}

/** validator ของ TanStack Form — คืน key ของข้อความ (แปลตอนแสดง) */
type Check = (props: { value: string }) => SettingsKey | undefined;

export const checkCode: Check = ({ value }) =>
  FIVE_DIGITS.test(value.trim()) ? undefined : "branches.validation.code";
export const checkName: Check = ({ value }) => (value.trim() ? undefined : "branches.validation.name");
export const checkTaxCode: Check = ({ value }) =>
  value.trim() === "" || FIVE_DIGITS.test(value.trim()) ? undefined : "branches.validation.taxCode";
export const checkDocPrefix: Check = ({ value }) =>
  value.trim() === "" || DOC_PREFIX.test(value.trim()) ? undefined : "branches.validation.docPrefix";
export const checkSortOrder: Check = ({ value }) =>
  SORT_ORDER.test(value.trim()) ? undefined : "branches.validation.sortOrder";

/** ช่องไม่บังคับที่ว่าง = null (API ล้างค่าเดิม) */
const orNull = (value: string) => value.trim() || null;

function sharedFields(values: BranchFormValues) {
  return {
    name: values.name.trim(),
    short_name: orNull(values.short_name),
    tax_branch_code: orNull(values.tax_branch_code),
    address: orNull(values.address),
    tel: orNull(values.tel),
    // ลำดับการแสดง (ไม่ใช่เงิน) — checkSortOrder ผ่านแล้วจึงเป็นจำนวนเต็ม 0–9999
    sort_order: Number.parseInt(values.sort_order.trim(), 10),
    is_active: values.is_active,
  };
}

export const toBranchCreate = (values: BranchFormValues): BranchCreateInput => ({
  code: values.code.trim(),
  ...sharedFields(values),
  doc_prefix: orNull(values.doc_prefix),
});

/** ไม่ส่ง code (แก้ไม่ได้) · สาขาที่มีบิลแล้วไม่ส่ง doc_prefix (แก้ไม่ได้ — ช่องปิดไว้) */
export const toBranchUpdate = (values: BranchFormValues, branch: AdminBranch): BranchUpdateInput => ({
  ...sharedFields(values),
  ...(branch.has_bills ? {} : { doc_prefix: orNull(values.doc_prefix) }),
});

/** ปิดสาขาที่มีบิลแล้ว — ต้องยืนยันก่อน (บิลเดิมยังเปิดดูได้ แต่เปิดบิลใหม่ที่สาขานี้ไม่ได้) */
export const needsCloseConfirm = (branch: AdminBranch | undefined, values: BranchFormValues) =>
  branch !== undefined && branch.is_active && !values.is_active && branch.has_bills;
