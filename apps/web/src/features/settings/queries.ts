import { type QueryClient, keepPreviousData, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { meQueryOptions } from "@/lib/queries";
import {
  type BranchUpdateInput,
  type UserCreateInput,
  type UserFilters,
  type UserUpdateInput,
  createBranch,
  createUser,
  listBranches,
  listUsers,
  resetUserPassword,
  updateBranch,
  updateUser,
} from "./api";

/**
 * query key ของหน้าผู้ดูแล — `["admin", "branches"]` · `["admin", "users", filters]`
 * ไม่ใส่สาขาใน key: เป็นการตั้งค่าทั้งร้าน ไม่ขึ้นกับสาขาปัจจุบัน
 */
export const adminKeys = {
  all: ["admin"] as const,
  branches: () => [...adminKeys.all, "branches"] as const,
  users: () => [...adminKeys.all, "users"] as const,
  userList: (filters: UserFilters) => [...adminKeys.users(), filters] as const,
};

/** ทุกสาขารวมที่ปิดแล้ว เรียงตาม sort_order แล้วรหัส — ใช้ทั้งหน้าสาขาและตัวเลือกสาขาในหน้าผู้ใช้ */
export const adminBranchesQuery = queryOptions({
  queryKey: adminKeys.branches(),
  queryFn: async ({ signal }) => (await listBranches(signal)).items,
  staleTime: 30_000,
});

export function adminUsersQuery(filters: UserFilters) {
  return queryOptions({
    queryKey: adminKeys.userList(filters),
    queryFn: async ({ signal }) => (await listUsers(filters, signal)).items,
    // เปลี่ยนตัวกรองแล้วตารางไม่กระพริบเป็นว่าง
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * สาขาเปลี่ยน → รายการสาขา + รายชื่อผู้ใช้ (ชื่อสาขาในแต่ละแถว) + me (ปิดสาขาที่ตัวเองใช้อยู่ = สาขาที่เข้าได้เปลี่ยน)
 * รอรายการของหน้านี้ก่อนจบ — ปิดฟอร์มแล้วตารางแสดงค่าใหม่ทันที
 */
async function refreshAfterBranchChange(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey });
  await queryClient.invalidateQueries({ queryKey: adminKeys.all });
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBranch,
    onSuccess: () => refreshAfterBranchChange(queryClient),
  });
}

export function useUpdateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: BranchUpdateInput }) => updateBranch(id, input),
    onSuccess: () => refreshAfterBranchChange(queryClient),
  });
}

/**
 * ที่พักรหัสผ่านชั่วคราวระหว่างได้คำตอบจนถึงมือหน้าจอ — อ่านได้ครั้งเดียว (อ่านแล้วล้าง)
 * ห้ามเก็บ (สเปก §14.2): ไม่อยู่ใน data/variables ของ mutation cache · ไม่ลง storage · ไม่ log
 */
function useOneTimeSecret() {
  const slot = useRef<string | null>(null);
  return {
    put: (secret: string | null) => {
      slot.current = secret;
    },
    take: (): string | null => {
      const secret = slot.current;
      slot.current = null;
      return secret;
    },
  };
}

/**
 * เพิ่มผู้ใช้ — ผลของ mutation คือผู้ใช้เท่านั้น · รหัสผ่านชั่วคราว (เมื่อไม่ได้ตั้งเอง) อ่านด้วย takeTemporaryPassword()
 * gcTime 0: variables อาจมีรหัสผ่านที่ผู้ดูแลตั้งเอง — ทิ้ง mutation ทันทีที่ฟอร์มปิด
 */
export function useCreateUser() {
  const queryClient = useQueryClient();
  const secret = useOneTimeSecret();
  const mutation = useMutation({
    mutationFn: async (input: UserCreateInput) => {
      const { user, temporary_password } = await createUser(input);
      secret.put(temporary_password);
      return user;
    },
    gcTime: 0,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.users() }),
  });
  return { ...mutation, takeTemporaryPassword: secret.take };
}

/** แก้ผู้ใช้ — แก้บัญชีตัวเอง (ชื่อ · สาขา) ต้องอ่าน me ใหม่ด้วย จึงอ่านใหม่ทุกครั้ง (ถูก) */
export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) => updateUser(id, input),
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey });
      await queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });
}

/** ตั้งรหัสผ่านใหม่แบบสุ่ม (ลบทุก session ของผู้ใช้นั้น) — ผลคือจำนวน session ที่ถูกลบ · รหัสอ่านด้วย takeTemporaryPassword() */
export function useResetPassword() {
  const secret = useOneTimeSecret();
  const mutation = useMutation({
    mutationFn: async (id: string) => {
      const { temporary_password, sessions_revoked } = await resetUserPassword(id);
      secret.put(temporary_password);
      return { sessionsRevoked: sessions_revoked };
    },
    gcTime: 0,
  });
  return { ...mutation, takeTemporaryPassword: secret.take };
}
