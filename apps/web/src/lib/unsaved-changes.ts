import { useEffect, useId } from "react";

/**
 * ฟอร์มที่ยังไม่บันทึก (บิลที่กรอกค้างใน /buy · ฟอร์มลูกค้า) — การกระทำที่ล้างหน้าทิ้ง (สลับสาขา) ถามยืนยันก่อน
 * ฟอร์มประกาศตัวเองด้วย `useUnsavedChanges(dirty)` · ผู้ที่จะล้างหน้าถาม `hasUnsavedChanges()`
 */
const dirtySources = new Set<string>();

export function hasUnsavedChanges(): boolean {
  return dirtySources.size > 0;
}

/** ประกาศว่าหน้านี้มีข้อมูลที่ยังไม่บันทึก — หน้าหาย (unmount) = ไม่นับแล้ว */
export function useUnsavedChanges(dirty: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!dirty) return;
    dirtySources.add(id);
    return () => {
      dirtySources.delete(id);
    };
  }, [id, dirty]);
}

/** เทสต์เท่านั้น — ล้างสถานะที่ค้างจากเทสต์ก่อน */
export function resetUnsavedChanges(): void {
  dirtySources.clear();
}
