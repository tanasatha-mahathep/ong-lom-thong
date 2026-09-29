import { useEffect, useId } from "react";

/**
 * ฟอร์มที่ยังไม่บันทึก (บิลที่กรอกค้างใน /buy · ฟอร์มลูกค้า) และการบันทึกที่ยังไม่จบ
 * — การกระทำที่ล้างหน้าทิ้งหรือเปลี่ยนบริบท (สลับสาขา) ถามยืนยันก่อน / ไม่ยอมทำระหว่างบันทึก
 * ฟอร์มประกาศตัวเองด้วย `useUnsavedChanges(dirty)` · `useSavingInProgress(saving)`
 */
const dirtySources = new Set<string>();
const savingSources = new Set<string>();

export function hasUnsavedChanges(): boolean {
  return dirtySources.size > 0;
}

/** มีฟอร์มกำลังส่งบันทึก (รวมช่วงลองซ้ำ) — ห้ามเปลี่ยนสาขาระหว่างนี้ ไม่งั้นบันทึกลงสาขาใหม่ได้ */
export function isSavingInProgress(): boolean {
  return savingSources.size > 0;
}

function useSource(set: Set<string>, active: boolean): void {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    set.add(id);
    return () => {
      set.delete(id);
    };
  }, [set, id, active]);
}

/** ประกาศว่าหน้านี้มีข้อมูลที่ยังไม่บันทึก — หน้าหาย (unmount) = ไม่นับแล้ว */
export function useUnsavedChanges(dirty: boolean): void {
  useSource(dirtySources, dirty);
}

/** ประกาศว่าหน้านี้กำลังบันทึกอยู่ */
export function useSavingInProgress(saving: boolean): void {
  useSource(savingSources, saving);
}

/**
 * ผู้ใช้ยอมทิ้งข้อมูลแล้ว (เช่น ก่อน reload หลังสลับสาขา) — ไม่ต้องให้ beforeunload ของฟอร์มถามซ้ำ
 * ฟอร์มที่ฟัง beforeunload ต้องเช็ก `hasUnsavedChanges()` ก่อนเตือน
 */
export function releaseUnsavedChanges(): void {
  dirtySources.clear();
}

/** เทสต์เท่านั้น — ล้างสถานะที่ค้างจากเทสต์ก่อน */
export function resetUnsavedChanges(): void {
  dirtySources.clear();
  savingSources.clear();
}
