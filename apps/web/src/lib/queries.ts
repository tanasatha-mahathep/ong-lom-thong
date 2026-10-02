import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, apiFetch, decimalString } from "@/lib/api";

/** role ตาม spec §10 — ตรงกับ ROLES ใน @ong/db */
export const ROLES = ["staff", "manager", "accounting", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const BranchSchema = z.object({ id: z.string(), code: z.string(), name: z.string() });
export type Branch = z.infer<typeof BranchSchema>;

const MeSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  role: z.enum(ROLES),
  /** สาขาที่กำลังทำงาน — null = ยังไม่ได้เลือก หรือสิทธิ์ถูกถอน (ดู branch_closed แยกจากกรณีนี้) */
  branch: BranchSchema.nullable(),
  /** ไม่ null เฉพาะตอน session ชี้สาขาที่ปิดไปแล้ว (ต่างจาก "ยังไม่ได้เลือกสาขา" ที่ branch เป็น null เฉย ๆ) */
  branch_closed: BranchSchema.nullable().optional(),
  branches: z.array(BranchSchema),
  can_view_all: z.boolean(),
});
export type Me = z.infer<typeof MeSchema>;

/**
 * มีสาขาให้เลือก — มีสิทธิ์หลายสาขา หรือมีสิทธิ์แต่ session ยังไม่มีสาขาปัจจุบัน
 * (บัญชีสร้างด้วย `--allow` อย่างเดียว / สาขาหลักถูกปิด) · ใช้ทั้งขั้นเลือกสาขาตอน login และเมนูสลับสาขา
 */
export const canSwitchBranch = (me: Me) => me.branches.length > 1 || (!me.branch && me.branches.length > 0);

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

export const GoldPriceTodaySchema = z.object({
  date: z.iso.date(),
  bar_sell: decimalString,
  bar_buy: decimalString,
  jewelry_buy: decimalString,
  /**
   * ราคารับซื้อต่อกรัมของเงิน/แพลตตินั่มของวัน (ตั้งที่ราคากลางเท่านั้น ทุกสาขาใช้ร่วม)
   * null = ยังไม่ได้ตั้ง → วันนี้รับซื้อโลหะนั้นไม่ได้ (quote ตอบ error ที่แถว)
   */
  silver_per_g: decimalString.nullable(),
  platinum_per_g: decimalString.nullable(),
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

export const GoldReferenceSchema = z.object({
  /** host ที่เซิร์ฟเวอร์ดึงราคามา */
  source: z.string(),
  /** เวลาประกาศของสมาคม (ISO เวลาไทย) */
  announced_at: z.iso.datetime({ offset: true }),
  /** ครั้งที่ของวัน — ไม่มีในประกาศ = null */
  round: z.number().int().positive().nullable(),
  bar_buy: decimalString,
  bar_sell: decimalString,
  ornament_buy: decimalString,
  ornament_sell: decimalString,
  fetched_at: z.iso.datetime({ offset: true }),
  /** ประกาศล่าสุดไม่ใช่ของวันนี้ หรือดึงรอบล่าสุดไม่สำเร็จ (แสดงค่าที่ดึงไว้ก่อน) */
  stale: z.boolean(),
});
export type GoldReference = z.infer<typeof GoldReferenceSchema>;

/**
 * ราคาสมาคมค้าทองคำ (อ้างอิง) — GET /api/gold-price/reference · แสดง/เติมค่าเริ่มต้นเท่านั้น ไม่ใช่ราคาของร้าน
 * 503 = ดึงไม่ได้/ปิดไว้ (error ของ query) · ไม่ลองซ้ำเอง: เซิร์ฟเวอร์ cache และพักการดึงหลังล้มอยู่แล้ว
 */
export const goldReferenceQueryOptions = queryOptions({
  queryKey: ["gold-price", "reference"],
  queryFn: ({ signal }) => apiFetch("/api/gold-price/reference", { signal, schema: GoldReferenceSchema }),
  staleTime: 5 * 60_000,
  retry: false,
});
