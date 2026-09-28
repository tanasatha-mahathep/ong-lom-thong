import { type Db, type Role, branch } from "@ong/db";
import { asc, eq } from "drizzle-orm";

/** ผู้ใช้ที่ login แล้ว ในรูปที่ route ใช้ — มาจาก session ของ better-auth เท่านั้น */
export interface Viewer {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  role: Role;
  branchId: string | null;
  allowedBranchIds: string[];
  canViewAll: boolean;
  currentBranchId: string | null;
}

export interface BranchRef {
  id: string;
  code: string;
  name: string;
}

/**
 * สาขาที่ผู้ใช้อ่านได้ (CLAUDE.md กฎ 4 · spec §10) — fail-closed:
 * ไม่มีสิทธิ์ = [] ไม่ใช่ "ทุกสาขา" · สาขาที่ปิดแล้วไม่นับ · canViewAll = ทุกสาขาที่เปิดอยู่
 * ทุก query ที่มี branch_id ต้องกรองด้วยผลของฟังก์ชันนี้ (หรือ currentBranch สำหรับการเขียน)
 */
export async function forUser(db: Db, viewer: Viewer): Promise<BranchRef[]> {
  const active = await db
    .select({ id: branch.id, code: branch.code, name: branch.name })
    .from(branch)
    .where(eq(branch.isActive, true))
    .orderBy(asc(branch.code));
  return grantedOf(viewer, active);
}

/** role ที่อ่านเอกสารของสาขาที่ปิดไปแล้วได้ — บัญชี/ผู้ดูแลต้องเปิดเอกสารภาษีย้อนหลัง (เก็บ ≥ 5 ปี) */
const HISTORY_ROLES: readonly Role[] = ["accounting", "admin"];

/**
 * สาขาที่อ่าน "เอกสารย้อนหลัง" ได้ (บิล · รายการ/ยอดรวม · PDF · สำเนาบัตร) — เจ้าของกำหนด 28 ก.ย.:
 * accounting/admin เห็นสาขาที่ถูกปิดแล้วด้วย (อ่านอย่างเดียว) · role อื่น = forUser (fail-closed ตามเดิม)
 * การเขียน (quote · บันทึก · ยกเลิก · retry) ต้องใช้ forUser + currentBranch เสมอ — สาขาที่ปิดเขียนไม่ได้
 */
export async function forUserHistory(db: Db, viewer: Viewer): Promise<BranchRef[]> {
  if (!HISTORY_ROLES.includes(viewer.role)) return forUser(db, viewer);
  const all = await db
    .select({ id: branch.id, code: branch.code, name: branch.name })
    .from(branch)
    .orderBy(asc(branch.code));
  return grantedOf(viewer, all);
}

/** canViewAll = ทุกสาขาในรายการ · ไม่งั้นเฉพาะสาขาหลัก + สาขาที่อนุญาต */
function grantedOf(viewer: Viewer, branches: BranchRef[]): BranchRef[] {
  if (viewer.canViewAll) return branches;
  const granted = new Set([viewer.branchId, ...viewer.allowedBranchIds].filter((id): id is string => !!id));
  return branches.filter((b) => granted.has(b.id));
}

/** สาขาที่กำลังทำงาน ต้องยังอยู่ในสิทธิ์ ณ ตอนนี้ — สิทธิ์ถูกถอนระหว่าง session = null */
export function currentBranch(viewer: Viewer, readable: BranchRef[]): BranchRef | null {
  return readable.find((b) => b.id === viewer.currentBranchId) ?? null;
}

/**
 * สาขาปัจจุบัน "ที่ถูกปิดไปแล้ว" — แยกจาก currentBranch()=null ซึ่งดูเหมือนกันหมดไม่ว่าจะยังไม่ได้เลือก/ไม่มีสิทธิ์/ถูกปิด
 * ไม่ใช่ null ก็ต่อเมื่อ currentBranchId ชี้สาขาที่มีอยู่จริง ปิดแล้ว (is_active=false) และยังอยู่ในสิทธิ์เดิมของผู้ใช้
 * fail-closed (CLAUDE.md กฎ 4): สาขาที่ไม่เคยมีสิทธิ์ (แม้ถูกปิด) = null เหมือนไม่ได้เลือก — ห้ามรั่วชื่อสาขาที่ไม่ใช่ของผู้ใช้
 */
export async function currentBranchClosed(db: Db, viewer: Viewer): Promise<BranchRef | null> {
  if (!viewer.currentBranchId) return null;
  const [row] = await db
    .select({ id: branch.id, code: branch.code, name: branch.name, isActive: branch.isActive })
    .from(branch)
    .where(eq(branch.id, viewer.currentBranchId))
    .limit(1);
  if (!row || row.isActive) return null;
  return grantedOf(viewer, [{ id: row.id, code: row.code, name: row.name }])[0] ?? null;
}
