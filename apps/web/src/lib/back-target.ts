import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * ปุ่มย้อนกลับของหน้าเอกสาร (PageHeader `back`) พากลับไป "รายการตามที่ออกมา" — ตัวกรอง/หน้าที่ค้นไว้ยังอยู่
 * เลือกแบบกำหนดได้แน่นอน (ไม่ใช้ history.back ที่อาจพาออกนอกแอปหรือไปหน้าอื่น): จำ search ล่าสุดของหน้ารายการ
 * ที่เปิดในแท็บนี้ · ไม่เคยเปิด = ไปรายการเปล่า ๆ (`to`)
 */
export type BackListPath = "/customers" | "/bills";
const LIST_PATHS: readonly string[] = ["/customers", "/bills"] satisfies readonly BackListPath[];

const lastSearch = new Map<string, Record<string, unknown>>();

export function rememberedSearch(path: BackListPath): Record<string, unknown> {
  return lastSearch.get(path) ?? {};
}

/** จำ search ของหน้ารายการที่กำลังเปิด — เรียกครั้งเดียวที่ shell (_app.tsx) */
export function useRememberListSearch(): void {
  const location = useRouterState({ select: (state) => state.location });
  useEffect(() => {
    if (LIST_PATHS.includes(location.pathname)) lastSearch.set(location.pathname, location.search);
  }, [location]);
}

/** เทสต์เท่านั้น */
export function resetBackTargets(): void {
  lastSearch.clear();
}
