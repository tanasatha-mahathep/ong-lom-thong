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
  if (viewer.canViewAll) return active;
  const granted = new Set([viewer.branchId, ...viewer.allowedBranchIds].filter((id): id is string => !!id));
  return active.filter((b) => granted.has(b.id));
}

/** สาขาที่กำลังทำงาน ต้องยังอยู่ในสิทธิ์ ณ ตอนนี้ — สิทธิ์ถูกถอนระหว่าง session = null */
export function currentBranch(viewer: Viewer, readable: BranchRef[]): BranchRef | null {
  return readable.find((b) => b.id === viewer.currentBranchId) ?? null;
}
