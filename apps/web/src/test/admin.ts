import type { AdminBranch, AdminUser } from "@/features/settings/api";
import { GOLD_PRICE, json, makeMe } from "@/test/app";

/** ข้อมูลปลอมของหน้าผู้ดูแล (/settings/branches · /settings/users) — ชื่อสมมติทั้งหมด · id สาขาเป็น uuid (API/URL ตรวจรูป) */

export const HQ_ID = "11111111-1111-4111-8111-111111111111";
export const BRANCH_2_ID = "22222222-2222-4222-8222-222222222222";
export const CLOSED_ID = "33333333-3333-4333-8333-333333333333";

export const HQ: AdminBranch = {
  id: HQ_ID,
  code: "00000",
  name: "สำนักงานใหญ่ทดสอบ",
  short_name: "สนญ.",
  tax_branch_code: "00000",
  tax_branch_label: "สำนักงานใหญ่",
  address: "1 ถนนทดสอบ แขวงทดสอบ",
  tel: "02-000-0000",
  doc_prefix: null,
  sort_order: 0,
  is_active: true,
  has_bills: true,
  created_at: "2026-09-01T03:00:00.000Z",
};

export const BRANCH_2: AdminBranch = {
  id: BRANCH_2_ID,
  code: "00001",
  name: "สาขาทดสอบ 2",
  short_name: null,
  tax_branch_code: "00001",
  tax_branch_label: "สาขาที่ 00001",
  address: null,
  tel: null,
  doc_prefix: "PT",
  sort_order: 1,
  is_active: true,
  has_bills: false,
  created_at: "2026-09-02T03:00:00.000Z",
};

/** ปิดแล้ว · ยังไม่ได้ตั้งรหัสสรรพากร */
export const CLOSED: AdminBranch = {
  id: CLOSED_ID,
  code: "00002",
  name: "สาขาทดสอบปิด",
  short_name: null,
  tax_branch_code: null,
  tax_branch_label: null,
  address: null,
  tel: null,
  doc_prefix: null,
  sort_order: 2,
  is_active: false,
  has_bills: false,
  created_at: "2026-09-03T03:00:00.000Z",
};

export const BRANCHES = [HQ, BRANCH_2, CLOSED];

const ref = ({ id, code, name }: AdminBranch) => ({ id, code, name });

/** ผู้ดูแลที่ login อยู่ — id เดียวกับ makeMe("admin") */
export const ME_ADMIN: AdminUser = {
  id: "u-admin",
  email: "admin@ong.test",
  name: "ทดสอบ admin",
  role: "admin",
  branch: ref(HQ),
  allowed_branches: [],
  can_view_all: true,
  is_active: true,
  created_at: "2026-09-01T03:00:00.000Z",
};

export const OTHER_ADMIN: AdminUser = {
  ...ME_ADMIN,
  id: "u-admin-2",
  email: "tester-admin2@local.test",
  name: "ผู้ดูแลทดสอบ 2",
};

export const STAFF: AdminUser = {
  id: "u-staff-1",
  email: "tester-staff@local.test",
  name: "สมชาย ทดสอบ",
  role: "staff",
  branch: ref(BRANCH_2),
  allowed_branches: [ref(HQ), ref(CLOSED)],
  can_view_all: false,
  is_active: true,
  created_at: "2026-09-05T03:00:00.000Z",
};

export const INACTIVE_MANAGER: AdminUser = {
  id: "u-old",
  email: "tester-old@local.test",
  name: "สมหญิง ทดสอบ",
  role: "manager",
  branch: null,
  allowed_branches: [],
  can_view_all: false,
  is_active: false,
  created_at: "2026-09-06T03:00:00.000Z",
};

export const USERS = [ME_ADMIN, OTHER_ADMIN, STAFF, INACTIVE_MANAGER];

/** โครงแอป (header · sidebar) ของผู้ใช้ role นี้ */
export const shellFor = (role: Parameters<typeof makeMe>[0]) => ({
  "GET /api/me": () => json(makeMe(role)),
  "GET /api/gold-price/today": () => json(GOLD_PRICE),
});
