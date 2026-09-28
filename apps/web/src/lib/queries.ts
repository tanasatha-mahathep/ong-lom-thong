import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiFetch, decimalString } from "@/lib/api";

/** role ตาม spec §10 — ตรงกับ ROLES ใน @ong/db */
export const ROLES = ["staff", "manager", "accounting", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  staff: "พนักงาน",
  manager: "ผู้จัดการ",
  accounting: "บัญชี",
  admin: "ผู้ดูแลระบบ",
};

export const BranchSchema = z.object({ id: z.string(), code: z.string(), name: z.string() });
export type Branch = z.infer<typeof BranchSchema>;

const MeSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  role: z.enum(ROLES),
  /** สาขาที่กำลังทำงาน — null = ยังไม่ได้เลือก หรือสิทธิ์ถูกถอน */
  branch: BranchSchema.nullable(),
  branches: z.array(BranchSchema),
  can_view_all: z.boolean(),
});
export type Me = z.infer<typeof MeSchema>;

/**
 * ผู้ใช้ที่ login อยู่ — GET /api/me
 * 401 ของ query นี้ไม่ผ่านตัวดัก 401 กลาง: guard ของ `_app` และหน้า /login จัดการเอง
 */
export const meQueryOptions = queryOptions({
  queryKey: ["me"],
  queryFn: ({ signal }) => apiFetch("/api/me", { signal, schema: MeSchema }),
  staleTime: 5 * 60_000,
  meta: { handlesUnauthorized: true },
});

/** ผู้ใช้ปัจจุบันในหน้าที่อยู่ใต้ `_app` (guard โหลดไว้ให้แล้ว จึงไม่ suspend) */
export function useMe(): Me {
  return useSuspenseQuery(meQueryOptions).data;
}

const GoldPriceTodaySchema = z.object({
  date: z.iso.date(),
  bar_sell: decimalString,
  bar_buy: decimalString,
  jewelry_buy: decimalString,
  diff: decimalString,
  /** "branch" = ราคาเฉพาะสาขา · "central" = ราคากลางทุกสาขา */
  source: z.enum(["branch", "central"]),
});
export type GoldPriceToday = z.infer<typeof GoldPriceTodaySchema>;

/** ราคาทองวันนี้ของสาขาปัจจุบัน — GET /api/gold-price/today · 404 = ยังไม่ได้ตั้ง → null */
export const goldPriceTodayQueryOptions = queryOptions({
  queryKey: ["gold-price", "today"],
  queryFn: async ({ signal }): Promise<GoldPriceToday | null> => {
    try {
      return await apiFetch("/api/gold-price/today", { signal, schema: GoldPriceTodaySchema });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  staleTime: 60_000,
});
